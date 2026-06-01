import { NextResponse } from "next/server";
import { loadRadarDataset } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const dataset = await loadRadarDataset();
  return NextResponse.json(dataset);
}
