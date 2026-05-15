"""
Run this locally from the api/ directory to regenerate sovereign_seed.duckdb.
Commit the output file — Vercel copies it to /tmp on cold start.
"""
import sys
import os
import pathlib
import duckdb

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

DB_PATH = str(HERE / "sovereign_seed.duckdb")

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
if os.path.exists(DB_PATH + ".wal"):
    os.remove(DB_PATH + ".wal")

import db as db_module
db_module._conn = duckdb.connect(DB_PATH)
db_module._init_schema(db_module._conn)

import seed
seed.run()

from analytics import country_risk, contagion, alerts
country_risk.run()
contagion.run()
alerts.run()

rows = db_module._conn.execute("SELECT COUNT(*) FROM sovereign_risk").fetchone()[0]
print(f"sovereign_seed.duckdb written — {rows} risk scores computed")
db_module._conn.close()
db_module._conn = None
