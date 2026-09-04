import json
import re
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "data" / "weather.json"
FORECAST_URL = "https://meteo.hr/prognoze.php?section=prognoze_model&param=7d"
RAIN_URL = "https://meteo.hr/podaci.php?section=podaci_vrijeme&param=oborina"


def download(url):
    request = Request(url, headers={"User-Agent": "HorvatiVockeWeather/1.0"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def cells(row):
    values = re.findall(r"<(?:td|th)\b[^>]*>(.*?)</(?:td|th)>", row, re.I | re.S)
    return [re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", value))).strip() for value in values]


def parse_forecast(html):
    table_match = re.search(r"<table\b[^>]*>.*?</table>", html, re.I | re.S)
    if not table_match:
        raise RuntimeError("DHMZ tablica prognoze nije pronađena")

    rows = re.findall(r"<tr\b[^>]*>.*?</tr>", table_match.group(0), re.I | re.S)
    forecast = []
    for row in rows:
        values = cells(row)
        if len(values) < 7 or not re.search(r"\d{2}\.\d{2}\.\d{4}", values[0]):
            continue
        forecast.append({
            "date": values[0],
            "night": values[1],
            "morning": values[2],
            "afternoon": values[3],
            "evening": values[4],
            "temperature": values[5],
            "wind": values[6],
            "precipitation": values[7] if len(values) > 7 else ""
        })
    if not forecast:
        raise RuntimeError("DHMZ prognoza nema očekivane retke")
    return forecast[:7]


def parse_rainfall(html):
    for row in re.findall(r"<tr\b[^>]*>.*?</tr>", html, re.I | re.S):
        values = cells(row)
        if values and re.search(r"rakov\s+potok", values[0], re.I):
            match = re.search(r"\d+(?:[.,]\d+)?", values[-1])
            if match:
                return float(match.group(0).replace(",", ".")), True
    return 0.0, False


def main():
    forecast_html = download(FORECAST_URL)
    rain_html = download(RAIN_URL)
    rain_mm, station_reported = parse_rainfall(rain_html)
    now = datetime.now(timezone.utc).isoformat()

    existing = {}
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}

    record = {
        "recordedAt": now,
        "rainfallMm": rain_mm,
        "stationReported": station_reported,
        "source": RAIN_URL,
    }
    history = existing.get("rainfallHistory", [])
    record_date = now[:10]
    history = [item for item in history if not str(item.get("recordedAt", "")).startswith(record_date)]
    history.append(record)
    data = {
        "updatedAt": now,
        "forecastSource": FORECAST_URL,
        "forecastLocation": "Zagreb-Maksimir",
        "forecast": parse_forecast(forecast_html),
        "rainfall24h": record,
        "rainfallHistory": history[-365:],
    }
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Spremljeno: {OUTPUT}")
    print(f"Rakov Potok: {rain_mm:g} mm (postaja navedena: {station_reported})")


if __name__ == "__main__":
    main()