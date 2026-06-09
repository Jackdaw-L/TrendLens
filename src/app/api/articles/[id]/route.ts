import { NextRequest, NextResponse } from "next/server";
import { getRuntimeArticle } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } = await params;
  const { article } = await getRuntimeArticle(id);

  if (!article) {
    return NextResponse.json(
      { error: "Article not found." },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(article, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
