import json
import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta
from db import get_conn, utcnow

WEIGHTS = {
    "political_instability":   0.25,  # WGI PV.EST: lower score → higher instability
    "macro_stress":            0.20,  # inflation + debt z-scores averaged
    "market_stress":           0.20,  # realized vol + negative return momentum
    "sanctions_exposure":      0.15,  # entity count percentile + primary flag uplift
    "governance_deficit":      0.10,  # corruption + rule_of_law, inverted
    "sentiment_deterioration": 0.10,  # news polarity, inverted
}

assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"


def _norm_to_100(series: pd.Series) -> pd.Series:
    lo, hi = series.min(), series.max()
    if hi == lo:
        return pd.Series(50.0, index=series.index)
    return (series - lo) / (hi - lo) * 100


def _tier(score: float) -> str:
    if score <= 25:
        return "low"
    if score <= 50:
        return "elevated"
    if score <= 75:
        return "high"
    return "severe"


def run() -> dict[str, float]:
    conn = get_conn()
    now = utcnow()

    wb = conn.execute(
        "SELECT country_iso3, indicator, value FROM world_bank_indicators"
    ).fetchall()
    wb_df = pd.DataFrame(wb, columns=["iso3", "indicator", "value"])
    wb_wide = wb_df.pivot_table(index="iso3", columns="indicator", values="value", aggfunc="last")

    sanctions = conn.execute(
        "SELECT country_iso3, sanctioned_entity_count, is_primary_target FROM sanctions"
    ).fetchall()
    sanc_df = pd.DataFrame(sanctions, columns=["iso3", "entity_count", "is_primary"]).set_index("iso3")

    market_rows = conn.execute(
        """
        SELECT mr.ticker, mr.cumulative_1y, mr.volatility_21d
        FROM market_returns mr
        INNER JOIN (SELECT ticker, MAX(date) max_date FROM market_returns GROUP BY ticker) l
            ON mr.ticker = l.ticker AND mr.date = l.max_date
        """
    ).fetchall()
    from ingest.markets import COUNTRY_ETFS
    ticker_to_iso3 = {v: k for k, v in COUNTRY_ETFS.items()}
    mkt_data = {ticker_to_iso3[t]: (r, v) for t, r, v in market_rows if t in ticker_to_iso3}

    news_rows = conn.execute(
        """
        SELECT ns.country_iso3, ns.sentiment_score
        FROM news_sentiment ns
        INNER JOIN (SELECT country_iso3, MAX(fetched_at) max_at FROM news_sentiment GROUP BY country_iso3) l
            ON ns.country_iso3 = l.country_iso3 AND ns.fetched_at = l.max_at
        """
    ).fetchall()
    news = {r[0]: r[1] for r in news_rows}

    all_iso3 = set(wb_wide.index) | set(sanc_df.index) | set(mkt_data.keys()) | set(news.keys())

    records = []
    for iso3 in all_iso3:
        wb_row = wb_wide.loc[iso3] if iso3 in wb_wide.index else pd.Series(dtype=float)
        records.append({
            "iso3": iso3,
            "political_stability": wb_row.get("political_stability_score", np.nan),
            "inflation": wb_row.get("inflation_pct", np.nan),
            "debt": wb_row.get("govt_debt_pct_gdp", np.nan),
            "corruption": wb_row.get("corruption_control_score", np.nan),
            "rule_of_law": wb_row.get("rule_of_law_score", np.nan),
            "equity_ret": mkt_data.get(iso3, (np.nan, np.nan))[0],
            "equity_vol": mkt_data.get(iso3, (np.nan, np.nan))[1],
            "entity_count": sanc_df.loc[iso3, "entity_count"] if iso3 in sanc_df.index else 0,
            "is_primary": sanc_df.loc[iso3, "is_primary"] if iso3 in sanc_df.index else False,
            "sentiment": news.get(iso3, 0.0),
        })

    df = pd.DataFrame(records).set_index("iso3")

    # Sub-score computations (each normalized 0–100, higher = riskier)

    # Political instability: WGI is -2.5 (unstable) to +2.5 (stable) → invert
    df["sub_political"] = _norm_to_100(-df["political_stability"].fillna(-2.5))

    # Macro stress: z-score inflation + z-score debt, averaged
    df["z_inflation"] = (df["inflation"] - df["inflation"].mean()) / (df["inflation"].std() + 1e-9)
    df["z_debt"] = (df["debt"] - df["debt"].mean()) / (df["debt"].std() + 1e-9)
    df["macro_raw"] = (df["z_inflation"] + df["z_debt"]) / 2
    df["sub_macro"] = _norm_to_100(df["macro_raw"].fillna(0))

    # Market stress: high vol + negative returns both bad
    df["equity_vol_f"] = df["equity_vol"].fillna(df["equity_vol"].median())
    df["equity_ret_f"] = df["equity_ret"].fillna(0)
    df["market_raw"] = df["equity_vol_f"] - df["equity_ret_f"]  # high vol and negative ret → high stress
    df["sub_market"] = _norm_to_100(df["market_raw"])

    # Sanctions exposure: entity count percentile + 25pt uplift for primary target
    df["entity_pct"] = df["entity_count"].rank(pct=True) * 100
    df["sub_sanctions"] = (df["entity_pct"] + df["is_primary"].astype(float) * 25).clip(0, 100)

    # Governance deficit: invert corruption + rule_of_law (higher WGI = better governance)
    df["gov_raw"] = -(df["corruption"].fillna(0) + df["rule_of_law"].fillna(0)) / 2
    df["sub_governance"] = _norm_to_100(df["gov_raw"])

    # Sentiment deterioration: negative polarity → high score
    df["sub_sentiment"] = _norm_to_100(-df["sentiment"].fillna(0))

    df["score"] = (
        df["sub_political"] * WEIGHTS["political_instability"]
        + df["sub_macro"] * WEIGHTS["macro_stress"]
        + df["sub_market"] * WEIGHTS["market_stress"]
        + df["sub_sanctions"] * WEIGHTS["sanctions_exposure"]
        + df["sub_governance"] * WEIGHTS["governance_deficit"]
        + df["sub_sentiment"] * WEIGHTS["sentiment_deterioration"]
    )

    # Get the earliest score for each country from the past 7-10 day window
    # so delta reflects the change since ~1 week ago, not the most recent run
    # Bind datetimes, not ISO strings: DuckDB will not compare TIMESTAMP to VARCHAR and
    # raises BinderException, which previously aborted the entire scoring run.
    week_ago = now - timedelta(days=7)
    ten_days_ago = now - timedelta(days=10)
    old_scores_rows = conn.execute(
        """
        SELECT country_iso3, score FROM sovereign_risk
        WHERE computed_at BETWEEN ? AND ?
        ORDER BY computed_at ASC
        """,
        [ten_days_ago, week_ago],
    ).fetchall()
    old_scores = {}
    for iso3, s in old_scores_rows:
        if iso3 not in old_scores:  # keep the earliest (ASC), not overwrite
            old_scores[iso3] = s

    scores_out: dict[str, float] = {}

    for iso3, row in df.iterrows():
        score = float(row["score"])
        tier = _tier(score)
        # No snapshot in the 7-10 day window means there is no baseline to compare
        # against — which is NOT the same as "no change". Defaulting the baseline to the
        # current score produced a confident 0.00 for every country and made the whole
        # platform read as frozen. Emit null and let the UI say so.
        baseline = old_scores.get(iso3)
        delta = None if baseline is None else round(score - baseline, 2)

        sub_scores = {
            "political_instability": round(float(row["sub_political"]), 1),
            "macro_stress": round(float(row["sub_macro"]), 1),
            "market_stress": round(float(row["sub_market"]), 1),
            "sanctions_exposure": round(float(row["sub_sanctions"]), 1),
            "governance_deficit": round(float(row["sub_governance"]), 1),
            "sentiment_deterioration": round(float(row["sub_sentiment"]), 1),
            "delta_7d": delta,
        }

        conn.execute(
            """
            INSERT INTO sovereign_risk (country_iso3, score, tier, sub_scores_json, computed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [iso3, score, tier, json.dumps(sub_scores), now],
        )
        scores_out[iso3] = score

    return scores_out


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    scores = run()
    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    print("Top 10 riskiest:")
    for iso3, score in sorted_scores[:10]:
        print(f"  {iso3}: {score:.1f}")
    print("\nLowest risk:")
    for iso3, score in sorted_scores[-5:]:
        print(f"  {iso3}: {score:.1f}")
