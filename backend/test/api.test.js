const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, normalizeMatch } = require('../server/app');
const { stamp, person, match, fakeRiot } = require('./helpers');
const { createMemoryDatabase } = require('./memory-db');

test('match normalization preserves seconds, real damage, participant teams, items and rune ids', () => {
  const m = normalizeMatch(match('A'), 'test-player');
  assert.equal(m.durationSeconds, 1801);
  assert.equal(m.cs, 23);
  assert.equal(m.damage, 12000);
  assert.equal(m.killParticipation, 60);
  assert.equal(m.participants.length, 3);
  assert.deepEqual(m.runes, [8214, 8100]);
  assert.equal(m.items[0], 1001);
});
test('remake flag applies to the whole match and is independent of win and elapsed time', () => {
  for (const seconds of [100, 248]) {
    const data = match('REMAKE');
    data.info.gameDuration = seconds;
    data.info.participants[2].gameEndedInEarlySurrender = true;
    for (const puuid of ['test-player', 'enemy'])
      assert.equal(normalizeMatch(data, puuid).remake, true);
  }
});
test('ordinary surrender and short unflagged games are not classified as remakes', () => {
  for (const seconds of [100, 900, 1800]) {
    const data = match('NORMAL');
    data.info.gameDuration = seconds;
    data.info.participants.forEach((p) => {
      p.gameEndedInEarlySurrender = false;
      p.gameEndedInSurrender = true;
      p.teamEarlySurrendered = true;
    });
    assert.equal(normalizeMatch(data, 'test-player').remake, false);
  }
  assert.equal(normalizeMatch(match('LEGACY'), 'test-player').remake, false);
});

test('only bot and support have an eighth item slot; other role quest rewards stay hidden', () => {
  for (const [position, roleBoundItem] of [
    ['BOTTOM', 3006],
    ['UTILITY', 2055],
    ['TOP', 1220],
    ['JUNGLE', 1209],
    ['MIDDLE', 1206],
    ['UNKNOWN', 1220],
  ]) {
    const data = match('ROLE_SLOT');
    data.info.participants[0] = person({ teamPosition: position, roleBoundItem, item6: 3363 });
    const normalized = normalizeMatch(data, 'test-player');
    const extraSlot = ['BOTTOM', 'UTILITY'].includes(position);
    assert.equal(normalized.items.length, extraSlot ? 8 : 7);
    assert.equal(normalized.items[6], 3363);
    assert.equal(normalized.items[7], extraSlot ? roleBoundItem : undefined);
    assert.equal(normalized.participants[0].items.length, extraSlot ? 8 : 7);
    assert.equal(normalized.participants[0].items[7], extraSlot ? roleBoundItem : undefined);
  }
  const legacy = normalizeMatch(match('LEGACY'), 'test-player');
  assert.equal(legacy.items.length, 8);
  assert.equal(legacy.items[7], 0);
});
async function withServer(config, callback) {
  const database = config.database || createMemoryDatabase();
  const server = createApp({
    apiKey: 'test-key',
    now: () => stamp,
    requestInterval: 0,
    ...config,
    database,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, database);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const query = '/api/summoner?' + new URLSearchParams({ gameName: '테스트', tagLine: 'KR1' });
const refreshQuery = query + '&refresh=true';

test('initial lookup registers only profile; explicit refresh persists all details then rereads DB', async () => {
  const riot = fakeRiot();
  await withServer(riot, async (base, database) => {
    const profile = await (await fetch(base + query)).json();
    assert.equal(profile.summonerLevel, 10);
    assert.equal(profile.solo.tier, 'EMERALD');
    assert.equal(profile.matchesLoaded, false);
    assert.equal(
      riot.calls.some((url) => url.pathname.includes('/matches/')),
      false,
    );
    const reads = database.calls.reads;
    const fresh = await (await fetch(base + refreshQuery)).json();
    assert.equal(fresh.matchesLoaded, true);
    assert.equal(fresh.matches[0].matchId, 'A');
    assert.equal(fresh.matches[0].participants.length, 3);
    assert.equal(database.matches.size, 1);
    assert.ok(database.calls.reads > reads);
  });
});

test('returning to an existing player uses DB only, even with no Riot key', async () => {
  const database = createMemoryDatabase();
  await withServer({ ...fakeRiot(), database }, async (base) => {
    assert.equal((await fetch(base + refreshQuery)).status, 200);
  });
  await withServer(
    {
      apiKey: '',
      database,
      fetchImpl: async () => {
        throw new Error('No Riot calls allowed');
      },
    },
    async (base) => {
      const response = await fetch(base + query);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).matches[0].matchId, 'A');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    },
  );
});

test('stored history does not expire after 24 hours; only the rolling 30-day display window changes', async () => {
  let clock = stamp;
  const riot = fakeRiot();
  await withServer({ ...riot, now: () => clock }, async (base) => {
    await fetch(base + refreshQuery);
    const calls = riot.calls.length;
    clock += 2 * 86400000;
    assert.equal((await (await fetch(base + query)).json()).matches.length, 1);
    assert.equal(riot.calls.length, calls);
    clock += 31 * 86400000;
    assert.equal((await (await fetch(base + query)).json()).matches.length, 0);
    assert.equal(riot.calls.length, calls);
  });
});

test('every participant shares the saved match without new API calls or invented profile levels', async () => {
  const riot = fakeRiot();
  await withServer(riot, async (base, database) => {
    await fetch(base + refreshQuery);
    const calls = riot.calls.length;
    const teammate = await (
      await fetch(
        base + '/api/summoner?' + new URLSearchParams({ gameName: '팀원', tagLine: 'KR1' }),
      )
    ).json();
    assert.equal(teammate.matches[0].matchId, 'A');
    assert.equal(teammate.matches[0].kills, 18);
    assert.equal(teammate.summonerLevel, null);
    assert.equal(teammate.profileLoaded, false);
    assert.equal(teammate.historyComplete, false);
    assert.equal(teammate.solo, null);
    assert.equal(riot.calls.length, calls);
    assert.equal(database.matches.size, 1);
  });
});

test('another refresh reuses immutable details from DB across server restarts', async () => {
  const database = createMemoryDatabase();
  await withServer({ ...fakeRiot(), database }, async (base) => {
    await fetch(base + refreshQuery);
  });
  const riot = fakeRiot();
  await withServer({ ...riot, database }, async (base) => {
    const response = await fetch(base + refreshQuery);
    assert.equal(response.status, 200);
    assert.equal(database.matches.size, 1);
    assert.equal(riot.calls.filter((url) => url.pathname.endsWith('/matches/A')).length, 0);
    assert.equal(riot.calls.filter((url) => url.pathname.includes('/accounts/')).length, 1);
  });
});

test('a migrated incomplete match is enriched from Riot on refresh', async () => {
  const { normalizeStoredMatch } = require('../server/matches');
  const database = createMemoryDatabase();
  database.matches.set('A', { ...normalizeStoredMatch(match('A')), detailComplete: false });
  const riot = fakeRiot();
  await withServer({ ...riot, database }, async (base) => {
    assert.equal((await fetch(base + refreshQuery)).status, 200);
    assert.equal(riot.calls.filter((url) => url.pathname.endsWith('/matches/A')).length, 1);
    assert.equal(database.matches.get('A').detailComplete, true);
  });
});

test('refresh collects every ID page and all 30-day matches; display pagination reads DB only', async () => {
  const riot = fakeRiot({
    ids: {
      420: Array.from({ length: 102 }, (_, index) => `M${index * 2}`),
      440: Array.from({ length: 38 }, (_, index) => `M${index * 2 + 1}`),
    },
  });
  // 100회/2분 제한은 유지하되, 많은 경기의 테스트에서는 가상 시각만 진행합니다.
  await withServer(
    { ...riot, now: () => stamp + Math.floor(riot.calls.length / 80) * 120001 },
    async (base, database) => {
      const first = await (await fetch(base + refreshQuery)).json();
      assert.equal(database.matches.size, 140);
      assert.equal(first.matches.length, 30);
      assert.equal(first.hasMore, true);
      const count = riot.calls.length;
      const all = [...first.matches];
      for (let page = 2; page <= 5; page++) {
        const next = await (
          await fetch(base + query + '&page=' + page + '&anchor=' + first.anchor)
        ).json();
        all.push(...next.matches);
        assert.equal(next.hasMore, page < 5);
      }
      assert.equal(all.length, 140);
      assert.equal(new Set(all.map((game) => game.matchId)).size, 140);
      assert.ok(all.every((game, index) => !index || all[index - 1].playedAt >= game.playedAt));
      assert.equal(riot.calls.length, count);
      assert.ok(
        riot.calls.some(
          (url) => url.pathname.endsWith('/ids') && url.searchParams.get('start') === '100',
        ),
      );
    },
  );
});

test('DB read failures do not masquerade as missing players or trigger Riot fallback', async () => {
  const riot = fakeRiot();
  const database = createMemoryDatabase();
  database.getSummoner = async () => {
    throw new Error('DB unavailable');
  };
  await withServer({ ...riot, database }, async (base) => {
    const response = await fetch(base + query);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'DATABASE_ERROR');
    assert.equal(riot.calls.length, 0);
  });
});

test('failed persistence reports an error and does not return uncommitted API data', async () => {
  const database = createMemoryDatabase();
  database.saveSummonerData = async () => {
    throw new Error('write failed');
  };
  await withServer({ ...fakeRiot(), database }, async (base) => {
    const response = await fetch(base + refreshQuery);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'DATABASE_ERROR');
    assert.equal(database.matches.size, 0);
  });
});

test('the refresh response is the DB projection, not the original Riot payload', async () => {
  const database = createMemoryDatabase();
  const originalRead = database.getSummoner;
  database.getSummoner = async (...args) => {
    const value = await originalRead(...args);
    if (value) value.summonerLevel = 987;
    return value;
  };
  await withServer({ ...fakeRiot(), database }, async (base) => {
    const response = await fetch(base + refreshQuery);
    assert.equal((await response.json()).summonerLevel, 987);
  });
});

test('concurrent refresh requests share upstream work and one DB write', async () => {
  const riot = fakeRiot();
  const database = createMemoryDatabase();
  const save = database.saveSummonerData;
  database.saveSummonerData = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return save(...args);
  };
  await withServer({ ...riot, database }, async (base) => {
    const results = await Promise.all([fetch(base + refreshQuery), fetch(base + refreshQuery)]);
    assert.deepEqual(
      results.map((result) => result.status),
      [200, 200],
    );
    assert.equal(database.calls.writes, 1);
    assert.equal(riot.calls.filter((url) => url.pathname.includes('/accounts/')).length, 1);
  });
});

test('an empty successful refresh remains distinguishable from history not yet loaded', async () => {
  await withServer(fakeRiot({ ids: { 420: [], 440: [] }, emptyRanks: true }), async (base) => {
    const response = await fetch(base + refreshQuery);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.matchesLoaded, true);
    assert.equal(data.historyComplete, true);
    assert.deepEqual(data.matches, []);
    assert.equal(data.solo, null);
  });
});

test('account absence, expired credentials and request limits remain distinct', async () => {
  for (const [status, expected, code] of [
    [404, 404, 'ACCOUNT_NOT_FOUND'],
    [403, 502, 'API_KEY_ERROR'],
    [429, 429, 'RATE_LIMIT'],
  ]) {
    await withServer(fakeRiot({ failAt: '/accounts/', failStatus: status }), async (base) => {
      const response = await fetch(base + refreshQuery);
      assert.equal(response.status, expected);
      assert.equal((await response.json()).code, code);
      if (status === 429) assert.equal(response.headers.get('Retry-After'), '60');
    });
  }
});

test('invalid pagination, queues, anchors and non-first-page refresh fail before API calls', async () => {
  const riot = fakeRiot();
  await withServer(riot, async (base) => {
    for (const suffix of [
      '&queue=450',
      '&page=0',
      '&page=2',
      '&anchor=NaN',
      '&anchor=999999999999',
      '&refresh=true&page=2&anchor=' + Math.floor(stamp / 1000),
    ]) {
      assert.equal((await fetch(base + query + suffix)).status, 400);
    }
    assert.equal(riot.calls.length, 0);
  });
});

test('profileOnly and legacy queue filters read stored data without additional API calls', async () => {
  const riot = fakeRiot({ ids: { 420: ['A'], 440: ['F1'] } });
  await withServer(riot, async (base) => {
    await fetch(base + refreshQuery);
    const count = riot.calls.length;
    const profile = await (await fetch(base + query + '&profileOnly=true')).json();
    assert.equal(profile.page, 0);
    assert.equal(profile.matchesLoaded, false);
    assert.deepEqual(profile.matches, []);
    const flex = await (await fetch(base + query + '&queue=440')).json();
    assert.equal(flex.matches.length, 1);
    assert.equal(flex.matches[0].queueId, 440);
    assert.equal(riot.calls.length, count);
  });
});

test('KR profile failures are stored as warnings without losing the account or saved games', async () => {
  await withServer(fakeRiot({ failAt: '/summoners/', failStatus: 503 }), async (base) => {
    const response = await fetch(base + refreshQuery);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.profileIconId, null);
    assert.ok(data.warnings.length);
    assert.equal(data.matches.length, 1);
  });
});

test('autocomplete validates input and exposes at most 20 stored Riot IDs', async () => {
  const database = createMemoryDatabase();
  for (let index = 0; index < 25; index++)
    database.players.set(String(index), {
      puuid: String(index),
      gameName: '테스트' + index,
      tagLine: 'KR1',
    });
  await withServer({ database }, async (base) => {
    assert.equal((await fetch(base + '/api/summoners/suggest?keyword=')).status, 400);
    assert.equal(
      (await fetch(base + '/api/summoners/suggest?keyword=' + 'x'.repeat(101))).status,
      400,
    );
    const response = await fetch(
      base + '/api/summoners/suggest?keyword=' + encodeURIComponent('테스트'),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 20);
  });
});

test('asset metadata maps Korean champions, items, spells and runes', async () => {
  await withServer(fakeRiot(), async (base) => {
    const response = await fetch(base + '/api/assets');
    const data = await response.json();
    assert.equal(data.champions['117'].name, '룰루');
    assert.ok(data.champions['9'].centered.endsWith('FiddleSticks_0.jpg'));
    assert.equal(data.spells['4'].name, '점멸');
    assert.equal(data.runes['8214'].name, '콩콩이 소환');
    assert.equal(data.items['1001'].name, '장화');
  });
});

test('missing key gives a setup error and API files remain private', async () => {
  await withServer({ apiKey: '' }, async (base) => {
    assert.equal((await (await fetch(base + query)).json()).code, 'API_KEY_MISSING');
    for (const path of ['/.env', '/server/app.js', '/index.html'])
      assert.equal((await fetch(base + path)).status, 404);
  });
});
