// 명시적으로 실행할 때만 실제 Riot API를 조회하고 실제 계정의 전적을 저장합니다.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const oracledb = require('oracledb');
const { withConnection } = require('../server/connection');
const { createApp } = require('../server/app');

async function verify() {
  const source = await withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT s.GAME_NAME, s.TAG_LINE FROM SUMMONERS s
       JOIN LOL_MATCH_PARTICIPANTS p ON p.PUUID = s.PUUID
       GROUP BY s.ID, s.GAME_NAME, s.TAG_LINE ORDER BY COUNT(*) DESC, s.ID
       FETCH FIRST 1 ROW ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    if (!result.rows.length)
      throw new Error('저장된 계정이 없습니다. 먼저 실제 계정으로 검색해 주세요.');
    return result.rows[0];
  });
  let upstream = 0,
    details = 0;
  const fetchImpl = async (url, options) => {
    upstream++;
    if (/\/matches\/[^/]+$/.test(new URL(url).pathname)) details++;
    if (upstream % 10 === 0) console.log(`Riot requests: ${upstream}, match details: ${details}`);
    try {
      const response = await fetch(url, options);
      if (!response.ok) console.error('Riot HTTP status:', response.status);
      return response;
    } catch (error) {
      console.error('Riot network error:', error.cause?.code || error.name);
      throw error;
    }
  };
  const server = createApp({ apiKey: process.env.RIOT_API_KEY, fetchImpl }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const params = new URLSearchParams({ gameName: source.GAME_NAME, tagLine: source.TAG_LINE });
  try {
    const before = await fetch(`${base}/api/summoner?${params}`);
    if (!before.ok || upstream !== 0) throw new Error('DB-only initial lookup failed');
    console.log('Initial lookup: DB only, zero Riot requests.');
    if (!process.argv.includes('--refresh')) return;
    const response = await fetch(`${base}/api/summoner?${params}&refresh=true`);
    const data = await response.json();
    if (!response.ok) throw new Error(`Live refresh: HTTP ${response.status}, ${data.code}`);
    if (!data.matchesLoaded || !data.historyComplete)
      throw new Error('Refresh not marked complete');
    console.log(
      `Refresh committed and reread: ${data.matches.length} games on page 1; detail requests: ${details}.`,
    );
    const calls = upstream;
    const again = await (await fetch(`${base}/api/summoner?${params}`)).json();
    if (upstream !== calls || again.matches.length !== data.matches.length)
      throw new Error('DB reread failed');
    console.log('Return visit: DB only, zero additional Riot requests.');
    const teammate = data.matches
      .flatMap((match) => match.participants)
      .find((player) => player.puuid && player.tagLine && player.name !== data.gameName);
    if (teammate) {
      const teamParams = new URLSearchParams({
        gameName: teammate.name,
        tagLine: teammate.tagLine,
      });
      const team = await (await fetch(`${base}/api/summoner?${teamParams}`)).json();
      if (!team.matches?.length || upstream !== calls)
        throw new Error('Shared participant history failed');
      console.log(
        `Other participant: ${team.matches.length} shared stored games, zero additional Riot requests.`,
      );
    }
    const detailsBeforeRepeat = details;
    const repeatedResponse = await fetch(`${base}/api/summoner?${params}&refresh=true`);
    const repeated = await repeatedResponse.json();
    if (!repeatedResponse.ok || !repeated.matchesLoaded) throw new Error('Repeated refresh failed');
    console.log(
      `Second refresh: additional match-detail requests ${details - detailsBeforeRepeat}.`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
