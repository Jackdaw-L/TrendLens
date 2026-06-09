"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article } from "@/lib/radar-data";

type FavoriteResponse = {
  articleIds?: string[];
};

function toArticleId(articleOrId: Article | string) {
  return typeof articleOrId === "string" ? articleOrId : articleOrId.id;
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
      const previousIds = favoriteIds;

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
          },
          body: JSON.stringify({ articleId }),
        });

        if (!response.ok) throw new Error(await response.text());
      } catch (error) {
        setFavoriteIds(previousIds);
        throw error;
      }
    },
    [favoriteIds, favoriteSet],
  );

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
  };
}
