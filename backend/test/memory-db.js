const { projectMatch } = require('../server/matches');

// HTTP 서비스의 저장/재조회 계약을 검증하는 테스트 전용 저장소입니다.
function createMemoryDatabase() {
  const players = new Map();
  const matches = new Map();
  const calls = { reads: 0, writes: 0, matchReads: 0 };
  const database = {
    players,
    matches,
    calls,
    async getSummoner(gameName, tagLine, options) {
      calls.reads++;
      const player = [...players.values()].find(
        (player) =>
          player.gameName.toLowerCase() === gameName.toLowerCase() &&
          player.tagLine.toLowerCase() === tagLine.toLowerCase(),
      );
      if (!player) return null;
      const { page = 1, pageSize = 30, queue = 'all', anchor, profileOnly = false } = options;
      const all = profileOnly
        ? []
        : [...matches.values()]
            .filter(
              (match) =>
                match.participants.some((participant) => participant.puuid === player.puuid) &&
                ['420', '440'].includes(String(match.queueId)) &&
                (queue === 'all' || String(match.queueId) === queue) &&
                match.startedAt >= (anchor - 30 * 86400) * 1000 &&
                match.startedAt <= anchor * 1000,
            )
            .sort((a, b) => b.playedAt - a.playedAt || b.matchId.localeCompare(a.matchId));
      return {
        gameName: player.gameName,
        tagLine: player.tagLine,
        profileIconId: player.profileIconId ?? null,
        summonerLevel: player.summonerLevel ?? null,
        profileLoaded: player.ranks !== undefined,
        solo: player.ranks?.find((rank) => rank.queueType === 'RANKED_SOLO_5x5') || null,
        flex: player.ranks?.find((rank) => rank.queueType === 'RANKED_FLEX_SR') || null,
        warnings: player.warnings || [],
        updatedAt: player.updatedAt ?? null,
        matches: all
          .slice((page - 1) * pageSize, page * pageSize)
          .map((match) => projectMatch(match, player.puuid)),
        matchesLoaded: !profileOnly && (player.updatedAt != null || all.length > 0),
        historyComplete: player.historyComplete || false,
        page: profileOnly ? 0 : page,
        pageSize,
        queue,
        anchor,
        periodDays: 30,
        hasMore: all.length > page * pageSize,
      };
    },
    async getStoredMatchesByIds(ids) {
      calls.matchReads++;
      return ids.map((id) => matches.get(id)).filter((match) => match?.detailComplete);
    },
    async saveSummonerData({
      account,
      profile,
      ranks,
      matches: incoming = [],
      refresh,
      now,
      warnings,
    }) {
      calls.writes++;
      for (const match of incoming) {
        if (!matches.get(match.matchId)?.detailComplete)
          matches.set(match.matchId, structuredClone(match));
        for (const participant of match.participants) {
          if (participant.puuid && participant.tagLine && !players.has(participant.puuid)) {
            players.set(participant.puuid, {
              puuid: participant.puuid,
              gameName: participant.name,
              tagLine: participant.tagLine,
            });
          }
        }
      }
      const previous = players.get(account.puuid) || {};
      players.set(account.puuid, {
        ...previous,
        ...account,
        ...profile,
        ranks: ranks ?? previous.ranks,
        warnings,
        updatedAt: refresh ? now : previous.updatedAt,
        historyComplete: refresh || previous.historyComplete,
      });
    },
    async searchSummoners(keyword) {
      return [...players.values()]
        .filter((player) => player.gameName.toLowerCase().includes(keyword.toLowerCase()))
        .slice(0, 20)
        .map(({ gameName, tagLine }) => ({ gameName, tagLine }));
    },
  };
  return database;
}

module.exports = { createMemoryDatabase };
