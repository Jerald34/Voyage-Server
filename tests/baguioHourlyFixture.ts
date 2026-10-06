import type { RawHourlyWeather } from "../src/services/weather/types";

// Open-Meteo hourly forecast for Baguio (16.41, 120.60), 2026-10-08, pulled 2026-10-06.
// Dry until 9 AM, drizzle from 11 AM, thunderstorms 2-7 PM (rows 14-17 and 19), rain at 18.
const CODES = [1, 1, 0, 0, 1, 1, 3, 1, 0, 0, 0, 51, 3, 51, 95, 95, 95, 95, 80, 95, 51, 2, 3, 3];
const CHANCES = [3, 2, 2, 3, 5, 6, 3, 0, 4, 21, 45, 65, 79, 89, 96, 99, 99, 96, 91, 84, 73, 56, 36, 20];

export function baguioHours(date = "2026-10-08"): RawHourlyWeather[] {
  return CODES.map((weatherCode, hour) => ({ date, hour, weatherCode, precipitationProbabilityPct: CHANCES[hour] }));
}
