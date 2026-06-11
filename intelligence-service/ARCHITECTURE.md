# KAU Super Agent Architecture

## Mission

Create a real-time intelligence agent for KAU Kazakh-American University that tracks:
- global trends relevant to Kazakhstan's education market;
- all discoverable mentions of KAU across news/search/social platforms;
- competitor activity and performance across social media through LiveDune;
- strategic opportunities for admissions, PR, partnerships, and positioning.

## Core Modules

### 1. Trend Radar

Inputs:
- GDELT global news search
- Google News RSS
- Kazakhstan media RSS feeds
- optional NewsAPI, SerpAPI, Meltwater, Factiva

Tasks:
- detect rising topics;
- cluster repeated stories;
- score relevance for Kazakhstan and higher education;
- separate strategic trends from noise.

### 2. KAU Mention Monitor

Queries:
- KAU Kazakh-American University
- Kazakh-American University
- Kazakh American University
- Казахско-Американский университет
- KAU + Kazakhstan + University

Tasks:
- track direct and indirect mentions;
- classify sentiment and risk;
- detect misinformation or reputation issues;
- recommend amplify/respond/ignore actions.

### 3. Competitor Intelligence

Tracked competitors:
- KIMEP University
- Narxoz University
- SDU University
- other Kazakhstan and Central Asia universities added by config

Signals:
- social follower growth;
- engagement rate;
- post cadence;
- top-performing formats;
- admissions campaign timing;
- PR/news spikes;
- content themes.

### 4. LiveDune Adapter

Responsibilities:
- authenticate with LiveDune;
- fetch statistics for connected own and competitor social accounts;
- normalize metrics into one internal schema;
- store daily snapshots for trend comparison.

### 5. Scoring Engine

Default scoring dimensions:
- Kazakhstan relevance;
- KAU brand relevance;
- education-market relevance;
- competitor relevance;
- AI/future-of-work relevance;
- admissions/recruitment relevance;
- labor-market relevance.

### 6. Reporting And Alerts

Outputs:
- daily executive briefing;
- urgent alerts for reputation risks;
- weekly competitor digest;
- monthly strategic market report.

Channels:
- Markdown report in MVP;
- Telegram/Slack/email in production;
- dashboard in BI or custom web UI.

## Production Roadmap

### Phase 1: MVP

- RSS and GDELT collection
- KAU mention queries
- SQLite storage
- Markdown report
- LiveDune adapter placeholder

### Phase 2: Real-Time Monitoring

- scheduled runs every 15-60 minutes
- deduplication by canonical URL and title similarity
- Telegram alerts
- sentiment and topic classification with LLM
- Kazakhstan media source list

### Phase 3: Competitive Social Intelligence

- LiveDune endpoint finalization
- competitor account map
- campaign detection
- engagement anomaly detection
- admissions-season benchmarking

### Phase 4: Decision Dashboard

- PostgreSQL
- FastAPI API layer
- dashboard with filters by topic, language, competitor, risk level
- export to PDF/PowerPoint for leadership

## Data Model

### News Item

- source
- title
- url
- published_at
- summary
- language
- tags
- relevance_score
- raw payload

### Social Metric

- competitor
- platform
- handle
- metric
- value
- captured_at
- raw payload

## Alert Rules

High priority:
- KAU mentioned with negative context;
- competitor campaign engagement spike above 50%;
- Kazakhstan education policy change;
- scholarship/admissions trend related to KAU target audience;
- US/Kazakhstan education partnership news.

Medium priority:
- competitor PR activity;
- AI education trend;
- labor market trend that affects program positioning;
- new ranking/accreditation/partnership news.

Low priority:
- repeated syndicated news;
- broad education articles with weak Kazakhstan relevance.

