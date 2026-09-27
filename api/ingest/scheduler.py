from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta, timezone
import faulthandler
import signal
import sys
import os
import threading
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# A job that never returns is not a slow job, it is a wedged process. In September 2026
# one run hung inside the DuckDB layer, every later run was "skipped: maximum number of
# running instances reached", the API stopped answering and one core sat at 100% for
# three weeks (~$13 of CPU). A Python thread cannot be killed, so the only real bound is
# to exit the process and let Railway's restart policy bring up a clean one.
DEADLINES_S = {
    "news_gti": 30 * 60,
    "weather": 20 * 60,
    "full_refresh": 2 * 60 * 60,
    "boot_checkpoint": 10 * 60,
}

_running: dict[str, float] = {}
_running_lock = threading.Lock()

# Railway kills the container at 8 GB with no traceback, mid-write. Restarting ourselves
# between jobs, after a checkpoint, is the clean version of the same outcome.
RSS_RESTART_MB = int(os.getenv("RSS_RESTART_MB", "3000"))


def _rss_mb() -> float | None:
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass  # not Linux
    return None


def _memory_report() -> str:
    """RSS next to DuckDB's own accounting: if RSS climbs while DuckDB stays flat, the
    growth is outside DuckDB (allocator retention or Python objects)."""
    import gc
    rss = _rss_mb()
    try:
        from db import get_conn
        duck = get_conn().execute(
            "SELECT sum(memory_usage_bytes) FROM duckdb_memory()").fetchone()[0] / 1e6
    except Exception:
        duck = -1.0
    rss_txt = f"{rss:.0f}MB" if rss is not None else "n/a"
    return f"rss={rss_txt} duckdb={duck:.0f}MB pyobjs={len(gc.get_objects())}"


def _tracked(job_id: str, fn):
    def wrapper():
        started = time.monotonic()
        with _running_lock:
            _running[job_id] = started
        print(f"[scheduler] {job_id} started", flush=True)
        try:
            fn()
            print(f"[scheduler] {job_id} finished in {time.monotonic() - started:.0f}s "
                  f"[{_memory_report()}]", flush=True)
        except Exception:
            print(f"[scheduler] {job_id} failed:\n{traceback.format_exc()}", flush=True)
        finally:
            with _running_lock:
                _running.pop(job_id, None)
        rss = _rss_mb()
        if rss is not None and rss > RSS_RESTART_MB:
            print(f"[scheduler] rss {rss:.0f}MB > {RSS_RESTART_MB}MB; checkpointing and "
                  "exiting so the container restarts clean", flush=True)
            try:
                from db import get_conn
                get_conn().execute("CHECKPOINT")
            except Exception:
                traceback.print_exc()
            sys.stdout.flush()
            os._exit(1)
    return wrapper


def _watchdog():
    while True:
        time.sleep(60)
        now = time.monotonic()
        with _running_lock:
            overdue = [(j, now - t) for j, t in _running.items() if now - t > DEADLINES_S[j]]
        if overdue:
            for job_id, age in overdue:
                print(f"[watchdog] {job_id} has run {age:.0f}s, past its deadline; "
                      "dumping threads and exiting so the container restarts", flush=True)
            faulthandler.dump_traceback(all_threads=True)
            sys.stderr.flush()
            os._exit(1)


def _run_news_and_gti():
    """Fast cycle: news + events + GTI every hour.

    Events belong on the fast cycle, not the 6-hourly one: the feed should be current.
    GDELT publishes every 15 minutes, but the site gets little traffic, so hourly is
    fresh enough and costs a quarter of the CPU. events.py reads the last 2 hours of
    exports, so an hourly run still sees every file.
    """
    from ingest import news, events
    from analytics import gti
    news.run()
    events.run()
    gti.run()


def _run_full():
    """Full refresh every 6 hours."""
    from ingest import world_bank, sanctions, markets, news, gdelt
    from ingest import weather as weather_ingest
    from analytics import country_risk, contagion, portfolio_impact, alerts, gti
    world_bank.run()
    sanctions.run()
    markets.run()
    news.run()
    weather_ingest.run()
    # After news.run(), so GDELT sees what RSS already covered and only fills the gaps.
    # Rate-limited to one request per 5s, so this is 6-hourly work, never hourly.
    gdelt.run()
    country_risk.run()
    contagion.run()
    portfolio_impact.run()
    alerts.run()
    gti.run()


def _run_weather():
    """Weather refresh every 2 hours."""
    from ingest import weather as weather_ingest
    weather_ingest.run()


def start_scheduler(backfill: bool = False) -> BackgroundScheduler:
    # `kill -USR1 1` inside the container prints every thread's stack to the logs.
    try:
        faulthandler.register(signal.SIGUSR1, all_threads=True)
    except (AttributeError, ValueError):
        pass  # not available on Windows dev machines

    # One worker: the jobs all upsert into the same DuckDB file, and running them side by
    # side is what wedged the process. A job that comes due while another runs waits for
    # it, and coalesce folds a backlog into a single run instead of a burst.
    scheduler = BackgroundScheduler(
        timezone="UTC",
        executors={"default": ThreadPoolExecutor(1)},
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 30 * 60},
    )

    # After every unclean exit (OOM kill, watchdog) the next boot's first
    # `INSERT ... ON CONFLICT (url)` into news_articles hung until the watchdog fired, boot
    # after boot, and only cleared once a full refresh happened to run first. Folding the
    # replayed WAL into the file before any job writes breaks that loop. It runs as a job
    # so the watchdog bounds it too.
    def _checkpoint():
        from db import get_conn
        get_conn().execute("CHECKPOINT")

    scheduler.add_job(
        _tracked("boot_checkpoint", _checkpoint),
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=5),
        id="boot_checkpoint",
        replace_existing=True,
    )

    # Fast cycle: news sentiment + events + GTI every hour
    scheduler.add_job(
        _tracked("news_gti", _run_news_and_gti),
        IntervalTrigger(hours=1),
        id="news_gti",
        replace_existing=True,
    )

    # Full data refresh every 6 hours; on a stale boot, also once right away.
    full_kwargs = {}
    if backfill:
        full_kwargs["next_run_time"] = datetime.now(timezone.utc) + timedelta(seconds=10)
    scheduler.add_job(
        _tracked("full_refresh", _run_full),
        CronTrigger(hour="*/6"),
        id="full_refresh",
        replace_existing=True,
        **full_kwargs,
    )

    scheduler.add_job(
        _tracked("weather", _run_weather),
        IntervalTrigger(hours=2),
        id="weather",
        replace_existing=True,
    )

    try:
        from db import get_conn
        limit = get_conn().execute("SELECT current_setting('memory_limit')").fetchone()[0]
        print(f"[scheduler] duckdb memory_limit={limit} [{_memory_report()}]", flush=True)
    except Exception:
        traceback.print_exc()

    threading.Thread(target=_watchdog, name="scheduler-watchdog", daemon=True).start()
    scheduler.start()
    return scheduler
