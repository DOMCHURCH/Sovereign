"""
Geopolitical Tension Index (GTI) — inspired by GeoPulse.
Composite fast-moving score (0–100) per country, updated every 15 minutes.
Components:
  - risk_score (35%)      from sovereign_risk table
  - conflict_activity (30%) from active conflicts touching this country
  - sentiment_pressure (20%) inverted news sentiment (negative = high GTI)
  - alert_pressure (15%)  unacknowledged alert count, log-scaled
"""
import json
import math
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

WEIGHTS = {
    "risk_score":          0.35,
    "conflict_activity":   0.30,
    "sentiment_pressure":  0.20,
    "alert_pressure":      0.15,
}

# Which conflicts touch which countries (from curated list)
# Dynamically loaded from main.py's _CONFLICTS at runtime
def _load_conflict_countries() -> dict[str, int]:
    """Returns iso3 → number of active conflicts touching that country."""
    try:
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
        from main import _CONFLICTS
        counts: dict[str, int] = {}
        for c in _CONFLICTS:
            for iso3 in c.get("countries", []):
                counts[iso3] = counts.get(iso3, 0) + (
                    3 if c["intensity"] == "major" else
                    2 if c["intensity"] == "significant" else 1
                )
        return counts
    except Exception:
        return {}


def run() -> dict[str, dict]:
    from db import get_conn, log_ingest, utcnow
    conn = get_conn()
    now = utcnow()

    # 1. Sovereign risk scores (normalized 0-100 already)
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score
        FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    risk_scores = {r[0]: float(r[1]) for r in risk_rows}

    # 2. News sentiment per country (latest)
    sent_rows = conn.execute(
        """
        SELECT ns.country_iso3, ns.sentiment_score
        FROM news_sentiment ns
        INNER JOIN (SELECT country_iso3, MAX(fetched_at) max_at FROM news_sentiment GROUP BY country_iso3) l
            ON ns.country_iso3 = l.country_iso3 AND ns.fetched_at = l.max_at
        """
    ).fetchall()
    sentiments = {r[0]: float(r[1]) for r in sent_rows}

    # 3. Alert counts per country
    alert_rows = conn.execute(
        "SELECT country_iso3, COUNT(*) cnt FROM alerts WHERE acknowledged = FALSE GROUP BY country_iso3"
    ).fetchall()
    alert_counts = {r[0]: int(r[1]) for r in alert_rows}

    # 4. Conflict activity
    conflict_counts = _load_conflict_countries()

    all_iso3 = set(risk_scores) | set(sentiments) | set(alert_counts) | set(conflict_counts)

    results: dict[str, dict] = {}

    for iso3 in all_iso3:
        risk = risk_scores.get(iso3, 50.0)

        # Conflict: map 0-10+ conflicts to 0-100
        conflicts = conflict_counts.get(iso3, 0)
        conflict_score = min(100.0, conflicts * 12.5)

        # Sentiment: -1 (very negative) to +1 (positive) → invert to 0-100
        sentiment = sentiments.get(iso3, 0.0)
        sentiment_score = (1.0 - sentiment) / 2.0 * 100  # -1→100, 0→50, +1→0

        # Alert pressure: log scale
        alerts = alert_counts.get(iso3, 0)
        alert_score = min(100.0, math.log1p(alerts) / math.log1p(10) * 100)

        gti = (
            risk              * WEIGHTS["risk_score"]
            + conflict_score  * WEIGHTS["conflict_activity"]
            + sentiment_score * WEIGHTS["sentiment_pressure"]
            + alert_score     * WEIGHTS["alert_pressure"]
        )
        gti = round(min(100.0, max(0.0, gti)), 1)

        tier = (
            "critical" if gti >= 75 else
            "high"     if gti >= 55 else
            "elevated" if gti >= 35 else
            "low"
        )

        results[iso3] = {
            "iso3": iso3,
            "gti": gti,
            "tier": tier,
            "components": {
                "risk_score":         round(risk, 1),
                "conflict_activity":  round(conflict_score, 1),
                "sentiment_pressure": round(sentiment_score, 1),
                "alert_pressure":     round(alert_score, 1),
            },
            "computed_at": now.isoformat(),
        }

        # Persist to gti_scores table
        try:
            conn.execute(
                """
                INSERT INTO gti_scores (country_iso3, gti, tier, components_json, computed_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (country_iso3) DO UPDATE SET
                    gti = excluded.gti,
                    tier = excluded.tier,
                    components_json = excluded.components_json,
                    computed_at = excluded.computed_at
                """,
                [iso3, gti, tier, json.dumps(results[iso3]["components"]), now],
            )
        except Exception:
            pass

    log_ingest("gti", "ok", len(results))
    return results


if __name__ == "__main__":
    scores = run()
    top = sorted(scores.items(), key=lambda x: x[1]["gti"], reverse=True)[:10]
    print("Top 10 GTI:")
    for iso3, d in top:
        print(f"  {iso3}: {d['gti']} ({d['tier']})")
