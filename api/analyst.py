import os
import json
import requests
from typing import AsyncGenerator
from db import get_conn

MODEL = "claude-3-5-haiku-20241022"
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

SYSTEM_PROMPT_TEMPLATE = """You are Sovereign, an institutional geopolitical risk analyst with live access to sovereign risk scores, conflict intelligence, contagion models, and portfolio impact estimates for 50+ countries.

Be precise and quantitative. Cite specific scores and data points. Think like a senior analyst at a sovereign wealth fund or intelligence agency. Be direct — your audience is experienced professionals who do not need concepts explained.

Current global snapshot (top 10 riskiest countries by Sovereign Risk Score):
{top_10_json}

Active alerts: {alert_count} total ({critical_count} critical)
Portfolio estimated P&L exposure: {portfolio_impact_pct}
Geopolitical Tension Index leaders: {gti_leaders}
{country_context}
{search_context}
Data: World Bank WGI, OFAC SDN, country ETFs via yfinance, RSS news sentiment (VADER), ACLED conflict events, GDELT. Scores update every 15 minutes."""


def _brave_search(query: str) -> str:
    """Return top 3 search result snippets as context string."""
    api_key = os.getenv("BRAVE_SEARCH_API_KEY", "")
    if not api_key:
        return ""
    try:
        resp = requests.get(
            BRAVE_SEARCH_URL,
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            params={"q": query, "count": 4, "freshness": "pd"},
            timeout=8,
        )
        if not resp.ok:
            return ""
        results = resp.json().get("web", {}).get("results", [])
        snippets = []
        for r in results[:3]:
            title = r.get("title", "")
            desc = r.get("description", "")
            url = r.get("url", "")
            snippets.append(f"• {title}: {desc} ({url})")
        if snippets:
            return "\nLive intelligence (Brave Search):\n" + "\n".join(snippets)
    except Exception:
        pass
    return ""


def _build_system_prompt(message: str, country_context: str | None = None) -> str:
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
            "country": name, "iso3": iso3,
            "score": round(score, 1), "tier": tier,
            "delta_7d": round(delta, 1) if delta else 0,
        })

    alert_rows = conn.execute(
        "SELECT severity FROM alerts WHERE acknowledged = FALSE"
    ).fetchall()
    alert_count = len(alert_rows)
    critical_count = sum(1 for r in alert_rows if r[0] == "critical")

    port_row = conn.execute(
        """
        SELECT sr.country_iso3, CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE)
        FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    from analytics.portfolio_impact import estimate_portfolio_impact
    risk_deltas = {r[0]: r[1] for r in port_row if r[1] is not None}
    impact = estimate_portfolio_impact(risk_deltas)

    # GTI leaders
    try:
        gti_rows = conn.execute(
            "SELECT country_iso3, gti, tier FROM gti_scores ORDER BY gti DESC LIMIT 5"
        ).fetchall()
        gti_leaders = ", ".join(
            f"{COUNTRY_METADATA.get(r[0],(r[0],''))[0]} {r[1]:.0f} ({r[2]})"
            for r in gti_rows
        ) if gti_rows else "GTI not yet computed"
    except Exception:
        gti_leaders = "GTI not yet computed"

    # Brave Search grounding for the user's message
    search_ctx = _brave_search(f"geopolitical {message} 2025 2026")

    ctx = f"\nCountry context loaded: {country_context}" if country_context else ""

    return SYSTEM_PROMPT_TEMPLATE.format(
        top_10_json=json.dumps(top_10, indent=2),
        alert_count=alert_count,
        critical_count=critical_count,
        portfolio_impact_pct=f"{impact.total_shock_pct:.1%}",
        gti_leaders=gti_leaders,
        country_context=ctx,
        search_context=search_ctx,
    )


async def stream_analyst(
    message: str,
    history: list[dict],
    country_context: str | None = None,
) -> AsyncGenerator[str, None]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    system = _build_system_prompt(message, country_context)

    messages = []
    for h in history[-10:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    async with client.messages.stream(
        model=MODEL,
        max_tokens=1024,
        system=system,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text
