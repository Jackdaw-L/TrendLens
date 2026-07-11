import { NextRequest, NextResponse } from "next/server";
import { requireWriteSecret } from "@/lib/api-auth";
import {
  deleteSource,
  loadSourceConfigs,
  setSourceEnabled,
} from "@/lib/source-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await loadSourceConfigs();
  return NextResponse.json({ sources });
}

export async function PATCH(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  const payload = (await request.json()) as Partial<{ id: string; enabled: boolean }>;

  if (!payload.id || typeof payload.enabled !== "boolean") {
    return NextResponse.json({ error: "id and enabled are required" }, { status: 400 });
  }

  const sources = await setSourceEnabled(payload.id, payload.enabled);
  return NextResponse.json({ sources });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  const payload = (await request.json()) as Partial<{ id: string }>;

  if (!payload.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const sources = await deleteSource(payload.id);
  return NextResponse.json({ sources });
}
