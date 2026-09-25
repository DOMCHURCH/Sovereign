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
    "news_gti": 20 * 60,
    "weather": 20 * 60,
    "full_refresh": 2 * 60 * 60,
}

_running: dict[str, float] = {}
_running_lock = threading.Lock()


def _tracked(job_id: str, fn):
    def wrapper():
        started = time.monotonic()
        with _running_lock:
            _running[job_id] = started
        print(f"[scheduler] {job_id} started", flush=True)
        try:
            fn()
            print(f"[scheduler] {job_id} finished in {time.monotonic() - started:.0f}s", flush=True)
        except Exception:
            print(f"[scheduler] {job_id} failed:\n{traceback.format_exc()}", flush=True)
        finally:
            with _running_lock:
                _running.pop(job_id, None)
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
    """Fast cycle: news + events + GTI every 15 minutes.

    Events belong on the fast cycle, not the 6-hourly one: GDELT publishes a new export
    every 15 minutes and the whole point of the feed is that it is current.
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
    # Rate-limited to one request per 5s, so this is 6-hourly work, never 15-minute.
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

    # Fast cycle: news sentiment + GTI every 15 minutes
    scheduler.add_job(
        _tracked("news_gti", _run_news_and_gti),
        IntervalTrigger(minutes=15),
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

    threading.Thread(target=_watchdog, name="scheduler-watchdog", daemon=True).start()
    scheduler.start()
    return scheduler
