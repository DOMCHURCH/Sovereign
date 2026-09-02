# CLAUDE.md

## Project: Sovereign — Geopolitical Risk Intelligence Platform

**What it is:** A live, deployable intelligence platform that ingests fragmented public
data across 50+ countries — trade flows, sanctions lists, political stability indices,
equity markets, commodity prices, and news sentiment — fuses it into a typed ontology,
runs a proprietary geopolitical contagion model, and surfaces ranked risk alerts through
an operator UI with a natural-language analyst.

**Why it stops recruiters:**
- **Palantir** sees: Foundry data integration → typed ontology → operator decision UI →
  AIP-style LLM analyst. Their entire product pitch, built from scratch.
- **BlackRock** sees: country-risk factor model feeding portfolio stress tests — the exact
  workflow their Systematic Active Equity and Risk & Quantitative Analysis teams run on
  Aladdin every day.
- **Universities** see: a shipped, deployed system handling real-world data at a scope
  most undergrads never reach.

**The live demo must work.** Every recruiter will click the link:
https://sovereign-production-0351.up.railway.app

**Deployment facts that are easy to get wrong:**
- Hosting is Railway, one service, built from the root `Dockerfile`. Not Render, not
  Vercel — both are retired. `api/render.yaml` and `vercel.json` are kept for reference.
- The volume at `/data` is what makes the scheduler work. Do not deploy this to a
  serverless target again: DuckDB writes are discarded there and the data silently
  freezes, which is exactly how this project spent four months.
- `api/refresh_data.py` rebuilds the committed seed, which only seeds *fresh* volumes.
  Changing it does not change live data — the scheduler owns that.
- `PORT` is pinned to 8000 so the container and the generated domain agree.
- `/api/auth/*` is unmounted unless `ENABLE_AUTH=1`; this build has no sign-in UI.
- `POST /api/ingest/run` requires an `X-Ingest-Token` header matching `INGEST_TOKEN`.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Data warehouse | DuckDB (embedded, zero infra) |
| Scheduler | APScheduler in-process — 15m news/GTI, 2h weather, 6h full refresh |
| Analytics | pandas, numpy, statsmodels, scipy, scikit-learn, networkx |
| LLM | Groq `llama-3.1-8b-instant` via streaming SSE (OpenAI-compatible client) |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Map | react-simple-maps (choropleth world map) |
| Deploy | Railway — one Docker service, volume at /data, frontend served by FastAPI |
