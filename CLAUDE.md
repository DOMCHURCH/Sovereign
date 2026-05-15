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

**The live demo must work.** Every recruiter will click the link.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Data warehouse | DuckDB (embedded, zero infra) |
| Scheduler | APScheduler (background ingest jobs) |
| Analytics | pandas, numpy, statsmodels, scipy, scikit-learn, networkx |
| LLM | Anthropic `claude-3-5-haiku-20241022` via streaming SSE |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Map | react-simple-maps (choropleth world map) |
| Deploy | Render (backend free tier) + Vercel (frontend free tier) |
