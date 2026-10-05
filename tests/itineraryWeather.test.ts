import { describe, expect, it, vi } from "vitest";
import {
  buildItineraryWeather,
  resolveDayDate,
  resolveDayLocation
} from "../src/services/weather/itineraryWeather";
import type { RawDailyWeather, RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";

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
    getHourlyForecast: vi.fn(async (): Promise<RawHourlyWeather[]> => []),
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

  it("returns null for years outside 0000-9999 instead of an unusable date", () => {
    expect(resolveDayDate({ date: new Date("+010000-01-01T00:00:00.000Z"), dayNumber: 1 }, null)).toBeNull();
    expect(resolveDayDate({ date: null, dayNumber: 1 }, new Date("+010000-01-01T00:00:00.000Z"))).toBeNull();
    expect(resolveDayDate({ date: null, dayNumber: 2 }, "9999-12-31")).toBeNull();
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

  it("adds rain timing and per-stop weather to forecast days", async () => {
    const weather = provider([forecastRow("2026-10-10")]);
    weather.getHourlyForecast.mockResolvedValue(baguioHours("2026-10-10"));

    const result = await buildItineraryWeather({
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: "2026-10-10",
          items: [
            { id: "s1", startTime: "09:00", endTime: "11:00", ...stop(16.4023, 120.596) },
            { id: "s3", startTime: "14:00", endTime: "16:30", ...stop(16.4023, 120.596) }
          ]
        }
      ],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(weather.getHourlyForecast).toHaveBeenCalledTimes(1);
    expect(weather.getHourlyForecast).toHaveBeenCalledWith({ latitude: 16.4023, longitude: 120.596 });
    expect(result.days[0]).toMatchObject({ status: "OK", weather: { kind: "FORECAST" } });
    expect(result.days[0].hourly).toEqual({
      firstWetHour: 11,
      wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
      stops: [
        { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
        { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 }
      ]
    });
  });

  it("keeps the daily summary when the hourly lookup fails", async () => {
    const weather = provider([forecastRow("2026-10-10")]);
    weather.getHourlyForecast.mockRejectedValue(new Error("hourly down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: "2026-10-10", items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(result.days[0]).toMatchObject({ status: "OK", weather: { kind: "FORECAST" } });
    expect(result.days[0]).not.toHaveProperty("hourly");
    vi.restoreAllMocks();
  });

  it("asks for hours only where a day is a forecast", async () => {
    const weather = provider([]);

    await buildItineraryWeather({
      // Ten weeks out: typical weather, never hourly.
      days: [{ id: "day-1", dayNumber: 1, date: "2026-12-10", items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(weather.getHourlyForecast).not.toHaveBeenCalled();
  });

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

  it("reports NO_DATE for a year-10000 day instead of throwing", async () => {
    const weather = provider([]);

    const result = await buildItineraryWeather({
      days: [{ id: "day-1", dayNumber: 1, date: new Date("+010000-01-01T00:00:00.000Z"), items: [stop(16.4, 120.6)] }],
      tripStartDate: null,
      provider: weather,
      now,
      typicalYears: 5
    });

    expect(result.days[0]).toEqual({ dayId: "day-1", dayNumber: 1, date: null, status: "NO_DATE", weather: null });
    expect(weather.getDailyForecast).not.toHaveBeenCalled();
  });

  it("marks a location group UNAVAILABLE when its lookup throws unexpectedly", async () => {
    const weather = provider([]);
    const days = [
      { id: "day-1", dayNumber: 1, date: "2026-12-10", items: [stop(16.4, 120.6)] },
      { id: "day-2", dayNumber: 2, date: "2026-12-11", items: [stop(10.3, 123.9)] }
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // An infinite sample size makes the outlook lookup itself throw (invalid array length), outside any provider call.
    const result = await buildItineraryWeather({ days, tripStartDate: null, provider: weather, now, typicalYears: Infinity });

    expect(result.days.map((day) => day.status)).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
    expect(result.days.map((day) => day.date)).toEqual(["2026-12-10", "2026-12-11"]);
    vi.restoreAllMocks();
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
