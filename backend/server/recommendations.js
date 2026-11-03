const oracledb = require('oracledb');
const { withConnection } = require('./connection');

const SCOPES = ['all', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

function koreanDay(currentTime) {
  const offset = 9 * 3600000;
  const startTime = Math.floor((currentTime + offset) / 86400000) * 86400000 - offset;
  const nextUpdateAt = startTime + 86400000;
  const date = new Date(startTime + offset).toISOString().slice(0, 10);
  const nextDate = new Date(nextUpdateAt + offset).toISOString().slice(0, 10);
  return {
    date,
    startTime,
    nextUpdateAt,
    dayStart: `${date} 00:00:00`,
    dayEnd: `${nextDate} 00:00:00`,
  };
}

async function getChampionRecommendations(currentTime = Date.now()) {
  const groups = Object.fromEntries(
    SCOPES.map((scope) => [
      scope,
      {
        sampleMatches: 0,
        samplePicks: 0,
        champions: [],
      },
    ]),
  );
  const { date, startTime, nextUpdateAt, dayStart, dayEnd } = koreanDay(currentTime);
  const rows = await withConnection(async (connection) => {
    const result = await connection.execute(
      `WITH eligible AS (
         SELECT m.MATCH_ID, p.CHAMPION_ID, p.CHAMPION_NAME, p.POSITION_NAME, p.WIN
         FROM LOL_MATCHES m
         JOIN LOL_MATCH_PARTICIPANTS p ON p.MATCH_ID = m.MATCH_ID
         WHERE m.DETAIL_COMPLETE = 1 AND m.REMAKE = 0 AND m.MAP_ID = 11
           AND m.QUEUE_ID IN (420, 440) AND p.CHAMPION_ID > 0
           AND m.STORED_AT >= TO_TIMESTAMP(:dayStart, 'YYYY-MM-DD HH24:MI:SS')
           AND m.STORED_AT < TO_TIMESTAMP(:dayEnd, 'YYYY-MM-DD HH24:MI:SS')
       ), scoped AS (
         SELECT 'all' AS SCOPE_NAME, e.* FROM eligible e
         UNION ALL
         SELECT e.POSITION_NAME AS SCOPE_NAME, e.* FROM eligible e
         WHERE e.POSITION_NAME IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
       ), totals AS (
         SELECT SCOPE_NAME, COUNT(DISTINCT MATCH_ID) AS SAMPLE_MATCHES, COUNT(*) AS SAMPLE_PICKS
         FROM scoped GROUP BY SCOPE_NAME
       ), champions AS (
         SELECT SCOPE_NAME, CHAMPION_ID, MAX(CHAMPION_NAME) AS CHAMPION_NAME,
                COUNT(*) AS PICK_COUNT, SUM(WIN) AS WINS
         FROM scoped GROUP BY SCOPE_NAME, CHAMPION_ID
       ), ranked AS (
         SELECT c.*, t.SAMPLE_MATCHES, t.SAMPLE_PICKS,
                100 * c.PICK_COUNT / t.SAMPLE_PICKS AS PICK_RATE,
                100 * c.WINS / c.PICK_COUNT AS WIN_RATE,
                ROW_NUMBER() OVER (
                  PARTITION BY c.SCOPE_NAME ORDER BY c.PICK_COUNT DESC, c.WINS DESC, c.CHAMPION_ID
                ) AS PICK_ORDER
         FROM champions c JOIN totals t ON t.SCOPE_NAME = c.SCOPE_NAME
       )
       SELECT * FROM ranked WHERE PICK_ORDER <= 7 ORDER BY SCOPE_NAME, PICK_ORDER`,
      { dayStart, dayEnd },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows;
  });

  for (const row of rows) {
    const group = groups[row.SCOPE_NAME];
    if (!group) continue;
    group.sampleMatches = row.SAMPLE_MATCHES;
    group.samplePicks = row.SAMPLE_PICKS;
    group.champions.push({
      championId: row.CHAMPION_ID,
      champion: row.CHAMPION_NAME,
      pickCount: row.PICK_COUNT,
      wins: row.WINS,
      pickRate: row.PICK_RATE,
      winRate: row.WIN_RATE,
    });
  }

  return { date, timeZone: 'Asia/Seoul', startTime, nextUpdateAt, updatedAt: currentTime, groups };
}

module.exports = { getChampionRecommendations, koreanDay };
