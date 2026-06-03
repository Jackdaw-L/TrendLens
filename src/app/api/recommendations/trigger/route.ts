import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DispatchResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
      missing?: string[];
    };

const DEFAULT_REPO = "Jackdaw-L/TrendLens";
const DEFAULT_WORKFLOW = "daily-pipeline.yml";
const DEFAULT_REF = "main";
const TEMPORARY_TRIGGER_SECRET = "coffee";

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.TRENDLENS_TRIGGER_SECRET || TEMPORARY_TRIGGER_SECRET;
  const providedSecret = request.headers.get("x-trendlens-trigger-secret")?.trim();

  if (!providedSecret || providedSecret !== configuredSecret) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repo = process.env.GITHUB_ACTIONS_REPO || DEFAULT_REPO;
  const workflow = process.env.GITHUB_ACTIONS_WORKFLOW || DEFAULT_WORKFLOW;
  const ref = process.env.GITHUB_ACTIONS_REF || DEFAULT_REF;
  const missing: string[] = [];
  if (!token) missing.push("GITHUB_ACTIONS_TOKEN");

  if (missing.length > 0 || !token) {
    return json(
      {
        ok: false,
        error: "GitHub Actions trigger is not fully configured.",
        missing,
      },
      503,
    );
  }

  const payload = (await readJson(request)) as Partial<{ reason: string }>;
  const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: {
        reason: payload.reason || "settings-button",
        source: "trendlens-settings",
        triggered_at: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return json(
      {
        ok: false,
        error: details || `GitHub dispatch failed with ${response.status}.`,
      },
      response.status,
    );
  }

  return json({
    ok: true,
    message: "已启动更新推荐流程。",
  });
}

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(body: DispatchResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
