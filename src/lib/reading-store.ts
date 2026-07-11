import { getSupabaseAdminClient } from "@/lib/supabase-server";

export async function loadReadArticleIds(): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase.from("trendlens_read_articles").select("article_id");

  if (error) {
    console.warn(`Failed to load TrendLens read articles from Supabase: ${error.message}`);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => row.article_id)
    .filter((articleId): articleId is string => typeof articleId === "string");
}

export async function markArticlesRead(articleIds: string[]): Promise<{ error: string | null }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const rows = articleIds.map((articleId) => ({ article_id: articleId }));
  // ignoreDuplicates 保留首次 read_at，重复标记不更新。
  const { error } = await supabase
    .from("trendlens_read_articles")
    .upsert(rows, { onConflict: "article_id", ignoreDuplicates: true });

  return { error: error?.message ?? null };
}
