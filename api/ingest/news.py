import os
import requests
from datetime import datetime, timezone, timedelta
from textblob import TextBlob
from db import get_conn, log_ingest

NEWS_API_KEY = os.getenv("NEWS_API_KEY", "")
NEWS_API_URL = "https://newsapi.org/v2/everything"

# Countries to query — name used for search, iso3 for storage
COUNTRIES = {
    "USA": "United States", "CHN": "China", "RUS": "Russia",
    "IRN": "Iran", "PRK": "North Korea", "SYR": "Syria",
    "JPN": "Japan", "DEU": "Germany", "GBR": "United Kingdom",
    "IND": "India", "BRA": "Brazil", "KOR": "South Korea",
    "AUS": "Australia", "CAN": "Canada", "FRA": "France",
    "ITA": "Italy", "MEX": "Mexico", "SAU": "Saudi Arabia",
    "ZAF": "South Africa", "SGP": "Singapore", "HKG": "Hong Kong",
    "TWN": "Taiwan", "ARG": "Argentina", "TUR": "Turkey",
    "VEN": "Venezuela", "CUB": "Cuba", "BLR": "Belarus",
    "PAK": "Pakistan", "AFG": "Afghanistan", "UKR": "Ukraine",
    "NGA": "Nigeria", "EGY": "Egypt", "ISR": "Israel",
    "IRQ": "Iraq", "LBY": "Libya", "YEM": "Yemen",
    "ETH": "Ethiopia", "MMR": "Myanmar", "SDN": "Sudan",
    "ZWE": "Zimbabwe", "NIC": "Nicaragua", "LBN": "Lebanon",
}


def _fetch_sentiment(country_name: str) -> tuple[float, int]:
    if not NEWS_API_KEY:
        return 0.0, 0

    from_date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    params = {
        "q": f'"{country_name}" economy OR crisis OR sanctions OR instability',
        "from": from_date,
        "language": "en",
        "sortBy": "relevancy",
        "pageSize": 20,
        "apiKey": NEWS_API_KEY,
    }
    try:
        resp = requests.get(NEWS_API_URL, params=params, timeout=15)
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
    except Exception:
        return 0.0, 0

    if not articles:
        return 0.0, 0

    scores = []
    for art in articles:
        text = f"{art.get('title', '')} {art.get('description', '')}".strip()
        if text:
            scores.append(TextBlob(text).sentiment.polarity)

    if not scores:
        return 0.0, 0

    return sum(scores) / len(scores), len(scores)


def run() -> int:
    conn = get_conn()
    now = datetime.now(timezone.utc)
    rows_written = 0

    for iso3, name in COUNTRIES.items():
        score, count = _fetch_sentiment(name)
        conn.execute(
            """
            INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at)
            VALUES (?, ?, ?, ?)
            """,
            [iso3, score, count, now],
        )
        rows_written += 1

    log_ingest("news", "ok", rows_written)
    return rows_written


if __name__ == "__main__":
    n = run()
    print(f"News: {n} countries written")
    conn = get_conn()
    rows = conn.execute(
        "SELECT country_iso3, sentiment_score, article_count FROM news_sentiment ORDER BY sentiment_score ASC LIMIT 10"
    ).fetchall()
    for row in rows:
        print(row)
