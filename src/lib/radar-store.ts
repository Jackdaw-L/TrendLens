import { promises as fs } from "node:fs";
import path from "node:path";
import {
  articles as demoArticles,
  generationStatus as demoGenerationStatus,
  sourceStats as demoSourceStats,
  topics as demoTopics,
  type Article,
  type Topic,
} from "@/lib/radar-data";

export type RadarDataset = {
  version: number;
  mode: "demo" | "fetched" | "friday";
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
        articles: parsed.articles,
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
      message: "当前展示内置演示数据；运行 npm run pipeline 后会读取真实 RSS/Friday 结果。",
    },
    topics: demoTopics,
    articles: demoArticles,
    sources: demoSourceStats,
    fetchErrors: [],
    rewriteFailures: [],
  };
}

export async function getRuntimeArticle(id: string) {
  const dataset = await loadRadarDataset();
  return {
    dataset,
    article: dataset.articles.find((item) => item.id === id),
  };
}

export async function getRuntimeTopic(id: string) {
  const dataset = await loadRadarDataset();
  return {
    dataset,
    topic: dataset.topics.find((item) => item.id === id),
    articles: dataset.articles.filter((item) => item.topicId === id),
  };
}
