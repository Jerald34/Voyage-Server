/**
 * A compact, run-scoped echo of the latest weather_forecast result.
 *
 * Continuation and synthesis turns keep only the last few tool results, so the
 * weather call (made once, before plan_itinerary) scrolls out after a plan and a
 * couple of adds. Without this block the model loses the rain guidance or calls
 * the tool again and burns its per-run cap. It lives in user-message content, so
 * the cached system prompt stays byte-identical.
 */

const MAX_WEATHER_DAYS = 14;
const MAX_SUMMARY_CHARS = 120;
const MAX_BLOCK_CHARS = 2000;

type WeatherDayLike = {
  date?: unknown;
  status?: unknown;
  kind?: unknown;
  summary?: unknown;
  rainRisk?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsableDay(day: unknown): day is WeatherDayLike {
  return isRecord(day) && day.status === "OK" && typeof day.date === "string";
}

/** True when a weather_forecast output has at least one day with data. */
export function isUsableWeatherOutput(output: unknown): boolean {
  return isRecord(output) && Array.isArray(output.days) && output.days.some(isUsableDay);
}

function describeDay(day: unknown): string | null {
  if (!isRecord(day) || typeof day.date !== "string") return null;
  if (day.status !== "OK") {
    return `- ${day.date}: no weather data (${typeof day.status === "string" ? day.status : "UNAVAILABLE"})`;
  }
  const kind = day.kind === "TYPICAL" ? "TYPICAL" : "FORECAST";
  const summary = typeof day.summary === "string" ? day.summary.slice(0, MAX_SUMMARY_CHARS) : "No summary";
  return `- ${day.date} ${kind}: ${summary}; rain risk: ${day.rainRisk === true ? "yes" : "no"}`;
}

/** Render the block, or "" when the output has no usable day. */
export function buildWeatherContextBlock(output: unknown): string {
  if (!isUsableWeatherOutput(output)) return "";
  const record = output as Record<string, unknown>;
  const location = isRecord(record.location) && typeof record.location.name === "string"
    ? record.location.name.slice(0, 100)
    : "the destination";

  const header = [
    `Weather already fetched with weather_forecast for ${location} (reuse it; do not call the tool again for these dates).`,
    "FORECAST is a provider forecast. TYPICAL means past-year averages, not a forecast: never describe it as a chance of rain."
  ];
  const days = (record.days as unknown[]).slice(0, MAX_WEATHER_DAYS);
  const lines: string[] = [...header];
  let length = header.join("\n").length;
  for (const day of days) {
    const line = describeDay(day);
    if (!line) continue;
    if (length + 1 + line.length > MAX_BLOCK_CHARS) break;
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.join("\n");
}
