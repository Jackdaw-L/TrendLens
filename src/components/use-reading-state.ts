"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StoredReadingState = {
  read: string[];
  lastRefreshAt?: string;
};

const STORAGE_KEY = "trendlens.reading-state.v1";

function readStoredState(): StoredReadingState {
  if (typeof window === "undefined") {
    return { read: [] };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { read: [] };
    const parsed = JSON.parse(raw) as Partial<StoredReadingState>;
    return {
      read: Array.isArray(parsed.read) ? parsed.read : [],
      lastRefreshAt: parsed.lastRefreshAt,
    };
  } catch {
    return { read: [] };
  }
}

export function useReadingState() {
  const [state, setState] = useState<StoredReadingState>({
    read: [],
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to persist TrendLens reading state.", error);
    }
  }, [hydrated, state]);

  const readSet = useMemo(() => new Set(state.read), [state.read]);

  const markRead = useCallback((articleId: string) => {
    setState((current) => {
      if (current.read.includes(articleId)) return current;
      return {
        ...current,
        read: [...current.read, articleId],
      };
    });
  }, []);

  const markRefresh = useCallback(() => {
    setState((current) => ({
      ...current,
      lastRefreshAt: new Date().toISOString(),
    }));
  }, []);

  const isRead = useCallback((articleId: string) => readSet.has(articleId), [readSet]);

  return {
    read: state.read,
    lastRefreshAt: state.lastRefreshAt,
    isRead,
    markRead,
    markRefresh,
    hydrated,
  };
}
