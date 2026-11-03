'use client';

import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import SearchForm from './SearchForm';
import Notice, { useNotice } from './Notice';
import ProfileAsset from './ProfileAsset';
import { patchNotesUrl, positions, positionKeys, type Position } from '@/data/home';
import {
  fetchAssets,
  fetchChampionRecommendations,
  fetchPatchNotes,
  timeAgo,
  type Assets,
  type ChampionRecommendations,
  type PatchNote,
} from '@/lib/api';
import styles from './Home.module.scss';

export default function Home() {
  const [position, setPosition] = useState<Position>('탑');
  const [patches, setPatches] = useState<PatchNote[]>([]);
  const [patchLoading, setPatchLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<ChampionRecommendations | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(true);
  const [recommendationError, setRecommendationError] = useState(false);
  const [recommendationRevision, setRecommendationRevision] = useState(0);
  const loadedDate = useRef<string | null>(null);
  const { message, notify } = useNotice();
  useEffect(() => {
    const controller = new AbortController();
    fetchPatchNotes(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPatches(value);
      })
      .catch(() => {
        /* 공식 목록 링크는 조회 실패 시에도 유지합니다. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setPatchLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    setRecommendationLoading(loadedDate.current !== today);
    setRecommendationError(false);
    fetchChampionRecommendations(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          loadedDate.current = value.date;
          setRecommendations(value);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && loadedDate.current !== today)
          setRecommendationError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecommendationLoading(false);
      });
    fetchAssets().then((value) => {
      if (!controller.signal.aborted) setAssets(value);
    });
    return () => controller.abort();
  }, [recommendationRevision]);

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      if (loadedDate.current !== today) {
        setRecommendations(null);
        setRecommendationLoading(true);
      }
      setRecommendationRevision((value) => value + 1);
    };
    const scheduleMidnight = () => {
      const now = Date.now();
      const offset = 9 * 3600000;
      const midnight = (Math.floor((now + offset) / 86400000) + 1) * 86400000 - offset;
      midnightTimer = setTimeout(
        () => {
          refresh();
          scheduleMidnight();
        },
        midnight - now + 1000,
      );
    };
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    // 새 표본은 1분마다 확인하고, 한국시간 자정에는 열린 화면도 새 날짜로 전환합니다.
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    document.addEventListener('visibilitychange', onVisibility);
    scheduleMidnight();
    return () => {
      clearTimeout(midnightTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const group = recommendations?.groups[positionKeys[position]];
  const visibleChampions = group?.champions.slice(0, 7) || [];

  return (
    <>
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="home-title">
          <h1 id="home-title">
            <Logo large />
          </h1>
          <p>최근 랭크 게임의 플레이 기록을 확인하세요</p>
        </section>

        <div className={styles.searchSlot}>
          <SearchForm onNotice={notify} />
        </div>

        <section
          className={styles.recommendations}
          aria-labelledby="champions-title"
          aria-busy={recommendationLoading}
        >
          <div className={styles.sectionHeading}>
            <h2 id="champions-title">
              오늘의 추천 챔피언 (
              <span className={styles.pick} title="선택한 범위의 전체 챔피언 선택 횟수 대비 비중">
                픽률
              </span>
              /<span className={styles.win}>승률</span>)
            </h2>
            <div className={styles.positions} role="group" aria-label="챔피언 포지션">
              {positions.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={position === item}
                  className={position === item ? styles.selected : ''}
                  onClick={() => setPosition(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {recommendationLoading ? (
            <p className={styles.empty} role="status">
              추천 챔피언을 집계하고 있어요.
            </p>
          ) : recommendationError ? (
            <div className={styles.empty} role="alert">
              <p>추천 챔피언을 불러오지 못했습니다.</p>
              <button
                className={styles.retry}
                type="button"
                onClick={() => setRecommendationRevision((value) => value + 1)}
              >
                다시 시도
              </button>
            </div>
          ) : visibleChampions.length ? (
            <ul className={styles.champions} aria-label={`${position} 추천 챔피언`}>
              {visibleChampions.map((champion) => {
                const info = assets?.champions[String(champion.championId)];
                const name = info?.name || champion.champion;
                return (
                  <li
                    key={champion.championId}
                    title={`${champion.pickCount.toLocaleString('ko-KR')}회 선택 · ${champion.wins.toLocaleString('ko-KR')}승`}
                  >
                    <div className={styles.portrait}>
                      <ProfileAsset src={info?.image} label={name} width={80} height={80} />
                    </div>
                    <p className={styles.championName}>{name}</p>
                    <p className={styles.rates}>
                      <span className={styles.pick}>{champion.pickRate.toFixed(1)}%</span> /{' '}
                      <span className={styles.win}>{champion.winRate.toFixed(1)}%</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.empty} role="status">
              아직 {position} 추천 챔피언을 집계할 경기 표본이 없습니다.
            </p>
          )}
          {!recommendationLoading && !recommendationError && group && (
            <div
              className={styles.sampleNote}
              title={`집계 시각: ${new Date(recommendations!.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`}
            >
              <p>
                <strong>AFTERGG.</strong>에 오늘 수집된{' '}
                <strong>{group.sampleMatches.toLocaleString('ko-KR')}경기</strong> 표본으로
                측정했습니다.
              </p>
              <p>
                솔로·자유랭크 · {position} {group.samplePicks.toLocaleString('ko-KR')}회 선택 기준 ·
                매일 00:00 초기화 (한국시간)
              </p>
            </div>
          )}
        </section>

        <section className={styles.patches} aria-labelledby="patches-title">
          <div className={styles.patchHeading}>
            <h2 id="patches-title">패치 노트</h2>
            <a href={patchNotesUrl} target="_blank" rel="noreferrer">
              더보기 &gt;<span className="sr-only"> (새 탭)</span>
            </a>
          </div>
          {patches.length === 0 && (
            <p className={styles.noPatches} role="status">
              {patchLoading
                ? '패치 노트를 불러오고 있어요.'
                : '패치 노트를 불러오지 못했습니다. 더보기에서 공식 목록을 확인해 주세요.'}
            </p>
          )}
          <ul>
            {patches.map((patch, index) => (
              <li key={patch.url}>
                <a href={patch.url} target="_blank" rel="noreferrer">
                  <span className={styles.patchTitle} title={patch.title}>
                    {patch.title}
                  </span>
                  <time
                    className={styles.ago}
                    dateTime={patch.publishedAt}
                    title={new Date(patch.publishedAt).toLocaleDateString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                    })}
                  >
                    {timeAgo(Date.parse(patch.publishedAt))}
                  </time>
                  <span className="sr-only"> — 공식 패치 노트 (새 탭)</span>
                </a>
                {index < patches.length - 1 && (
                  <>
                    <img
                      className={`${styles.separator} ${styles.darkIcon}`}
                      src="/assets/line-dark.svg"
                      width="744"
                      height="1"
                      alt=""
                    />
                    <img
                      className={`${styles.separator} ${styles.lightIcon}`}
                      src="/assets/line-light.svg"
                      width="744"
                      height="1"
                      alt=""
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Notice message={message} />
    </>
  );
}
