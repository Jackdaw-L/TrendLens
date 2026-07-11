import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const SECRET_HEADER = "x-trendlens-secret";
const LEGACY_SECRET_HEADER = "x-trendlens-trigger-secret";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function secretsMatch(provided: string, configured: string) {
  return timingSafeEqual(digest(provided), digest(configured));
}

export function getConfiguredWriteSecret() {
  return process.env.TRENDLENS_TRIGGER_SECRET?.trim() || null;
}

export function readProvidedSecret(request: Request) {
  return (
    request.headers.get(SECRET_HEADER)?.trim() ||
    request.headers.get(LEGACY_SECRET_HEADER)?.trim() ||
    ""
  );
}

/**
 * 校验写操作口令（收藏、信息源管理、已读同步、更新触发共用 TRENDLENS_TRIGGER_SECRET）。
 * 返回 null 表示通过；否则返回应直接回给客户端的错误响应。
 * 未配置口令时拒绝所有写操作（安全默认）。
 */
export function requireWriteSecret(request: Request): NextResponse | null {
  const configured = getConfiguredWriteSecret();
  if (!configured) {
    return NextResponse.json(
      { error: "TRENDLENS_TRIGGER_SECRET is not configured; write operations are disabled." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const provided = readProvidedSecret(request);
  if (!provided || !secretsMatch(provided, configured)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return null;
}
