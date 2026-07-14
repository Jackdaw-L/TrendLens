"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Clock3, ArrowRight } from "lucide-react";
import {
  AppShell,
  BookmarkButton,
  HeatScore,
  RefreshButton,
  Toast,
  TopAppBar,
  formatDateTime,
} from "@/components/app-chrome";
import { favoriteErrorMessage, useFavorites } from "@/components/use-favorites";
import { useReadingState } from "@/components/use-reading-state";
import { getArticleHeatScore, type Article } from "@/lib/radar-data";
import type { RadarDataset } from "@/lib/radar-store";

// 首屏数据超过该时长时，挂载后自动拉一次最新（SW 秒开的可能是缓存的旧页面）。
const AUTO_REFRESH_STALE_MS = 10 * 60 * 1000;

export function HomeScreen({
  dataset,
  favoriteIds,
}: {
  dataset: RadarDataset;
  favoriteIds: string[];
}) {
  const reading = useReadingState();
  const favorites = useFavorites(favoriteIds);
  const { isRead, markRefresh } = reading;
  const [currentDataset, setCurrentDataset] = useState(dataset);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const articles = currentDataset.articles;
  const updatedAt = formatDateTime(currentDataset.generatedAt);

  useEffect(() => {
    setCurrentDataset(dataset);
  }, [dataset]);

  const refreshList = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      setRefreshing(true);
      if (!silent) setRefreshError(false);

      try {
        const response = await fetch(`/api/radar?refresh=${Date.now()}`, {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });
        if (!response.ok) throw new Error(await response.text());
        const nextDataset = (await response.json()) as RadarDataset;
        setCurrentDataset(nextDataset);
        setRefreshError(false);
        markRefresh();
      } catch {
        // 自动刷新失败保持静默：继续展示缓存内容即可（例如离线打开）。
        if (!silent) setRefreshError(true);
      } finally {
        setRefreshing(false);
      }
    },
    [markRefresh],
  );

  // SW 会先用缓存秒开页面（可能是昨天的推荐）：数据一旦偏旧就自动确认一次最新，
  // 刷新按钮的转圈和状态行时间戳的变化对用户可见，不做无预告的整页闪变。
  useEffect(() => {
    const generatedAt = new Date(dataset.generatedAt).getTime();
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > AUTO_REFRESH_STALE_MS) {
      void refreshList({ silent: true });
    }
  }, [dataset.generatedAt, refreshList]);

  return (
    <AppShell>
      <TopAppBar action={<RefreshButton busy={refreshing} onClick={() => void refreshList()} />} />

      <section className="dashboard-header" aria-label="今日推荐状态">
        <p className="sync-line">
          <span className="status-dot" aria-hidden />
          {refreshError ? "刷新失败，请稍后再试" : dataStatusText(currentDataset, updatedAt)}
        </p>
        <h1>
          今日推荐
          <span>科技 / 互联网 / 大模型</span>
        </h1>
      </section>

      <section className="article-feed" aria-label="推荐文章列表">
        {articles.map((article) => (
          <ArticleCard
            article={article}
            heatScore={getArticleHeatScore(article, currentDataset.topics)}
            isFavorite={favorites.isFavorite(article.id)}
            isRead={isRead(article.id)}
            key={article.id}
            onToggleFavorite={() => {
              favorites.toggleFavorite(article).catch((error) => setToast(favoriteErrorMessage(error)));
            }}
          />
        ))}

        {articles.length === 0 && (
          <div className="empty-card">
            <strong>今天还没有生成推荐。</strong>
            <p>运行 `npm run pipeline` 后，这里会直接展示处理后的文章列表。</p>
          </div>
        )}
      </section>

      <div className="caught-up">
        <span aria-hidden>∞</span>
        <p>今天先读到这里。</p>
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </AppShell>
  );
}

function ArticleCard({
  article,
  heatScore,
  isFavorite,
  isRead,
  onToggleFavorite,
}: {
  article: Article;
  heatScore: number;
  isFavorite: boolean;
  isRead: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <article className={`article-card ${isRead ? "is-read" : ""}`}>
      <header className="article-card__top">
        <div className="chip-row">
          <span className="source-chip">{article.source}</span>
          <HeatScore value={heatScore} />
        </div>
        <BookmarkButton active={isFavorite} onClick={onToggleFavorite} />
      </header>

      <Link className="article-card__main" href={`/articles/${article.id}`} prefetch>
        <h2>{article.title}</h2>
        <p className="article-card__sentence">{article.oneSentence}</p>

        <div className="recommend-box">
          <Lightbulb aria-hidden size={20} />
          <p>{article.whyRecommended || article.pmAngle || article.whyNow}</p>
        </div>

        <footer className="article-card__footer">
          <span>
            <Clock3 aria-hidden size={14} />
            {article.readingTime} 分钟阅读
          </span>
          <span className="read-link">
            阅读全文
            <ArrowRight aria-hidden size={16} />
          </span>
        </footer>
      </Link>
    </article>
  );
}

function dataStatusText(dataset: RadarDataset, updatedAt: string) {
  if (dataset.mode === "deepseek" || dataset.mode === "friday") {
    if (dataset.status.friday === "partial") {
      return `${updatedAt} 已同步，部分文章转写失败`;
    }
    if (dataset.status.friday === "failed") {
      return `${updatedAt} 已同步，文章转写失败`;
    }
    return dataset.status.fetch === "partial"
      ? `${updatedAt} 已同步，部分信源失败`
      : `${updatedAt} 已同步`;
  }

  if (dataset.mode === "fetched") {
    return `${updatedAt} 已抓取 RSS，待模型生成`;
  }

  return "当前为演示数据";
}
