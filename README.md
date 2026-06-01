# TrendLens

TrendLens is a mobile-first Next.js PWA for reading personalized technology, internet, and LLM trend signals on iPhone.

The current build reads generated radar data from `data/radar.json` and falls back to local demo data when the RSS/Friday pipeline has not run:

- Today dashboard with a single `科技 / 互联网 / 大模型` channel and a direct list of processed article recommendations.
- Article cards with source, 0-100 heat score, recommendation reason, reading time, read state, and favorites.
- Article detail pages with faithful Chinese article transfer, source images, short source quotes, PM takeaways, related reading, and annotation bottom sheets.
- Saved page with local favorite state.
- Settings page with source/model status plus source enable/disable and delete management backed by `sources.yaml`.
- PWA manifest, safe-area layout, SVG app icon, and a production service worker shell.
- Local RSS pipeline with article extraction, Friday generation, and fallback status reporting.

## Run

```bash
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000` on the Mac, or use the Mac's LAN IP from iPhone Safari and add it to the Home Screen.

## Data pipeline

```bash
npm run fetch      # fetch RSS and extracted article text, then write fallback data
npm run generate   # call Friday using the last fetched articles
npm run pipeline   # fetch RSS, call Friday, and write data/radar.json
```

Friday runs in two stages. Prompts are file-based so each stage can be tuned without editing code:

- Selection: `prompts/friday-select-system.md` and `prompts/friday-select-user.md`
- Chinese transfer: `prompts/friday-rewrite-system.md` and `prompts/friday-rewrite-user.md`

The selection prompt receives candidates through `{{articles_json}}` and `{{max_articles}}`. The article-transfer prompt receives selected articles through `{{selected_articles_json}}`; it runs one article at a time, receives extracted `sourceImages`, writes raw model-return logs to `data/logs/friday-rewrite-*.json`, retries incomplete output, and records failed articles in `rewriteFailures` instead of silently falling back to extracted source text.

For a quick smoke run:

```bash
SOURCE_LIMIT=3 MAX_ITEMS_PER_SOURCE=1 FRIDAY_MAX_ARTICLES=3 npm run pipeline
```

## Checks

```bash
npm run lint
npm run build
```

## Config

Defaults live in `.env.example`; create `.env` when overriding local pipeline settings:

```bash
FRIDAY_APP_ID=1637742221455659024
FRIDAY_API_URL=https://aigc.sankuai.com/v1/openai/native/chat/completions
FRIDAY_MODEL=gemini-3.1-flash-lite
FRIDAY_CANDIDATE_ARTICLES=24
FRIDAY_MAX_ARTICLES=8
FRIDAY_REWRITE_ATTEMPTS=2
FRIDAY_REWRITE_CONTENT_CHARS=12000
FRIDAY_REWRITE_MIN_CHINESE_CHARS=800
FRIDAY_MIN_CONTENT_CHARS=600
FRIDAY_SELECT_SYSTEM_PROMPT_PATH=prompts/friday-select-system.md
FRIDAY_SELECT_USER_PROMPT_PATH=prompts/friday-select-user.md
FRIDAY_REWRITE_SYSTEM_PROMPT_PATH=prompts/friday-rewrite-system.md
FRIDAY_REWRITE_USER_PROMPT_PATH=prompts/friday-rewrite-user.md
```

RSS source defaults live in `sources.yaml`.
