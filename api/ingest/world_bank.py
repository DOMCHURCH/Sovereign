import requests
import os
from datetime import datetime, timezone
from db import get_conn, log_ingest, utcnow

INDICATORS = {
    "NY.GDP.MKTP.CD":        "gdp_usd",
    "NY.GDP.MKTP.KD.ZG":     "gdp_growth_pct",
    "FP.CPI.TOTL.ZG":        "inflation_pct",
    "GC.DOT.TOTL.GD.ZS":     "govt_debt_pct_gdp",
    "NE.TRD.GNFS.ZS":        "trade_openness_pct_gdp",
    "PV.EST":                "political_stability_score",
    "CC.EST":                "corruption_control_score",
    "RL.EST":                "rule_of_law_score",
    "BX.KLT.DINV.WD.GD.ZS": "fdi_pct_gdp",
}

# FRED series codes for real-time US macro + key emerging markets
FRED_SERIES = {
    "CPIAUCSL":    "inflation_pct",     # US CPI
    "TOTALSA":     "gdp_usd",           # US GDP
    "A191RL1Q225SBEA": "gdp_growth_pct",  # US GDP growth
    "GFDEGDQ188S": "govt_debt_pct_gdp", # US debt
}

BASE_URL = "https://api.worldbank.org/v2"
FRED_URL = "https://api.stlouisfed.org/fred"
TARGET_YEAR = 2022  # WGI lags; 2022 is latest complete year


def fetch_indicator(indicator_code: str) -> list[dict]:
    url = (
        f"{BASE_URL}/country/all/indicator/{indicator_code}"
        f"?format=json&mrv=1&per_page=300&date={TARGET_YEAR}"
    )
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        if len(payload) < 2 or not payload[1]:
            return []
        return payload[1]
    except Exception:
        return []


def _fetch_fred(series_id: str) -> dict | None:
    """Fetch single FRED series (latest observation)."""
    fred_key = os.getenv("FRED_API_KEY", "")
    if not fred_key:
        return None
    try:
        resp = requests.get(
            f"{FRED_URL}/series/observations",
            params={
                "series_id": series_id,
                "api_key": fred_key,
                "file_type": "json",
                "limit": 1,
                "sort_order": "desc",
            },
            timeout=10,
        )
        if resp.ok:
            obs = resp.json().get("observations", [])
            if obs:
                return {"value": float(obs[0]["value"]), "date": obs[0]["date"]}
    except Exception:
        pass
    return None


def run() -> int:
    conn = get_conn()
    now = utcnow()
    rows_written = 0

    # 1. World Bank indicators (slower-moving governance/structural data)
    for code, friendly_name in INDICATORS.items():
        records = fetch_indicator(code)
        for rec in records:
            if rec.get("value") is None:
                continue
            iso3 = rec.get("countryiso3code", "")
            if not iso3 or len(iso3) != 3:
                continue
            year = int(rec["date"]) if rec.get("date") else TARGET_YEAR

            conn.execute(
                """
                INSERT INTO world_bank_indicators (country_iso3, indicator, value, year, fetched_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (country_iso3, indicator, year) DO UPDATE SET
                    value = excluded.value,
                    fetched_at = excluded.fetched_at
                """,
                [iso3, friendly_name, float(rec["value"]), year, now],
            )
            rows_written += 1

    # 2. FRED for real-time US macro data (updates daily)
    for series_id, indicator_name in FRED_SERIES.items():
        obs = _fetch_fred(series_id)
        if obs:
            try:
                import datetime as dt
                year = int(obs["date"][:4])
                conn.execute(
                    """
                    INSERT INTO world_bank_indicators (country_iso3, indicator, value, year, fetched_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (country_iso3, indicator, year) DO UPDATE SET
                        value = excluded.value,
                        fetched_at = excluded.fetched_at
                    """,
                    ["USA", indicator_name, float(obs["value"]), year, now],
                )
                rows_written += 1
            except Exception:
                pass

    log_ingest("world_bank", "ok", rows_written)
    return rows_written


if __name__ == "__main__":
    n = run()
    print(f"World Bank + FRED: {n} rows written")
    conn = get_conn()
    sample = conn.execute(
        "SELECT country_iso3, indicator, value FROM world_bank_indicators WHERE country_iso3 IN ('USA', 'CHN', 'RUS') LIMIT 10"
    ).fetchall()
    for row in sample:
        print(row)
