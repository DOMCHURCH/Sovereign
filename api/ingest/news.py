"""
News ingestion pipeline.
Primary: RSS feeds (free, no key required)
Secondary: Mediastack API (free tier: 100/month, no credit card)
Fallback: GDELT GKG supplement for uncovered countries
"""
import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def run() -> int:
    """Run full news pipeline: RSS → Mediastack → GDELT."""
    from db import get_conn, log_ingest

    conn = get_conn()
    now = datetime.now(timezone.utc)
    rows_written = 0

    # 1. RSS pipeline (free, 11 feeds)
    try:
        from ingest.rss import run as rss_run
        rows_written += rss_run()
    except Exception as e:
        log_ingest("news_rss", "error", 0, str(e))

    # 2. Mediastack for structured news (free: 100/month)
    rows_written += _mediastack_ingest(conn, now)

    # 3. GDELT supplement for high-risk countries not covered by RSS
    _gdelt_supplement(conn, now)

    log_ingest("news_combined", "ok", rows_written)
    return rows_written


def _mediastack_ingest(conn, now) -> int:
    """
    Mediastack (free.currentsapi.services) — structured news without API key.
    Free tier: 60 requests/day, covers 200+ countries.
    """
    import requests

    rows_written = 0
    # High-priority countries for 24h coverage
    COUNTRIES = [
        "US", "Russia", "China", "Ukraine", "Iran", "Israel", "North Korea",
        "Syria", "Sudan", "Yemen", "Afghanistan", "Pakistan", "Myanmar",
    ]

    for country in COUNTRIES[:8]:  # cap at 8 per cycle (1 request each)
        try:
            resp = requests.get(
                "https://api.currentsapi.services/v1/search",
                params={
                    "country": country,
                    "category": "war,politics,business",
                    "limit": 10,
                },
                timeout=10,
            )
            if not resp.ok:
                continue

            articles = resp.json().get("news", [])
            if not articles:
                continue

            # Extract ISO3 from country name
            country_iso3 = _country_to_iso3(country)
            if not country_iso3:
                continue

            # Score sentiment
            try:
                from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

                sia = SentimentIntensityAnalyzer()
                for art in articles:
                    title = art.get("title", "")
                    url = art.get("url", "")
                    source = art.get("source", "")
                    published = art.get("published", "")

                    if not title or not url:
                        continue

                    sentiment = sia.polarity_scores(title)["compound"]
                    event_type = _classify_event(title)

                    try:
                        conn.execute(
                            """
                            INSERT INTO news_articles
                                (url, iso3, title, source, published_at, sentiment_score, event_type, fetched_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (url) DO NOTHING
                            """,
                            [
                                url,
                                country_iso3,
                                title[:500],
                                source[:100],
                                published or now.isoformat(),
                                sentiment,
                                event_type,
                                now,
                            ],
                        )
                        rows_written += 1
                    except Exception:
                        pass

            except ImportError:
                # VADER not available, skip sentiment
                pass

        except Exception:
            continue

    return rows_written


def _country_to_iso3(country: str) -> str | None:
    """Map country name to ISO3."""
    mapping = {
        "US": "USA",
        "Russia": "RUS",
        "China": "CHN",
        "Ukraine": "UKR",
        "Iran": "IRN",
        "Israel": "ISR",
        "North Korea": "PRK",
        "Syria": "SYR",
        "Sudan": "SDN",
        "Yemen": "YEM",
        "Afghanistan": "AFG",
        "Pakistan": "PAK",
        "Myanmar": "MMR",
        "India": "IND",
        "Iraq": "IRQ",
        "Turkey": "TUR",
        "Saudi Arabia": "SAU",
        "UAE": "ARE",
    }
    return mapping.get(country)


def _classify_event(text: str) -> str:
    """Keyword-based event type classification."""
    text_lower = text.lower()
    patterns = {
        "military_conflict": ["war", "attack", "killed", "airstrike", "battle", "offensive"],
        "sanctions": ["sanctions", "embargo", "freeze", "trade ban"],
        "terrorism": ["terrorist", "bomb", "explosion", "militant"],
        "political_instability": ["coup", "protest", "riot", "election fraud"],
        "economic_crisis": ["recession", "default", "inflation", "crisis"],
    }
    for event_type, keywords in patterns.items():
        if any(kw in text_lower for kw in keywords):
            return event_type
    return "general"


def _gdelt_supplement(conn, now):
    """Pull GDELT for countries not covered by RSS/Mediastack."""
    import requests

    HIGH_PRIORITY = ["RUS", "UKR", "IRN", "PRK", "CHN", "SDN", "MMR", "SYR", "YEM", "AFG"]

    # Find which countries already have recent sentiment
    cutoff = (now - timedelta(hours=2)).isoformat()
    covered = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT iso3 FROM news_articles WHERE fetched_at >= ?", [cutoff]
        ).fetchall()
    }

    targets = [iso3 for iso3 in HIGH_PRIORITY if iso3 not in covered][:3]

    NAMES = {
        "RUS": "Russia",
        "UKR": "Ukraine",
        "IRN": "Iran",
        "PRK": "North Korea",
        "CHN": "China",
        "SDN": "Sudan",
        "MMR": "Myanmar",
        "SYR": "Syria",
        "YEM": "Yemen",
        "AFG": "Afghanistan",
    }

    for iso3 in targets:
        name = NAMES.get(iso3, iso3)
        try:
            resp = requests.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={
                    "query": f"{name} conflict war crisis sanctions",
                    "mode": "ArtList",
                    "maxrecords": "15",
                    "format": "json",
                    "timespan": "24h",
                },
                timeout=10,
            )
            if not resp.ok:
                continue
            articles = resp.json().get("articles", [])
            if not articles:
                continue

            try:
                from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

                sia = SentimentIntensityAnalyzer()
                for art in articles:
                    title = art.get("title", "")
                    url = art.get("url", "")
                    if not title or not url:
                        continue
                    sentiment = sia.polarity_scores(title)["compound"]
                    conn.execute(
                        """
                        INSERT INTO news_articles
                            (url, iso3, title, source, sentiment_score, event_type, fetched_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (url) DO NOTHING
                        """,
                        [
                            url,
                            iso3,
                            title[:500],
                            "GDELT",
                            sentiment,
                            _classify_event(title),
                            now,
                        ],
                    )
            except ImportError:
                pass

        except Exception:
            continue
