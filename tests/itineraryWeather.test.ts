import { describe, expect, it, vi } from "vitest";
import {
  buildItineraryWeather,
  resolveDayDate,
  resolveDayLocation
} from "../src/services/weather/itineraryWeather";
import type { RawDailyWeather } from "../src/services/weather/types";

const stop = (latitude: number | null, longitude: number | null) => ({ placeSnapshot: { latitude, longitude } });

function forecastRow(date: string): RawDailyWeather {
  return {
    date,
    weatherCode: 61,
    temperatureMaxC: 23,
    temperatureMinC: 16,
    precipitationProbabilityPct: 80,
    precipitationMm: 9,
    windSpeedMaxKph: 12,
    uvIndexMax: 5
  };
}

function provider(rows: RawDailyWeather[]) {
  return {
    name: "open-meteo" as const,
    getDailyForecast: vi.fn(async () => rows),
    getDailyHistory: vi.fn(async () => [])
  };
}

describe("resolveDayDate", () => {
  it("prefers the day's own date, as a Date or a string", () => {
    expect(resolveDayDate({ date: new Date("2026-10-11T00:00:00.000Z"), dayNumber: 2 }, "2026-10-01")).toBe("2026-10-11");
    expect(resolveDayDate({ date: "2026-10-12", dayNumber: 3 }, null)).toBe("2026-10-12");
  });

  it("falls back to trip start plus dayNumber - 1", () => {
    expect(resolveDayDate({ date: null, dayNumber: 3 }, new Date("2026-10-10T00:00:00.000Z"))).toBe("2026-10-12");
  });

  it("returns null without any date", () => {
    expect(resolveDayDate({ date: null, dayNumber: 1 }, null)).toBeNull();
    expect(resolveDayDate({ date: "not a date", dayNumber: 1 }, null)).toBeNull();
  });
});

describe("resolveDayLocation", () => {
  it("averages located stops and ignores stops without coordinates", () => {
    expect(resolveDayLocation({ items: [stop(16.4, 120.6), stop(16.42, 120.58), stop(null, null), { placeSnapshot: null }] })).toEqual({
      latitude: 16.41,
      longitude: 120.59
    });
  });

  it("returns null when no stop is located", () => {
    expect(resolveDayLocation({ items: [{ placeSnapshot: null }] })).toBeNull();
  });
});

describe("buildItineraryWeather", () => {
  const now = new Date("2026-10-01T02:00:00.000Z");

  it("groups days in one city into one forecast call and reports each day", async () => {
    const weather = provider([forecastRow("2026-10-01"), forecastRow("2026-10-10"), forecastRow("2026-10-11")]);

    const result = await buildItineraryWeather({
      days: [
        { id: "day-1", dayNumber: 1, date: null, items: [stop(16.4023, 120.596)] },
        { id: "day-2", dayNumber: 2, date: null, items: [] }
      ],
      tripStartDate: "2026-10-10",
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(weather.getDailyForecast).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("open-meteo");
    expect(result.attribution).toEqual({ text: "Weather data by Open-Meteo.com", url: "https://open-meteo.com/" });
    expect(result.days).toEqual([
      expect.objectContaining({ dayId: "day-1", dayNumber: 1, date: "2026-10-10", status: "OK" }),
      // Day 2 has no stops, so it borrows day 1's location.
      expect.objectContaining({ dayId: "day-2", dayNumber: 2, date: "2026-10-11", status: "OK" })
    ]);
    expect(result.days[0].weather).toMatchObject({ kind: "FORECAST", condition: "RAIN" });
  });

  it("reports NO_DATE, NO_LOCATION and PAST without inventing weather", async () => {
    const weather = provider([]);

    const noDates = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: null, items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });
    const noStops = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: "2026-10-10", items: [] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });
    const past = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: "2026-08-01", items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(noDates.days[0]).toEqual({ dayId: "day-1", dayNumber: 1, date: null, status: "NO_DATE", weather: null });
    expect(noStops.days[0]).toEqual({ dayId: "day-1", dayNumber: 1, date: "2026-10-10", status: "NO_LOCATION", weather: null });
    expect(past.days[0]).toEqual({ dayId: "day-1", dayNumber: 1, date: "2026-08-01", status: "PAST", weather: null });
    expect(weather.getDailyForecast).not.toHaveBeenCalled();
  });

  it("marks dated days UNAVAILABLE when weather is disabled", async () => {
    const result = await buildItineraryWeather({
      days: [
        { id: "day-1", dayNumber: 1, date: "2026-10-10", items: [stop(16.4, 120.6)] },
        { id: "day-2", dayNumber: 2, date: null, items: [] }
      ],
      tripStartDate: null,
      provider: null,
      now,
      typicalYears: 5
    });

    expect(result).toEqual({
      provider: null,
      attribution: null,
      days: [
        { dayId: "day-1", dayNumber: 1, date: "2026-10-10", status: "UNAVAILABLE", weather: null },
        { dayId: "day-2", dayNumber: 2, date: null, status: "NO_DATE", weather: null }
      ]
    });
  });
});
