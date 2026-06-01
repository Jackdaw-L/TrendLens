"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type StoredReadingState = {
  favorites: string[];
  read: string[];
  lastRefreshAt?: string;
};

const STORAGE_KEY = "trendlens.reading-state.v1";

function readStoredState(): StoredReadingState {
  if (typeof window === "undefined") {
    return { favorites: [], read: [] };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { favorites: [], read: [] };
    const parsed = JSON.parse(raw) as Partial<StoredReadingState>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      read: Array.isArray(parsed.read) ? parsed.read : [],
      lastRefreshAt: parsed.lastRefreshAt,
    };
  } catch {
    return { favorites: [], read: [] };
  }
}

export function useReadingState() {
  const [state, setState] = useState<StoredReadingState>({
    favorites: [],
    read: [],
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const favoriteSet = useMemo(() => new Set(state.favorites), [state.favorites]);
  const readSet = useMemo(() => new Set(state.read), [state.read]);

  const toggleFavorite = useCallback((articleId: string) => {
    setState((current) => {
      const favorites = new Set(current.favorites);
      if (favorites.has(articleId)) {
        favorites.delete(articleId);
      } else {
        favorites.add(articleId);
      }

      return {
        ...current,
        favorites: [...favorites],
      };
    });
  }, []);

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

  return {
    favorites: state.favorites,
    read: state.read,
    lastRefreshAt: state.lastRefreshAt,
    isFavorite: (articleId: string) => favoriteSet.has(articleId),
    isRead: (articleId: string) => readSet.has(articleId),
    toggleFavorite,
    markRead,
    markRefresh,
    hydrated,
  };
}
