"""
Weather ingest via Open-Meteo (free, no API key required).
Fetches current conditions for 60+ country capitals every 2 hours.
Severe: WMO code >= 95 (thunderstorm/hail) OR temp > 42°C OR temp < -30°C.
"""
import requests
from datetime import datetime, timezone
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from db import get_conn, log_ingest, utcnow

CAPITALS = {
    "AFG": (34.5, 69.2), "AGO": (-8.8, 13.2), "ARG": (-34.6, -58.4),
    "ARM": (40.2, 44.5), "AUS": (-35.3, 149.1), "AZE": (40.4, 49.9),
    "BDI": (-3.4, 29.4), "BGD": (23.7, 90.4), "BLR": (53.9, 27.6),
    "BRA": (-15.8, -47.9), "BFA": (12.4, -1.5), "CAF": (4.4, 18.6),
    "CAN": (45.4, -75.7), "CHN": (39.9, 116.4), "CIV": (5.4, -4.0),
    "COD": (-4.3, 15.3), "COL": (4.7, -74.1), "DEU": (52.5, 13.4),
    "DZA": (36.7, 3.0), "EGY": (30.1, 31.2), "ESP": (40.4, -3.7),
    "ETH": (9.0, 38.7), "FRA": (48.9, 2.3), "GBR": (51.5, -0.1),
    "GHA": (5.6, -0.2), "HTI": (18.5, -72.3), "IDN": (-6.2, 106.8),
    "IND": (28.6, 77.2), "IRN": (35.7, 51.4), "IRQ": (33.3, 44.4),
    "ISR": (31.8, 35.2), "ITA": (41.9, 12.5), "JPN": (35.7, 139.7),
    "KAZ": (51.2, 71.5), "KEN": (-1.3, 36.8), "KOR": (37.6, 127.0),
    "LBN": (33.9, 35.5), "LBY": (32.9, 13.2), "MAR": (34.0, -6.8),
    "MEX": (19.4, -99.1), "MLI": (12.6, -8.0), "MMR": (19.7, 96.1),
    "MOZ": (-25.9, 32.6), "MYS": (3.2, 101.7), "NER": (13.5, 2.1),
    "NGA": (9.1, 7.2), "NIC": (12.1, -86.3), "NOR": (59.9, 10.7),
    "PAK": (33.7, 73.1), "PHL": (14.6, 121.0), "POL": (52.2, 21.0),
    "PRK": (39.0, 125.8), "RUS": (55.8, 37.6), "RWA": (-1.9, 30.1),
    "SAU": (24.7, 46.7), "SDN": (15.6, 32.5), "SGP": (1.3, 103.8),
    "SOM": (2.0, 45.3), "SSD": (4.9, 31.6), "SWE": (59.3, 18.1),
    "SYR": (33.5, 36.3), "THA": (13.8, 100.5), "TUR": (39.9, 32.9),
    "TWN": (25.0, 121.5), "TZA": (-6.2, 35.7), "UKR": (50.4, 30.5),
    "USA": (38.9, -77.0), "VEN": (10.5, -66.9), "YEM": (15.4, 44.2),
    "ZAF": (-25.7, 28.2), "ZWE": (-17.8, 31.1), "MLI": (12.6, -8.0),
    "NLD": (52.1, 4.3), "CMR": (3.9, 11.5),
}

WMO_LABEL = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Severe thunderstorm",
}

WMO_EMOJI = {
    0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌧️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    71: "❄️", 73: "❄️", 75: "❄️", 77: "❄️",
    80: "🌦️", 81: "🌧️", 82: "⛈️",
    85: "🌨️", 86: "🌨️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}


def _is_severe(code: int, temp_c: float) -> bool:
    return code >= 95 or temp_c > 42.0 or temp_c < -30.0


def run() -> int:
    conn = get_conn()
    now = utcnow()
    rows_written = 0

    for iso3, (lat, lng) in CAPITALS.items():
        try:
            resp = requests.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lng,
                    "current_weather": "true",
                    "wind_speed_unit": "kmh",
                },
                timeout=10,
            )
            if not resp.ok:
                continue
            cw = resp.json().get("current_weather", {})
            if not cw:
                continue

            temp_c = float(cw.get("temperature", 0))
            code = int(cw.get("weathercode", 0))
            wind_kmh = float(cw.get("windspeed", 0))
            label = WMO_LABEL.get(code, "Unknown")
            emoji = WMO_EMOJI.get(code, "🌡️")

            conn.execute(
                """
                INSERT INTO weather_data
                    (country_iso3, temp_c, weather_code, weather_label, weather_emoji, wind_kmh, is_severe, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (country_iso3) DO UPDATE SET
                    temp_c = excluded.temp_c,
                    weather_code = excluded.weather_code,
                    weather_label = excluded.weather_label,
                    weather_emoji = excluded.weather_emoji,
                    wind_kmh = excluded.wind_kmh,
                    is_severe = excluded.is_severe,
                    fetched_at = excluded.fetched_at
                """,
                [iso3, temp_c, code, label, emoji, wind_kmh, _is_severe(code, temp_c), now],
            )
            rows_written += 1
        except Exception:
            continue

    log_ingest("weather", "ok", rows_written)
    return rows_written


if __name__ == "__main__":
    n = run()
    print(f"Weather: {n} rows written")
