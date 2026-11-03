const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const oracledb = require('oracledb');
const { withConnection } = require('../server/connection');

withConnection(async (connection) => {
  for (const table of [
    'SUMMONERS',
    'SUMMONER_MATCH_CACHE',
    'SUMMONER_RANKS',
    'SUMMONER_SYNC',
    'LOL_MATCHES',
    'LOL_MATCH_PARTICIPANTS',
    'LOL_PARTICIPANT_ITEMS',
  ]) {
    const count = await connection.execute(`SELECT COUNT(*) AS ROW_COUNT FROM ${table}`);
    console.log(`${table}: ${count.rows[0][0]}`);
  }
  const integrity = await connection.execute(
    `
    SELECT
      (SELECT COUNT(*) FROM LOL_MATCHES WHERE DETAIL_COMPLETE = 1) AS COMPLETE_MATCHES,
      (SELECT COUNT(*) FROM LOL_MATCHES WHERE DETAIL_COMPLETE = 0) AS LEGACY_MATCHES,
      (SELECT COUNT(*) FROM LOL_MATCH_PARTICIPANTS WHERE PUUID IS NOT NULL) AS LINKED_PLAYERS
    FROM DUAL`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.table(integrity.rows);
}).catch((error) => {
  console.error('DB status failed:', error.code || error.errorNum || error.name);
  process.exitCode = 1;
});
