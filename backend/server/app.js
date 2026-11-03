const defaultDatabase = require('./db');

const express = require('express');
const { createPatchNotesService } = require('./patch-notes');
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const PERIOD_DAYS = 30;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { normalizeMatch, normalizeParticipant } = require('./matches');
const { createSummonerService } = require('./summoner-service');
const { koreanDay } = require('./recommendations');

function createApp({
  apiKey,
  fetchImpl = fetch,
  now = Date.now,
  requestInterval = 700,
  database = defaultDatabase,
} = {}) {
  const { searchSummoners } = database;
  const app = express();
  const getPatchNotes = createPatchNotesService({ fetchImpl, now });
  const getSummoner = createSummonerService({
    database,
    riotGet,
    coalesce,
    getCached,
    setCached,
    now,
  });
  app.disable('x-powered-by');
  // 테스트용 HTML이나 소스 디렉터리는 서빙하지 않습니다. API 전용 서버입니다.
  const cache = new Map();
  const inFlight = new Map();
  let requestQueue = Promise.resolve();
  let lastRequestAt = 0;
  let requestTimes = [];
  let cooldownUntil = 0;
  function getCached(key) {
    const item = cache.get(key);
    if (!item || item.expires <= now()) {
      cache.delete(key);
      return null;
    }
    return item.value;
  }
  function setCached(key, value, ttl = 60000) {
    for (const [k, item] of cache) if (item.expires <= now()) cache.delete(k);
    cache.delete(key);
    while (cache.size >= 400) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + ttl });
    return value;
  }
  async function coalesce(key, task) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = task().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }
  // 모든 사용자 요청을 하나의 대기열로 처리하여 API 키의 호출 제한을 공유합니다.
  async function reserveRequestSlot() {
    const next = requestQueue.then(async () => {
      requestTimes = requestTimes.filter((t) => now() - t < 120000);
      const delay = Math.max(
        0,
        lastRequestAt + requestInterval - now(),
        cooldownUntil - now(),
        requestTimes.length >= 100 ? requestTimes[0] + 120001 - now() : 0,
      );
      if (delay) await wait(delay);
      lastRequestAt = now();
      requestTimes = requestTimes.filter((t) => now() - t < 120000);
      requestTimes.push(now());
    });
    requestQueue = next.catch(() => {});
    await next;
  }
  async function riotGet(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await reserveRequestSlot();
      const response = await fetchImpl(url, {
        headers: { 'X-Riot-Token': apiKey },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const seconds = header === null ? NaN : Number(header);
        const delay =
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000 * (attempt + 1);
        cooldownUntil = Math.max(cooldownUntil, now() + delay);
        // 긴 제한은 브라우저에 알려 재시도하게 합니다.
        if (delay > 15000 || attempt === 2) {
          const error = new Error('RATE_LIMIT');
          error.status = 429;
          error.retryAfter = Math.ceil(delay / 1000);
          throw error;
        }
        continue;
      }
      if (!response.ok) {
        const error = new Error('RIOT_ERROR');
        error.status = response.status;
        throw error;
      }
      return response.json();
    }
  }
  async function publicJson(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('ASSET_ERROR');
    return response.json();
  }
  async function getAssets() {
    const cached = getCached('assets');
    if (cached) return cached;
    return coalesce('assets', async () => {
      const versions = await publicJson(`${DDRAGON}/api/versions.json`);
      const version = versions[0];
      if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('ASSET_ERROR');
      const base = `${DDRAGON}/cdn/${version}`;
      const [champions, spells, runeTrees, items] = await Promise.all([
        publicJson(`${base}/data/ko_KR/champion.json`),
        publicJson(`${base}/data/ko_KR/summoner.json`),
        publicJson(`${base}/data/ko_KR/runesReforged.json`),
        publicJson(`${base}/data/ko_KR/item.json`),
      ]);
      const runeImages = {};
      for (const tree of runeTrees) {
        runeImages[tree.id] = { name: tree.name, image: `${DDRAGON}/cdn/img/${tree.icon}` };
        for (const slot of tree.slots)
          for (const rune of slot.runes)
            runeImages[rune.id] = { name: rune.name, image: `${DDRAGON}/cdn/img/${rune.icon}` };
      }
      return setCached(
        'assets',
        {
          version,
          champions: Object.fromEntries(
            Object.values(champions.data).map((c) => [
              c.key,
              {
                id: c.id,
                name: c.name,
                image: `${base}/img/champion/${c.image.full}`,
                splash: `${DDRAGON}/cdn/img/champion/splash/${c.id}_0.jpg`,
                centered: `${DDRAGON}/cdn/img/champion/centered/${c.id === 'Fiddlesticks' ? 'FiddleSticks' : c.id}_0.jpg`,
              },
            ]),
          ),
          spells: Object.fromEntries(
            Object.values(spells.data).map((s) => [
              s.key,
              { name: s.name, image: `${base}/img/spell/${s.image.full}` },
            ]),
          ),
          runes: runeImages,
          items: Object.fromEntries(
            Object.entries(items.data).map(([id, item]) => [
              id,
              { name: item.name, image: `${base}/img/item/${item.image.full}` },
            ]),
          ),
        },
        86400000,
      );
    });
  }
  function apiError(res, error, stage) {
    const status = error.status;
    if (error.code === 'DATABASE_ERROR') {
      return res.status(503).json({
        code: 'DATABASE_ERROR',
        error:
          '저장된 전적을 처리하지 못했습니다. DB 연결과 테이블 설정을 확인한 후 다시 시도해 주세요.',
      });
    }
    if (error.code === 'API_KEY_MISSING')
      return res
        .status(503)
        .json({ code: 'API_KEY_MISSING', error: '백엔드 .env에 RIOT_API_KEY를 설정해 주세요.' });
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return res.status(504).json({
        code: 'TIMEOUT',
        error: '조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
      });
    if (status === 401 || status === 403)
      return res.status(502).json({
        code: 'API_KEY_ERROR',
        error: 'Riot API 키가 만료되었거나 유효하지 않습니다. 백엔드의 키를 확인해 주세요.',
      });
    if (status === 404 && (stage === 'account' || error.code === 'ACCOUNT_NOT_FOUND'))
      return res
        .status(404)
        .json({ code: 'ACCOUNT_NOT_FOUND', error: '해당 Riot ID를 찾지 못했습니다.' });
    if (status === 429) {
      if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
      return res.status(429).json({
        code: 'RATE_LIMIT',
        error: 'API 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return res.status(502).json({
      code: 'UPSTREAM_ERROR',
      error: '전적 서버에서 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
  app.get('/api/health', (req, res) => res.json({ ok: true, apiKeyConfigured: Boolean(apiKey) }));

  app.get('/api/champion-recommendations', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      // 이미지 메타데이터와 분리하여 DB 집계에 Riot 키나 외부 요청이 필요하지 않습니다.
      const currentTime = now();
      res.json(
        await coalesce(`recommendations:${koreanDay(currentTime).date}`, () =>
          database.getChampionRecommendations(currentTime),
        ),
      );
    } catch (error) {
      console.error('추천 챔피언 집계 실패:', error.code || error.name);
      res.status(503).json({
        code: 'RECOMMENDATIONS_UNAVAILABLE',
        error: '추천 챔피언을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  });

  app.get('/api/summoners/suggest', async (req, res) => {
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';

    if (!keyword || keyword.length > 100) {
      return res.status(400).json({
        error: '검색어를 확인해 주세요.',
      });
    }

    try {
      const summoners = await searchSummoners(keyword);
      res.json(summoners);
    } catch (error) {
      console.error('자동완성 검색 실패:', error.message);
      res.status(500).json({
        error: '소환사 검색 중 오류가 발생했습니다.',
      });
    }
  });

  app.get('/api/patch-notes', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await getPatchNotes());
    } catch {
      res.status(502).json({
        code: 'PATCH_NOTES_UNAVAILABLE',
        error: '패치 노트를 불러오지 못했습니다. 공식 홈페이지에서 확인해 주세요.',
      });
    }
  });
  app.get('/api/assets', async (req, res) => {
    try {
      res.json(await getAssets());
    } catch (error) {
      apiError(res, error, 'assets');
    }
  });
  app.get('/api/summoner', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let stage = 'validation';
    try {
      const gameName = typeof req.query.gameName === 'string' ? req.query.gameName.trim() : '';
      const tagLine = typeof req.query.tagLine === 'string' ? req.query.tagLine.trim() : '';
      const queue = String(req.query.queue || 'all');
      const pageText = String(req.query.page || '1');
      if (
        !gameName ||
        !tagLine ||
        gameName.length > 100 ||
        tagLine.length > 20 ||
        !['all', '420', '440'].includes(queue) ||
        !/^[1-9]\d*$/.test(pageText) ||
        Number(pageText) > 100
      )
        return res
          .status(400)
          .json({ code: 'INVALID_QUERY', error: '검색 정보와 페이지 번호를 확인해 주세요.' });
      const page = Number(pageText);
      const current = Math.floor(now() / 1000);
      const suppliedAnchor = req.query.anchor;
      const anchor = suppliedAnchor === undefined ? current : Number(suppliedAnchor);
      if (
        (page > 1 && suppliedAnchor === undefined) ||
        (suppliedAnchor !== undefined && !/^\d+$/.test(String(suppliedAnchor))) ||
        !Number.isSafeInteger(anchor) ||
        anchor > current ||
        anchor < current - PERIOD_DAYS * 86400
      )
        return res.status(400).json({
          code: 'INVALID_ANCHOR',
          error: '검색 기준 시간이 올바르지 않습니다. 다시 검색해 주세요.',
        });
      const refresh = req.query.refresh === 'true';
      const profileOnly = req.query.profileOnly === 'true';
      if (profileOnly && (page !== 1 || queue !== 'all'))
        return res
          .status(400)
          .json({ code: 'INVALID_QUERY', error: '플레이어 확인 요청이 올바르지 않습니다.' });
      if (refresh && (page !== 1 || queue !== 'all' || suppliedAnchor !== undefined)) {
        return res.status(400).json({
          code: 'INVALID_QUERY',
          error: '전적 갱신은 첫 페이지 전체 전적에서 실행해 주세요.',
        });
      }
      const result = await getSummoner({
        gameName,
        tagLine,
        queue,
        page,
        anchor,
        refresh,
        profileOnly,
        apiKey,
      });
      res.json(result);
    } catch (error) {
      apiError(res, error, stage);
    }
  });
  return app;
}
module.exports = { createApp, normalizeMatch, normalizeParticipant };
