// 실제 DB를 읽기만 하며, 집계 SQL을 별도 계산과 비교합니다.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const assert = require('node:assert/strict');
const oracledb = require('oracledb');
const { withConnection } = require('../server/connection');
const { getChampionRecommendations, koreanDay } = require('../server/recommendations');

async function verify() {
  const now = Date.now();
  const result = await getChampionRecommendations(now);
  const { dayStart, dayEnd } = koreanDay(now);
  const rows = await withConnection(
    async (connection) =>
      (
        await connection.execute(
          `SELECT m.MATCH_ID, p.CHAMPION_ID, p.POSITION_NAME, p.WIN
     FROM LOL_MATCHES m JOIN LOL_MATCH_PARTICIPANTS p ON p.MATCH_ID = m.MATCH_ID
     WHERE m.DETAIL_COMPLETE = 1 AND m.REMAKE = 0 AND m.MAP_ID = 11
       AND m.QUEUE_ID IN (420, 440) AND p.CHAMPION_ID > 0
       AND m.STORED_AT >= TO_TIMESTAMP(:dayStart, 'YYYY-MM-DD HH24:MI:SS')
       AND m.STORED_AT < TO_TIMESTAMP(:dayEnd, 'YYYY-MM-DD HH24:MI:SS')`,
          { dayStart, dayEnd },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        )
      ).rows,
  );

  for (const [scope, group] of Object.entries(result.groups)) {
    const selected = scope === 'all' ? rows : rows.filter((row) => row.POSITION_NAME === scope);
    assert.equal(group.sampleMatches, new Set(selected.map((row) => row.MATCH_ID)).size);
    assert.equal(group.samplePicks, selected.length);
    const totals = new Map();
    for (const row of selected) {
      const current = totals.get(row.CHAMPION_ID) || {
        championId: row.CHAMPION_ID,
        picks: 0,
        wins: 0,
      };
      current.picks++;
      current.wins += row.WIN;
      totals.set(row.CHAMPION_ID, current);
    }
    const expected = [...totals.values()]
      .sort((a, b) => b.picks - a.picks || b.wins - a.wins || a.championId - b.championId)
      .slice(0, 7);
    assert.deepEqual(
      group.champions.map((champion) => champion.championId),
      expected.map((champion) => champion.championId),
    );
    group.champions.forEach((champion, index) => {
      assert.equal(champion.pickCount, expected[index].picks);
      assert.equal(champion.wins, expected[index].wins);
      assert.ok(
        Math.abs(champion.pickRate - (expected[index].picks / selected.length) * 100) < 1e-8,
      );
      assert.ok(
        Math.abs(champion.winRate - (expected[index].wins / expected[index].picks) * 100) < 1e-8,
      );
    });
    console.log(
      `${scope}: ${group.sampleMatches} games, ${group.samplePicks} picks, top ${group.champions.length} verified.`,
    );
  }
  console.log(
    `Collection date: ${result.date} (Asia/Seoul). All totals, rankings and rates verified.`,
  );
}

verify().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
