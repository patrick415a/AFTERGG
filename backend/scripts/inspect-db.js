const path = require('node:path');
const oracledb = require('oracledb');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function inspect() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
      connectTimeout: 10,
      transportConnectTimeout: 5,
    });
    connection.callTimeout = 10000;
    console.log('Oracle version:', connection.oracleServerVersionString);
    const result = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH
       FROM USER_TAB_COLUMNS
       WHERE TABLE_NAME IN ('SUMMONERS', 'SUMMONER_MATCH_CACHE', 'AFTERGG_MIGRATIONS')
       ORDER BY TABLE_NAME, COLUMN_ID`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    console.table(result.rows);
    const counts = await connection.execute(
      `SELECT (SELECT COUNT(*) FROM SUMMONERS) AS SUMMONERS,
              (SELECT COUNT(*) FROM SUMMONER_MATCH_CACHE) AS LEGACY_CACHES
       FROM DUAL`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    console.table(counts.rows);
  } finally {
    if (connection) await connection.close();
  }
}

inspect().catch((error) => {
  console.error('DB inspection failed:', error.code || error.errorNum || error.name);
  process.exitCode = 1;
});
