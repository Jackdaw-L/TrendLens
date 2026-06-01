"use client";

import Link from "next/link";
import { Lightbulb, Clock3, ArrowRight } from "lucide-react";
import {
  AppShell,
  BookmarkButton,
  HeatScore,
  RefreshButton,
  TopAppBar,
  formatDateTime,
} from "@/components/app-chrome";
import { useReadingState } from "@/components/use-reading-state";
import { getArticleHeatScore, type Article } from "@/lib/radar-data";
import type { RadarDataset } from "@/lib/radar-store";

export function HomeScreen({ dataset }: { dataset: RadarDataset }) {
  const reading = useReadingState();
  const articles = dataset.articles;
  const updatedAt = formatDateTime(dataset.generatedAt);

  return (
    <AppShell>
      <TopAppBar action={<RefreshButton onClick={reading.markRefresh} />} />

      <section className="dashboard-header" aria-label="今日推荐状态">
        <p className="sync-line">
          <span className="status-dot" aria-hidden />
          {dataStatusText(dataset, updatedAt)}
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
            heatScore={getArticleHeatScore(article, dataset.topics)}
            isFavorite={reading.isFavorite(article.id)}
            isRead={reading.isRead(article.id)}
            key={article.id}
            onToggleFavorite={() => reading.toggleFavorite(article.id)}
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

      <Link className="article-card__main" href={`/articles/${article.id}`}>
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
  if (dataset.mode === "friday") {
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
    return `${updatedAt} 已抓取 RSS，待 Friday 生成`;
  }

  return "当前为演示数据";
}
