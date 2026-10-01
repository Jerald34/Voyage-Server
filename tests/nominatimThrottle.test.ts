import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nominatim's usage policy allows at most one request per second, across the whole
// process. Concurrent callers (for example two weather lookups in one run, or two
// agent runs at once) must be spaced out, not all released after the same wait.
describe("Nominatim throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    // The throttle is module-level state; start every test from a fresh module.
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function placePayload(name: string) {
    return [{ place_id: `id-${name}`, display_name: `${name}, Philippines`, name, lat: "16.4", lon: "120.6" }];
  }

  it("spaces concurrent requests at least a second apart", async () => {
    const { createNominatimMapsProvider } = await import("../src/services/maps/nominatim");
    const requestTimes: number[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requestTimes.push(Date.now());
      const query = new URL(String(url)).searchParams.get("q") ?? "";
      return new Response(JSON.stringify(placePayload(query)), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createNominatimMapsProvider({
      baseUrl: "https://nominatim.example.test",
      userAgent: "Voyage-Test/1.0",
      fetchImpl
    });

    const pending = Promise.all(
      ["Baguio", "Sagada", "Vigan", "Banaue"].map((placeName) => provider.resolvePlace({ placeName }))
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const places = await pending;

    expect(places.map((place) => place.name)).toEqual(["Baguio", "Sagada", "Vigan", "Banaue"]);
    expect(requestTimes).toHaveLength(4);
    for (let index = 1; index < requestTimes.length; index += 1) {
      expect(requestTimes[index] - requestTimes[index - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("shares the spacing across provider instances and survives a failed request", async () => {
    const { createNominatimMapsProvider } = await import("../src/services/maps/nominatim");
    const requestTimes: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requestTimes.push(Date.now());
      calls += 1;
      if (calls === 1) return new Response("[]", { status: 200 });
      const query = new URL(String(url)).searchParams.get("q") ?? "";
      return new Response(JSON.stringify(placePayload(query)), { status: 200 });
    }) as unknown as typeof fetch;
    const options = { baseUrl: "https://nominatim.example.test", userAgent: "Voyage-Test/1.0", fetchImpl };
    const first = createNominatimMapsProvider(options);
    const second = createNominatimMapsProvider(options);

    const failed = first.resolvePlace({ placeName: "Atlantis" }).catch((error: unknown) => error);
    const succeeded = second.resolvePlace({ placeName: "Baguio" });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await failed).toMatchObject({ code: "MAPS_PROVIDER_UNAVAILABLE" });
    expect((await succeeded).name).toBe("Baguio");
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(1000);
  });
});
