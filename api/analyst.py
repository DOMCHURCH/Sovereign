import os
import json
import requests
from typing import AsyncGenerator
from db import get_conn

# Provider routing — priority: GROQ_API_KEY > CEREBRAS_API_KEY (legacy, retiring May 2026)
# User-provided BYOK key always routes to Groq
GROQ_BASE_URL      = "https://api.groq.com/openai/v1"
GROQ_MODEL         = "llama-3.1-8b-instant"
CEREBRAS_BASE_URL  = "https://api.cerebras.ai/v1"
CEREBRAS_MODEL     = "llama3.1-8b"

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
Data: World Bank WGI, OFAC SDN, country ETFs via yfinance, RSS news sentiment (VADER), curated conflict set.
The risk snapshot above was computed at {data_as_of}. Treat it as of that date — do not claim figures are real-time."""


def _brave_search(query: str) -> str:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY") or os.getenv("BRAVE_SEARCH_API", "")
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
            desc  = r.get("description", "")
            url   = r.get("url", "")
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
    alert_count    = len(alert_rows)
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

    search_ctx = _brave_search(f"geopolitical {message} 2025 2026")
    ctx = f"\nCountry context loaded: {country_context}" if country_context else ""

    try:
        as_of_row = conn.execute("SELECT MAX(computed_at) FROM sovereign_risk").fetchone()
        data_as_of = as_of_row[0].strftime("%Y-%m-%d %H:%M UTC") if as_of_row and as_of_row[0] else "an unknown date"
    except Exception:
        data_as_of = "an unknown date"

    return SYSTEM_PROMPT_TEMPLATE.format(
        data_as_of=data_as_of,
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
    user_api_key: str | None = None,
) -> AsyncGenerator[str, None]:
    system = _build_system_prompt(message, country_context)

    messages = []
    for h in history[-10:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message})

    # Key + provider resolution (Groq preferred; Cerebras as legacy fallback)
    groq_key     = user_api_key or os.getenv("GROQ_API_KEY", "")
    cerebras_key = os.getenv("CEREBRAS_API_KEY", "")

    if groq_key:
        api_key  = groq_key
        base_url = GROQ_BASE_URL
        model    = GROQ_MODEL
    elif cerebras_key:
        api_key  = cerebras_key
        base_url = CEREBRAS_BASE_URL
        model    = CEREBRAS_MODEL
    else:
        yield ("The AI analyst is not configured on this deployment. "
               "Set GROQ_API_KEY on the server, or supply your own Groq key via the X-API-Key header.")
        return

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    try:
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "system", "content": system}] + messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        # Log the real cause server-side; never surface a raw provider error to users.
        print(f"[analyst] {model} via {base_url} failed: {e}", flush=True)
        yield ("\n\nThe AI analyst is temporarily unavailable. "
               "Risk scores, alerts and contagion data on this page are unaffected.")
