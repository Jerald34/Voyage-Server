import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/http/errors";
import { CONTINUATION_TRIGGER_TOOL_NAMES } from "../src/modules/agent/agentContextBuilder";
import { canonicalToolName } from "../src/modules/agent/agentParser";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";
import { createAgentToolRegistry, type AgentToolService } from "../src/modules/agent/agentTools";
import { createWeatherForecastTool } from "../src/modules/agent/tools/weatherTools";
import type { RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";

const context = { agencyId: "agency-1", threadId: "thread-1", runId: "run-1", userId: "user-1" };

function fakeAgentService() {
  return {
    recordRunEvent: vi.fn(async () => undefined),
    recordTask: vi.fn(async () => undefined),
    updateTask: vi.fn(async () => undefined),
    listOpenTasksForThread: vi.fn(async () => []),
    recordSources: vi.fn(async () => undefined)
  } satisfies AgentToolService;
}

function buildTool() {
  const agentService = fakeAgentService();
  const geocoder = {
    resolvePlace: vi.fn(async () => ({
      provider: "NOMINATIM" as const,
      providerPlaceId: "n-1",
      name: "Baguio",
      location: { latitude: 16.4023, longitude: 120.596 }
    }))
  };
  const weather = {
    name: "open-meteo" as const,
    getDailyForecast: vi.fn(async () => [
      {
        date: "2026-10-01",
        weatherCode: 1,
        temperatureMaxC: 25,
        temperatureMinC: 17,
        precipitationProbabilityPct: 5,
        precipitationMm: 0,
        windSpeedMaxKph: 9,
        uvIndexMax: 8
      },
      {
        date: "2026-10-10",
        weatherCode: 61,
        temperatureMaxC: 23.4,
        temperatureMinC: 16.2,
        precipitationProbabilityPct: 85,
        precipitationMm: 12.6,
        windSpeedMaxKph: 14,
        uvIndexMax: 5
      }
    ]),
    getHourlyForecast: vi.fn(async (): Promise<RawHourlyWeather[]> => []),
    getDailyHistory: vi.fn(async () => [])
  };
  const tool = createWeatherForecastTool({
    weather,
    geocoder,
    agentService,
    typicalYears: 5,
    now: () => new Date("2026-10-01T00:00:00.000Z")
  });
  return { tool, agentService, geocoder, weather };
}

describe("weather_forecast tool", () => {
  it("geocodes the place and returns a compact per-day summary", async () => {
    const { tool, agentService, geocoder } = buildTool();

    const result = await tool.execute(context, {
      placeName: "Baguio City",
      cityContext: "Benguet, Philippines",
      startDate: "2026-10-10"
    });

    expect(geocoder.resolvePlace).toHaveBeenCalledWith({ placeName: "Baguio City", cityContext: "Benguet, Philippines" });
    expect(result).toEqual({
      location: { name: "Baguio", latitude: 16.4023, longitude: 120.596 },
      days: [
        {
          date: "2026-10-10",
          status: "OK",
          kind: "FORECAST",
          condition: "RAIN",
          summary: "Rain, 16-23°C, 85% chance of rain",
          rainRisk: true,
          temperatureMinC: 16.2,
          temperatureMaxC: 23.4,
          precipitationProbabilityPct: 85
        }
      ],
      attribution: "Weather data by Open-Meteo.com"
    });
    expect(agentService.recordSources).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1" }),
      [expect.objectContaining({ sourceType: "WEB", url: "https://open-meteo.com/", provider: "open_meteo" })]
    );
  });

  it("adds hour-by-hour timing to forecast days", async () => {
    const { tool, weather } = buildTool();
    weather.getHourlyForecast.mockResolvedValue(baguioHours("2026-10-10"));

    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    // The same rounded point the daily lookup uses, so both resolve to one grid cell.
    expect(weather.getHourlyForecast).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 });
    expect(weather.getDailyForecast).toHaveBeenCalledWith({ latitude: 16.4, longitude: 120.6 });
    expect(result).toMatchObject({
      days: [
        {
          summary: "Rain, 16-23°C, 85% chance of rain; dry until 11 AM; thunderstorms 2 PM-8 PM; wet until 9 PM",
          timing: "dry until 11 AM; thunderstorms 2 PM-8 PM; wet until 9 PM",
          rainRisk: true
        }
      ]
    });
  });

  it("takes rainRisk from the hourly timing, so a night-only storm is not a rain risk", async () => {
    const { tool, weather } = buildTool();
    // The daily code says rain (85%), but the only wet hours are 2-3 AM (at 95%); the daytime is dry at 20%.
    weather.getHourlyForecast.mockResolvedValue(
      Array.from({ length: 24 }, (_, hour) => ({
        date: "2026-10-10",
        hour,
        weatherCode: hour === 2 || hour === 3 ? 95 : 1,
        precipitationProbabilityPct: hour === 2 || hour === 3 ? 95 : 20
      }))
    );

    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(result).toMatchObject({
      days: [{ kind: "FORECAST", condition: "RAIN", rainRisk: false, timing: "dry from 6 AM to 10 PM" }]
    });
  });

  it("keeps a rain-chance floor on rainRisk when the daytime codes are dry", async () => {
    const { tool, weather } = buildTool();
    const dryDayWithPeak = (peak: number) =>
      Array.from({ length: 24 }, (_, hour) => ({
        date: "2026-10-10",
        hour,
        weatherCode: 3,
        precipitationProbabilityPct: hour === 12 ? peak : 10
      }));

    // An overcast hour with a 79% chance: no wet window, but still a rain risk.
    weather.getHourlyForecast.mockResolvedValue(dryDayWithPeak(79));
    const risky = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });
    expect(risky).toMatchObject({ days: [{ rainRisk: true, timing: "dry from 6 AM to 10 PM" }] });

    // The floor is the daily rule's 60%: 60 counts, 59 does not.
    weather.getHourlyForecast.mockResolvedValue(dryDayWithPeak(60));
    expect(await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" })).toMatchObject({
      days: [{ rainRisk: true }]
    });
    weather.getHourlyForecast.mockResolvedValue(dryDayWithPeak(59));
    expect(await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" })).toMatchObject({
      days: [{ rainRisk: false }]
    });
  });

  it("keeps the daily rainRisk when a forecast day has no hourly timing", async () => {
    const { tool, weather } = buildTool();
    // Rows for another date only: this day has no outlook.
    weather.getHourlyForecast.mockResolvedValue(baguioHours("2026-10-11"));

    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(result).toMatchObject({ days: [{ kind: "FORECAST", rainRisk: true }] });
    expect(result).not.toHaveProperty("days.0.timing");
  });

  it("calls a snow day a rain risk and says snow", async () => {
    const { tool, weather } = buildTool();
    weather.getHourlyForecast.mockResolvedValue(
      Array.from({ length: 24 }, (_, hour) => ({
        date: "2026-10-10",
        hour,
        weatherCode: hour === 10 || hour === 11 ? 73 : 1,
        precipitationProbabilityPct: 10
      }))
    );

    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(result).toMatchObject({ days: [{ rainRisk: true, timing: "dry until 10 AM; snow 10 AM-12 PM" }] });
  });

  it("skips the hourly request without forecast days and survives its failure", async () => {
    const { tool, weather } = buildTool();

    // Two months out: typical weather only.
    await tool.execute(context, { placeName: "Baguio City", startDate: "2026-12-01" });
    expect(weather.getHourlyForecast).not.toHaveBeenCalled();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    weather.getHourlyForecast.mockRejectedValue(new Error("hourly down"));
    const result = await tool.execute(context, { placeName: "Baguio City", startDate: "2026-10-10" });

    expect(result).toMatchObject({ days: [{ summary: "Rain, 16-23°C, 85% chance of rain" }] });
    expect(result).not.toHaveProperty("days.0.timing");
    vi.restoreAllMocks();
  });

  it("rejects impossible dates and ranges over 14 days through the registry", async () => {
    const { tool, geocoder } = buildTool();
    const registry = createAgentToolRegistry([tool]);

    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-02-30" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" } satisfies Partial<ApiError>);
    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-10-01", endDate: "2026-10-20" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" });
    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-10-01", endDate: "2026-13-40" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" });
    // Validation happens before any network call.
    expect(geocoder.resolvePlace).not.toHaveBeenCalled();
  });

  it("respects the per-run weather group cap", async () => {
    const { tool } = buildTool();
    const registry = createAgentToolRegistry([tool], {
      maxCallsByGroup: { weather: 1 },
      toolGroups: { weather_forecast: "weather" }
    });

    await registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-10-10" });
    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-10-10" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_LIMIT_REACHED", statusCode: 429 });
  });
});

describe("weather_forecast typical weather and bounds", () => {
  // Same calendar day in each past year: wet in even years (2024, 2022), dry otherwise.
  function historyRow(date: string) {
    const wet = Number(date.slice(0, 4)) % 2 === 0;
    return {
      date,
      weatherCode: 3,
      temperatureMaxC: 20,
      temperatureMinC: 14,
      precipitationProbabilityPct: null,
      precipitationMm: wet ? 5 : 0,
      windSpeedMaxKph: 10,
      uvIndexMax: null
    };
  }

  function withHistory() {
    const built = buildTool();
    built.weather.getDailyHistory.mockImplementation(async (_location: unknown, start: string) => [historyRow(start)] as never);
    return built;
  }

  it("labels days beyond the forecast window as TYPICAL and never as a chance of rain", async () => {
    const { tool } = withHistory();

    const result = (await tool.execute(context, { placeName: "Baguio", startDate: "2026-11-20" })) as {
      days: Array<Record<string, unknown>>;
      note?: string;
    };

    expect(result.days).toEqual([
      {
        date: "2026-11-20",
        status: "OK",
        kind: "TYPICAL",
        condition: "CLOUDY",
        summary: "Cloudy, 14-20°C, rain on 2 of the last 5 years",
        rainRisk: false,
        temperatureMinC: 14,
        temperatureMaxC: 20,
        precipitationProbabilityPct: null,
        wetYears: 2,
        sampleYears: 5
      }
    ]);
    expect(result.note).toBe("TYPICAL days average the last 5 years; they are not a forecast.");
    expect(JSON.stringify(result)).not.toContain("chance");
  });

  it("accepts a 14-day range and rejects 15 days", async () => {
    const { tool } = withHistory();
    const registry = createAgentToolRegistry([tool]);

    const ok = (await registry.execute("weather_forecast", context, {
      placeName: "Baguio",
      startDate: "2026-10-01",
      endDate: "2026-10-14"
    })) as { days: unknown[] };
    expect(ok.days).toHaveLength(14);
    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-10-01", endDate: "2026-10-15" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" });
  });

  it("bounds startDate to yesterday through a year and a day out", async () => {
    const { tool, geocoder } = withHistory();
    const registry = createAgentToolRegistry([tool]);

    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-09-29" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" });
    await expect(
      registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2027-10-03" })
    ).rejects.toMatchObject({ code: "AGENT_TOOL_INPUT_INVALID" });
    expect(geocoder.resolvePlace).not.toHaveBeenCalled();

    await expect(registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2026-09-30" })).resolves.toBeTruthy();
    await expect(registry.execute("weather_forecast", context, { placeName: "Baguio", startDate: "2027-10-02" })).resolves.toBeTruthy();
  });

  it("records no source when no day has weather", async () => {
    const { tool, agentService, weather } = buildTool();
    weather.getDailyForecast.mockRejectedValue(new Error("provider down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = (await tool.execute(context, { placeName: "Baguio", startDate: "2026-10-10" })) as {
        days: Array<{ status: string }>;
      };
      expect(result.days).toEqual([{ date: "2026-10-10", status: "UNAVAILABLE" }]);
      expect(agentService.recordSources).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("weather_forecast wiring", () => {
  it("canonicalizes common spellings", () => {
    expect(canonicalToolName("weatherForecast")).toBe("weather_forecast");
    expect(canonicalToolName("get_weather")).toBe("weather_forecast");
    expect(canonicalToolName("get-weather-forecast")).toBe("weather_forecast");
  });

  it("continues the loop after a weather call", () => {
    expect(CONTINUATION_TRIGGER_TOOL_NAMES.has("weather_forecast")).toBe(true);
  });

  it("describes the tool in the stable system prompt", () => {
    const prompt = buildVoyageSystemPrompt("weather_forecast, add_itinerary_item");

    expect(prompt).toContain("weather_forecast:");
    expect(prompt).toContain('{"tool": "weather_forecast"');
    expect(prompt).toContain("When a day also has timing");
    expect(buildVoyageSystemPrompt("weather_forecast, add_itinerary_item")).toBe(prompt);
  });
});
