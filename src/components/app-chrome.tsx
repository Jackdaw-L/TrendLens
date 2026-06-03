"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  Heart,
  Home,
  Settings,
  Sparkles,
  RefreshCcw,
} from "lucide-react";
import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function AppShell({ children, footer, className = "" }: AppShellProps) {
  return (
    <main className={`app-shell ${className}`}>
      <div className="app-frame">
        <div className="app-safe page-transition">{children}</div>
        {footer ?? <BottomNav />}
      </div>
    </main>
  );
}

export function TopAppBar({
  title = "TrendLens",
  action,
}: {
  title?: string;
  action?: ReactNode;
}) {
  return (
    <header className="top-app-bar">
      <div className="brand-mark" aria-hidden>
        <Image alt="" height={40} priority src="/trendlens-icon.png" width={40} />
      </div>
      <strong>{title}</strong>
      <div className="top-app-bar__action">{action}</div>
    </header>
  );
}

export function HeaderBar({
  title = "TrendLens",
  backHref = "/",
  action,
}: {
  title?: string;
  backHref?: string;
  action?: ReactNode;
}) {
  return (
    <header className="article-top-bar">
      <Link className="round-icon-button" href={backHref} aria-label="返回">
        <ArrowLeft aria-hidden size={21} />
      </Link>
      <strong>{title}</strong>
      <div className="article-top-bar__action">{action}</div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "首页", icon: Home, active: pathname === "/" },
    {
      href: "/saved",
      label: "收藏",
      icon: Heart,
      active: pathname.startsWith("/saved"),
    },
    {
      href: "/settings",
      label: "设置",
      icon: Settings,
      active: pathname.startsWith("/settings"),
    },
  ];

  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            className={`bottom-nav__item ${item.active ? "is-active" : ""}`}
            href={item.href}
            key={item.href}
            prefetch
          >
            <Icon
              aria-hidden
              fill={item.active ? "currentColor" : "none"}
              size={22}
              strokeWidth={2.2}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function RefreshButton({ busy = false, onClick }: { busy?: boolean; onClick: () => void }) {
  return (
    <button
      aria-busy={busy}
      aria-label="刷新"
      className={`round-icon-button ${busy ? "is-spinning" : ""}`}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      <RefreshCcw aria-hidden size={18} />
    </button>
  );
}

export function BookmarkButton({
  active,
  onClick,
  label = active ? "取消收藏" : "收藏",
}: {
  active: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      aria-label={label}
      className={`bookmark-button ${active ? "is-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <Bookmark aria-hidden fill={active ? "currentColor" : "none"} size={21} />
    </button>
  );
}

export function HeatScore({ value }: { value: number }) {
  return (
    <span className="heat-score" aria-label={`热度 ${value}`}>
      <Sparkles aria-hidden size={14} />
      {value}
    </span>
  );
}

export function ExternalLinkLabel({ href }: { href: string }) {
  return (
    <a className="text-link" href={href} rel="noreferrer" target="_blank">
      原文
      <ExternalLink aria-hidden size={14} />
    </a>
  );
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function sourceLabel(category?: string) {
  if (category === "official") return "官方";
  if (category === "analysis") return "深度分析";
  if (category === "community") return "社区";
  if (category === "product") return "产品";
  if (category === "media") return "媒体";
  if (category === "LLM") return "大模型";
  if (category === "技术") return "科技";
  if (category === "商业") return "互联网";
  return category ?? "RSS";
}
