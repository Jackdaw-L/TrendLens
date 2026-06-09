"use client";

import { AppShell, HeaderBar } from "@/components/app-chrome";
import { ArticleScreen } from "@/components/article-screen";
import { useReadingState } from "@/components/use-reading-state";

export function SavedArticleFallback({ articleId }: { articleId: string }) {
  const reading = useReadingState();
  const article = reading.getFavoriteArticle(articleId);
  const related = reading.favoriteArticles
    .map((snapshot) => snapshot.article)
    .filter((item) => item.id !== articleId)
    .slice(0, 3);

  if (!reading.hydrated) {
    return (
      <AppShell className="article-shell">
        <HeaderBar />
        <section className="empty-card">
          <strong>正在读取收藏。</strong>
          <p>稍等一下。</p>
        </section>
      </AppShell>
    );
  }

  if (!article) {
    return (
      <AppShell className="article-shell">
        <HeaderBar />
        <section className="empty-card">
          <strong>没有找到这篇文章。</strong>
          <p>它不在当前推荐里，也没有保存过本地收藏快照。</p>
        </section>
      </AppShell>
    );
  }

  return <ArticleScreen article={article} related={related} />;
}
