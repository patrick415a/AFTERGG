const { test } = require('node:test');
const assert = require('node:assert/strict');
const oracledb = require('oracledb');
const { saveSummonerData, getStoredMatchesByIds } = require('../server/db');
const { normalizeStoredMatch, legacyMatches } = require('../server/matches');
const { match, stamp } = require('./helpers');

function mockConnection(
  t,
  { execute = async () => ({ rows: [] }), executeMany = async () => {} } = {},
) {
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
  const events = [];
  const connection = {
    execute,
    executeMany,
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    close: async () => events.push('close'),
  };
  t.mock.method(oracledb, 'getConnection', async () => connection);
  return { connection, events };
}
const input = () => ({
  account: { puuid: 'test-player', gameName: '테스트', tagLine: 'KR1' },
  profile: { summonerLevel: 100, profileIconId: 1 },
  ranks: [],
  matches: [normalizeStoredMatch(match('A'))],
  refresh: true,
  anchor: stamp / 1000,
  now: stamp,
});

test('refresh writes normalized matches, participants and item slots in one committed transaction', async (t) => {
  const batches = new Map();
  const database = mockConnection(t, {
    executeMany: async (sql, rows) => {
      batches.set(/MERGE INTO (\w+)/.exec(sql)[1], rows);
    },
  });
  await saveSummonerData(input());
  assert.equal(batches.get('LOL_MATCHES').length, 1);
  assert.equal(batches.get('LOL_MATCH_PARTICIPANTS').length, 3);
  assert.equal(batches.get('LOL_MATCH_PARTICIPANTS')[1].PUUID, 'other');
  assert.equal(batches.get('LOL_MATCH_PARTICIPANTS')[1].KILLS, 18);
  assert.equal(batches.get('LOL_PARTICIPANT_ITEMS').length, 24);
  assert.deepEqual(database.events, ['commit', 'close']);
  assert.equal(database.connection.callTimeout, 15000);
});

test('an item write failure rolls back the complete refresh and never commits', async (t) => {
  const database = mockConnection(t, {
    executeMany: async (sql) => {
      if (sql.includes('MERGE INTO LOL_PARTICIPANT_ITEMS ')) throw new Error('item write failed');
    },
  });
  await assert.rejects(saveSummonerData(input()), /item write failed/);
  assert.deepEqual(database.events, ['rollback', 'close']);
});

test('immutable complete matches are not inserted or counted again on another refresh', async (t) => {
  let matchWrites = 0;
  const database = mockConnection(t, {
    execute: async (sql) => ({
      rows: sql.includes('SELECT * FROM LOL_MATCHES')
        ? [{ MATCH_ID: 'A', DETAIL_COMPLETE: 1 }]
        : [],
    }),
    executeMany: async (sql) => {
      if (/MERGE INTO LOL_MATCH/.test(sql)) matchWrites++;
    },
  });
  await saveSummonerData(input());
  assert.equal(matchWrites, 0);
  assert.deepEqual(database.events, ['commit', 'close']);
});

test('stored details reconstruct all participants and ordered equipment from relational rows', async (t) => {
  const batches = new Map();
  let reading = false;
  mockConnection(t, {
    executeMany: async (sql, rows) => batches.set(/MERGE INTO (\w+)/.exec(sql)[1], rows),
    execute: async (sql) => {
      if (!reading) return { rows: [] };
      const table = /SELECT \* FROM (\w+)/.exec(sql)?.[1];
      return { rows: batches.get(table) || [] };
    },
  });
  await saveSummonerData(input());
  reading = true;
  const [stored] = await getStoredMatchesByIds(['A']);
  assert.equal(stored.matchId, 'A');
  assert.equal(stored.detailComplete, true);
  assert.equal(stored.participants.length, 3);
  assert.equal(stored.participants[1].puuid, 'other');
  assert.equal(stored.participants[0].items.length, 8);
  assert.equal(stored.participants[0].items[0], 1001);
  assert.deepEqual(stored.participants[0].runes, [8214, 8100]);
});

test('legacy import links only a single identifiable owner and keeps other missing identities null', () => {
  const { normalizeMatch } = require('../server/matches');
  const game = normalizeMatch(match('A'), 'test-player');
  const stripped = {
    ...game,
    participants: game.participants.map(({ puuid, ...player }) => player),
  };
  const [legacy] = legacyMatches({ matches: [stripped] }, 'test-player');
  assert.equal(legacy.participants[0].puuid, 'test-player');
  assert.equal(legacy.participants[1].puuid, null);
  assert.equal(legacy.detailComplete, false);
  assert.equal(legacy.patchVersion, 'unknown');
});
