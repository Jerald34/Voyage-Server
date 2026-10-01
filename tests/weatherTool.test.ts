import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/http/errors";
import { CONTINUATION_TRIGGER_TOOL_NAMES } from "../src/modules/agent/agentContextBuilder";
import { canonicalToolName } from "../src/modules/agent/agentParser";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";
import { createAgentToolRegistry, type AgentToolService } from "../src/modules/agent/agentTools";
import { createWeatherForecastTool } from "../src/modules/agent/tools/weatherTools";

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
    expect(buildVoyageSystemPrompt("weather_forecast, add_itinerary_item")).toBe(prompt);
  });
});
