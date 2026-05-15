from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def _run_all_ingest():
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


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")

    # Full refresh every 6 hours
    scheduler.add_job(_run_all_ingest, CronTrigger(hour="*/6"), id="full_refresh", replace_existing=True)

    scheduler.start()
    return scheduler
