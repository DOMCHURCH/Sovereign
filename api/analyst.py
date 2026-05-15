import os
import json
from typing import AsyncGenerator
from openai import AsyncOpenAI
from db import get_conn

MODEL = "llama3.1-8b"

SYSTEM_PROMPT_TEMPLATE = """You are Sovereign, an institutional geopolitical risk analyst with live access to sovereign risk scores, contagion models, and portfolio impact estimates for 50+ countries.

Be precise and quantitative. Cite specific scores. Think like a senior analyst at a sovereign wealth fund. Be direct — your audience is experienced investors who do not need concepts explained.

Current global snapshot (top 10 riskiest countries):
{top_10_json}

Active alerts: {alert_count} total ({critical_count} critical)
Portfolio estimated P&L exposure: {portfolio_impact_pct}
{country_context}
Data sources: World Bank WGI, OFAC SDN list, country ETF market data, NewsAPI sentiment. Scores update every 6 hours."""


def _build_system_prompt(country_context: str | None = None) -> str:
    conn = get_conn()
    from ontology import COUNTRY_METADATA

    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier,
               CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3
        ) l ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        ORDER BY sr.score DESC LIMIT 10
        """
    ).fetchall()

    top_10 = []
    for iso3, score, tier, delta in risk_rows:
        name = COUNTRY_METADATA.get(iso3, (iso3, ""))[0]
        top_10.append({
            "country": name,
            "iso3": iso3,
            "score": round(score, 1),
            "tier": tier,
            "delta_7d": round(delta, 1) if delta else 0,
        })

    alert_rows = conn.execute(
        "SELECT severity FROM alerts WHERE acknowledged = FALSE"
    ).fetchall()
    alert_count = len(alert_rows)
    critical_count = sum(1 for r in alert_rows if r[0] == "critical")

    port_row = conn.execute(
        """
        SELECT sr.country_iso3,
               CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3
        ) l ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()

    from analytics.portfolio_impact import estimate_portfolio_impact
    risk_deltas = {r[0]: r[1] for r in port_row if r[1] is not None}
    impact = estimate_portfolio_impact(risk_deltas)
    portfolio_str = f"{impact.total_shock_pct:.1%}"

    ctx = ""
    if country_context:
        ctx = f"\nCountry context loaded: {country_context}"

    return SYSTEM_PROMPT_TEMPLATE.format(
        top_10_json=json.dumps(top_10, indent=2),
        alert_count=alert_count,
        critical_count=critical_count,
        portfolio_impact_pct=portfolio_str,
        country_context=ctx,
    )


async def stream_analyst(
    message: str,
    history: list[dict],
    country_context: str | None = None,
) -> AsyncGenerator[str, None]:
    client = AsyncOpenAI(
        api_key=os.getenv("CEREBRAS_API_KEY"),
        base_url="https://api.cerebras.ai/v1",
    )
    system = _build_system_prompt(country_context)

    messages = []
    for h in history[-10:]:  # keep last 10 turns
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    stream = await client.chat.completions.create(
        model=MODEL,
        max_tokens=1024,
        system=system,
        messages=messages,
        stream=True,
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
