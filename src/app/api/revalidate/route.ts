import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { loadFreshRadarDataset } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const configuredToken = process.env.TRENDLENS_REVALIDATE_TOKEN;
  const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (!configuredToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRENDLENS_REVALIDATE_TOKEN is not configured.",
      },
      { status: 503 },
    );
  }

  if (!providedToken || providedToken !== configuredToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  revalidateTag("trendlens-radar");
  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath("/settings");

  const dataset = await loadFreshRadarDataset();
  for (const article of dataset.articles) {
    revalidatePath(`/articles/${article.id}`);
  }

  return NextResponse.json(
    {
      ok: true,
      revalidatedAt: new Date().toISOString(),
      articles: dataset.articles.length,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
