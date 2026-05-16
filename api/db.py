import os
import shutil
import duckdb
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

_API_DIR = Path(__file__).parent
_SEED_DB = _API_DIR / "sovereign_seed.duckdb"
_RUNTIME_DB = Path("/tmp/sovereign.duckdb")

_conn: duckdb.DuckDBPyConnection | None = None


def get_conn() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        if _SEED_DB.exists():
            # Copy pre-seeded DB to /tmp (writable) on cold start
            if not _RUNTIME_DB.exists():
                shutil.copy2(str(_SEED_DB), str(_RUNTIME_DB))
            _conn = duckdb.connect(str(_RUNTIME_DB))
        else:
            # Local dev fallback: file next to db.py
            _conn = duckdb.connect(str(_API_DIR / "sovereign.duckdb"))
            _init_schema(_conn)
    return _conn


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


def log_ingest(source: str, status: str, rows: int = 0, error: str | None = None) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO ingest_log (source, status, rows_written, error_msg) VALUES (?, ?, ?, ?)",
        [source, status, rows, error],
    )
