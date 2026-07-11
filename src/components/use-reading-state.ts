"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appSecretHeaders, hasAppSecret } from "@/lib/app-secret";

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

// 把已读 id 上报到 Supabase。没有保存口令时静默跳过（保持本地模式）；
// 上报失败也不影响本地状态，下次挂载会重新补传缺口。
async function pushReadArticleIds(articleIds: string[]) {
  if (articleIds.length === 0 || !hasAppSecret()) return;

  try {
    await fetch("/api/reading", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...appSecretHeaders(),
      },
      body: JSON.stringify({ articleIds }),
    });
  } catch {
    // 离线或服务不可用时保持本地已读状态即可。
  }
}

export function useReadingState() {
  const [state, setState] = useState<StoredReadingState>({
    read: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const readRef = useRef<string[]>([]);

  useEffect(() => {
    readRef.current = state.read;
  }, [state.read]);

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

  // 与服务端已读状态双向同步：拉取合并到本地，并把仅本地存在的 id 补传上去。
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function syncReadingState() {
      try {
        const response = await fetch("/api/reading", {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { articleIds?: unknown };
        if (cancelled || !Array.isArray(payload.articleIds)) return;

        const serverIds = payload.articleIds.filter((id): id is string => typeof id === "string");
        const serverSet = new Set(serverIds);
        const localOnly = readRef.current.filter((id) => !serverSet.has(id));
        if (localOnly.length > 0) void pushReadArticleIds(localOnly);

        setState((current) => {
          const merged = [...new Set([...current.read, ...serverIds])];
          if (merged.length === current.read.length) return current;
          return { ...current, read: merged };
        });
      } catch {
        // 拿不到服务端已读状态时，继续使用本地缓存。
      }
    }

    void syncReadingState();

    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  const readSet = useMemo(() => new Set(state.read), [state.read]);

  const markRead = useCallback((articleId: string) => {
    if (!readRef.current.includes(articleId)) {
      void pushReadArticleIds([articleId]);
    }
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
