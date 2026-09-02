"""Real, dated, geolocated violent events from the GDELT 2.0 Events export.

Why this exists
---------------
The globe's conflict layer was a hardcoded list of ~30 long-running wars, the oldest
dating to 1947. Useful context, but it is not *news*: nothing in it was dated to this
week, so a platform advertising live geopolitical intelligence showed a reader the same
Russia-Ukraine pin it showed in 2022.

There was a live path -- ingest/acled.py -- but it queries GDELT's DOC API, which was
measured failing roughly 90% of requests from the deployment host. Even on success it
pinned "N live signals" to a country's *capital city* under a curated conflict's name,
so it could never say "a bombing happened here, yesterday".

The bulk Events export already downloaded for tone (see gdelt.py) carries exactly that:
one 15-minute file holds ~135 violent events with a real date, the actual coordinates of
the incident, and the source article. This turns those into the event feed.

CAMEO taxonomy: root 18 = Assault, 19 = Fight, 20 = Unconventional mass violence.
Source: http://data.gdeltproject.org/gdeltv2/ -- no key required.
Terms: https://www.gdeltproject.org/about.html (see DATA_SOURCES.md)
"""
import io
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GDELT_BASE = "http://data.gdeltproject.org/gdeltv2"

# Two hours of coverage. More files means better recall but a bigger download; events are
# heavily duplicated across files anyway, so the marginal return drops off quickly.
FILES_TO_FETCH = 8
REQUEST_TIMEOUT_S = 60

# GDELT infers events from news text with a machine coder, and it produces false
# positives: a single article can yield "Ethnic cleansing / Denmark" or "Air strike /
# Virginia" because the coder matched phrasing and geocoded to a place the article
# merely mentioned. Requiring corroboration from independent outlets removes most of
# that. The cost is losing genuinely obscure incidents only one outlet covered, which
# is the right trade for a feed presented as intelligence.
MIN_SOURCES = 2
# The gravest categories carry the most weight if wrong, so hold them to a higher bar.
MIN_SOURCES_FOR_MAJOR = 3

# Column positions in the GDELT 2.0 Events export (61 tab-separated fields, no header).
C_ID, C_DAY = 0, 1
C_EVENT_CODE, C_ROOT_CODE = 26, 28
C_GOLDSTEIN, C_MENTIONS, C_SOURCES = 30, 31, 32
C_PLACE, C_GEO_CC, C_LAT, C_LNG = 52, 53, 56, 57
C_SOURCE_URL = 60

# The subset of CAMEO worth surfacing, with the label shown in the UI. Anything not
# listed here is ordinary politics and does not belong in a conflict feed.
CAMEO_LABELS = {
    "180": ("Unconventional violence", "significant"),
    "181": ("Abduction / hostage-taking", "significant"),
    "182": ("Physical assault", "minor"),
    "1821": ("Sexual assault", "significant"),
    "1822": ("Torture", "significant"),
    "1823": ("Killing by physical assault", "major"),
    "183": ("Bombing", "major"),
    "1831": ("Suicide bombing", "major"),
    "1832": ("Vehicle bombing", "major"),
    "1833": ("Roadside bombing", "major"),
    "184": ("Human shields", "significant"),
    "185": ("Attempted assassination", "major"),
    "186": ("Assassination", "major"),
    "190": ("Conventional military force", "significant"),
    "191": ("Blockade", "minor"),
    "192": ("Territorial occupation", "significant"),
    "193": ("Small-arms fighting", "significant"),
    "194": ("Artillery / armour", "major"),
    "195": ("Air strike", "major"),
    "196": ("Ceasefire violation", "significant"),
    "200": ("Mass violence", "major"),
    "201": ("Mass expulsion", "major"),
    "202": ("Mass killing", "major"),
    "203": ("Ethnic cleansing", "major"),
    "204": ("Weapons of mass destruction", "major"),
}
VIOLENT_ROOTS = {"18", "19", "20"}

# GDELT geocodes with FIPS 10-4, which disagrees with ISO 3166 for most of the world.
# Only the countries the platform scores need translating; everything else keeps a
# coordinate and a place name but no country attribution, which is honest.
FIPS_TO_ISO3 = {
    "AF": "AFG", "AG": "DZA", "AO": "AGO", "AR": "ARG", "AS": "AUS", "AU": "AUT",
    "AJ": "AZE", "BG": "BGD", "BO": "BLR", "BE": "BEL", "BL": "BOL", "BR": "BRA",
    "BX": "BRN", "BU": "BGR", "UV": "BFA", "BY": "BDI", "CB": "KHM", "CM": "CMR",
    "CA": "CAN", "CT": "CAF", "CD": "TCD", "CI": "CHL", "CH": "CHN", "CO": "COL",
    "CG": "COD", "CF": "COG", "CU": "CUB", "EZ": "CZE", "DA": "DNK", "EG": "EGY",
    "ET": "ETH", "FI": "FIN", "FR": "FRA", "GM": "DEU", "GH": "GHA", "GR": "GRC",
    "GT": "GTM", "HA": "HTI", "HO": "HND", "HK": "HKG", "HU": "HUN", "IC": "ISL",
    "IN": "IND", "ID": "IDN", "IR": "IRN", "IZ": "IRQ", "EI": "IRL", "IS": "ISR",
    "IT": "ITA", "JM": "JAM", "JA": "JPN", "JO": "JOR", "KZ": "KAZ", "KE": "KEN",
    "KN": "PRK", "KS": "KOR", "KU": "KWT", "KG": "KGZ", "LA": "LAO", "LE": "LBN",
    "LY": "LBY", "LH": "LTU", "MY": "MYS", "ML": "MLI", "MX": "MEX", "MD": "MDA",
    "MG": "MNG", "MO": "MAR", "MZ": "MOZ", "BM": "MMR", "WA": "NAM", "NP": "NPL",
    "NL": "NLD", "NZ": "NZL", "NU": "NIC", "NG": "NER", "NI": "NGA", "NO": "NOR",
    "MU": "OMN", "PK": "PAK", "PM": "PAN", "PA": "PRY", "PE": "PER", "RP": "PHL",
    "PL": "POL", "PO": "PRT", "QA": "QAT", "RO": "ROU", "RS": "RUS", "RW": "RWA",
    "SA": "SAU", "SG": "SEN", "RI": "SRB", "SN": "SGP", "LO": "SVK", "SI": "SVN",
    "SO": "SOM", "SF": "ZAF", "OD": "SSD", "SP": "ESP", "CE": "LKA", "SU": "SDN",
    "SW": "SWE", "SZ": "CHE", "SY": "SYR", "TW": "TWN", "TI": "TJK", "TZ": "TZA",
    "TH": "THA", "TS": "TUN", "TU": "TUR", "TX": "TKM", "UG": "UGA", "UP": "UKR",
    "AE": "ARE", "UK": "GBR", "US": "USA", "UY": "URY", "UZ": "UZB", "VE": "VEN",
    "VM": "VNM", "YM": "YEM", "ZA": "ZMB", "ZI": "ZWE",
}


def _recent_file_urls(count: int) -> list[str]:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    now = now - timedelta(minutes=now.minute % 15)
    return [
        f"{GDELT_BASE}/{(now - timedelta(minutes=15 * i)).strftime('%Y%m%d%H%M%S')}.export.CSV.zip"
        for i in range(count)
    ]


def _parse(url: str) -> list[dict]:
    out: list[dict] = []
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
        f = line.split("\t")
        if len(f) <= C_SOURCE_URL:
            continue
        if f[C_ROOT_CODE].strip() not in VIOLENT_ROOTS:
            continue

        code = f[C_EVENT_CODE].strip()
        # Fall back to the 3-digit parent when GDELT gives a 4-digit subtype we do not
        # label individually (e.g. 1834 -> 183), so specificity never costs us the event.
        label = CAMEO_LABELS.get(code) or CAMEO_LABELS.get(code[:3])
        if not label:
            continue
        category, severity = label

        try:
            lat, lng = float(f[C_LAT]), float(f[C_LNG])
        except ValueError:
            continue  # no coordinates means nothing to place on a globe
        if lat == 0.0 and lng == 0.0:
            continue

        try:
            event_id = int(f[C_ID])
            day = datetime.strptime(f[C_DAY].strip(), "%Y%m%d").date()
        except ValueError:
            continue

        try:
            mentions = int(f[C_MENTIONS])
        except ValueError:
            mentions = 0
        try:
            sources = int(f[C_SOURCES])
        except ValueError:
            sources = 0
        if sources < (MIN_SOURCES_FOR_MAJOR if severity == "major" else MIN_SOURCES):
            continue
        try:
            goldstein = float(f[C_GOLDSTEIN])
        except ValueError:
            goldstein = None

        out.append({
            "id": event_id,
            "event_date": day,
            "cameo_code": code,
            "category": category,
            "severity": severity,
            "country_iso3": FIPS_TO_ISO3.get(f[C_GEO_CC].strip().upper()),
            "place_name": f[C_PLACE].strip()[:200] or None,
            "lat": lat,
            "lng": lng,
            "mentions": mentions,
            "sources": sources,
            "goldstein": goldstein,
            "source_url": f[C_SOURCE_URL].strip()[:500] or None,
        })
    return out


def run() -> int:
    from db import get_conn, log_ingest, utcnow

    conn = get_conn()
    now = utcnow()

    # GDELT repeats an event across files as coverage grows, so keep the record with the
    # highest mention count -- that is the best-supported version of the same incident.
    best: dict[int, dict] = {}
    files_ok = 0
    for url in _recent_file_urls(FILES_TO_FETCH):
        rows = _parse(url)
        if rows:
            files_ok += 1
        for r in rows:
            prev = best.get(r["id"])
            if prev is None or r["mentions"] > prev["mentions"]:
                best[r["id"]] = r

    if not files_ok:
        log_ingest("events", "error", 0, "no GDELT export files could be read")
        return 0

    # GDELT back-dates events it is still learning about, so a file fetched today can
    # describe something from weeks ago. Keep the genuinely recent ones.
    cutoff = (now - timedelta(days=14)).date()
    written = 0
    for r in best.values():
        if r["event_date"] < cutoff:
            continue
        conn.execute(
            """
            INSERT INTO events (id, event_date, cameo_code, category, severity,
                                country_iso3, place_name, lat, lng, mentions, sources,
                                goldstein, source_url, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                mentions   = GREATEST(events.mentions, excluded.mentions),
                sources    = GREATEST(events.sources, excluded.sources),
                fetched_at = excluded.fetched_at
            """,
            [r["id"], r["event_date"], r["cameo_code"], r["category"], r["severity"],
             r["country_iso3"], r["place_name"], r["lat"], r["lng"], r["mentions"],
             r["sources"], r["goldstein"], r["source_url"], now],
        )
        written += 1

    # Unbounded growth would eventually bloat the volume; nothing reads past 90 days.
    conn.execute("DELETE FROM events WHERE event_date < ?", [(now - timedelta(days=90)).date()])

    print(f"[events] {files_ok}/{FILES_TO_FETCH} files, {len(best)} unique, {written} stored", flush=True)
    log_ingest("events", "ok", written)
    return written


if __name__ == "__main__":
    print(f"Events: stored {run()}")
