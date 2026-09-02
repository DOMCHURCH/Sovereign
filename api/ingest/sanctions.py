import io
import csv
import requests
from datetime import datetime, timezone
from db import get_conn, log_ingest

# OFAC retired /downloads/sdn.csv — it now 404s, which silently froze the sanctions
# table. The sanctions list service is the current canonical export; the legacy
# treasury.gov path still redirects there and is kept as a fallback.
SDN_URLS = [
    "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
    "https://www.treasury.gov/ofac/downloads/sdn.csv",
]

# Map SDN country field text → ISO3. Covers the most common entries.
COUNTRY_MAP = {
    "RUSSIA": "RUS", "RUSSIAN FEDERATION": "RUS",
    "IRAN": "IRN", "IRAN, ISLAMIC REPUBLIC OF": "IRN",
    "NORTH KOREA": "PRK", "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC OF": "PRK",
    "SYRIA": "SYR", "SYRIAN ARAB REPUBLIC": "SYR",
    "CUBA": "CUB",
    "VENEZUELA": "VEN",
    "BELARUS": "BLR",
    "MYANMAR": "MMR", "BURMA": "MMR",
    "UKRAINE": "UKR",
    "CHINA": "CHN",
    "IRAQ": "IRQ",
    "LIBYA": "LBY",
    "SUDAN": "SDN",
    "SOMALIA": "SOM",
    "YEMEN": "YEM",
    "ZIMBABWE": "ZWE",
    "NICARAGUA": "NIC",
    "MALI": "MLI",
    "HAITI": "HTI",
    "ETHIOPIA": "ETH",
    "AFGHANISTAN": "AFG",
    "LEBANON": "LBN",
    "PAKISTAN": "PAK",
    "TURKEY": "TUR",
    "UNITED ARAB EMIRATES": "ARE",
    "SOUTH SUDAN": "SSD",
    "DRCONGO": "COD",
    "CENTRAL AFRICAN REPUBLIC": "CAF",
}

# OFAC identifies some country programmes only by an opaque code, so they never match on
# the country name. Without these, North Korea in particular drops out of the list
# entirely despite being one of the most heavily designated jurisdictions.
PROGRAM_CODE_MAP = {
    "DPRK": "PRK", "DPRK2": "PRK", "DPRK3": "PRK", "DPRK4": "PRK",
    "IFSR": "IRN", "IRGC": "IRN", "IRAN-HR": "IRN", "IRAN-TRA": "IRN",
    "IFCA": "IRN", "HRIT-IR": "IRN", "CAATSA - IRAN": "IRN",
    "CAATSA - RUSSIA": "RUS", "PEESA-EO14039": "RUS", "MAGNIT": "RUS",
    "IRAQ2": "IRQ", "IRAQ3": "IRQ",
    "LIBYA2": "LBY", "LIBYA3": "LBY",
    "CAR": "CAF",
}

# Longest-first so "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC OF" wins over a shorter prefix.
_COUNTRY_KEYS_BY_LENGTH = sorted(COUNTRY_MAP, key=len, reverse=True)

PRIMARY_THRESHOLD = 50


def run() -> int:
    conn = get_conn()
    now = datetime.now(timezone.utc)

    content = None
    errors = []
    for url in SDN_URLS:
        try:
            resp = requests.get(url, timeout=60, allow_redirects=True)
            resp.raise_for_status()
            content = resp.content.decode("latin-1")
            break
        except Exception as e:
            errors.append(f"{url}: {e}")
    if content is None:
        log_ingest("sanctions", "error", 0, " | ".join(errors))
        return 0

    counts: dict[str, int] = {}

    reader = csv.reader(io.StringIO(content))
    for row in reader:
        if len(row) < 5:
            continue
        # Column 3 is the sanctions Program field; column 4 is the entity's title and
        # never held a country, which is why this counted zero on every real SDN file.
        # Programs are country-scoped with an authority suffix ("RUSSIA-EO14024") and a
        # single entity can carry several, joined as "NPWMD] [IFSR".
        programs = (row[3] or "").strip().upper().replace("] [", ";").replace("[", "").replace("]", "")
        seen_for_row: set[str] = set()
        for program in programs.split(";"):
            program = program.strip()
            if not program or program == "-0-":
                continue
            iso3 = COUNTRY_MAP.get(program) or PROGRAM_CODE_MAP.get(program)
            if not iso3:
                # "VENEZUELA-EO13884" → "VENEZUELA". Match the longest key that the
                # program starts with, so "UKRAINE-EO13662" does not shadow a longer name.
                for key in _COUNTRY_KEYS_BY_LENGTH:
                    if program.startswith(key):
                        iso3 = COUNTRY_MAP[key]
                        break
            # Count each country once per entity, not once per program it appears under.
            if iso3 and iso3 not in seen_for_row:
                seen_for_row.add(iso3)
                counts[iso3] = counts.get(iso3, 0) + 1

    rows_written = 0
    for iso3, count in counts.items():
        is_primary = count > PRIMARY_THRESHOLD
        conn.execute(
            """
            INSERT INTO sanctions (country_iso3, sanctioned_entity_count, is_primary_target, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (country_iso3) DO UPDATE SET
                sanctioned_entity_count = excluded.sanctioned_entity_count,
                is_primary_target       = excluded.is_primary_target,
                last_updated            = excluded.last_updated
            """,
            [iso3, count, is_primary, now],
        )
        rows_written += 1

    log_ingest("sanctions", "ok", rows_written)
    return rows_written


if __name__ == "__main__":
    n = run()
    print(f"Sanctions: {n} countries written")
    conn = get_conn()
    rows = conn.execute(
        "SELECT country_iso3, sanctioned_entity_count, is_primary_target FROM sanctions ORDER BY sanctioned_entity_count DESC LIMIT 10"
    ).fetchall()
    for row in rows:
        print(row)
