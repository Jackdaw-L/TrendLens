"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article } from "@/lib/radar-data";

type FavoriteArticleSnapshot = {
  article: Article;
  savedAt: string;
};

type StoredReadingState = {
  favorites: string[];
  read: string[];
  lastRefreshAt?: string;
  favoriteArticles?: Record<string, FavoriteArticleSnapshot>;
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
      favoriteArticles: normalizeFavoriteArticles(parsed.favoriteArticles),
    };
  } catch {
    return { favorites: [], read: [] };
  }
}

function normalizeFavoriteArticles(value: unknown): Record<string, FavoriteArticleSnapshot> {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, FavoriteArticleSnapshot>>(
    (result, [key, snapshot]) => {
      if (!snapshot || typeof snapshot !== "object") return result;
      const candidate = snapshot as Partial<FavoriteArticleSnapshot> & Partial<Article>;
      const article = candidate.article ?? candidate;
      if (!article || typeof article !== "object" || typeof article.id !== "string") return result;

      result[key] = {
        article: normalizeArticleSnapshot(article as Article),
        savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date().toISOString(),
      };
      return result;
    },
    {},
  );
}

function normalizeArticleSnapshot(article: Article): Article {
  return {
    ...article,
    tags: Array.isArray(article.tags) ? article.tags : [],
    bodyBlocks: Array.isArray(article.bodyBlocks) ? article.bodyBlocks : [],
    annotations: Array.isArray(article.annotations) ? article.annotations : [],
    pmTakeaways: Array.isArray(article.pmTakeaways) ? article.pmTakeaways : [],
    relatedIds: Array.isArray(article.relatedIds) ? article.relatedIds : [],
    images: Array.isArray(article.images) ? article.images : [],
    heroImage: article.heroImage ?? null,
  };
}

function articleBodyScore(article?: Article) {
  if (!article) return 0;
  return article.bodyBlocks.reduce((total, block) => {
    if (block.type === "paragraph") return total + block.content.length;
    if (block.type === "quote") return total + block.sourceText.length;
    return total + 1;
  }, 0);
}

export function useReadingState() {
  const [state, setState] = useState<StoredReadingState>({
    favorites: [],
    read: [],
    favoriteArticles: {},
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

  const favoriteSet = useMemo(() => new Set(state.favorites), [state.favorites]);
  const readSet = useMemo(() => new Set(state.read), [state.read]);
  const favoriteArticles = useMemo(
    () =>
      state.favorites
        .map((articleId) => state.favoriteArticles?.[articleId])
        .filter((snapshot): snapshot is FavoriteArticleSnapshot => Boolean(snapshot)),
    [state.favoriteArticles, state.favorites],
  );

  const rememberFavoriteArticle = useCallback((article: Article) => {
    setState((current) => {
      if (!current.favorites.includes(article.id)) return current;

      const nextArticle = normalizeArticleSnapshot(article);
      const currentSnapshot = current.favoriteArticles?.[article.id];
      if (articleBodyScore(currentSnapshot?.article) >= articleBodyScore(nextArticle)) {
        return current;
      }

      return {
        ...current,
        favoriteArticles: {
          ...(current.favoriteArticles ?? {}),
          [article.id]: {
            article: nextArticle,
            savedAt: currentSnapshot?.savedAt ?? new Date().toISOString(),
          },
        },
      };
    });
  }, []);

  const rememberFavoriteArticles = useCallback((articles: Article[]) => {
    setState((current) => {
      const favorites = new Set(current.favorites);
      let changed = false;
      const favoriteArticles = { ...(current.favoriteArticles ?? {}) };

      for (const article of articles) {
        if (!favorites.has(article.id)) continue;
        const nextArticle = normalizeArticleSnapshot(article);
        const currentSnapshot = favoriteArticles[article.id];
        if (articleBodyScore(currentSnapshot?.article) >= articleBodyScore(nextArticle)) continue;

        favoriteArticles[article.id] = {
          article: nextArticle,
          savedAt: currentSnapshot?.savedAt ?? new Date().toISOString(),
        };
        changed = true;
      }

      return changed ? { ...current, favoriteArticles } : current;
    });
  }, []);

  const toggleFavorite = useCallback((articleOrId: Article | string) => {
    setState((current) => {
      const article = typeof articleOrId === "string" ? null : normalizeArticleSnapshot(articleOrId);
      const articleId = typeof articleOrId === "string" ? articleOrId : articleOrId.id;
      const favorites = new Set(current.favorites);
      const favoriteArticles = { ...(current.favoriteArticles ?? {}) };
      if (favorites.has(articleId)) {
        favorites.delete(articleId);
        delete favoriteArticles[articleId];
      } else {
        favorites.add(articleId);
        if (article) {
          favoriteArticles[articleId] = {
            article,
            savedAt: new Date().toISOString(),
          };
        }
      }

      return {
        ...current,
        favorites: [...favorites],
        favoriteArticles,
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

  const isFavorite = useCallback((articleId: string) => favoriteSet.has(articleId), [favoriteSet]);
  const isRead = useCallback((articleId: string) => readSet.has(articleId), [readSet]);
  const getFavoriteArticle = useCallback(
    (articleId: string) => state.favoriteArticles?.[articleId]?.article,
    [state.favoriteArticles],
  );
  const hasFavoriteArticleBody = useCallback(
    (articleId: string) => articleBodyScore(state.favoriteArticles?.[articleId]?.article) > 0,
    [state.favoriteArticles],
  );

  return {
    favorites: state.favorites,
    favoriteArticles,
    read: state.read,
    lastRefreshAt: state.lastRefreshAt,
    isFavorite,
    isRead,
    getFavoriteArticle,
    hasFavoriteArticleBody,
    toggleFavorite,
    rememberFavoriteArticle,
    rememberFavoriteArticles,
    markRead,
    markRefresh,
    hydrated,
  };
}
