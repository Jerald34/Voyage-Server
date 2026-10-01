import { addDays, daysBetween, shiftYears } from "./dates";
import { CONDITION_SEVERITY, conditionFromWmoCode } from "./weatherCodes";
import type {
  DailyWeather,
  GeoPoint,
  RawDailyWeather,
  WeatherCondition,
  WeatherLookup,
  WeatherProvider
} from "./types";

/**
 * Furthest UTC offset (days after today) still tried against the forecast. The
 * 16-day forecast covers the location's today through today + 15 in its own
 * calendar, so for a location east of UTC the date at UTC offset +16 is often
 * in the response. A missing row falls through to typical weather below.
 */
export const FORECAST_HORIZON_DAYS = 16;
/** The archive lags real time; never ask it for dates later than today - 2 days. */
const ARCHIVE_LAG_DAYS = 2;
/** WMO convention: a "wet day" has at least 1 mm of precipitation. */
export const WET_DAY_MM = 1;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return round1(present.reduce((sum, value) => sum + value, 0) / present.length);
}

/** Two decimals is about 1 km: close enough for weather, and it shares cache entries. */
export function roundPoint(location: GeoPoint): GeoPoint {
  return {
    latitude: Math.round(location.latitude * 100) / 100,
    longitude: Math.round(location.longitude * 100) / 100
  };
}

export function toForecastDay(row: RawDailyWeather): DailyWeather {
  return {
    date: row.date,
    kind: "FORECAST",
    condition: conditionFromWmoCode(row.weatherCode),
    weatherCode: row.weatherCode,
    temperatureMaxC: row.temperatureMaxC,
    temperatureMinC: row.temperatureMinC,
    precipitationProbabilityPct: row.precipitationProbabilityPct,
    precipitationMm: row.precipitationMm,
    windSpeedMaxKph: row.windSpeedMaxKph,
    uvIndexMax: row.uvIndexMax,
    sampleYears: null,
    wetYears: null
  };
}

function dominantCondition(samples: RawDailyWeather[]): WeatherCondition {
  const counts = new Map<WeatherCondition, number>();
  for (const sample of samples) {
    const condition = conditionFromWmoCode(sample.weatherCode);
    if (condition === "UNKNOWN") continue;
    counts.set(condition, (counts.get(condition) ?? 0) + 1);
  }

  let best: WeatherCondition = "UNKNOWN";
  let bestCount = 0;
  for (const [condition, count] of counts) {
    if (count > bestCount || (count === bestCount && CONDITION_SEVERITY[condition] > CONDITION_SEVERITY[best])) {
      best = condition;
      bestCount = count;
    }
  }
  return best;
}

/** Averages the same calendar day across past years into a TYPICAL entry. */
export function summarizeTypicalDay(date: string, samples: RawDailyWeather[]): DailyWeather | null {
  // A row with every value null carries no information; it must not count as a year.
  const usable = samples.filter(
    (sample) =>
      sample.weatherCode !== null ||
      sample.temperatureMaxC !== null ||
      sample.temperatureMinC !== null ||
      sample.precipitationProbabilityPct !== null ||
      sample.precipitationMm !== null ||
      sample.windSpeedMaxKph !== null ||
      sample.uvIndexMax !== null
  );
  if (usable.length === 0) return null;
  samples = usable;

  const precipitation = samples.map((sample) => sample.precipitationMm);
  const measured = precipitation.filter((value): value is number => value !== null);
  const wetYears = measured.filter((value) => value >= WET_DAY_MM).length;
  // probability = wetYears / sampleYears * 100, so both use the years with measured precipitation.
  const sampleYears = measured.length > 0 ? measured.length : samples.length;

  return {
    date,
    kind: "TYPICAL",
    condition: dominantCondition(samples),
    weatherCode: null,
    temperatureMaxC: mean(samples.map((sample) => sample.temperatureMaxC)),
    temperatureMinC: mean(samples.map((sample) => sample.temperatureMinC)),
    precipitationProbabilityPct: measured.length > 0 ? Math.round((wetYears / measured.length) * 100) : null,
    precipitationMm: mean(precipitation),
    windSpeedMaxKph: mean(samples.map((sample) => sample.windSpeedMaxKph)),
    uvIndexMax: null,
    sampleYears,
    wetYears: measured.length > 0 ? wetYears : null
  };
}

/**
 * Looks up each date for one location.
 * - Within the forecast window: the forecast.
 * - Later: typical weather from past years.
 * - Before the forecast's first day: PAST.
 * Provider failures degrade the affected dates to UNAVAILABLE instead of
 * throwing, because weather is supplementary everywhere it appears.
 */
export async function getWeatherForDates(options: {
  provider: WeatherProvider;
  location: GeoPoint;
  dates: string[];
  /** UTC calendar date, YYYY-MM-DD. */
  today: string;
  typicalYears: number;
}): Promise<Map<string, WeatherLookup>> {
  const { provider, today, typicalYears } = options;
  const location = roundPoint(options.location);
  const dates = [...new Set(options.dates)].sort();
  const results = new Map<string, WeatherLookup>();
  const forecastCandidates: string[] = [];
  const typicalDates: string[] = [];

  for (const date of dates) {
    const offset = daysBetween(today, date);
    // One day of slack either side: the provider's "today" is local, ours is UTC.
    if (offset < -1) results.set(date, { status: "PAST" });
    else if (offset <= FORECAST_HORIZON_DAYS) forecastCandidates.push(date);
    else typicalDates.push(date);
  }

  if (forecastCandidates.length > 0) {
    try {
      const rows = await provider.getDailyForecast(location);
      const byDate = new Map(rows.map((row) => [row.date, row]));
      const first = rows[0]?.date;
      const last = rows[rows.length - 1]?.date;
      for (const date of forecastCandidates) {
        const row = byDate.get(date);
        if (row) results.set(date, { status: "OK", weather: toForecastDay(row) });
        else if (first && date < first) results.set(date, { status: "PAST" });
        else if (last && date > last) typicalDates.push(date);
        else results.set(date, { status: "UNAVAILABLE" });
      }
    } catch (error) {
      console.error("[Weather] Forecast lookup failed.", error instanceof Error ? error.message : error);
      for (const date of forecastCandidates) results.set(date, { status: "UNAVAILABLE" });
    }
  }

  if (typicalDates.length > 0) {
    typicalDates.sort();
    const start = typicalDates[0];
    const end = typicalDates[typicalDates.length - 1];
    // Start at the first offset whose shifted end date the archive can already serve
    // (a date a year or more out would otherwise land on today or later), then keep
    // typicalYears consecutive offsets so the sample count is not reduced.
    const latestArchiveEnd = addDays(today, -ARCHIVE_LAG_DAYS);
    let firstBack = Math.max(1, Number(end.slice(0, 4)) - Number(latestArchiveEnd.slice(0, 4)));
    while (shiftYears(end, -firstBack) > latestArchiveEnd) firstBack += 1;
    const yearsBack = Array.from({ length: typicalYears }, (_, index) => firstBack + index);
    const histories = await Promise.allSettled(
      yearsBack.map((back) => provider.getDailyHistory(location, shiftYears(start, -back), shiftYears(end, -back)))
    );

    const samplesByDate = new Map<string, RawDailyWeather[]>(typicalDates.map((date) => [date, []]));
    histories.forEach((outcome, index) => {
      if (outcome.status !== "fulfilled") return;
      const back = yearsBack[index];
      const byDate = new Map(outcome.value.map((row) => [row.date, row]));
      for (const date of typicalDates) {
        const sample = byDate.get(shiftYears(date, -back));
        if (sample) samplesByDate.get(date)!.push(sample);
      }
    });

    const failures = histories.filter((outcome) => outcome.status === "rejected").length;
    if (failures > 0) console.error(`[Weather] ${failures} of ${yearsBack.length} history lookups failed.`);

    for (const date of typicalDates) {
      const typical = summarizeTypicalDay(date, samplesByDate.get(date) ?? []);
      results.set(date, typical ? { status: "OK", weather: typical } : { status: "UNAVAILABLE" });
    }
  }

  return results;
}
