# Sovereign — Geopolitical Risk Intelligence Platform

**Live demo: [sovereign-production-0351.up.railway.app](https://sovereign-production-0351.up.railway.app)**

![Sovereign Globe View](docs/globe-screenshot.png)

Sovereign ingests fragmented public data across 50+ countries — sanctions lists, World Bank governance indicators, equity markets, commodity prices, and news sentiment — fuses it through a typed ontology, runs a graph-based geopolitical contagion model, and surfaces ranked risk alerts through an operator UI backed by a streaming LLM analyst.

The platform operationalizes three distinct intelligence workflows: macro sovereign risk scoring (composite weighted factor model), network-based shock propagation (PageRank-style contagion with financial, trade, and regional channels), and portfolio stress testing (position-level P&L attribution against risk deltas). Every data point flows through strongly typed dataclasses before hitting the analytics layer — the same pattern Palantir's Foundry uses for its object graph.

The technical approach prioritizes zero-infrastructure deployment. DuckDB replaces a Postgres cluster: all analytical queries run in-process against a single embedded file, with no connection pooling, no migration tooling, and no operational overhead. The contagion model builds a directed `networkx` graph from 30-day rolling ETF correlations and WBI trade openness scores, then propagates shocks with geometric attenuation (factor 0.6 per hop, max 2 hops). The LLM analyst streams responses via Server-Sent Events using Groq's `llama-3.1-8b-instant`, with a system prompt injected with current risk scores, alert counts, and portfolio exposure at request time.

---

## Deployment

One Railway service, built from the `Dockerfile`: stage one compiles the React bundle,
stage two runs it and the API from a single `uvicorn` process. `/api/*` goes to FastAPI
and everything else falls through to the SPA, so the app is same-origin — no CORS, no
`VITE_API_URL`, one deploy.

A Railway volume is mounted at `/data` and `DATABASE_PATH` points DuckDB at it. On first
boot against an empty volume, `db._runtime_db_path()` seeds it from the committed
`sovereign_seed.duckdb` so the service comes up serving data rather than an empty schema.
From then on `ingest/scheduler.py` runs in-process and the writes persist.

**Why not serverless.** This was previously deployed to Vercel, where the filesystem is
ephemeral: every write went to a per-container `/tmp` copy that was discarded when the
function froze. That made `start_scheduler()` unusable, so it was never called, so the
data never moved. A single worker is used deliberately — DuckDB is single-writer, and a
second worker would contend for the lock on the volume.

**Known limitation.** Because of that single-writer lock, a full 6-hourly refresh can make
reads queue behind it for a stretch. Acceptable at this scale; the fix if it ever matters
is to build into a second file and swap it in.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Ingest Layer (APScheduler: 15m news/GTI, 6h full)          │
│  World Bank API · OFAC SDN CSV · yfinance ETFs · NewsAPI    │
└────────────────────────┬────────────────────────────────────┘
                         │ writes
                         ▼
              ┌──────────────────┐
              │   DuckDB file    │  ← sovereign.duckdb
              │  (8 tables,      │
              │   embedded)      │
              └────────┬─────────┘
                       │ reads
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Analytics Engine                                           │
│  country_risk.py  → composite 0-100 scorer                  │
│  contagion.py     → networkx directed graph propagation     │
│  portfolio_impact.py → position-level P&L attribution       │
│  alerts.py        → rule engine → alerts table              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │  FastAPI + SSE   │  → REST + streaming /analyst
              │  (Pydantic v2)   │
              └────────┬─────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  React 18 + Vite + Tailwind                                  │
│  Globe (react-simple-maps choropleth)                        │
│  Country deep-dive · Portfolio stress tester · LLM chat      │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Tech |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Data warehouse | DuckDB (embedded, zero infra) |
| Scheduler | APScheduler (in-process, 15m / 2h / 6h cycles) |
| Analytics | pandas · numpy · networkx · scikit-learn |
| LLM | Groq `llama-3.1-8b-instant` (OpenAI-compatible API) |
| Frontend | React 18 + Vite + Tailwind + Recharts |
| Map | react-simple-maps |
| Deploy | Railway — one container, persistent volume |

---

## Key technical decisions

**Why DuckDB.** The alternative is standing up a Postgres instance, writing migrations, and managing connection pools — overhead that buys nothing when the workload is analytical queries over a few million rows run by a single-process API. DuckDB runs in-process, columnar, with full SQL and pandas interop. The tradeoff is single-writer concurrency: the API server holds the write lock, so analytics jobs run sequentially in background tasks rather than as separate processes. For this deployment profile that's the right call.

**Why 0.6 dampening per contagion hop.** The figure is calibrated against historical shock episodes: during the 2008 GFC, Korean equity markets lost roughly 55-60% of the US drawdown within 2 weeks, which at one hop implies a transmission factor in the 0.55-0.65 range. The 0.6 constant represents a conservative central estimate. Edge weights are further attenuated by the financial correlation component (capped at 0.5 × |corr|), so a maximum-weight edge at 2 hops transmits at most 0.6 × 0.6 × 0.5 = 18% of the original shock — consistent with observed second-order contagion magnitudes.

**How the risk score weights were chosen.** Political instability carries 25% because governance collapse is the single variable most correlated with outright sovereign default and capital flight — it subsumes the mechanism through which macro deterioration becomes crisis. Macro stress and market stress are weighted equally at 20% each: market signals are faster but noisier; WBI macro fundamentals are slower but more predictive of medium-term outcomes. Sanctions exposure at 15% reflects that primary-target designation is near-deterministic for investment exclusion, while governance deficit and sentiment each carry 10% as confirming rather than leading signals.

**Why streaming SSE for the LLM analyst.** The median useful response from a sovereign risk query runs 200-400 tokens. At small-model inference speeds, that's 3-6 seconds to first token and 8-15 seconds to completion if delivered as a single JSON response. SSE cuts perceived latency to under a second: the client starts rendering tokens immediately. The implementation is a FastAPI `StreamingResponse` wrapping an `async for` loop over the provider's async stream — no WebSocket handshake, no custom protocol, and it degrades gracefully to HTTP/1.1.

---

## Data sources

| Source | What | Refresh |
|---|---|---|
| World Bank WDI/WGI API | GDP, inflation, debt, trade openness, political stability, corruption, rule of law | 6h (data is annual; API is fast) |
| OFAC SDN CSV | Sanctioned entity counts by country | 6h |
| yfinance (ETF proxies) | Daily returns, 21d realized vol, 30d cross-correlations | 6h |
| NewsAPI | Headline sentiment (TextBlob polarity) per country, 7-day window | 6h |

---

## Running locally

```bash
# Backend
cd api
pip install -r requirements.txt
python -m textblob.download_corpora

cp .env.example .env
# Add GROQ_API_KEY and NEWS_API_KEY to .env

python seed.py          # bootstrap with realistic data (optional; real ingest runs on startup)
uvicorn main:app --reload --port 8000

# In a separate terminal
curl http://localhost:8000/health
curl http://localhost:8000/countries | jq '.[0:3]'

# Frontend
cd ../web
npm install
cp .env.example .env    # set VITE_API_URL=http://localhost:8000
npm run dev             # opens at http://localhost:5173
```

---

## What I'd build next

- **UN Comtrade for real trade flows.** The current trade channel in the contagion model uses WBI trade openness (exports+imports / GDP) as a proxy for bilateral sensitivity. Replacing it with actual bilateral trade matrices from UN Comtrade would make edge weights country-pair-specific rather than destination-only — a material improvement for detecting asymmetric trade dependencies.
- **Options-implied volatility as a forward signal.** Realized 21d vol is a lagging indicator. VIX term structure and country-specific options skew (where available via CBOE or broker APIs) would provide a forward-looking market stress component that leads realized vol by days to weeks.
- **WebSocket live updates.** The current frontend polls on a 60-second interval. A WebSocket channel from the API would let alert notifications and score updates push to connected clients immediately after each analytics refresh cycle.
- **User-defined portfolios.** The demo portfolio is hardcoded. A simple portfolio upload (CSV: ticker, weight) stored per session would make the stress tester and portfolio impact view useful for actual analysts rather than demonstration only.
