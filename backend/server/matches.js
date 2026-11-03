// Riot 응답과 DB 조회 결과가 같은 화면용 모델을 사용하도록 변환합니다.
function normalizeParticipant(player, teamKills = 0, participantId = 1) {
  return {
    participantId: player.participantId || participantId,
    puuid: player.puuid || null,
    name: player.riotIdGameName || player.summonerName || '이름 정보 없음',
    tagLine: player.riotIdTagline || '',
    champion: player.championName,
    championId: player.championId,
    level: player.champLevel,
    teamId: player.teamId,
    win: Boolean(player.win),
    kills: player.kills || 0,
    deaths: player.deaths || 0,
    assists: player.assists || 0,
    cs: (player.totalMinionsKilled || 0) + (player.neutralMinionsKilled || 0),
    damage: player.totalDamageDealtToChampions || 0,
    taken: player.totalDamageTaken || 0,
    gold: player.goldEarned || 0,
    roleItemId: player.roleBoundItem || 0,
    killParticipation: teamKills
      ? Math.round((((player.kills || 0) + (player.assists || 0)) / teamKills) * 100)
      : 0,
    items: [
      ...Array.from({ length: 7 }, (_, index) => player[`item${index}`] || 0),
      ...(['BOTTOM', 'UTILITY'].includes(player.teamPosition) ? [player.roleBoundItem || 0] : []),
    ],
    spells: [player.summoner1Id || 0, player.summoner2Id || 0],
    runes: [
      player.perks?.styles?.[0]?.selections?.[0]?.perk || 0,
      player.perks?.styles?.[1]?.style || 0,
    ],
    position: player.teamPosition || 'UNKNOWN',
  };
}

function normalizeStoredMatch(match) {
  const { info } = match;
  const teamKills = new Map();
  for (const player of info.participants) {
    teamKills.set(player.teamId, (teamKills.get(player.teamId) || 0) + (player.kills || 0));
  }
  const durationSeconds = Math.max(
    0,
    Math.floor(info.gameVersion?.startsWith('11.') ? info.gameDuration / 1000 : info.gameDuration),
  );
  const playedAt = info.gameEndTimestamp || info.gameCreation + durationSeconds * 1000;
  return {
    matchId: match.metadata.matchId,
    queueId: info.queueId,
    gameVersion: info.gameVersion || 'unknown',
    patchVersion: info.gameVersion?.split('.').slice(0, 2).join('.') || 'unknown',
    mapId: info.mapId || 11,
    startedAt: info.gameStartTimestamp || info.gameCreation || playedAt - durationSeconds * 1000,
    playedAt,
    durationSeconds,
    duration: Math.floor(durationSeconds / 60),
    remake: info.participants.some((player) => player.gameEndedInEarlySurrender === true),
    detailComplete: true,
    participants: info.participants.map((player, index) =>
      normalizeParticipant(player, teamKills.get(player.teamId), index + 1),
    ),
  };
}

function projectMatch(match, puuid) {
  const player = match.participants.find((participant) => participant.puuid === puuid);
  return player ? { ...player, ...match } : null;
}

function normalizeMatch(match, puuid) {
  return projectMatch(normalizeStoredMatch(match), puuid);
}

// 이전 JSON에는 다른 참가자의 PUUID가 없으므로, 확인 가능한 원 소환사만 연결합니다.
function legacyMatches(data, ownerPuuid) {
  return (data.matches || []).map((match) => {
    const ownerIndex = match.participants.findIndex(
      (player) =>
        player.name === match.name &&
        player.championId === match.championId &&
        player.teamId === match.teamId &&
        player.kills === match.kills &&
        player.deaths === match.deaths &&
        player.assists === match.assists,
    );
    const seenPuuids = new Set();
    const participants = match.participants
      .map((player, index) => ({
        ...player,
        participantId: player.participantId || index + 1,
        puuid: player.puuid || (index === ownerIndex ? ownerPuuid : null),
        gold: player.gold || 0,
        roleItemId: player.roleItemId || 0,
      }))
      .map((player) => {
        if (player.puuid && seenPuuids.has(player.puuid)) return { ...player, puuid: null };
        if (player.puuid) seenPuuids.add(player.puuid);
        return player;
      });
    return {
      matchId: match.matchId,
      queueId: match.queueId,
      gameVersion: 'unknown',
      patchVersion: 'unknown',
      mapId: 11,
      startedAt: match.playedAt - match.durationSeconds * 1000,
      playedAt: match.playedAt,
      durationSeconds: match.durationSeconds,
      duration: Math.floor(match.durationSeconds / 60),
      remake: Boolean(match.remake),
      detailComplete: false,
      participants,
    };
  });
}

module.exports = {
  normalizeParticipant,
  normalizeMatch,
  normalizeStoredMatch,
  projectMatch,
  legacyMatches,
};
