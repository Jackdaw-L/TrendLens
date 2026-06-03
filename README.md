# TrendLens

TrendLens is a mobile-first Next.js PWA for reading personalized technology, internet, and LLM trend signals on iPhone.

The current build reads generated radar data from Supabase, falls back to `data/radar.json`, and then falls back to local demo data when the RSS/DeepSeek pipeline has not run:

- Today dashboard with a single `科技 / 互联网 / 大模型` channel and a direct list of processed article recommendations.
- Article cards with source, 0-100 heat score, recommendation reason, reading time, read state, and favorites.
- Article detail pages with faithful Chinese article transfer, source images, short source quotes, PM takeaways, related reading, and annotation bottom sheets.
- Saved page with local favorite state.
- Settings page with source/model status, source enable/disable and delete management backed by Supabase, plus a password-protected “更新推荐” action that dispatches GitHub Actions.
- PWA manifest, safe-area layout, Stitch-sourced app icon, and a production service worker shell.
- RSS pipeline with article extraction, DeepSeek generation, Supabase persistence, and local fallback status reporting.

## Run

```bash
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000` on the Mac, or use the Mac's LAN IP from iPhone Safari and add it to the Home Screen.

## Data pipeline

```bash
npm run fetch      # fetch RSS and extracted article text, then persist fallback data
npm run generate   # call DeepSeek using the last fetched articles
npm run pipeline   # fetch RSS, call DeepSeek, and persist the radar dataset
```

DeepSeek runs in two stages. Prompts are file-based so each stage can be tuned without editing code:

- Selection: `prompts/friday-select-system.md` and `prompts/friday-select-user.md`
- Chinese transfer: `prompts/friday-rewrite-system.md` and `prompts/friday-rewrite-user.md`

The selection prompt receives candidates through `{{articles_json}}` and `{{max_articles}}`. The article-transfer prompt receives selected articles through `{{selected_articles_json}}`; it runs one article at a time, receives extracted `sourceImages`, writes raw model-return logs to `data/logs/deepseek-rewrite-*.json`, retries incomplete output, and records failed articles in `rewriteFailures` instead of silently falling back to extracted source text.

For a quick smoke run:

```bash
SOURCE_LIMIT=3 MAX_ITEMS_PER_SOURCE=1 LLM_MAX_ARTICLES=3 npm run pipeline
```

## Checks

```bash
npm run lint
npm run build
```

## Netlify

TrendLens can be deployed as a Netlify Next.js site. The project includes:

- `netlify.toml` for the build command, `.next` publish directory, manifest header, and Node version.
- `.nvmrc` and `.node-version` pinned to Node `24.14.0`.
- `package.json` `engines.node` set to `24.x`.

Configure these Netlify environment variables before deploying:

```bash
SUPABASE_URL=https://vbwzcvycobnpohetvjjd.supabase.co
SUPABASE_SECRET_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_API_KEY=
DEEPSEEK_THINKING=disabled
DEEPSEEK_MAX_TOKENS=12000
```

The deployed Netlify app reads the latest run from Supabase. The long RSS/DeepSeek pipeline is intended to run in GitHub Actions and write new runs into Supabase.

## GitHub Actions automation

`.github/workflows/daily-pipeline.yml` runs the full pipeline every day at 08:00 Asia/Shanghai and also supports manual `workflow_dispatch`.

Configure these GitHub repository secrets before enabling the workflow:

```bash
DEEPSEEK_API_KEY=
SUPABASE_URL=https://vbwzcvycobnpohetvjjd.supabase.co
SUPABASE_SECRET_KEY=
TRENDLENS_REVALIDATE_URL=https://trendlensapp.netlify.app/api/revalidate
TRENDLENS_REVALIDATE_TOKEN=
```

Configure these Netlify environment variables so the Settings page can trigger the workflow:

```bash
GITHUB_ACTIONS_TOKEN=
GITHUB_ACTIONS_REPO=Jackdaw-L/TrendLens
GITHUB_ACTIONS_WORKFLOW=daily-pipeline.yml
GITHUB_ACTIONS_REF=main
TRENDLENS_TRIGGER_SECRET=coffee
TRENDLENS_REVALIDATE_TOKEN=
```

`GITHUB_ACTIONS_TOKEN` should be a GitHub token that can dispatch workflows for this repository. `TRENDLENS_REVALIDATE_TOKEN` must match between GitHub secrets and Netlify env vars so Actions can clear the Netlify/Next cache after a successful run.

## Config

Defaults live in `.env.example`; create `.env` when overriding local pipeline settings:

```bash
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_API_KEY=
DEEPSEEK_THINKING=disabled
DEEPSEEK_ATTEMPTS=2
DEEPSEEK_TIMEOUT_MS=180000
SUPABASE_URL=https://vbwzcvycobnpohetvjjd.supabase.co
SUPABASE_SECRET_KEY=
LLM_CANDIDATE_ARTICLES=24
LLM_MAX_ARTICLES=8
LLM_SELECT_CONTENT_CHARS=900
FRIDAY_REWRITE_ATTEMPTS=2
FRIDAY_REWRITE_CONTENT_CHARS=12000
FRIDAY_REWRITE_MIN_CHINESE_CHARS=800
FRIDAY_MIN_CONTENT_CHARS=600
LLM_SELECT_SYSTEM_PROMPT_PATH=prompts/friday-select-system.md
LLM_SELECT_USER_PROMPT_PATH=prompts/friday-select-user.md
LLM_REWRITE_SYSTEM_PROMPT_PATH=prompts/friday-rewrite-system.md
LLM_REWRITE_USER_PROMPT_PATH=prompts/friday-rewrite-user.md
GITHUB_ACTIONS_REPO=Jackdaw-L/TrendLens
GITHUB_ACTIONS_WORKFLOW=daily-pipeline.yml
GITHUB_ACTIONS_REF=main
TRENDLENS_TRIGGER_SECRET=coffee
TRENDLENS_REVALIDATE_URL=https://trendlensapp.netlify.app/api/revalidate
TRENDLENS_REVALIDATE_TOKEN=
```

RSS source defaults live in Supabase table `trendlens_sources`; `sources.yaml` seeds/falls back locally.
