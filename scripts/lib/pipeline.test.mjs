import test from "node:test";
import assert from "node:assert/strict";
import { isPeakTime, usageCost, requestDeepSeekJson } from "./deepseek-client.mjs";
import { assessSourceMaterial, rewriteRequirements, failedArticleIds } from "./article-quality.mjs";

test("Beijing peak boundaries and weekend pricing", () => {
  for (const [date, peak] of [
    ["2026-09-17T00:59:59Z", false], ["2026-09-17T01:00:00Z", true],
    ["2026-09-17T04:00:00Z", false], ["2026-09-17T06:00:00Z", true],
    ["2026-09-17T10:00:00Z", false], ["2026-09-19T01:00:00Z", false],
  ]) assert.equal(isPeakTime(date), peak, date);
});

test("cost accounts for cached input, output and unknown usage", () => {
  const usage = { prompt_tokens: 1e6, prompt_cache_hit_tokens: 400000, prompt_cache_miss_tokens: 600000, completion_tokens: 100000 };
  const off = usageCost(usage, "deepseek-v4-pro", "2026-09-17T00:00:00Z");
  assert.ok(Math.abs(off.estimated_cost_cny - 4.11) < 1e-8);
  assert.equal(usageCost(usage, "deepseek-v4-pro", "2026-09-17T01:00:00Z").estimated_cost_cny, off.estimated_cost_cny * 2);
  assert.equal(usageCost(null, "deepseek-v4-pro", new Date()).estimated_cost_cny, null);
  assert.equal(usageCost({ prompt_tokens: 100, completion_tokens: 50 }, "deepseek-v4-pro", new Date()).usage_known, false);
});

test("Flash pricing includes cached input and peak multiplier", () => {
  const usage = { prompt_tokens: 1e6, prompt_cache_hit_tokens: 400000, prompt_cache_miss_tokens: 600000, completion_tokens: 100000 };
  const off = usageCost(usage, "deepseek-flash", "2026-10-21T00:00:00Z");
  assert.equal(off.estimated_cost_cny, 1.008);
  assert.equal(off.rate_version, "deepseek-flash-2026-10-21");
  assert.equal(usageCost(usage, "deepseek-flash", "2026-10-21T01:00:00Z").estimated_cost_cny, 2.016);
  assert.equal(usageCost(null, "deepseek-flash", new Date()).estimated_cost_cny, null);
});

test("all task stages default to Flash with JSON and non-thinking mode", async () => {
  for (const stage of ["select", "rewrite", "review", "profile"]) {
    await requestDeepSeekJson({
      env: {}, stage, systemPrompt: "JSON", userPrompt: "JSON",
      writeLog: async () => {}, parseContent: JSON.parse,
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, "deepseek-flash");
        assert.deepEqual(body.thinking, { type: "disabled" });
        assert.equal(body.response_format.type, "json_object");
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      },
    });
  }
});

test("record billed usage even when model JSON is invalid", async () => {
  const rows = [];
  const db = { from: () => ({ upsert: async (row) => { rows.push(row); return { error: null }; } }) };
  await assert.rejects(requestDeepSeekJson({
    env: {}, supabase: db, stage: "review", systemPrompt: "", userPrompt: "",
    writeLog: async () => {}, parseContent: JSON.parse,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "invalid" } }],
      usage: { prompt_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 20, completion_tokens: 10 } })),
  }));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "started");
  assert.equal(rows[1].status, "failed");
  assert.equal(rows[1].usage_known, true);
  assert.equal(rows[1].completion_tokens, 10);
});

test("do not spend when required usage persistence fails", async () => {
  let called = false;
  await assert.rejects(requestDeepSeekJson({ env: { TRENDLENS_REQUIRE_USAGE: "1" },
    supabase: { from: () => ({ upsert: async () => ({ error: { message: "unavailable" } }) }) },
    stage: "select", systemPrompt: "", userPrompt: "", writeLog: async () => {}, parseContent: JSON.parse,
    fetchImpl: async () => { called = true; },
  }), /无法保存模型用量/);
  assert.equal(called, false);
});

test("subscription previews are excluded but a footer CTA on a full article is allowed", () => {
  assert.equal(assessSourceMaterial({ content: "Subscribe to continue reading. " + "Preview. ".repeat(90) }).eligible, false);
  assert.equal(assessSourceMaterial({ content: "Subscribe to Stratechery. Stratechery Plus. " + "Promotion. ".repeat(90) }).eligible, false);
  assert.equal(assessSourceMaterial({ content: "Full material. ".repeat(600) + "Subscribe to continue reading." }).eligible, true);
  assert.equal(assessSourceMaterial({ parseStatus: "failed", content: "Summary. ".repeat(80) }).eligible, false);
});

test("short source doesn't require 800 Chinese characters, long source keeps a lower guard", () => {
  const short = rewriteRequirements("A real fact. ".repeat(50));
  assert.ok(short.minChineseChars < 300);
  assert.equal(short.minParagraphs, 2);
  assert.equal(rewriteRequirements("A real fact. ".repeat(1000)).minChineseChars, 680);
  assert.ok(rewriteRequirements("原文事实".repeat(150)).minChineseChars < 500);
});

test("cooldown includes exhausted failures, not transient attempts", () => {
  assert.deepEqual([...failedArticleIds([{ rewrite_failures: [{ id: "a", attempts: 3 }, { id: "b", attempts: 1 }] }, {}])], ["a"]);
});
