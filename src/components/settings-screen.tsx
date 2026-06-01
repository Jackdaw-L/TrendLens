"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCcw, Rss, Trash2 } from "lucide-react";
import {
  AppShell,
  RefreshButton,
  TopAppBar,
  formatDateTime,
  sourceLabel,
} from "@/components/app-chrome";
import { useReadingState } from "@/components/use-reading-state";
import type { RadarDataset } from "@/lib/radar-store";
import type { SourceConfig } from "@/lib/source-store";

type RuntimeSource = {
  id: string;
  status?: string;
  itemCount?: number;
  error?: string | null;
};

export function SettingsScreen({
  dataset,
  initialSources,
}: {
  dataset: RadarDataset;
  initialSources: SourceConfig[];
}) {
  const reading = useReadingState();
  const [sources, setSources] = useState(initialSources);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const runtimeById = useMemo(() => {
    return new Map(dataset.sources.map(normalizeRuntimeSource).map((source) => [source.id, source]));
  }, [dataset.sources]);

  async function toggleSource(source: SourceConfig) {
    const nextEnabled = source.enabled === false;
    setBusySourceId(source.id);
    setFeedback(null);

    try {
      const response = await fetch("/api/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: source.id, enabled: nextEnabled }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { sources: SourceConfig[] };
      setSources(payload.sources);
      setFeedback(nextEnabled ? "已启用信息源" : "已停用信息源");
    } catch {
      setFeedback("更新失败，请稍后重试");
    } finally {
      setBusySourceId(null);
    }
  }

  async function removeSource(source: SourceConfig) {
    if (!window.confirm(`删除信息源「${source.name}」？历史文章会保留，但后续不再抓取。`)) {
      return;
    }

    setBusySourceId(source.id);
    setFeedback(null);

    try {
      const response = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: source.id }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { sources: SourceConfig[] };
      setSources(payload.sources);
      setFeedback("已删除信息源");
    } catch {
      setFeedback("删除失败，请稍后重试");
    } finally {
      setBusySourceId(null);
    }
  }

  return (
    <AppShell>
      <TopAppBar action={<RefreshButton onClick={reading.markRefresh} />} />

      <section className="page-heading">
        <h1>设置</h1>
        <p>系统状态与信息源管理。</p>
      </section>

      <section className="status-grid" aria-label="运行状态">
        <StatusTile label="最近同步" value={formatDateTime(dataset.generatedAt)} />
        <StatusTile label="今日抓取" value={String(countFetched(dataset))} />
        <StatusTile label="推荐文章" value={String(dataset.articles.length)} />
        <StatusTile label="模型状态" value={modelStatusText(dataset.status.friday)} />
      </section>

      <div className="settings-actions">
        <button className="primary-pill" onClick={reading.markRefresh} type="button">
          <RefreshCcw aria-hidden size={18} />
          手动刷新
        </button>
      </div>

      <section className="source-section">
        <div className="section-title-row">
          <h2>信息源列表</h2>
          <span>{sources.length} 个</span>
        </div>

        {feedback && <p className="settings-feedback">{feedback}</p>}

        <div className="source-list">
          {sources.map((source) => {
            const runtime = runtimeById.get(source.id);
            const enabled = source.enabled !== false;
            const busy = busySourceId === source.id;

            return (
              <article className={`source-row ${enabled ? "" : "is-disabled"}`} key={source.id}>
                <div className="source-row__icon">
                  <Rss aria-hidden size={19} />
                </div>
                <div className="source-row__body">
                  <h3>{source.name}</h3>
                  <p>{source.url}</p>
                  <div className="source-row__meta">
                    <span>{sourceLabel(source.category)}</span>
                    <span>{runtimeText(runtime)}</span>
                  </div>
                </div>
                <div className="source-row__actions">
                  <button
                    aria-label={enabled ? "停用信息源" : "启用信息源"}
                    aria-pressed={enabled}
                    className={`source-toggle ${enabled ? "is-on" : ""}`}
                    disabled={busy}
                    onClick={() => toggleSource(source)}
                    type="button"
                  >
                    <span />
                  </button>
                  <button
                    aria-label="删除信息源"
                    className="delete-source-button"
                    disabled={busy}
                    onClick={() => removeSource(source)}
                    type="button"
                  >
                    <Trash2 aria-hidden size={18} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <button className="add-source-button" disabled type="button">
          <Plus aria-hidden size={18} />
          新增信息源
        </button>
      </section>
    </AppShell>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeRuntimeSource(source: unknown): RuntimeSource {
  if (!source || typeof source !== "object") return { id: "unknown" };
  const value = source as Partial<RuntimeSource>;
  return {
    id: String(value.id ?? "unknown"),
    status: value.status,
    itemCount: Number(value.itemCount ?? 0),
    error: value.error ?? null,
  };
}

function runtimeText(source?: RuntimeSource) {
  if (!source) return "未抓取";
  if (source.error) return `失败：${source.error}`;
  if (source.status === "ok") return `成功${source.itemCount ? ` · ${source.itemCount} 篇` : ""}`;
  return source.status ?? "未抓取";
}

function countFetched(dataset: RadarDataset) {
  return dataset.sources
    .map(normalizeRuntimeSource)
    .reduce((total, source) => total + (source.itemCount ?? 0), 0);
}

function modelStatusText(status: RadarDataset["status"]["friday"]) {
  if (status === "ok") return "Friday";
  if (status === "partial") return "部分成功";
  if (status === "failed") return "失败";
  return "待生成";
}
