import type { GeoPoint } from "../maps/types";

export type { GeoPoint };

export type WeatherCondition =
  | "CLEAR"
  | "PARTLY_CLOUDY"
  | "CLOUDY"
  | "FOG"
  | "DRIZZLE"
  | "RAIN"
  | "HEAVY_RAIN"
  | "THUNDERSTORM"
  | "SNOW"
  | "UNKNOWN";

/** One day as the provider reports it, in the location's local calendar. */
export type RawDailyWeather = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  /** Forecast only; history has no probability. */
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  windSpeedMaxKph: number | null;
  /** Forecast only; the archive has no UV index. */
  uvIndexMax: number | null;
};

/** One forecast hour in the location's own local time. The row covers the hour that starts at `hour`. */
export type RawHourlyWeather = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local hour of day, 0-23. */
  hour: number;
  weatherCode: number | null;
  precipitationProbabilityPct: number | null;
};

export type DailyWeatherKind = "FORECAST" | "TYPICAL";

export type DailyWeather = {
  date: string;
  kind: DailyWeatherKind;
  condition: WeatherCondition;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  /** FORECAST: the provider's probability. TYPICAL: share of sampled years that were wet. */
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  windSpeedMaxKph: number | null;
  uvIndexMax: number | null;
  /** TYPICAL only: how many past years were averaged. */
  sampleYears: number | null;
  /** TYPICAL only: how many of those years had at least 1 mm of rain that day. */
  wetYears: number | null;
};

export type WeatherLookup =
  | { status: "OK"; weather: DailyWeather }
  | { status: "PAST" | "UNAVAILABLE" };

export type WeatherProvider = {
  readonly name: "open-meteo";
  /** Daily forecast starting at the location's local today (16 days). */
  getDailyForecast(location: GeoPoint): Promise<RawDailyWeather[]>;
  /** Hourly forecast for the same 16 days, in the location's local time. */
  getHourlyForecast(location: GeoPoint): Promise<RawHourlyWeather[]>;
  /** Observed daily weather for a past, inclusive date range. */
  getDailyHistory(location: GeoPoint, startDate: string, endDate: string): Promise<RawDailyWeather[]>;
};

/** Open-Meteo's free API is CC-BY 4.0: every surface that shows weather credits it. */
export const WEATHER_ATTRIBUTION = {
  text: "Weather data by Open-Meteo.com",
  url: "https://open-meteo.com/"
} as const;
