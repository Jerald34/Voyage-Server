import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createGetGooglePlacePhotosTool,
  createMapPinpointTool,
  createPlaceInsightsTool,
  createRouteLogisticsTool,
  createSearchGooglePlacesTool,
  createSearchNearbyGooglePlacesTool
} from "../src/modules/agent/agentTools";
import { buildPlaceGate } from "../src/services/places/placeGate";
import { createPlaceSelectionService } from "../src/services/places/placeSelectionService";
import { createPlaceSnapshotRepository } from "../src/services/places/placeSnapshotRepository";
import type { PlaceNote } from "../src/services/places/placeTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-06T12:00:00.000Z");

/** Records everything the tools try to emit, so we can assert nothing leaks. */
function recordingAgentService() {
  const events: Array<{ type: string; payload: unknown }> = [];
  const sources: unknown[] = [];
  return {
    events,
    sources,
    service: {
      async recordRunEvent(_run: unknown, event: { type: string; payload: unknown }) {
        events.push(event);
        return undefined;
      },
      async recordTask() {
        return undefined;
      },
      async recordSources(_run: unknown, entries: unknown[]) {
        sources.push(...entries);
        return undefined;
      }
    } as never
  };
}

function memoryClient() {
  const rows: any[] = [];
  const find = (provider: string, providerPlaceId: string) =>
    rows.find((row) => row.provider === provider && row.providerPlaceId === providerPlaceId);

  return {
    rows,
    placeSnapshot: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.provider_providerPlaceId;
        if (key) return find(key.provider, key.providerPlaceId) ?? null;
        return rows.find((row) => row.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.provider_providerPlaceId;
        const existing = find(key.provider, key.providerPlaceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = {
          id: `snap-${rows.length + 1}`,
          businessStatus: null,
          businessStatusCheckedAt: null,
          ...create
        };
        rows.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = find(where.provider, where.providerPlaceId);
        if (!existing) return { count: 0 };
        const stored = existing.businessStatusCheckedAt;
        const incoming = where.OR?.[1]?.businessStatusCheckedAt?.lt as Date | undefined;
        if (stored !== null && (!incoming || stored.getTime() >= incoming.getTime())) {
          return { count: 0 };
        }
        Object.assign(existing, data);
        return { count: 1 };
      })
    }
  } as any;
}

function buildSession(notes: PlaceNote[] = []) {
  const client = memoryClient();
  const repository = createPlaceSnapshotRepository(client);
  const service = createPlaceSelectionService({
    repository,
    maps: null,
    scheduler: {
      refresh: async () => ({ kind: "fresh" as const }),
      scheduleRead: () => {},
      drain: async () => {},
      stats: () => ({}) as never
    } as never,
    createGate: async () => buildPlaceGate(notes),
    ttlMs: 30 * DAY_MS,
    now: () => NOW,
    runBudget: { remaining: 20 }
  });
  return { client, session: service.createSession("agency-1") };
}

async function context(notes: PlaceNote[] = []) {
  const { client, session } = buildSession(notes);
  return {
    client,
    context: {
      agencyId: "agency-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
      places: await session
    }
  };
}

const closedNote: PlaceNote = {
  provider: null,
  providerPlaceId: null,
  placeName: "Bayview",
  cityContext: null,
  status: "CLOSED",
  note: "Guide confirmed closure"
};

function searchResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-open",
    name: "Open Cafe",
    address: "1 Open St",
    location: { latitude: 1, longitude: 2 },
    rating: 4.2,
    userRatingCount: 100,
    types: ["cafe"],
    ...overrides
  };
}

function resolvedPlace(overrides: Record<string, unknown> = {}) {
  return {
    provider: "GOOGLE_MAPS" as const,
    providerPlaceId: "g-open",
    name: "Open Cafe",
    formattedAddress: "1 Open St",
    location: { latitude: 1, longitude: 2 },
    metadata: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------

describe("search_google_places", () => {
  it("returns allowed results and minimal blocked explanations", async () => {
    const { context: ctx } = await context();
    const { service } = recordingAgentService();
    const tool = createSearchGooglePlacesTool({
      agentService: service,
      maps: {
        async searchPlaces() {
          return [
            searchResult({ id: "g-1", name: "Alpha" }),
            searchResult({
              id: "g-closed",
              name: "Closed Diner",
              businessStatus: "CLOSED_PERMANENTLY",
              businessStatusCheckedAt: NOW
            }),
            searchResult({ id: "g-2", name: "Beta" })
          ];
        }
      } as never
    });

    const output = (await tool.execute(ctx as never, { query: "cafes" })) as {
      results: Array<{ name: string }>;
      blocked: Array<Record<string, unknown>>;
    };

    // Input order is preserved among the allowed results.
    expect(output.results.map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
    expect(output.blocked).toHaveLength(1);
    expect(output.blocked[0]).toEqual({
      name: "Closed Diner",
      reason: "CLOSED_PERMANENTLY",
      detail: expect.any(String)
    });
    // A blocked entry never carries usable coordinates, IDs or URLs.
    expect(Object.keys(output.blocked[0]).sort()).toEqual(["detail", "name", "reason"]);
  });

  it("preserves every field of an allowed raw result", async () => {
    const { context: ctx } = await context();
    const { service } = recordingAgentService();
    const tool = createSearchGooglePlacesTool({
      agentService: service,
      maps: {
        async searchPlaces() {
          return [searchResult({ businessStatus: "CLOSED_TEMPORARILY", businessStatusCheckedAt: NOW })];
        }
      } as never
    });

    const output = (await tool.execute(ctx as never, { query: "cafes" })) as {
      results: Array<Record<string, unknown>>;
    };

    expect(output.results[0]).toMatchObject({
      id: "g-open",
      address: "1 Open St",
      rating: 4.2,
      userRatingCount: 100,
      types: ["cafe"],
      // A temporary closure is an advisory, not a block.
      businessStatus: "CLOSED_TEMPORARILY"
    });
  });

  it("persists the observation of a blocked candidate", async () => {
    const { context: ctx, client } = await context();
    const { service } = recordingAgentService();
    const tool = createSearchGooglePlacesTool({
      agentService: service,
      maps: {
        async searchPlaces() {
          return [
            searchResult({
              id: "g-dead",
              name: "Dead Place",
              businessStatus: "CLOSED_PERMANENTLY",
              businessStatusCheckedAt: NOW
            })
          ];
        }
      } as never
    });

    await tool.execute(ctx as never, { query: "cafes" });

    const stored = client.rows.find((row: any) => row.providerPlaceId === "g-dead");
    expect(stored?.businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("blocks by agency note and can block every result", async () => {
    const { context: ctx } = await context([closedNote]);
    const { service } = recordingAgentService();
    const tool = createSearchGooglePlacesTool({
      agentService: service,
      maps: {
        async searchPlaces() {
          return [searchResult({ id: "g-b", name: "Bayview" })];
        }
      } as never
    });

    const output = (await tool.execute(ctx as never, { query: "bayview" })) as {
      results: unknown[];
      blocked: Array<{ reason: string }>;
    };

    expect(output.results).toEqual([]);
    expect(output.blocked[0].reason).toBe("AGENCY_CLOSED");
  });
});

describe("search_nearby_google_places", () => {
  it("partitions the same way and preserves input order", async () => {
    const { context: ctx } = await context();
    const { service } = recordingAgentService();
    const tool = createSearchNearbyGooglePlacesTool({
      agentService: service,
      maps: {
        async searchNearby() {
          return [
            searchResult({ id: "n-1", name: "First" }),
            searchResult({
              id: "n-closed",
              name: "Shut",
              businessStatus: "CLOSED_PERMANENTLY",
              businessStatusCheckedAt: NOW
            }),
            searchResult({ id: "n-2", name: "Second" })
          ];
        }
      } as never
    });

    const output = (await tool.execute(ctx as never, {
      location: { latitude: 1, longitude: 2 },
      radius: 500
    })) as { results: Array<{ name: string }>; blocked: unknown[] };

    expect(output.results.map((entry) => entry.name)).toEqual(["First", "Second"]);
    expect(output.blocked).toHaveLength(1);
  });
});

describe("get_google_place_details", () => {
  it("rejects a closed place with a recoverable error and records no source", async () => {
    const { context: ctx, client } = await context();
    const recorder = recordingAgentService();
    const tool = createGetGooglePlaceDetailsTool({
      agentService: recorder.service,
      maps: {
        async getPlaceDetails() {
          return {
            ...searchResult({ id: "g-dead", name: "Dead Place" }),
            businessStatus: "CLOSED_PERMANENTLY",
            businessStatusCheckedAt: NOW
          };
        }
      } as never
    });

    const error = await tool.execute(ctx as never, { placeId: "g-dead" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(recorder.sources).toHaveLength(0);
    // The observation is still persisted even though the candidate was rejected.
    expect(client.rows.find((row: any) => row.providerPlaceId === "g-dead")?.businessStatus).toBe(
      "CLOSED_PERMANENTLY"
    );
  });

  it("returns usable details for an allowed place", async () => {
    const { context: ctx } = await context();
    const recorder = recordingAgentService();
    const tool = createGetGooglePlaceDetailsTool({
      agentService: recorder.service,
      maps: {
        async getPlaceDetails() {
          return searchResult({ websiteUri: "https://example.test" });
        }
      } as never
    });

    const output = (await tool.execute(ctx as never, { placeId: "g-open" })) as Record<string, unknown>;

    expect(output).toMatchObject({ id: "g-open", websiteUri: "https://example.test" });
    expect(recorder.sources).toHaveLength(1);
  });
});

describe("map_pinpoint", () => {
  it("emits no map event and records no source for a blocked place", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const tool = createMapPinpointTool({
      agentService: recorder.service,
      maps: { async resolvePlace() { return resolvedPlace({ name: "Bayview" }); } } as never,
      placeSnapshotClient: memoryClient()
    });

    const error = await tool.execute(ctx as never, { placeName: "Bayview" }).catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(recorder.events).toHaveLength(0);
    expect(recorder.sources).toHaveLength(0);
  });

  it("pins an allowed place as before", async () => {
    const { context: ctx } = await context();
    const recorder = recordingAgentService();
    const tool = createMapPinpointTool({
      agentService: recorder.service,
      maps: { async resolvePlace() { return resolvedPlace(); } } as never,
      placeSnapshotClient: memoryClient()
    });

    const payload = (await tool.execute(ctx as never, { placeName: "Open Cafe" })) as Record<string, unknown>;

    expect(payload.name).toBe("Open Cafe");
    expect(recorder.events.map((event) => event.type)).toEqual(["map.pinpointed"]);
  });

  it("blocks a place the provider reports permanently closed", async () => {
    const { context: ctx } = await context();
    const recorder = recordingAgentService();
    const tool = createMapPinpointTool({
      agentService: recorder.service,
      maps: {
        async resolvePlace() {
          return resolvedPlace({
            providerPlaceId: "g-dead",
            name: "Dead Place",
            businessStatus: "CLOSED_PERMANENTLY",
            businessStatusCheckedAt: NOW
          });
        }
      } as never,
      placeSnapshotClient: memoryClient()
    });

    const error = await tool.execute(ctx as never, { placeName: "Dead Place" }).catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(recorder.events).toHaveLength(0);
  });
});

describe("place_insights", () => {
  it("applies agency policy before insights become a candidate", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const tool = createPlaceInsightsTool({
      agentService: recorder.service,
      maps: { async resolvePlace() { return resolvedPlace({ name: "Bayview" }); } } as never,
      placeSnapshotClient: memoryClient()
    });

    const error = await tool.execute(ctx as never, { placeName: "Bayview" }).catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(recorder.sources).toHaveLength(0);
  });
});

describe("route_logistics", () => {
  it("checks both endpoints before routing or emitting", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const estimateRoute = vi.fn(async () => ({ distanceMeters: 100 }));
    const tool = createRouteLogisticsTool({
      agentService: recorder.service,
      maps: {
        async resolvePlace(input: { placeName: string }) {
          return resolvedPlace({
            providerPlaceId: `g-${input.placeName}`,
            name: input.placeName
          });
        },
        estimateRoute
      } as never,
      placeSnapshotClient: memoryClient()
    });

    const error = await tool
      .execute(ctx as never, { originPlaceName: "Open Cafe", destinationPlaceName: "Bayview" })
      .catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    // No paid route call and no event for a pair we already know is ineligible.
    expect(estimateRoute).not.toHaveBeenCalled();
    expect(recorder.events).toHaveLength(0);
    expect(recorder.sources).toHaveLength(0);
  });

  it("routes an allowed pair", async () => {
    const { context: ctx } = await context();
    const recorder = recordingAgentService();
    const tool = createRouteLogisticsTool({
      agentService: recorder.service,
      maps: {
        async resolvePlace(input: { placeName: string }) {
          return resolvedPlace({ providerPlaceId: `g-${input.placeName}`, name: input.placeName });
        },
        async estimateRoute() {
          return { distanceMeters: 100, durationSeconds: 60 };
        }
      } as never,
      placeSnapshotClient: memoryClient()
    });

    const payload = (await tool.execute(ctx as never, {
      originPlaceName: "Open Cafe",
      destinationPlaceName: "Other Cafe"
    })) as Record<string, unknown>;

    expect(payload.distanceMeters).toBe(100);
    expect(recorder.events.map((event) => event.type)).toEqual(["route.estimated"]);
  });
});

describe("estimate_route", () => {
  it("checks both endpoints in name mode", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const estimateRoute = vi.fn(async () => ({ distanceMeters: 100 }));
    const tool = createEstimateRouteTool({
      agentService: recorder.service,
      maps: {
        async resolvePlace(input: { placeName: string }) {
          return resolvedPlace({ providerPlaceId: `g-${input.placeName}`, name: input.placeName });
        },
        estimateRoute
      } as never,
      placeSnapshotClient: memoryClient()
    });

    const error = await tool
      .execute(ctx as never, { originPlaceName: "Bayview", destinationPlaceName: "Open Cafe" })
      .catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(estimateRoute).not.toHaveBeenCalled();
    expect(recorder.events).toHaveLength(0);
  });

  it("leaves coordinate-only routing as a pure geometric calculation", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const resolvePlace = vi.fn();
    const tool = createEstimateRouteTool({
      agentService: recorder.service,
      maps: {
        resolvePlace,
        async estimateRoute() {
          return { distanceMeters: 500, durationSeconds: 120 };
        }
      } as never,
      placeSnapshotClient: memoryClient()
    });

    const result = (await tool.execute(ctx as never, {
      origin: { latitude: 1, longitude: 2 },
      destination: { latitude: 3, longitude: 4 }
    })) as Record<string, unknown>;

    expect(result.distanceMeters).toBe(500);
    expect(resolvePlace).not.toHaveBeenCalled();
    expect(recorder.events.map((event) => event.type)).toEqual(["route.estimated"]);
  });
});

describe("get_google_place_photos", () => {
  it("stays historical media retrieval and triggers no status request", async () => {
    const { context: ctx } = await context([closedNote]);
    const recorder = recordingAgentService();
    const getPlaceStatus = vi.fn();
    const tool = createGetGooglePlacePhotosTool({
      agentService: recorder.service,
      maps: {
        async getPlacePhotos() {
          return [{ name: "places/x/photos/y", photoUri: "https://example.test/p.jpg" }];
        },
        getPlaceStatus
      } as never
    });

    const photos = (await tool.execute(ctx as never, { placeId: "g-bayview" })) as unknown[];

    expect(photos).toHaveLength(1);
    expect(getPlaceStatus).not.toHaveBeenCalled();
  });
});

describe("without a session", () => {
  it("falls back to ungated behavior so isolated unit tests still work", async () => {
    const recorder = recordingAgentService();
    const tool = createSearchGooglePlacesTool({
      agentService: recorder.service,
      maps: {
        async searchPlaces() {
          return [searchResult({ businessStatus: "CLOSED_PERMANENTLY", businessStatusCheckedAt: NOW })];
        }
      } as never
    });

    const output = (await tool.execute(
      { agencyId: "agency-1", threadId: "t", runId: "r", userId: "u" } as never,
      { query: "cafes" }
    )) as { results: unknown[]; blocked: unknown[] };

    expect(output.results).toHaveLength(1);
    expect(output.blocked).toEqual([]);
  });
});
