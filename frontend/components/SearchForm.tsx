'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { parseRiotId } from '@/lib/api';
import {
  readSearchHistory,
  rememberSearch,
  clearSearchHistory,
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_EVENT,
  type RecentSearch,
} from '@/lib/search-history';
import styles from './SearchForm.module.scss';

type Props = {
  compact?: boolean;
  onNotice: (message: string) => void;
};

type SummonerSuggestion = RecentSearch;

export default function SearchForm({ compact = false, onNotice }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SummonerSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const router = useRouter();
  const listId = `${id}-suggestions`;
  const showingHistory = !query.trim();
  const visibleSuggestions = showingHistory ? recentSearches : suggestions;
  const suggestionsOpen = showSuggestions && (showingHistory || visibleSuggestions.length > 0);

  useEffect(() => {
    const syncHistory = () => {
      setRecentSearches(readSearchHistory());
      setActiveSuggestion(-1);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SEARCH_HISTORY_KEY || event.key === null) syncHistory();
    };
    syncHistory();
    window.addEventListener(SEARCH_HISTORY_EVENT, syncHistory);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SEARCH_HISTORY_EVENT, syncHistory);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (suggestionsOpen && activeSuggestion >= 0) {
      document
        .getElementById(`${listId}-${activeSuggestion}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeSuggestion, suggestionsOpen, listId]);

  useEffect(() => {
    const keyword = query.split('#')[0].trim();
    setSuggestions([]);
    setActiveSuggestion(-1);

    if (!keyword) {
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/summoners/suggest?keyword=${encodeURIComponent(keyword)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error('자동완성 조회 실패');
        }

        const data: SummonerSuggestion[] = await response.json();
        if (!controller.signal.aborted) setSuggestions(data.slice(0, 20));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('자동완성 오류:', error);
        setSuggestions([]);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = query.trim();
    if (suggestionsOpen && activeSuggestion >= 0 && visibleSuggestions[activeSuggestion]) {
      selectSuggestion(visibleSuggestions[activeSuggestion]);
      return;
    }

    let summoner: RecentSearch;
    try {
      summoner = parseRiotId(value);
    } catch {
      onNotice('플레이어 이름과 태그를 입력해 주세요. 예: 이름#태그');
      inputRef.current?.focus();
      return;
    }

    selectSuggestion(summoner);
  }

  function selectSuggestion(summoner: SummonerSuggestion) {
    const riotId = `${summoner.gameName}#${summoner.tagLine}`;

    rememberSearch(summoner);
    setQuery(riotId);
    setShowSuggestions(false);

    router.push(`/summoner/?riotId=${encodeURIComponent(riotId)}`);
  }

  return (
    <div
      className={styles.wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setShowSuggestions(false);
      }}
    >
      <form
        className={`${styles.search} ${compact ? styles.compact : ''}`}
        role="search"
        onSubmit={submit}
        aria-label={compact ? '헤더 전적 검색' : '전적 검색'}
      >
        <img
          className={styles.darkIcon}
          src="/assets/search-dark.svg"
          width="18"
          height="18"
          alt=""
        />

        <img
          className={styles.lightIcon}
          src="/assets/search-light.svg"
          width="18"
          height="18"
          alt=""
        />

        <label className="sr-only" htmlFor={id}>
          플레이어 이름과 태그
        </label>

        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen}
          aria-controls={suggestionsOpen ? listId : undefined}
          aria-activedescendant={
            suggestionsOpen && activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSuggestions([]);
            setActiveSuggestion(-1);
            setShowSuggestions(true);
          }}
          onFocus={() => {
            setRecentSearches(readSearchHistory());
            setActiveSuggestion(-1);
            setShowSuggestions(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              setShowSuggestions(false);
              setActiveSuggestion(-1);
            } else if (visibleSuggestions.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              setShowSuggestions(true);
              setActiveSuggestion((previous) =>
                event.key === 'ArrowDown'
                  ? (previous + 1) % visibleSuggestions.length
                  : previous <= 0
                    ? visibleSuggestions.length - 1
                    : previous - 1,
              );
            }
          }}
          placeholder={compact ? '플레이어 이름 + 태그' : '플레이어 이름 + 태그를 입력해 주세요'}
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
        />

        <button type="submit">검색</button>
      </form>

      {suggestionsOpen && (
        <div className={styles.suggestions}>
          {showingHistory && (
            <div className={styles.historyHeading}>
              <span>최근 검색</span>
              {recentSearches.length > 0 && (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearSearchHistory}
                >
                  전체 삭제
                </button>
              )}
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-label={showingHistory ? '최근 검색 기록' : '소환사 검색 추천'}
            className={styles.suggestionList}
          >
            {visibleSuggestions.map((summoner, index) => (
              <button
                key={`${summoner.gameName}#${summoner.tagLine}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={activeSuggestion === index}
                tabIndex={-1}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(summoner)}
                className={styles.suggestion}
              >
                <span className={styles.suggestionName}>
                  {summoner.gameName}
                  <span className={styles.tag}>#{summoner.tagLine}</span>
                </span>
              </button>
            ))}
          </div>
          {showingHistory && recentSearches.length === 0 && (
            <p className={styles.historyEmpty} role="status">
              최근 검색 기록이 없습니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
