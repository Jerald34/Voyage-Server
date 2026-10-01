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

describe("getWeatherForDates typical-history windows", () => {
  const TODAY = "2026-10-01";
  // Archive lag safety margin: no history call may end after today - 2 days.
  const LATEST_END = "2026-09-29";

  it("never requests archive dates in the future for a date about 13 months out", async () => {
    const provider = fakeProvider({
      history: (start) => [raw(start, { precipitationMm: 0 })]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2027-11-05"],
      today: TODAY,
      typicalYears: 3
    });

    const calls = provider.getDailyHistory.mock.calls;
    expect(calls).toHaveLength(3);
    for (const [, , end] of calls) expect(end <= LATEST_END).toBe(true);
    expect(calls.map(([, start]) => start).sort()).toEqual(["2023-11-05", "2024-11-05", "2025-11-05"]);
    expect(result.get("2027-11-05")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL", sampleYears: 3 } });
  });

  it("still yields TYPICAL with typicalYears=1 for a date about 13 months out", async () => {
    const provider = fakeProvider({
      history: (start) => [raw(start, { precipitationMm: 3 })]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2027-11-05"],
      today: TODAY,
      typicalYears: 1
    });

    expect(provider.getDailyHistory).toHaveBeenCalledTimes(1);
    expect(provider.getDailyHistory.mock.calls[0][2] <= LATEST_END).toBe(true);
    expect(result.get("2027-11-05")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL", sampleYears: 1, wetYears: 1 } });
  });

  it("looks up Feb 29 through the Feb 28 fallback in non-leap years", async () => {
    const provider = fakeProvider({
      history: (start, end) => [raw(start), raw(end)]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2028-02-29"],
      today: TODAY,
      typicalYears: 2
    });

    const starts = provider.getDailyHistory.mock.calls.map(([, start]) => start).sort();
    // 2028 is a leap year; 2027 and 2026 are not. Offsets start at 2 so every end is in the past.
    expect(starts).toEqual(["2025-02-28", "2026-02-28"]);
    expect(result.get("2028-02-29")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL", sampleYears: 2 } });
  });

  it("matches rows by shifted date for a typical range crossing a year boundary", async () => {
    const provider = fakeProvider({
      history: (start, end) => {
        const offset = Number(start.slice(0, 4)) - 2026;
        // Dec 30 of the base year .. Jan 2 of the next.
        return [
          raw(`${2026 + offset}-12-30`, { precipitationMm: 5 }),
          raw(`${2027 + offset}-01-02`, { precipitationMm: 0 })
        ].filter((row) => row.date >= start && row.date <= end);
      }
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-12-30", "2027-01-02"],
      today: TODAY,
      typicalYears: 2
    });

    expect(provider.getDailyHistory).toHaveBeenCalledTimes(2);
    expect(provider.getDailyHistory).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 }, "2025-12-30", "2026-01-02");
    expect(provider.getDailyHistory).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 }, "2024-12-30", "2025-01-02");
    expect(result.get("2026-12-30")).toMatchObject({ status: "OK", weather: { sampleYears: 2, wetYears: 2, precipitationProbabilityPct: 100 } });
    expect(result.get("2027-01-02")).toMatchObject({ status: "OK", weather: { sampleYears: 2, wetYears: 0, precipitationProbabilityPct: 0 } });
  });

  it("resolves forecast, PAST and TYPICAL dates in one call", async () => {
    const provider = fakeProvider({
      forecast: [raw("2026-10-01"), raw("2026-10-05", { weatherCode: 61 })],
      history: (start) => [raw(start, { precipitationMm: 0 })]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-09-01", "2026-10-05", "2026-12-25"],
      today: TODAY,
      typicalYears: 2
    });

    expect(result.get("2026-09-01")).toEqual({ status: "PAST" });
    expect(result.get("2026-10-05")).toMatchObject({ status: "OK", weather: { kind: "FORECAST" } });
    expect(result.get("2026-12-25")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL", sampleYears: 2 } });
    expect(provider.getDailyForecast).toHaveBeenCalledTimes(1);
    expect(provider.getDailyHistory).toHaveBeenCalledTimes(2);
  });

  it("treats the date 16 days out as a forecast candidate for locations east of UTC", async () => {
    const provider = fakeProvider({
      forecast: [raw("2026-10-01"), raw("2026-10-17", { weatherCode: 61 })],
      history: (start) => [raw(start)]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-10-17", "2026-10-18"],
      today: TODAY,
      typicalYears: 1
    });

    expect(result.get("2026-10-17")).toMatchObject({ status: "OK", weather: { kind: "FORECAST", condition: "RAIN" } });
    expect(result.get("2026-10-18")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL" } });
    expect(provider.getDailyHistory).toHaveBeenCalledTimes(1);
  });

  it("falls back to TYPICAL when the 16-days-out row is missing from the forecast", async () => {
    const provider = fakeProvider({
      forecast: [raw("2026-10-01"), raw("2026-10-16")],
      history: (start) => [raw(start)]
    });

    const result = await getWeatherForDates({
      provider,
      location: BAGUIO,
      dates: ["2026-10-17"],
      today: TODAY,
      typicalYears: 1
    });

    expect(result.get("2026-10-17")).toMatchObject({ status: "OK", weather: { kind: "TYPICAL" } });
  });
});

describe("summarizeTypicalDay", () => {
  it("returns null with no samples and breaks condition ties toward worse weather", () => {
    expect(summarizeTypicalDay("2026-12-05", [])).toBeNull();

    const tie = summarizeTypicalDay("2026-12-05", [raw("2025-12-05", { weatherCode: 1 }), raw("2024-12-05", { weatherCode: 95 })]);
    expect(tie?.condition).toBe("THUNDERSTORM");
  });

  it("keeps sampleYears equal to the measured-precipitation count that the probability divides by", () => {
    const typical = summarizeTypicalDay("2026-12-05", [
      raw("2025-12-05", { precipitationMm: 4 }),
      raw("2024-12-05", { precipitationMm: 0 }),
      raw("2023-12-05", { precipitationMm: null }),
      raw("2022-12-05", { precipitationMm: 2 })
    ]);

    expect(typical?.sampleYears).toBe(3);
    expect(typical?.wetYears).toBe(2);
    expect(typical?.precipitationProbabilityPct).toBe(Math.round((typical!.wetYears! / typical!.sampleYears!) * 100));
  });

  it("drops all-null samples and reports null wetYears and probability when no precipitation was measured", () => {
    const allNull = {
      weatherCode: null,
      temperatureMaxC: null,
      temperatureMinC: null,
      precipitationProbabilityPct: null,
      precipitationMm: null,
      windSpeedMaxKph: null,
      uvIndexMax: null
    };
    expect(summarizeTypicalDay("2026-12-05", [raw("2025-12-05", allNull)])).toBeNull();

    const noRain = summarizeTypicalDay("2026-12-05", [
      raw("2025-12-05", { precipitationMm: null, temperatureMaxC: 24 }),
      raw("2024-12-05", { precipitationMm: null, temperatureMaxC: 26 }),
      raw("2023-12-05", allNull)
    ]);
    expect(noRain).toMatchObject({ sampleYears: 2, wetYears: null, precipitationProbabilityPct: null, temperatureMaxC: 25 });
  });
});

describe("roundPoint", () => {
  it("rounds to two decimals", () => {
    expect(roundPoint(BAGUIO)).toEqual({ latitude: 16.4, longitude: 120.6 });
  });
});
