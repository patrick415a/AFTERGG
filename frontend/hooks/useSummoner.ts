'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchAssets, fetchSummoner, type Assets, type SummonerData } from '@/lib/api';

export function useSummoner(riotId: string) {
  const [data, setData] = useState<SummonerData | null>(null);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const asError = (reason: unknown) =>
    reason instanceof ApiError ? reason : new ApiError('조회에 실패했습니다.', 'UNKNOWN', 0);

  useEffect(() => {
    let active = true;
    fetchAssets().then((value) => {
      if (active) setAssets(value);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const next = new AbortController();
    controller.current?.abort();
    controller.current = next;
    busy.current = true;
    setData(null);
    setError(null);
    setLoading(true);
    setUpdating(false);
    setLoadingMore(false);
    fetchSummoner(riotId, { signal: next.signal })
      .then((value) => {
        if (!next.signal.aborted) setData(value);
      })
      .catch((reason) => {
        if (!next.signal.aborted) setError(asError(reason));
      })
      .finally(() => {
        if (!next.signal.aborted) {
          busy.current = false;
          setLoading(false);
        }
      });
    return () => next.abort();
  }, [riotId, revision]);

  async function refresh() {
    if (busy.current) return;
    if (!data) {
      setRevision((value) => value + 1);
      return;
    }
    const current = controller.current;
    if (!current || current.signal.aborted) return;
    busy.current = true;
    setUpdating(true);
    setError(null);
    try {
      const next = await fetchSummoner(riotId, { signal: current.signal, refresh: true });
      if (!current.signal.aborted) setData(next);
    } catch (reason) {
      if (!current.signal.aborted) setError(asError(reason));
    } finally {
      if (!current.signal.aborted) {
        busy.current = false;
        setUpdating(false);
      }
    }
  }
  async function loadMore() {
    if (!data?.hasMore || busy.current) return;
    const current = controller.current;
    if (!current || current.signal.aborted) return;
    busy.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchSummoner(riotId, {
        page: data.page + 1,
        anchor: data.anchor,
        signal: current.signal,
      });
      if (!current.signal.aborted)
        setData((previous) => {
          if (!previous) return next;
          const ids = new Set(previous.matches.map((m) => m.matchId));
          return {
            ...next,
            updatedAt: previous.updatedAt,
            matches: [...previous.matches, ...next.matches.filter((m) => !ids.has(m.matchId))],
          };
        });
    } catch (reason) {
      if (!current.signal.aborted) setError(asError(reason));
    } finally {
      if (!current.signal.aborted) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }
  return { data, assets, error, loading, updating, loadingMore, refresh, loadMore };
}
