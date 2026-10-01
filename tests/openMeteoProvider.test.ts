import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "../src/http/errors";
import { createOpenMeteoProvider, parseOpenMeteoDaily } from "../src/services/weather/openMeteo";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const forecastBody = {
  latitude: 16.41,
  longitude: 120.59,
  timezone: "Asia/Manila",
  daily: {
    time: ["2026-10-01", "2026-10-02"],
    weather_code: [61, 1],
    temperature_2m_max: [23.4, 25.1],
    temperature_2m_min: [16.2, 16.8],
    precipitation_probability_max: [85, 10],
    precipitation_sum: [12.6, 0],
    wind_speed_10m_max: [14.2, 9.8],
    uv_index_max: [5.1, 8.4]
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Open-Meteo provider", () => {
  it("requests a 16-day local-time daily forecast and parses one row per date", async () => {
    const urls: URL[] = [];
    const provider = createOpenMeteoProvider({
      fetchImpl: async (url) => {
        urls.push(new URL(String(url)));
        return jsonResponse(forecastBody);
      }
    });

    const rows = await provider.getDailyForecast({ latitude: 16.4023, longitude: 120.596 });

    expect(`${urls[0].origin}${urls[0].pathname}`).toBe("https://api.open-meteo.com/v1/forecast");
    expect(urls[0].searchParams.get("latitude")).toBe("16.4023");
    expect(urls[0].searchParams.get("longitude")).toBe("120.5960");
    expect(urls[0].searchParams.get("timezone")).toBe("auto");
    expect(urls[0].searchParams.get("forecast_days")).toBe("16");
    expect(urls[0].searchParams.get("daily")).toBe(
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max"
    );
    expect(rows).toEqual([
      {
        date: "2026-10-01",
        weatherCode: 61,
        temperatureMaxC: 23.4,
        temperatureMinC: 16.2,
        precipitationProbabilityPct: 85,
        precipitationMm: 12.6,
        windSpeedMaxKph: 14.2,
        uvIndexMax: 5.1
      },
      {
        date: "2026-10-02",
        weatherCode: 1,
        temperatureMaxC: 25.1,
        temperatureMinC: 16.8,
        precipitationProbabilityPct: 10,
        precipitationMm: 0,
        windSpeedMaxKph: 9.8,
        uvIndexMax: 8.4
      }
    ]);
  });

  it("requests archive history for an inclusive date range", async () => {
    const urls: URL[] = [];
    const provider = createOpenMeteoProvider({
      fetchImpl: async (url) => {
        urls.push(new URL(String(url)));
        return jsonResponse({
          daily: {
            time: ["2025-10-10"],
            weather_code: [63],
            temperature_2m_max: [22],
            temperature_2m_min: [15],
            precipitation_sum: [8.5],
            wind_speed_10m_max: [12]
          }
        });
      }
    });

    const rows = await provider.getDailyHistory({ latitude: 16.4, longitude: 120.6 }, "2025-10-10", "2025-10-12");

    expect(`${urls[0].origin}${urls[0].pathname}`).toBe("https://archive-api.open-meteo.com/v1/archive");
    expect(urls[0].searchParams.get("start_date")).toBe("2025-10-10");
    expect(urls[0].searchParams.get("end_date")).toBe("2025-10-12");
    expect(urls[0].searchParams.get("daily")).toBe(
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"
    );
    expect(rows).toEqual([
      {
        date: "2025-10-10",
        weatherCode: 63,
        temperatureMaxC: 22,
        temperatureMinC: 15,
        precipitationProbabilityPct: null,
        precipitationMm: 8.5,
        windSpeedMaxKph: 12,
        uvIndexMax: null
      }
    ]);
  });

  it("keeps missing values as null, never zero", () => {
    expect(
      parseOpenMeteoDaily({ daily: { time: ["2026-10-01"], weather_code: [null], temperature_2m_max: [] } })
    ).toEqual([
      {
        date: "2026-10-01",
        weatherCode: null,
        temperatureMaxC: null,
        temperatureMinC: null,
        precipitationProbabilityPct: null,
        precipitationMm: null,
        windSpeedMaxKph: null,
        uvIndexMax: null
      }
    ]);
  });

  it("maps HTTP errors to WEATHER_PROVIDER_UNAVAILABLE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = createOpenMeteoProvider({
      fetchImpl: async () => jsonResponse({ error: true, reason: "Parameter out of range" }, 400)
    });

    await expect(provider.getDailyForecast({ latitude: 1, longitude: 2 })).rejects.toMatchObject({
      statusCode: 503,
      code: "WEATHER_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
  });

  it("passes an abort signal and maps aborted fetches to WEATHER_PROVIDER_UNAVAILABLE", async () => {
    let signal: AbortSignal | undefined;
    const provider = createOpenMeteoProvider({
      timeoutMs: 50,
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
    });

    await expect(provider.getDailyForecast({ latitude: 1, longitude: 2 })).rejects.toMatchObject({
      code: "WEATHER_PROVIDER_UNAVAILABLE"
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects payloads without a daily block", async () => {
    const provider = createOpenMeteoProvider({ fetchImpl: async () => jsonResponse({ latitude: 1 }) });

    await expect(provider.getDailyForecast({ latitude: 1, longitude: 2 })).rejects.toMatchObject({
      code: "WEATHER_PROVIDER_UNAVAILABLE"
    });
  });
});
