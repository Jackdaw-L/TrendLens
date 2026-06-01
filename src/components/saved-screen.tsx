"use client";

import Link from "next/link";
import { Bookmark, ArrowRight } from "lucide-react";
import { AppShell, HeatScore, TopAppBar } from "@/components/app-chrome";
import { useReadingState } from "@/components/use-reading-state";
import { getArticleHeatScore, type Article, type Topic } from "@/lib/radar-data";

export function SavedScreen({ articles, topics }: { articles: Article[]; topics: Topic[] }) {
  const reading = useReadingState();
  const saved = articles.filter((article) => reading.isFavorite(article.id));

  return (
    <AppShell>
      <TopAppBar />

      <section className="page-heading">
        <h1>收藏</h1>
        <p>你保存下来、值得回头复读的洞察。</p>
      </section>

      <section className="saved-grid" aria-label="收藏文章">
        {saved.map((article) => (
          <Link className="saved-card" href={`/articles/${article.id}`} key={article.id}>
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

        {saved.length === 0 && (
          <div className="empty-card">
            <strong>还没有收藏。</strong>
            <p>在文章卡片或详情页点收藏后，会出现在这里。</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
