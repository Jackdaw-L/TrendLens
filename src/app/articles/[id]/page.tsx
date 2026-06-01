import { notFound } from "next/navigation";
import { ArticleScreen } from "@/components/article-screen";
import type { Article } from "@/lib/radar-data";
import { getRuntimeArticle } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

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

  return <ArticleScreen article={article} related={related} />;
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
