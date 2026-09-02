import json
import uuid
from datetime import datetime, timezone
from db import get_conn, utcnow

RULES = [
    {
        "id": "score_spike",
        "severity": "warning",
        "msg": "{country} risk rose {delta:.1f}pts in 7 days",
    },
    {
        "id": "severe_tier",
        "severity": "critical",
        "msg": "{country} entered SEVERE tier (score {score:.0f}/100)",
    },
    {
        "id": "sanctions_new",
        "severity": "critical",
        "msg": "{country} OFAC SDN list: {count} sanctioned entities",
    },
    {
        "id": "sentiment_crash",
        "severity": "warning",
        "msg": "{country} news sentiment severely negative ({score:.2f})",
    },
    {
        "id": "contagion_watch",
        "severity": "watch",
        "msg": "{country} contagion risk from {epicenter} (+{shock:.0f}pts)",
    },
    {
        "id": "portfolio_impact",
        "severity": "warning",
        "msg": "Portfolio: est. {shock:.1%} P&L impact from {country} exposure",
    },
]


def run() -> int:
    conn = get_conn()
    now = utcnow()

    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier,
               CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d,
               CAST(json_extract(sr.sub_scores_json, '$.sentiment_deterioration') AS DOUBLE) AS sent_sub
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3
        ) l ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()

    sanctions_rows = conn.execute(
        "SELECT country_iso3, sanctioned_entity_count, is_primary_target FROM sanctions"
    ).fetchall()
    sanctions = {r[0]: (r[1], bool(r[2])) for r in sanctions_rows}

    news_rows = conn.execute(
        """
        SELECT ns.country_iso3, ns.sentiment_score
        FROM news_sentiment ns
        INNER JOIN (SELECT country_iso3, MAX(fetched_at) max_at FROM news_sentiment GROUP BY country_iso3) l
            ON ns.country_iso3 = l.country_iso3 AND ns.fetched_at = l.max_at
        """
    ).fetchall()
    news = {r[0]: r[1] for r in news_rows}

    contagion_rows = conn.execute(
        """
        SELECT ce.source_country, ce.target_country, ce.transmission_weight, ce.channel
        FROM contagion_edges ce
        INNER JOIN (SELECT source_country, MAX(computed_at) max_at FROM contagion_edges GROUP BY source_country) l
            ON ce.source_country = l.source_country AND ce.computed_at = l.max_at
        """
    ).fetchall()

    risk_lookup = {r[0]: {"score": r[1], "tier": r[2], "delta": r[3]} for r in risk_rows}

    from ontology import COUNTRY_METADATA
    name_map = {k: v[0] for k, v in COUNTRY_METADATA.items()}

    alerts_written = 0

    def write_alert(iso3: str, rule_id: str, severity: str, msg: str, contagion: list[str], port_impact: float | None):
        nonlocal alerts_written
        alert_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO alerts (id, country_iso3, severity, trigger, message, contagion_risk_json, portfolio_impact_pct, created_at, acknowledged)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)
            """,
            [alert_id, iso3, severity, rule_id, msg, json.dumps(contagion), port_impact, now],
        )
        alerts_written += 1

    # Clear today's alerts to avoid duplicates on re-run
    conn.execute("DELETE FROM alerts WHERE created_at >= CURRENT_DATE::TIMESTAMP")

    for iso3, score, tier, delta, sent_sub in risk_rows:
        name = name_map.get(iso3, iso3)
        r = risk_lookup.get(iso3, {})

        # Score spike
        if delta is not None and delta > 10:
            write_alert(iso3, "score_spike", "warning",
                        f"{name} risk rose {delta:.1f}pts in 7 days", [], None)

        # Severe tier
        if tier == "severe":
            write_alert(iso3, "severe_tier", "critical",
                        f"{name} entered SEVERE tier (score {score:.0f}/100)", [], None)

        # Sanctions
        s_count, s_primary = sanctions.get(iso3, (0, False))
        if s_primary:
            write_alert(iso3, "sanctions_new", "critical",
                        f"{name} OFAC SDN list: {s_count} sanctioned entities", [], None)

        # Sentiment crash
        sentiment = news.get(iso3, 0.0)
        if sentiment is not None and sentiment < -0.4:
            write_alert(iso3, "sentiment_crash", "warning",
                        f"{name} news sentiment severely negative ({sentiment:.2f})", [], None)

    # Contagion watch — propagate from severe/high countries
    severe_countries = [r[0] for r in risk_rows if r[2] in ("severe", "high")]
    for epicenter in severe_countries[:5]:
        ep_risk = risk_lookup.get(epicenter, {})
        ep_score = ep_risk.get("score", 0)
        for src, dst, weight, channel in contagion_rows:
            if src != epicenter:
                continue
            shock = ep_score * 0.6 * weight
            if shock > 15:
                dst_name = name_map.get(dst, dst)
                ep_name = name_map.get(epicenter, epicenter)
                write_alert(dst, "contagion_watch", "watch",
                            f"{dst_name} contagion risk from {ep_name} (+{shock:.0f}pts)",
                            [epicenter], None)

    return alerts_written


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    n = run()
    print(f"Alerts written: {n}")
    conn = get_conn()
    rows = conn.execute(
        "SELECT country_iso3, severity, trigger, message FROM alerts ORDER BY severity DESC LIMIT 10"
    ).fetchall()
    for row in rows:
        print(row)
