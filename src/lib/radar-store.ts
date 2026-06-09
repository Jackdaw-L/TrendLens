import { promises as fs } from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";
import {
  articles as demoArticles,
  generationStatus as demoGenerationStatus,
  sourceStats as demoSourceStats,
  topics as demoTopics,
  type Article,
  type Topic,
} from "@/lib/radar-data";
import { getSupabaseAdminClient } from "@/lib/supabase-server";

const LIST_ARTICLE_COLUMNS = [
  "id",
  "topic_id",
  "source",
  "source_type",
  "published_at",
  "original_url",
  "category",
  "heat",
  "reading_time",
  "tags",
  "title",
  "one_sentence",
  "why_recommended",
  "why_now",
  "pm_angle",
  "pm_takeaways",
  "related_ids",
  "hero_image",
].join(",");

const FULL_ARTICLE_COLUMNS = [
  LIST_ARTICLE_COLUMNS,
  "body_blocks",
  "annotations",
  "images",
].join(",");

const SAVED_ARTICLE_COLUMNS = [
  "article_id",
  "source_run_id",
  "article_snapshot",
  "saved_at",
  "updated_at",
].join(",");

const RADAR_CACHE_SECONDS = 180;

export type RadarDataset = {
  version: number;
  mode: "demo" | "fetched" | "friday" | "deepseek";
  generatedAt: string;
  status: {
    fetch: "demo" | "ok" | "partial" | "failed";
    friday: "demo" | "ok" | "partial" | "skipped" | "failed";
    message: string;
    fridayError?: string;
  };
  topics: Topic[];
  articles: Article[];
  sources: unknown[];
  fetchErrors: unknown[];
  rewriteFailures: unknown[];
};

export async function loadRadarDataset(): Promise<RadarDataset> {
  return getCachedRadarDataset();
}

export async function loadFreshRadarDataset(): Promise<RadarDataset> {
  return loadRadarDatasetUncached({ fullArticles: false });
}

export async function loadRadarListDataset(): Promise<RadarDataset> {
  return getCachedRadarListDataset();
}

const getCachedRadarDataset = unstable_cache(
  () => loadRadarDatasetUncached({ fullArticles: true }),
  ["trendlens-radar-dataset-full"],
  { revalidate: RADAR_CACHE_SECONDS, tags: ["trendlens-radar"] },
);

const getCachedRadarListDataset = unstable_cache(
  () => loadRadarDatasetUncached({ fullArticles: false }),
  ["trendlens-radar-dataset-list"],
  { revalidate: RADAR_CACHE_SECONDS, tags: ["trendlens-radar"] },
);

async function loadRadarDatasetUncached({ fullArticles }: { fullArticles: boolean }): Promise<RadarDataset> {
  const supabaseDataset = await loadRadarDatasetFromSupabase({ fullArticles });
  if (supabaseDataset) return supabaseDataset;

  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "radar.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<RadarDataset>;

    if (Array.isArray(parsed.topics) && Array.isArray(parsed.articles)) {
      return {
        version: parsed.version ?? 1,
        mode: parsed.mode ?? "fetched",
        generatedAt: parsed.generatedAt ?? new Date().toISOString(),
        status: parsed.status ?? {
          fetch: "ok",
          friday: "skipped",
          message: "已读取本地生成数据。",
        },
        topics: parsed.topics,
        articles: fullArticles ? parsed.articles : parsed.articles.map(toListArticle),
        sources: parsed.sources ?? [],
        fetchErrors: parsed.fetchErrors ?? [],
        rewriteFailures: parsed.rewriteFailures ?? [],
      };
    }
  } catch {}

  return {
    version: 1,
    mode: "demo",
    generatedAt: demoGenerationStatus.lastFetchedAt,
    status: {
      fetch: "demo",
      friday: "demo",
      message: "当前展示内置演示数据；运行 npm run pipeline 后会读取真实 RSS/DeepSeek 结果。",
    },
    topics: demoTopics,
    articles: fullArticles ? demoArticles : demoArticles.map(toListArticle),
    sources: demoSourceStats,
    fetchErrors: [],
    rewriteFailures: [],
  };
}

async function loadRadarDatasetFromSupabase({ fullArticles = true } = {}): Promise<RadarDataset | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: run, error: runError } = await supabase
    .from("trendlens_radar_runs")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    console.warn(`Failed to load TrendLens radar run from Supabase: ${runError.message}`);
    return null;
  }

  if (!run) return null;

  const { data: articleRows, error: articleError } = await supabase
    .from("trendlens_articles")
    .select(fullArticles ? FULL_ARTICLE_COLUMNS : LIST_ARTICLE_COLUMNS)
    .eq("run_id", run.id)
    .order("published_at", { ascending: false });

  if (articleError) {
    console.warn(`Failed to load TrendLens articles from Supabase: ${articleError.message}`);
    return null;
  }

  const rows = (articleRows ?? []) as unknown as Record<string, unknown>[];

  return {
    version: Number(run.version ?? 1),
    mode: normalizeMode(run.mode),
    generatedAt: String(run.generated_at ?? new Date().toISOString()),
    status: normalizeStatus(run.status),
    topics: normalizeArray<Topic>(run.topics),
    articles: rows.map(articleFromSupabaseRow),
    sources: normalizeArray(run.sources_snapshot),
    fetchErrors: normalizeArray(run.fetch_errors),
    rewriteFailures: normalizeArray(run.rewrite_failures),
  };
}

function articleFromSupabaseRow(row: Record<string, unknown>): Article {
  return {
    id: String(row.id),
    topicId: String(row.topic_id ?? "today-radar"),
    source: String(row.source ?? ""),
    sourceType: normalizeSourceType(row.source_type),
    publishedAt: String(row.published_at ?? new Date().toISOString()),
    originalUrl: String(row.original_url ?? ""),
    category: normalizeCategory(row.category),
    heat: normalizeHeat(row.heat),
    readingTime: Math.max(1, Number(row.reading_time ?? 4)),
    tags: normalizeArray<string>(row.tags).map(String),
    title: String(row.title ?? "未命名文章"),
    oneSentence: String(row.one_sentence ?? ""),
    whyRecommended: String(row.why_recommended ?? ""),
    whyNow: String(row.why_now ?? ""),
    pmAngle: String(row.pm_angle ?? ""),
    bodyBlocks: normalizeArray(row.body_blocks) as Article["bodyBlocks"],
    annotations: normalizeArray(row.annotations) as Article["annotations"],
    pmTakeaways: normalizeArray<string>(row.pm_takeaways).map(String),
    relatedIds: normalizeArray<string>(row.related_ids).map(String),
    images: normalizeArray(row.images) as Article["images"],
    heroImage: (row.hero_image ?? null) as Article["heroImage"],
  };
}

function articleFromSnapshot(value: unknown): Article | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Partial<Article>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;

  return {
    id: row.id,
    topicId: typeof row.topicId === "string" ? row.topicId : "today-radar",
    source: typeof row.source === "string" ? row.source : "",
    sourceType: normalizeSourceType(row.sourceType),
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : new Date().toISOString(),
    originalUrl: typeof row.originalUrl === "string" ? row.originalUrl : "",
    category: normalizeCategory(row.category),
    heat: normalizeHeat(row.heat),
    readingTime: Math.max(1, Number(row.readingTime ?? 4)),
    tags: normalizeArray<string>(row.tags).map(String),
    title: row.title,
    oneSentence: typeof row.oneSentence === "string" ? row.oneSentence : "",
    whyRecommended: typeof row.whyRecommended === "string" ? row.whyRecommended : "",
    whyNow: typeof row.whyNow === "string" ? row.whyNow : "",
    pmAngle: typeof row.pmAngle === "string" ? row.pmAngle : "",
    bodyBlocks: normalizeArray(row.bodyBlocks) as Article["bodyBlocks"],
    annotations: normalizeArray(row.annotations) as Article["annotations"],
    pmTakeaways: normalizeArray<string>(row.pmTakeaways).map(String),
    relatedIds: normalizeArray<string>(row.relatedIds).map(String),
    images: normalizeArray(row.images) as Article["images"],
    heroImage: row.heroImage ?? null,
  };
}

function toListArticle(article: Article): Article {
  return {
    ...article,
    bodyBlocks: [],
    annotations: [],
    images: article.heroImage ? [article.heroImage] : [],
  };
}

function normalizeMode(value: unknown): RadarDataset["mode"] {
  if (value === "deepseek" || value === "friday" || value === "fetched" || value === "demo") {
    return value;
  }
  return "fetched";
}

function normalizeStatus(value: unknown): RadarDataset["status"] {
  if (value && typeof value === "object") {
    const status = value as Partial<RadarDataset["status"]>;
    return {
      fetch: status.fetch ?? "ok",
      friday: status.friday ?? "skipped",
      message: status.message ?? "已读取 Supabase 数据。",
      fridayError: status.fridayError,
    };
  }

  return {
    fetch: "ok",
    friday: "skipped",
    message: "已读取 Supabase 数据。",
  };
}

function normalizeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeSourceType(value: unknown): Article["sourceType"] {
  if (value === "official" || value === "analysis" || value === "media" || value === "community" || value === "product") {
    return value;
  }
  return "analysis";
}

function normalizeCategory(value: unknown): Article["category"] {
  if (value === "LLM" || value === "产品" || value === "技术" || value === "商业") return value;
  return "LLM";
}

function normalizeHeat(value: unknown): Article["heat"] {
  const heat = Number(value);
  if (heat >= 1 && heat <= 5) return heat as Article["heat"];
  return 3;
}

export async function getRuntimeArticle(id: string) {
  return getCachedRuntimeArticle(id);
}

const getCachedRuntimeArticle = unstable_cache(
  (id: string) => getRuntimeArticleUncached(id),
  ["trendlens-runtime-article"],
  { revalidate: RADAR_CACHE_SECONDS, tags: ["trendlens-radar"] },
);

async function getRuntimeArticleUncached(id: string) {
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data: run, error: runError } = await supabase
      .from("trendlens_radar_runs")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!runError && run) {
      const { data: articleRow, error: articleError } = await supabase
        .from("trendlens_articles")
        .select(FULL_ARTICLE_COLUMNS)
        .eq("run_id", run.id)
        .eq("id", id)
        .maybeSingle();

      if (!articleError && articleRow) {
        const { data: relatedRows, error: relatedError } = await supabase
          .from("trendlens_articles")
          .select(LIST_ARTICLE_COLUMNS)
          .eq("run_id", run.id)
          .order("published_at", { ascending: false });

        const relatedSource = relatedError
          ? []
          : ((relatedRows ?? []) as unknown as Record<string, unknown>[]).map(articleFromSupabaseRow);
        const article = articleFromSupabaseRow(articleRow as unknown as Record<string, unknown>);

        return {
          dataset: {
            version: Number(run.version ?? 1),
            mode: normalizeMode(run.mode),
            generatedAt: String(run.generated_at ?? new Date().toISOString()),
            status: normalizeStatus(run.status),
            topics: normalizeArray<Topic>(run.topics),
            articles: relatedSource,
            sources: normalizeArray(run.sources_snapshot),
            fetchErrors: normalizeArray(run.fetch_errors),
            rewriteFailures: normalizeArray(run.rewrite_failures),
          },
          article,
        };
      }
    }
  }

  const savedArticle = await getSavedArticle(id);
  if (savedArticle) {
    const dataset = await loadRadarListDataset();
    return {
      dataset: {
        ...dataset,
        articles: [savedArticle, ...dataset.articles.filter((item) => item.id !== savedArticle.id)],
      },
      article: savedArticle,
    };
  }

  const dataset = await loadRadarDataset();
  return {
    dataset,
    article: dataset.articles.find((item) => item.id === id),
  };
}

export async function loadSavedArticleIds(): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trendlens_saved_articles")
    .select("article_id")
    .order("saved_at", { ascending: false });

  if (error) {
    console.warn(`Failed to load TrendLens saved article ids from Supabase: ${error.message}`);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => row.article_id)
    .filter((articleId): articleId is string => typeof articleId === "string");
}

export async function loadSavedArticles(): Promise<Article[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trendlens_saved_articles")
    .select(SAVED_ARTICLE_COLUMNS)
    .order("saved_at", { ascending: false });

  if (error) {
    console.warn(`Failed to load TrendLens saved articles from Supabase: ${error.message}`);
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => articleFromSnapshot(row.article_snapshot))
    .filter((article): article is Article => Boolean(article));
}

export async function getSavedArticle(id: string): Promise<Article | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("trendlens_saved_articles")
    .select("article_snapshot")
    .eq("article_id", id)
    .maybeSingle();

  if (error) {
    console.warn(`Failed to load TrendLens saved article from Supabase: ${error.message}`);
    return null;
  }

  return articleFromSnapshot((data as Record<string, unknown> | null)?.article_snapshot);
}

export async function findArticleForSaving(id: string): Promise<{ article: Article; runId: string | null } | null> {
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("trendlens_articles")
      .select(`${FULL_ARTICLE_COLUMNS},run_id,created_at`)
      .eq("id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`Failed to load TrendLens article for saving from Supabase: ${error.message}`);
    }

    if (data) {
      const row = data as unknown as Record<string, unknown>;
      return {
        article: articleFromSupabaseRow(row),
        runId: typeof row.run_id === "string" ? row.run_id : null,
      };
    }
  }

  const dataset = await loadRadarDataset();
  const article = dataset.articles.find((item) => item.id === id);
  return article ? { article, runId: null } : null;
}

export async function getRuntimeTopic(id: string) {
  const dataset = await loadRadarDataset();
  return {
    dataset,
    topic: dataset.topics.find((item) => item.id === id),
    articles: dataset.articles.filter((item) => item.topicId === id),
  };
}
