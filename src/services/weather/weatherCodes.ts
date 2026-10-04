import type { WeatherCondition } from "./types";

/**
 * WMO weather interpretation codes as Open-Meteo reports them
 * (https://open-meteo.com/en/docs, "WMO Weather interpretation codes").
 * Heavy codes are checked before the rain range they sit inside.
 */
export function conditionFromWmoCode(code: number | null | undefined): WeatherCondition {
  if (code === null || code === undefined || !Number.isFinite(code)) return "UNKNOWN";
  if (code === 0) return "CLEAR";
  if (code === 1 || code === 2) return "PARTLY_CLOUDY";
  if (code === 3) return "CLOUDY";
  if (code === 45 || code === 48) return "FOG";
  if (code >= 51 && code <= 57) return "DRIZZLE";
  if (code === 65 || code === 67 || code === 82) return "HEAVY_RAIN";
  if ((code >= 61 && code <= 66) || code === 80 || code === 81) return "RAIN";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "SNOW";
  if (code >= 95 && code <= 99) return "THUNDERSTORM";
  return "UNKNOWN";
}

/** Tie-breaker when summarizing past years: the worse weather wins. */
export const CONDITION_SEVERITY: Record<WeatherCondition, number> = {
  UNKNOWN: 0,
  CLEAR: 1,
  PARTLY_CLOUDY: 2,
  CLOUDY: 3,
  FOG: 4,
  DRIZZLE: 5,
  SNOW: 6,
  RAIN: 7,
  HEAVY_RAIN: 8,
  THUNDERSTORM: 9
};

export function isWetCondition(condition: WeatherCondition): boolean {
  return condition === "DRIZZLE" || condition === "RAIN" || condition === "HEAVY_RAIN" || condition === "THUNDERSTORM";
}
