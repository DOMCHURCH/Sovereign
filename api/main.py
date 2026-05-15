import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import get_conn, log_ingest
from ontology import hydrate_countries, COUNTRY_METADATA
from analytics.portfolio_impact import estimate_portfolio_impact, DEMO_PORTFOLIO
from analyst import stream_analyst

import sys
sys.path.insert(0, os.path.dirname(__file__))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schema on startup
    get_conn()
    from ingest.scheduler import start_scheduler
    scheduler = start_scheduler()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Sovereign API", version="1.0.0", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", ""),
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ──────────────────────────────────────────────────────────

class CountrySummary(BaseModel):
    iso3: str
    name: str
    region: str
    sovereign_risk_score: Optional[float]
    risk_tier: Optional[str]
    risk_delta_7d: Optional[float]
    top_risk_drivers: list[str]
    is_primary_sanctions_target: bool


class CountryDetail(CountrySummary):
    gdp_usd: Optional[float]
    gdp_growth_pct: Optional[float]
    inflation_pct: Optional[float]
    govt_debt_pct_gdp: Optional[float]
    trade_openness: Optional[float]
    political_stability_score: Optional[float]
    corruption_control_score: Optional[float]
    rule_of_law_score: Optional[float]
    equity_return_1y: Optional[float]
    equity_volatility_21d: Optional[float]
    news_sentiment_7d: Optional[float]
    sanctions_entity_count: int
    sub_scores: Optional[dict]


class AlertModel(BaseModel):
    id: str
    country_iso3: str
    severity: str
    trigger: str
    message: str
    contagion_risk: list[str]
    portfolio_impact_pct: Optional[float]
    created_at: str
    acknowledged: bool


class AnalystRequest(BaseModel):
    message: str
    country_context: Optional[str] = None
    history: list[dict] = []


class StressRequest(BaseModel):
    country: str
    shock_magnitude: float


class AcknowledgeRequest(BaseModel):
    pass


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_sub_scores(iso3: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        """
        SELECT sub_scores_json FROM sovereign_risk
        WHERE country_iso3 = ?
        ORDER BY computed_at DESC LIMIT 1
        """,
        [iso3],
    ).fetchone()
    if row and row[0]:
        return json.loads(row[0])
    return None


def _get_risk_delta(iso3: str) -> Optional[float]:
    sub = _get_sub_scores(iso3)
    if sub:
        return sub.get("delta_7d")
    return None


def _top_drivers(sub: Optional[dict]) -> list[str]:
    if not sub:
        return []
    driver_keys = [
        "political_instability", "macro_stress", "market_stress",
        "sanctions_exposure", "governance_deficit", "sentiment_deterioration",
    ]
    scored = [(k, sub.get(k, 0)) for k in driver_keys]
    top = sorted(scored, key=lambda x: x[1], reverse=True)[:3]
    labels = {
        "political_instability": "political instability",
        "macro_stress": "macro stress",
        "market_stress": "market stress",
        "sanctions_exposure": "sanctions exposure",
        "governance_deficit": "governance deficit",
        "sentiment_deterioration": "sentiment deterioration",
    }
    return [labels[k] for k, _ in top if sub.get(k, 0) > 40]


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/countries", response_model=list[CountrySummary])
def list_countries():
    conn = get_conn()
    countries = hydrate_countries(conn)
    result = []
    for c in countries:
        sub = _get_sub_scores(c.iso3)
        delta = sub.get("delta_7d") if sub else None
        result.append(CountrySummary(
            iso3=c.iso3,
            name=c.name,
            region=c.region,
            sovereign_risk_score=c.sovereign_risk_score,
            risk_tier=c.risk_tier,
            risk_delta_7d=delta,
            top_risk_drivers=_top_drivers(sub),
            is_primary_sanctions_target=c.is_primary_sanctions_target,
        ))
    result.sort(key=lambda x: (x.sovereign_risk_score or 0), reverse=True)
    return result


@app.get("/countries/{iso3}", response_model=CountryDetail)
def get_country(iso3: str):
    iso3 = iso3.upper()
    conn = get_conn()
    countries = hydrate_countries(conn)
    c = next((x for x in countries if x.iso3 == iso3), None)
    if not c:
        raise HTTPException(status_code=404, detail="Country not found")

    sub = _get_sub_scores(iso3)
    delta = sub.get("delta_7d") if sub else None

    return CountryDetail(
        iso3=c.iso3,
        name=c.name,
        region=c.region,
        sovereign_risk_score=c.sovereign_risk_score,
        risk_tier=c.risk_tier,
        risk_delta_7d=delta,
        top_risk_drivers=_top_drivers(sub),
        is_primary_sanctions_target=c.is_primary_sanctions_target,
        gdp_usd=c.gdp_usd,
        gdp_growth_pct=c.gdp_growth_pct,
        inflation_pct=c.inflation_pct,
        govt_debt_pct_gdp=c.govt_debt_pct_gdp,
        trade_openness=c.trade_openness,
        political_stability_score=c.political_stability_score,
        corruption_control_score=c.corruption_control_score,
        rule_of_law_score=c.rule_of_law_score,
        equity_return_1y=c.equity_return_1y,
        equity_volatility_21d=c.equity_volatility_21d,
        news_sentiment_7d=c.news_sentiment_7d,
        sanctions_entity_count=c.sanctions_entity_count,
        sub_scores=sub,
    )


@app.get("/countries/{iso3}/history")
def get_country_history(iso3: str):
    iso3 = iso3.upper()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT score, tier, computed_at FROM sovereign_risk
        WHERE country_iso3 = ?
        ORDER BY computed_at ASC
        LIMIT 360
        """,
        [iso3],
    ).fetchall()
    return [
        {"score": r[0], "tier": r[1], "date": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2])}
        for r in rows
    ]


@app.get("/countries/{iso3}/contagion")
def get_country_contagion(iso3: str):
    iso3 = iso3.upper()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT ce.target_country, ce.transmission_weight, ce.channel
        FROM contagion_edges ce
        INNER JOIN (
            SELECT source_country, MAX(computed_at) max_at FROM contagion_edges GROUP BY source_country
        ) l ON ce.source_country = l.source_country AND ce.computed_at = l.max_at
        WHERE ce.source_country = ?
        ORDER BY ce.transmission_weight DESC
        """,
        [iso3],
    ).fetchall()

    from analytics.contagion import propagate_shock, build_contagion_graph
    from analytics.country_risk import run as get_scores
    countries = hydrate_countries(conn)
    import pandas as pd
    corr_rows = conn.execute(
        "SELECT country_a, country_b, correlation_30d FROM correlations WHERE date = (SELECT MAX(date) FROM correlations)"
    ).fetchall()
    correlations = pd.DataFrame(corr_rows, columns=["country_a", "country_b", "correlation_30d"])
    G = build_contagion_graph(countries, correlations)

    score_row = conn.execute(
        "SELECT score FROM sovereign_risk WHERE country_iso3 = ? ORDER BY computed_at DESC LIMIT 1",
        [iso3],
    ).fetchone()
    shock = float(score_row[0]) if score_row else 50.0

    propagated = propagate_shock(G, iso3, shock)

    return {
        "epicenter": iso3,
        "shock_magnitude": shock,
        "direct_edges": [
            {"target": r[0], "weight": r[1], "channel": r[2]} for r in rows
        ],
        "propagated_impacts": [
            {"country": k, "estimated_risk_increase": round(v, 2)}
            for k, v in sorted(propagated.items(), key=lambda x: x[1], reverse=True)[:10]
        ],
    }


@app.get("/alerts", response_model=list[AlertModel])
def list_alerts():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, country_iso3, severity, trigger, message,
               contagion_risk_json, portfolio_impact_pct, created_at, acknowledged
        FROM alerts
        ORDER BY
            CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
            created_at DESC
        LIMIT 100
        """
    ).fetchall()
    return [
        AlertModel(
            id=r[0],
            country_iso3=r[1],
            severity=r[2],
            trigger=r[3],
            message=r[4],
            contagion_risk=json.loads(r[5]) if r[5] else [],
            portfolio_impact_pct=r[6],
            created_at=r[7].isoformat() if hasattr(r[7], "isoformat") else str(r[7]),
            acknowledged=bool(r[8]),
        )
        for r in rows
    ]


@app.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str):
    conn = get_conn()
    conn.execute("UPDATE alerts SET acknowledged = TRUE WHERE id = ?", [alert_id])
    return {"acknowledged": True}


@app.get("/portfolio")
def get_portfolio():
    conn = get_conn()
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier
        FROM sovereign_risk sr
        INNER JOIN (
            SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3
        ) l ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    risk_lookup = {r[0]: {"score": r[1], "tier": r[2]} for r in risk_rows}

    from ingest.markets import COUNTRY_ETFS
    holdings = []
    for ticker, weight in DEMO_PORTFOLIO.items():
        iso3 = next((k for k, v in COUNTRY_ETFS.items() if v == ticker), None)
        r = risk_lookup.get(iso3, {}) if iso3 else {}
        holdings.append({
            "ticker": ticker,
            "weight": weight,
            "country_iso3": iso3,
            "risk_score": r.get("score"),
            "risk_tier": r.get("tier"),
        })

    return {"holdings": holdings, "aum": 1_000_000}


@app.get("/portfolio/impact")
def get_portfolio_impact():
    conn = get_conn()
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3,
               CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d
        FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    risk_deltas = {r[0]: r[1] for r in risk_rows if r[1] is not None}
    impact = estimate_portfolio_impact(risk_deltas)
    return {
        "total_shock_pct": impact.total_shock_pct,
        "total_shock_usd": impact.total_shock_usd,
        "position_attribution": [
            {"ticker": p.ticker, "weight": p.weight, "shock_contribution_pct": p.shock_contribution_pct}
            for p in impact.position_attribution
        ],
        "worst_country_exposures": [
            {"country": e.country, "portfolio_weight_exposed": e.portfolio_weight_exposed, "shock_pct": e.shock_pct}
            for e in impact.worst_country_exposures
        ],
    }


@app.post("/portfolio/stress")
def stress_test(req: StressRequest):
    iso3 = req.country.upper()
    risk_deltas = {iso3: req.shock_magnitude}
    impact = estimate_portfolio_impact(risk_deltas)
    return {
        "scenario": {"country": iso3, "shock_magnitude": req.shock_magnitude},
        "total_shock_pct": impact.total_shock_pct,
        "total_shock_usd": impact.total_shock_usd,
        "position_attribution": [
            {"ticker": p.ticker, "weight": p.weight, "shock_contribution_pct": p.shock_contribution_pct}
            for p in impact.position_attribution
        ],
    }


@app.get("/graph")
def get_graph():
    conn = get_conn()
    node_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier
        FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    nodes = [
        {"id": r[0], "name": COUNTRY_METADATA.get(r[0], (r[0], ""))[0], "score": r[1], "tier": r[2]}
        for r in node_rows
    ]

    edge_rows = conn.execute(
        """
        SELECT ce.source_country, ce.target_country, ce.transmission_weight, ce.channel
        FROM contagion_edges ce
        INNER JOIN (SELECT source_country, MAX(computed_at) max_at FROM contagion_edges GROUP BY source_country) l
            ON ce.source_country = l.source_country AND ce.computed_at = l.max_at
        ORDER BY ce.transmission_weight DESC LIMIT 200
        """
    ).fetchall()
    edges = [{"source": r[0], "target": r[1], "weight": r[2], "channel": r[3]} for r in edge_rows]

    return {"nodes": nodes, "edges": edges}


@app.get("/ingest/status")
def ingest_status():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT source, status, rows_written, error_msg, ran_at
        FROM ingest_log
        ORDER BY ran_at DESC LIMIT 20
        """
    ).fetchall()
    return [
        {"source": r[0], "status": r[1], "rows": r[2], "error": r[3],
         "ran_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4])}
        for r in rows
    ]


@app.post("/ingest/run")
def run_ingest(background_tasks: BackgroundTasks):
    def _run():
        from ingest import world_bank, sanctions, markets, news
        from analytics import country_risk, contagion, portfolio_impact, alerts
        world_bank.run()
        sanctions.run()
        markets.run()
        news.run()
        country_risk.run()
        contagion.run()
        portfolio_impact.run()
        alerts.run()

    background_tasks.add_task(_run)
    return {"status": "ingest started"}


@app.post("/analyst")
async def analyst_endpoint(req: AnalystRequest):
    async def generate():
        async for chunk in stream_analyst(req.message, req.history, req.country_context):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
