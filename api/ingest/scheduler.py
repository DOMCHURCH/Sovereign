from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


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


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")

    # Fast cycle: news sentiment + GTI every 15 minutes
    scheduler.add_job(
        _run_news_and_gti,
        IntervalTrigger(minutes=15),
        id="news_gti",
        replace_existing=True,
    )

    # Full data refresh every 6 hours
    scheduler.add_job(
        _run_full,
        CronTrigger(hour="*/6"),
        id="full_refresh",
        replace_existing=True,
    )

    scheduler.add_job(
        _run_weather,
        IntervalTrigger(hours=2),
        id="weather",
        replace_existing=True,
    )

    scheduler.start()
    return scheduler
