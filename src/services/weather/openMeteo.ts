import { ApiError } from "../../http/errors";
import { redactSecrets } from "../../utils/redaction";
import type { GeoPoint, RawDailyWeather, WeatherProvider } from "./types";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
/** Open-Meteo's maximum; always request all of it and pick the dates we need. */
export const FORECAST_DAYS = 16;

const DEFAULT_TIMEOUT_MS = 15_000;

const FORECAST_DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "uv_index_max"
] as const;

// The archive (reanalysis) has no probability or UV index.
const HISTORY_DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max"
] as const;

type OpenMeteoProviderOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  forecastUrl?: string;
  archiveUrl?: string;
};

export function weatherUnavailable(message = "Weather provider is unavailable.") {
  return new ApiError(503, "WEATHER_PROVIDER_UNAVAILABLE", message);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Converts Open-Meteo's column-oriented `daily` block into one row per date. */
export function parseOpenMeteoDaily(body: unknown): RawDailyWeather[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw weatherUnavailable("Weather provider returned an invalid payload.");
  }
  const daily = (body as { daily?: unknown }).daily;
  if (typeof daily !== "object" || daily === null || Array.isArray(daily)) {
    throw weatherUnavailable("Weather provider returned no daily data.");
  }

  const columns = daily as Record<string, unknown>;
  const at = (name: string, index: number) => {
    const values = columns[name];
    return Array.isArray(values) ? finiteOrNull(values[index]) : null;
  };
  const times = Array.isArray(columns.time) ? columns.time : [];

  const rows: RawDailyWeather[] = [];
  times.forEach((date, index) => {
    if (typeof date !== "string") return;
    rows.push({
      date,
      weatherCode: at("weather_code", index),
      temperatureMaxC: at("temperature_2m_max", index),
      temperatureMinC: at("temperature_2m_min", index),
      precipitationProbabilityPct: at("precipitation_probability_max", index),
      precipitationMm: at("precipitation_sum", index),
      windSpeedMaxKph: at("wind_speed_10m_max", index),
      uvIndexMax: at("uv_index_max", index)
    });
  });
  return rows;
}

async function getJson(fetchImpl: typeof fetch, url: URL, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        redactSecrets(`[Weather] Open-Meteo request failed: ${response.status} ${url.pathname} ${body.slice(0, 300)}`)
      );
      throw weatherUnavailable(`Weather provider returned ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw weatherUnavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function setCoordinates(url: URL, location: GeoPoint) {
  url.searchParams.set("latitude", location.latitude.toFixed(4));
  url.searchParams.set("longitude", location.longitude.toFixed(4));
  // Dates come back in the location's own calendar, which is what a traveler reads.
  url.searchParams.set("timezone", "auto");
}

export function createOpenMeteoProvider(options: OpenMeteoProviderOptions = {}): WeatherProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forecastUrl = options.forecastUrl ?? OPEN_METEO_FORECAST_URL;
  const archiveUrl = options.archiveUrl ?? OPEN_METEO_ARCHIVE_URL;

  return {
    name: "open-meteo",

    async getDailyForecast(location) {
      const url = new URL(forecastUrl);
      setCoordinates(url, location);
      url.searchParams.set("daily", FORECAST_DAILY_FIELDS.join(","));
      url.searchParams.set("forecast_days", String(FORECAST_DAYS));
      return parseOpenMeteoDaily(await getJson(fetchImpl, url, timeoutMs));
    },

    async getDailyHistory(location, startDate, endDate) {
      const url = new URL(archiveUrl);
      setCoordinates(url, location);
      url.searchParams.set("daily", HISTORY_DAILY_FIELDS.join(","));
      url.searchParams.set("start_date", startDate);
      url.searchParams.set("end_date", endDate);
      return parseOpenMeteoDaily(await getJson(fetchImpl, url, timeoutMs));
    }
  };
}
