import { describe, expect, it, vi } from "vitest";
import type { RawDailyWeather, WeatherProvider } from "../src/services/weather/types";
import { getWeatherForDates, roundPoint, summarizeTypicalDay } from "../src/services/weather/weatherOutlook";

function raw(date: string, overrides: Partial<RawDailyWeather> = {}): RawDailyWeather {
  return {
    date,
    weatherCode: 1,
    temperatureMaxC: 25,
    temperatureMinC: 17,
    precipitationProbabilityPct: 10,
    precipitationMm: 0,
    windSpeedMaxKph: 10,
    uvIndexMax: 7,
    ...overrides
  };
}

function fakeProvider(options: {
  forecast?: RawDailyWeather[] | Error;
  history?: (start: string, end: string) => RawDailyWeather[] | Error;
} = {}) {
  return {
    name: "open-meteo" as const,
    getDailyForecast: vi.fn(async () => {
      if (options.forecast instanceof Error) throw options.forecast;
      return options.forecast ?? [];
    }),
    getDailyHistory: vi.fn(async (_location: unknown, start: string, end: string) => {
      const result = options.history ? options.history(start, end) : [];
      if (result instanceof Error) throw result;
      return result;
    })
  } satisfies WeatherProvider;
}

const BAGUIO = { latitude: 16.4023, longitude: 120.596 };

describe("getWeatherForDates", () => {
  it("uses the forecast for dates inside the 16-day window", async () => {
    const provider = fakeProvider({
      forecast: [raw("2026-10-01"), raw("2026-10-10", { weatherCode: 61, precipitationProbabilityPct: 85 })]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-10-10"],
      today: "2026-10-01",
      typicalYears: 5
    });

    expect(result.get("2026-10-10")).toEqual({
      status: "OK",
      weather: expect.objectContaining({ kind: "FORECAST", condition: "RAIN", precipitationProbabilityPct: 85 })
    });
    expect(provider.getDailyForecast).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 });
    expect(provider.getDailyHistory).not.toHaveBeenCalled();
  });

  it("marks clearly past dates PAST without calling the provider", async () => {
    const provider = fakeProvider();

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-09-01"],
      today: "2026-10-01",
      typicalYears: 5
    });

    expect(result.get("2026-09-01")).toEqual({ status: "PAST" });
    expect(provider.getDailyForecast).not.toHaveBeenCalled();
  });

  it("averages the same dates in past years beyond the window", async () => {
    const provider = fakeProvider({
      history: (start) => {
        const year = start.slice(0, 4);
        const wet = year === "2025" || year === "2024";
        return [
          raw(`${year}-12-05`, {
            weatherCode: wet ? 63 : 1,
            temperatureMaxC: year === "2025" ? 24 : 22,
            temperatureMinC: 15,
            precipitationMm: wet ? 6 : 0.2,
            precipitationProbabilityPct: null,
            uvIndexMax: null
          })
        ];
      }
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-12-05"],
      today: "2026-10-01",
      typicalYears: 3
    });

    expect(provider.getDailyHistory).toHaveBeenCalledTimes(3);
    expect(provider.getDailyHistory).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 }, "2025-12-05", "2025-12-05");
    expect(provider.getDailyHistory).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 }, "2023-12-05", "2023-12-05");
    expect(result.get("2026-12-05")).toEqual({
      status: "OK",
      weather: {
        date: "2026-12-05",
        kind: "TYPICAL",
        condition: "RAIN",
        weatherCode: null,
        temperatureMaxC: 22.7,
        temperatureMinC: 15,
        precipitationProbabilityPct: 67,
        precipitationMm: 4.1,
        windSpeedMaxKph: 10,
        uvIndexMax: null,
        sampleYears: 3,
        wetYears: 2
      }
    });
    expect(provider.getDailyForecast).not.toHaveBeenCalled();
  });

  it("sends a date past the last forecast day to typical weather", async () => {
    const provider = fakeProvider({
      forecast: [raw("2026-10-01"), raw("2026-10-15")],
      history: (start) => [raw(start, { precipitationMm: 0 })]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-10-16"],
      today: "2026-10-01",
      typicalYears: 2
    });

    expect(result.get("2026-10-16")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL", sampleYears: 2 } });
  });

  it("degrades to UNAVAILABLE when the forecast fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = fakeProvider({ forecast: new Error("down") });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-10-03"],
      today: "2026-10-01",
      typicalYears: 5
    });

    expect(result.get("2026-10-03")).toEqual({ status: "UNAVAILABLE" });
  });

  it("uses the years that loaded when some history calls fail, and UNAVAILABLE when all fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const partial = fakeProvider({
      history: (start) => (start.startsWith("2025") ? [raw("2025-12-05")] : new Error("down"))
    });
    const allFail = fakeProvider({ history: () => new Error("down") });

    const partialResult = await getWeatherForDates({
      provider: partial,
      location: BAGUIO,
      dates: ["2026-12-05"],
      today: "2026-10-01",
      typicalYears: 3
    });
    const failedResult = await getWeatherForDates({
      provider: allFail,
      location: BAGUIO,
      dates: ["2026-12-05"],
      today: "2026-10-01",
      typicalYears: 3
    });

    expect(partialResult.get("2026-12-05")).toMatchObject({ status: "OK", weather: { sampleYears: 1 } });
    expect(failedResult.get("2026-12-05")).toEqual({ status: "UNAVAILABLE" });
  });
});

describe("summarizeTypicalDay", () => {
  it("returns null with no samples and breaks condition ties toward worse weather", () => {
    expect(summarizeTypicalDay("2026-12-05", [])).toBeNull();

    const tie = summarizeTypicalDay("2026-12-05", [raw("2025-12-05", { weatherCode: 1 }), raw("2024-12-05", { weatherCode: 95 })]);
    expect(tie?.condition).toBe("THUNDERSTORM");
  });
});

describe("roundPoint", () => {
  it("rounds to two decimals", () => {
    expect(roundPoint(BAGUIO)).toEqual({ latitude: 16.4, longitude: 120.6 });
  });
});
