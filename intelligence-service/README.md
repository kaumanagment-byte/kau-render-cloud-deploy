# KAU Market Intelligence Agent

MVP "super agent" for KAU Kazakh-American University market intelligence.

It monitors:
- global and Kazakhstan-relevant news trends;
- mentions of KAU, Kazakh-American University, KAU University, and related names;
- competitor social media metrics through a LiveDune adapter;
- priority sectors for the Kazakhstan education market.

The project is intentionally dependency-light. It runs with Python standard library and can later be connected to paid APIs.

## What The Agent Does

1. Collects market news from RSS/GDELT-compatible sources.
2. Searches for KAU brand mentions using configured queries.
3. Scores each item by relevance to the Kazakhstan market.
4. Stores findings in SQLite.
5. Produces a Markdown briefing with trends, mentions, risks, and suggested actions.
6. Provides a LiveDune integration point for competitor social analytics.

## Quick Start

```powershell
cd outputs\kau-market-intelligence-agent
python -m src.kau_agent.main collect --config config.example.json
python -m src.kau_agent.main report --config config.example.json
```

The report will be generated in `reports/latest-briefing.md`.

## Dashboard

Run a local dashboard:

```powershell
python dashboard_server.py
```

Then open:

```text
http://127.0.0.1:8899
```

The dashboard reads `data.sqlite`, shows topic signals, KAU mentions, sources, and LiveDune status.

On Windows, use the launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\start_dashboard.ps1
```

If the server closes after the Codex command finishes, use the detached CMD launcher:

```powershell
.\start_dashboard.cmd
```

Most reliable local option:

```powershell
.\OPEN_DASHBOARD.cmd
```

Keep that terminal window open while using the dashboard.

To stop it:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop_dashboard.ps1
```

## LiveDune Setup

Create an environment variable with your LiveDune API token:

```powershell
$env:LIVEDUNE_API_TOKEN="your-token"
```

Then add competitor accounts to `config.example.json`.

The adapter is isolated in `src/kau_agent/sources/livedune.py`. Keep secrets in `.env`; the file is ignored by git.

Configurable LiveDune variables:

```text
LIVEDUNE_API_TOKEN=
LIVEDUNE_BASE_URL=https://api.livedune.com
LIVEDUNE_STATS_ENDPOINT=/v1/account/statistics
LIVEDUNE_AUTH_SCHEME=Bearer
```

If LiveDune account identifiers are required, add `account_id` to each social account in `config.example.json`.

## Recommended Production Stack

- Scheduler: cron, GitHub Actions, Windows Task Scheduler, or n8n
- Storage: PostgreSQL for production, SQLite for MVP
- Search/news APIs: GDELT, Google Programmable Search, SerpAPI, NewsAPI, Factiva, Meltwater
- Social analytics: LiveDune
- Alerts: Telegram bot, Slack, email
- Dashboard: Metabase, Looker Studio, or a small FastAPI/React UI

## Agent Topics

The default config tracks:
- higher education in Kazakhstan;
- international universities in Central Asia;
- student recruitment and admissions;
- scholarships and grants;
- AI in education;
- employer demand and labor market shifts;
- competitor universities and business schools;
- KAU brand mentions.

## Outputs

- `data.sqlite`: local database created after first run
- `reports/latest-briefing.md`: latest executive briefing
