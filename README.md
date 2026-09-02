# Sovereign — Geopolitical Risk Intelligence Platform

**Live: [sovereign-production-0351.up.railway.app](https://sovereign-production-0351.up.railway.app)**

Sovereign ingests fragmented public data across 50+ countries — OFAC sanctions designations, World Bank governance and macro indicators, country ETF prices, and news sentiment — fuses it through a typed ontology, runs a graph-based contagion model, and surfaces ranked risk alerts through an operator UI backed by a streaming LLM analyst.

The platform runs three distinct intelligence workflows: macro sovereign risk scoring (a composite weighted factor model), network-based shock propagation (PageRank-style contagion across financial, trade, and regional channels), and portfolio stress testing (position-level P&L attribution against risk deltas). Every data point passes through strongly typed dataclasses before reaching the analytics layer.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Ingest (APScheduler, in-process)                           │
│  15m: RSS + sentiment + GTI                                 │
│   2h: weather                                               │
│   6h: World Bank · OFAC SDN · yfinance ETFs · full rescore  │
└────────────────────────┬────────────────────────────────────┘
                         │ writes
                         ▼
              ┌──────────────────┐
              │   DuckDB file    │  ← /data/sovereign.duckdb
              │  (12 tables, on  │     on a Railway volume
              │   a real disk)   │
              └────────┬─────────┘
                       │ reads
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Analytics                                                  │
│  country_risk.py     → composite 0-100 scorer               │
│  contagion.py        → networkx directed graph propagation  │
│  portfolio_impact.py → position-level P&L attribution       │
│  gti.py              → geopolitical tension index           │
│  alerts.py           → rule engine → alerts table           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │  FastAPI + SSE   │  → REST + streaming /api/analyst
              └────────┬─────────┘
                       │  same process, same origin
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  React 18 + Vite + Tailwind (served from web/dist)          │
│  WebGL globe · country deep-dive · stress tester · analyst  │
└─────────────────────────────────────────────────────────────┘
```

| Layer | Tech |
|---|---|
| Backend | Python 3.13 + FastAPI |
| Data warehouse | DuckDB (embedded, on a persistent volume) |
| Scheduler | APScheduler, in-process |
| Analytics | pandas · numpy · networkx |
| LLM | Groq `llama-3.1-8b-instant` (OpenAI-compatible API) |
| Frontend | React 18 + Vite + Tailwind + Recharts |
| Globe | react-globe.gl / three, with a GPU-free fallback |
| Deploy | Railway — one container, one volume |

---

## Deployment

One Railway service, built from the root `Dockerfile`. Stage one compiles the React
bundle; stage two runs it and the API from a single `uvicorn` process. `/api/*` is handled
by FastAPI and everything else falls through to the SPA, so the app is same-origin: no
CORS, no `VITE_API_URL`, one deploy.

A Railway volume is mounted at `/data` and `DATABASE_PATH` points DuckDB at it. On first
boot against an empty volume, `db._runtime_db_path()` seeds it from the committed
`api/sovereign_seed.duckdb` so the service comes up serving data rather than an empty
schema. After that the scheduler owns the data and its writes persist.

```bash
railway up --service sovereign --ci
```

**Required environment variable:** `GROQ_API_KEY` (the LLM analyst). Optional:
`INGEST_TOKEN` to enable `POST /api/ingest/run`, `ENABLE_AUTH=1` to mount `/api/auth/*`.
`PORT` is pinned to 8000 so the container and the generated domain agree.

### Why not serverless

This ran on Vercel first, and the filesystem there is ephemeral: every write went to a
per-container `/tmp` copy discarded when the function froze. That made `start_scheduler()`
unusable, so it was never called, so the data never moved — the deployment served the same
bootstrap snapshot for four months while the UI advertised a green "LIVE" badge. A real
disk is not an optimisation for this workload; it is the precondition.

A single worker is used deliberately: DuckDB is single-writer, and a second worker would
contend for the lock on the volume.

---

## Key technical decisions

**Why DuckDB.** The alternative is a Postgres instance, migrations, and connection pools —
overhead that buys nothing when the workload is analytical queries over a few million rows
from a single process. DuckDB runs in-process, columnar, with full SQL and pandas interop.
The tradeoff is single-writer concurrency: the 6-hourly full refresh holds the write lock,
so reads can queue behind it briefly. At this scale that is the right trade; the fix, if it
ever matters, is to build into a second file and swap it in.

**Why 0.6 dampening per contagion hop.** Calibrated against historical shock episodes:
during the 2008 GFC, Korean equity markets lost roughly 55-60% of the US drawdown within
two weeks, which at one hop implies a transmission factor in the 0.55-0.65 range. Edge
weights are further attenuated by the financial correlation component (capped at
0.5 × |corr|), so a maximum-weight edge at two hops transmits at most
0.6 × 0.6 × 0.5 = 18% of the original shock.

**How the risk weights were chosen.** Political instability carries 25% because governance
collapse is the single variable most correlated with outright sovereign default and capital
flight. Macro and market stress are weighted equally at 20%: market signals are faster but
noisier; World Bank fundamentals are slower but more predictive over the medium term.
Sanctions exposure at 15% reflects that primary-target designation is near-deterministic
for investment exclusion, while governance deficit and sentiment each carry 10% as
confirming rather than leading signals.

**Why streaming SSE for the analyst.** The median useful response runs 200-400 tokens —
8-15 seconds delivered as one JSON blob. SSE cuts perceived latency to under a second: a
FastAPI `StreamingResponse` wrapping an `async for` over the provider's stream. No
WebSocket handshake, no custom protocol, and it degrades gracefully to HTTP/1.1.

**Absent data is reported as absent.** A 7-day delta needs a snapshot from last week. When
there isn't one the API returns `null` and the UI says "no 7d baseline yet", rather than
defaulting the baseline to today's score and reporting a confident `+0.0`. The 90-day chart
does not render until there are enough points to show a real trend instead of a line drawn
between two distant observations.

---

## Data sources

| Source | What | Refresh |
|---|---|---|
| World Bank WDI/WGI | GDP, inflation, debt, trade openness, political stability, corruption, rule of law | 6h |
| OFAC SDN (sanctions list service) | Sanctioned entity counts by country, parsed from the Programme field | 6h |
| yfinance (ETF proxies) | Daily returns, 21d realized vol, 30d cross-correlations | 6h |
| RSS + VADER | Headline sentiment and event classification per country | 15m |
| Open-Meteo | Severe weather overlay | 2h |

Conflict zones are a curated set, not a live feed — `/api/conflicts/source` reports
`"curated"` so this is never mistaken for live ACLED data.

---

## Running locally

```bash
# Backend — writes to api/sovereign_seed.duckdb
cd api
pip install -r requirements.txt
cp .env.example .env          # add GROQ_API_KEY
python refresh_data.py        # pull live data into the seed (optional)
uvicorn main:app --reload --port 8000

# Frontend, in a second terminal — proxies /api to localhost:8000
cd web
npm install
npm run dev                   # http://localhost:5173
```

`api/refresh_data.py` rebuilds the committed seed, which is what bootstraps a *fresh*
volume. It does not affect live data — the scheduler owns that.

---

## What I'd build next

- **UN Comtrade for real trade flows.** The trade channel in the contagion model currently
  uses World Bank trade openness (exports+imports / GDP) as a proxy for bilateral
  sensitivity. Actual bilateral trade matrices would make edge weights country-pair
  specific rather than destination-only.
- **Options-implied volatility as a forward signal.** Realized 21d vol lags. VIX term
  structure and country-specific options skew would lead it by days to weeks.
- **WebSocket live updates.** The frontend polls on a 60-second interval; a push channel
  would deliver alerts the moment the analytics cycle writes them.
- **User-defined portfolios.** The demo portfolio is hardcoded. A CSV upload stored per
  session would make the stress tester useful to an actual analyst.
