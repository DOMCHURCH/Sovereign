"""GDELT 2.0 Events — global news tone per country, from the bulk export.

Why this exists alongside rss.py
--------------------------------
The RSS pipeline reads a fixed list of English-language feeds and geocodes each headline
to a country. Coverage is uneven: a handful of countries dominate the feeds and the rest
fall back to a *fabricated* neutral 0.0 in country_risk's sentiment component — an
assumption presented as a measurement, inside a term carrying 10% of the composite score.
GDELT monitors world news in 65+ languages, so it can give those countries a real reading.

Why the bulk export rather than the DOC API
-------------------------------------------
The obvious approach is `api/v2/doc/doc?mode=TimelineTone` once per country. That was
tried and measured, and it does not work at this scale: GDELT enforces one request per
5 seconds, and even inside that budget it drops most requests at the TCP layer. A live
run from the deployment host resolved **5 of 58 countries** before tripping the abort
guard, and took minutes to do it.

GDELT also publishes every event as a bulk CSV refreshed every 15 minutes. One ~88 KB
download yields ~64 countries with an average tone attached. So this fetches a handful of
recent files instead — a couple of seconds, no rate limit, and far better coverage.

Source: http://data.gdeltproject.org/gdeltv2/ — no key required.
Terms: https://www.gdeltproject.org/about.html (attribution requested; see DATA_SOURCES.md)

Idea borrowed from bilawalsidhu/gods-eye-view (MIT), which uses GDELT as a fail-soft
fallback for locality-matched headlines.
"""
import io
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GDELT_BASE = "http://data.gdeltproject.org/gdeltv2"

# Files land every 15 minutes. Eight of them is two hours of world coverage, which reaches
# well past the handful of countries appearing in any single window.
FILES_TO_FETCH = 8

# Column positions in the GDELT 2.0 Events export (61 tab-separated fields, no header).
COL_ACTOR1_COUNTRY = 7   # CAMEO country code, ISO3-shaped for real countries
COL_ACTOR2_COUNTRY = 17
COL_AVG_TONE = 34        # mean tone of documents mentioning the event

# GDELT tone is nominally -100..+100 but sits within roughly -10..+10 in practice.
# Divide by this to reach the -1..1 range the VADER path already produces.
TONE_SCALE = 10.0

# Ignore thin evidence: a country seen once in two hours is noise, not sentiment.
MIN_EVENTS_PER_COUNTRY = 3

REQUEST_TIMEOUT_S = 60


def _recent_file_urls(count: int) -> list[str]:
    """URLs for the last `count` 15-minute export files, newest first.

    Derived from the clock rather than lastupdate.txt, which names only the newest one.
    A file that has not published yet simply 404s and is skipped.
    """
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    now = now - timedelta(minutes=now.minute % 15)
    return [
        f"{GDELT_BASE}/{(now - timedelta(minutes=15 * i)).strftime('%Y%m%d%H%M%S')}.export.CSV.zip"
        for i in range(count)
    ]


def _tone_by_country(url: str) -> dict[str, list[float]]:
    """Download one export file and collect per-country tone values."""
    out: dict[str, list[float]] = {}
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT_S)
        if not resp.ok:
            return out
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            names = z.namelist()
            if not names:
                return out
            text = z.read(names[0]).decode("utf-8", "replace")
    except Exception:
        return out

    for line in text.splitlines():
        fields = line.split("\t")
        if len(fields) <= COL_AVG_TONE:
            continue
        try:
            tone = float(fields[COL_AVG_TONE])
        except ValueError:
            continue
        # Credit both actors: an event about Russia acting on Ukraine is news for both.
        for col in (COL_ACTOR1_COUNTRY, COL_ACTOR2_COUNTRY):
            code = fields[col].strip().upper()
            if code:
                out.setdefault(code, []).append(tone)
    return out


def run() -> int:
    from db import get_conn, log_ingest, utcnow
    from ontology import COUNTRY_METADATA

    conn = get_conn()
    now = utcnow()

    collected: dict[str, list[float]] = {}
    files_ok = 0
    for url in _recent_file_urls(FILES_TO_FETCH):
        chunk = _tone_by_country(url)
        if chunk:
            files_ok += 1
            for code, tones in chunk.items():
                collected.setdefault(code, []).extend(tones)

    if not files_ok:
        log_ingest("gdelt", "error", 0, "no GDELT export files could be read")
        return 0

    # Countries with a reading in the last day came from RSS, which geocodes actual
    # headlines and is the more precise signal. Only fill the gaps. GDELT's country codes
    # also include regional aggregates (AFR, EUR); intersecting with COUNTRY_METADATA
    # drops those without needing a denylist.
    covered = {
        r[0] for r in conn.execute(
            "SELECT DISTINCT country_iso3 FROM news_sentiment WHERE fetched_at >= ?",
            [now - timedelta(hours=24)],
        ).fetchall()
    }

    written = 0
    for iso3 in COUNTRY_METADATA:
        if iso3 in covered:
            continue
        tones = collected.get(iso3, [])
        if len(tones) < MIN_EVENTS_PER_COUNTRY:
            continue
        mean = sum(tones) / len(tones)
        score = max(-1.0, min(1.0, mean / TONE_SCALE))
        conn.execute(
            """
            INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (country_iso3, fetched_at) DO UPDATE SET
                sentiment_score = excluded.sentiment_score,
                article_count   = excluded.article_count
            """,
            [iso3, score, len(tones), now],
        )
        written += 1

    print(
        f"[gdelt] {files_ok}/{FILES_TO_FETCH} files, {len(collected)} codes seen, "
        f"{len(covered)} already covered, {written} gaps filled",
        flush=True,
    )
    log_ingest("gdelt", "ok", written)
    return written


if __name__ == "__main__":
    print(f"GDELT: filled {run()} countries")
