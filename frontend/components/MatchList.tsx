'use client';
import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import ProfileAsset from './ProfileAsset';
import UiIcon from './UiIcon';
import {
  championInfo,
  duration,
  equipmentItems,
  kda,
  queueFilters,
  queueLabel,
  timeAgo,
  type Assets,
  type Match,
  type Participant,
  type Queue,
} from '@/lib/api';
import styles from './Summoner.module.scss';

function Equipment({
  player,
  assets,
  small = false,
  itemsOnly = false,
}: {
  player: Participant;
  assets: Assets | null;
  small?: boolean;
  itemsOnly?: boolean;
}) {
  const spellImages = player.spells.map((id) => ({
    src: assets?.spells[String(id)]?.image,
    label: assets?.spells[String(id)]?.name || '소환사 주문',
  }));
  const runeImages = player.runes.map((id) => ({
    src: assets?.runes[String(id)]?.image,
    label: assets?.runes[String(id)]?.name || '룬 정보 없음',
  }));
  const itemImages = equipmentItems(player, itemsOnly).map((id) => ({
    src:
      id && assets
        ? assets.items?.[String(id)]?.image ||
          `https://ddragon.leagueoflegends.com/cdn/${assets.version}/img/item/${id}.png`
        : null,
    label: id ? assets?.items?.[String(id)]?.name || '아이템 정보 없음' : '빈 아이템 슬롯',
  }));
  const renderImage = (
    value: { src?: string | null; label: string },
    key: string,
    runeIndex?: number,
  ) => {
    const slotClass =
      runeIndex !== undefined
        ? `${styles.runeSlot} ${runeIndex === 0 ? styles.keystoneRune : ''}`
        : undefined;
    return (
      <span key={key} className={slotClass} title={value.label}>
        <ProfileAsset
          src={value.src || null}
          label={value.label}
          width={small ? 20 : 36}
          height={small ? 20 : 36}
        />
      </span>
    );
  };
  if (!small && !itemsOnly)
    return (
      <span className={styles.matchEquipment} aria-label="소환사 주문·룬·아이템">
        <span className={`${styles.slots} ${styles.spellGroup}`} aria-label="소환사 주문">
          {spellImages.map((value, i) => renderImage(value, `spell-${i}`))}
        </span>
        <span className={`${styles.slots} ${styles.runeGroup}`} aria-label="룬">
          {runeImages.map((value, i) => renderImage(value, `rune-${i}`, i))}
        </span>
        <span
          className={`${styles.slots} ${styles.itemGroup}`}
          style={{ '--item-count': itemImages.length } as CSSProperties}
          aria-label="아이템"
        >
          {itemImages.map((value, i) => renderImage(value, `item-${i}`))}
        </span>
      </span>
    );
  const images = itemsOnly ? itemImages : [...spellImages, ...runeImages, ...itemImages];
  const count = small && !itemsOnly ? 4 : images.length;
  return (
    <span
      className={`${styles.slots} ${small ? styles.slotsSmall : ''}`}
      aria-label={itemsOnly ? '아이템' : '소환사 주문·룬·아이템'}
    >
      {Array.from({ length: count }, (_, i) => {
        const value = images[i],
          isRune =
            !itemsOnly && i >= spellImages.length && i < spellImages.length + runeImages.length;
        return renderImage(
          value || { label: '빈 슬롯' },
          String(i),
          isRune ? i - spellImages.length : undefined,
        );
      })}
    </span>
  );
}
export default function MatchList({
  matches,
  assets,
  filter,
  onFilter,
  hasMore,
  loadingMore,
  updating = false,
  onLoadMore,
}: {
  matches: Match[];
  assets: Assets | null;
  filter: Queue;
  onFilter: (queue: Queue) => void;
  hasMore: boolean;
  loadingMore: boolean;
  updating?: boolean;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className={styles.matchPanel} aria-labelledby="matches-title">
      <div className={styles.matchHeading}>
        <h2 id="matches-title">최근 게임</h2>
        <div role="group" aria-label="게임 종류">
          {queueFilters.map((item) => (
            <button
              type="button"
              key={item.value}
              aria-pressed={filter === item.value}
              onClick={() => {
                setExpanded(null);
                onFilter(item.value);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {!matches.length && (
        <p className={styles.filteredEmpty}>
          불러온 전적에 {filter === '440' ? '자유 랭크' : filter === '420' ? '솔로 랭크' : '랭크'}{' '}
          게임이 없습니다.
          <br />
          {hasMore
            ? '전적 더 불러오기를 눌러 이전 경기도 확인해 보세요.'
            : '최근 30일 내 전적을 모두 불러왔습니다.'}
        </p>
      )}
      <ul className={styles.matchList}>
        {matches.map((match) => {
          const info = championInfo(assets, match),
            name = info?.name || match.champion;
          return (
            <li key={match.matchId}>
              <button
                type="button"
                className={`${styles.matchRow} ${match.remake ? styles.remade : match.win ? styles.won : styles.lost}`}
                onClick={() => setExpanded(expanded === match.matchId ? null : match.matchId)}
                aria-expanded={expanded === match.matchId}
                aria-controls={`${match.matchId}-detail`}
                aria-label={`${match.remake ? '다시하기' : match.win ? '승리' : '패배'} ${name} ${queueLabel(match.queueId)} 상세 ${expanded === match.matchId ? '접기' : '펼치기'}`}
              >
                <span className={styles.outcome}>
                  {match.remake ? '다시하기' : match.win ? 'WIN' : 'LOSE'}
                </span>
                <span className={styles.matchChampion}>
                  <span className={styles.avatar}>
                    <ProfileAsset src={info?.image} label={name} width={36} height={36} />
                    <span className={styles.level}>{match.level}</span>
                  </span>
                  <span>
                    {name}
                    <small>
                      {queueLabel(match.queueId)} / {timeAgo(match.playedAt)}
                    </small>
                  </span>
                </span>
                <span>
                  {match.kills} / {match.deaths} / {match.assists}
                  <small>{kda(match)} KDA</small>
                </span>
                <span>
                  {match.cs} CS<small>{duration(match.durationSeconds)}</small>
                </span>
                <Equipment player={match} assets={assets} />
                <span className={styles.arrow}>
                  <UiIcon name="chevron" expanded={expanded === match.matchId} />
                </span>
              </button>
              {expanded === match.matchId && (
                <div id={`${match.matchId}-detail`} className={styles.details}>
                  {[100, 200].map((teamId) => (
                    <TeamTable
                      key={teamId}
                      players={match.participants.filter((p) => p.teamId === teamId)}
                      teamId={teamId}
                      seconds={match.durationSeconds}
                      remake={match.remake}
                      assets={assets}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(hasMore || !matches.length) && (
        <button
          type="button"
          className={styles.loadMore}
          disabled={!hasMore || loadingMore || updating}
          aria-busy={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? '전적 불러오는 중…' : '전적 더 불러오기'}
        </button>
      )}
    </section>
  );
}
const positions: Record<string, string> = {
  TOP: '탑',
  JUNGLE: '정글',
  MIDDLE: '미드',
  BOTTOM: '원딜',
  UTILITY: '서폿',
};
function TeamTable({
  players,
  teamId,
  seconds,
  remake,
  assets,
}: {
  players: Participant[];
  teamId: number;
  seconds: number;
  remake: boolean;
  assets: Assets | null;
}) {
  if (!players.length) return null;
  const won = players[0].win;
  const maxDamage = Math.max(1, ...players.map((p) => p.damage)),
    maxTaken = Math.max(1, ...players.map((p) => p.taken));
  return (
    <table className={styles.teamTable}>
      <caption className="sr-only">{teamId === 100 ? '블루팀' : '레드팀'} 상세 전적</caption>
      <thead className={remake ? styles.teamRemade : won ? styles.teamWon : styles.teamLost}>
        <tr>
          <th scope="col">
            {remake ? '다시하기' : won ? '승리' : '패배'} ({teamId === 100 ? '블루팀' : '레드팀'})
          </th>
          <th scope="col">KDA</th>
          <th scope="col">CS</th>
          <th scope="col">가한 피해량</th>
          <th scope="col">받은 피해량</th>
          <th scope="col">아이템</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => {
          const info = championInfo(assets, p);
          return (
            <tr key={`${p.name}-${i}`}>
              <td>
                <div className={styles.playerCell}>
                  <span className={styles.avatar}>
                    <ProfileAsset
                      src={info?.image}
                      label={info?.name || p.champion}
                      width={36}
                      height={36}
                    />
                    <span className={styles.level}>{p.level}</span>
                  </span>
                  <Equipment player={p} assets={assets} small />
                  <span>
                    {p.tagLine ? (
                      <Link
                        className={styles.playerLink}
                        href={`/summoner?riotId=${encodeURIComponent(`${p.name}#${p.tagLine}`)}`}
                        prefetch={false}
                        aria-label={`${p.name}#${p.tagLine} 전적 검색`}
                      >
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                    <small>{positions[p.position] || '포지션 정보 없음'}</small>
                  </span>
                </div>
              </td>
              <td>
                {p.kills} / {p.deaths} / {p.assists} ({p.killParticipation}%)
                <small>{kda(p)} KDA</small>
              </td>
              <td>
                {p.cs} CS<small>분당 {seconds ? (p.cs / (seconds / 60)).toFixed(1) : '0.0'}</small>
              </td>
              <td>
                {p.damage.toLocaleString()}
                <span className={styles.damageTrack}>
                  <span style={{ width: `${(p.damage / maxDamage) * 100}%` }} />
                </span>
              </td>
              <td>
                {p.taken.toLocaleString()}
                <span className={`${styles.damageTrack} ${styles.takenTrack}`}>
                  <span style={{ width: `${(p.taken / maxTaken) * 100}%` }} />
                </span>
              </td>
              <td>
                <Equipment player={p} assets={assets} small itemsOnly />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
