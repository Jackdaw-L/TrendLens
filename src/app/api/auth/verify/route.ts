import { NextRequest, NextResponse } from "next/server";
import { requireWriteSecret } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// 供设置页「操作口令」校验用：口令正确返回 ok，错误 401，服务端未配置 503。
export async function POST(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
