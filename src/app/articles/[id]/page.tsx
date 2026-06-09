import { ArticleScreen } from "@/components/article-screen";
import type { Article } from "@/lib/radar-data";
import { getRuntimeArticle, loadRadarListDataset, loadSavedArticleIds } from "@/lib/radar-store";
import { notFound } from "next/navigation";

export const revalidate = 180;

export async function generateStaticParams() {
  const dataset = await loadRadarListDataset();
  return dataset.articles.map((article) => ({ id: article.id }));
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { article, dataset } = await getRuntimeArticle(id);

  if (!article) {
    notFound();
  }

  const related = getRelatedArticles(article, dataset.articles);
  const favoriteIds = await loadSavedArticleIds();

  return <ArticleScreen article={article} related={related} initialFavorite={favoriteIds.includes(article.id)} />;
}

function getRelatedArticles(article: Article, articles: Article[]) {
  const byId = new Map(articles.map((item) => [item.id, item]));
  const explicit = article.relatedIds
    .map((relatedId) => byId.get(relatedId))
    .filter((item): item is Article => Boolean(item));

  if (explicit.length > 0) return explicit.slice(0, 3);

  return articles
    .filter((item) => item.id !== article.id && item.topicId === article.topicId)
    .slice(0, 3);
}
