import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireWriteSecret } from "@/lib/api-auth";
import { findArticleForSaving, loadSavedArticleIds, loadSavedArticles } from "@/lib/radar-store";
import { getSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function jsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function readArticleId(request: NextRequest) {
  try {
    const body = (await request.json()) as { articleId?: unknown };
    return typeof body.articleId === "string" && body.articleId.trim() ? body.articleId.trim() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const includeArticles = request.nextUrl.searchParams.get("include") === "articles";
  const [articleIds, articles] = await Promise.all([
    loadSavedArticleIds(),
    includeArticles ? loadSavedArticles() : Promise.resolve(undefined),
  ]);

  return jsonResponse(includeArticles ? { articleIds, articles } : { articleIds });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  const articleId = await readArticleId(request);
  if (!articleId) return jsonResponse({ error: "articleId is required." }, 400);

  const supabase = getSupabaseAdminClient();
  if (!supabase) return jsonResponse({ error: "Supabase is not configured." }, 503);

  const result = await findArticleForSaving(articleId);
  if (!result) return jsonResponse({ error: "Article not found." }, 404);

  const { error } = await supabase.from("trendlens_saved_articles").upsert(
    {
      article_id: result.article.id,
      source_run_id: result.runId,
      article_snapshot: result.article,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "article_id",
    },
  );

  if (error) return jsonResponse({ error: error.message }, 500);

  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath(`/articles/${result.article.id}`);

  return jsonResponse({ ok: true, articleId: result.article.id });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  const articleId = await readArticleId(request);
  if (!articleId) return jsonResponse({ error: "articleId is required." }, 400);

  const supabase = getSupabaseAdminClient();
  if (!supabase) return jsonResponse({ error: "Supabase is not configured." }, 503);

  const { error } = await supabase.from("trendlens_saved_articles").delete().eq("article_id", articleId);
  if (error) return jsonResponse({ error: error.message }, 500);

  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath(`/articles/${articleId}`);

  return jsonResponse({ ok: true, articleId });
}
