#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", ".env.local"]) {
  try { process.loadEnvFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const kind = process.argv[2];
if (!["daily", "weekly"].includes(kind)) throw new Error("Expected daily or weekly");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const owner = `${process.env.GITHUB_RUN_ID ?? "local"}:${process.env.GITHUB_RUN_ATTEMPT ?? Date.now()}`;
const { data: job, error } = await db.rpc("trendlens_claim_job", {
  p_kind: kind, p_job_id: process.env.TRENDLENS_JOB_ID || null, p_owner: owner,
});
if (error) throw new Error(`无法领取更新任务：${error.message}`);
if (!job.acquired) {
  console.log(`[job] ${job.reason}`);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, "executed=false\n");
  process.exit(0);
}
const childEnv = {
  ...process.env,
  TRENDLENS_JOB_ID: job.id,
  TRENDLENS_SCHEDULED: job.is_scheduled ? "1" : "0",
  TRENDLENS_REQUIRE_USAGE: "1",
  TRENDLENS_REQUIRE_SUCCESS: "1",
};
let failure;
try {
  const script = kind === "daily" ? "scripts/pipeline.mjs" : "scripts/weekly-profile.mjs";
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: childEnv, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      resolve(signal ? 1 : code ?? 1);
    });
  });
  if (code !== 0) throw new Error(`任务执行失败（退出码 ${code}），详情见 GitHub Actions 日志。`);
} catch (error) {
  failure = error;
}
const { error: finishError } = await db.rpc("trendlens_finish_job", {
  p_job_id: job.id, p_owner: owner, p_succeeded: !failure, p_error: failure?.message ?? null,
});
if (finishError) throw new Error(`无法保存任务完成状态：${finishError.message}`);
if (failure) throw failure;
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, "executed=true\n");
console.log(`[job] ${kind} succeeded (${job.id})`);
