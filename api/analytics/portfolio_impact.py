from dataclasses import dataclass
from db import get_conn

DEMO_PORTFOLIO = {
    "SPY":  0.30, "FXI":  0.08, "EWG":  0.05, "EWJ":  0.05,
    "INDA": 0.04, "EWZ":  0.03, "TLT":  0.20, "GLD":  0.10,
    "USO":  0.05, "LQD":  0.10,
}

AUM = 1_000_000

# Beta of each position to its country ETF (or itself)
POSITION_BETAS = {
    "SPY": 1.0, "FXI": 1.0, "EWG": 1.0, "EWJ": 1.0,
    "INDA": 1.0, "EWZ": 1.0, "TLT": -0.3, "GLD": 0.1,
    "USO": 0.2, "LQD": 0.2,
}

MULTI_SHOCK_CORRELATION = 0.50


@dataclass
class PositionAttribution:
    ticker: str
    weight: float
    shock_contribution_pct: float


@dataclass
class CountryExposure:
    country: str
    portfolio_weight_exposed: float
    shock_pct: float


@dataclass
class PortfolioImpact:
    total_shock_pct: float
    total_shock_usd: float
    position_attribution: list[PositionAttribution]
    worst_country_exposures: list[CountryExposure]


def estimate_portfolio_impact(
    risk_deltas: dict[str, float],
    portfolio: dict[str, float] | None = None,
) -> PortfolioImpact:
    if portfolio is None:
        portfolio = DEMO_PORTFOLIO

    from ingest.markets import COUNTRY_ETFS
    iso3_to_ticker = COUNTRY_ETFS

    position_shocks: dict[str, float] = {}
    country_exposures: list[CountryExposure] = []

    for iso3, delta in risk_deltas.items():
        ticker = iso3_to_ticker.get(iso3)
        if not ticker or ticker not in portfolio:
            continue

        weight = portfolio[ticker]
        beta = POSITION_BETAS.get(ticker, 1.0)
        return_shock = delta / 100.0
        shock_contribution = weight * beta * return_shock
        position_shocks[ticker] = position_shocks.get(ticker, 0) + shock_contribution

        country_exposures.append(CountryExposure(
            country=iso3,
            portfolio_weight_exposed=weight,
            shock_pct=shock_contribution,
        ))

    individual_shock = sum(abs(s) for s in position_shocks.values())
    total_shock_pct = -individual_shock * (
        1.0 if len(position_shocks) <= 1
        else (1 - MULTI_SHOCK_CORRELATION) + MULTI_SHOCK_CORRELATION * len(position_shocks) ** 0.5 / len(position_shocks)
    )

    attribution = [
        PositionAttribution(ticker=t, weight=portfolio.get(t, 0), shock_contribution_pct=s)
        for t, s in position_shocks.items()
    ]
    attribution.sort(key=lambda x: abs(x.shock_contribution_pct), reverse=True)

    country_exposures.sort(key=lambda x: abs(x.shock_pct), reverse=True)

    return PortfolioImpact(
        total_shock_pct=total_shock_pct,
        total_shock_usd=total_shock_pct * AUM,
        position_attribution=attribution,
        worst_country_exposures=country_exposures[:5],
    )


def run() -> PortfolioImpact:
    conn = get_conn()
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score,
               CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3
        ) l ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()

    risk_deltas = {}
    for iso3, score, delta in risk_rows:
        if delta is not None:
            risk_deltas[iso3] = delta

    return estimate_portfolio_impact(risk_deltas)


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    impact = run()
    print(f"Total portfolio shock: {impact.total_shock_pct:.2%} (${impact.total_shock_usd:,.0f})")
    print("Position attribution:")
    for pa in impact.position_attribution:
        print(f"  {pa.ticker}: {pa.weight:.0%} weight, {pa.shock_contribution_pct:.3%} shock")
    print("Country exposures:")
    for ce in impact.worst_country_exposures:
        print(f"  {ce.country}: {ce.portfolio_weight_exposed:.0%} weight, {ce.shock_pct:.3%} shock")
