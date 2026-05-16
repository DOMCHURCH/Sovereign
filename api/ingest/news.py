"""
News sentiment pipeline.
Primary: RSS feeds via ingest.rss (free, no API key).
Fallback: GDELT GKG for additional country coverage.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def run() -> int:
    # Primary: RSS pipeline (free, no key)
    from ingest.rss import run as rss_run
    rows = rss_run()

    # Supplement with GDELT GKG sentiment for broader country coverage
    _gdelt_supplement()

    return rows


def _gdelt_supplement():
    """Pull GDELT GKG tone data for countries missing from RSS coverage."""
    import requests
    from datetime import datetime, timezone, timedelta
    from db import get_conn

    conn = get_conn()
    now = datetime.now(timezone.utc)

    # Find which countries already have sentiment from RSS this cycle
    cutoff = (now - timedelta(hours=1)).isoformat()
    covered = {r[0] for r in conn.execute(
        "SELECT DISTINCT country_iso3 FROM news_sentiment WHERE fetched_at >= ?", [cutoff]
    ).fetchall()}

    # GDELT GKG: pull top news themes per country for past 24h
    try:
        resp = requests.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": "war conflict sanctions political crisis",
                "mode": "ToneChart",
                "timespan": "24h",
                "format": "json",
            },
            timeout=15,
        )
        if not resp.ok:
            return
        data = resp.json()
        # ToneChart returns per-time-slice data; use overall tone as proxy
        tone = data.get("tone", {})
        if tone:
            avg_tone = tone.get("avgtone", 0)
            # Apply this global baseline to uncovered countries at 0
            # (GDELT doesn't give per-country tone in this mode cheaply)
        # Fallback: just run country-specific GDELT searches for high-risk uncovered countries
        _gdelt_per_country(conn, now, covered)
    except Exception:
        pass


def _gdelt_per_country(conn, now, covered: set):
    """GDELT ArtList search per high-risk country not covered by RSS."""
    import requests
    from db import log_ingest

    HIGH_PRIORITY = [
        "RUS", "UKR", "IRN", "PRK", "CHN", "SDN", "MMR", "SYR",
        "YEM", "AFG", "PAK", "ISR", "ETH", "COD",
    ]
    targets = [iso3 for iso3 in HIGH_PRIORITY if iso3 not in covered]

    # Country name map for query building
    NAMES = {
        "RUS": "Russia", "UKR": "Ukraine", "IRN": "Iran", "PRK": "North Korea",
        "CHN": "China", "SDN": "Sudan", "MMR": "Myanmar", "SYR": "Syria",
        "YEM": "Yemen", "AFG": "Afghanistan", "PAK": "Pakistan", "ISR": "Israel",
        "ETH": "Ethiopia", "COD": "Congo",
    }

    for iso3 in targets[:6]:  # cap at 6 to stay fast
        name = NAMES.get(iso3, iso3)
        try:
            resp = requests.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={
                    "query": f"{name} conflict war crisis sanctions",
                    "mode": "ArtList",
                    "maxrecords": "20",
                    "format": "json",
                    "timespan": "24h",
                    "sourcelang": "english",
                },
                timeout=10,
            )
            if not resp.ok:
                continue
            articles = resp.json().get("articles", [])
            if not articles:
                continue
            # Score each title with VADER
            try:
                from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
                sia = SentimentIntensityAnalyzer()
                scores = [sia.polarity_scores(a.get("title", ""))["compound"] for a in articles]
            except ImportError:
                scores = [0.0] * len(articles)
            avg = sum(scores) / len(scores) if scores else 0.0
            conn.execute(
                "INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at) VALUES (?, ?, ?, ?)",
                [iso3, avg, len(scores), now],
            )
        except Exception:
            continue
