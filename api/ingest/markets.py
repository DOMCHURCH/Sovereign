import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta
from db import get_conn, log_ingest

COUNTRY_ETFS = {
    "USA": "SPY", "CHN": "FXI", "JPN": "EWJ", "DEU": "EWG",
    "GBR": "EWU", "IND": "INDA", "BRA": "EWZ", "RUS": "ERUS",
    "KOR": "EWY", "AUS": "EWA", "CAN": "EWC", "FRA": "EWQ",
    "ITA": "EWI", "MEX": "EWW", "SAU": "KSA", "ZAF": "EZA",
    "SGP": "EWS", "HKG": "EWH", "TWN": "EWT", "ARG": "ARGT",
}

COMMODITIES = {
    "oil": "USO", "gold": "GLD", "natgas": "UNG", "wheat": "WEAT", "copper": "CPER",
}

ALL_TICKERS = list(COUNTRY_ETFS.values()) + list(COMMODITIES.values())


def _compute_features(prices: pd.Series) -> pd.DataFrame:
    ret = prices.pct_change().dropna()
    cum_1y = prices / prices.shift(252) - 1
    vol_21d = ret.rolling(21).std() * np.sqrt(252)
    df = pd.DataFrame({
        "daily_return": ret,
        "cumulative_1y": cum_1y,
        "volatility_21d": vol_21d,
    })
    return df.dropna(how="all")


def run() -> int:
    conn = get_conn()
    now = datetime.now(timezone.utc)
    end = now.date()
    start = end - timedelta(days=730)

    rows_written = 0

    import yfinance as yf
    data = yf.download(
        ALL_TICKERS,
        start=str(start),
        end=str(end),
        auto_adjust=True,
        progress=False,
    )

    close = data["Close"] if "Close" in data.columns else data

    for ticker in ALL_TICKERS:
        if ticker not in close.columns:
            continue
        prices = close[ticker].dropna()
        if prices.empty:
            continue

        feat = _compute_features(prices)
        for date, row in feat.iterrows():
            conn.execute(
                """
                INSERT INTO market_returns (ticker, date, daily_return, cumulative_1y, volatility_21d)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (ticker, date) DO UPDATE SET
                    daily_return   = excluded.daily_return,
                    cumulative_1y  = excluded.cumulative_1y,
                    volatility_21d = excluded.volatility_21d
                """,
                [
                    ticker,
                    date.date() if hasattr(date, "date") else date,
                    None if np.isnan(row.daily_return) else float(row.daily_return),
                    None if np.isnan(row.cumulative_1y) else float(row.cumulative_1y),
                    None if np.isnan(row.volatility_21d) else float(row.volatility_21d),
                ],
            )
            rows_written += 1

    _compute_correlations(conn, close, end)
    log_ingest("markets", "ok", rows_written)
    return rows_written


def _compute_correlations(conn, close: pd.DataFrame, as_of) -> None:
    etf_tickers = list(COUNTRY_ETFS.values())
    available = [t for t in etf_tickers if t in close.columns]
    returns = close[available].pct_change().dropna()

    window = returns.tail(30)
    if len(window) < 10:
        return

    corr_matrix = window.corr()

    ticker_to_iso3 = {v: k for k, v in COUNTRY_ETFS.items()}

    for i, ta in enumerate(available):
        for tb in available[i + 1:]:
            val = corr_matrix.loc[ta, tb]
            if np.isnan(val):
                continue
            iso_a = ticker_to_iso3.get(ta)
            iso_b = ticker_to_iso3.get(tb)
            if not iso_a or not iso_b:
                continue
            conn.execute(
                """
                INSERT INTO correlations (country_a, country_b, correlation_30d, date)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (country_a, country_b, date) DO UPDATE SET
                    correlation_30d = excluded.correlation_30d
                """,
                [iso_a, iso_b, float(val), as_of],
            )


if __name__ == "__main__":
    n = run()
    print(f"Markets: {n} rows written")
    conn = get_conn()
    rows = conn.execute(
        "SELECT ticker, date, daily_return, volatility_21d FROM market_returns WHERE ticker='SPY' ORDER BY date DESC LIMIT 5"
    ).fetchall()
    for row in rows:
        print(row)
    corr_rows = conn.execute(
        "SELECT country_a, country_b, correlation_30d FROM correlations ORDER BY date DESC LIMIT 5"
    ).fetchall()
    print("Correlations:", corr_rows)
