"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bookmark, ArrowRight } from "lucide-react";
import { AppShell, HeatScore, TopAppBar } from "@/components/app-chrome";
import { getArticleHeatScore, type Article, type Topic } from "@/lib/radar-data";

type SavedArticlesResponse = {
  articles?: Article[];
};

export function SavedScreen({ articles, topics }: { articles: Article[]; topics: Topic[] }) {
  const [savedArticles, setSavedArticles] = useState(articles);

  useEffect(() => {
    setSavedArticles(articles);
  }, [articles]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSavedArticles() {
      try {
        const response = await fetch("/api/favorites?include=articles", {
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as SavedArticlesResponse;
        if (!cancelled && Array.isArray(payload.articles)) {
          setSavedArticles(payload.articles);
        }
      } catch {
        // The server-rendered list remains usable if this background refresh fails.
      }
    }

    void refreshSavedArticles();
    const retryTimer = window.setTimeout(refreshSavedArticles, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  return (
    <AppShell>
      <TopAppBar />

      <section className="page-heading">
        <h1>收藏</h1>
        <p>你保存下来、值得回头复读的洞察。</p>
      </section>

      <section className="saved-grid" aria-label="收藏文章">
        {savedArticles.map((article) => (
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

        {savedArticles.length === 0 && (
          <div className="empty-card">
            <strong>还没有收藏。</strong>
            <p>在文章卡片或详情页点收藏后，会出现在这里。</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
