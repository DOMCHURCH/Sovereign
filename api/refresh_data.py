"""Rebuild the committed DuckDB snapshot from live sources.

Why this exists
---------------
On Vercel the API runs as a serverless function with an ephemeral filesystem: `db.py`
copies `sovereign_seed.duckdb` into `/tmp` per container, so anything the request path
writes is discarded when the container freezes. Running the ingest at request time
therefore burns upstream rate limit and persists nothing — which is how the deployed
snapshot ended up frozen at its bootstrap date while the UI still advertised "LIVE".

On Railway this is no longer how the refresh happens — the service has a real volume and
`ingest/scheduler.py` runs the cycles in-process. This script remains the way to rebuild
the committed `sovereign_seed.duckdb`, which is what seeds a fresh volume on first boot
(see db._runtime_db_path) and what a local checkout runs against.

This *appends* to the existing file rather than rebuilding from empty, which matters:
`sovereign_risk` is keyed on (country_iso3, computed_at), so successive runs accumulate
the history that `delta_7d` and the 90-day country chart read from. A wipe-and-rebuild
would permanently pin every delta at 0.00.

Usage:  python api/refresh_data.py   # then commit the updated seed
"""
import os
import pathlib
import sys
import traceback

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

# Point db.get_conn() at the committed seed file itself, not the /tmp runtime copy.
SEED = HERE / "sovereign_seed.duckdb"
os.environ["DATABASE_PATH"] = str(SEED)

from db import get_conn  # noqa: E402  (must follow the env var above)

# Ingest first, then analytics — the analytics stages read what ingest wrote.
# acled exposes fetch_recent_events(), not run() — it is pulled in on demand by the
# conflicts endpoint rather than being a snapshot stage.
INGEST_STAGES = ["world_bank", "sanctions", "markets", "news", "weather", "rss"]
ANALYTICS_STAGES = ["country_risk", "contagion", "portfolio_impact", "alerts", "gti"]


def _run_stage(module_path: str, name: str) -> bool:
    """Run one pipeline stage. A single failing source must not abort the refresh."""
    try:
        mod = __import__(f"{module_path}.{name}", fromlist=["run"])
    except Exception as e:
        print(f"  ! {name}: import failed ({e})", flush=True)
        return False
    try:
        result = mod.run()
        # Some stages return their whole result set; keep the log to one line.
        summary = len(result) if hasattr(result, "__len__") else result
        print(f"  + {name}: ok ({summary})", flush=True)
        return True
    except Exception:
        print(f"  ! {name}: failed", flush=True)
        traceback.print_exc()
        return False


def main() -> int:
    if not SEED.exists():
        print(f"error: {SEED} not found — run api/generate_seed.py to bootstrap first")
        return 1

    conn = get_conn()
    before = conn.execute("SELECT COUNT(*) FROM sovereign_risk").fetchone()[0]

    print("ingest:", flush=True)
    ingest_ok = sum(_run_stage("ingest", s) for s in INGEST_STAGES)

    if ingest_ok == 0:
        # Every upstream source failed. Committing now would append a snapshot derived
        # from nothing and pollute the history the deltas are computed from.
        print("error: every ingest stage failed — refusing to write a snapshot")
        return 1

    print("analytics:", flush=True)
    for s in ANALYTICS_STAGES:
        _run_stage("analytics", s)

    row = conn.execute(
        "SELECT COUNT(*), MAX(computed_at) FROM sovereign_risk"
    ).fetchone()
    after, latest = row[0], row[1]
    countries = conn.execute(
        "SELECT COUNT(DISTINCT country_iso3) FROM sovereign_risk WHERE computed_at = ?",
        [latest],
    ).fetchone()[0]
    conn.close()

    print(
        f"\nsnapshot written: {countries} countries scored at {latest} "
        f"({before} -> {after} total rows, {ingest_ok}/{len(INGEST_STAGES)} sources ok)"
    )
    if countries == 0:
        print("error: snapshot contains no scored countries")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
