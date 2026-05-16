"""
ACLED (Armed Conflict Location & Event Database) integration.
Free for researchers: acleddata.com/access-data
Set ACLED_API_KEY and ACLED_EMAIL env vars.

Returns conflict events enriched with ACLED data when key is available,
falls back gracefully to curated data when not.
"""
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

ACLED_BASE = "https://api.acleddata.com/acled/read"

# Map ACLED event types to our categories
ACLED_TYPE_MAP = {
    "Battles":                  "interstate_war",
    "Explosions/Remote violence":"terrorist_insurgency",
    "Violence against civilians":"civil_war",
    "Riots":                    "political_instability",
    "Protests":                 "political_instability",
    "Strategic developments":   "territorial_dispute",
}

ACLED_INTENSITY_MAP = {
    # fatalities → intensity
    (50, float("inf")): "major",
    (10, 50):           "significant",
    (0, 10):            "minor",
}


def _intensity(fatalities: int) -> str:
    for (lo, hi), label in ACLED_INTENSITY_MAP.items():
        if lo <= fatalities < hi:
            return label
    return "minor"


def fetch_recent_events(days: int = 7) -> list[dict] | None:
    """
    Returns list of conflict objects in Sovereign's format, or None on failure.
    Only runs if ACLED_API_KEY and ACLED_EMAIL are set.
    """
    api_key = os.getenv("ACLED_API_KEY", "")
    email   = os.getenv("ACLED_EMAIL", "")
    if not api_key or not email:
        return None

    import requests
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    try:
        resp = requests.get(
            ACLED_BASE,
            params={
                "key":        api_key,
                "email":      email,
                "event_date": since,
                "event_date_where": ">=",
                "limit":      500,
                "fields":     "event_id_cnty|event_type|actor1|actor2|country|iso3|latitude|longitude|fatalities|event_date|notes",
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
    except Exception:
        return None

    # Aggregate by iso3 — group events into conflict objects
    from collections import defaultdict
    by_country: dict[str, list[dict]] = defaultdict(list)
    for evt in data:
        iso3 = evt.get("iso3", "").upper()
        if iso3:
            by_country[iso3].append(evt)

    conflicts = []
    for iso3, events in by_country.items():
        total_fatalities = sum(int(e.get("fatalities", 0)) for e in events)
        event_types = [e.get("event_type", "") for e in events]
        dominant_type = max(set(event_types), key=event_types.count) if event_types else "Battles"
        category = ACLED_TYPE_MAP.get(dominant_type, "civil_war")
        intensity = _intensity(total_fatalities)
        # Use centroid of events as location
        lats = [float(e["latitude"]) for e in events if e.get("latitude")]
        lngs = [float(e["longitude"]) for e in events if e.get("longitude")]
        lat = sum(lats) / len(lats) if lats else 0
        lng = sum(lngs) / len(lngs) if lngs else 0
        country_name = events[0].get("country", iso3)
        # Get unique actors
        actors = list({e.get("actor1", "") for e in events if e.get("actor1")} |
                      {e.get("actor2", "") for e in events if e.get("actor2")})[:4]
        conflicts.append({
            "id":          f"acled-{iso3}",
            "name":        f"{country_name} – Active Conflict",
            "lat":         round(lat, 2),
            "lng":         round(lng, 2),
            "intensity":   intensity,
            "type":        dominant_type.lower().replace("/", "_").replace(" ", "_"),
            "category":    category,
            "parties":     " vs. ".join(actors[:2]) if len(actors) >= 2 else actors[0] if actors else "",
            "since":       int(events[0].get("event_date", "2024")[:4]),
            "countries":   [iso3],
            "description": f"{len(events)} events, {total_fatalities} fatalities in last {days} days (ACLED live data).",
            "fatalities":  total_fatalities,
            "event_count": len(events),
            "live":        True,
            "source":      "acled",
        })

    return sorted(conflicts, key=lambda x: x["fatalities"], reverse=True)
