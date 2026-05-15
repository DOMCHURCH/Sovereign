import io
import csv
import requests
from datetime import datetime, timezone
from db import get_conn, log_ingest

SDN_URL = "https://ofac.treasury.gov/downloads/sdn.csv"

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
}

PRIMARY_THRESHOLD = 50


def run() -> int:
    conn = get_conn()
    now = datetime.now(timezone.utc)

    try:
        resp = requests.get(SDN_URL, timeout=60)
        resp.raise_for_status()
        content = resp.content.decode("latin-1")
    except Exception as e:
        log_ingest("sanctions", "error", 0, str(e))
        return 0

    counts: dict[str, int] = {}

    reader = csv.reader(io.StringIO(content))
    for row in reader:
        if len(row) < 5:
            continue
        country_field = row[4].strip().upper() if row[4] else ""
        iso3 = COUNTRY_MAP.get(country_field)
        if iso3:
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
