export type Queue = 'all' | '420' | '440';
export type RecommendationScope = 'all' | 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';
export type ChampionRecommendations = {
  date: string;
  timeZone: 'Asia/Seoul';
  startTime: number;
  nextUpdateAt: number;
  updatedAt: number;
  groups: Record<
    RecommendationScope,
    {
      sampleMatches: number;
      samplePicks: number;
      champions: {
        championId: number;
        champion: string;
        pickCount: number;
        wins: number;
        pickRate: number;
        winRate: number;
      }[];
    }
  >;
};

export async function fetchChampionRecommendations(
  signal: AbortSignal,
): Promise<ChampionRecommendations> {
  const response = await fetch('/api/champion-recommendations', { signal, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data?.groups?.all?.champions)) {
    throw new Error('추천 챔피언을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return data as ChampionRecommendations;
}
export type PatchNote = { title: string; url: string; publishedAt: string };
export async function fetchPatchNotes(signal: AbortSignal): Promise<PatchNote[]> {
  const response = await fetch('/api/patch-notes', { signal, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data?.patches)) throw new Error('PATCH_NOTES_UNAVAILABLE');
  return data.patches;
}
export const queueFilters: { label: string; value: Queue }[] = [
  { label: '전체', value: 'all' },
  { label: '솔로 랭크', value: '420' },
  { label: '자유 랭크', value: '440' },
];
export type Rank = {
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  queueType: string;
};
export type Participant = {
  puuid?: string | null;
  participantId?: number;
  name: string;
  tagLine: string;
  champion: string;
  championId: number;
  level: number;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  taken: number;
  killParticipation: number;
  items: number[];
  spells: number[];
  runes: number[];
  position: string;
};
export type Match = Participant & {
  matchId: string;
  queueId: number;
  durationSeconds: number;
  duration: number;
  playedAt: number;
  remake: boolean;
  participants: Participant[];
};
export function equipmentItems(
  player: Pick<Participant, 'items' | 'position'>,
  wardFourth = false,
) {
  const count = ['BOTTOM', 'UTILITY'].includes(player.position) ? 8 : 7;
  const items = Array.from({ length: count }, (_, i) => player.items[i] || 0);
  return wardFourth
    ? [...items.slice(0, 3), items[6], ...items.slice(3, 6), ...items.slice(7)]
    : items;
}
export type SummonerData = {
  gameName: string;
  tagLine: string;
  profileIconId: number | null;
  summonerLevel: number | null;
  profileLoaded?: boolean;
  solo: Rank | null;
  flex: Rank | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  periodDays: number;
  anchor: number;
  queue: Queue;
  matches: Match[];
  matchesLoaded: boolean;
  historyComplete?: boolean;
  warnings: string[];
  updatedAt: number | null;
};
export type Assets = {
  version: string;
  champions: Record<
    string,
    { id: string; name: string; image: string; splash: string; centered: string }
  >;
  spells: Record<string, { name: string; image: string }>;
  runes: Record<string, { name: string; image: string }>;
  items: Record<string, { name: string; image: string }>;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export function parseRiotId(value: string) {
  const index = value.lastIndexOf('#');
  const gameName = value.slice(0, index).trim(),
    tagLine = value.slice(index + 1).trim();
  if (index <= 0 || !gameName || !tagLine || gameName.length > 100 || tagLine.length > 20)
    throw new ApiError('Riot ID를 이름#태그 형식으로 입력해 주세요.', 'INVALID_QUERY', 400);
  return { gameName, tagLine };
}
export function filterMatches(matches: Match[], queue: Queue) {
  return queue === 'all' ? matches : matches.filter((match) => String(match.queueId) === queue);
}
export async function fetchSummoner(
  riotId: string,
  options: {
    page?: number;
    anchor?: number;
    refresh?: boolean;
    profileOnly?: boolean;
    signal: AbortSignal;
  },
) {
  const id = parseRiotId(riotId);
  const params = new URLSearchParams({ ...id, queue: 'all', page: String(options.page || 1) });
  if (options.anchor !== undefined) params.set('anchor', String(options.anchor));
  if (options.refresh) params.set('refresh', 'true');
  if (options.profileOnly) params.set('profileOnly', 'true');
  let response: Response;
  try {
    response = await fetch(`/api/summoner?${params}`, {
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new ApiError(
      '백엔드에 연결하지 못했습니다. backend에서 npm run dev가 실행 중인지 확인해 주세요.',
      'NETWORK_ERROR',
      0,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error || '백엔드에 연결하지 못했습니다.',
      data?.code || 'SERVER_ERROR',
      response.status,
    );
  if (!data || !Array.isArray(data.matches))
    throw new ApiError('전적 응답 형식이 올바르지 않습니다.', 'INVALID_RESPONSE', 502);
  return data as SummonerData;
}
let assetsPromise: Promise<Assets | null> | null = null;
export function fetchAssets() {
  if (!assetsPromise)
    assetsPromise = fetch('/api/assets', { signal: AbortSignal.timeout(20000) })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Assets>;
      })
      .catch(() => {
        assetsPromise = null;
        return null;
      });
  return assetsPromise;
}
export const championInfo = (assets: Assets | null, p: Pick<Participant, 'championId'>) =>
  assets?.champions[String(p.championId)];
export const queueLabel = (id: number) =>
  id === 440 ? '자유 랭크' : id === 420 ? '솔로 랭크' : '랭크 게임';
export const kda = (p: Pick<Participant, 'kills' | 'deaths' | 'assists'>) =>
  p.deaths === 0 ? 'Perfect' : ((p.kills + p.assists) / p.deaths).toFixed(2);
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export function timeAgo(value: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return '방금 전';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}
const tiers = new Set([
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]);
export const rankImage = (rank: Rank | null) =>
  rank && tiers.has(rank.tier)
    ? `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-${rank.tier.toLowerCase()}.png`
    : null;
