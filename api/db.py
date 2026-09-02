import os
import shutil
import threading
import duckdb
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

_API_DIR = Path(__file__).parent
_SEED_DB = _API_DIR / "sovereign_seed.duckdb"
_RUNTIME_DB = Path("/tmp/sovereign.duckdb")

_local = threading.local()
_copy_lock = threading.Lock()


def _runtime_db_path() -> str:
    # 1. Explicit override — a real persistent disk (Railway volume at /data).
    env_path = os.getenv("DATABASE_PATH", "").strip()
    if env_path:
        target = Path(env_path)
        # First boot on a fresh volume: the directory exists but the database does not.
        # Without this the app would come up against an empty file and serve nothing
        # until the first scheduled ingest finished, so seed it from the committed
        # snapshot and let the scheduler take over from there.
        if not target.exists() and _SEED_DB.exists():
            with _copy_lock:
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(_SEED_DB), str(target))
        return env_path
    # 2. Seed DB bundled with the repo — copy once to /tmp for mutable runtime use
    if _SEED_DB.exists():
        with _copy_lock:
            if not _RUNTIME_DB.exists():
                shutil.copy2(str(_SEED_DB), str(_RUNTIME_DB))
        return str(_RUNTIME_DB)
    # 3. Local dev fallback
    return str(_API_DIR / "sovereign.duckdb")


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return a per-thread DuckDB connection. DuckDB connections are not
    thread-safe for shared use, so each thread gets its own handle."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        path = _runtime_db_path()
        conn = duckdb.connect(path)
        _init_schema(conn)   # CREATE TABLE IF NOT EXISTS — always safe
        _local.conn = conn
    return conn


def _init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("PRAGMA threads=4")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS world_bank_indicators (
            country_iso3    VARCHAR NOT NULL,
            indicator       VARCHAR NOT NULL,
            value           DOUBLE,
            year            INTEGER NOT NULL,
            fetched_at      TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (country_iso3, indicator, year)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sanctions (
            country_iso3              VARCHAR PRIMARY KEY,
            sanctioned_entity_count   INTEGER NOT NULL DEFAULT 0,
            is_primary_target         BOOLEAN NOT NULL DEFAULT FALSE,
            last_updated              TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_returns (
            ticker              VARCHAR NOT NULL,
            date                DATE NOT NULL,
            daily_return        DOUBLE,
            cumulative_1y       DOUBLE,
            volatility_21d      DOUBLE,
            PRIMARY KEY (ticker, date)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS correlations (
            country_a       VARCHAR NOT NULL,
            country_b       VARCHAR NOT NULL,
            correlation_30d DOUBLE,
            date            DATE NOT NULL,
            PRIMARY KEY (country_a, country_b, date)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_sentiment (
            country_iso3    VARCHAR NOT NULL,
            sentiment_score DOUBLE,
            article_count   INTEGER NOT NULL DEFAULT 0,
            fetched_at      TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (country_iso3, fetched_at)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sovereign_risk (
            country_iso3    VARCHAR NOT NULL,
            score           DOUBLE NOT NULL,
            tier            VARCHAR NOT NULL,
            sub_scores_json VARCHAR,
            computed_at     TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (country_iso3, computed_at)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS contagion_edges (
            source_country      VARCHAR NOT NULL,
            target_country      VARCHAR NOT NULL,
            transmission_weight DOUBLE NOT NULL,
            channel             VARCHAR NOT NULL,
            computed_at         TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (source_country, target_country, computed_at)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id                  VARCHAR PRIMARY KEY,
            country_iso3        VARCHAR NOT NULL,
            severity            VARCHAR NOT NULL,
            trigger             VARCHAR NOT NULL,
            message             VARCHAR NOT NULL,
            contagion_risk_json VARCHAR,
            portfolio_impact_pct DOUBLE,
            created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
            acknowledged        BOOLEAN NOT NULL DEFAULT FALSE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS ingest_log (
            source      VARCHAR NOT NULL,
            status      VARCHAR NOT NULL,
            rows_written INTEGER,
            error_msg   VARCHAR,
            ran_at      TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_articles (
            url             VARCHAR PRIMARY KEY,
            iso3            VARCHAR NOT NULL,
            title           VARCHAR,
            source          VARCHAR,
            published_at    TIMESTAMP,
            sentiment_score DOUBLE,
            event_type      VARCHAR,
            summary         VARCHAR,
            fetched_at      TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS gti_scores (
            country_iso3    VARCHAR PRIMARY KEY,
            gti             DOUBLE NOT NULL,
            tier            VARCHAR NOT NULL,
            components_json VARCHAR,
            computed_at     TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id              BIGINT PRIMARY KEY,     -- GDELT GlobalEventID
            event_date      DATE NOT NULL,
            cameo_code      VARCHAR NOT NULL,
            category        VARCHAR NOT NULL,       -- human label for cameo_code
            severity        VARCHAR NOT NULL,       -- major | significant | minor
            country_iso3    VARCHAR,                -- null when the location is unmapped
            place_name      VARCHAR,
            lat             DOUBLE,
            lng             DOUBLE,
            mentions        INTEGER NOT NULL DEFAULT 0,
            sources         INTEGER NOT NULL DEFAULT 0,
            goldstein       DOUBLE,
            source_url      VARCHAR,
            fetched_at      TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS weather_data (
            country_iso3    VARCHAR PRIMARY KEY,
            temp_c          DOUBLE,
            weather_code    INTEGER,
            weather_label   VARCHAR,
            weather_emoji   VARCHAR,
            wind_kmh        DOUBLE,
            is_severe       BOOLEAN NOT NULL DEFAULT FALSE,
            fetched_at      TIMESTAMP NOT NULL DEFAULT NOW()
        )
    """)


def log_ingest(source: str, status: str, rows: int = 0, error: str | None = None) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO ingest_log (source, status, rows_written, error_msg) VALUES (?, ?, ?, ?)",
        [source, status, rows, error],
    )


def utcnow() -> "datetime.datetime":
    """Naive UTC 'now', for writing into TIMESTAMP columns.

    DuckDB's TIMESTAMP is timezone-naive, and inserting a tz-aware datetime makes it
    convert to the *server's local* zone first. Every writer used datetime.now(utc), so
    the stored value silently became UTC on a UTC host and local time anywhere else —
    which made the age of a snapshot depend on where it was generated. Always store UTC.
    """
    from datetime import datetime as _dt, timezone as _tz
    return _dt.now(_tz.utc).replace(tzinfo=None)
