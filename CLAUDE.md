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
https://sovereign-rust-two.vercel.app

**Deployment facts that are easy to get wrong:**
- There is no Render service. `api/render.yaml` is retained for self-hosting only.
- Vercel serverless has an ephemeral filesystem, so DuckDB writes never persist. The
  snapshot is refreshed by `.github/workflows/refresh-data.yml`, which commits a rebuilt
  `api/sovereign_seed.duckdb`.
- `/api/auth/*` is unmounted unless `ENABLE_AUTH=1`; this build has no sign-in UI.
- `POST /api/ingest/run` requires an `X-Ingest-Token` header matching `INGEST_TOKEN`.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Data warehouse | DuckDB (embedded, zero infra) |
| Refresh | GitHub Actions job rebuilds and commits the DuckDB seed on a schedule |
| Analytics | pandas, numpy, statsmodels, scipy, scikit-learn, networkx |
| LLM | Groq `llama-3.1-8b-instant` via streaming SSE (OpenAI-compatible client) |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Map | react-simple-maps (choropleth world map) |
| Deploy | Vercel only — static frontend + FastAPI as one serverless function |
