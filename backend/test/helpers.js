const stamp = 1800000000000;
const person = (overrides = {}) => ({
  puuid: 'test-player',
  riotIdGameName: '테스트',
  riotIdTagline: 'KR1',
  championName: 'Lulu',
  championId: 117,
  champLevel: 11,
  teamId: 100,
  win: true,
  kills: 2,
  deaths: 0,
  assists: 10,
  totalMinionsKilled: 20,
  neutralMinionsKilled: 3,
  totalDamageDealtToChampions: 12000,
  totalDamageTaken: 8000,
  item0: 1001,
  summoner1Id: 4,
  summoner2Id: 14,
  teamPosition: 'UTILITY',
  perks: { styles: [{ selections: [{ perk: 8214 }] }, { style: 8100 }] },
  ...overrides,
});
const match = (id, end = stamp - 10000, queueId = 420) => ({
  metadata: { matchId: id },
  info: {
    queueId,
    gameVersion: '16.21.1',
    gameDuration: 1801,
    gameEndTimestamp: end,
    participants: [
      person(),
      person({ puuid: 'other', riotIdGameName: '팀원', kills: 18 }),
      person({ puuid: 'enemy', riotIdGameName: '상대', teamId: 200, win: false }),
    ],
  },
});
function fakeRiot({
  ids = { 420: ['A'], 440: [] },
  failAt,
  failStatus = 403,
  emptyRanks = false,
} = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (failAt && u.pathname.includes(failAt))
      return new Response('{}', {
        status: failStatus,
        headers: failStatus === 429 ? { 'Retry-After': '60' } : {},
      });
    if (u.pathname.includes('/accounts/'))
      return Response.json({ puuid: 'test-player', gameName: '테스트', tagLine: 'KR1' });
    if (u.pathname.includes('/league/'))
      return Response.json(
        emptyRanks
          ? []
          : [
              {
                queueType: 'RANKED_SOLO_5x5',
                tier: 'EMERALD',
                rank: 'III',
                leaguePoints: 62,
                wins: 6,
                losses: 4,
              },
            ],
      );
    if (u.pathname.includes('/summoners/'))
      return Response.json({ profileIconId: 1, summonerLevel: 10 });
    if (u.pathname.endsWith('/ids')) {
      const list = ids[u.searchParams.get('queue')] || [];
      const start = Number(u.searchParams.get('start')),
        count = Number(u.searchParams.get('count'));
      return Response.json(list.slice(start, start + count));
    }
    if (u.pathname.includes('/matches/')) {
      const id = u.pathname.split('/').at(-1);
      const m = /^M(\d+)$/.exec(id);
      return Response.json(
        match(
          id,
          stamp - (m ? Number(m[1]) : id.charCodeAt(0)) * 10000,
          id.startsWith('F') ? 440 : 420,
        ),
      );
    }
    if (u.pathname.endsWith('/versions.json')) return Response.json(['16.21.1']);
    if (u.pathname.endsWith('/champion.json'))
      return Response.json({
        data: {
          Lulu: { key: '117', id: 'Lulu', name: '룰루', image: { full: 'Lulu.png' } },
          Fiddlesticks: {
            key: '9',
            id: 'Fiddlesticks',
            name: '피들스틱',
            image: { full: 'Fiddlesticks.png' },
          },
        },
      });
    if (u.pathname.endsWith('/summoner.json'))
      return Response.json({
        data: { Flash: { key: '4', name: '점멸', image: { full: 'SummonerFlash.png' } } },
      });
    if (u.pathname.endsWith('/runesReforged.json'))
      return Response.json([
        {
          id: 8100,
          name: '지배',
          icon: 'perk-images/style.png',
          slots: [{ runes: [{ id: 8214, name: '콩콩이 소환', icon: 'perk-images/rune.png' }] }],
        },
      ]);
    if (u.pathname.endsWith('/item.json'))
      return Response.json({ data: { 1001: { name: '장화', image: { full: '1001.png' } } } });
    throw new Error('Unexpected URL ' + u.pathname);
  };
  return { fetchImpl, calls };
}

module.exports = { stamp, person, match, fakeRiot };
