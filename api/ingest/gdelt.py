"""GDELT DOC 2.0 — global news tone and volume per country.

Why this exists alongside rss.py
--------------------------------
The RSS pipeline reads a fixed list of English-language feeds and geocodes each
headline to a country. That works, but coverage is uneven: a handful of countries
dominate the feeds and the rest fall back to a *fabricated* neutral 0.0 in
country_risk's sentiment component. GDELT monitors world news in 65+ languages and
exposes a keyless API, so it gives every tracked country a real reading instead of an
assumed one.

Stores GDELT's own average tone (roughly -10..+10 in practice), rescaled to the -1..1
range the rest of the pipeline uses so it is directly comparable to the VADER path.

GDELT enforces **one request every 5 seconds** and answers faster callers with a bare
HTTP 429. It is also intermittently flaky even inside that budget — roughly a third of
requests return no usable series on any given pass. Both facts shape the design:

  - One request per country, spaced 6s, tone only. Runs on the 6-hourly cycle, never
    the 15-minute one.
  - **Gap-fill only.** Countries with a recent RSS reading are skipped entirely. The
    RSS path geocodes specific headlines and is the more precise signal where it
    exists; GDELT's job is to replace the fabricated neutral 0.0 everywhere else.
    This also cuts the request count to the countries that actually need it.
  - One retry per country, because a single miss is usually transient.

Source: https://api.gdeltproject.org/api/v2/doc/doc — no key required.
Terms: https://www.gdeltproject.org/about.html (attribution requested; see DATA_SOURCES.md)

Idea borrowed from bilawalsidhu/gods-eye-view (MIT), which uses the same endpoint as a
fail-soft fallback for locality-matched headlines.
"""
import sys
import os
import time
from datetime import timedelta

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
TIMESPAN = "7d"

# GDELT tone is roughly -10..+10 in practice; anything beyond that is noise. Divide by
# this to land on the -1..1 scale the VADER path already produces.
TONE_SCALE = 10.0

# GDELT's documented limit is one request per 5 seconds; exceeding it returns a plain
# 429 with that text. 6s leaves headroom for clock drift and keeps us clearly inside it.
REQUEST_PAUSE_S = 6.0
REQUEST_TIMEOUT_S = 30
# Give up on the whole pass after this many consecutive failures — if GDELT is down or
# has started refusing us, another 60 requests will not help.
MAX_CONSECUTIVE_FAILURES = 6


def _query(mode: str, query: str) -> dict | None:
    try:
        resp = requests.get(
            GDELT_URL,
            params={"query": query, "mode": mode, "timespan": TIMESPAN, "format": "json"},
            headers={"User-Agent": "Sovereign/1.0 (geopolitical risk research)"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if resp.status_code == 429:
            # Back off hard rather than hammering a free service we are a guest on.
            time.sleep(REQUEST_PAUSE_S * 2)
            return None
        if not resp.ok:
            return None
        # GDELT answers a bad query with HTML or a bare error string, not JSON.
        if "application/json" not in resp.headers.get("Content-Type", ""):
            return None
        return resp.json()
    except Exception:
        return None


def _mean_series(payload: dict | None) -> float | None:
    """Average the first timeline series GDELT returns, ignoring empty windows."""
    if not payload:
        return None
    timeline = payload.get("timeline") or []
    if not timeline:
        return None
    points = timeline[0].get("data") or []
    values = [p.get("value") for p in points if isinstance(p.get("value"), (int, float))]
    if not values:
        return None
    return sum(values) / len(values)


def run() -> int:
    from db import get_conn, log_ingest, utcnow
    from ontology import COUNTRY_METADATA

    conn = get_conn()
    now = utcnow()
    written = 0
    failed = 0
    consecutive = 0

    # Countries that already have a reading from the last day come from RSS, which
    # geocodes actual headlines. Leave those alone and spend the request budget on the
    # ones that would otherwise be scored against an assumed-neutral sentiment.
    covered = {
        r[0] for r in conn.execute(
            "SELECT DISTINCT country_iso3 FROM news_sentiment WHERE fetched_at >= ?",
            [now - timedelta(hours=24)],
        ).fetchall()
    }

    # Only countries the platform actually scores; the World Bank feed also returns
    # aggregates like "WLD" and "EUU" that are meaningless to query for news.
    targets = [
        (iso3, meta[0] if isinstance(meta, (list, tuple)) else str(meta))
        for iso3, meta in COUNTRY_METADATA.items()
        if iso3 not in covered
    ]
    print(f"[gdelt] {len(covered)} countries already covered; querying {len(targets)}", flush=True)

    for iso3, name in targets:
        if not name:
            continue

        # Quoted name keeps "South Sudan" from matching every article about Sudan.
        tone = _mean_series(_query("TimelineTone", f'"{name}"'))
        time.sleep(REQUEST_PAUSE_S)
        if tone is None:
            # GDELT drops requests intermittently even within its rate limit; one retry
            # recovers most of them.
            tone = _mean_series(_query("TimelineTone", f'"{name}"'))
            time.sleep(REQUEST_PAUSE_S)

        if tone is None:
            failed += 1
            consecutive += 1
            if consecutive >= MAX_CONSECUTIVE_FAILURES:
                log_ingest("gdelt", "error", written,
                           f"aborted after {consecutive} consecutive failures")
                return written
            continue
        consecutive = 0

        # Clamp before scaling so an outlier window cannot swamp the composite score.
        score = max(-1.0, min(1.0, tone / TONE_SCALE))

        conn.execute(
            """
            INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (country_iso3, fetched_at) DO UPDATE SET
                sentiment_score = excluded.sentiment_score,
                article_count   = excluded.article_count
            """,
            [iso3, score, 0, now],
        )
        written += 1

    status = "ok" if written else "error"
    log_ingest("gdelt", status, written,
               None if written else f"no countries resolved ({failed} failures)")
    return written


if __name__ == "__main__":
    n = run()
    print(f"GDELT: tone written for {n} countries")
