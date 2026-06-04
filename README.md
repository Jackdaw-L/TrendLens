# TrendLens

TrendLens 是一个面向 iPhone 阅读的科技资讯处理应用。它不是普通 RSS 阅读器，而是把「科技 / 互联网 / 大模型」信息源先经过抓取、正文抽取、AI 选文、中文转写和 PM 视角标注，再呈现成每天大约 10 篇值得读的推荐文章。

## 产品形态

- 首页：展示当日处理后的推荐文章列表，每篇文章带来源、热度、AI 推荐语和阅读状态。
- 文章详情：展示忠实中文转写、原文图片、术语注释、AI 推荐语、PM Takeaways、收藏、分享和跳转原文。
- 收藏页：读取本地收藏状态，方便回看。
- 设置页：查看系统状态，管理 RSS 信息源，并通过「更新推荐」手动触发一次完整更新。
- PWA：适合在 iPhone Safari 中添加到主屏幕使用。

## 数据流程

TrendLens 的内容生产链路在 `scripts/pipeline.mjs`：

1. 从 Supabase 的 `trendlens_sources` 读取启用的信息源，失败时回退到 `sources.yaml`。
2. 拉取 RSS item，并尽量抓取原文 HTML。
3. 用 Readability 抽取正文和图片。
4. 调用 DeepSeek 做两段处理：
   - selection：从候选文章中选出推荐列表。
   - rewrite：逐篇做忠实中文转写、注释、图片位置和 PM Takeaways。
5. 写入 Supabase：
   - `trendlens_radar_runs`
   - `trendlens_articles`
   - `trendlens_fetched_articles`
6. 线上应用读取 Supabase 最新 run；若不可用，回退到 `data/radar.json`，再回退到内置 demo 数据。

## 代码结构

```text
src/app/
  page.tsx                 首页
  saved/page.tsx           收藏页
  settings/page.tsx        设置页
  articles/[id]/page.tsx   文章详情页
  api/radar/route.ts       获取最新推荐数据
  api/sources/route.ts     信息源启停、删除
  api/recommendations/     触发 GitHub Actions 更新推荐
  api/revalidate/          更新完成后清 Next/Netlify 缓存

src/components/
  app-chrome.tsx           顶部栏、底部导航、通用按钮
  home-screen.tsx          首页信息流
  article-screen.tsx       文章详情阅读体验
  saved-screen.tsx         收藏列表
  settings-screen.tsx      设置和信息源管理
  lazy-image.tsx           图片懒加载与占位
  use-reading-state.ts     本地阅读/收藏状态

src/lib/
  radar-store.ts           从 Supabase、本地 JSON、demo 加载推荐数据
  source-store.ts          信息源读取和管理
  supabase-server.ts       Supabase admin client
  radar-data.ts            demo 数据与类型定义

scripts/
  pipeline.mjs             RSS 抓取、DeepSeek 处理、Supabase 写入

prompts/
  select-*.md              选文 prompt
  rewrite-*.md             中文转写 prompt

supabase/
  schema.sql               当前数据表结构
```

## 本地开发

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

电脑上访问 `http://localhost:3000`。手机和电脑在同一网络下时，可以用电脑局域网 IP 在 iPhone Safari 打开并添加到主屏幕。

常用检查：

```bash
npm run lint
npm run build
```

## 内容更新

本地可以直接跑完整流水线：

```bash
npm run pipeline
```

快速 smoke run：

```bash
SOURCE_LIMIT=3 MAX_ITEMS_PER_SOURCE=1 LLM_MAX_ARTICLES=3 npm run pipeline
```

线上日更由 `.github/workflows/daily-pipeline.yml` 托管：每天北京时间 07:37 自动运行，目标是在 08:00 前完成更新；也可以在设置页输入口令触发。工作流完成后会调用 `/api/revalidate`，让页面尽快读取 Supabase 中的新结果。

## Prompt 调优

LLM prompt 独立放在 `prompts/`，方便不改代码直接调：

- `select-system.md` / `select-user.md`：决定哪些文章值得推荐。
- `rewrite-system.md` / `rewrite-user.md`：决定中文转写、术语注释、图片插入和 PM Takeaways 的输出结构。

模型原始返回日志会写到 `data/logs/deepseek-rewrite-*.json`，该目录不会提交到 Git。

## 继续开发时优先看哪里

- 想改页面样式：先看 `src/app/globals.css`，再看对应 `src/components/*-screen.tsx`。
- 想改文章详情体验：看 `src/components/article-screen.tsx`。
- 想改推荐策略：优先改 `prompts/select-*.md`。
- 想改转写结构：优先改 `prompts/rewrite-*.md` 和 `scripts/pipeline.mjs` 的校验逻辑。
- 想调跨天去重：改环境变量 `DEDUP_LOOKBACK_DAYS`（默认 3 天，设为 0 关闭），逻辑在 `scripts/pipeline.mjs` 的 `excludeRecentlyRecommended`。
- 想改信息源管理：看 `src/lib/source-store.ts` 和 `src/app/api/sources/route.ts`。
