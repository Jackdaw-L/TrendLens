"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Bookmark, ArrowRight } from "lucide-react";
import { AppShell, HeatScore, TopAppBar } from "@/components/app-chrome";
import { useReadingState } from "@/components/use-reading-state";
import { getArticleHeatScore, type Article, type Topic } from "@/lib/radar-data";

export function SavedScreen({ articles, topics }: { articles: Article[]; topics: Topic[] }) {
  const reading = useReadingState();
  const { favorites, getFavoriteArticle, hydrated, rememberFavoriteArticles } = reading;
  const currentArticleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);

  useEffect(() => {
    rememberFavoriteArticles(articles);
  }, [articles, rememberFavoriteArticles]);

  const saved = favorites
    .map((articleId) => getFavoriteArticle(articleId) ?? currentArticleById.get(articleId))
    .filter((article): article is Article => Boolean(article));

  return (
    <AppShell>
      <TopAppBar />

      <section className="page-heading">
        <h1>收藏</h1>
        <p>你保存下来、值得回头复读的洞察。</p>
      </section>

      <section className="saved-grid" aria-label="收藏文章">
        {saved.map((article) => (
          <Link className="saved-card" href={`/articles/${article.id}`} key={article.id} prefetch>
            <div className="saved-card__meta">
              <span className="source-chip">{article.source}</span>
              <HeatScore value={getArticleHeatScore(article, topics)} />
              <Bookmark aria-hidden fill="currentColor" size={20} />
            </div>
            <h2>{article.title}</h2>
            <p>{article.oneSentence}</p>
            <footer>
              <span>已收藏</span>
              <strong>
                阅读
                <ArrowRight aria-hidden size={16} />
              </strong>
            </footer>
          </Link>
        ))}

        {!hydrated && (
          <div className="empty-card">
            <strong>正在读取收藏。</strong>
            <p>稍等一下。</p>
          </div>
        )}

        {hydrated && saved.length === 0 && (
          <div className="empty-card">
            <strong>还没有收藏。</strong>
            <p>在文章卡片或详情页点收藏后，会出现在这里。</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
