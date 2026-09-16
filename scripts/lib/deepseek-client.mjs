import crypto from "node:crypto";

export function isPeakTime(value = new Date()) {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}

// Estimate using request start time; the provider bill remains authoritative.
export function usageCost(usage, model, startedAt) {
  const peak = isPeakTime(startedAt);
  const prompt = Number.isFinite(usage?.prompt_tokens) ? usage.prompt_tokens : null;
  const output = Number.isFinite(usage?.completion_tokens) ? usage.completion_tokens : null;
  const hit = Number.isFinite(usage?.prompt_cache_hit_tokens) ? usage.prompt_cache_hit_tokens : null;
  const miss = Number.isFinite(usage?.prompt_cache_miss_tokens)
    ? usage.prompt_cache_miss_tokens
    : prompt !== null && hit !== null ? prompt - hit : null;
  const known = prompt !== null && output !== null && hit !== null && miss !== null && miss >= 0;
  const rates = model === "deepseek-v4-pro" ? [0.15, 4.5, 13.5] : null;
  return {
    prompt_tokens: prompt,
    completion_tokens: output,
    cache_hit_tokens: hit,
    cache_miss_tokens: miss,
    usage_known: known,
    pricing_period: peak ? "peak" : "off_peak",
    rate_version: rates ? "deepseek-v4-pro-2026-09-16" : null,
    estimated_cost_cny: known && rates
      ? (hit * rates[0] + miss * rates[1] + output * rates[2]) * (peak ? 2 : 1) / 1e6
      : null,
  };
}

export async function requestDeepSeekJson({ env, supabase, systemPrompt, userPrompt, stage,
  logMeta = {}, parseContent, writeLog, fetchImpl = fetch }) {
  if (env.TRENDLENS_SCHEDULED === "1" && isPeakTime()) {
    throw Object.assign(new Error("自动任务已进入高峰时段，停止新增模型调用，等待闲时补跑。"), { nonRetryable: true });
  }
  const startedAt = new Date().toISOString();
  const model = env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
  const timeoutMs = Number(env.DEEPSEEK_TIMEOUT_MS ?? 180000);
  const entry = {
    id: crypto.randomUUID(),
    job_id: env.TRENDLENS_JOB_ID || null,
    github_run_id: env.GITHUB_RUN_ID || null,
    stage, model,
    article_id: logMeta.articleId || null,
    attempt: logMeta.attempt ?? 1,
    api_attempt: logMeta.apiAttempt ?? 1,
    started_at: startedAt,
    status: "started",
    ...usageCost(null, model, startedAt),
  };
  const record = async (row) => {
    if (!supabase) return;
    const { error } = await supabase.from("trendlens_llm_usage").upsert(row);
    if (error) {
      if (env.TRENDLENS_REQUIRE_USAGE === "1") {
        throw Object.assign(new Error(`无法保存模型用量：${error.message}`), { nonRetryable: true });
      }
      console.warn(`[usage] ${error.message}`);
    }
  };
  await record(entry);
  const thinking = env.DEEPSEEK_THINKING ?? "disabled";
  const body = {
    model, stream: false,
    max_tokens: Number(env.DEEPSEEK_MAX_TOKENS ?? env.FRIDAY_MAX_TOKENS ?? 12000),
    response_format: { type: "json_object" },
    thinking: { type: thinking },
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    ...(thinking === "enabled"
      ? { reasoning_effort: env.DEEPSEEK_REASONING_EFFORT ?? "high" }
      : { temperature: Number(env.DEEPSEEK_TEMPERATURE ?? 0.2) }),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, responseText, payload, parsed, failure;
  try {
    response = await fetchImpl(env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    // Keep the timeout active while reading the body, including keep-alive whitespace.
    responseText = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`DeepSeek ${stage} HTTP ${response.status}`), {
        nonRetryable: [400, 401, 402, 403, 404].includes(response.status),
      });
    }
    payload = JSON.parse(responseText);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`DeepSeek ${stage} returned no content`);
    parsed = parseContent(content);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
  }
  const finishedAt = new Date().toISOString();
  await writeLog(stage, {
    ...logMeta, startedAt, respondedAt: finishedAt, model,
    ok: !failure, status: response?.status,
    rawApiResponse: responseText, apiPayload: payload,
    modelMessageContent: payload?.choices?.[0]?.message?.content,
    parsedJson: parsed, error: failure?.message,
  });
  await record({
    ...entry, ...usageCost(payload?.usage, model, startedAt),
    finished_at: finishedAt,
    latency_ms: new Date(finishedAt) - new Date(startedAt),
    status: failure ? "failed" : "succeeded",
    http_status: response?.status ?? null,
    provider_request_id: payload?.id ?? null,
    error: failure?.message?.slice(0, 1000) ?? null,
  });
  if (failure) throw failure;
  return parsed;
}
