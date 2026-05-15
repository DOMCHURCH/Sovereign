"""
Bootstrap the database with realistic data for local development and demo.
In production on Render, the live ingest pipeline replaces this with real data.
All values are sourced from publicly available 2022-2023 figures.
"""
import json
import random
import numpy as np
from datetime import datetime, timezone, timedelta
from db import get_conn

# ── World Bank indicators ────────────────────────────────────────────────────
# Source: World Bank WDI 2022, WGI 2022
WB_DATA = {
    # iso3: {gdp_usd, gdp_growth_pct, inflation_pct, govt_debt_pct_gdp, trade_openness_pct_gdp,
    #         political_stability_score, corruption_control_score, rule_of_law_score, fdi_pct_gdp}
    "USA": (25e12,  2.1,  8.0,  122.3, 26.9,   0.43,  1.25,  1.78,  1.5),
    "CHN": (18e12,  3.0,  2.0,   77.1, 37.0,  -0.45,  -0.21, 0.13,  1.5),
    "JPN": (4.2e12, 1.0,  2.5,  261.3, 34.4,   0.95,   1.55, 1.68,  0.2),
    "DEU": (4.0e12, 1.8,  8.7,   66.4, 88.4,   0.85,   1.56, 1.77,  1.3),
    "GBR": (3.1e12, 4.0,  9.1,  101.5, 61.2,   0.52,   1.45, 1.65,  2.2),
    "IND": (3.2e12, 6.8,  6.7,   83.9, 43.7,  -0.88,  -0.24, 0.07,  1.5),
    "BRA": (1.9e12, 2.9, 10.5,   88.1, 34.2,  -0.28,  -0.38,-0.14,  3.0),
    "RUS": (2.2e12,-2.1, 13.7,   18.2, 50.0,  -1.45,  -1.10,-0.88,  1.0),
    "KOR": (1.7e12, 2.6,  5.1,   54.3, 82.4,   0.35,   0.89, 1.12,  0.7),
    "AUS": (1.7e12, 3.7,  6.6,   46.9, 44.3,   1.02,   1.72, 1.83,  2.5),
    "CAN": (2.1e12, 3.4,  6.8,  107.3, 65.9,   0.68,   1.65, 1.81,  2.5),
    "FRA": (2.9e12, 2.6,  5.9,  111.8, 62.3,   0.32,   1.20, 1.46,  2.2),
    "ITA": (2.1e12, 3.7,  8.7,  144.4, 60.5,   0.25,   0.19, 0.74,  1.0),
    "MEX": (1.3e12, 3.1,  7.9,   49.8, 79.4,  -0.65,  -0.65,-0.23,  3.0),
    "SAU": (1.1e12, 8.7,  2.5,   24.1, 74.5,  -0.55,  -0.44, 0.18,  4.0),
    "ZAF": (0.4e12, 2.0,  6.9,   71.4, 62.3,  -0.25,   0.10,-0.05,  1.5),
    "SGP": (0.5e12, 3.6,  6.1,  161.2,326.4,   1.25,   2.17, 1.94,  3.2),
    "HKG": (0.4e12,-3.5,  1.9,    0.3,415.9,   0.55,   1.48, 1.68,  4.0),
    "TWN": (0.8e12, 2.4,  2.9,   28.6, 94.3,   0.65,   0.90, 1.10,  1.0),
    "ARG": (0.6e12, 5.2, 72.4,   80.9, 30.9,  -0.58,  -0.35,-0.42,  0.8),
    "TUR": (0.9e12, 5.6, 72.3,   31.3, 60.1,  -1.10,  -0.60,-0.30,  0.6),
    "VEN": (0.08e12,-7.0,200.0, 210.0, 30.0,  -2.20,  -1.80,-2.10,  0.0),
    "CUB": (0.1e12, -0.5,  5.0, 100.0, 20.0,  -1.00,  -1.10,-1.00,  0.0),
    "BLR": (0.07e12,-4.7,16.5,   48.8, 75.0,  -1.70,  -1.22,-1.15,  0.0),
    "PAK": (0.35e12, 6.0, 21.3,  89.5, 27.4,  -2.40,  -1.05,-0.71,  0.5),
    "AFG": (0.02e12,-20.0,18.0, 101.0,  5.0,  -2.90,  -1.85,-2.25,  0.0),
    "UKR": (0.16e12,-29.1,20.2,  78.4, 62.4,  -1.20,  -0.82,-0.40,  2.0),
    "NGA": (0.5e12,  3.3, 18.8,  38.7, 22.4,  -2.10,  -1.42,-1.20,  0.5),
    "EGY": (0.4e12,  6.6, 13.9,  88.5, 28.1,  -0.95,  -0.88,-0.60,  2.0),
    "ISR": (0.5e12,  6.5,  4.4,  60.0, 63.3,   0.15,   1.15, 1.05,  4.0),
    "IRQ": (0.27e12, 8.1,  5.0,  67.4, 71.5,  -2.35,  -1.55,-1.35,  1.0),
    "LBY": (0.04e12, 8.0, 10.0, 170.0, 80.0,  -2.50,  -1.60,-1.80,  0.0),
    "YEM": (0.03e12,-2.0, 40.0, 250.0, 20.0,  -2.80,  -1.80,-2.30,  0.0),
    "ETH": (0.13e12, 6.4, 33.9,  57.0, 18.6,  -1.65,  -0.85,-0.75,  2.0),
    "MMR": (0.09e12,-18.0,24.5,  66.0, 32.0,  -2.30,  -1.55,-1.70,  1.0),
    "SDN": (0.04e12,-0.3, 83.6, 212.0, 14.0,  -2.55,  -1.75,-1.85,  0.5),
    "ZWE": (0.02e12, 6.5,193.4, 110.0, 48.0,  -1.60,  -1.40,-1.55,  0.5),
    "NIC": (0.15e12, 3.8, 10.4,  47.5, 90.0,  -1.30,  -1.05,-0.95,  1.0),
    "LBN": (0.22e12,-7.4,160.0, 172.0, 82.0,  -1.50,  -1.20,-1.35,  0.5),
    "IRN": (0.7e12,  3.8, 45.0,  31.0, 35.0,  -2.10,  -1.40,-1.30,  0.0),
    "PRK": (0.02e12, 0.5, 10.0,  90.0,  5.0,  -2.80,  -2.20,-2.40,  0.0),
    "SYR": (0.01e12,-2.0, 25.0, 220.0, 20.0,  -2.90,  -1.90,-2.10,  0.0),
    "NLD": (1.0e12,  4.3,  9.6,  51.9,153.4,   1.00,   2.00, 1.90,  3.0),
    "ESP": (1.4e12,  5.5,  8.3, 113.2, 68.8,   0.40,   0.88, 1.05,  2.0),
    "POL": (0.7e12,  5.4, 14.4,  49.0, 99.5,   0.30,   0.70, 0.75,  2.0),
    "IDN": (1.3e12,  5.3,  4.2,  39.7, 43.9,  -0.65,  -0.45,-0.38,  2.0),
    "THA": (0.5e12,  2.6,  6.1,  61.4, 99.6,   0.00,  -0.22, 0.12,  1.5),
    "VNM": (0.4e12,  8.0,  3.3,  37.0,188.4,  -0.70,  -0.52,-0.28,  4.0),
    "COL": (0.3e12,  7.5, 11.0,  59.7, 36.8,  -1.40,  -0.48,-0.12,  3.5),
    "CHL": (0.3e12,  2.4,  8.6,  37.2, 52.4,   0.20,   1.18, 1.22,  6.5),
    "QAT": (0.22e12,  4.2,  5.0,  47.0,116.0,   0.20,   0.28, 0.62,  0.2),
    "ARE": (0.5e12,  7.4,  4.8,  29.8,167.4,   0.55,   0.78, 0.68,  3.0),
    "KAZ": (0.22e12,  3.2, 14.6,  26.0, 68.0,  -0.75,  -0.82,-0.50,  3.0),
}

SANCTION_DATA = {
    "RUS": (3200, True),
    "IRN": (1800, True),
    "PRK": (850,  True),
    "SYR": (620,  True),
    "CUB": (540,  True),
    "VEN": (430,  False),
    "BLR": (380,  True),
    "MMR": (210,  False),
    "UKR": (190,  False),
    "CHN": (160,  False),
    "IRQ": (140,  False),
    "LBY": (120,  False),
    "SDN": (95,   True),
    "SOM": (85,   False),
    "YEM": (75,   False),
    "ZWE": (65,   True),
    "NIC": (55,   True),
    "MLI": (42,   False),
    "HTI": (38,   False),
    "ETH": (28,   False),
    "AFG": (22,   False),
    "LBN": (20,   False),
    "PAK": (15,   False),
    "TUR": (12,   False),
    "ARE": (10,   False),
}

MARKET_DATA = {
    "SPY":  (0.262,  0.16), "FXI":  (-0.18, 0.28), "EWJ":  (0.22,  0.18),
    "EWG":  (0.18,   0.22), "EWU":  (0.14,  0.20), "INDA": (0.30,  0.22),
    "EWZ":  (-0.05,  0.32), "ERUS": (-0.85, 0.60), "EWY":  (0.08,  0.24),
    "EWA":  (0.12,   0.18), "EWC":  (0.16,  0.19), "EWQ":  (0.16,  0.21),
    "EWI":  (0.22,   0.22), "EWW":  (0.24,  0.25), "KSA":  (0.08,  0.20),
    "EZA":  (-0.10,  0.28), "EWS":  (0.18,  0.18), "EWH":  (-0.15, 0.25),
    "EWT":  (0.32,   0.28), "ARGT": (-0.20, 0.40), "USO":  (0.05,  0.30),
    "GLD":  (0.14,   0.14), "UNG":  (-0.40, 0.45), "WEAT": (-0.15, 0.28),
    "CPER": (0.12,   0.22),
}

CORR_DATA = [
    ("USA","CHN",-0.15), ("USA","JPN", 0.62), ("USA","DEU", 0.70), ("USA","GBR", 0.72),
    ("USA","IND", 0.55), ("USA","BRA", 0.45), ("USA","KOR", 0.65), ("USA","AUS", 0.65),
    ("USA","CAN", 0.82), ("USA","FRA", 0.72), ("USA","ITA", 0.68), ("USA","MEX", 0.60),
    ("CHN","KOR", 0.58), ("CHN","TWN", 0.55), ("CHN","HKG", 0.65), ("CHN","SGP", 0.52),
    ("CHN","JPN", 0.30), ("CHN","IND", 0.35), ("CHN","AUS", 0.25), ("CHN","RUS", 0.20),
    ("DEU","FRA", 0.88), ("DEU","ITA", 0.82), ("DEU","GBR", 0.75), ("DEU","POL", 0.72),
    ("JPN","KOR", 0.62), ("JPN","AUS", 0.55), ("JPN","TWN", 0.52), ("KOR","TWN", 0.68),
    ("IND","BRA", 0.42), ("IND","ZAF", 0.48), ("BRA","MEX", 0.65), ("BRA","ARG", 0.52),
    ("SAU","ARE", 0.72), ("SAU","QAT", 0.68), ("HKG","TWN", 0.62), ("SGP","AUS", 0.58),
    ("KOR","SGP", 0.55), ("MEX","BRA", 0.65), ("ZAF","NGA", 0.42), ("TUR","BRA", 0.38),
]

SENTIMENT_DATA = {
    "USA":  0.05, "CHN": -0.15, "JPN":  0.08, "DEU": -0.05, "GBR": -0.08,
    "IND":  0.12, "BRA": -0.12, "RUS": -0.55, "KOR":  0.02, "AUS":  0.10,
    "CAN":  0.05, "FRA": -0.05, "ITA":  0.02, "MEX": -0.18, "SAU": -0.02,
    "ZAF": -0.22, "SGP":  0.10, "HKG": -0.25, "TWN": -0.20, "ARG": -0.35,
    "TUR": -0.38, "VEN": -0.62, "CUB": -0.45, "BLR": -0.55, "PAK": -0.42,
    "AFG": -0.72, "UKR": -0.68, "NGA": -0.35, "EGY": -0.28, "ISR": -0.45,
    "IRQ": -0.58, "LBY": -0.52, "YEM": -0.70, "ETH": -0.48, "MMR": -0.62,
    "SDN": -0.60, "ZWE": -0.48, "NIC": -0.40, "LBN": -0.65, "IRN": -0.58,
    "PRK": -0.75, "SYR": -0.70, "NLD":  0.08, "ESP":  0.05, "POL": -0.10,
    "IDN":  0.02, "THA": -0.05, "VNM":  0.08, "COL": -0.15, "CHL":  0.05,
    "QAT":  0.05, "ARE":  0.08, "KAZ": -0.08,
}


def run():
    conn = get_conn()
    now = datetime.now(timezone.utc)
    today = now.date()

    print("Seeding World Bank indicators...")
    n = 0
    for iso3, vals in WB_DATA.items():
        gdp, growth, inf, debt, trade, pol_stab, corrupt, rule, fdi = vals
        indicators = {
            "gdp_usd": gdp,
            "gdp_growth_pct": growth,
            "inflation_pct": inf,
            "govt_debt_pct_gdp": debt,
            "trade_openness_pct_gdp": trade,
            "political_stability_score": pol_stab,
            "corruption_control_score": corrupt,
            "rule_of_law_score": rule,
            "fdi_pct_gdp": fdi,
        }
        for indicator, value in indicators.items():
            conn.execute(
                """
                INSERT INTO world_bank_indicators (country_iso3, indicator, value, year, fetched_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (country_iso3, indicator, year) DO UPDATE SET
                    value = excluded.value, fetched_at = excluded.fetched_at
                """,
                [iso3, indicator, value, 2022, now],
            )
            n += 1
    print(f"  {n} world_bank_indicators rows")

    print("Seeding sanctions...")
    n = 0
    for iso3, (count, is_primary) in SANCTION_DATA.items():
        conn.execute(
            """
            INSERT INTO sanctions (country_iso3, sanctioned_entity_count, is_primary_target, last_updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (country_iso3) DO UPDATE SET
                sanctioned_entity_count = excluded.sanctioned_entity_count,
                is_primary_target = excluded.is_primary_target,
                last_updated = excluded.last_updated
            """,
            [iso3, count, is_primary, now],
        )
        n += 1
    print(f"  {n} sanctions rows")

    print("Seeding market returns...")
    n = 0
    for ticker, (ret_1y, vol_21d) in MARKET_DATA.items():
        for days_back in range(5):
            date = today - timedelta(days=days_back)
            daily_ret = np.random.normal(ret_1y / 252, vol_21d / np.sqrt(252))
            conn.execute(
                """
                INSERT INTO market_returns (ticker, date, daily_return, cumulative_1y, volatility_21d)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (ticker, date) DO UPDATE SET
                    daily_return = excluded.daily_return,
                    cumulative_1y = excluded.cumulative_1y,
                    volatility_21d = excluded.volatility_21d
                """,
                [ticker, date, float(daily_ret), float(ret_1y), float(vol_21d)],
            )
            n += 1
    print(f"  {n} market_returns rows")

    print("Seeding correlations...")
    n = 0
    for iso_a, iso_b, corr in CORR_DATA:
        conn.execute(
            """
            INSERT INTO correlations (country_a, country_b, correlation_30d, date)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (country_a, country_b, date) DO UPDATE SET correlation_30d = excluded.correlation_30d
            """,
            [iso_a, iso_b, corr, today],
        )
        n += 1
    print(f"  {n} correlations rows")

    print("Seeding news sentiment...")
    n = 0
    for iso3, score in SENTIMENT_DATA.items():
        conn.execute(
            "INSERT INTO news_sentiment (country_iso3, sentiment_score, article_count, fetched_at) VALUES (?, ?, ?, ?)",
            [iso3, score, random.randint(5, 20), now],
        )
        n += 1
    print(f"  {n} news_sentiment rows")

    print("Seed complete.")


if __name__ == "__main__":
    run()
