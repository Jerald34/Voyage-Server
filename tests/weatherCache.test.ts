import { describe, expect, it, vi } from "vitest";
import { createCachedWeatherProvider, createTtlCache } from "../src/services/weather/weatherCache";

describe("createTtlCache", () => {
  it("shares one in-flight load per key and reloads after expiry", async () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 10, now: () => clock });
    const load = vi.fn(async () => 1);

    await Promise.all([cache.get("a", load), cache.get("a", load)]);
    expect(load).toHaveBeenCalledTimes(1);

    clock = 101;
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts a failed load so the next call retries", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    const failing = vi.fn(async () => {
      throw new Error("down");
    });

    await expect(cache.get("a", failing)).rejects.toThrow("down");
    const ok = vi.fn(async () => 2);
    await expect(cache.get("a", ok)).resolves.toBe(2);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("drops the oldest entry past maxEntries", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 2 });
    await cache.get("a", async () => "a");
    await cache.get("b", async () => "b");
    await cache.get("c", async () => "c");

    expect(cache.size()).toBe(2);
    const reload = vi.fn(async () => "a2");
    await cache.get("a", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("createCachedWeatherProvider", () => {
  it("reuses a forecast for points in the same ~1 km cell and keys history by range", async () => {
    const inner = {
      name: "open-meteo" as const,
      getDailyForecast: vi.fn(async () => []),
      getDailyHistory: vi.fn(async () => [])
    };
    const cached = createCachedWeatherProvider(inner);

    await cached.getDailyForecast({ latitude: 16.4023, longitude: 120.5961 });
    await cached.getDailyForecast({ latitude: 16.4049, longitude: 120.5951 });
    expect(inner.getDailyForecast).toHaveBeenCalledTimes(1);

    await cached.getDailyHistory({ latitude: 16.4, longitude: 120.6 }, "2025-10-10", "2025-10-12");
    await cached.getDailyHistory({ latitude: 16.4, longitude: 120.6 }, "2025-10-10", "2025-10-12");
    await cached.getDailyHistory({ latitude: 16.4, longitude: 120.6 }, "2024-10-10", "2024-10-12");
    expect(inner.getDailyHistory).toHaveBeenCalledTimes(2);
  });
});
