import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/cloudinary", () => ({
  isCloudinaryConfigured: () => false,
  uploadPlacePhotoBuffer: vi.fn()
}));

import { createGoogleMapsProvider } from "../src/services/maps";
import { parseAccessibilityOptions } from "../src/services/maps/parsing";
import { backfillUnenrichedSnapshots, enrichResolvedPlaceForSnapshot } from "../src/modules/agent/tools/placeSnapshotEnrichment";

describe("parseAccessibilityOptions", () => {
  it("keeps only real booleans; an absent field stays unknown", () => {
    expect(
      parseAccessibilityOptions({ wheelchairAccessibleEntrance: true, wheelchairAccessibleRestroom: false, wheelchairAccessibleSeating: "yes" })
    ).toEqual({ wheelchairAccessibleEntrance: true, wheelchairAccessibleRestroom: false });
    expect(parseAccessibilityOptions({})).toBeUndefined();
    expect(parseAccessibilityOptions(null)).toBeUndefined();
  });
});

describe("Google place details accessibility", () => {
  it("requests accessibilityOptions and returns the parsed flags", async () => {
    const masks: string[] = [];
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      photoProxyOrigin: "http://api.test",
      fetchImpl: async (_url, init) => {
        masks.push(String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]));
        return new Response(
          JSON.stringify({
            id: "g-1",
            displayName: { text: "Burnham Park" },
            location: { latitude: 16.41, longitude: 120.59 },
            accessibilityOptions: { wheelchairAccessibleEntrance: true, wheelchairAccessibleParking: false }
          }),
          { status: 200 }
        );
      }
    });

    const details = await provider.getPlaceDetails("g-1");

    expect(masks[0].split(",")).toContain("accessibilityOptions");
    expect(details.accessibilityOptions).toEqual({ wheelchairAccessibleEntrance: true, wheelchairAccessibleParking: false });
  });
});

function resolved(overrides: Record<string, unknown> = {}) {
  return {
    provider: "GOOGLE_MAPS" as const,
    providerPlaceId: "g-1",
    name: "Burnham Park",
    location: { latitude: 16.41, longitude: 120.59 },
    metadata: {},
    ...overrides
  };
}

describe("enrichment stores accessibility", () => {
  it("writes the flags with their source and check time", async () => {
    const maps = {
      getPlaceDetails: vi.fn(async () => ({ id: "g-1", name: "Burnham Park", types: [], accessibilityOptions: { wheelchairAccessibleEntrance: true } }))
    } as any;

    const enriched = await enrichResolvedPlaceForSnapshot(maps, resolved() as any);

    expect(enriched.metadata?.accessibility).toEqual({
      wheelchairAccessibleEntrance: true,
      source: "GOOGLE_PLACES",
      checkedAt: expect.any(String)
    });
  });

  it("records a check with no flags when Google has no data", async () => {
    const maps = { getPlaceDetails: vi.fn(async () => ({ id: "g-1", name: "Burnham Park", types: [] })) } as any;

    const enriched = await enrichResolvedPlaceForSnapshot(maps, resolved() as any);

    expect(enriched.metadata?.accessibility).toEqual({ source: "GOOGLE_PLACES", checkedAt: expect.any(String) });
  });

  it("skips a snapshot that is fully enriched and already checked", async () => {
    const maps = { getPlaceDetails: vi.fn() } as any;

    await enrichResolvedPlaceForSnapshot(
      maps,
      resolved({
        rating: 4.5,
        websiteUrl: "https://example.com",
        metadata: { primaryPhotoUrl: "https://img.test/a.jpg", accessibility: { source: "GOOGLE_PLACES", checkedAt: "2026-10-01T00:00:00.000Z" } }
      }) as any
    );

    expect(maps.getPlaceDetails).not.toHaveBeenCalled();
  });

  it("re-checks an older snapshot once, keeping its stored photo", async () => {
    const maps = {
      getPlaceDetails: vi.fn(async () => ({
        id: "g-1",
        name: "Burnham Park",
        types: [],
        photos: [{ name: "places/g-1/photos/p1", photoUri: "http://api.test/images/place-photo?name=x" }]
      })),
      fetchPlacePhoto: vi.fn()
    } as any;

    const enriched = await enrichResolvedPlaceForSnapshot(
      maps,
      resolved({ rating: 4.5, websiteUrl: "https://example.com", metadata: { primaryPhotoUrl: "https://img.test/a.jpg" } }) as any
    );

    expect(maps.getPlaceDetails).toHaveBeenCalledTimes(1);
    expect(maps.fetchPlacePhoto).not.toHaveBeenCalled();
    expect(enriched.metadata?.primaryPhotoUrl).toBe("https://img.test/a.jpg");
    expect(enriched.metadata?.accessibility).toMatchObject({ source: "GOOGLE_PLACES" });
  });
});

describe("post-run backfill", () => {
  it("re-checks Google snapshots missing accessibility and leaves Nominatim rows alone", async () => {
    const row = (overrides: Record<string, unknown>) => ({
      name: "Place",
      latitude: 1,
      longitude: 2,
      rating: 4,
      websiteUrl: "https://example.com",
      phoneNumber: null,
      formattedAddress: null,
      metadata: { primaryPhotoUrl: "https://img.test/a.jpg" },
      businessStatus: null,
      businessStatusCheckedAt: null,
      ...overrides
    });
    const client = {
      placeSnapshot: {
        findMany: vi.fn(async () => [
          row({ id: "s1", provider: "GOOGLE_MAPS", providerPlaceId: "g-1" }),
          row({ id: "s2", provider: "NOMINATIM", providerPlaceId: "n-1" })
        ]),
        upsert: vi.fn(async ({ create }: any) => ({ id: "s1", ...create }))
      }
    } as any;
    const maps = { getPlaceDetails: vi.fn(async (id: string) => ({ id, name: "Place", types: [] })) } as any;

    await backfillUnenrichedSnapshots({
      itinerary: { days: [{ items: [{ placeSnapshotId: "s1" }, { placeSnapshotId: "s2" }] }] },
      maps,
      client
    });

    expect(maps.getPlaceDetails).toHaveBeenCalledTimes(1);
    expect(maps.getPlaceDetails).toHaveBeenCalledWith("g-1");
    expect(client.placeSnapshot.upsert).toHaveBeenCalledTimes(1);
  });
});
