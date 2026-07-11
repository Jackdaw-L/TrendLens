#!/usr/bin/env node
// TrendLens 每周画像任务：
// 1. 读取近 N 天阅读行为（收藏 / 已读 / 展示未读）与信源表现，生成兴趣画像和日推筛选策略，写入 trendlens_profile；
// 2. 按夹板自动微调信源权重（±0.2/次，范围 0.5~1.6，展示数不足的信源不动）；
// 3. 扫描信源健康度，连续失败的信源生成「建议删除」提案；
// 4. 基于画像让模型推荐新信源，实际验证 feed 可抓取后生成「建议新增」提案（最多 PROFILE_MAX_NEW_SOURCES 个）。
// 提案写入 trendlens_source_proposals，由用户在设置页确认后生效。
//
// 用法：node scripts/weekly-profile.mjs [--dry-run] [--window-days 14]
// --dry-run：正常读取数据和调用模型，但不写任何 Supabase 数据，只打印计划动作。
//
// 说明：本脚本刻意自包含（不从 pipeline.mjs import，那个文件 import 即执行主流程），
// loadEnv / DeepSeek 调用等小工具与 pipeline.mjs 存在少量重复，属有意为之。
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";

const cwd = process.cwd();
const logsDir = path.join(cwd, "data", "logs");
const promptDir = path.join(cwd, "prompts");
const cli = parseArgs(process.argv.slice(2));
const env = await loadEnv();

const dryRun = cli["dry-run"] === "true";
const windowDays = positiveInteger(cli["window-days"] ?? env.PROFILE_WINDOW_DAYS, 14);
const maxNewSources = positiveInteger(env.PROFILE_MAX_NEW_SOURCES, 2);
// 连续失败达到该次数的信源生成删除提案（按 run 计，每天 1 run 即约等于天数）。
const removeFailStreak = positiveInteger(env.PROFILE_REMOVE_FAIL_STREAK, 7);
// 同一 url/信源在该天数内已有提案（含被忽略的）时不再重复提案。
const proposalCooldownDays = positiveInteger(env.PROFILE_PROPOSAL_COOLDOWN_DAYS, 30);

const supabase = createSupabaseClient();
if (!supabase) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SECRET_KEY 配置，画像任务无法运行。");
  process.exit(1);
}

await fs.mkdir(logsDir, { recursive: true });

const summary = {
  command: "weekly-profile",
  dryRun,
  windowDays,
  generatedAt: new Date().toISOString(),
};

// ---------- 1. 收集行为数据 ----------
const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

const sources = await fetchAll("trendlens_sources", "id,name,url,category,language,weight,enabled");
const runs = await fetchAll(
  "trendlens_radar_runs",
  "id,mode,generated_at,sources_snapshot",
  (query) => query.gte("generated_at", cutoff).order("generated_at", { ascending: false }),
);
const shownArticles = await fetchAll(
  "trendlens_articles",
  "id,title,source,category,created_at,trendlens_radar_runs!inner(mode)",
  (query) =>
    query
      .in("trendlens_radar_runs.mode", ["deepseek", "friday"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false }),
);
const readRows = await fetchAll("trendlens_read_articles", "article_id,read_at");
const savedRows = await fetchAll(
  "trendlens_saved_articles",
  "article_id,saved_at,article_snapshot",
  (query) => query.order("saved_at", { ascending: false }),
);
const previousProfile = await fetchLatestProfile();
const recentProposals = await fetchRecentProposals();

// ---------- 2. 机械统计 ----------
const readIds = new Set(readRows.map((row) => String(row.article_id)));
const shownById = new Map();
for (const article of shownArticles) {
  if (!shownById.has(String(article.id))) shownById.set(String(article.id), article);
}
const shown = [...shownById.values()];
const readShown = shown.filter((article) => readIds.has(String(article.id)));
const unreadShown = shown.filter((article) => !readIds.has(String(article.id)));
const savedRecent = savedRows.filter((row) => String(row.saved_at ?? "") >= cutoff);

const sourceStats = sources.map((source) => {
  const shownForSource = shown.filter((article) => article.source === source.name);
  const readForSource = shownForSource.filter((article) => readIds.has(String(article.id)));
  const savedForSource = savedRecent.filter(
    (row) => row.article_snapshot && row.article_snapshot.source === source.name,
  );
  return {
    id: source.id,
    name: source.name,
    enabled: source.enabled !== false,
    currentWeight: Number(source.weight ?? 1),
    shownCount: shownForSource.length,
    readCount: readForSource.length,
    favoriteCount: savedForSource.length,
  };
});

const behaviorStats = {
  windowDays,
  totals: {
    shownArticles: shown.length,
    readArticles: readShown.length,
    favoritedInWindow: savedRecent.length,
    favoritedAllTime: savedRows.length,
  },
  favorited: savedRecent.slice(0, 20).map((row) => ({
    title: row.article_snapshot?.title ?? row.article_id,
    source: row.article_snapshot?.source ?? "",
    category: row.article_snapshot?.category ?? "",
  })),
  readTitles: readShown.slice(0, 30).map((article) => ({
    title: article.title,
    source: article.source,
    category: article.category,
  })),
  shownUnreadTitles: unreadShown.slice(0, 30).map((article) => ({
    title: article.title,
    source: article.source,
    category: article.category,
  })),
  sourceStats,
};

summary.stats = behaviorStats.totals;

// ---------- 3. 信源健康度（机械判定，不走模型） ----------
const healthBySource = computeSourceHealth(runs, sources);
const removeCandidates = healthBySource.filter(
  (health) =>
    health.failStreak >= removeFailStreak &&
    !hasRecentProposal(recentProposals, { sourceId: health.id }),
);

// ---------- 4. 模型生成画像 ----------
const { systemPrompt, userPrompt } = await loadPromptPair("profile", {
  sources_json: JSON.stringify(
    sources.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      category: source.category,
      language: source.language,
      weight: Number(source.weight ?? 1),
      enabled: source.enabled !== false,
    })),
  ),
  stats_json: JSON.stringify(behaviorStats),
  previous_profile: previousProfile?.profile_text
    ? `${previousProfile.profile_text}\n\n（上一版筛选策略）\n${previousProfile.selection_guidance ?? ""}`
    : "（无：这是首次生成画像。）",
  window_days: String(windowDays),
  max_new_sources: String(maxNewSources),
});

const modelOutput = await callDeepSeekJson({ systemPrompt, userPrompt, stage: "profile" });

const profileText = String(modelOutput.profileText ?? "").trim();
const selectionGuidance = (Array.isArray(modelOutput.selectionGuidance) ? modelOutput.selectionGuidance : [])
  .map((line) => String(line).trim())
  .filter(Boolean)
  .map((line, index) => `${index + 1}. ${line}`)
  .join("\n");

if (!profileText) {
  console.error("模型未返回 profileText，本次不更新画像。原始返回：", JSON.stringify(modelOutput).slice(0, 500));
  process.exit(1);
}

// ---------- 5. 权重微调（夹板内自动生效） ----------
const weightPlan = [];
const statsById = new Map(sourceStats.map((stat) => [stat.id, stat]));
for (const adjustment of Array.isArray(modelOutput.weightAdjustments) ? modelOutput.weightAdjustments : []) {
  const id = String(adjustment?.id ?? "");
  const source = sources.find((item) => String(item.id) === id);
  const stat = statsById.get(id);
  if (!source || source.enabled === false) continue;
  if (!stat || stat.shownCount < 5) continue; // 证据不足不调

  const current = Number(source.weight ?? 1);
  const requested = Number(adjustment.weight);
  if (!Number.isFinite(requested)) continue;

  // 夹板：单次变化 ≤ 0.2，绝对范围 0.5 ~ 1.6。
  const bounded = Math.min(current + 0.2, Math.max(current - 0.2, requested));
  const next = Math.round(Math.min(1.6, Math.max(0.5, bounded)) * 100) / 100;
  if (Math.abs(next - current) < 0.01) continue;

  weightPlan.push({ id, name: source.name, from: current, to: next, reason: String(adjustment.reason ?? "") });
}

// ---------- 6. 新信源候选验证（实际抓 feed，抓不到不提案） ----------
const existingUrls = new Set(sources.map((source) => normalizeFeedUrl(source.url)));
const addCandidates = [];
for (const candidate of (Array.isArray(modelOutput.newSourceCandidates) ? modelOutput.newSourceCandidates : []).slice(0, 4)) {
  if (addCandidates.length >= maxNewSources) break;
  const name = String(candidate?.name ?? "").trim();
  const rawUrl = String(candidate?.url ?? "").trim();
  if (!name || !rawUrl) continue;
  if (hasRecentProposal(recentProposals, { url: rawUrl, name })) continue;

  const validated = await validateFeed(rawUrl);
  if (!validated) {
    console.warn(`[proposal] 候选信源 feed 验证失败，跳过：${name} (${rawUrl})`);
    continue;
  }
  if (existingUrls.has(normalizeFeedUrl(validated.feedUrl))) continue;
  if (hasRecentProposal(recentProposals, { url: validated.feedUrl })) continue;

  addCandidates.push({
    id: uniqueSourceId(slug(name), sources),
    name,
    url: validated.feedUrl,
    category: normalizeCategory(candidate.category),
    language: candidate.language === "zh" ? "zh" : "en",
    weight: 1,
    reason: String(candidate.reason ?? ""),
    evidence: { itemCount: validated.itemCount, latestItemAt: validated.latestItemAt, probedFrom: rawUrl },
  });
}

// ---------- 7. 落库 ----------
summary.profile = { chars: profileText.length, guidanceLines: selectionGuidance.split("\n").length };
summary.weightAdjustments = weightPlan;
summary.removeProposals = removeCandidates.map((health) => ({ id: health.id, failStreak: health.failStreak }));
summary.addProposals = addCandidates.map((candidate) => ({ id: candidate.id, url: candidate.url }));

if (dryRun) {
  summary.note = "dry-run：以上动作均未写入 Supabase。";
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const { error: profileError } = await supabase.from("trendlens_profile").insert({
  generated_at: new Date().toISOString(),
  window_days: windowDays,
  profile_text: profileText,
  selection_guidance: selectionGuidance,
  stats: behaviorStats,
  raw: modelOutput,
});
if (profileError) {
  console.error(`写入画像失败：${profileError.message}`);
  process.exit(1);
}

for (const adjustment of weightPlan) {
  const { error } = await supabase
    .from("trendlens_sources")
    .update({ weight: adjustment.to, updated_at: new Date().toISOString() })
    .eq("id", adjustment.id);
  if (error) console.warn(`[weights] 更新 ${adjustment.id} 权重失败：${error.message}`);
}

const proposalRows = [
  ...removeCandidates.map((health) => ({
    type: "remove",
    source_id: health.id,
    name: health.name,
    url: health.url,
    reason: `连续 ${health.failStreak} 次抓取失败${health.lastSuccessAt ? `，最近一次成功是 ${health.lastSuccessAt.slice(0, 10)}` : "，窗口内没有成功记录"}。建议删除；若想保留可忽略本条。`,
    evidence: { failStreak: health.failStreak, lastSuccessAt: health.lastSuccessAt, lastError: health.lastError },
  })),
  ...addCandidates.map((candidate) => ({
    type: "add",
    source_id: candidate.id,
    name: candidate.name,
    url: candidate.url,
    category: candidate.category,
    language: candidate.language,
    weight: candidate.weight,
    reason: candidate.reason,
    evidence: candidate.evidence,
  })),
];

if (proposalRows.length > 0) {
  const { error } = await supabase.from("trendlens_source_proposals").insert(proposalRows);
  if (error) console.warn(`[proposal] 写入信源提案失败：${error.message}`);
}

console.log(JSON.stringify(summary, null, 2));

// ---------- helpers ----------

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

async function loadEnv() {
  const fileEnv = {};
  for (const file of [".env", ".env.local"]) {
    try {
      const raw = await fs.readFile(path.join(cwd, file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        fileEnv[key] = value;
      }
    } catch {}
  }
  return { ...fileEnv, ...process.env };
}

function createSupabaseClient() {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fetchAll(table, columns, refine) {
  let query = supabase.from(table).select(columns);
  if (refine) query = refine(query);
  const { data, error } = await query;
  if (error) {
    console.warn(`[data] 读取 ${table} 失败：${error.message}`);
    return [];
  }
  return data ?? [];
}

async function fetchLatestProfile() {
  const { data, error } = await supabase
    .from("trendlens_profile")
    .select("profile_text, selection_guidance, generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[data] 读取上一版画像失败（首次运行属正常）：${error.message}`);
    return null;
  }
  return data;
}

async function fetchRecentProposals() {
  const proposalCutoff = new Date(Date.now() - proposalCooldownDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("trendlens_source_proposals")
    .select("source_id,name,url,status,created_at")
    .gte("created_at", proposalCutoff);
  if (error) {
    console.warn(`[data] 读取历史提案失败（首次运行属正常）：${error.message}`);
    return [];
  }
  return data ?? [];
}

function hasRecentProposal(proposals, { sourceId, url, name }) {
  const normalizedUrl = url ? normalizeFeedUrl(url) : null;
  return proposals.some((proposal) => {
    if (sourceId && String(proposal.source_id) === String(sourceId)) return true;
    if (normalizedUrl && proposal.url && normalizeFeedUrl(proposal.url) === normalizedUrl) return true;
    if (name && proposal.name && proposal.name.toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
}

// 从每个 run 的 sources_snapshot 里回放各信源状态，计算「从最新 run 起连续失败次数」。
function computeSourceHealth(runRows, sourceRows) {
  const health = new Map(
    sourceRows
      .filter((source) => source.enabled !== false)
      .map((source) => [
        source.id,
        { id: source.id, name: source.name, url: source.url, failStreak: 0, streakBroken: false, lastSuccessAt: null, lastError: null },
      ]),
  );

  for (const run of runRows) {
    const snapshot = Array.isArray(run.sources_snapshot) ? run.sources_snapshot : [];
    for (const entry of snapshot) {
      const item = health.get(String(entry.id));
      if (!item) continue;
      const failed = entry.status === "failed";
      if (failed) {
        if (!item.streakBroken) item.failStreak += 1;
        if (!item.lastError) item.lastError = entry.error ?? null;
      } else {
        item.streakBroken = true;
        if (!item.lastSuccessAt) item.lastSuccessAt = String(run.generated_at ?? "");
      }
    }
  }

  return [...health.values()];
}

async function validateFeed(rawUrl) {
  const parser = new Parser();
  const candidates = buildFeedCandidates(rawUrl);

  for (const feedUrl of candidates) {
    try {
      const response = await fetchWithTimeout(feedUrl, 12000);
      if (!response.ok) continue;
      const xml = await response.text();
      const feed = await parser.parseString(xml);
      const items = feed.items ?? [];
      if (items.length === 0) continue;
      return {
        feedUrl,
        itemCount: items.length,
        latestItemAt: items[0]?.isoDate ?? items[0]?.pubDate ?? null,
      };
    } catch {}
  }
  return null;
}

function buildFeedCandidates(rawUrl) {
  const candidates = [];
  try {
    const url = new URL(rawUrl);
    candidates.push(url.toString());
    // 模型给的 url 不一定是 feed 本身，补几个常见 feed 路径兜底。
    const origin = `${url.protocol}//${url.host}`;
    for (const suffix of ["/feed", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml", "/rss"]) {
      const candidate = `${origin}${suffix}`;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  } catch {
    return [];
  }
  return candidates.slice(0, 6);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) TrendLens/0.1 RSS reader",
        accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPromptPair(stage, variables) {
  const systemPromptPath = path.resolve(env.LLM_PROFILE_SYSTEM_PROMPT_PATH ?? path.join(promptDir, `${stage}-system.md`));
  const userPromptPath = path.resolve(env.LLM_PROFILE_USER_PROMPT_PATH ?? path.join(promptDir, `${stage}-user.md`));
  const [systemPrompt, userTemplate] = await Promise.all([
    fs.readFile(systemPromptPath, "utf8"),
    fs.readFile(userPromptPath, "utf8"),
  ]);

  let userPrompt = userTemplate;
  for (const [key, value] of Object.entries(variables)) {
    userPrompt = userPrompt.replaceAll(`{{${key}}}`, value);
  }
  return { systemPrompt: systemPrompt.trim(), userPrompt: userPrompt.trim() };
}

async function callDeepSeekJson({ systemPrompt, userPrompt, stage }) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new Error("缺少 DEEPSEEK_API_KEY 配置。");
  }

  const maxAttempts = positiveInteger(env.DEEPSEEK_ATTEMPTS, 2);
  const timeoutMs = positiveInteger(env.DEEPSEEK_TIMEOUT_MS, 180000);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = new Date().toISOString();
    try {
      const requestBody = {
        model: env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
        stream: false,
        max_tokens: Number(env.DEEPSEEK_MAX_TOKENS ?? 12000),
        response_format: { type: "json_object" },
        thinking: { type: env.DEEPSEEK_THINKING ?? "disabled" },
        temperature: Number(env.DEEPSEEK_TEMPERATURE ?? 0.2),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      };
      const response = await fetch(env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`DeepSeek ${stage} HTTP ${response.status}: ${responseText.slice(0, 240)}`);

      const payload = JSON.parse(responseText);
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error(`DeepSeek ${stage} response missing content`);

      const parsed = parseJsonFromModel(content);
      await writeModelLog(stage, { startedAt, ok: true, modelMessageContent: content, parsedJson: parsed });
      return parsed;
    } catch (error) {
      lastError = error;
      await writeModelLog(stage, { startedAt, ok: false, error: normalizeError(error) });
      if (attempt < maxAttempts) await delay(2000 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`DeepSeek ${stage} failed`);
}

function parseJsonFromModel(content) {
  const withoutFence = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model output is not JSON");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

async function writeModelLog(stage, entry) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(logsDir, `deepseek-${stage}-${timestamp}-${crypto.randomUUID().slice(0, 8)}.json`);
  try {
    await fs.writeFile(filePath, `${JSON.stringify({ version: 1, stage, ...entry }, null, 2)}\n`);
  } catch {}
}

function normalizeCategory(category) {
  return ["official", "analysis", "media", "community", "product"].includes(category) ? category : "analysis";
}

function normalizeFeedUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function uniqueSourceId(base, sourceRows) {
  const existing = new Set(sourceRows.map((source) => String(source.id)));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function slug(value) {
  const base = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base || crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
