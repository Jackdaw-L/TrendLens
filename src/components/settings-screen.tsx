"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, RefreshCcw, Rss, Sparkles, Trash2, X } from "lucide-react";
import {
  AppShell,
  RefreshButton,
  TopAppBar,
  formatDateTime,
  sourceLabel,
} from "@/components/app-chrome";
import { useReadingState } from "@/components/use-reading-state";
import { appSecretHeaders, getAppSecret, setAppSecret } from "@/lib/app-secret";
import type { SourceProposal } from "@/lib/proposal-store";
import type { RadarDataset } from "@/lib/radar-store";
import type { SourceConfig } from "@/lib/source-store";

function writeErrorFeedback(status: number, fallback: string) {
  if (status === 401) return "口令不正确，请先在「操作口令」里保存正确口令";
  if (status === 503) return "服务端未配置口令，暂时无法执行写操作";
  return fallback;
}

type RuntimeSource = {
  id: string;
  status?: string;
  itemCount?: number;
  error?: string | null;
};

export function SettingsScreen({
  dataset,
  initialSources,
  initialProposals = [],
}: {
  dataset: RadarDataset;
  initialSources: SourceConfig[];
  initialProposals?: SourceProposal[];
}) {
  const router = useRouter();
  const reading = useReadingState();
  const [sources, setSources] = useState(initialSources);
  const [proposals, setProposals] = useState(initialProposals);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isRecommendationDialogOpen, setRecommendationDialogOpen] = useState(false);
  const [recommendationSecret, setRecommendationSecret] = useState("");
  const [isTriggeringRecommendation, setTriggeringRecommendation] = useState(false);
  const [appSecretInput, setAppSecretInput] = useState("");
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [isSavingSecret, setSavingSecret] = useState(false);
  const [isRefreshing, startRefreshTransition] = useTransition();

  useEffect(() => {
    setHasStoredSecret(Boolean(getAppSecret()));
  }, []);
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
        headers: { "content-type": "application/json", ...appSecretHeaders() },
        body: JSON.stringify({ id: source.id, enabled: nextEnabled }),
      });
      if (!response.ok) {
        setFeedback(writeErrorFeedback(response.status, "更新失败，请稍后重试"));
        return;
      }
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
        headers: { "content-type": "application/json", ...appSecretHeaders() },
        body: JSON.stringify({ id: source.id }),
      });
      if (!response.ok) {
        setFeedback(writeErrorFeedback(response.status, "删除失败，请稍后重试"));
        return;
      }
      const payload = (await response.json()) as { sources: SourceConfig[] };
      setSources(payload.sources);
      setFeedback("已删除信息源");
    } catch {
      setFeedback("删除失败，请稍后重试");
    } finally {
      setBusySourceId(null);
    }
  }

  async function handleProposal(proposal: SourceProposal, action: "accept" | "dismiss") {
    if (
      action === "accept" &&
      proposal.type === "remove" &&
      !window.confirm(`删除信息源「${proposal.name}」？历史文章会保留，且不会被自动重新添加。`)
    ) {
      return;
    }

    setBusyProposalId(proposal.id);
    setFeedback(null);

    try {
      const response = await fetch("/api/source-proposals", {
        method: "POST",
        headers: { "content-type": "application/json", ...appSecretHeaders() },
        body: JSON.stringify({ id: proposal.id, action }),
      });
      if (!response.ok) {
        setFeedback(writeErrorFeedback(response.status, "处理建议失败，请稍后重试"));
        return;
      }
      const payload = (await response.json()) as { sources: SourceConfig[]; proposals: SourceProposal[] };
      setSources(payload.sources);
      setProposals(payload.proposals);
      setFeedback(
        action === "dismiss"
          ? "已忽略该建议"
          : proposal.type === "add"
            ? `已添加信息源「${proposal.name}」，下次更新推荐时开始抓取`
            : `已删除信息源「${proposal.name}」`,
      );
    } catch {
      setFeedback("处理建议失败，请稍后重试");
    } finally {
      setBusyProposalId(null);
    }
  }

  function refreshSettings() {
    reading.markRefresh();
    startRefreshTransition(() => router.refresh());
  }

  async function triggerRecommendationUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = recommendationSecret.trim();
    if (!secret) {
      setFeedback("请输入更新口令");
      return;
    }

    setTriggeringRecommendation(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/recommendations/trigger", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trendlens-secret": secret,
        },
        body: JSON.stringify({ reason: "settings-button" }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        missing?: string[];
      };

      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          setFeedback("口令不正确，请重新输入");
          return;
        }

        if (payload.missing?.length) {
          setFeedback(`更新推荐还没配置完整：${payload.missing.join("、")}`);
          return;
        }

        setFeedback(payload.error || "启动更新失败，请稍后重试");
        return;
      }

      // 触发成功说明口令正确，顺手保存到本机，收藏和信息源管理可以直接复用。
      setAppSecret(secret);
      setHasStoredSecret(true);
      setRecommendationDialogOpen(false);
      setRecommendationSecret("");
      setFeedback("已启动更新推荐，完成后首页会读取最新结果");
    } catch {
      setFeedback("启动更新失败，请稍后重试");
    } finally {
      setTriggeringRecommendation(false);
    }
  }

  async function saveAppSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = appSecretInput.trim();
    setFeedback(null);

    if (!secret) {
      setAppSecret("");
      setHasStoredSecret(false);
      setFeedback("已清除本机口令");
      return;
    }

    setSavingSecret(true);
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        cache: "no-store",
        headers: { "x-trendlens-secret": secret },
      });

      if (response.status === 401) {
        setFeedback("口令不正确");
        return;
      }
      if (!response.ok) {
        setFeedback("服务端还未配置口令（TRENDLENS_TRIGGER_SECRET）");
        return;
      }

      setAppSecret(secret);
      setHasStoredSecret(true);
      setAppSecretInput("");
      setFeedback("口令已保存，本机的收藏、信息源管理和更新推荐会自动使用");
    } catch {
      setFeedback("校验口令失败，请稍后重试");
    } finally {
      setSavingSecret(false);
    }
  }

  return (
    <AppShell>
      <TopAppBar action={<RefreshButton busy={isRefreshing} onClick={refreshSettings} />} />

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
        <button
          className="primary-pill"
          onClick={() => {
            setFeedback(null);
            setRecommendationSecret(getAppSecret());
            setRecommendationDialogOpen(true);
          }}
          type="button"
        >
          <RefreshCcw aria-hidden size={18} />
          更新推荐
        </button>
      </div>

      {feedback && <p className="settings-feedback">{feedback}</p>}

      <section className="source-section" aria-label="操作口令">
        <div className="section-title-row">
          <h2>操作口令</h2>
          <span>{hasStoredSecret ? "本机已保存" : "未设置"}</span>
        </div>
        <form className="secret-row" onSubmit={saveAppSecret}>
          <div className="secret-row__icon">
            <KeyRound aria-hidden size={19} />
          </div>
          <input
            autoComplete="off"
            disabled={isSavingSecret}
            onChange={(event) => setAppSecretInput(event.target.value)}
            placeholder={hasStoredSecret ? "重新输入可更换口令" : "输入操作口令"}
            type="password"
            value={appSecretInput}
          />
          <button className="secondary-pill" disabled={isSavingSecret} type="submit">
            {isSavingSecret ? "校验中" : "保存"}
          </button>
        </form>
        <p className="secret-hint">
          收藏、信息源管理和更新推荐共用这一个口令；输入一次后保存在本机浏览器。留空提交可清除。
        </p>
      </section>

      <section className="source-section">
        <div className="section-title-row">
          <h2>信息源列表</h2>
          <span>{sources.length} 个</span>
        </div>

        {proposals.length > 0 && (
          <div className="proposal-module" aria-label="信源建议">
            <div className="proposal-module__title">
              <Sparkles aria-hidden size={16} />
              <strong>每周信源建议</strong>
              <span>{proposals.length} 条待确认</span>
            </div>
            {proposals.map((proposal) => {
              const busy = busyProposalId === proposal.id;
              return (
                <article className="proposal-card" key={proposal.id}>
                  <header>
                    <span className={`proposal-badge ${proposal.type === "add" ? "is-add" : "is-remove"}`}>
                      {proposal.type === "add" ? "建议新增" : "建议删除"}
                    </span>
                    <strong>{proposal.name}</strong>
                  </header>
                  {proposal.url && <p className="proposal-card__url">{proposal.url}</p>}
                  <p className="proposal-card__reason">{proposal.reason}</p>
                  <div className="proposal-card__actions">
                    <button
                      className="secondary-pill"
                      disabled={busy}
                      onClick={() => handleProposal(proposal, "dismiss")}
                      type="button"
                    >
                      忽略
                    </button>
                    <button
                      className="primary-pill"
                      disabled={busy}
                      onClick={() => handleProposal(proposal, "accept")}
                      type="button"
                    >
                      {busy ? "处理中" : proposal.type === "add" ? "添加" : "删除"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

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

      {isRecommendationDialogOpen && (
        <div
          className="dialog-scrim"
          onClick={() => {
            if (!isTriggeringRecommendation) setRecommendationDialogOpen(false);
          }}
        >
          <form
            aria-labelledby="recommendation-dialog-title"
            className="password-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={triggerRecommendationUpdate}
            role="dialog"
            aria-modal="true"
          >
            <div className="dialog-title-row">
              <div>
                <h2 id="recommendation-dialog-title">更新推荐</h2>
                <p>输入口令后，将启动一次 RSS 拉取、DeepSeek 选文和全文转写。</p>
              </div>
              <button
                aria-label="关闭"
                className="sheet-close"
                disabled={isTriggeringRecommendation}
                onClick={() => setRecommendationDialogOpen(false)}
                type="button"
              >
                <X aria-hidden size={18} />
              </button>
            </div>

            <label className="password-field">
              <span>口令</span>
              <input
                autoComplete="off"
                autoFocus
                disabled={isTriggeringRecommendation}
                onChange={(event) => setRecommendationSecret(event.target.value)}
                placeholder="请输入口令"
                type="password"
                value={recommendationSecret}
              />
            </label>

            <div className="dialog-actions">
              <button
                className="secondary-pill"
                disabled={isTriggeringRecommendation}
                onClick={() => setRecommendationDialogOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                aria-busy={isTriggeringRecommendation}
                className="primary-pill"
                disabled={isTriggeringRecommendation}
                type="submit"
              >
                <RefreshCcw aria-hidden size={18} />
                {isTriggeringRecommendation ? "启动中" : "确认更新"}
              </button>
            </div>
          </form>
        </div>
      )}
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
  if (status === "ok") return "DeepSeek";
  if (status === "partial") return "部分成功";
  if (status === "failed") return "失败";
  return "待生成";
}
