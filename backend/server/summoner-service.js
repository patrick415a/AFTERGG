const { normalizeStoredMatch } = require('./matches');

function databaseError(error) {
  console.error('Database operation failed:', error.code || error.name);
  const failure = new Error('DATABASE_ERROR', { cause: error });
  failure.code = 'DATABASE_ERROR';
  return failure;
}

function createSummonerService({ database, riotGet, coalesce, getCached, setCached, now }) {
  async function query(task) {
    try {
      return await task();
    } catch (error) {
      throw databaseError(error);
    }
  }

  async function playerProfile(gameName, tagLine) {
    const account = await riotGet(
      `https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    ).catch((error) => {
      if (error.status === 404) error.code = 'ACCOUNT_NOT_FOUND';
      throw error;
    });
    const [rankResult, profileResult] = await Promise.allSettled([
      riotGet(
        `https://kr.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`,
      ),
      riotGet(
        `https://kr.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`,
      ),
    ]);
    for (const result of [rankResult, profileResult]) {
      if (result.status === 'rejected' && [401, 403, 429].includes(result.reason.status))
        throw result.reason;
    }
    const warnings = [];
    if (rankResult.status === 'rejected' && rankResult.reason.status !== 404)
      warnings.push('랭크 정보를 가져오지 못했습니다.');
    if (profileResult.status === 'rejected')
      warnings.push(
        profileResult.reason.status === 404
          ? 'KR 서버의 소환사 프로필이 없습니다.'
          : '소환사 프로필을 가져오지 못했습니다.',
      );
    return {
      account,
      profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
      ranks:
        rankResult.status === 'fulfilled'
          ? rankResult.value
          : rankResult.reason.status === 404
            ? []
            : null,
      warnings,
    };
  }

  async function collectMatchIds(puuid, queue, anchor) {
    const ids = [];
    for (let start = 0; ; start += 100) {
      const params = new URLSearchParams({
        queue,
        startTime: String(anchor - 30 * 86400),
        endTime: String(anchor),
        start: String(start),
        count: '100',
      });
      const batch = await riotGet(
        `https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params}`,
      );
      ids.push(...batch);
      if (batch.length < 100) break;
    }
    return ids;
  }

  async function refreshMatches(puuid, anchor) {
    const ids = [
      ...new Set(
        (
          await Promise.all([
            collectMatchIds(puuid, '420', anchor),
            collectMatchIds(puuid, '440', anchor),
          ])
        ).flat(),
      ),
    ];
    const stored = await query(() => database.getStoredMatchesByIds(ids));
    const byId = new Map(stored.map((match) => [match.matchId, match]));
    for (const id of ids) {
      if (byId.has(id)) continue;
      const key = `match:${id}`;
      const match =
        getCached(key) ||
        (await coalesce(key, async () =>
          setCached(
            key,
            normalizeStoredMatch(
              await riotGet(
                `https://asia.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`,
              ),
            ),
            86400000,
          ),
        ));
      byId.set(id, match);
    }
    const matches = ids.map((id) => byId.get(id));
    if (matches.some((match) => !match.participants.some((player) => player.puuid === puuid))) {
      throw new Error('MATCH_PARTICIPANT_MISSING');
    }
    return matches;
  }

  return async function getSummoner({ gameName, tagLine, refresh, apiKey, ...options }) {
    const key = `summoner:${gameName.toLowerCase()}#${tagLine.toLowerCase()}:${refresh}:${options.profileOnly}:${options.queue}:${options.page}:${options.anchor}`;
    return coalesce(key, async () => {
      if (!refresh) {
        const stored = await query(() => database.getSummoner(gameName, tagLine, options));
        if (stored) return stored;
      }
      if (!apiKey) {
        const error = new Error('API_KEY_MISSING');
        error.code = 'API_KEY_MISSING';
        throw error;
      }
      const profile = await playerProfile(gameName, tagLine);
      // 최초 검색에는 프로필만 등록합니다. 경기 수집은 전적 갱신에서만 실행합니다.
      const loadMatches = refresh && !options.profileOnly;
      const matches = loadMatches
        ? await refreshMatches(profile.account.puuid, options.anchor)
        : [];
      await query(() =>
        database.saveSummonerData({
          ...profile,
          matches,
          anchor: options.anchor,
          refresh: loadMatches,
          now: now(),
        }),
      );
      // API 응답을 그대로 반환하지 않습니다. commit된 DB 데이터를 다시 읽습니다.
      const saved = await query(() =>
        database.getSummoner(profile.account.gameName, profile.account.tagLine, options),
      );
      if (!saved) throw databaseError(new Error('SAVED_PLAYER_NOT_FOUND'));
      return saved;
    });
  };
}

module.exports = { createSummonerService };
