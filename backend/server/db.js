const oracledb = require('oracledb');
const { withConnection } = require('./connection');
const { projectMatch } = require('./matches');
const { getChampionRecommendations } = require('./recommendations');

const resultOptions = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const number = { type: oracledb.NUMBER };
const text = (maxSize) => ({ type: oracledb.STRING, maxSize });
const matchFields = {
  MATCH_ID: text(64),
  QUEUE_ID: number,
  GAME_VERSION: text(40),
  PATCH_VERSION: text(20),
  MAP_ID: number,
  STARTED_AT: number,
  PLAYED_AT: number,
  DURATION_SECONDS: number,
  REMAKE: number,
  DETAIL_COMPLETE: number,
};
const participantFields = {
  MATCH_ID: text(64),
  PARTICIPANT_ID: number,
  PUUID: text(100),
  GAME_NAME: text(400),
  TAG_LINE: text(80),
  CHAMPION_ID: number,
  CHAMPION_NAME: text(60),
  CHAMPION_LEVEL: number,
  TEAM_ID: number,
  WIN: number,
  KILLS: number,
  DEATHS: number,
  ASSISTS: number,
  CS: number,
  DAMAGE: number,
  TAKEN: number,
  GOLD: number,
  KILL_PARTICIPATION: number,
  POSITION_NAME: text(20),
  SPELL1_ID: number,
  SPELL2_ID: number,
  KEYSTONE_ID: number,
  SECONDARY_RUNE_ID: number,
  ROLE_ITEM_ID: number,
};
const itemFields = { MATCH_ID: text(64), PARTICIPANT_ID: number, SLOT_NO: number, ITEM_ID: number };

// SQL identifiers are fixed internal constants. User values always use binds.
async function mergeRows(connection, table, keys, fields, rows, { insertOnly = false } = {}) {
  if (!rows.length) return;
  const columns = Object.keys(fields);
  const values = columns.map((column) => `src.${column}`).join(', ');
  const updates = columns
    .filter((column) => !keys.includes(column))
    .map(
      (column) =>
        `target.${column} = ${column === 'PUUID' ? `COALESCE(src.${column}, target.${column})` : `src.${column}`}`,
    );
  // 기존 JSON의 상세를 처음 완성한 날부터 통계 표본으로 사용합니다.
  // 완성된 경기는 toWrite에서 제외되므로 재갱신으로 수집일이 바뀌지 않습니다.
  if (table === 'LOL_MATCHES') updates.push('target.STORED_AT = CURRENT_TIMESTAMP');
  const sql = `MERGE INTO ${table} target
    USING (SELECT ${columns.map((column) => `:${column} AS ${column}`).join(', ')} FROM DUAL) src
    ON (${keys.map((column) => `target.${column} = src.${column}`).join(' AND ')})
    ${insertOnly ? '' : `WHEN MATCHED THEN UPDATE SET ${updates.join(', ')}`}
    WHEN NOT MATCHED THEN INSERT (${columns.join(', ')}) VALUES (${values})`;
  await connection.executeMany(sql, rows, { bindDefs: fields });
}

async function selectByIds(connection, table, ids, extraWhere = '') {
  const unique = [...new Set(ids)];
  const rows = [];
  for (let start = 0; start < unique.length; start += 900) {
    const batch = unique.slice(start, start + 900);
    const binds = Object.fromEntries(batch.map((id, index) => [`id${index}`, id]));
    const result = await connection.execute(
      `SELECT * FROM ${table} WHERE MATCH_ID IN (${Object.keys(binds)
        .map((key) => `:${key}`)
        .join(', ')}) ${extraWhere}`,
      binds,
      resultOptions,
    );
    rows.push(...result.rows);
  }
  return rows;
}

async function readMatches(connection, matchRows) {
  if (!matchRows.length) return [];
  const ids = matchRows.map((row) => row.MATCH_ID);
  const players = await selectByIds(connection, 'LOL_MATCH_PARTICIPANTS', ids);
  const items = await selectByIds(connection, 'LOL_PARTICIPANT_ITEMS', ids);
  const itemMap = new Map();
  for (const item of items) {
    const key = `${item.MATCH_ID}:${item.PARTICIPANT_ID}`;
    if (!itemMap.has(key)) itemMap.set(key, []);
    itemMap.get(key)[item.SLOT_NO] = item.ITEM_ID;
  }
  const playerMap = new Map();
  for (const row of players.sort((a, b) => a.PARTICIPANT_ID - b.PARTICIPANT_ID)) {
    const slots = itemMap.get(`${row.MATCH_ID}:${row.PARTICIPANT_ID}`) || [];
    const player = {
      participantId: row.PARTICIPANT_ID,
      puuid: row.PUUID,
      name: row.GAME_NAME,
      tagLine: row.TAG_LINE || '',
      champion: row.CHAMPION_NAME,
      championId: row.CHAMPION_ID,
      level: row.CHAMPION_LEVEL,
      teamId: row.TEAM_ID,
      win: row.WIN === 1,
      kills: row.KILLS,
      deaths: row.DEATHS,
      assists: row.ASSISTS,
      cs: row.CS,
      damage: row.DAMAGE,
      taken: row.TAKEN,
      gold: row.GOLD,
      killParticipation: row.KILL_PARTICIPATION,
      position: row.POSITION_NAME,
      roleItemId: row.ROLE_ITEM_ID,
      items: Array.from(
        { length: ['BOTTOM', 'UTILITY'].includes(row.POSITION_NAME) ? 8 : 7 },
        (_, i) => slots[i] || 0,
      ),
      spells: [row.SPELL1_ID, row.SPELL2_ID],
      runes: [row.KEYSTONE_ID, row.SECONDARY_RUNE_ID],
    };
    if (!playerMap.has(row.MATCH_ID)) playerMap.set(row.MATCH_ID, []);
    playerMap.get(row.MATCH_ID).push(player);
  }
  return matchRows.map((row) => ({
    matchId: row.MATCH_ID,
    queueId: row.QUEUE_ID,
    gameVersion: row.GAME_VERSION,
    patchVersion: row.PATCH_VERSION,
    mapId: row.MAP_ID,
    startedAt: row.STARTED_AT,
    playedAt: row.PLAYED_AT,
    durationSeconds: row.DURATION_SECONDS,
    duration: Math.floor(row.DURATION_SECONDS / 60),
    remake: row.REMAKE === 1,
    detailComplete: row.DETAIL_COMPLETE === 1,
    participants: playerMap.get(row.MATCH_ID) || [],
  }));
}

async function getStoredMatchesByIds(ids) {
  if (!ids.length) return [];
  return withConnection(async (connection) =>
    readMatches(
      connection,
      await selectByIds(connection, 'LOL_MATCHES', ids, 'AND DETAIL_COMPLETE = 1'),
    ),
  );
}

async function getSummoner(
  gameName,
  tagLine,
  { page = 1, pageSize = 30, anchor, queue = 'all', profileOnly = false } = {},
) {
  return withConnection(async (connection) => {
    const found = await connection.execute(
      `SELECT s.*, sync.PROFILE_UPDATED_AT, sync.LAST_REFRESH_AT, sync.HISTORY_COMPLETE, sync.PROFILE_WARNINGS
       FROM SUMMONERS s LEFT JOIN SUMMONER_SYNC sync ON s.PUUID = sync.PUUID
       WHERE LOWER(s.GAME_NAME) = LOWER(:gameName) AND LOWER(s.TAG_LINE) = LOWER(:tagLine)
       ORDER BY sync.PROFILE_UPDATED_AT DESC NULLS LAST, s.ID
       FETCH FIRST 1 ROW ONLY`,
      { gameName, tagLine },
      resultOptions,
    );
    if (!found.rows.length) return null;
    const row = found.rows[0];
    const ranks = await connection.execute(
      'SELECT * FROM SUMMONER_RANKS WHERE PUUID = :puuid',
      { puuid: row.PUUID },
      resultOptions,
    );
    const rank = (queueType) => {
      const entry = ranks.rows.find((rankRow) => rankRow.QUEUE_TYPE === queueType);
      return entry
        ? {
            queueType,
            tier: entry.TIER,
            rank: entry.RANK_DIVISION,
            leaguePoints: entry.LEAGUE_POINTS,
            wins: entry.WINS,
            losses: entry.LOSSES,
          }
        : null;
    };
    const selected = profileOnly
      ? []
      : (
          await connection.execute(
            `SELECT m.* FROM LOL_MATCHES m
       JOIN LOL_MATCH_PARTICIPANTS p ON p.MATCH_ID = m.MATCH_ID
       WHERE p.PUUID = :puuid AND m.QUEUE_ID IN (420, 440)
         AND (:queue = 'all' OR m.QUEUE_ID = TO_NUMBER(NULLIF(:queue, 'all')))
         AND m.STARTED_AT >= :startTime AND m.STARTED_AT <= :endTime
       ORDER BY m.PLAYED_AT DESC, m.MATCH_ID DESC
       OFFSET :offset ROWS FETCH NEXT :rowCount ROWS ONLY`,
            {
              puuid: row.PUUID,
              queue,
              startTime: (anchor - 30 * 86400) * 1000,
              endTime: anchor * 1000,
              offset: (page - 1) * pageSize,
              rowCount: pageSize + 1,
            },
            resultOptions,
          )
        ).rows;
    const matches = (await readMatches(connection, selected.slice(0, pageSize)))
      .map((match) => projectMatch(match, row.PUUID))
      .filter(Boolean);
    const warnings = row.PROFILE_WARNINGS ? row.PROFILE_WARNINGS.split('\n') : [];
    if (!row.PROFILE_UPDATED_AT)
      warnings.push(
        '경기에서 확인한 플레이어입니다. 프로필과 랭크는 전적 갱신 후 확인할 수 있습니다.',
      );
    if (!profileOnly && row.HISTORY_COMPLETE !== 1 && matches.length)
      warnings.push(
        '현재 확보된 일부 경기만 표시합니다. 전적 갱신으로 최근 30일 기록을 불러올 수 있습니다.',
      );
    return {
      gameName: row.GAME_NAME,
      tagLine: row.TAG_LINE,
      profileIconId: row.PROFILE_ICON_ID,
      summonerLevel: row.SUMMONER_LEVEL,
      profileLoaded: Boolean(row.PROFILE_UPDATED_AT),
      solo: rank('RANKED_SOLO_5x5'),
      flex: rank('RANKED_FLEX_SR'),
      page: profileOnly ? 0 : page,
      pageSize,
      queue,
      anchor,
      periodDays: 30,
      matches,
      matchesLoaded: !profileOnly && (Boolean(row.LAST_REFRESH_AT) || selected.length > 0),
      historyComplete: row.HISTORY_COMPLETE === 1,
      hasMore: !profileOnly && selected.length > pageSize,
      updatedAt: row.LAST_REFRESH_AT ? row.LAST_REFRESH_AT.getTime() : null,
      warnings,
    };
  });
}

async function writeProfile(connection, { account, profile, ranks, updatedAt, warnings }) {
  const solo = ranks?.find((rank) => rank.queueType === 'RANKED_SOLO_5x5');
  await connection.execute(
    `MERGE INTO SUMMONERS s USING (
       SELECT :puuid AS PUUID, :gameName AS GAME_NAME, :tagLine AS TAG_LINE FROM DUAL
     ) src ON (s.PUUID = src.PUUID)
     WHEN MATCHED THEN UPDATE SET
       s.GAME_NAME = src.GAME_NAME, s.TAG_LINE = src.TAG_LINE,
       s.PROFILE_ICON_ID = COALESCE(:icon, s.PROFILE_ICON_ID),
       s.SUMMONER_LEVEL = COALESCE(:summonerLevel, s.SUMMONER_LEVEL),
       s.TIER = CASE WHEN :ranksLoaded = 1 THEN :tier ELSE s.TIER END,
       s.RANK_DIVISION = CASE WHEN :ranksLoaded = 1 THEN :division ELSE s.RANK_DIVISION END,
       s.UPDATED_AT = :updatedAt
     WHEN NOT MATCHED THEN INSERT
       (PUUID, GAME_NAME, TAG_LINE, PROFILE_ICON_ID, SUMMONER_LEVEL, TIER, RANK_DIVISION, UPDATED_AT)
       VALUES (src.PUUID, src.GAME_NAME, src.TAG_LINE, :icon, :summonerLevel, :tier, :division, :updatedAt)`,
    {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      icon: profile?.profileIconId ?? null,
      summonerLevel: profile?.summonerLevel ?? null,
      ranksLoaded: Array.isArray(ranks) ? 1 : 0,
      tier: solo?.tier ?? null,
      division: solo?.rank ?? null,
      updatedAt,
    },
  );
  if (Array.isArray(ranks)) {
    await connection.execute('DELETE FROM SUMMONER_RANKS WHERE PUUID = :puuid', {
      puuid: account.puuid,
    });
    const fields = {
      PUUID: text(100),
      QUEUE_TYPE: text(40),
      TIER: text(30),
      RANK_DIVISION: text(10),
      LEAGUE_POINTS: number,
      WINS: number,
      LOSSES: number,
    };
    await mergeRows(
      connection,
      'SUMMONER_RANKS',
      ['PUUID', 'QUEUE_TYPE'],
      fields,
      ranks
        .filter((rank) => ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'].includes(rank.queueType))
        .map((rank) => ({
          PUUID: account.puuid,
          QUEUE_TYPE: rank.queueType,
          TIER: rank.tier,
          RANK_DIVISION: rank.rank,
          LEAGUE_POINTS: rank.leaguePoints || 0,
          WINS: rank.wins || 0,
          LOSSES: rank.losses || 0,
        })),
    );
  }
  return warnings.join('\n') || null;
}

// 한 서버에서 겹치는 경기의 저장을 직렬화합니다. 전체 저장은 한 트랜잭션입니다.
let writeQueue = Promise.resolve();
function saveSummonerData(input) {
  const operation = writeQueue.then(() =>
    withConnection(async (connection) => {
      try {
        const {
          account,
          profile,
          ranks,
          matches = [],
          refresh = false,
          historyComplete = true,
          anchor,
          now = Date.now(),
          warnings = [],
        } = input;
        const updatedAt = new Date(now);
        const profileWarnings = await writeProfile(connection, {
          account,
          profile,
          ranks,
          updatedAt,
          warnings,
        });
        const existing = new Map(
          (
            await selectByIds(
              connection,
              'LOL_MATCHES',
              matches.map((match) => match.matchId),
            )
          ).map((row) => [row.MATCH_ID, row.DETAIL_COMPLETE]),
        );
        const toWrite = [...new Map(matches.map((match) => [match.matchId, match])).values()]
          .filter((match) => existing.get(match.matchId) !== 1)
          .sort((a, b) => a.matchId.localeCompare(b.matchId));
        const identities = new Map();
        for (const match of toWrite)
          for (const player of match.participants) {
            if (player.puuid && player.name && player.tagLine)
              identities.set(player.puuid, {
                PUUID: player.puuid,
                GAME_NAME: player.name,
                TAG_LINE: player.tagLine,
              });
          }
        await mergeRows(
          connection,
          'SUMMONERS',
          ['PUUID'],
          {
            PUUID: text(100),
            GAME_NAME: text(400),
            TAG_LINE: text(80),
          },
          [...identities.values()].sort((a, b) => a.PUUID.localeCompare(b.PUUID)),
          { insertOnly: true },
        );
        for (const match of toWrite) {
          if (existing.has(match.matchId) && match.detailComplete) {
            // 이전 JSON에서 옮긴 불완전한 참가자만 새 원본으로 교체합니다.
            await connection.execute(
              'DELETE FROM LOL_MATCH_PARTICIPANTS WHERE MATCH_ID = :matchId',
              { matchId: match.matchId },
            );
          }
        }
        await mergeRows(
          connection,
          'LOL_MATCHES',
          ['MATCH_ID'],
          matchFields,
          toWrite.map((match) => ({
            MATCH_ID: match.matchId,
            QUEUE_ID: match.queueId,
            GAME_VERSION: match.gameVersion,
            PATCH_VERSION: match.patchVersion,
            MAP_ID: match.mapId,
            STARTED_AT: match.startedAt,
            PLAYED_AT: match.playedAt,
            DURATION_SECONDS: match.durationSeconds,
            REMAKE: match.remake ? 1 : 0,
            DETAIL_COMPLETE: match.detailComplete ? 1 : 0,
          })),
        );
        const players = [],
          items = [];
        for (const match of toWrite)
          for (const player of match.participants) {
            players.push({
              MATCH_ID: match.matchId,
              PARTICIPANT_ID: player.participantId,
              PUUID: player.puuid || null,
              GAME_NAME: player.name,
              TAG_LINE: player.tagLine || null,
              CHAMPION_ID: player.championId,
              CHAMPION_NAME: player.champion,
              CHAMPION_LEVEL: player.level,
              TEAM_ID: player.teamId,
              WIN: player.win ? 1 : 0,
              KILLS: player.kills,
              DEATHS: player.deaths,
              ASSISTS: player.assists,
              CS: player.cs,
              DAMAGE: player.damage,
              TAKEN: player.taken,
              GOLD: player.gold || 0,
              KILL_PARTICIPATION: player.killParticipation,
              POSITION_NAME: player.position,
              SPELL1_ID: player.spells[0],
              SPELL2_ID: player.spells[1],
              KEYSTONE_ID: player.runes[0],
              SECONDARY_RUNE_ID: player.runes[1],
              ROLE_ITEM_ID: player.roleItemId || 0,
            });
            player.items.forEach((itemId, slot) =>
              items.push({
                MATCH_ID: match.matchId,
                PARTICIPANT_ID: player.participantId,
                SLOT_NO: slot,
                ITEM_ID: itemId,
              }),
            );
          }
        await mergeRows(
          connection,
          'LOL_MATCH_PARTICIPANTS',
          ['MATCH_ID', 'PARTICIPANT_ID'],
          participantFields,
          players,
        );
        await mergeRows(
          connection,
          'LOL_PARTICIPANT_ITEMS',
          ['MATCH_ID', 'PARTICIPANT_ID', 'SLOT_NO'],
          itemFields,
          items,
        );
        await connection.execute(
          `MERGE INTO SUMMONER_SYNC s USING (SELECT :puuid AS PUUID FROM DUAL) src ON (s.PUUID = src.PUUID)
         WHEN MATCHED THEN UPDATE SET s.PROFILE_UPDATED_AT = :updatedAt, s.PROFILE_WARNINGS = :warnings,
           s.LAST_REFRESH_AT = CASE WHEN :refresh = 1 THEN :updatedAt ELSE s.LAST_REFRESH_AT END,
           s.REFRESH_ANCHOR = CASE WHEN :refresh = 1 THEN :anchor ELSE s.REFRESH_ANCHOR END,
           s.HISTORY_COMPLETE = CASE WHEN :refresh = 1 THEN :complete ELSE s.HISTORY_COMPLETE END
         WHEN NOT MATCHED THEN INSERT (PUUID, PROFILE_UPDATED_AT, PROFILE_WARNINGS, LAST_REFRESH_AT, REFRESH_ANCHOR, HISTORY_COMPLETE)
         VALUES (src.PUUID, :updatedAt, :warnings, CASE WHEN :refresh = 1 THEN :updatedAt END,
           CASE WHEN :refresh = 1 THEN :anchor END, CASE WHEN :refresh = 1 THEN :complete ELSE 0 END)`,
          {
            puuid: account.puuid,
            updatedAt,
            warnings: profileWarnings,
            refresh: refresh ? 1 : 0,
            anchor: anchor ?? null,
            complete: historyComplete ? 1 : 0,
          },
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }),
  );
  writeQueue = operation.catch(() => {});
  return operation;
}

async function searchSummoners(keyword) {
  return withConnection(async (connection) => {
    const result = await connection.execute(
      `SELECT GAME_NAME, TAG_LINE FROM SUMMONERS
       WHERE INSTR(LOWER(GAME_NAME), LOWER(:keyword)) > 0
       ORDER BY CASE WHEN LOWER(GAME_NAME) = LOWER(:keyword) THEN 0 ELSE 1 END, GAME_NAME, TAG_LINE
       FETCH FIRST 20 ROWS ONLY`,
      { keyword },
      resultOptions,
    );
    return result.rows.map((row) => ({ gameName: row.GAME_NAME, tagLine: row.TAG_LINE }));
  });
}

module.exports = {
  getSummoner,
  getStoredMatchesByIds,
  saveSummonerData,
  searchSummoners,
  getChampionRecommendations,
};
