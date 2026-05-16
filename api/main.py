import os
import json
import pathlib
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import sys
sys.path.insert(0, os.path.dirname(__file__))

from db import get_conn, log_ingest
from ontology import hydrate_countries, COUNTRY_METADATA
from analytics.portfolio_impact import estimate_portfolio_impact, DEMO_PORTFOLIO
from analyst import stream_analyst

DIST = pathlib.Path(__file__).parent / "dist"



app = FastAPI(title="Sovereign API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All API routes live under /api
router = APIRouter(prefix="/api")


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


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_sub_scores(iso3: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        "SELECT sub_scores_json FROM sovereign_risk WHERE country_iso3 = ? ORDER BY computed_at DESC LIMIT 1",
        [iso3],
    ).fetchone()
    if row and row[0]:
        return json.loads(row[0])
    return None


def _top_drivers(sub: Optional[dict]) -> list[str]:
    if not sub:
        return []
    driver_keys = [
        "political_instability", "macro_stress", "market_stress",
        "sanctions_exposure", "governance_deficit", "sentiment_deterioration",
    ]
    labels = {
        "political_instability": "political instability",
        "macro_stress": "macro stress",
        "market_stress": "market stress",
        "sanctions_exposure": "sanctions exposure",
        "governance_deficit": "governance deficit",
        "sentiment_deterioration": "sentiment deterioration",
    }
    scored = sorted([(k, sub.get(k, 0)) for k in driver_keys], key=lambda x: x[1], reverse=True)
    return [labels[k] for k, v in scored[:3] if v > 40]


# ── API Routes (/api/*) ───────────────────────────────────────────────────────

@router.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/countries", response_model=list[CountrySummary])
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


@router.get("/countries/{iso3}", response_model=CountryDetail)
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
        iso3=c.iso3, name=c.name, region=c.region,
        sovereign_risk_score=c.sovereign_risk_score, risk_tier=c.risk_tier,
        risk_delta_7d=delta, top_risk_drivers=_top_drivers(sub),
        is_primary_sanctions_target=c.is_primary_sanctions_target,
        gdp_usd=c.gdp_usd, gdp_growth_pct=c.gdp_growth_pct,
        inflation_pct=c.inflation_pct, govt_debt_pct_gdp=c.govt_debt_pct_gdp,
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


@router.get("/countries/{iso3}/history")
def get_country_history(iso3: str):
    iso3 = iso3.upper()
    conn = get_conn()
    rows = conn.execute(
        "SELECT score, tier, computed_at FROM sovereign_risk WHERE country_iso3 = ? ORDER BY computed_at ASC LIMIT 360",
        [iso3],
    ).fetchall()
    return [{"score": r[0], "tier": r[1], "date": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2])} for r in rows]


@router.get("/countries/{iso3}/news")
def get_country_news(iso3: str):
    iso3 = iso3.upper()
    country_name = COUNTRY_METADATA.get(iso3, (iso3, ""))[0]
    news_api_key = os.getenv("NEWS_API_KEY", "")
    if not news_api_key:
        return []
    import requests as req
    from_date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    try:
        resp = req.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": f'"{country_name}" economy OR sanctions OR politics OR crisis',
                "from": from_date,
                "language": "en",
                "sortBy": "relevancy",
                "pageSize": 8,
                "apiKey": news_api_key,
            },
            timeout=10,
        )
        articles = resp.json().get("articles", [])
        return [
            {
                "title": a.get("title", ""),
                "description": a.get("description", ""),
                "url": a.get("url", ""),
                "source": a.get("source", {}).get("name", ""),
                "published_at": a.get("publishedAt", ""),
            }
            for a in articles if a.get("title")
        ]
    except Exception:
        return []


# ── Conflict zones ────────────────────────────────────────────────────────────
# Curated list of active armed conflicts as of 2025/2026.
# intensity: major | significant | minor
# type: interstate | civil_war | insurgency | territorial

_CONFLICTS = [
    {"id":"ukraine","name":"Russia–Ukraine War","lat":49.0,"lng":32.0,"intensity":"major","type":"interstate","parties":"Russia vs. Ukraine","since":2022,"countries":["UKR","RUS"],"description":"Full-scale invasion with active frontlines across eastern and southern Ukraine."},
    {"id":"gaza","name":"Israel–Gaza War","lat":31.4,"lng":34.3,"intensity":"major","type":"interstate","parties":"Israel vs. Hamas","since":2023,"countries":["ISR"],"description":"Israeli military operations in the Gaza Strip following Hamas attacks of Oct 2023."},
    {"id":"sudan","name":"Sudan Civil War","lat":15.5,"lng":30.0,"intensity":"major","type":"civil_war","parties":"SAF vs. RSF","since":2023,"countries":["SDN"],"description":"War between the Sudanese Armed Forces and the Rapid Support Forces militia, causing one of the world's largest displacement crises."},
    {"id":"myanmar","name":"Myanmar Civil War","lat":20.5,"lng":95.5,"intensity":"major","type":"civil_war","parties":"Junta vs. resistance coalitions","since":2021,"countries":["MMR"],"description":"Armed resistance against military junta following 2021 coup. Multiple ethnic armed organisations fighting across the country."},
    {"id":"drc-east","name":"DRC Eastern Conflict","lat":-1.5,"lng":28.8,"intensity":"major","type":"civil_war","parties":"FARDC/MONUSCO vs. M23/Rwanda","since":2012,"countries":["COD"],"description":"M23 rebels backed by Rwanda hold significant territory in North Kivu, ongoing since 2022 resurgence."},
    {"id":"yemen","name":"Yemen War","lat":15.2,"lng":44.8,"intensity":"significant","type":"civil_war","parties":"Houthis vs. Saudi-led coalition","since":2015,"countries":["YEM","SAU"],"description":"Houthi forces control northern Yemen. Ongoing Houthi attacks on Red Sea shipping lanes."},
    {"id":"ethiopia-amhara","name":"Ethiopia – Amhara Conflict","lat":11.5,"lng":38.0,"intensity":"significant","type":"civil_war","parties":"ENDF vs. FANO militia","since":2023,"countries":["ETH"],"description":"Armed conflict between Ethiopian forces and Amhara regional militias following disarmament attempts."},
    {"id":"somalia","name":"Somalia – Al-Shabaab","lat":4.5,"lng":44.0,"intensity":"significant","type":"insurgency","parties":"FGS/ATMIS vs. Al-Shabaab","since":2006,"countries":["SOM"],"description":"Al-Shabaab controls rural areas and launches attacks on Mogadishu and military positions."},
    {"id":"sahel-mali","name":"Mali – Jihadist Insurgency","lat":17.0,"lng":-2.0,"intensity":"significant","type":"insurgency","parties":"FAMA/Wagner vs. JNIM/GSIM/ISGS","since":2012,"countries":["MLI"],"description":"JNIM and ISGS control large swaths of central and northern Mali. Massacres and mass displacement ongoing."},
    {"id":"sahel-burkina","name":"Burkina Faso – Jihadist Insurgency","lat":12.5,"lng":-1.5,"intensity":"significant","type":"insurgency","parties":"FAMA vs. JNIM/ISGS","since":2015,"countries":["BFA"],"description":"Jihadist groups control ~40% of Burkina Faso territory. Severe humanitarian crisis."},
    {"id":"sahel-niger","name":"Niger – Sahel Insurgency","lat":15.5,"lng":9.0,"intensity":"significant","type":"insurgency","parties":"Niger armed forces vs. ISGS/JNIM","since":2017,"countries":["NER"],"description":"Ongoing attacks in Tillabéri and Tahoua regions, worsened after 2023 military coup."},
    {"id":"nigeria-ne","name":"Nigeria – Boko Haram / ISWAP","lat":12.0,"lng":13.5,"intensity":"significant","type":"insurgency","parties":"Nigerian forces vs. ISWAP/JAS","since":2009,"countries":["NGA"],"description":"ISWAP active in Lake Chad Basin. Banditry and kidnappings widespread in northwest."},
    {"id":"mozambique","name":"Mozambique – Cabo Delgado","lat":-12.5,"lng":40.5,"intensity":"significant","type":"insurgency","parties":"Mozambican/SADC forces vs. ISCAP","since":2017,"countries":["MOZ"],"description":"ISIS-affiliated insurgency in Cabo Delgado gas-rich province. Over 1M displaced."},
    {"id":"afghanistan","name":"Afghanistan – IS-K Insurgency","lat":33.5,"lng":66.0,"intensity":"significant","type":"insurgency","parties":"Taliban vs. Islamic State Khorasan","since":2021,"countries":["AFG"],"description":"IS-K attacks on Taliban administration, Hazara minorities, and foreign interests."},
    {"id":"pakistan-ttp","name":"Pakistan – TTP Insurgency","lat":33.0,"lng":70.0,"intensity":"significant","type":"insurgency","parties":"Pakistan Army vs. TTP","since":2007,"countries":["PAK"],"description":"Tehrik-i-Taliban Pakistan conducts attacks across KP province and tribal areas."},
    {"id":"syria","name":"Syria – Ongoing Conflict","lat":35.0,"lng":38.5,"intensity":"significant","type":"civil_war","parties":"Multiple factions","since":2011,"countries":["SYR"],"description":"Multiple armed groups control different regions. Turkish forces in north, US-backed SDF in northeast, remnant IS cells active."},
    {"id":"iraq-isis","name":"Iraq – ISIS Remnants","lat":34.5,"lng":43.5,"intensity":"minor","type":"insurgency","parties":"ISF vs. IS cells","since":2014,"countries":["IRQ"],"description":"Residual Islamic State cells in Anbar, Kirkuk and Diyala provinces conducting guerrilla attacks."},
    {"id":"westbank","name":"West Bank Violence","lat":31.9,"lng":35.2,"intensity":"significant","type":"territorial","parties":"Israeli forces vs. Palestinian militants","since":2022,"countries":["ISR"],"description":"Significantly escalated raids, settler violence and militant attacks across the West Bank."},
    {"id":"lebanon-south","name":"Lebanon – Post-War Instability","lat":33.6,"lng":35.6,"intensity":"minor","type":"territorial","parties":"Israeli forces / Hezbollah remnants","since":2024,"countries":["LBN","ISR"],"description":"Post-ceasefire instability. Sporadic clashes near south Lebanon border."},
    {"id":"colombia","name":"Colombia – ELN / FARC Dissidents","lat":5.5,"lng":-74.0,"intensity":"minor","type":"insurgency","parties":"Colombian forces vs. ELN/FARC-EMC","since":2016,"countries":["COL"],"description":"ELN and FARC dissident groups control coca-growing regions. Peace talks stalled."},
    {"id":"haiti","name":"Haiti – Gang Crisis","lat":18.8,"lng":-72.3,"intensity":"significant","type":"civil_war","parties":"Kenyan-led MSS vs. armed gangs","since":2021,"countries":["HTI"],"description":"Armed gangs control >80% of Port-au-Prince. Multinational Security Support mission deployed."},
    {"id":"cameroon","name":"Cameroon – Anglophone Crisis","lat":5.8,"lng":10.2,"intensity":"minor","type":"civil_war","parties":"Cameroon forces vs. Ambazonian separatists","since":2017,"countries":["CMR"],"description":"Anglophone separatist conflict in NW and SW regions. Over 700,000 displaced."},
    {"id":"car","name":"CAR – Armed Groups","lat":6.5,"lng":20.0,"intensity":"minor","type":"civil_war","parties":"FACA/Wagner vs. CPC coalition","since":2012,"countries":["CAF"],"description":"Coalition of armed groups controls rural areas despite Russian Wagner Group deployment."},
    {"id":"south-sudan","name":"South Sudan – Renewed Tensions","lat":7.0,"lng":30.0,"intensity":"minor","type":"civil_war","parties":"Government vs. SPLM-IO","since":2013,"countries":["SSD"],"description":"Peace deal fraying; inter-communal violence and clashes between armed factions continuing."},
    {"id":"kashmir","name":"Kashmir – India-Pakistan Tensions","lat":34.0,"lng":74.5,"intensity":"minor","type":"territorial","parties":"India vs. Pakistan (LOC)","since":1947,"countries":["IND","PAK"],"description":"Cross-border infiltration and militant attacks. Escalated tensions following 2025 Pahalgam attack."},
    {"id":"taiwan-strait","name":"Taiwan Strait Tensions","lat":23.5,"lng":119.5,"intensity":"minor","type":"territorial","parties":"PRC vs. Taiwan/USA","since":1949,"countries":["CHN","TWN"],"description":"Increasing Chinese PLA military exercises around Taiwan. US naval presence maintained."},
    {"id":"south-china-sea","name":"South China Sea Disputes","lat":13.0,"lng":115.0,"intensity":"minor","type":"territorial","parties":"China vs. Philippines/Vietnam/Malaysia","since":1970,"countries":["CHN","PHL","VNM"],"description":"Ongoing Chinese coast guard confrontations with Philippine vessels near Spratly Islands."},
    {"id":"nagorno-karabakh","name":"Armenia – Post-Karabakh Tensions","lat":40.2,"lng":46.0,"intensity":"minor","type":"territorial","parties":"Armenia vs. Azerbaijan","since":2020,"countries":["ARM","AZE"],"description":"Post-2023 ceasefire tensions remain. Armenian border security disputed."},
    {"id":"philippines","name":"Philippines – Abu Sayyaf / NPA","lat":7.5,"lng":124.0,"intensity":"minor","type":"insurgency","parties":"AFP vs. Abu Sayyaf/NPA","since":1969,"countries":["PHL"],"description":"Abu Sayyaf kidnappings in Sulu Archipelago. NPA communist insurgency in rural Mindanao."},
    {"id":"kenya-bandits","name":"Kenya – Bandit Conflicts","lat":1.5,"lng":36.5,"intensity":"minor","type":"insurgency","parties":"KDF vs. armed pastoralists","since":2019,"countries":["KEN"],"description":"Armed clashes and cattle rustling in Turkana, Baringo and Laikipia counties."},
]


@router.get("/conflicts")
def get_conflicts():
    return _fetch_live_conflicts()


# ── Conflict intelligence pipeline ────────────────────────────────────────────
# Priority order: Valyu API → GDELT (free) → curated static data
# Results cached for 30 min to avoid hammering external APIs.

import time as _time
_conflict_cache: dict = {"data": None, "ts": 0, "source": "curated"}
_CACHE_TTL = 1800  # 30 minutes

# Capital city coordinates for geocoding country mentions
_CAPITALS_COORDS: dict[str, tuple[float, float]] = {
    "AFG":(34.5,69.2),"AGO":(-8.8,13.2),"ARE":(24.5,54.4),"ARG":(-34.6,-58.4),
    "AUS":(-35.3,149.1),"AZE":(40.4,49.9),"BGD":(23.7,90.4),"BLR":(53.9,27.6),
    "BRA":(-15.8,-47.9),"CAN":(45.4,-75.7),"CHE":(46.9,7.5),"CHL":(-33.5,-70.6),
    "CHN":(39.9,116.4),"COD":(-4.3,15.3),"COL":(4.7,-74.1),"CUB":(23.1,-82.4),
    "DEU":(52.5,13.4),"DZA":(36.7,3.0),"EGY":(30.1,31.2),"ESP":(40.4,-3.7),
    "ETH":(9.0,38.7),"FRA":(48.9,2.3),"GBR":(51.5,-0.1),"GHA":(5.6,-0.2),
    "HKG":(22.3,114.2),"HTI":(18.5,-72.3),"IDN":(-6.2,106.8),"IND":(28.6,77.2),
    "IRN":(35.7,51.4),"IRQ":(33.3,44.4),"ISR":(31.8,35.2),"ITA":(41.9,12.5),
    "JOR":(31.9,35.9),"JPN":(35.7,139.7),"KAZ":(51.2,71.5),"KEN":(-1.3,36.8),
    "KOR":(37.6,127.0),"KWT":(29.4,47.9),"LBN":(33.9,35.5),"LBY":(32.9,13.2),
    "MAR":(34.0,-6.8),"MEX":(19.4,-99.1),"MLI":(12.6,-8.0),"MMR":(19.7,96.1),
    "MOZ":(-25.9,32.6),"MYS":(3.2,101.7),"NER":(13.5,2.1),"NGA":(9.1,7.2),
    "NIC":(12.1,-86.3),"NLD":(52.1,4.3),"NOR":(59.9,10.7),"OMN":(23.6,58.6),
    "PAK":(33.7,73.1),"PER":(-12.0,-77.0),"PHL":(14.6,121.0),"POL":(52.2,21.0),
    "PRK":(39.0,125.8),"QAT":(25.3,51.5),"RUS":(55.8,37.6),"SAU":(24.7,46.7),
    "SDN":(15.6,32.5),"SGP":(1.3,103.8),"SOM":(2.0,45.3),"SSD":(4.9,31.6),
    "SWE":(59.3,18.1),"SYR":(33.5,36.3),"THA":(13.8,100.5),"TUR":(39.9,32.9),
    "TWN":(25.0,121.5),"TZA":(-6.2,35.7),"UKR":(50.4,30.5),"USA":(38.9,-77.0),
    "UZB":(41.3,69.3),"VEN":(10.5,-66.9),"VNM":(21.0,105.8),"YEM":(15.4,44.2),
    "ZAF":(-25.7,28.2),"ZWE":(-17.8,31.1),"BFA":(12.4,-1.5),"CMR":(3.9,11.5),
    "CAF":(4.4,18.6),"ARM":(40.2,44.5),"AZE":(40.4,49.9),"MYN":(19.7,96.1),
}

# Threat queries mirroring globalthreatmap's 29-category approach
_THREAT_QUERIES = [
    "armed conflict war military operations attack killed",
    "civil war insurgency rebel fighting clashes",
    "military strike airstrike bombing offensive",
    "territorial dispute border conflict troops",
    "terrorism attack militant group killed",
]

# Country name → ISO3 mapping for geocoding article text
_NAME_TO_ISO3: dict[str, str] = {}


def _build_name_index():
    global _NAME_TO_ISO3
    if _NAME_TO_ISO3:
        return
    from ontology import COUNTRY_METADATA
    for iso3, (name, _) in COUNTRY_METADATA.items():
        _NAME_TO_ISO3[name.lower()] = iso3
    # Common aliases
    extras = {
        "russia": "RUS", "ukraine": "UKR", "israel": "ISR", "gaza": "ISR",
        "sudan": "SDN", "myanmar": "MMR", "burma": "MMR", "congo": "COD",
        "drc": "COD", "democratic republic of the congo": "COD",
        "houthis": "YEM", "mali": "MLI", "burkina faso": "BFA",
        "mozambique": "MOZ", "somalia": "SOM", "haiti": "HTI",
        "north korea": "PRK", "south korea": "KOR", "taiwan": "TWN",
        "iran": "IRN", "iraq": "IRQ", "syria": "SYR", "lebanon": "LBN",
        "pakistan": "PAK", "afghanistan": "AFG", "ethiopia": "ETH",
        "nigeria": "NGA", "niger": "NER", "colombia": "COL",
        "venezuela": "VEN", "philippines": "PHL", "kashmir": "IND",
        "west bank": "ISR", "hezbollah": "LBN", "hamas": "ISR",
        "sahel": "MLI", "kurdistan": "IRQ",
    }
    _NAME_TO_ISO3.update(extras)


def _score_text(text: str) -> dict[str, int]:
    """Count conflict-related country mentions in a block of text."""
    _build_name_index()
    text_lower = text.lower()
    counts: dict[str, int] = {}
    for name, iso3 in _NAME_TO_ISO3.items():
        if name in text_lower:
            counts[iso3] = counts.get(iso3, 0) + 1
    return counts


def _articles_to_conflicts(articles: list[dict]) -> list[dict]:
    """Convert raw news articles → conflict zone objects with coordinates."""
    totals: dict[str, int] = {}
    for art in articles:
        text = f"{art.get('title', '')} {str(art.get('content', ''))[:400]}"
        for iso3, count in _score_text(text).items():
            totals[iso3] = totals.get(iso3, 0) + count

    result = []
    for iso3, count in sorted(totals.items(), key=lambda x: -x[1])[:35]:
        if iso3 not in _CAPITALS_COORDS:
            continue
        lat, lng = _CAPITALS_COORDS[iso3]
        intensity = "major" if count >= 10 else "significant" if count >= 5 else "minor"
        # Enrich with curated metadata where available
        curated = next((c for c in _CONFLICTS if iso3 in c.get("countries", [])), None)
        from ontology import COUNTRY_METADATA
        country_name = COUNTRY_METADATA.get(iso3, (iso3, ""))[0]
        result.append({
            "id": f"live-{iso3}",
            "name": curated["name"] if curated else f"{country_name} – Conflict Activity",
            "lat": lat, "lng": lng,
            "intensity": intensity,
            "type": curated["type"] if curated else "insurgency",
            "parties": curated.get("parties", "") if curated else "",
            "since": curated.get("since", 2024) if curated else 2024,
            "countries": [iso3],
            "description": (curated["description"] if curated else "") + f" ({count} live news signals)",
            "live": True,
        })
    return result


def _fetch_valyu(api_key: str) -> list[dict] | None:
    """Query Valyu search API — mirrors globalthreatmap's searchEvents() approach."""
    import requests as req
    articles = []
    for query in _THREAT_QUERIES[:2]:  # 2 queries to stay fast
        try:
            resp = req.post(
                "https://api.valyu.network/v1/search",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"query": query, "searchType": "news", "maxNumResults": 25,
                      "start_date": (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")},
                timeout=12,
            )
            if resp.ok:
                articles.extend(resp.json().get("results", []))
        except Exception:
            continue
    return _articles_to_conflicts(articles) if articles else None


def _fetch_gdelt() -> list[dict] | None:
    """Free GDELT DOC API — no key required, updated every 15 min."""
    import requests as req
    try:
        resp = req.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": "war conflict military attack killed fighting",
                "mode": "ArtList",
                "maxrecords": "100",
                "format": "json",
                "timespan": "24h",
                "sourcelang": "english",
            },
            timeout=15,
        )
        if resp.ok:
            raw = resp.json().get("articles", [])
            articles = [{"title": a.get("title", ""), "content": ""} for a in raw]
            return _articles_to_conflicts(articles) if articles else None
    except Exception:
        pass
    return None


def _fetch_live_conflicts() -> list[dict]:
    """Return live conflict data with 30-minute in-process cache."""
    now = _time.time()
    if _conflict_cache["data"] and now - _conflict_cache["ts"] < _CACHE_TTL:
        return _conflict_cache["data"]

    valyu_key = os.getenv("VALYU_API_KEY", "")
    data = None
    source = "curated"

    if valyu_key:
        data = _fetch_valyu(valyu_key)
        if data:
            source = "valyu"

    if not data:
        data = _fetch_gdelt()
        if data:
            source = "gdelt"

    if not data:
        data = _CONFLICTS

    _conflict_cache["data"] = data
    _conflict_cache["ts"] = now
    _conflict_cache["source"] = source
    return data


@router.get("/conflicts/source")
def get_conflicts_source():
    """Returns which data source is currently powering the conflict layer."""
    return {"source": _conflict_cache.get("source", "curated"), "cached_at": _conflict_cache.get("ts", 0)}


@router.get("/countries/{iso3}/contagion")
def get_country_contagion(iso3: str):
    iso3 = iso3.upper()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT ce.target_country, ce.transmission_weight, ce.channel
        FROM contagion_edges ce
        INNER JOIN (SELECT source_country, MAX(computed_at) max_at FROM contagion_edges GROUP BY source_country) l
            ON ce.source_country = l.source_country AND ce.computed_at = l.max_at
        WHERE ce.source_country = ? ORDER BY ce.transmission_weight DESC
        """,
        [iso3],
    ).fetchall()

    from analytics.contagion import propagate_shock, build_contagion_graph
    import pandas as pd
    countries = hydrate_countries(conn)
    corr_rows = conn.execute(
        "SELECT country_a, country_b, correlation_30d FROM correlations WHERE date = (SELECT MAX(date) FROM correlations)"
    ).fetchall()
    correlations = pd.DataFrame(corr_rows, columns=["country_a", "country_b", "correlation_30d"])
    G = build_contagion_graph(countries, correlations)
    score_row = conn.execute(
        "SELECT score FROM sovereign_risk WHERE country_iso3 = ? ORDER BY computed_at DESC LIMIT 1", [iso3]
    ).fetchone()
    shock = float(score_row[0]) if score_row else 50.0
    propagated = propagate_shock(G, iso3, shock)
    return {
        "epicenter": iso3,
        "shock_magnitude": shock,
        "direct_edges": [{"target": r[0], "weight": r[1], "channel": r[2]} for r in rows],
        "propagated_impacts": [
            {"country": k, "estimated_risk_increase": round(v, 2)}
            for k, v in sorted(propagated.items(), key=lambda x: x[1], reverse=True)[:10]
        ],
    }


@router.get("/alerts", response_model=list[AlertModel])
def list_alerts():
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, country_iso3, severity, trigger, message,
               contagion_risk_json, portfolio_impact_pct, created_at, acknowledged
        FROM alerts
        ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
        LIMIT 100
        """
    ).fetchall()
    return [
        AlertModel(
            id=r[0], country_iso3=r[1], severity=r[2], trigger=r[3], message=r[4],
            contagion_risk=json.loads(r[5]) if r[5] else [],
            portfolio_impact_pct=r[6],
            created_at=r[7].isoformat() if hasattr(r[7], "isoformat") else str(r[7]),
            acknowledged=bool(r[8]),
        )
        for r in rows
    ]


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str):
    conn = get_conn()
    conn.execute("UPDATE alerts SET acknowledged = TRUE WHERE id = ?", [alert_id])
    return {"acknowledged": True}


@router.post("/alerts/acknowledge-all")
def acknowledge_all_alerts():
    conn = get_conn()
    conn.execute("UPDATE alerts SET acknowledged = TRUE WHERE acknowledged = FALSE")
    return {"acknowledged": True}


@router.get("/portfolio")
def get_portfolio():
    conn = get_conn()
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    risk_lookup = {r[0]: {"score": r[1], "tier": r[2]} for r in risk_rows}
    from ingest.markets import COUNTRY_ETFS
    holdings = []
    for ticker, weight in DEMO_PORTFOLIO.items():
        iso3 = next((k for k, v in COUNTRY_ETFS.items() if v == ticker), None)
        r = risk_lookup.get(iso3, {}) if iso3 else {}
        holdings.append({"ticker": ticker, "weight": weight, "country_iso3": iso3, "risk_score": r.get("score"), "risk_tier": r.get("tier")})
    return {"holdings": holdings, "aum": 1_000_000}


@router.get("/portfolio/impact")
def get_portfolio_impact():
    conn = get_conn()
    risk_rows = conn.execute(
        """
        SELECT sr.country_iso3, CAST(json_extract(sr.sub_scores_json, '$.delta_7d') AS DOUBLE) AS delta_7d
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
        "position_attribution": [{"ticker": p.ticker, "weight": p.weight, "shock_contribution_pct": p.shock_contribution_pct} for p in impact.position_attribution],
        "worst_country_exposures": [{"country": e.country, "portfolio_weight_exposed": e.portfolio_weight_exposed, "shock_pct": e.shock_pct} for e in impact.worst_country_exposures],
    }


@router.post("/portfolio/stress")
def stress_test(req: StressRequest):
    iso3 = req.country.upper()
    impact = estimate_portfolio_impact({iso3: req.shock_magnitude})
    return {
        "scenario": {"country": iso3, "shock_magnitude": req.shock_magnitude},
        "total_shock_pct": impact.total_shock_pct,
        "total_shock_usd": impact.total_shock_usd,
        "position_attribution": [{"ticker": p.ticker, "weight": p.weight, "shock_contribution_pct": p.shock_contribution_pct} for p in impact.position_attribution],
    }


@router.get("/graph")
def get_graph():
    conn = get_conn()
    node_rows = conn.execute(
        """
        SELECT sr.country_iso3, sr.score, sr.tier FROM sovereign_risk sr
        INNER JOIN (SELECT country_iso3, MAX(computed_at) max_at FROM sovereign_risk GROUP BY country_iso3) l
            ON sr.country_iso3 = l.country_iso3 AND sr.computed_at = l.max_at
        """
    ).fetchall()
    nodes = [{"id": r[0], "name": COUNTRY_METADATA.get(r[0], (r[0], ""))[0], "score": r[1], "tier": r[2]} for r in node_rows]
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


@router.get("/ingest/status")
def ingest_status():
    conn = get_conn()
    rows = conn.execute("SELECT source, status, rows_written, error_msg, ran_at FROM ingest_log ORDER BY ran_at DESC LIMIT 20").fetchall()
    return [{"source": r[0], "status": r[1], "rows": r[2], "error": r[3], "ran_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4])} for r in rows]


@router.post("/ingest/run")
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


@router.post("/analyst")
async def analyst_endpoint(req: AnalystRequest):
    async def generate():
        async for chunk in stream_analyst(req.message, req.history, req.country_context):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Register router then serve frontend ──────────────────────────────────────

app.include_router(router)

if DIST.exists():
    # Serve static assets (JS/CSS chunks)
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")

    @app.get("/")
    async def serve_root():
        return FileResponse(str(DIST / "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file = DIST / full_path
        if file.exists() and file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(DIST / "index.html"))
else:
    @app.get("/")
    def root():
        return {"service": "Sovereign API", "ui": "not built — run npm build in web/", "docs": "/api/docs"}
