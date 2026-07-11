import { NextRequest, NextResponse } from "next/server";
import { requireWriteSecret } from "@/lib/api-auth";
import { loadReadArticleIds, markArticlesRead } from "@/lib/reading-store";

export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 500;

function jsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET() {
  const articleIds = await loadReadArticleIds();
  return jsonResponse({ articleIds });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  let articleIds: string[] = [];
  try {
    const body = (await request.json()) as { articleIds?: unknown };
    if (Array.isArray(body.articleIds)) {
      articleIds = body.articleIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
    }
  } catch {}

  if (articleIds.length === 0) {
    return jsonResponse({ error: "articleIds is required." }, 400);
  }

  // 超长批次截断；客户端每次挂载会补传本地缺口，最终收敛。
  const batch = [...new Set(articleIds)].slice(0, MAX_BATCH_SIZE);
  const { error } = await markArticlesRead(batch);
  if (error) return jsonResponse({ error }, 500);

  return jsonResponse({ ok: true, count: batch.length });
}
