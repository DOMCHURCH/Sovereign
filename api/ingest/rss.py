"""
RSS news ingestion pipeline.
Fetches from free public RSS feeds, scores sentiment with VADER,
classifies event type with keyword patterns, stores to news_articles table.
"""
import re
import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

RSS_FEEDS = [
    ("BBC World",       "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Al Jazeera",      "https://www.aljazeera.com/xml/rss/all.xml"),
    ("Guardian World",  "https://www.theguardian.com/world/rss"),
    ("DW World",        "https://rss.dw.com/rdf/rss-en-world"),
    ("France 24",       "https://www.france24.com/en/top-stories/rss"),
    ("VOA News",        "https://www.voanews.com/api/epiqegei"),
    ("Foreign Policy",  "https://foreignpolicy.com/feed/"),
    ("War on Rocks",    "https://warontherocks.com/feed/"),
    ("Bellingcat",      "https://www.bellingcat.com/feed/"),
    ("Reuters World",   "https://feeds.reuters.com/reuters/worldNews"),
    ("AP Top News",     "https://rsshub.app/apnews/topics/world-news"),
]

EVENT_PATTERNS = {
    "military_conflict": [
        "war", "attack", "killed", "airstrike", "troops", "military",
        "battle", "offensive", "shelling", "missile", "drone strike",
        "navy", "army", "ceasefire", "front line", "casualties",
    ],
    "sanctions": [
        "sanctions", "embargo", "blacklist", "ofac", "penalty",
        "restriction", "freeze assets", "export ban", "trade ban",
    ],
    "trade_dispute": [
        "tariff", "trade war", "import duties", "wto", "customs",
        "protectionism", "supply chain", "trade deal",
    ],
    "diplomatic_crisis": [
        "expel", "ambassador", "diplomatic", "summit", "treaty",
        "relations severed", "foreign minister", "state department",
    ],
    "terrorism": [
        "terrorist", "bomb", "explosion", "isis", "al-qaeda",
        "militant attack", "suicide bomber", "jihad", "iswap",
    ],
    "political_instability": [
        "coup", "protest", "riot", "election fraud", "parliament dissolved",
        "government fell", "mass demonstration", "crackdown",
    ],
    "economic_crisis": [
        "recession", "default", "currency crisis", "inflation surge",
        "imf bailout", "debt crisis", "bank run", "hyperinflation",
    ],
    "humanitarian": [
        "refugee", "famine", "displaced", "humanitarian", "aid convoy",
        "cholera", "starvation", "mass exodus",
    ],
}

# Country name → ISO3 for article geocoding (concise version)
_COUNTRY_KEYWORDS: dict[str, str] = {
    "russia": "RUS", "ukraine": "UKR", "israel": "ISR", "gaza": "ISR",
    "china": "CHN", "taiwan": "TWN", "iran": "IRN", "iraq": "IRQ",
    "sudan": "SDN", "myanmar": "MMR", "burma": "MMR",
    "congo": "COD", "drc": "COD",
    "ethiopia": "ETH", "somalia": "SOM", "mali": "MLI",
    "burkina faso": "BFA", "niger": "NER", "nigeria": "NGA",
    "afghanistan": "AFG", "pakistan": "PAK", "syria": "SYR",
    "lebanon": "LBN", "yemen": "YEM", "saudi arabia": "SAU",
    "india": "IND", "kashmir": "IND", "brazil": "BRA",
    "venezuela": "VEN", "haiti": "HTI", "colombia": "COL",
    "north korea": "PRK", "south korea": "KOR",
    "philippines": "PHL", "indonesia": "IDN",
    "turkey": "TUR", "azerbaijan": "AZE", "armenia": "ARM",
    "mozambique": "MOZ", "kenya": "KEN",
    "united states": "USA", "germany": "DEU", "france": "FRA",
    "united kingdom": "GBR", "japan": "JPN",
    "houthi": "YEM", "hezbollah": "LBN", "hamas": "ISR",
    "al-shabaab": "SOM", "boko haram": "NGA",
    "jnim": "MLI", "iswap": "NGA", "is-k": "AFG",
}


def _detect_iso3(text: str) -> str | None:
    text_lower = text.lower()
    for keyword, iso3 in _COUNTRY_KEYWORDS.items():
        if keyword in text_lower:
            return iso3
    return None


def _classify_event(text: str) -> str:
    text_lower = text.lower()
    scores: dict[str, int] = {}
    for event_type, keywords in EVENT_PATTERNS.items():
        scores[event_type] = sum(1 for kw in keywords if kw in text_lower)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def _vader_sentiment(text: str) -> float:
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        sia = SentimentIntensityAnalyzer()
        return sia.polarity_scores(text)["compound"]
    except ImportError:
        # Fallback: simple keyword score if vaderSentiment not installed
        negative = ["war", "attack", "crisis", "killed", "explosion", "coup", "sanctions"]
        positive = ["peace", "deal", "agreement", "growth", "ceasefire", "aid"]
        tl = text.lower()
        score = sum(-0.1 for w in negative if w in tl) + sum(0.1 for w in positive if w in tl)
        return max(-1.0, min(1.0, score))


def _fetch_feed(name: str, url: str) -> list[dict]:
    try:
        import feedparser
        feed = feedparser.parse(url)
        articles = []
        for entry in feed.entries[:20]:
            title = getattr(entry, "title", "") or ""
            summary = getattr(entry, "summary", "") or ""
            link = getattr(entry, "link", "") or ""
            # Parse published date
            published = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                import time
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            text = f"{title} {summary}"
            iso3 = _detect_iso3(text)
            if not iso3:
                continue  # skip articles we can't geocode
            articles.append({
                "title": title[:500],
                "url": link[:1000],
                "source": name,
                "iso3": iso3,
                "published_at": published or datetime.now(timezone.utc),
                "sentiment": _vader_sentiment(text),
                "event_type": _classify_event(text),
                "summary": summary[:800],
            })
        return articles
    except Exception:
        return []


def run() -> int:
    from db import get_conn, log_ingest
    conn = get_conn()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=3)

    all_articles = []
    for name, url in RSS_FEEDS:
        articles = _fetch_feed(name, url)
        all_articles.extend(articles)

    # Deduplicate by URL
    seen_urls: set[str] = set()
    rows_written = 0

    for art in all_articles:
        if art["url"] in seen_urls:
            continue
        seen_urls.add(art["url"])
        if art["published_at"] < cutoff:
            continue
        try:
            conn.execute(
                """
                INSERT INTO news_articles
                    (url, iso3, title, source, published_at, sentiment_score, event_type, summary, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (url) DO NOTHING
                """,
                [
                    art["url"], art["iso3"], art["title"], art["source"],
                    art["published_at"], art["sentiment"], art["event_type"],
                    art["summary"], now,
                ],
            )
            rows_written += 1
        except Exception:
            continue

    # Aggregate sentiment per country and write to news_sentiment
    from collections import defaultdict
    country_articles: dict[str, list[float]] = defaultdict(list)
    for art in all_articles:
        country_articles[art["iso3"]].append(art["sentiment"])

    for iso3, scores in country_articles.items():
        avg = sum(scores) / len(scores)
        count = len(scores)
        conn.execute(
            """
            INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at)
            VALUES (?, ?, ?, ?)
            """,
            [iso3, avg, count, now],
        )

    log_ingest("rss", "ok", rows_written)
    return rows_written


if __name__ == "__main__":
    n = run()
    print(f"RSS: {n} articles written")
