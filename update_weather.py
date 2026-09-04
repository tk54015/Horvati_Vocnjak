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
        max_temperature = parse_max_temperature(values[5])
        forecast.append({
            "date": values[0],
            "night": values[1],
            "morning": values[2],
            "afternoon": values[3],
            "evening": values[4],
            "temperature": values[5],
            "wind": values[6],
            "precipitation": values[7] if len(values) > 7 else "",
            "maxTemperatureC": max_temperature,
            "heatPoints": calculate_heat_points(max_temperature),
        })
    if not forecast:
        raise RuntimeError("DHMZ prognoza nema očekivane retke")
    return forecast[:7]


def parse_max_temperature(value):
    match = re.search(r"-?\d+(?:[.,]\d+)?", value or "")
    return float(match.group(0).replace(",", ".")) if match else None


def calculate_heat_points(temperature):
    if temperature is None or temperature <= 25:
        return 0.0
    if temperature <= 30:
        return round((temperature - 25) * 0.2, 1)
    return round(min(2.0, 1.0 + (temperature - 30) * 0.1), 1)


def parse_rainfall(html):
    for row in re.findall(r"<tr\b[^>]*>.*?</tr>", html, re.I | re.S):
        values = cells(row)
        if values and re.search(r"rakov\s+potok", values[0], re.I):
            match = re.search(r"\d+(?:[.,]\d+)?", values[-1])
            if match:
                return float(match.group(0).replace(",", ".")), True
    return 0.0, False


def parse_rainfall_observation_date(html):
    match = re.search(r"izmjerena\s+(\d{2}\.\d{2}\.\d{4})\.?\s+u\s+(\d{1,2})\s+sati", html, re.I)
    if not match:
        raise RuntimeError("DHMZ datum mjerenja oborine nije pronađen")
    day, month, year = match.group(1).rstrip(".").split(".")
    return f"{year}-{month}-{day}", f"{match.group(1)} u {match.group(2)} sati"


def history_observation_date(item):
    return item.get("observationDate") or str(item.get("recordedAt", ""))[:10]


def main():
    forecast_html = download(FORECAST_URL)
    rain_html = download(RAIN_URL)
    forecast = parse_forecast(forecast_html)
    rain_mm, station_reported = parse_rainfall(rain_html)
    observation_date, measurement_period = parse_rainfall_observation_date(rain_html)
    now = datetime.now(timezone.utc).isoformat()

    existing = {}
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}

    known_dates = {
        str(item.get("observationDate"))
        for item in existing.get("rainfallHistory", [])
        if item.get("observationDate")
    }
    if observation_date in known_dates:
        previous_record = existing.get("rainfall24h", {})
    elif known_dates and observation_date < max(known_dates):
        print(f"DHMZ vraća stariji zapis {observation_date}; čeka se noviji podatak.")
        return
    else:
        previous_record = existing.get("rainfall24h", {})

    previous_record = existing.get("rainfall24h", {})
    same_measurement = (
        previous_record.get("observationDate") == observation_date
        and previous_record.get("rainfallMm") == rain_mm
        and previous_record.get("stationReported") == station_reported
        and previous_record.get("maxTemperatureC") == forecast[0].get("maxTemperatureC")
    )
    record = {
        "observationDate": observation_date,
        "measurementPeriod": measurement_period,
        "recordedAt": now,
        "rainfallMm": rain_mm,
        "stationReported": station_reported,
        "maxTemperatureC": forecast[0].get("maxTemperatureC"),
        "heatPoints": forecast[0].get("heatPoints", 0.0),
        "source": RAIN_URL,
    }
    if same_measurement:
        record = previous_record
    history = existing.get("rainfallHistory", [])
    history = [item for item in history if history_observation_date(item) != observation_date]
    history.append(record)
    forecast_changed = existing.get("forecast") != forecast
    data = {
        "updatedAt": now if not same_measurement or forecast_changed else existing.get("updatedAt", now),
        "forecastSource": FORECAST_URL,
        "forecastLocation": "Zagreb-Maksimir",
        "forecast": forecast,
        "rainfall24h": record,
        "rainfallHistory": history[-365:],
    }
    if data == existing:
        print(f"Podatak za {observation_date} je već aktualan; bez novih promjena.")
        return
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Spremljeno: {OUTPUT}")
    print(f"Rakov Potok: {rain_mm:g} mm za {measurement_period} (postaja navedena: {station_reported})")


if __name__ == "__main__":
    main()