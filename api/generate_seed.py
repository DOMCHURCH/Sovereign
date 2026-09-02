"""
Run this locally from the api/ directory to regenerate sovereign_seed.duckdb.
Commit the output file — Vercel copies it to /tmp on cold start.
"""
import sys
import os
import pathlib

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

DB_PATH = str(HERE / "sovereign_seed.duckdb")

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
if os.path.exists(DB_PATH + ".wal"):
    os.remove(DB_PATH + ".wal")

# db.get_conn() resolves DATABASE_PATH first, so point it at the seed file. Setting
# db._conn directly no longer works — connections are thread-local as of the pooling
# change, so seed/analytics would have silently written to a different database.
os.environ["DATABASE_PATH"] = DB_PATH

import db as db_module
db_module.get_conn()

import seed
seed.run()

from analytics import country_risk, contagion, alerts
country_risk.run()
contagion.run()
alerts.run()

conn = db_module.get_conn()
rows = conn.execute("SELECT COUNT(*) FROM sovereign_risk").fetchone()[0]
print(f"sovereign_seed.duckdb written — {rows} risk scores computed")
print("note: this is the synthetic bootstrap. Use api/refresh_data.py to load live data.")
conn.close()
