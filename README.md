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

`scripts/weekly-profile.mjs` 每周日 21:07（北京时间）由 Supabase Cron 触发 GitHub Actions 运行，构成「消费行为反哺筛选」的闭环：

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
  job-store.ts             自动更新异常状态，供设置页展示
  api-auth.ts              写操作口令校验（服务端）
  app-secret.ts            操作口令的本机存储（客户端）
  supabase-server.ts       Supabase admin client
  radar-data.ts            demo 数据与类型定义

scripts/
  run-job.mjs              领取任务、当天去重、记录执行成功或失败
  pipeline.mjs             RSS 抓取、DeepSeek 选文/转写/复核、Supabase 写入
  weekly-profile.mjs       每周兴趣画像、信源权重微调、信源健康度与增删提案
  lib/deepseek-client.mjs  统一模型请求、超时、用量记录和峰谷费用估算
  lib/article-quality.mjs  原文完整性、转写长度和失败冷却规则

prompts/
  select-*.md              选文 prompt（注入兴趣画像）
  rewrite-*.md             中文转写 prompt
  review-*.md              转写忠实性复核 prompt
  profile-*.md             每周画像 prompt

supabase/
  schema.sql               当前数据表结构
  migrations/              数据库升级记录（包含任务 RPC 和内部调度函数）
  schedules.sql            北京时间日推 07:00、08:00 检查、每周日 21:07 画像
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
npm test
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

线上由 Supabase Cron 在每天北京时间 07:00 触发 `.github/workflows/daily-pipeline.yml`，08:00 检查，08:30 再检查状态；尚未成功时在 12:05 闲时补跑，12:35 复查。一天最多派发三次，已成功发布则停止补跑。周画像在周日 21:07 启动，21:37、22:17 检查并有限补跑，22:47 复查。GitHub workflow 只保留手动/外部触发，避免原生 schedule 的长时间延迟与不活跃停用。

`run-job.mjs` 用数据库原子领取任务，避免重复派发造成重复模型消费；工作日高峰时段不启动新的自动模型调用。设置页的「更新推荐」仍立即执行一次手动更新，不受当天自动去重或错峰限制。任务失败或超时在设置页显示告警，成功后自动解除；未成功生成的结果不会替换上期推荐。这里的告警是应用内状态，不是邮件或手机通知。

调度凭据加密存放在 Supabase Vault 的 `trendlens_github_actions_token`，只由内部调度函数读取。新环境应用迁移后，配置该凭据，再执行 `supabase/schedules.sql`。工作流完成后调用 `/api/revalidate` 并预热页面。

模型调用按 `select / rewrite / review / profile` 写入 `trendlens_llm_usage`：开始/结束时间、任务、文章、尝试次数、缓存命中/未命中输入 tokens、输出 tokens、结果和估算费用。计费版本和峰谷时段一并留存；费用按请求开始时间估算，以 DeepSeek 账单为准。超时等拿不到 usage 的调用保留为未知，不能按零费用统计。数据不随 30 天推荐清理而删除。

原文只有付费预览、订阅推广或抓取失败后的短摘要时，选文前跳过；累计三次转写失败的文章默认冷却 7 天。中文正文长度根据原文估算，保留截断校验，短文章不再统一凑满 800 字。

## Prompt 调优

LLM prompt 独立放在 `prompts/`，方便不改代码直接调：

- `select-system.md` / `select-user.md`：决定哪些文章值得推荐。
- `rewrite-system.md` / `rewrite-user.md`：决定中文转写、术语注释、图片插入和 PM Takeaways 的输出结构。

模型原始返回日志会写到 `data/logs/deepseek-*.json`，该目录不会提交到 Git。GitHub runner 上的原文日志仍是临时文件；长期统计使用 Supabase 中的用量表，不含原文或画像全文。

## 继续开发时优先看哪里

- 想改页面样式：先看 `src/app/globals.css`，再看对应 `src/components/*-screen.tsx`。
- 想改文章详情体验：看 `src/components/article-screen.tsx`。
- 想改推荐策略：优先改 `prompts/select-*.md`。
- 想改转写结构：优先改 `prompts/rewrite-*.md` 和 `scripts/pipeline.mjs` 的校验逻辑。
- 想调跨天去重：改环境变量 `DEDUP_LOOKBACK_DAYS`（默认 3 天，设为 0 关闭），逻辑在 `scripts/pipeline.mjs` 的 `excludeRecentlyRecommended`。
- 想改信息源管理：看 `src/lib/source-store.ts` 和 `src/app/api/sources/route.ts`。
