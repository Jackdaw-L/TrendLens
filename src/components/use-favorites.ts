"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appSecretHeaders } from "@/lib/app-secret";
import type { Article } from "@/lib/radar-data";

type FavoriteResponse = {
  articleIds?: string[];
};

type RequestError = Error & { status?: number };

function toArticleId(articleOrId: Article | string) {
  return typeof articleOrId === "string" ? articleOrId : articleOrId.id;
}

export function favoriteErrorMessage(error: unknown) {
  const status = (error as RequestError | null)?.status;
  if (status === 401) return "口令不正确，请到设置页保存操作口令";
  if (status === 503) return "服务端未配置口令，暂时无法收藏";
  return "收藏失败，请稍后重试";
}

export function useFavorites(initialArticleIds: string[] = []) {
  const initialKey = initialArticleIds.join("\n");
  const [favoriteIds, setFavoriteIds] = useState(initialArticleIds);

  useEffect(() => {
    setFavoriteIds(initialKey ? initialKey.split("\n") : []);
  }, [initialKey]);

  useEffect(() => {
    let cancelled = false;

    async function syncFavorites() {
      try {
        const response = await fetch("/api/favorites", {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as FavoriteResponse;
        if (!cancelled && Array.isArray(payload.articleIds)) {
          setFavoriteIds(payload.articleIds);
        }
      } catch {
        // Favoriting remains optimistic if the background sync is unavailable.
      }
    }

    void syncFavorites();

    return () => {
      cancelled = true;
    };
  }, []);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const isFavorite = useCallback((articleId: string) => favoriteSet.has(articleId), [favoriteSet]);

  const toggleFavorite = useCallback(
    async (articleOrId: Article | string) => {
      const articleId = toArticleId(articleOrId);
      const shouldSave = !favoriteSet.has(articleId);

      setFavoriteIds((current) => {
        const next = new Set(current);
        if (shouldSave) {
          next.add(articleId);
        } else {
          next.delete(articleId);
        }
        return [...next];
      });

      try {
        const response = await fetch("/api/favorites", {
          method: shouldSave ? "POST" : "DELETE",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            ...appSecretHeaders(),
          },
          body: JSON.stringify({ articleId }),
        });

        if (!response.ok) {
          const error = new Error(await response.text()) as RequestError;
          error.status = response.status;
          throw error;
        }
      } catch (error) {
        // 只回滚这一篇的变更，避免并发切换时覆盖其他文章的状态。
        setFavoriteIds((current) =>
          shouldSave ? current.filter((id) => id !== articleId) : [...new Set([...current, articleId])],
        );
        throw error;
      }
    },
    [favoriteSet],
  );

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
  };
}
