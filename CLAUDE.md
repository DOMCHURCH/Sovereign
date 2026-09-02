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
| Backend | Python 3.13 + FastAPI |
| Data warehouse | DuckDB on the Railway volume at /data |
| Scheduler | APScheduler in-process — 15m news/GTI, 2h weather, 6h full refresh |
| Analytics | pandas, numpy, statsmodels, scipy, scikit-learn, networkx |
| LLM | Groq, model **discovered** from /models at runtime — never pin an ID, two providers have retired ours |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Globe | react-globe.gl / three, NASA Blue Marble textures in web/public/textures |
| Deploy | Railway — one Docker service, volume at /data, frontend served by FastAPI |
