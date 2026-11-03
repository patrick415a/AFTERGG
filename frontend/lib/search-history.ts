export type RecentSearch = { gameName: string; tagLine: string };

export const SEARCH_HISTORY_KEY = 'aftergg-recent-searches';
export const SEARCH_HISTORY_EVENT = 'aftergg-search-history-change';
const HISTORY_LIMIT = 10;
let memoryHistory: RecentSearch[] = [];
let memoryOnly = false;

function normalizeHistory(value: unknown): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const history: RecentSearch[] = [];
  for (const item of value) {
    if (typeof item?.gameName !== 'string' || typeof item?.tagLine !== 'string') continue;
    const gameName = item.gameName.trim();
    const tagLine = item.tagLine.trim();
    if (!gameName || !tagLine || gameName.length > 100 || tagLine.length > 20) continue;
    const key = JSON.stringify([gameName.toLowerCase(), tagLine.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    history.push({ gameName, tagLine });
    if (history.length === HISTORY_LIMIT) break;
  }
  return history;
}

export function readSearchHistory(): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  if (memoryOnly) return memoryHistory;
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(SEARCH_HISTORY_KEY);
  } catch {
    memoryOnly = true;
    return memoryHistory;
  }
  try {
    memoryHistory = normalizeHistory(JSON.parse(stored || '[]'));
  } catch {
    memoryHistory = [];
  }
  return memoryHistory;
}

export function rememberSearch(summoner: RecentSearch) {
  const history = normalizeHistory([summoner, ...readSearchHistory()]);
  memoryHistory = history;
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // 저장이 제한되어도 현재 탭에서는 검색 기록을 사용할 수 있습니다.
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(SEARCH_HISTORY_EVENT));
}

export function clearSearchHistory() {
  memoryHistory = [];
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
    memoryOnly = false;
  } catch {
    // 저장소에 접근하지 못하더라도 메모리 기록은 지웁니다.
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(SEARCH_HISTORY_EVENT));
}
