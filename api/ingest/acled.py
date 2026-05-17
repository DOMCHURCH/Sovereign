"""
Conflict enrichment via GDELT DOC API (free, no key required).
Replaces ACLED since that requires researcher approval.
Queries GDELT for recent news in active conflict zones and uses
article counts as a proxy for current conflict activity.
"""
import requests
from datetime import datetime, timezone
from typing import Optional


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
    "MOZ": "Mozambique Cabo Delgado insurgency",
    "MLI": "Mali JNIM attack Bamako",
    "BFA": "Burkina Faso jihadist attack",
    "NER": "Niger coup militant attack",
    "ETH": "Ethiopia Amhara Fano conflict",
    "COD": "Congo DRC M23 Rwanda militia",
    "SSD": "South Sudan fighting violence",
    "LBY": "Libya militia fighting",
    "IRN": "Iran military sanctions nuclear",
    "PRK": "North Korea missile launch",
    "HTI": "Haiti gang violence Port-au-Prince",
    "COL": "Colombia ELN FARC attack",
    "PAK": "Pakistan TTP attack military",
    "NGA": "Nigeria Boko Haram ISWAP attack",
}


def fetch_recent_events(days: int = 7) -> Optional[list[dict]]:
    """
    Query GDELT for recent conflict article counts per zone.
    Returns None if GDELT is unreachable; returns [] if no activity found.
    Merged with curated metadata from main._CONFLICTS by the caller.
    """
    results = []

    for iso3, query in list(_CONFLICT_QUERIES.items())[:15]:  # cap at 15 per cycle
        try:
            resp = requests.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={
                    "query": query,
                    "mode": "ArtList",
                    "maxrecords": "10",
                    "format": "json",
                    "timespan": f"{days * 24}h",
                    "sourcelang": "english",
                },
                timeout=8,
            )
            if not resp.ok:
                continue
            data = resp.json()
            articles = data.get("articles", [])
            count = len(articles)
            if count > 0:
                results.append({
                    "iso3": iso3,
                    "article_count": count,
                    "activity_score": min(count / 10.0, 1.0),
                    "sample_headline": articles[0].get("title", "") if articles else "",
                    "source": "gdelt",
                })
        except Exception:
            continue

    return results if results else None
