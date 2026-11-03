const { test } = require('node:test');
const assert = require('node:assert/strict');
const oracledb = require('oracledb');
const { koreanDay, getChampionRecommendations } = require('../server/recommendations');
const { createApp } = require('../server/app');

test('daily recommendations switch at Korean midnight, including year boundaries', () => {
  const before = koreanDay(Date.parse('2026-11-02T14:59:59.999Z'));
  assert.equal(before.date, '2026-11-02');
  assert.equal(before.startTime, Date.parse('2026-11-01T15:00:00Z'));
  assert.equal(before.nextUpdateAt, Date.parse('2026-11-02T15:00:00Z'));
  assert.equal(before.dayStart, '2026-11-02 00:00:00');
  assert.equal(before.dayEnd, '2026-11-03 00:00:00');
  assert.equal(koreanDay(before.nextUpdateAt).date, '2026-11-03');
  assert.equal(koreanDay(Date.parse('2026-12-31T15:00:00Z')).date, '2027-01-01');
});

function mockDatabase(t, rows) {
  const previous = {};
  for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_CONNECT_STRING']) {
    previous[key] = process.env[key];
    process.env[key] = 'test-only';
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const queries = [];
  let closed = false;
  t.mock.method(oracledb, 'getConnection', async () => ({
    execute: async (sql, binds) => {
      if (sql.startsWith('ALTER SESSION')) return {};
      queries.push({ sql, binds });
      return { rows };
    },
    close: async () => {
      closed = true;
    },
  }));
  return { queries, isClosed: () => closed };
}

test('recommendations retain distinct per-position sample denominators and empty groups', async (t) => {
  const database = mockDatabase(t, [
    {
      SCOPE_NAME: 'all',
      SAMPLE_MATCHES: 10,
      SAMPLE_PICKS: 100,
      CHAMPION_ID: 266,
      CHAMPION_NAME: 'Aatrox',
      PICK_COUNT: 8,
      WINS: 5,
      PICK_RATE: 8,
      WIN_RATE: 62.5,
    },
    {
      SCOPE_NAME: 'TOP',
      SAMPLE_MATCHES: 10,
      SAMPLE_PICKS: 20,
      CHAMPION_ID: 266,
      CHAMPION_NAME: 'Aatrox',
      PICK_COUNT: 8,
      WINS: 5,
      PICK_RATE: 40,
      WIN_RATE: 62.5,
    },
  ]);
  const result = await getChampionRecommendations(Date.parse('2026-11-02T01:00:00Z'));
  assert.equal(result.date, '2026-11-02');
  assert.equal(result.timeZone, 'Asia/Seoul');
  assert.equal(result.groups.all.samplePicks, 100);
  assert.equal(result.groups.TOP.samplePicks, 20);
  assert.equal(result.groups.all.champions[0].pickRate, 8);
  assert.equal(result.groups.TOP.champions[0].pickRate, 40);
  assert.deepEqual(result.groups.UTILITY, { sampleMatches: 0, samplePicks: 0, champions: [] });
  assert.deepEqual(database.queries[0].binds, {
    dayStart: '2026-11-02 00:00:00',
    dayEnd: '2026-11-03 00:00:00',
  });
  assert.ok(database.queries[0].sql.includes('m.STORED_AT'));
  assert.equal(database.isClosed(), true);
});

test('a new day with no collected games returns empty samples without yesterday fallback', async (t) => {
  mockDatabase(t, []);
  const result = await getChampionRecommendations(Date.parse('2026-11-02T15:00:00Z'));
  assert.equal(result.date, '2026-11-03');
  assert.ok(
    Object.values(result.groups).every(
      (group) => group.sampleMatches === 0 && !group.champions.length,
    ),
  );
});

async function withServer(database, callback) {
  const server = createApp({
    apiKey: '',
    database,
    now: () => Date.parse('2026-11-02T01:00:00Z'),
    fetchImpl: async () => {
      throw new Error('Recommendation endpoint must not call Riot or asset servers');
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('recommendation endpoint works with no Riot key and shares concurrent DB work', async () => {
  let calls = 0;
  await withServer(
    {
      getChampionRecommendations: async (now) => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { date: koreanDay(now).date, groups: { all: { champions: [] } } };
      },
    },
    async (base) => {
      const responses = await Promise.all([
        fetch(base + '/api/champion-recommendations'),
        fetch(base + '/api/champion-recommendations'),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status),
        [200, 200],
      );
      assert.equal(calls, 1);
      assert.equal(responses[0].headers.get('Cache-Control'), 'no-store');
      assert.equal((await responses[0].json()).date, '2026-11-02');
    },
  );
});

test('recommendation DB errors remain distinct from a valid empty sample', async () => {
  await withServer(
    {
      getChampionRecommendations: async () => {
        throw new Error('DB unavailable');
      },
    },
    async (base) => {
      const response = await fetch(base + '/api/champion-recommendations');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'RECOMMENDATIONS_UNAVAILABLE');
    },
  );
});
