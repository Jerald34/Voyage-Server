import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { ApiError } from "../src/http/errors";
import { createItineraryWeatherService } from "../src/modules/weather/weatherService";

const NOW = new Date("2026-10-01T02:00:00.000Z");

function forecastProvider() {
  return {
    name: "open-meteo" as const,
    getDailyForecast: vi.fn(async () => [
      {
        date: "2026-10-10",
        weatherCode: 3,
        temperatureMaxC: 24,
        temperatureMinC: 16,
        precipitationProbabilityPct: 20,
        precipitationMm: 0,
        windSpeedMaxKph: 8,
        uvIndexMax: 6
      }
    ]),
    getDailyHistory: vi.fn(async () => [])
  };
}

const locatedDay = { id: "day-1", dayNumber: 1, date: null, items: [{ placeSnapshot: { latitude: 16.4, longitude: 120.6 } }] };

function build(overrides: Partial<Parameters<typeof createItineraryWeatherService>[0]> = {}) {
  const provider = forecastProvider();
  const deps = {
    loadAgencyItinerary: vi.fn(async () => ({ tripId: "trip-1", days: [locatedDay] })),
    loadTripStartDate: vi.fn(async () => new Date("2026-10-10T00:00:00.000Z")),
    loadShare: vi.fn(async () => ({
      share: { revokedAt: null, expiresAt: null },
      trip: { startDate: new Date("2026-10-10T00:00:00.000Z") },
      itinerary: { days: [locatedDay] }
    })),
    getProvider: () => provider,
    typicalYears: 5,
    now: () => NOW,
    ...overrides
  };
  return { service: createItineraryWeatherService(deps), deps, provider };
}

describe("itinerary weather service", () => {
  it("builds agency weather from the itinerary and its trip start date", async () => {
    const { service, deps } = build();

    const result = await service.forAgencyItinerary("agency-1", "itinerary-1");

    expect(deps.loadAgencyItinerary).toHaveBeenCalledWith("agency-1", "itinerary-1");
    expect(deps.loadTripStartDate).toHaveBeenCalledWith("agency-1", "trip-1");
    expect(result.days[0]).toMatchObject({ date: "2026-10-10", status: "OK" });
  });

  it("skips the trip lookup when the itinerary has no trip", async () => {
    const { service, deps } = build({
      loadAgencyItinerary: vi.fn(async () => ({ tripId: null, days: [locatedDay] }))
    });

    const result = await service.forAgencyItinerary("agency-1", "itinerary-1");

    expect(deps.loadTripStartDate).not.toHaveBeenCalled();
    expect(result.days[0].status).toBe("NO_DATE");
  });

  it("passes through the itinerary loader's 404", async () => {
    const { service } = build({
      loadAgencyItinerary: vi.fn(async () => {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      })
    });

    await expect(service.forAgencyItinerary("agency-1", "other")).rejects.toMatchObject({ code: "ITINERARY_NOT_FOUND" });
  });

  it("serves an active share and applies the share rules", async () => {
    const { service } = build();
    await expect(service.forShareToken("share-token-12")).resolves.toMatchObject({ days: [{ status: "OK" }] });

    const missing = build({ loadShare: vi.fn(async () => null) });
    await expect(missing.service.forShareToken("nope-nope-nope")).rejects.toMatchObject({ statusCode: 404, code: "SHARE_NOT_FOUND" });

    const revoked = build({
      loadShare: vi.fn(async () => ({ share: { revokedAt: NOW, expiresAt: null }, trip: null, itinerary: { days: [] } }))
    });
    await expect(revoked.service.forShareToken("share-token-12")).rejects.toMatchObject({ statusCode: 410, code: "SHARE_REVOKED" });

    const expired = build({
      loadShare: vi.fn(async () => ({ share: { revokedAt: null, expiresAt: NOW }, trip: null, itinerary: { days: [] } }))
    });
    await expect(expired.service.forShareToken("share-token-12")).rejects.toMatchObject({ statusCode: 410, code: "SHARE_EXPIRED" });
  });

  it("uses day dates alone for a personal share with no trip", async () => {
    const { service } = build({
      loadShare: vi.fn(async () => ({
        share: { revokedAt: null, expiresAt: null },
        trip: null,
        itinerary: { days: [{ ...locatedDay, date: "2026-10-10" }] }
      }))
    });

    await expect(service.forShareToken("share-token-12")).resolves.toMatchObject({ days: [{ date: "2026-10-10", status: "OK" }] });
  });
});
