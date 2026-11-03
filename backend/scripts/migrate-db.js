const path = require('node:path');
const oracledb = require('oracledb');
const { withConnection } = require('../server/connection');
const { saveSummonerData } = require('../server/db');
const { legacyMatches } = require('../server/matches');
const { readSchema, inspectSchema, objectExists } = require('./schema');

const version = '001-normalized-matches';
const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };

async function migrate({
  runConnection = withConnection,
  saveData = saveSummonerData,
  checkOnly = false,
  log = console.log,
} = {}) {
  const definitions = readSchema();
  await runConnection(async (connection) => {
    // 같은 이름의 다른 구조를 조용히 건너뛰지 않습니다. DDL 실행 전에 확인합니다.
    const inspection = await inspectSchema(connection, definitions);
    if (inspection.issues.length)
      throw new Error(`기존 DB 구조 확인이 필요합니다:\n${inspection.issues.join('\n')}`);
    if (checkOnly) {
      if (inspection.missing.length) {
        throw new Error(
          `미적용 항목: ${inspection.missing.map((item) => item.name).join(', ')}\nnpm run db:migrate를 실행해 주세요.`,
        );
      }
      const applied = await connection.execute(
        'SELECT VERSION FROM AFTERGG_MIGRATIONS WHERE VERSION = :version',
        { version },
      );
      if (!applied.rows.length)
        throw new Error(
          '테이블은 있지만 데이터 이전이 완료되지 않았습니다. npm run db:migrate를 실행해 주세요.',
        );
      log('DB schema check passed: 8 tables, 5 indexes and migration record verified.');
      return;
    }
    for (const definition of definitions) {
      const { kind, name, sql } = definition;
      if (name === 'UQ_LOL_MATCH_PLAYER') {
        const oldConstraint = await connection.execute(
          `SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS
           WHERE TABLE_NAME = 'LOL_MATCH_PARTICIPANTS' AND CONSTRAINT_NAME = :name AND CONSTRAINT_TYPE = 'U'`,
          { name },
        );
        if (oldConstraint.rows.length) {
          await connection.execute(
            'ALTER TABLE LOL_MATCH_PARTICIPANTS DROP CONSTRAINT UQ_LOL_MATCH_PLAYER',
          );
        }
      }
      if (await objectExists(connection, definition)) continue;
      await connection.execute(sql);
      log(`Created ${kind.toLowerCase()}: ${name}`);
    }
  });
  if (checkOnly) return;
  const pending = await runConnection(async (connection) => {
    const applied = await connection.execute(
      'SELECT VERSION FROM AFTERGG_MIGRATIONS WHERE VERSION = :version',
      { version },
    );
    if (applied.rows.length) return null;
    const snapshots = await connection.execute(
      `SELECT c.PUUID, c.MATCH_DATA, c.UPDATED_AT, s.GAME_NAME, s.TAG_LINE
       FROM SUMMONER_MATCH_CACHE c JOIN SUMMONERS s ON s.PUUID = c.PUUID`,
      {},
      { ...options, fetchInfo: { MATCH_DATA: { type: oracledb.STRING } } },
    );
    return snapshots.rows;
  });
  if (pending === null) {
    log('Migration already applied; legacy import skipped.');
    return;
  }
  let imported = 0;
  for (const row of pending) {
    const alreadyImported = await runConnection((connection) =>
      connection.execute('SELECT PUUID FROM SUMMONER_SYNC WHERE PUUID = :puuid', {
        puuid: row.PUUID,
      }),
    );
    if (alreadyImported.rows.length) continue;
    const data = JSON.parse(row.MATCH_DATA);
    const matches = legacyMatches(data, row.PUUID);
    await saveData({
      account: { puuid: row.PUUID, gameName: row.GAME_NAME, tagLine: row.TAG_LINE },
      profile: { profileIconId: data.profileIconId, summonerLevel: data.summonerLevel },
      ranks: [data.solo, data.flex].filter(Boolean),
      matches,
      refresh: true,
      historyComplete: false,
      anchor: data.anchor,
      now: row.UPDATED_AT.getTime(),
      warnings: data.warnings || [],
    });
    imported++;
  }
  await runConnection((connection) =>
    connection.execute(
      'INSERT INTO AFTERGG_MIGRATIONS (VERSION) VALUES (:version)',
      { version },
      { autoCommit: true },
    ),
  );
  log(`Migration applied. Legacy snapshots imported: ${imported}. Original JSON rows preserved.`);
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  migrate({ checkOnly: process.argv.includes('--check') }).catch((error) => {
    console.error('Migration failed:', error.code || error.errorNum || error.message);
    if (error.code || error.errorNum) console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrate };
