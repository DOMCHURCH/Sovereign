# Data sources, licensing, and attribution

Every figure Sovereign displays comes from a public source. This file records which one,
under what terms, and how it must be credited — because a risk platform that cannot say
where its numbers came from is not a risk platform.

None of these require a paid subscription. The only key the deployment needs is
`GROQ_API_KEY`, and that is for the LLM analyst, not for data.

---

## Live sources

| Source | Used for | Refresh | Licence / terms | Attribution |
|---|---|---|---|---|
| **World Bank** WDI + WGI API | GDP, GDP growth, inflation, government debt, trade openness, political stability, control of corruption, rule of law | 6h | [CC BY 4.0](https://datacatalog.worldbank.org/public-licenses) | "World Bank World Development Indicators / Worldwide Governance Indicators" |
| **OFAC Sanctions List Service** (SDN.CSV) | Sanctioned entity counts per country, parsed from the Programme field | 6h | US Government work, public domain | "U.S. Department of the Treasury, Office of Foreign Assets Control" |
| **Yahoo Finance** via `yfinance` | Country ETF daily returns, 21d realised volatility, 30d cross-correlations | 6h | Personal/research use per Yahoo's terms; **not** licensed for redistribution or commercial resale | "Market data via Yahoo Finance" |
| **GDELT Project** DOC 2.0 | Global news tone per country, gap-filling where RSS has no coverage | 6h | [GDELT terms](https://www.gdeltproject.org/about.html) — open, attribution requested | "The GDELT Project" |
| **Public RSS feeds** (Reuters, AP, Al Jazeera, BBC and others — see `api/ingest/rss.py`) | Headline sentiment (VADER) and event classification per country | 15m | Per publisher; headlines and links only, no article text stored or redisplayed | Each publisher is named on the item |
| **Open-Meteo** | Current conditions and severe-weather overlay | 2h | [CC BY 4.0](https://open-meteo.com/en/license) | "Weather data by Open-Meteo.com" |
| **Natural Earth** (`web/public/ne_countries.json`) | Country boundary geometry for the globe | Bundled | Public domain | "Made with Natural Earth" |

### Notes

**Yahoo Finance is the weakest link.** `yfinance` scrapes an undocumented endpoint rather
than consuming a licensed feed. It is fine for a research and demonstration project, and it
is what keeps the platform key-free — but any commercial deployment needs a licensed market
data vendor. This is a deliberate, documented trade, not an oversight.

**GDELT rate-limits to one request per 5 seconds** and drops roughly a third of requests
even inside that budget. `api/ingest/gdelt.py` therefore runs only on the 6-hourly cycle,
spaces requests, retries once, and queries only the countries RSS did not already cover.

**OFAC moved.** The historic `ofac.treasury.gov/downloads/sdn.csv` path now 404s; the
current export is the sanctions list service. Both are tried in order.

---

## Not live

**Conflict zones are a curated set**, hand-maintained in `api/main.py`, not a live feed.
`GET /api/conflicts/source` returns `"curated"` precisely so this can never be mistaken for
live ACLED or GDELT event data. ACLED requires a registered key and its licence does not
permit redistribution of event-level data, which is why it is not wired in.

**The demo portfolio is hardcoded** — 24 positions, $1M notional, defined in
`api/analytics/portfolio_impact.py`. It exists to demonstrate the stress-testing workflow,
not to represent a real book.

---

## Derived figures

These are Sovereign's own calculations, not source data, and should be read as such:

- **Sovereign Risk Score (0-100)** — a weighted composite. Weights and their justification
  are in the README.
- **Geopolitical Tension Index** — blends risk score, conflict activity, sentiment pressure
  and alert pressure.
- **Contagion edges** — a directed graph built from 30-day ETF return correlations and
  World Bank trade openness, with geometric attenuation of 0.6 per hop, max 2 hops.
- **Portfolio impact** — position-level attribution of risk deltas against the demo book.

The contagion model's trade channel uses trade openness (exports+imports / GDP) as a proxy
for bilateral sensitivity, because it is destination-only. Real bilateral trade matrices
from UN Comtrade would make this materially better; see the README's "What I'd build next".

---

## Acknowledgements

The GDELT integration and the practice of keeping this file were taken from
[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT), an
open-source live-OSINT globe. Its `DATA_SOURCES.md` is a good model for documenting a
project built entirely on public feeds.
