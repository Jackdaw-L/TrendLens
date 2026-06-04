#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import Parser from "rss-parser";
import YAML from "yaml";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createClient } from "@supabase/supabase-js";

const cwd = process.cwd();
const dataDir = path.join(cwd, "data");
const logsDir = path.join(dataDir, "logs");
const promptDir = path.join(cwd, "prompts");
const fetchedPath = path.join(dataDir, "fetched-articles.json");
const radarPath = path.join(dataDir, "radar.json");
const defaultSelectSystemPromptPath = path.join(promptDir, "select-system.md");
const defaultSelectUserPromptPath = path.join(promptDir, "select-user.md");
const defaultRewriteSystemPromptPath = path.join(promptDir, "rewrite-system.md");
const defaultRewriteUserPromptPath = path.join(promptDir, "rewrite-user.md");
const parser = new Parser({
  customFields: {
    item: [
      "content:encoded",
      "content",
      "summary",
      "description",
      "media:content",
      "media:thumbnail",
      "itunes:image",
    ],
  },
});
const virtualConsole = new VirtualConsole();

const command = process.argv[2] ?? "pipeline";
const cli = parseArgs(process.argv.slice(3));
const env = await loadEnv();

const sourceLimit = Number(cli["source-limit"] ?? env.SOURCE_LIMIT ?? 0);
const itemLimit = Number(cli.limit ?? env.MAX_ITEMS_PER_SOURCE ?? 3);
const modelMaxArticles = Number(env.LLM_MAX_ARTICLES ?? env.FRIDAY_MAX_ARTICLES ?? 8);
const modelCandidateArticles = Number(
  cli["candidate-limit"] ??
    env.LLM_CANDIDATE_ARTICLES ??
    env.FRIDAY_CANDIDATE_ARTICLES ??
    Math.max(modelMaxArticles * 3, modelMaxArticles),
);
// 跨 run 去重：剔除最近 N 天内已经推荐过的文章，避免连续两天推荐重复内容。
// 设为 0 可关闭去重。
const dedupLookbackDays = Number(cli["dedup-days"] ?? env.DEDUP_LOOKBACK_DAYS ?? 3);

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(logsDir, { recursive: true });

if (command === "fetch") {
  const fetched = await fetchAllSources({ sourceLimit, itemLimit });
  await writeJson(fetchedPath, fetched);
  const radar = buildFallbackRadar(fetched, {
    mode: "fetched",
    fridayStatus: "skipped",
    fridayError: "未执行 DeepSeek 生成；请运行 npm run pipeline。",
  });
  await writeJson(radarPath, radar);
  const storage = await persistPipelineResult({ fetched, radar });
  printSummary("fetch", radar, storage);
} else if (command === "generate") {
  const fetched = await readFetchedDataset();
  const radar = await generateRadar(fetched, { modelMaxArticles, modelCandidateArticles });
  await writeJson(radarPath, radar);
  const storage = await persistPipelineResult({ fetched, radar });
  printSummary("generate", radar, storage);
} else if (command === "pipeline") {
  const fetched = await fetchAllSources({ sourceLimit, itemLimit });
  await writeJson(fetchedPath, fetched);
  const radar = await generateRadar(fetched, { modelMaxArticles, modelCandidateArticles });
  await writeJson(radarPath, radar);
  const storage = await persistPipelineResult({ fetched, radar });
  printSummary("pipeline", radar, storage);
} else {
  throw new Error(`Unknown command: ${command}`);
}

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
  for (const file of [".env.example", ".env", ".env.local"]) {
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

async function fetchAllSources({ sourceLimit, itemLimit }) {
  const configSources = await loadPipelineSources();
  const enabledSources = configSources
    .filter((source) => source.enabled !== false)
    .slice(0, sourceLimit > 0 ? sourceLimit : undefined);

  const fetched = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    itemLimit,
    sources: [],
    articles: [],
    errors: [],
  };

  const seenUrls = new Set();
  for (const source of enabledSources) {
    const sourceResult = {
      id: source.id,
      name: source.name,
      url: source.url,
      category: source.category,
      language: source.language ?? "en",
      weight: source.weight ?? 1,
      status: "ok",
      itemCount: 0,
      error: null,
    };

    try {
      const feedXml = await fetchText(source.url, { timeoutMs: 15000 });
      const feed = await parser.parseString(feedXml);
      const items = (feed.items ?? []).slice(0, itemLimit);
      sourceResult.itemCount = items.length;

      for (const item of items) {
        const rawUrl = item.link || item.guid;
        if (!rawUrl) continue;
        const canonicalUrl = canonicalizeUrl(rawUrl);
        if (seenUrls.has(canonicalUrl)) continue;
        seenUrls.add(canonicalUrl);

        const article = await fetchArticleFromItem(item, source, canonicalUrl);
        fetched.articles.push(article);
      }
    } catch (error) {
      sourceResult.status = "failed";
      sourceResult.error = normalizeError(error);
      fetched.errors.push({
        sourceId: source.id,
        message: sourceResult.error,
      });
    }

    fetched.sources.push(sourceResult);
  }

  return fetched;
}

async function loadPipelineSources() {
  const supabase = createSupabaseClientFromEnv();
  if (supabase) {
    try {
      await ensureSupabaseSourcesSeeded(supabase);
      const { data, error } = await supabase
        .from("trendlens_sources")
        .select("id,name,url,category,language,weight,enabled,fetch_interval")
        .order("weight", { ascending: false })
        .order("name", { ascending: true });

      if (error) throw error;
      if (Array.isArray(data) && data.length > 0) {
        return data.map((source) => ({
          id: String(source.id),
          name: String(source.name),
          url: String(source.url),
          category: String(source.category),
          language: source.language ? String(source.language) : undefined,
          weight: source.weight == null ? undefined : Number(source.weight),
          enabled: source.enabled == null ? undefined : Boolean(source.enabled),
          fetch_interval: source.fetch_interval ? String(source.fetch_interval) : undefined,
        }));
      }
    } catch (error) {
      console.warn(`Failed to load sources from Supabase, falling back to sources.yaml: ${normalizeError(error)}`);
    }
  }

  return loadSourceConfigsFromYaml();
}

async function loadSourceConfigsFromYaml() {
  const sourcesYaml = await fs.readFile(path.join(cwd, "sources.yaml"), "utf8");
  const config = YAML.parse(sourcesYaml);
  return Array.isArray(config.sources) ? config.sources : [];
}

async function fetchArticleFromItem(item, source, canonicalUrl) {
  const title = normalizeText(item.title ?? "Untitled");
  const rssSummary = normalizeText(
    item.contentSnippet ?? item.summary ?? item.description ?? item.content ?? item["content:encoded"] ?? "",
  );
  const publishedAt = new Date(item.isoDate ?? item.pubDate ?? Date.now()).toISOString();
  const rssImages = extractImagesFromFeedItem(item, canonicalUrl);

  let parseStatus = "parsed";
  let content = "";
  let excerpt = rssSummary;
  let images = rssImages;
  let htmlFetched = false;
  let error = null;

  try {
    const html = await fetchText(canonicalUrl, { timeoutMs: 18000 });
    htmlFetched = true;
    const extracted = extractReadableText(html, canonicalUrl);
    content = extracted.content;
    excerpt = normalizeText(extracted.excerpt || rssSummary || content.slice(0, 280));
    images = normalizeImages([...rssImages, ...extracted.images]);
    if (content.length < 600) parseStatus = "needs_review";
  } catch (err) {
    parseStatus = "failed";
    error = normalizeError(err);
    content = normalizeText(item["content:encoded"] ?? item.content ?? rssSummary);
    images = normalizeImages([
      ...rssImages,
      ...extractImagesFromHtmlFragment(item["content:encoded"] ?? item.content ?? item.description ?? "", canonicalUrl, {
        source: "rss-html",
      }),
    ]);
  }

  return {
    id: stableId(canonicalUrl),
    sourceId: source.id,
    sourceName: source.name,
    sourceCategory: source.category,
    sourceWeight: source.weight ?? 1,
    language: source.language ?? "en",
    title,
    url: canonicalUrl,
    canonicalUrl,
    publishedAt,
    summary: rssSummary,
    excerpt,
    content: normalizeText(content).slice(0, 30000),
    images,
    parseStatus,
    htmlFetched,
    error,
  };
}

async function fetchText(url, { timeoutMs }) {
  const attempts = positiveInteger(env.FETCH_ATTEMPTS, 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const options = {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X) TrendLens/0.1 RSS reader",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      };
      let response = await fetch(attempt === 1 ? url : cacheBustUrl(url), options);
      if (response.status === 304) {
        response = await fetch(cacheBustUrl(url), options);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(400 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("fetch failed");
}

function cacheBustUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.set("_trendlens", String(Date.now()));
    return url.toString();
  } catch {
    return value;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractReadableText(html, url) {
  const dom = new JSDOM(html, { url, virtualConsole });
  const documentImages = extractImagesFromDocument(dom.window.document, url, {
    source: "html",
  });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent) {
    return {
      content: normalizeText(article.textContent),
      excerpt: normalizeText(article.excerpt ?? ""),
      images: normalizeImages([
        ...extractImagesFromHtmlFragment(article.content ?? "", url, { source: "readability" }),
        ...documentImages,
      ]),
    };
  }

  const documentText = dom.window.document.body?.textContent ?? "";
  return {
    content: normalizeText(documentText),
    excerpt: normalizeText(documentText.slice(0, 320)),
    images: documentImages,
  };
}

function extractImagesFromFeedItem(item, baseUrl) {
  const images = [];
  addImage(images, item.enclosure, baseUrl, { source: "rss-enclosure" });
  addImage(images, item["media:content"], baseUrl, { source: "rss-media" });
  addImage(images, item.mediaContent, baseUrl, { source: "rss-media" });
  addImage(images, item["media:thumbnail"], baseUrl, { source: "rss-thumbnail" });
  addImage(images, item.mediaThumbnail, baseUrl, { source: "rss-thumbnail" });
  addImage(images, item["itunes:image"], baseUrl, { source: "rss-itunes" });
  addImage(images, item.itunes?.image, baseUrl, { source: "rss-itunes" });

  for (const html of [item["content:encoded"], item.content, item.description, item.summary]) {
    images.push(...extractImagesFromHtmlFragment(html ?? "", baseUrl, { source: "rss-html" }));
  }

  return normalizeImages(images);
}

function extractImagesFromHtmlFragment(html, baseUrl, { source }) {
  if (!html || !String(html).includes("<")) return [];
  const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl, virtualConsole });
  return extractImagesFromDocument(dom.window.document, baseUrl, { source });
}

function extractImagesFromDocument(document, baseUrl, { source }) {
  const images = [];
  for (const selector of [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
  ]) {
    const content = document.querySelector(selector)?.getAttribute("content");
    addImage(images, content, baseUrl, { source: `${source}-meta` });
  }

  for (const img of document.querySelectorAll("article img, main img, figure img, img")) {
    const url = img.getAttribute("src") || firstSrcsetUrl(img.getAttribute("srcset"));
    addImage(images, url, baseUrl, {
      alt: img.getAttribute("alt") ?? "",
      caption: nearestFigureCaption(img),
      source,
    });
  }

  for (const sourceNode of document.querySelectorAll("picture source[srcset]")) {
    addImage(images, firstSrcsetUrl(sourceNode.getAttribute("srcset")), baseUrl, { source });
  }

  return normalizeImages(images);
}

function addImage(images, value, baseUrl, metadata = {}) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addImage(images, item, baseUrl, metadata);
    return;
  }

  if (typeof value === "object") {
    const attrs = value.$ ?? value;
    const url = attrs.url ?? attrs.href ?? attrs.src;
    const type = attrs.type ?? attrs.medium ?? metadata.type;
    if (type && !String(type).includes("image") && !isProbablyImageUrl(url)) return;
    addImage(images, url, baseUrl, {
      ...metadata,
      alt: attrs.alt ?? attrs.title ?? metadata.alt,
      caption: attrs.caption ?? attrs.description ?? metadata.caption,
    });
    return;
  }

  const url = resolveUrl(String(value).trim(), baseUrl);
  if (!url || (!isProbablyImageSource(metadata.source) && !isProbablyImageUrl(url))) return;
  images.push({
    url,
    alt: normalizeText(metadata.alt ?? ""),
    caption: normalizeText(metadata.caption ?? ""),
    source: metadata.source ?? "unknown",
  });
}

function normalizeImages(images) {
  const seen = new Set();
  return images
    .filter((image) => image?.url)
    .filter((image) => {
      if (!isUsableImageUrl(image.url)) return false;
      const identity = imageIdentity(image.url);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .filter((image) => !/(avatar|profile|logo|icon|pixel|tracking|spacer|blank|1x1)/i.test(image.url))
    .slice(0, 12)
    .map((image, index) => ({
      id: image.id ?? `img-${index + 1}-${stableId(image.url).slice(0, 6)}`,
      url: image.url,
      alt: image.alt || "",
      caption: image.caption || "",
      source: image.source || "unknown",
    }));
}

function firstSrcsetUrl(srcset) {
  return String(srcset ?? "")
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .find(Boolean);
}

function nearestFigureCaption(img) {
  return normalizeText(img.closest("figure")?.querySelector("figcaption")?.textContent ?? "");
}

function resolveUrl(value, baseUrl) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function isProbablyImageUrl(value) {
  return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(String(value ?? ""));
}

function isProbablyImageSource(source) {
  return /(enclosure|media|thumbnail|itunes|meta|html|readability)/i.test(String(source ?? ""));
}

function isUsableImageUrl(value) {
  const url = String(value ?? "");
  if (!url) return false;
  if (/substackcdn\.com\/image\/fetch\/\$s_![^/]+!?$/i.test(url)) return false;
  return true;
}

function imageIdentity(value) {
  const url = String(value ?? "");
  const encodedSourceIndex = url.search(/\/https?%3A/i);
  if (encodedSourceIndex >= 0) {
    return decodeURIComponent(url.slice(encodedSourceIndex + 1)).replace(/[?#].*$/, "");
  }
  return url.replace(/([?&](w|h|width|height|format|q|fit|crop|auto|s)=[^&]+)/gi, "").replace(/[?#]$/, "");
}

async function generateRadar(fetched, { modelMaxArticles, modelCandidateArticles }) {
  const minContentChars = positiveInteger(env.FRIDAY_MIN_CONTENT_CHARS, 600);
  const qualified = fetched.articles
    .filter((article) => article.title && normalizeText(article.content).length >= minContentChars)
    .sort((a, b) => (b.sourceWeight ?? 1) - (a.sourceWeight ?? 1));

  // 在交给 DeepSeek 选文之前，先剔除最近 N 天已推荐过的文章，避免跨天重复推荐。
  const freshCandidates = await excludeRecentlyRecommended(qualified, {
    maxArticles: modelMaxArticles,
  });
  const usable = freshCandidates.slice(0, modelCandidateArticles);

  if (usable.length === 0) {
    return buildFallbackRadar(fetched, {
      mode: "fetched",
      fridayStatus: "skipped",
      fridayError: `没有正文长度达到 ${minContentChars} 字符的候选文章。`,
    });
  }

  if (!env.DEEPSEEK_API_KEY) {
    return buildFallbackRadar(fetched, {
      mode: "fetched",
      fridayStatus: "skipped",
      fridayError: "缺少 DEEPSEEK_API_KEY 配置。",
    });
  }

  try {
    const selection = await callDeepSeekForSelection(usable, { maxArticles: modelMaxArticles });
    const normalizedSelection = normalizeSelection(selection, usable, modelMaxArticles);
    const selectedSources = selectSourceArticles(normalizedSelection.articles, usable);
    const rewrite = await callDeepSeekForRewrite(normalizedSelection, selectedSources);
    const generated = mergeSelectionAndRewrite(normalizedSelection, rewrite);
    return normalizeFridayRadar(generated, fetched, selectedSources, {
      rewriteFailures: rewrite.failures,
    });
  } catch (error) {
    return buildFallbackRadar(fetched, {
      mode: "fetched",
      fridayStatus: "failed",
      fridayError: normalizeError(error),
    });
  }
}

// 从候选文章中剔除最近 dedupLookbackDays 天内已推荐过的文章。
// 兜底策略：如果剔重后新鲜候选不足以选出目标数量，则保留原候选，
// 防止出现「推荐列表过少甚至为空」的极端情况。
async function excludeRecentlyRecommended(candidates, { maxArticles }) {
  if (dedupLookbackDays <= 0 || candidates.length === 0) return candidates;

  const recommendedIds = await loadRecentlyRecommendedIds(dedupLookbackDays);
  if (recommendedIds.size === 0) return candidates;

  const deduped = candidates.filter((article) => !recommendedIds.has(article.id));
  const removed = candidates.length - deduped.length;

  if (deduped.length < maxArticles) {
    console.warn(
      `[dedup] 剔重后仅剩 ${deduped.length} 篇新鲜候选（目标 ${maxArticles} 篇），为避免推荐过少，本次保留全部 ${candidates.length} 篇候选。`,
    );
    return candidates;
  }

  if (removed > 0) {
    console.log(`[dedup] 已剔除最近 ${dedupLookbackDays} 天内推荐过的 ${removed} 篇文章。`);
  }
  return deduped;
}

// 读取最近 days 天内 Supabase 中已落库（已推荐）的文章 id 集合。
// 文章 id 由文章网址哈希得到（stableId），跨 run 稳定，因此可直接按 id 比对。
async function loadRecentlyRecommendedIds(days) {
  const supabase = createSupabaseClientFromEnv();
  if (!supabase) return new Set();

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("trendlens_articles")
      .select("id, created_at")
      .gte("created_at", cutoff);
    if (error) throw error;
    return new Set((data ?? []).map((row) => String(row.id)));
  } catch (error) {
    // 去重属于「锦上添花」，读取失败时不应阻断主流程，退化为不去重。
    console.warn(`[dedup] 读取历史推荐文章失败，本次跳过去重：${normalizeError(error)}`);
    return new Set();
  }
}

async function callDeepSeekForSelection(articles, { maxArticles }) {
  const selectionContentChars = positiveInteger(env.LLM_SELECT_CONTENT_CHARS ?? env.FRIDAY_SELECT_CONTENT_CHARS, 900);
  const compactArticles = articles.map((article) => ({
    id: article.id,
    source: article.sourceName,
    sourceCategory: article.sourceCategory,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    summary: article.summary || article.excerpt,
    contentSnippet: article.content.slice(0, selectionContentChars),
  }));
  const { systemPrompt, userPrompt } = await loadPromptPair("select", {
    articles_json: JSON.stringify(compactArticles),
    max_articles: String(maxArticles),
  });

  return callDeepSeekJson({ systemPrompt, userPrompt, stage: "select" });
}

async function callDeepSeekForRewrite(selection, articles) {
  const selectionById = new Map(selection.articles.map((article) => [article.id, article]));
  const contentChars = positiveInteger(env.FRIDAY_REWRITE_CONTENT_CHARS, 12000);
  const maxAttempts = positiveInteger(env.FRIDAY_REWRITE_ATTEMPTS, 2);
  const rewrittenArticles = [];
  const failures = [];

  for (const sourceArticle of articles) {
    const inputArticle = buildRewriteInputArticle(sourceArticle, {
      contentChars,
      selection: selectionById.get(sourceArticle.id),
    });
    let lastError = "";
    let lastIssues = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const rewrite = await callDeepSeekForRewriteArticle(inputArticle, {
          attempt,
          previousIssues: lastIssues.length ? lastIssues : lastError ? [lastError] : [],
        });
        const article = extractRewriteArticle(rewrite, inputArticle.id);
        const issues = validateRewrittenArticle(article, inputArticle);

        if (issues.length === 0) {
          rewrittenArticles.push(article);
          lastIssues = [];
          lastError = "";
          break;
        }

        lastIssues = issues;
        lastError = issues.join("; ");
        await writeModelLog("rewrite", {
          event: "validation_failed",
          articleId: inputArticle.id,
          articleTitle: inputArticle.title,
          attempt,
          validationIssues: issues,
          parsedJson: rewrite,
        });
      } catch (error) {
        lastError = normalizeError(error);
        lastIssues = [lastError];
      }
    }

    if (lastError || lastIssues.length) {
      failures.push({
        id: inputArticle.id,
        title: inputArticle.selection?.title || inputArticle.title,
        source: inputArticle.source,
        url: inputArticle.url,
        reason: lastIssues.length ? lastIssues.join("; ") : lastError,
        attempts: maxAttempts,
      });
    }
  }

  return { articles: rewrittenArticles, failures };
}

function buildRewriteInputArticle(article, { contentChars, selection }) {
  return {
    id: article.id,
    source: article.sourceName,
    sourceCategory: article.sourceCategory,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    summary: article.summary || article.excerpt,
    content: article.content.slice(0, contentChars),
    sourceImages: (article.images ?? []).slice(0, 8),
    selection,
  };
}

async function callDeepSeekForRewriteArticle(inputArticle, { attempt, previousIssues }) {
  const { systemPrompt, userPrompt } = await loadPromptPair("rewrite", {
    selected_articles_json: JSON.stringify([inputArticle]),
  });
  const retryInstruction =
    previousIssues.length > 0
      ? `\n\n上一次返回没有通过结构校验，问题如下：\n${previousIssues
          .map((issue) => `- ${issue}`)
          .join("\n")}\n请只转写这 1 篇文章，并严格满足 bodyBlocks、annotations、pmTakeaways、image block 和中文忠实转写要求。`
      : "";

  return callDeepSeekJson({
    systemPrompt,
    userPrompt: `${userPrompt}${retryInstruction}`,
    stage: "rewrite",
    logMeta: {
      articleId: inputArticle.id,
      articleTitle: inputArticle.selection?.title || inputArticle.title,
      attempt,
      inputArticle,
    },
  });
}

async function callDeepSeekJson({ systemPrompt, userPrompt, stage, logMeta = {} }) {
  const maxAttempts = positiveInteger(env.DEEPSEEK_ATTEMPTS, 2);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callDeepSeekJsonOnce({
        systemPrompt,
        userPrompt,
        stage,
        logMeta: { ...logMeta, apiAttempt: attempt },
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await delay(Math.min(2000 * attempt, 6000));
    }
  }

  throw lastError ?? new Error(`DeepSeek ${stage} failed`);
}

async function callDeepSeekJsonOnce({ systemPrompt, userPrompt, stage, logMeta = {} }) {
  const startedAt = new Date().toISOString();
  const thinkingType = env.DEEPSEEK_THINKING ?? "disabled";
  const timeoutMs = positiveInteger(env.DEEPSEEK_TIMEOUT_MS, stage === "select" ? 120000 : 180000);
  const requestBody = {
    model: env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    stream: false,
    max_tokens: Number(env.DEEPSEEK_MAX_TOKENS ?? env.FRIDAY_MAX_TOKENS ?? 12000),
    response_format: { type: "json_object" },
    thinking: { type: thinkingType },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      { role: "user", content: userPrompt },
    ],
  };

  if (thinkingType === "enabled") {
    requestBody.reasoning_effort = env.DEEPSEEK_REASONING_EFFORT ?? "high";
  } else {
    requestBody.temperature = Number(env.DEEPSEEK_TEMPERATURE ?? 0.2);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    const respondedAt = new Date().toISOString();
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `DeepSeek ${stage} timed out after ${timeoutMs}ms`
        : `DeepSeek ${stage} request failed: ${normalizeError(error)}`;

    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: false,
      model: requestBody.model,
      timeoutMs,
      error: message,
    });
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }

  const respondedAt = new Date().toISOString();

  if (!response.ok) {
    const responseText = await response.text();
    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: false,
      status: response.status,
      statusText: response.statusText,
      model: requestBody.model,
      rawApiResponse: responseText,
      error: `DeepSeek ${stage} HTTP ${response.status}`,
    });
    throw new Error(`DeepSeek ${stage} HTTP ${response.status}: ${responseText}`);
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      model: requestBody.model,
      rawApiResponse: responseText,
      error: `DeepSeek ${stage} returned empty response body`,
    });
    throw new Error(`DeepSeek ${stage} returned empty response body`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      model: requestBody.model,
      rawApiResponse: responseText,
      error: `DeepSeek ${stage} response is not JSON: ${normalizeError(error)}`,
    });
    throw new Error(
      `DeepSeek ${stage} response is not JSON: ${normalizeError(error)}; preview=${responseText.slice(0, 240)}`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      model: requestBody.model,
      rawApiResponse: responseText,
      apiPayload: payload,
      error: `DeepSeek ${stage} response missing choices[0].message.content`,
    });
    throw new Error(`DeepSeek ${stage} response missing choices[0].message.content`);
  }

  let parsed;
  try {
    parsed = parseJsonFromModel(content);
  } catch (error) {
    await writeModelLog(stage, {
      ...logMeta,
      startedAt,
      respondedAt,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      model: requestBody.model,
      rawApiResponse: responseText,
      apiPayload: payload,
      modelMessageContent: content,
      error: normalizeError(error),
    });
    throw error;
  }

  await writeModelLog(stage, {
    ...logMeta,
    startedAt,
    respondedAt,
    ok: true,
    status: response.status,
    statusText: response.statusText,
    model: requestBody.model,
    rawApiResponse: responseText,
    apiPayload: payload,
    modelMessageContent: content,
    parsedJson: parsed,
  });
  return parsed;
}

async function loadPromptPair(stage, variables) {
  const systemPromptPath =
    stage === "select"
      ? path.resolve(env.LLM_SELECT_SYSTEM_PROMPT_PATH ?? env.FRIDAY_SELECT_SYSTEM_PROMPT_PATH ?? defaultSelectSystemPromptPath)
      : path.resolve(env.LLM_REWRITE_SYSTEM_PROMPT_PATH ?? env.FRIDAY_REWRITE_SYSTEM_PROMPT_PATH ?? defaultRewriteSystemPromptPath);
  const userPromptPath =
    stage === "select"
      ? path.resolve(env.LLM_SELECT_USER_PROMPT_PATH ?? env.FRIDAY_SELECT_USER_PROMPT_PATH ?? defaultSelectUserPromptPath)
      : path.resolve(env.LLM_REWRITE_USER_PROMPT_PATH ?? env.FRIDAY_REWRITE_USER_PROMPT_PATH ?? defaultRewriteUserPromptPath);
  const [systemPrompt, userTemplate] = await Promise.all([
    fs.readFile(systemPromptPath, "utf8"),
    fs.readFile(userPromptPath, "utf8"),
  ]);

  return {
    systemPrompt: systemPrompt.trim(),
    userPrompt: replacePromptVariables(userTemplate, variables).trim(),
  };
}

function replacePromptVariables(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function normalizeSelection(selection, sourceArticles, maxArticles) {
  const sourceById = new Map(sourceArticles.map((article) => [article.id, article]));
  const selectedInput = Array.isArray(selection.articles)
    ? selection.articles
    : Array.isArray(selection.selectedArticles)
      ? selection.selectedArticles
      : [];
  const articles = selectedInput
    .filter((article) => sourceById.has(String(article.id)))
    .slice(0, maxArticles)
    .map((article, index) => {
      const source = sourceById.get(String(article.id));
      return {
        id: String(article.id),
        topicId: slug(article.topicId || article.topic || topicKeyForArticle(source).id),
        title: String(article.title || source.title),
        oneSentence: String(article.oneSentence || source.excerpt || source.summary || ""),
        whyRecommended: String(article.whyRecommended || "这篇文章在当前候选池里更值得优先阅读。"),
        whyNow: String(article.whyNow || "它提供了近期值得关注的新事实或新判断。"),
        pmAngle: String(article.pmAngle || "从产品视角看，它有助于校准对技术趋势的判断。"),
        relatedIds: Array.isArray(article.relatedIds) ? article.relatedIds.map(String) : [],
        order: Number(article.order || index + 1),
      };
    });

  const selectedIds = new Set(articles.map((article) => article.id));
  const supplementalArticles = sourceArticles
    .filter((source) => !selectedIds.has(source.id))
    .slice(0, Math.max(0, maxArticles - articles.length))
    .map((source, index) => {
      const topic = topicKeyForArticle(source);
      return {
        id: source.id,
        topicId: topic.id,
        title: source.title,
        oneSentence: source.excerpt || source.summary || "",
        whyRecommended: "这篇文章来自真实信息源，内容完整，适合作为今日科技 / 互联网 / 大模型信息流的补充阅读。",
        whyNow: "它来自本次 RSS 抓取的最新候选池，可帮助补齐今日信息面。",
        pmAngle: "从 PM 视角，可以重点看它对产品设计、技术采用或行业竞争的启发。",
        relatedIds: [],
        order: articles.length + index + 1,
      };
    });

  const fallbackArticles =
    articles.length > 0
      ? [...articles, ...supplementalArticles]
      : sourceArticles.slice(0, maxArticles).map((source, index) => {
          const topic = topicKeyForArticle(source);
          return {
            id: source.id,
            topicId: topic.id,
            title: source.title,
            oneSentence: source.excerpt || source.summary || "",
            whyRecommended: "这篇文章来自真实信息源，内容完整，适合作为今日科技 / 互联网 / 大模型信息流的补充阅读。",
            whyNow: "它来自本次 RSS 抓取的最新候选池，可帮助补齐今日信息面。",
            pmAngle: "从 PM 视角，可以重点看它对产品设计、技术采用或行业竞争的启发。",
            relatedIds: [],
            order: index + 1,
          };
        });

  const topicArticleIds = new Map();
  for (const article of fallbackArticles) {
    if (!topicArticleIds.has(article.topicId)) topicArticleIds.set(article.topicId, []);
    topicArticleIds.get(article.topicId).push(article.id);
  }

  const topicsInput = Array.isArray(selection.topics) ? selection.topics : [];
  const topics = topicsInput.length
    ? topicsInput.map((topic, index) => {
        const heatLevel = clampHeat(topic.heatLevel);
        return {
          id: slug(topic.id || topic.title || `topic-${index}`),
          title: String(topic.title || "今日推荐"),
          heatLevel,
          heatLabel: String(topic.heatLabel || "值得关注"),
          score: normalizeScore(topic.score ?? topic.heatScore ?? topic.heat, heatLevel * 20),
          sourceCount: Number(topic.sourceCount || 1),
          category: normalizeCategory(topic.category),
          whyHot: String(topic.whyHot || ""),
          pmAngle: String(topic.pmAngle || ""),
          signals: normalizeSignals(topic.signals),
          timeline: normalizeTimeline(topic.timeline),
          disagreements: Array.isArray(topic.disagreements) ? topic.disagreements.map(String) : [],
          readingOrder: Array.isArray(topic.readingOrder) ? topic.readingOrder.map(String) : [],
          articleIds:
            Array.isArray(topic.articleIds) && topic.articleIds.length
              ? topic.articleIds.map(String)
              : topicArticleIds.get(slug(topic.id || topic.title || `topic-${index}`)) ?? [],
        };
      })
    : [...topicArticleIds.entries()].map(([id, articleIds]) => ({
        id,
        title: "今日科技 / 互联网 / 大模型推荐",
        heatLevel: 3,
        heatLabel: "值得关注",
        score: 60,
        sourceCount: 1,
        category: "LLM",
        whyHot: "",
        pmAngle: "",
        signals: normalizeSignals([]),
        timeline: normalizeTimeline([]),
        disagreements: [],
        readingOrder: [],
        articleIds,
      }));

  return { topics, articles: fallbackArticles };
}

function selectSourceArticles(selectedArticles, sourceArticles) {
  const sourceById = new Map(sourceArticles.map((article) => [article.id, article]));
  return selectedArticles.map((article) => sourceById.get(article.id)).filter(Boolean);
}

function extractRewriteArticle(rewrite, articleId) {
  const articles = Array.isArray(rewrite?.articles) ? rewrite.articles : [];
  return articles.find((article) => String(article.id) === String(articleId)) ?? null;
}

function validateRewrittenArticle(article, inputArticle) {
  const issues = [];
  if (!article) {
    return [`模型没有返回 article id=${inputArticle.id} 的中文转写结果`];
  }

  for (const field of ["title", "oneSentence", "whyRecommended", "whyNow", "pmAngle"]) {
    if (!String(article[field] ?? "").trim()) {
      issues.push(`${field} 为空`);
    }
  }

  const blocks = Array.isArray(article.bodyBlocks) ? article.bodyBlocks : [];
  const paragraphs = blocks.filter((block) => block?.type === "paragraph" && String(block.content ?? "").trim());
  const images = blocks.filter((block) => block?.type === "image");
  const paragraphText = paragraphs.map((block) => block.content).join("");
  const paragraphChineseChars = countChineseChars(paragraphText);
  const configuredMinChineseChars = positiveInteger(env.FRIDAY_REWRITE_MIN_CHINESE_CHARS, 800);
  const sourceContentLength = normalizeText(inputArticle.content).length;
  const minChineseChars =
    sourceContentLength < 1200
      ? Math.min(configuredMinChineseChars, 450)
      : sourceContentLength < 4500
        ? Math.min(configuredMinChineseChars, 500)
        : configuredMinChineseChars;
  const minAnnotations = sourceContentLength < 1200 ? 1 : sourceContentLength < 4500 ? 2 : 3;
  const sourceImageIds = new Set((inputArticle.sourceImages ?? []).map((image) => image.id));

  if (blocks.length < 8) issues.push(`bodyBlocks 数量不足：${blocks.length}/8`);
  if (paragraphs.length < 8) issues.push(`paragraph 数量不足：${paragraphs.length}/8`);
  if (paragraphChineseChars < minChineseChars) {
    issues.push(`中文正文不足：${paragraphChineseChars}/${minChineseChars}`);
  }
  if (paragraphText && paragraphChineseChars / paragraphText.length < 0.35) {
    issues.push("paragraph 正文不是以中文为主");
  }

  const annotations = Array.isArray(article.annotations) ? article.annotations : [];
  const pmTakeaways = Array.isArray(article.pmTakeaways) ? article.pmTakeaways : [];
  if (annotations.length < minAnnotations) issues.push(`annotations 数量不足：${annotations.length}/${minAnnotations}`);
  if (pmTakeaways.length < 3) issues.push(`pmTakeaways 数量不足：${pmTakeaways.length}/3`);
  for (const image of images) {
    if (!image.imageId || !sourceImageIds.has(String(image.imageId))) {
      issues.push(`image block 引用了不存在的 imageId：${image.imageId ?? "empty"}`);
    }
  }

  return issues;
}

function mergeSelectionAndRewrite(selection, rewrite) {
  const selectedById = new Map(selection.articles.map((article) => [String(article.id), article]));
  const rewrittenArticles = Array.isArray(rewrite.articles) ? rewrite.articles : [];
  const rewrittenIds = new Set(rewrittenArticles.map((article) => String(article.id)));

  return {
    topics: selection.topics
      .map((topic) => ({
        ...topic,
        articleIds: Array.isArray(topic.articleIds)
          ? topic.articleIds.filter((articleId) => rewrittenIds.has(String(articleId)))
          : [],
      }))
      .filter((topic) => topic.articleIds.length > 0),
    articles: rewrittenArticles.map((rewritten) => {
      const selected = selectedById.get(String(rewritten.id)) ?? {};
      return {
        ...selected,
        ...rewritten,
        id: String(rewritten.id),
        topicId: String(rewritten.topicId || selected.topicId || "today-radar"),
        title: String(rewritten.title || selected.title),
        oneSentence: String(rewritten.oneSentence || selected.oneSentence),
        whyRecommended: String(rewritten.whyRecommended || selected.whyRecommended),
        whyNow: String(rewritten.whyNow || selected.whyNow),
        pmAngle: String(rewritten.pmAngle || selected.pmAngle),
        relatedIds: Array.isArray(rewritten.relatedIds) ? rewritten.relatedIds.map(String) : selected.relatedIds ?? [],
      };
    }),
    rewriteFailures: rewrite.failures ?? [],
  };
}

function normalizeFridayRadar(generated, fetched, sourceArticles, { rewriteFailures = [] } = {}) {
  const sourceById = new Map(fetched.articles.map((article) => [article.id, article]));
  const topics = (generated.topics ?? []).map((topic, index) => ({
    id: slug(topic.id || topic.title || `topic-${index}`),
    title: String(topic.title || "未命名话题"),
    heatLevel: clampHeat(topic.heatLevel),
    heatLabel: String(topic.heatLabel || "观察中"),
    score: normalizeScore(topic.score ?? topic.heatScore ?? topic.heat, 50),
    sourceCount: Number(topic.sourceCount || 1),
    category: normalizeCategory(topic.category),
    whyHot: String(topic.whyHot || ""),
    pmAngle: String(topic.pmAngle || ""),
    signals: normalizeSignals(topic.signals),
    timeline: normalizeTimeline(topic.timeline),
    disagreements: Array.isArray(topic.disagreements) ? topic.disagreements.map(String) : [],
    readingOrder: Array.isArray(topic.readingOrder) ? topic.readingOrder.map(String) : [],
    articleIds: Array.isArray(topic.articleIds) ? topic.articleIds.map(String) : [],
  }));

  const topicIds = new Set(topics.map((topic) => topic.id));
  const fallbackTopicId = topics[0]?.id ?? "today-radar";
  const articles = (generated.articles ?? []).map((article, index) => {
    const source = sourceById.get(String(article.id)) ?? sourceArticles[index] ?? sourceArticles[0];
    const topicId = topicIds.has(String(article.topicId)) ? String(article.topicId) : fallbackTopicId;
    const bodyBlocks = ensureBodyImageBlocks(
      normalizeBodyBlocks(article.bodyBlocks, source, { allowFallback: false }),
      source,
    );
    const heroImage = pickHeroImage(bodyBlocks, source);
    return {
      id: String(article.id || source?.id || `article-${index}`),
      topicId,
      source: source?.sourceName ?? "Unknown",
      sourceType: normalizeSourceType(source?.sourceCategory),
      publishedAt: source?.publishedAt ?? new Date().toISOString(),
      originalUrl: source?.url ?? "#",
      category: topics.find((topic) => topic.id === topicId)?.category ?? "LLM",
      heat: topics.find((topic) => topic.id === topicId)?.heatLevel ?? 3,
      readingTime: estimateReadingTime(article.bodyBlocks, source?.content),
      tags: source?.sourceCategory ? [source.sourceCategory] : [],
      title: String(article.title || source?.title || "未命名文章"),
      oneSentence: String(article.oneSentence || source?.excerpt || ""),
      whyRecommended: String(article.whyRecommended || ""),
      whyNow: String(article.whyNow || ""),
      pmAngle: String(article.pmAngle || ""),
      bodyBlocks,
      annotations: Array.isArray(article.annotations) ? article.annotations : [],
      pmTakeaways: Array.isArray(article.pmTakeaways) ? article.pmTakeaways.map(String) : [],
      relatedIds: Array.isArray(article.relatedIds) ? article.relatedIds.map(String) : [],
      images: source?.images ?? [],
      heroImage,
    };
  });
  const fridayStatus =
    rewriteFailures.length === 0 ? "ok" : articles.length > 0 ? "partial" : "failed";
  const messageParts = [];
  messageParts.push(fetched.errors.length ? "RSS 部分源失败" : "RSS 抓取完成");
  if (fridayStatus === "ok") {
    messageParts.push("DeepSeek 筛选与逐篇中文转写已完成");
  } else if (fridayStatus === "partial") {
    messageParts.push(`DeepSeek 逐篇中文转写部分成功，${rewriteFailures.length} 篇未通过校验`);
  } else {
    messageParts.push("DeepSeek 逐篇中文转写未产出通过校验的文章");
  }

  return {
    version: 1,
    mode: "deepseek",
    generatedAt: new Date().toISOString(),
    status: {
      fetch: fetched.errors.length ? "partial" : "ok",
      friday: fridayStatus,
      message: `${messageParts.join("，")}。`,
    },
    topics,
    articles,
    sources: fetched.sources,
    fetchErrors: fetched.errors,
    rewriteFailures,
  };
}

function buildFallbackRadar(fetched, { mode, fridayStatus, fridayError }) {
  const usable = fetched.articles.filter((article) => article.title);
  const groups = new Map();
  for (const article of usable) {
    const key = topicKeyForArticle(article);
    if (!groups.has(key.id)) groups.set(key.id, { ...key, articles: [] });
    groups.get(key.id).articles.push(article);
  }

  const topics = [...groups.values()].slice(0, 5).map((group) => {
    const sourceNames = [...new Set(group.articles.map((article) => article.sourceName))];
    return {
      id: group.id,
      title: group.title,
      heatLevel: Math.min(5, Math.max(3, sourceNames.length + 2)),
      heatLabel: sourceNames.length >= 3 ? "值得关注" : "观察中",
      score: 48 + sourceNames.length * 10,
      sourceCount: sourceNames.length,
      category: group.category,
      whyHot: `这个话题来自 ${sourceNames.slice(0, 3).join("、")} 等 ${sourceNames.length} 个来源。当前只完成 RSS/正文抽取，尚未经过 DeepSeek 中文转写。`,
      pmAngle: "这是一条真实抓取到的候选趋势，但还需要模型进一步判断 PM 价值、稀缺性和多源共振强度。",
      signals: [
        {
          label: "RSS 抓取",
          type: normalizeSourceType(group.articles[0]?.sourceCategory),
          description: "已从公开 RSS 和网页正文抽取到候选内容。",
          sources: sourceNames,
        },
      ],
      timeline: group.articles.slice(0, 3).map((article, index) => ({
        time: index === 0 ? "Today" : `D-${index}`,
        event: `${article.sourceName}：${article.title}`,
      })),
      disagreements: ["未运行模型生成时，系统不会自动提炼观点分歧。"],
      readingOrder: group.articles.slice(0, 3).map((article) => `阅读 ${article.sourceName} 的《${article.title}》。`),
      articleIds: group.articles.slice(0, 3).map((article) => article.id),
    };
  });

  const topicByArticleId = new Map();
  for (const topic of topics) {
    for (const articleId of topic.articleIds) topicByArticleId.set(articleId, topic);
  }

  const articles = usable.slice(0, 12).map((article) => {
    const topic = topicByArticleId.get(article.id) ?? topics[0];
    const paragraphs = paragraphize(article.content || article.summary || article.excerpt).slice(0, 5);
    const imageBlocks = (article.images ?? []).slice(0, 1).map((image) => ({
      type: "image",
      imageId: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption,
    }));
    return {
      id: article.id,
      topicId: topic?.id ?? "today-radar",
      source: article.sourceName,
      sourceType: normalizeSourceType(article.sourceCategory),
      publishedAt: article.publishedAt,
      originalUrl: article.url,
      category: topic?.category ?? normalizeCategory(article.sourceCategory),
      heat: topic?.heatLevel ?? 3,
      readingTime: Math.max(2, Math.ceil((article.content?.length ?? 600) / 650)),
      tags: [article.sourceCategory],
      title: article.title,
      oneSentence: article.excerpt || article.summary || "这篇文章已从 RSS 抓取到，但尚未经过 DeepSeek 中文转写。",
      whyRecommended: "真实 RSS 候选文章，等待 DeepSeek 按 PM 偏好评分和转写。",
      whyNow: "当前页面展示的是抓取与正文抽取结果，不是最终模型推荐。",
      pmAngle: "需要进一步判断这篇文章对产品、平台、用户或行业演化的意义。",
      bodyBlocks: [
        {
          type: "paragraph",
          content:
            "这篇文章来自真实 RSS 抓取。由于 DeepSeek 本次未成功生成，下面先展示正文抽取片段，便于确认数据链路已经跑通。",
        },
        ...imageBlocks,
        ...paragraphs.map((content) => ({ type: "paragraph", content })),
      ],
      annotations: [],
      pmTakeaways: [
        "RSS 与正文抽取已经完成。",
        "需要 DeepSeek 成功返回后，才会生成完整中文转写、注释和 PM 启发。",
      ],
      relatedIds: [],
      images: article.images ?? [],
      heroImage: article.images?.[0] ?? null,
    };
  });

  return {
    version: 1,
    mode,
    generatedAt: new Date().toISOString(),
    status: {
      fetch: fetched.errors.length ? "partial" : "ok",
      friday: fridayStatus,
      message: fridayStatus === "ok" ? "已生成" : "已抓取 RSS，但未完成 DeepSeek 中文转写。",
      fridayError,
    },
    topics,
    articles,
    sources: fetched.sources,
    fetchErrors: fetched.errors,
  };
}

function topicKeyForArticle(article) {
  const text = `${article.title} ${article.summary} ${article.content}`.toLowerCase();
  if (/(coding|code|developer|agent|codex|programming|software)/i.test(text)) {
    return { id: "ai-coding-workflow", title: "AI coding 与开发者工作流正在升温", category: "LLM" };
  }
  if (/(multimodal|vision|audio|video|image|screen)/i.test(text)) {
    return { id: "multimodal-agent", title: "多模态能力正在进入真实任务", category: "技术" };
  }
  if (/(open source|open model|hugging face|inference|model)/i.test(text)) {
    return { id: "open-model-ecosystem", title: "模型生态竞争转向平台和工具链", category: "商业" };
  }
  if (/(product|growth|startup|browser|workflow)/i.test(text)) {
    return { id: "product-workflow", title: "AI 产品形态与工作流出现新信号", category: "产品" };
  }
  return { id: "today-radar", title: "今日科技与 LLM 候选动态", category: "LLM" };
}

function normalizeSignals(signals) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return [
      {
        label: "信号",
        type: "analysis",
        description: "模型未提供详细信号。",
        sources: [],
      },
    ];
  }
  return signals.slice(0, 5).map((signal) => ({
    label: String(signal.label || "信号"),
    type: normalizeSourceType(signal.type),
    description: String(signal.description || ""),
    sources: Array.isArray(signal.sources) ? signal.sources.map(String) : [],
  }));
}

function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return [{ time: "Today", event: "模型未提供时间线。" }];
  }
  return timeline.slice(0, 5).map((item) => ({
    time: String(item.time || "Today"),
    event: String(item.event || ""),
  }));
}

function pickHeroImage(bodyBlocks, source) {
  const bodyImage = bodyBlocks.find((block) => block?.type === "image" && block.url);
  if (bodyImage) {
    return {
      id: bodyImage.imageId ?? stableId(bodyImage.url),
      url: bodyImage.url,
      alt: bodyImage.alt ?? "",
      caption: bodyImage.caption ?? "",
      source: "body",
    };
  }
  return source?.images?.[0] ?? null;
}

function ensureBodyImageBlocks(blocks, source) {
  if (!source?.images?.length) {
    return blocks;
  }

  const usedUrls = new Set(blocks.filter((block) => block?.type === "image").map((block) => block.url));
  const existingImageCount = usedUrls.size;
  const targetImageCount = Math.min(4, Math.max(1, Math.ceil(source.images.length / 4)));
  const imagesToInsert = source.images
    .filter((image) => image.url && !usedUrls.has(image.url))
    .slice(0, Math.max(0, targetImageCount - existingImageCount));

  if (imagesToInsert.length === 0) return blocks;

  const result = [...blocks];
  const paragraphIndexes = result
    .map((block, index) => (block?.type === "paragraph" ? index : -1))
    .filter((index) => index >= 0);

  for (const [index, image] of imagesToInsert.entries()) {
    const anchor = paragraphIndexes[Math.min(paragraphIndexes.length - 1, 1 + index * 2)] ?? result.length - 1;
    const insertAt = Math.min(result.length, anchor + 1 + index);
    result.splice(insertAt, 0, {
      type: "image",
      imageId: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption || image.alt || "",
    });
  }

  return result;
}

function normalizeBodyBlocks(blocks, source, { allowFallback = true } = {}) {
  if (!Array.isArray(blocks) || blocks.length < 2) {
    if (!allowFallback) return [];
    return paragraphize(source?.content || source?.summary || "").slice(0, 5).map((content) => ({
      type: "paragraph",
      content,
    }));
  }
  const imagesById = new Map((source?.images ?? []).map((image) => [image.id, image]));
  return blocks
    .filter((block) => block && block.type && (block.content || block.sourceText || block.imageId))
    .slice(0, 24)
    .map((block) => {
      if (block.type === "quote") {
        return { type: "quote", sourceText: String(block.sourceText || "").slice(0, 280) };
      }
      if (block.type === "image") {
        const image = imagesById.get(String(block.imageId));
        if (!image?.url) return null;
        return {
          type: "image",
          imageId: image.id,
          url: image.url,
          alt: String(block.alt || image.alt || ""),
          caption: String(block.caption || image.caption || ""),
        };
      }
      return {
        type: "paragraph",
        content: String(block.content || ""),
        annotations: Array.isArray(block.annotations) ? block.annotations.map(String) : undefined,
      };
    })
    .filter(Boolean);
}

function paragraphize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[。！？.!?])\s+/)
    .reduce((paragraphs, sentence) => {
      if (paragraphs.length === 0) {
        paragraphs.push(sentence);
        return paragraphs;
      }
      const last = paragraphs[paragraphs.length - 1] ?? "";
      if (last.length < 220) {
        paragraphs[paragraphs.length - 1] = `${last}${last ? " " : ""}${sentence}`.trim();
      } else {
        paragraphs.push(sentence);
      }
      return paragraphs;
    }, [])
    .filter(Boolean)
    .slice(0, 8);
}

function estimateReadingTime(blocks, fallbackContent) {
  const text =
    Array.isArray(blocks) && blocks.length
      ? blocks.map((block) => block.content || block.sourceText || "").join("")
      : fallbackContent || "";
  return Math.max(4, Math.ceil(text.length / 450));
}

function parseJsonFromModel(content) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model output is not JSON");
  }
  const jsonText = withoutFence.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Model output JSON parse failed: ${normalizeError(error)}; preview=${jsonText.slice(0, 320)}`,
    );
  }
}

function normalizeCategory(category) {
  if (["LLM", "产品", "技术", "商业"].includes(category)) return category;
  if (category === "product") return "产品";
  if (category === "official" || category === "analysis" || category === "community") return "LLM";
  if (category === "media") return "商业";
  return "LLM";
}

function normalizeSourceType(type) {
  if (["official", "analysis", "media", "community", "product"].includes(type)) return type;
  if (type === "官方") return "official";
  if (type === "深度分析" || type === "分析") return "analysis";
  if (type === "社区") return "community";
  if (type === "媒体") return "media";
  if (type === "产品") return "product";
  return "analysis";
}

function clampHeat(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function normalizeScore(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const score = number <= 5 ? number * 20 : number;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function stableId(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function slug(value) {
  const base = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base || stableId(String(value));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countChineseChars(value) {
  return String(value ?? "").match(/[\u3400-\u9fff]/g)?.length ?? 0;
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function readFetchedDataset() {
  const fetched = await readLatestFetchedFromSupabase();
  if (fetched) return fetched;
  return readJson(fetchedPath);
}

async function readLatestFetchedFromSupabase() {
  const supabase = createSupabaseClientFromEnv();
  if (!supabase) return null;

  try {
    const { data: run, error: runError } = await supabase
      .from("trendlens_radar_runs")
      .select("id,generated_at,sources_snapshot,fetch_errors")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) return null;

    const { data: rows, error: rowsError } = await supabase
      .from("trendlens_fetched_articles")
      .select("raw")
      .eq("run_id", run.id);

    if (rowsError) throw rowsError;
    const articles = (rows ?? []).map((row) => row.raw).filter(Boolean);
    if (articles.length === 0) return null;

    return {
      version: 1,
      fetchedAt: run.generated_at,
      itemLimit,
      sources: Array.isArray(run.sources_snapshot) ? run.sources_snapshot : [],
      articles,
      errors: Array.isArray(run.fetch_errors) ? run.fetch_errors : [],
    };
  } catch (error) {
    console.warn(`Failed to read fetched articles from Supabase: ${normalizeError(error)}`);
    return null;
  }
}

async function persistPipelineResult({ fetched, radar }) {
  const supabase = createSupabaseClientFromEnv();
  if (!supabase) {
    return { provider: "file", status: "skipped", reason: "Supabase env not configured" };
  }

  try {
    await ensureSupabaseSourcesSeeded(supabase);

    const { data: run, error: runError } = await supabase
      .from("trendlens_radar_runs")
      .insert({
        version: radar.version ?? 1,
        mode: radar.mode,
        generated_at: radar.generatedAt,
        status: radar.status,
        topics: radar.topics ?? [],
        sources_snapshot: radar.sources ?? [],
        fetch_errors: radar.fetchErrors ?? [],
        rewrite_failures: radar.rewriteFailures ?? [],
        article_count: radar.articles?.length ?? 0,
      })
      .select("id")
      .single();

    if (runError) throw runError;

    await insertInBatches(
      supabase,
      "trendlens_articles",
      (radar.articles ?? []).map((article) => ({
        run_id: run.id,
        id: article.id,
        topic_id: article.topicId,
        source: article.source,
        source_type: article.sourceType,
        published_at: article.publishedAt,
        original_url: article.originalUrl,
        category: article.category,
        heat: article.heat,
        reading_time: article.readingTime,
        tags: article.tags ?? [],
        title: article.title,
        one_sentence: article.oneSentence,
        why_recommended: article.whyRecommended,
        why_now: article.whyNow,
        pm_angle: article.pmAngle,
        body_blocks: article.bodyBlocks ?? [],
        annotations: article.annotations ?? [],
        pm_takeaways: article.pmTakeaways ?? [],
        related_ids: article.relatedIds ?? [],
        images: article.images ?? [],
        hero_image: article.heroImage ?? null,
        raw: article,
      })),
    );

    await insertInBatches(
      supabase,
      "trendlens_fetched_articles",
      (fetched.articles ?? []).map((article) => ({
        run_id: run.id,
        id: article.id,
        source_id: article.sourceId,
        source_name: article.sourceName,
        title: article.title,
        url: article.url,
        published_at: article.publishedAt,
        parse_status: article.parseStatus,
        image_count: Array.isArray(article.images) ? article.images.length : 0,
        raw: article,
      })),
    );

    return { provider: "supabase", status: "ok", runId: run.id };
  } catch (error) {
    console.warn(`Failed to persist TrendLens data to Supabase: ${normalizeError(error)}`);
    return { provider: "supabase", status: "failed", error: normalizeError(error) };
  }
}

async function insertInBatches(supabase, tableName, rows, batchSize = 100) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(tableName).insert(batch);
    if (error) throw error;
  }
}

// 把 sources.yaml 和 Supabase 的 trendlens_sources 表对齐：增量插入缺失的信源。
// 设计原则：
// - 已存在的信源完全不动（不会覆盖用户在前端手动停用/启用的状态）。
// - 只把 yaml 中存在、但 Supabase 中缺失的信源补充进去。
// - 这样既能让首次部署时自动 seed，也能在后续向 yaml 新增信源后自动同步到线上。
async function ensureSupabaseSourcesSeeded(supabase) {
  const sources = await loadSourceConfigsFromYaml();
  if (!sources.length) return;

  const { data: existingRows, error } = await supabase.from("trendlens_sources").select("id");
  if (error) throw error;

  const existingIds = new Set((existingRows ?? []).map((row) => String(row.id)));
  const missingSources = sources.filter((source) => !existingIds.has(String(source.id)));

  if (!missingSources.length) return;

  const rows = missingSources.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    category: source.category,
    language: source.language ?? "en",
    weight: source.weight ?? 1,
    enabled: source.enabled !== false,
    fetch_interval: source.fetch_interval ?? null,
    raw: source,
  }));

  const { error: insertError } = await supabase.from("trendlens_sources").insert(rows);
  if (insertError) throw insertError;

  console.log(
    `[sources] 已向 Supabase 同步 ${rows.length} 个新信源：${rows.map((r) => r.id).join(", ")}`,
  );
}

function createSupabaseClientFromEnv() {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeModelLog(stage, entry) {
  if (stage !== "rewrite") return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = [timestamp, entry.articleId, entry.attempt ? `attempt-${entry.attempt}` : "", entry.event]
    .filter(Boolean)
    .map((part) => safeFilePart(part))
    .join("-");
  const filePath = path.join(logsDir, `deepseek-rewrite-${suffix}-${crypto.randomUUID().slice(0, 8)}.json`);
  const body = {
    version: 1,
    stage,
    loggedAt: new Date().toISOString(),
    ...entry,
  };

  try {
    await writeJson(filePath, body);
  } catch (error) {
    console.warn(`Failed to write model ${stage} log: ${normalizeError(error)}`);
  }
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").slice(0, 80);
}

function printSummary(label, radar, storage = { provider: "file", status: "skipped" }) {
  console.log(
    JSON.stringify(
      {
        command: label,
        mode: radar.mode,
        generatedAt: radar.generatedAt,
        topics: radar.topics.length,
        articles: radar.articles.length,
        fetchStatus: radar.status.fetch,
        fridayStatus: radar.status.friday,
        fridayError: radar.status.fridayError,
        rewriteFailures: radar.rewriteFailures?.length ?? 0,
        storage,
        output: path.relative(cwd, radarPath),
      },
      null,
      2,
    ),
  );
}
