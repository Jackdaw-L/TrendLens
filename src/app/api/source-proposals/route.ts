import { NextRequest, NextResponse } from "next/server";
import { requireWriteSecret } from "@/lib/api-auth";
import { loadPendingProposals, resolveProposal } from "@/lib/proposal-store";
import { loadSourceConfigs } from "@/lib/source-store";

export const dynamic = "force-dynamic";

function jsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET() {
  const proposals = await loadPendingProposals();
  return jsonResponse({ proposals });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireWriteSecret(request);
  if (unauthorized) return unauthorized;

  let payload: Partial<{ id: string; action: string }> = {};
  try {
    payload = (await request.json()) as Partial<{ id: string; action: string }>;
  } catch {}

  const action = payload.action === "accept" || payload.action === "dismiss" ? payload.action : null;
  if (!payload.id || !action) {
    return jsonResponse({ error: "id and action (accept|dismiss) are required." }, 400);
  }

  const result = await resolveProposal(payload.id, action);
  if (!result.ok) return jsonResponse({ error: result.error ?? "Failed to resolve proposal." }, 500);

  const [sources, proposals] = await Promise.all([loadSourceConfigs(), loadPendingProposals()]);
  return jsonResponse({ ok: true, sources, proposals });
}
