import json
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "data" / "weather.json"
FORECAST_URL = "https://meteo.hr/prognoze.php?section=prognoze_model&param=7d"
RAIN_URL = "https://meteo.hr/podaci.php?section=podaci_vrijeme&param=oborina"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# Srediste poligona Horvati212.kml; Open-Meteo bira najblizu modelsku tocku.
OPEN_METEO_LATITUDE = 45.71205
OPEN_METEO_LONGITUDE = 15.81212
BACKFILL_START_DATE = "2026-07-01"
BACKFILL_ARCHIVE_START_DATE = "2026-06-30"


def download(url):
    request = Request(url, headers={"User-Agent": "HorvatiVockeWeather/1.0"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def download_json(url):
    return json.loads(download(url))


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


def get_open_meteo_archive(start_date):
    url = (
        f"{OPEN_METEO_ARCHIVE_URL}?latitude={OPEN_METEO_LATITUDE}"
        f"&longitude={OPEN_METEO_LONGITUDE}&start_date={start_date}"
        f"&end_date={start_date}"
        "&daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FZagreb"
    )
    data = download_json(url)
    daily = data.get("daily", {})
    temperatures = daily.get("temperature_2m_max", [])
    precipitation = daily.get("precipitation_sum", [])
    if not temperatures or not precipitation:
        raise RuntimeError(f"Open-Meteo nema arhivu za {start_date}")
    return float(temperatures[0]), float(precipitation[0]), url


def get_open_meteo_archive_range(start_date, end_date):
    url = (
        f"{OPEN_METEO_ARCHIVE_URL}?latitude={OPEN_METEO_LATITUDE}"
        f"&longitude={OPEN_METEO_LONGITUDE}&start_date={start_date}"
        f"&end_date={end_date}"
        "&daily=temperature_2m_max,precipitation_sum&timezone=Europe%2FZagreb"
    )
    data = download_json(url)
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temperatures = daily.get("temperature_2m_max", [])
    precipitation = daily.get("precipitation_sum", [])
    return {
        date: {
            "temperature": float(temperatures[index]),
            "rainfall": float(precipitation[index]),
        }
        for index, date in enumerate(dates)
        if index < len(temperatures) and index < len(precipitation)
    }, url


def history_observation_date(item):
    return item.get("observationDate") or str(item.get("recordedAt", ""))[:10]


def normalize_history_item(item):
    item = dict(item)
    if item.get("measurementEndDate") and item.get("periodStartDate"):
        item["observationDate"] = item["periodStartDate"]
    elif item.get("measurementPeriod") and item.get("observationDate"):
        end_date = datetime.strptime(item["observationDate"], "%Y-%m-%d").date()
        item["observationDate"] = (end_date - timedelta(days=1)).isoformat()
        item["periodStartDate"] = item["observationDate"]
        item["measurementEndDate"] = end_date.isoformat()
    return item


def main():
    forecast_html = download(FORECAST_URL)
    rain_html = download(RAIN_URL)
    forecast = parse_forecast(forecast_html)
    rain_mm, station_reported = parse_rainfall(rain_html)
    observation_date, measurement_period = parse_rainfall_observation_date(rain_html)
    period_start = (datetime.strptime(observation_date, "%Y-%m-%d") - timedelta(days=1)).date().isoformat()
    open_meteo_temperature, open_meteo_rain, open_meteo_source = get_open_meteo_archive(period_start)
    now = datetime.now(timezone.utc).isoformat()
    backfill_end_date = (datetime.now().date() - timedelta(days=1)).isoformat()
    open_meteo_history, open_meteo_history_source = get_open_meteo_archive_range(
        BACKFILL_ARCHIVE_START_DATE,
        backfill_end_date,
    )

    existing = {}
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}

    previous_record = existing.get("rainfall24h", {})
    previous_end_date = previous_record.get("measurementEndDate")
    if previous_end_date and observation_date < previous_end_date:
        print(f"DHMZ vraća stariji zapis {observation_date}; čeka se noviji podatak.")
        return
    same_measurement = (
        previous_record.get("observationDate") == period_start
        and previous_record.get("measurementEndDate") == observation_date
        and previous_record.get("rainfallMm") == rain_mm
        and previous_record.get("stationReported") == station_reported
        and previous_record.get("openMeteoMaxTemperatureC") == open_meteo_temperature
        and previous_record.get("openMeteoRainfallMm") == open_meteo_rain
    )
    record = {
        "observationDate": period_start,
        "measurementEndDate": observation_date,
        "measurementPeriod": measurement_period,
        "recordedAt": now,
        "rainfallMm": rain_mm,
        "stationReported": station_reported,
        "periodStartDate": period_start,
        "openMeteoRainfallMm": open_meteo_rain,
        "openMeteoMaxTemperatureC": open_meteo_temperature,
        "openMeteoSource": open_meteo_source,
        "maxTemperatureC": open_meteo_temperature,
        "heatPoints": calculate_heat_points(open_meteo_temperature),
        "source": RAIN_URL,
    }
    if same_measurement:
        record = previous_record
    history = [dict(item) for item in existing.get("rainfallHistory", [])]
    history_by_date = {}
    for item in history:
        item = normalize_history_item(item)
        item_date = history_observation_date(item)
        if item_date not in history_by_date or item.get("measurementPeriod"):
            history_by_date[item_date] = item
    history_by_date[period_start] = record
    start_date = datetime.strptime(BACKFILL_START_DATE, "%Y-%m-%d").date()
    end_date = datetime.strptime(backfill_end_date, "%Y-%m-%d").date()
    current_date = start_date
    while current_date <= end_date:
        item_date = current_date.isoformat()
        archive = open_meteo_history.get(item_date)
        existing_dhmz_record = "measurementPeriod" in history_by_date.get(item_date, {})
        archive_date = item_date
        if existing_dhmz_record:
            archive_date = history_by_date[item_date].get("periodStartDate") or (
                current_date - timedelta(days=1)
            ).isoformat()
            archive = open_meteo_history.get(archive_date)
        if archive:
            item = history_by_date.get(item_date, {
                "observationDate": item_date,
                "recordedAt": now,
                "rainfallMm": "NEPOZNATO",
                "stationReported": False,
                "source": RAIN_URL,
            })
            if existing_dhmz_record:
                item["periodStartDate"] = archive_date
                if item.get("rainfallMm") == "NEPOZNATO":
                    item["rainfallMm"] = 0.0
                    item.pop("rainfallStatus", None)
            else:
                item.pop("periodStartDate", None)
            item["openMeteoRainfallMm"] = archive["rainfall"]
            item["openMeteoMaxTemperatureC"] = archive["temperature"]
            item["openMeteoSource"] = open_meteo_history_source
            item["maxTemperatureC"] = archive["temperature"]
            item["heatPoints"] = calculate_heat_points(archive["temperature"])
            item["observationDate"] = item_date
            if not existing_dhmz_record:
                item["rainfallMm"] = "NEPOZNATO"
                item["rainfallStatus"] = "unknown"
            history_by_date[item_date] = item
        current_date += timedelta(days=1)
    history = [
        history_by_date[key]
        for key in sorted(history_by_date)
        if key <= backfill_end_date
    ][-365:]
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