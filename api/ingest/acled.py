"""
Conflict enrichment via GDELT DOC API (free, no key required).
Queries run in parallel to stay within Vercel's 10s function timeout.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
import requests

_CONFLICT_QUERIES = {
    "UKR": "Ukraine Russia war offensive frontline",
    "SDN": "Sudan war RSF SAF fighting Khartoum",
    "MMR": "Myanmar military junta resistance fighting",
    "SYR": "Syria conflict war fighting",
    "YEM": "Yemen Houthi war ceasefire",
    "ISR": "Israel Gaza Hamas war attack",
    "IRQ": "Iraq militia attack bomb",
    "AFG": "Afghanistan Taliban attack",
    "SOM": "Somalia Al-Shabaab attack",
    "MLI": "Mali JNIM attack Bamako",
    "BFA": "Burkina Faso jihadist attack",
    "ETH": "Ethiopia Amhara conflict",
    "COD": "Congo DRC M23 militia",
    "SDN": "Sudan civil war RSF",
    "HTI": "Haiti gang violence",
    "PAK": "Pakistan TTP attack",
    "NGA": "Nigeria Boko Haram attack",
}

_TIMESPAN_HOURS = 48


def _query_one(iso3: str, query: str) -> Optional[dict]:
    try:
        resp = requests.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": query,
                "mode": "ArtList",
                "maxrecords": "10",
                "format": "json",
                "timespan": f"{_TIMESPAN_HOURS}h",
                "sourcelang": "english",
            },
            timeout=4,
        )
        if not resp.ok:
            return None
        articles = resp.json().get("articles", [])
        if not articles:
            return None
        return {
            "iso3": iso3,
            "article_count": len(articles),
            "activity_score": min(len(articles) / 10.0, 1.0),
            "sample_headline": articles[0].get("title", ""),
            "source": "gdelt",
        }
    except Exception:
        return None


def fetch_recent_events(days: int = 7) -> Optional[list[dict]]:
    """Query GDELT in parallel for recent conflict article counts per zone.
    Returns None if GDELT is unreachable; caller merges with curated metadata."""
    items = list(_CONFLICT_QUERIES.items())[:12]
    results = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_query_one, iso3, q): iso3 for iso3, q in items}
        for future in as_completed(futures, timeout=6):
            try:
                r = future.result()
                if r:
                    results.append(r)
            except Exception:
                pass
    return results if results else None
