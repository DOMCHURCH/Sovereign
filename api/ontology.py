from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


COUNTRY_METADATA = {
    "USA": ("United States", "Americas"),
    "CHN": ("China", "Asia"),
    "JPN": ("Japan", "Asia"),
    "DEU": ("Germany", "Europe"),
    "GBR": ("United Kingdom", "Europe"),
    "IND": ("India", "Asia"),
    "BRA": ("Brazil", "Americas"),
    "RUS": ("Russia", "Europe"),
    "KOR": ("South Korea", "Asia"),
    "AUS": ("Australia", "Oceania"),
    "CAN": ("Canada", "Americas"),
    "FRA": ("France", "Europe"),
    "ITA": ("Italy", "Europe"),
    "MEX": ("Mexico", "Americas"),
    "SAU": ("Saudi Arabia", "Middle East"),
    "ZAF": ("South Africa", "Africa"),
    "SGP": ("Singapore", "Asia"),
    "HKG": ("Hong Kong", "Asia"),
    "TWN": ("Taiwan", "Asia"),
    "ARG": ("Argentina", "Americas"),
    "TUR": ("Turkey", "Europe"),
    "VEN": ("Venezuela", "Americas"),
    "CUB": ("Cuba", "Americas"),
    "BLR": ("Belarus", "Europe"),
    "PAK": ("Pakistan", "Asia"),
    "AFG": ("Afghanistan", "Asia"),
    "UKR": ("Ukraine", "Europe"),
    "NGA": ("Nigeria", "Africa"),
    "EGY": ("Egypt", "Middle East"),
    "ISR": ("Israel", "Middle East"),
    "IRQ": ("Iraq", "Middle East"),
    "LBY": ("Libya", "Middle East"),
    "YEM": ("Yemen", "Middle East"),
    "ETH": ("Ethiopia", "Africa"),
    "MMR": ("Myanmar", "Asia"),
    "SDN": ("Sudan", "Africa"),
    "ZWE": ("Zimbabwe", "Africa"),
    "NIC": ("Nicaragua", "Americas"),
    "LBN": ("Lebanon", "Middle East"),
    "IRN": ("Iran", "Middle East"),
    "PRK": ("North Korea", "Asia"),
    "SYR": ("Syria", "Middle East"),
    "NLD": ("Netherlands", "Europe"),
    "ESP": ("Spain", "Europe"),
    "CHE": ("Switzerland", "Europe"),
    "SWE": ("Sweden", "Europe"),
    "NOR": ("Norway", "Europe"),
    "POL": ("Poland", "Europe"),
    "IDN": ("Indonesia", "Asia"),
    "MYS": ("Malaysia", "Asia"),
    "THA": ("Thailand", "Asia"),
    "VNM": ("Vietnam", "Asia"),
    "PHL": ("Philippines", "Asia"),
    "BGD": ("Bangladesh", "Asia"),
    "COL": ("Colombia", "Americas"),
    "CHL": ("Chile", "Americas"),
    "PER": ("Peru", "Americas"),
    "KEN": ("Kenya", "Africa"),
    "GHA": ("Ghana", "Africa"),
    "TZA": ("Tanzania", "Africa"),
    "AGO": ("Angola", "Africa"),
    "DZA": ("Algeria", "Middle East"),
    "MAR": ("Morocco", "Middle East"),
    "QAT": ("Qatar", "Middle East"),
    "ARE": ("United Arab Emirates", "Middle East"),
    "KWT": ("Kuwait", "Middle East"),
    "OMN": ("Oman", "Middle East"),
    "JOR": ("Jordan", "Middle East"),
    "AZE": ("Azerbaijan", "Europe"),
    "KAZ": ("Kazakhstan", "Asia"),
    "UZB": ("Uzbekistan", "Asia"),
}


@dataclass
class Country:
    iso3: str
    name: str
    region: str

    # Macro
    gdp_usd: Optional[float] = None
    gdp_growth_pct: Optional[float] = None
    inflation_pct: Optional[float] = None
    govt_debt_pct_gdp: Optional[float] = None
    trade_openness: Optional[float] = None

    # Governance
    political_stability_score: Optional[float] = None  # -2.5 to +2.5
    corruption_control_score: Optional[float] = None
    rule_of_law_score: Optional[float] = None

    # Market signals
    equity_return_1y: Optional[float] = None
    equity_volatility_21d: Optional[float] = None
    news_sentiment_7d: Optional[float] = None

    # Sanctions
    sanctions_entity_count: int = 0
    is_primary_sanctions_target: bool = False

    # Derived
    sovereign_risk_score: Optional[float] = None
    risk_tier: Optional[str] = None
    risk_delta_7d: Optional[float] = None
    top_risk_drivers: list[str] = field(default_factory=list)


@dataclass
class ContagionEdge:
    source_country: str
    target_country: str
    transmission_weight: float
    channel: str


@dataclass
class RiskAlert:
    id: str
    country_iso3: str
    severity: str
    trigger: str
    message: str
    contagion_risk: list[str]
    portfolio_impact_pct: Optional[float]
    created_at: datetime
    acknowledged: bool


def hydrate_countries(conn) -> list[Country]:
    countries = []

    wb_rows = conn.execute(
        "SELECT country_iso3, indicator, value FROM world_bank_indicators"
    ).fetchall()
    wb: dict[str, dict[str, float]] = {}
    for iso3, indicator, value in wb_rows:
        if iso3 not in wb:
            wb[iso3] = {}
        if value is not None:
            wb[iso3][indicator] = value

    sanction_rows = conn.execute(
        "SELECT country_iso3, sanctioned_entity_count, is_primary_target FROM sanctions"
    ).fetchall()
    sanctions: dict[str, tuple[int, bool]] = {r[0]: (r[1], bool(r[2])) for r in sanction_rows}

    market_rows = conn.execute(
        """
        SELECT mr.ticker, mr.cumulative_1y, mr.volatility_21d
        FROM market_returns mr
        INNER JOIN (
            SELECT ticker, MAX(date) AS max_date FROM market_returns GROUP BY ticker
        ) latest ON mr.ticker = latest.ticker AND mr.date = latest.max_date
        """
    ).fetchall()
    from ingest.markets import COUNTRY_ETFS
    ticker_to_iso3 = {v: k for k, v in COUNTRY_ETFS.items()}
    market: dict[str, tuple[float, float]] = {}
    for ticker, ret_1y, vol_21d in market_rows:
        iso3 = ticker_to_iso3.get(ticker)
        if iso3:
            market[iso3] = (ret_1y, vol_21d)

    news_rows = conn.execute(
        """
        SELECT ns.country_iso3, ns.sentiment_score
        FROM news_sentiment ns
        INNER JOIN (
            SELECT country_iso3, MAX(fetched_at) AS max_at FROM news_sentiment GROUP BY country_iso3
        ) latest ON ns.country_iso3 = latest.country_iso3 AND ns.fetched_at = latest.max_at
        """
    ).fetchall()
    news: dict[str, float] = {r[0]: r[1] for r in news_rows}

    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) AS max_at FROM sovereign_risk GROUP BY country_iso3
        ) latest ON sr.country_iso3 = latest.country_iso3 AND sr.computed_at = latest.max_at
        """
    ).fetchall()
    risk: dict[str, tuple[float, str]] = {r[0]: (r[1], r[2]) for r in risk_rows}

    # Build from known metadata union with any iso3 seen in DB
    all_iso3s = set(COUNTRY_METADATA.keys()) | set(wb.keys()) | set(sanctions.keys())

    for iso3 in all_iso3s:
        meta = COUNTRY_METADATA.get(iso3)
        if not meta:
            continue
        name, region = meta

        s_count, s_primary = sanctions.get(iso3, (0, False))
        mkt = market.get(iso3)
        r = risk.get(iso3)

        c = Country(
            iso3=iso3,
            name=name,
            region=region,
            gdp_usd=wb.get(iso3, {}).get("gdp_usd"),
            gdp_growth_pct=wb.get(iso3, {}).get("gdp_growth_pct"),
            inflation_pct=wb.get(iso3, {}).get("inflation_pct"),
            govt_debt_pct_gdp=wb.get(iso3, {}).get("govt_debt_pct_gdp"),
            trade_openness=wb.get(iso3, {}).get("trade_openness_pct_gdp"),
            political_stability_score=wb.get(iso3, {}).get("political_stability_score"),
            corruption_control_score=wb.get(iso3, {}).get("corruption_control_score"),
            rule_of_law_score=wb.get(iso3, {}).get("rule_of_law_score"),
            equity_return_1y=mkt[0] if mkt else None,
            equity_volatility_21d=mkt[1] if mkt else None,
            news_sentiment_7d=news.get(iso3),
            sanctions_entity_count=s_count,
            is_primary_sanctions_target=s_primary,
            sovereign_risk_score=r[0] if r else None,
            risk_tier=r[1] if r else None,
        )
        countries.append(c)

    return countries


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from db import get_conn
    conn = get_conn()
    countries = hydrate_countries(conn)
    print(f"Hydrated {len(countries)} countries")
    for c in sorted(countries, key=lambda x: x.name)[:5]:
        print(f"  {c.iso3} {c.name}: risk={c.sovereign_risk_score} tier={c.risk_tier} stability={c.political_stability_score}")
