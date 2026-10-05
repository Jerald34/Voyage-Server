import { parseClockTimeToMinutes } from "../../utils/clockTime";
import { CONDITION_SEVERITY, conditionFromWmoCode } from "./weatherCodes";
import type { RawHourlyWeather, WeatherCondition } from "./types";

/** The hours travelers are out: 06:00 up to 22:00. Rain at night does not shape the day. */
export const DAYTIME_START_HOUR = 6;
export const DAYTIME_END_HOUR = 22;
/** A stop with no usable end time counts as one hour long. */
const DEFAULT_STOP_MINUTES = 60;
const MINUTES_PER_DAY = 24 * 60;
/** A dry-looking hour with at least this chance of rain still reads "light rain possible". */
export const SHOWER_CHANCE_PCT = 50;

export type StopRainOutlook = "DRY" | "SHOWERS" | "RAIN" | "SNOW" | "STORM";

export type StopWeather = {
  itemId: string;
  outlook: StopRainOutlook;
  /** Highest hourly chance of rain during the stop; null when the provider gave none. */
  maxPrecipitationProbabilityPct: number | null;
};

export type HourlyDayOutlook = {
  /** First daytime hour (local, 0-23) with drizzle, rain, snow or storms; null when the daytime stays dry. */
  firstWetHour: number | null;
  /** The daytime's worst wet weather and the local hours it spans (toHour exclusive); null when dry. */
  wetWindow: { condition: WeatherCondition; fromHour: number; toHour: number } | null;
  /** Last daytime hour (local, inclusive) with drizzle, rain, snow or storms, so the whole wet spell is known; null when dry. */
  lastWetHour: number | null;
  /** One entry per stop that has an id and a readable start time. */
  stops: StopWeather[];
};

/** The slice of an itinerary item the stop weather needs. */
export type HourlyStopInput = { id?: string | null; startTime?: string | null; endTime?: string | null };

const OUTLOOK_RANK: Record<StopRainOutlook, number> = { DRY: 0, SHOWERS: 1, RAIN: 2, SNOW: 3, STORM: 4 };

/** Storms, snow, rain, drizzle: the bands the day and stop wording use. */
function rainBand(condition: WeatherCondition): StopRainOutlook {
  if (condition === "THUNDERSTORM") return "STORM";
  if (condition === "SNOW") return "SNOW";
  if (condition === "RAIN" || condition === "HEAVY_RAIN") return "RAIN";
  if (condition === "DRIZZLE") return "SHOWERS";
  return "DRY";
}

/**
 * Anything falling from the sky that changes the plan. Wider than isWetCondition,
 * which other code reads as "rain": snow is not a dry hour.
 */
function isPrecipitation(condition: WeatherCondition): boolean {
  return rainBand(condition) !== "DRY";
}

/** A row only speaks for its hour when the provider gave it a weather code. */
function hasWeatherCode(row: RawHourlyWeather): boolean {
  return typeof row.weatherCode === "number" && Number.isFinite(row.weatherCode);
}

function worseOutlook(a: StopRainOutlook, b: StopRainOutlook) {
  return OUTLOOK_RANK[b] > OUTLOOK_RANK[a] ? b : a;
}

/**
 * Minutes after midnight for a stop's clock time. A start must be before midnight;
 * an end may be exactly 24:00 (1440), the end of the day.
 */
function clockMinutes(value: string | null | undefined, options: { isEnd?: boolean } = {}): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const minutes = parseClockTimeToMinutes(value);
  if (minutes === null || minutes < 0) return null;
  const limit = options.isEnd ? MINUTES_PER_DAY : MINUTES_PER_DAY - 1;
  return minutes <= limit ? minutes : null;
}

/** Rows keyed by local date, each date's rows in hour order. */
export function groupHoursByDate(rows: RawHourlyWeather[]): Map<string, RawHourlyWeather[]> {
  const byDate = new Map<string, RawHourlyWeather[]>();
  for (const row of rows) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.hour - b.hour);
  return byDate;
}

/** `byHour` holds only rows that have a weather code: an hour with no data covers nothing. */
function stopWeather(item: HourlyStopInput, byHour: Map<number, RawHourlyWeather>): StopWeather | null {
  if (!item.id) return null;
  const start = clockMinutes(item.startTime);
  if (start === null) return null;
  const end = clockMinutes(item.endTime, { isEnd: true });
  // A missing end, or one at or before the start (past midnight), counts as one hour.
  const stopEnd = end !== null && end > start ? end : Math.min(start + DEFAULT_STOP_MINUTES, MINUTES_PER_DAY);

  let outlook: StopRainOutlook = "DRY";
  let maxChance: number | null = null;
  let covered = false;
  for (let hour = Math.floor(start / 60); hour <= Math.floor((stopEnd - 1) / 60); hour += 1) {
    const row = byHour.get(hour);
    if (!row) continue;
    covered = true;
    outlook = worseOutlook(outlook, rainBand(conditionFromWmoCode(row.weatherCode)));
    if (row.precipitationProbabilityPct !== null) {
      maxChance = Math.max(maxChance ?? 0, row.precipitationProbabilityPct);
    }
  }
  if (!covered) return null;
  if (outlook === "DRY" && maxChance !== null && maxChance >= SHOWER_CHANCE_PCT) outlook = "SHOWERS";
  return { itemId: item.id, outlook, maxPrecipitationProbabilityPct: maxChance };
}

/**
 * When one date's rain falls, and what it means for each timed stop. `hours`
 * holds that date's rows; stop times are local clock times, like the rows.
 * Rows with no weather code are ignored: an hour with no data is not a dry hour.
 * Null when the date has no usable daytime rows, so its day keeps the daily display.
 */
export function summarizeHourlyDay(hours: RawHourlyWeather[], items: HourlyStopInput[]): HourlyDayOutlook | null {
  const known = hours.filter(hasWeatherCode);
  const daytime = known.filter((row) => row.hour >= DAYTIME_START_HOUR && row.hour < DAYTIME_END_HOUR);
  if (daytime.length === 0) return null;
  const byHour = new Map(known.map((row) => [row.hour, row]));

  const wet = daytime
    .map((row) => ({ hour: row.hour, condition: conditionFromWmoCode(row.weatherCode) }))
    .filter((row) => isPrecipitation(row.condition))
    .sort((a, b) => a.hour - b.hour);

  let wetWindow: HourlyDayOutlook["wetWindow"] = null;
  if (wet.length > 0) {
    const band = wet.reduce<StopRainOutlook>((worst, row) => worseOutlook(worst, rainBand(row.condition)), "DRY");
    const inBand = wet.filter((row) => rainBand(row.condition) === band);
    const condition = inBand.reduce<WeatherCondition>(
      (worst, row) => (CONDITION_SEVERITY[row.condition] > CONDITION_SEVERITY[worst] ? row.condition : worst),
      inBand[0].condition
    );
    wetWindow = { condition, fromHour: inBand[0].hour, toHour: inBand[inBand.length - 1].hour + 1 };
  }

  return {
    firstWetHour: wet.length > 0 ? wet[0].hour : null,
    wetWindow,
    lastWetHour: wet.length > 0 ? wet[wet.length - 1].hour : null,
    stops: items.map((item) => stopWeather(item, byHour)).filter((stop): stop is StopWeather => stop !== null)
  };
}

const AGENT_WET_WORDS: Partial<Record<WeatherCondition, string>> = {
  DRIZZLE: "drizzle",
  RAIN: "rain",
  HEAVY_RAIN: "heavy rain",
  THUNDERSTORM: "thunderstorms",
  SNOW: "snow"
};

function formatHour(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The day's timing in one line for the agent, e.g. "dry until 11 AM; thunderstorms
 * 2 PM-8 PM; wet until 9 PM". The last part appears when lighter rain outlasts the
 * worst weather, so the model knows when the whole spell is over.
 */
export function describeHourlyForAgent(outlook: HourlyDayOutlook): string {
  const window = outlook.wetWindow;
  if (!window) return `dry from ${formatHour(DAYTIME_START_HOUR)} to ${formatHour(DAYTIME_END_HOUR)}`;
  const parts: string[] = [];
  if (outlook.firstWetHour !== null && outlook.firstWetHour > DAYTIME_START_HOUR) {
    parts.push(`dry until ${formatHour(outlook.firstWetHour)}`);
  }
  parts.push(`${AGENT_WET_WORDS[window.condition] ?? "rain"} ${formatHour(window.fromHour)}-${formatHour(window.toHour)}`);
  if (outlook.lastWetHour !== null && outlook.lastWetHour + 1 > window.toHour) {
    parts.push(`wet until ${formatHour(outlook.lastWetHour + 1)}`);
  }
  return parts.join("; ");
}
