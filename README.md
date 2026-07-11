# TrendLens

TrendLens 是一个面向 iPhone 阅读的科技资讯处理应用。它不是普通 RSS 阅读器，而是把「科技 / 互联网 / 大模型」信息源先经过抓取、正文抽取、AI 选文、中文转写和 PM 视角标注，再呈现成每天大约 10 篇值得读的推荐文章。

## 产品形态

- 首页：展示当日处理后的推荐文章列表，每篇文章带来源、热度、AI 推荐语和阅读状态。
- 文章详情：展示忠实中文转写、原文图片、术语注释、AI 推荐语、PM Takeaways、收藏、分享和跳转原文。
- 收藏页：收藏保存在 Supabase（带文章快照），跨设备可见。
- 设置页：查看系统状态，管理 RSS 信息源，保存操作口令，并通过「更新推荐」手动触发一次完整更新。
- 阅读状态：已读标记本地立即生效，保存口令后自动同步到 Supabase，换设备不丢。
- PWA：适合在 iPhone Safari 中添加到主屏幕使用。

## 写操作鉴权

页面浏览完全公开；所有写操作（收藏、信息源启停/删除、已读同步、触发更新）共用一个口令，
由环境变量 `TRENDLENS_TRIGGER_SECRET` 配置，请求头 `x-trendlens-secret` 携带（旧的
`x-trendlens-trigger-secret` 头仍然兼容）。在设置页「操作口令」输入一次后保存在本机浏览器，
之后的写请求自动携带；未配置该环境变量时，服务端拒绝所有写操作。

## 数据流程

TrendLens 的内容生产链路在 `scripts/pipeline.mjs`：

1. 从 Supabase 的 `trendlens_sources` 读取启用的信息源，失败时回退到 `sources.yaml`。
2. 拉取 RSS item，并尽量抓取原文 HTML。
3. 用 Readability 抽取正文和图片。
4. 调用 DeepSeek 做三段处理：
   - selection：结合每周维护的兴趣画像，从候选文章中选出推荐列表。
   - rewrite：逐篇做忠实中文转写、注释、图片位置和 PM Takeaways。
   - review：逐篇忠实性复核，对照原文查编造/错乱，不过则打回重写；累计 3 次不过的文章不进日推。
5. 写入 Supabase：
   - `trendlens_radar_runs`
   - `trendlens_articles`
   - `trendlens_fetched_articles`
6. 清理过期数据：删除超过 `RUNS_RETENTION_DAYS`（默认 30）天的历史 run，文章与抓取快照随外键 cascade 一并删除；收藏快照不受影响。
7. 线上应用读取 Supabase 最新 run；若不可用，回退到 `data/radar.json`，再回退到内置 demo 数据。

抓取和转写默认并发执行（信源级 `FETCH_SOURCE_CONCURRENCY=4`、单信源内文章 `FETCH_ARTICLE_CONCURRENCY=3`、DeepSeek 逐篇转写 `REWRITE_CONCURRENCY=2`），可按需调小以规避限流。

## 每周画像任务

`scripts/weekly-profile.mjs` 由 `.github/workflows/weekly-profile.yml` 每周日 21:07（北京时间）运行，构成「消费行为反哺筛选」的闭环：

1. 统计近 14 天行为：收藏（强正信号）、已读、展示未读（弱负信号）、各信源阅读率。
2. 调用 DeepSeek 生成兴趣画像和日推筛选策略，写入 `trendlens_profile`；次日选文 prompt 自动注入最新画像。
3. 在夹板内自动微调信源权重（单次 ±0.2，范围 0.5~1.6，展示数不足 5 的信源不动）。
4. 扫描信源健康度：连续失败 ≥ 7 次的信源生成「建议删除」提案。
5. 按画像推荐最多 2 个新信源（feed 经实际抓取验证），生成「建议新增」提案。

增删提案写入 `trendlens_source_proposals`，在设置页信息源列表上方展示，由用户逐条「添加/删除/忽略」确认后才生效；被删除的信源会记入 `trendlens_source_tombstones`，避免被 `sources.yaml` 的增量 seed 复活。

本地调试：`node scripts/weekly-profile.mjs --dry-run`（正常读数据、调模型，但不写库）。

## 代码结构

```text
src/app/
  page.tsx                 首页
  saved/page.tsx           收藏页
  settings/page.tsx        设置页
  articles/[id]/page.tsx   文章详情页
  api/radar/route.ts       获取最新推荐数据
  api/sources/route.ts     信息源启停、删除（写操作需口令）
  api/source-proposals/    信源增删提案的查看与确认（写操作需口令）
  api/favorites/route.ts   收藏读取与增删（写操作需口令）
  api/reading/route.ts     已读状态读取与上报（写操作需口令）
  api/auth/verify/route.ts 校验操作口令
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
  proposal-store.ts        信源增删提案的读取与确认执行
  reading-store.ts         已读状态的 Supabase 读写
  api-auth.ts              写操作口令校验（服务端）
  app-secret.ts            操作口令的本机存储（客户端）
  supabase-server.ts       Supabase admin client
  radar-data.ts            demo 数据与类型定义

scripts/
  pipeline.mjs             RSS 抓取、DeepSeek 选文/转写/复核、Supabase 写入
  weekly-profile.mjs       每周兴趣画像、信源权重微调、信源健康度与增删提案

prompts/
  select-*.md              选文 prompt（注入兴趣画像）
  rewrite-*.md             中文转写 prompt
  review-*.md              转写忠实性复核 prompt
  profile-*.md             每周画像 prompt

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
