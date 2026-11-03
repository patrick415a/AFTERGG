'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SearchForm from './SearchForm';
import Notice, { useNotice } from './Notice';
import ProfileAsset from './ProfileAsset';
import MatchList from './MatchList';
import UiIcon from './UiIcon';
import { useSummoner } from '@/hooks/useSummoner';
import {
  championInfo,
  filterMatches,
  parseRiotId,
  rankImage,
  timeAgo,
  type Assets,
  type Match,
  type Queue,
  type Rank,
  type SummonerData,
} from '@/lib/api';
import styles from './Summoner.module.scss';

export default function Summoner() {
  const query = useSearchParams().get('riotId')?.trim() || '';
  return <SearchResult key={query} query={query} />;
}
function SearchResult({ query }: { query: string }) {
  const [filter, setFilter] = useState<Queue>('all');
  const {
    data: loadedData,
    assets,
    error,
    loading,
    updating,
    loadingMore,
    refresh,
    loadMore,
  } = useSummoner(query);
  const data = loadedData || pendingPlayer(query);
  const { message, notify } = useNotice();
  if (error && !loadedData && error.code !== 'ACCOUNT_NOT_FOUND')
    return (
      <main className={styles.requestState}>
        <h1>플레이어를 확인하지 못했어요</h1>
        <p role="alert">{error.message}</p>
        <button type="button" onClick={refresh}>
          다시 시도
        </button>
      </main>
    );
  if (error?.code === 'ACCOUNT_NOT_FOUND' || !data)
    return (
      <>
        <main className={styles.missing}>
          <div className={styles.emptyIcon}>
            <UiIcon name="file" />
          </div>
          <h1>검색 결과를 찾지 못했어요</h1>
          <p>
            입력한 플레이어 이름 + 태그에 해당하는 소환사가 없습니다.
            <br />
            이름과 태그를 확인한 후 다시 검색해 주세요
          </p>
          <div className={styles.retrySearch}>
            <SearchForm onNotice={notify} />
          </div>
        </main>
        <Notice message={message} />
      </>
    );
  const empty = data.matches.length === 0;
  const visibleMatches = filterMatches(data.matches, filter);
  const recent = visibleMatches.slice(0, 10),
    completed = recent.filter((m) => !m.remake),
    remakes = recent.length - completed.length,
    wins = completed.filter((m) => m.win).length,
    losses = completed.length - wins;
  const deaths = completed.reduce((s, m) => s + m.deaths, 0),
    ka = completed.reduce((s, m) => s + m.kills + m.assists, 0);
  const ranks =
    filter === '420' ? [data.solo] : filter === '440' ? [data.flex] : [data.solo, data.flex];
  const rankedGames = ranks.reduce((s, r) => s + (r ? r.wins + r.losses : 0), 0),
    rankedWins = ranks.reduce((s, r) => s + (r?.wins || 0), 0);
  let streak = 0;
  for (const match of completed) {
    if (match.win !== completed[0]?.win) break;
    streak++;
  }
  const popular = [...new Set(data.matches.map((m) => m.championId))]
    .map((id) => ({ id, games: data.matches.filter((m) => m.championId === id).length }))
    .sort((a, b) => b.games - a.games)[0];
  const backdrop = popular
    ? assets?.champions[String(popular.id)]?.centered
    : '/assets/Heimerdinger_2.jpg';
  const icon =
    data.profileIconId !== null && assets
      ? `https://ddragon.leagueoflegends.com/cdn/${assets.version}/img/profileicon/${data.profileIconId}.png`
      : null;
  const changeFilter = (queue: Queue) => {
    if (queue !== filter) setFilter(queue);
  };
  return (
    <>
      <main className={styles.result}>
        <div
          className={`${styles.backdrop} ${!popular ? styles.emptyBackdrop : ''}`}
          style={backdrop ? { backgroundImage: `url('${backdrop}')` } : undefined}
          aria-hidden="true"
        />
        <div className={styles.container}>
          <section
            className={`${styles.profile} ${empty ? styles.profileEmpty : ''}`}
            aria-label="소환사 정보"
          >
            <div className={styles.profileAvatar}>
              <ProfileAsset
                src={icon}
                label="소환사 아이콘"
                width={107}
                height={107}
                className={styles.summonerIcon}
              />
              {data.summonerLevel !== null && (
                <span
                  className={styles.summonerLevel}
                  aria-label={`소환사 레벨 ${data.summonerLevel}`}
                >
                  {data.summonerLevel}
                </span>
              )}
            </div>
            <div className={styles.identity}>
              <h1>
                {data.gameName}
                <span>#{data.tagLine}</span>
              </h1>
              <div className={styles.refresh}>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading || updating || loadingMore}
                  aria-busy={updating}
                >
                  {updating ? '갱신 중…' : '전적 갱신'}
                </button>
                <p role="status">
                  {loading
                    ? '플레이어 확인 중…'
                    : updating
                      ? '전적을 불러오고 있어요'
                      : data.updatedAt
                        ? `최근 업데이트 : ${timeAgo(data.updatedAt)}`
                        : '최근 전적 조회 결과 없음'}
                </p>
              </div>
            </div>
            <div className={styles.ranks}>
              <RankInfo
                rank={data.solo}
                label="솔로랭크"
                pending={loading || data.profileLoaded === false}
              />
              <RankInfo
                rank={data.flex}
                label="자유랭크"
                pending={loading || data.profileLoaded === false}
              />
            </div>
          </section>
          {data.warnings.map((warning) => (
            <p className={styles.apiWarning} key={warning}>
              {warning}
            </p>
          ))}
          {!assets && !loading && (
            <p className={styles.apiWarning}>게임 이미지 정보를 불러오는 중입니다.</p>
          )}
          {error && (
            <p className={styles.apiWarning} role="alert">
              {error.message}
            </p>
          )}
          {empty ? (
            <section className={styles.noMatches} aria-labelledby="empty-title">
              <div className={styles.emptyIcon}>
                <UiIcon name="clock" />
              </div>
              <h2 id="empty-title">
                {loading
                  ? '플레이어를 확인하고 있어요'
                  : updating
                    ? '전적을 불러오고 있어요'
                    : data.matchesLoaded
                      ? '아직 전적 기록이 없습니다'
                      : '최근 전적을 확인해 보세요'}
              </h2>
              <p>
                {loading
                  ? '잠시만 기다려 주세요.'
                  : updating
                    ? '완료되면 이 화면에 전적이 표시됩니다.'
                    : data.matchesLoaded
                      ? '최근 30일 내 랭크 게임의 전적이 없습니다.'
                      : '전적 갱신을 누르면 최근 30일 랭크 전적을 불러올 수 있습니다.'}
              </p>
              <div className={styles.explanation}>
                <h3>ⓘ　전적이 표시되지 않는다면 확인해 주세요</h3>
                <ul>
                  <li>최근 30일 내 랭크 게임을 플레이하지 않은 경우</li>
                  <li>최근 게임이 완료되지 않아 데이터가 반영되지 않은 경우</li>
                  <li>KR 서버에 해당 소환사의 게임 기록이 없는 경우</li>
                </ul>
              </div>
            </section>
          ) : (
            <>
              <section className={styles.summary} aria-label="전적 요약">
                <div>
                  <p>랭크 평균 승률</p>
                  <strong className={styles.blue}>
                    {rankedGames ? `${((rankedWins / rankedGames) * 100).toFixed(1)}%` : '—'}
                  </strong>
                </div>
                <div>
                  <p>최근 {recent.length}게임</p>
                  <strong>
                    <span className={styles.blue}>{wins}W</span>{' '}
                    <span className={styles.red}>{losses}L</span>
                    {remakes > 0 && (
                      <>
                        {' '}
                        <span className={styles.neutral}>{remakes}R</span>
                      </>
                    )}
                  </strong>
                </div>
                <div>
                  <p>연승/연패</p>
                  <strong
                    className={
                      !completed.length
                        ? styles.neutral
                        : completed[0].win
                          ? styles.blue
                          : styles.red
                    }
                  >
                    {completed.length ? `${streak}연${completed[0].win ? '승' : '패'}` : '—'}
                  </strong>
                </div>
                <div>
                  <p>최근 {recent.length}게임 평균 KDA</p>
                  <strong>
                    {!completed.length ? '—' : deaths ? (ka / deaths).toFixed(2) : 'Perfect'}
                  </strong>
                </div>
              </section>
              <div className={styles.columns}>
                <MatchList
                  matches={visibleMatches}
                  assets={assets}
                  filter={filter}
                  onFilter={changeFilter}
                  hasMore={data.hasMore}
                  loadingMore={loadingMore}
                  updating={updating}
                  onLoadMore={loadMore}
                />
                <StatsSidebar matches={visibleMatches} assets={assets} />
              </div>
            </>
          )}
        </div>
      </main>
      <Notice message={message} />
    </>
  );
}
function pendingPlayer(query: string): SummonerData | null {
  try {
    return {
      ...parseRiotId(query),
      profileIconId: null,
      summonerLevel: null,
      solo: null,
      flex: null,
      page: 0,
      pageSize: 30,
      hasMore: false,
      periodDays: 30,
      anchor: 0,
      queue: 'all',
      matches: [],
      matchesLoaded: false,
      warnings: [],
      updatedAt: null,
    };
  } catch {
    return null;
  }
}
function RankInfo({
  rank,
  label,
  pending = false,
}: {
  rank: Rank | null;
  label: string;
  pending?: boolean;
}) {
  return (
    <div>
      <div className={styles.rankIcon} aria-hidden={!rank || undefined}>
        {rank && (
          <ProfileAsset src={rankImage(rank)} label={`${label} 티어`} width={2560} height={1440} />
        )}
      </div>
      <p>
        {label}
        <strong className={styles.rankTier} data-tier={rank?.tier}>
          {pending
            ? '—'
            : rank
              ? `${rank.tier.charAt(0)}${rank.tier.slice(1).toLowerCase()} ${rank.rank}`
              : 'Unranked'}
          <small>{rank ? ` ㆍ ${rank.leaguePoints}LP` : ''}</small>
        </strong>
      </p>
    </div>
  );
}
function StatsSidebar({ matches, assets }: { matches: Match[]; assets: Assets | null }) {
  const recent = matches.slice(0, 10),
    completed = recent.filter((m) => !m.remake),
    wins = completed.filter((m) => m.win).length,
    remakes = recent.length - completed.length;
  const rhythm: { match: Match; streak: number }[] = [];
  for (const match of [...recent].reverse()) {
    const previous = rhythm.filter((bar) => !bar.match.remake).at(-1);
    rhythm.push({
      match,
      streak: match.remake ? 0 : previous?.match.win === match.win ? previous.streak + 1 : 1,
    });
  }
  const maxStreak = Math.max(4, ...rhythm.map((bar) => bar.streak));
  const groups = new Map<number, Match[]>();
  for (const match of matches.filter((m) => !m.remake))
    groups.set(match.championId, [...(groups.get(match.championId) || []), match]);
  const frequent = [...groups.values()].sort((a, b) => b.length - a.length).slice(0, 4);
  const known = matches.filter(
    (m) => !m.remake && ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(m.position),
  );
  return (
    <aside className={styles.sidebar} aria-label="최근 플레이 통계">
      <section className={styles.rhythm}>
        <h2>최근 {recent.length}게임 리듬</h2>
        <p>
          {!completed.length
            ? '아직 승패 기록이 없어요'
            : wins > completed.length / 2
              ? '다시 상승세를 타고 있어요'
              : wins === completed.length / 2
                ? '팽팽한 승부를 이어가고 있어요'
                : '다음 승리를 준비하고 있어요'}
        </p>
        <div
          className={styles.rhythmBars}
          role="img"
          aria-label={`최근 ${recent.length}경기 ${wins}승 ${completed.length - wins}패${remakes ? `, 다시하기 ${remakes}경기` : ''}. 오래된 경기부터 ${rhythm.map(({ match, streak }) => (match.remake ? '다시하기' : `${streak}연${match.win ? '승' : '패'}`)).join(', ')}`}
        >
          {rhythm.map(({ match, streak }) => (
            <span
              key={match.matchId}
              title={match.remake ? '다시하기' : `${streak}연${match.win ? '승' : '패'}`}
              style={{
                height: `${match.remake ? 24 : 24 + ((streak - 1) * 68) / (maxStreak - 1)}%`,
                backgroundColor: match.remake
                  ? 'var(--stat-remake)'
                  : match.win
                    ? '#508aee'
                    : '#d85c5e',
              }}
            />
          ))}
        </div>
      </section>
      <section className={styles.frequent}>
        <h2>최근 자주 플레이 한 챔피언</h2>
        {frequent.map((list) => {
          const p = list[0],
            info = championInfo(assets, p),
            rate = Math.round((list.filter((m) => m.win).length / list.length) * 100),
            deaths = list.reduce((s, m) => s + m.deaths, 0),
            ka = list.reduce((s, m) => s + m.kills + m.assists, 0);
          const color = rate > 50 ? '#508aee' : rate < 50 ? '#d85c5e' : '#9a9b9e';
          return (
            <div className={styles.frequentRow} key={p.championId}>
              <ProfileAsset
                src={info?.image}
                label={info?.name || p.champion}
                width={40}
                height={40}
                className={styles.round}
              />
              <div className={styles.frequentStat}>
                <p>
                  <span>{info?.name || p.champion}</span>
                  <span>KDA {deaths ? (ka / deaths).toFixed(2) : 'Perfect'}</span>
                </p>
                <div className={styles.frequentRate}>
                  <span className={styles.track}>
                    <span style={{ width: `${rate}%`, backgroundColor: color }} />
                  </span>
                  <span style={{ color }}>{rate}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </section>
      <section className={styles.positionStats}>
        <h2>최근 자주 가는 포지션</h2>
        <div className={styles.positionBars} aria-label="불러온 경기의 포지션 비율" role="img">
          {['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((position, i) => {
            const rate = known.length
              ? Math.round(
                  (known.filter((m) => m.position === position).length / known.length) * 100,
                )
              : 0;
            return (
              <div key={position}>
                <span className={styles.positionTrack}>
                  <span className={styles.positionColumn} style={{ height: `${rate}%` }}>
                    {rate > 0 && <span>{rate}%</span>}
                  </span>
                </span>
                <span>{['탑', '정글', '미드', '원딜', '서폿'][i]}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
