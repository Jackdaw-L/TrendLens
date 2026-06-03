import { NextResponse } from "next/server";
import { loadFreshRadarDataset } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const dataset = await loadFreshRadarDataset();
  return NextResponse.json(dataset, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
