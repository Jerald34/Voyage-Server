import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import { buildPlaceGate } from "../src/services/places/placeGate";
import { createPlaceSelectionService } from "../src/services/places/placeSelectionService";
import type { PlaceNote } from "../src/services/places/placeTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-06T12:00:00.000Z");

type Row = {
  id: string;
  provider: "GOOGLE_MAPS" | "NOMINATIM";
  providerPlaceId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  businessStatus: string | null;
  businessStatusCheckedAt: Date | null;
  fetchedAt: Date;
  formattedAddress?: string | null;
  metadata?: unknown;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "snap-1",
    provider: "GOOGLE_MAPS",
    providerPlaceId: "g-1",
    name: "Bayview",
    latitude: 1,
    longitude: 2,
    businessStatus: null,
    businessStatusCheckedAt: null,
    fetchedAt: new Date(NOW.getTime() - DAY_MS),
    ...overrides
  };
}

/** Minimal snapshot repository fake with the same read-after-write semantics. */
function fakeRepository(rows: Row[] = []) {
  const store = [...rows];
  const calls = { saveProviderCandidate: 0, observeStatus: 0, upsert: 0 };

  return {
    store,
    calls,
    async findById(id: string) {
      return store.find((entry) => entry.id === id) ?? null;
    },
    async findByProviderId(provider: string, providerPlaceId: string) {
      return store.find((e) => e.provider === provider && e.providerPlaceId === providerPlaceId) ?? null;
    },
    async findCachedByName(name: string) {
      return store.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    async upsertPlaceSnapshot(place: any) {
      calls.upsert += 1;
      const existing = store.find(
        (e) => e.provider === place.provider && e.providerPlaceId === place.providerPlaceId
      );
      if (existing) {
        existing.name = place.name;
        return existing;
      }
      const created = row({
        id: `snap-${store.length + 1}`,
        provider: place.provider,
        providerPlaceId: place.providerPlaceId,
        name: place.name,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null
      });
      store.push(created);
      return created;
    },
    async saveProviderCandidate(input: any) {
      calls.saveProviderCandidate += 1;
      let existing = store.find(
        (e) => e.provider === input.provider && e.providerPlaceId === input.providerPlaceId
      );
      if (!existing) {
        existing = row({
          id: `snap-${store.length + 1}`,
          provider: input.provider,
          providerPlaceId: input.providerPlaceId,
          name: input.name,
          latitude: input.location?.latitude ?? null,
          longitude: input.location?.longitude ?? null,
          businessStatus: null,
          businessStatusCheckedAt: null
        });
        store.push(existing);
      }
      if (input.observation) {
        const stored = existing.businessStatusCheckedAt;
        if (!stored || stored.getTime() < input.observation.businessStatusCheckedAt.getTime()) {
          existing.businessStatus = input.observation.businessStatus;
          existing.businessStatusCheckedAt = input.observation.businessStatusCheckedAt;
        }
      }
      return existing;
    },
    async observeStatus(provider: string, providerPlaceId: string, observation: any) {
      calls.observeStatus += 1;
      const existing = store.find((e) => e.provider === provider && e.providerPlaceId === providerPlaceId);
      if (!existing) return null;
      const stored = existing.businessStatusCheckedAt;
      if (!stored || stored.getTime() < observation.businessStatusCheckedAt.getTime()) {
        existing.businessStatus = observation.businessStatus;
        existing.businessStatusCheckedAt = observation.businessStatusCheckedAt;
      }
      return existing;
    }
  };
}

function fakeScheduler(overrides: Partial<{ refresh: any }> = {}) {
  return {
    refresh: vi.fn(async () => ({ kind: "fresh" as const })),
    scheduleRead: vi.fn(),
    drain: vi.fn(async () => {}),
    stats: vi.fn(() => ({}) as any),
    ...overrides
  } as any;
}

function build(options: {
  rows?: Row[];
  notes?: PlaceNote[];
  notesAvailable?: boolean;
  maps?: any;
  scheduler?: any;
} = {}) {
  const repository = fakeRepository(options.rows ?? []);
  const scheduler = options.scheduler ?? fakeScheduler();
  const service = createPlaceSelectionService({
    repository: repository as any,
    maps: options.maps ?? null,
    scheduler,
    createGate: async () => buildPlaceGate(options.notes ?? [], options.notesAvailable ?? true),
    ttlMs: 30 * DAY_MS,
    now: () => NOW,
    runBudget: { remaining: 20 }
  });
  return { service, repository, scheduler };
}

function note(overrides: Partial<PlaceNote> = {}): PlaceNote {
  return {
    provider: null,
    providerPlaceId: null,
    placeName: "Bayview",
    cityContext: null,
    status: "NEUTRAL",
    note: null,
    ...overrides
  };
}

async function expectBlocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).statusCode).toBe(409);
  expect((error as ApiError).code).toBe("PLACE_BLOCKED");
  return error as ApiError;
}

describe("prepare with a supplied snapshot ID", () => {
  it("blocks a fresh cached closure without calling the provider", async () => {
    const maps = { resolvePlace: vi.fn() };
    const { service } = build({
      maps,
      rows: [
        row({
          businessStatus: "CLOSED_PERMANENTLY",
          businessStatusCheckedAt: new Date(NOW.getTime() - DAY_MS)
        })
      ]
    });
    const session = await service.createSession("agency-1");

    const error = await expectBlocked(session.prepare({ placeSnapshotId: "snap-1" }));
    expect(error.message).toContain("Bayview");
    expect(maps.resolvePlace).not.toHaveBeenCalled();
  });

  it("fails with PLACE_SNAPSHOT_NOT_FOUND for a missing supplied ID", async () => {
    const { service } = build();
    const session = await service.createSession("agency-1");

    const error = await session.prepare({ placeSnapshotId: "missing" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PLACE_SNAPSHOT_NOT_FOUND");
  });

  it("refreshes a stale known ID before deciding and re-reads the stored status", async () => {
    const repositoryRows = [
      row({ businessStatusCheckedAt: new Date(NOW.getTime() - 90 * DAY_MS), businessStatus: "OPERATIONAL" })
    ];
    const scheduler = fakeScheduler();
    const { service, repository } = build({ rows: repositoryRows, scheduler });
    // The refresh writes a closure into storage, exactly as the real one would.
    scheduler.refresh.mockImplementation(async () => {
      await repository.observeStatus("GOOGLE_MAPS", "g-1", {
        businessStatus: "CLOSED_PERMANENTLY",
        businessStatusCheckedAt: NOW
      });
      return { kind: "updated" as const };
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeSnapshotId: "snap-1" }));
    expect(scheduler.refresh).toHaveBeenCalledTimes(1);
  });

  it("allows a supplied ID whose status is unknown", async () => {
    const { service } = build({ rows: [row()] });
    const session = await service.createSession("agency-1");

    const prepared = await session.prepare({ placeSnapshotId: "snap-1" });
    expect(prepared.placeSnapshotId).toBe("snap-1");
    expect(prepared.point).toEqual({ latitude: 1, longitude: 2 });
  });

  it("keeps blocking a known agency closure when maps is unavailable", async () => {
    const { service } = build({
      maps: null,
      rows: [row()],
      notes: [note({ status: "CLOSED", placeName: "Bayview" })]
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeSnapshotId: "snap-1" }));
  });
});

describe("prepare by name", () => {
  it("applies an unresolved agency note before any provider call", async () => {
    const maps = { resolvePlace: vi.fn() };
    const { service } = build({
      maps,
      notes: [note({ status: "AVOID", placeName: "Bayview", cityContext: "Cebu" })]
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Bayview", cityContext: "Cebu" }));
    expect(maps.resolvePlace).not.toHaveBeenCalled();
  });

  it("blocks by name even with no maps provider configured", async () => {
    const { service } = build({ maps: null, notes: [note({ status: "CLOSED" })] });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Bayview" }));
  });

  it("uses a generally fresh cached row instead of resolving", async () => {
    const maps = { resolvePlace: vi.fn() };
    const { service } = build({ maps, rows: [row()] });
    const session = await service.createSession("agency-1");

    const prepared = await session.prepare({ placeName: "Bayview" });

    expect(maps.resolvePlace).not.toHaveBeenCalled();
    expect(prepared.placeSnapshotId).toBe("snap-1");
  });

  it("resolves a new name through the provider and persists its observation", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-new",
        name: "New Cafe",
        location: { latitude: 5, longitude: 6 },
        businessStatus: "OPERATIONAL" as const,
        businessStatusCheckedAt: NOW
      }))
    };
    const { service, repository } = build({ maps });
    const session = await service.createSession("agency-1");

    const prepared = await session.prepare({ placeName: "New Cafe" });

    expect(maps.resolvePlace).toHaveBeenCalledTimes(1);
    expect(prepared.point).toEqual({ latitude: 5, longitude: 6 });
    const stored = repository.store.find((entry) => entry.providerPlaceId === "g-new");
    expect(stored?.businessStatus).toBe("OPERATIONAL");
  });

  it("persists a blocked candidate's closure observation before rejecting it", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-closed",
        name: "Closed Diner",
        location: { latitude: 5, longitude: 6 },
        businessStatus: "CLOSED_PERMANENTLY" as const,
        businessStatusCheckedAt: NOW
      }))
    };
    const { service, repository } = build({ maps });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Closed Diner" }));

    const stored = repository.store.find((entry) => entry.providerPlaceId === "g-closed");
    expect(stored?.businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("checks the resolved provider name and ID, not only the requested name", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-blocked",
        name: "Actual Name",
        location: { latitude: 5, longitude: 6 }
      }))
    };
    const { service } = build({
      maps,
      notes: [note({ provider: "GOOGLE_MAPS", providerPlaceId: "g-blocked", status: "AVOID", placeName: "Actual Name" })]
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Requested Name" }));
  });

  it("keeps the best-effort unresolved item when resolution fails and nothing blocks it", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => {
        throw new Error("provider unavailable");
      })
    };
    const { service } = build({ maps });
    const session = await service.createSession("agency-1");

    const prepared = await session.prepare({ placeName: "Somewhere" });

    expect(prepared.placeSnapshotId).toBeUndefined();
    expect(prepared.point).toBeNull();
  });

  it("does not swallow a block as a generic maps failure", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => {
        throw new Error("should not be reached");
      })
    };
    const { service } = build({ maps, notes: [note({ status: "CLOSED" })] });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Bayview" }));
  });

  it("merges the stored closure when the latest provider response omits status", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-1",
        name: "Bayview",
        location: { latitude: 1, longitude: 2 }
      }))
    };
    const { service } = build({
      maps,
      rows: [
        row({
          name: "Different Cache Name",
          businessStatus: "CLOSED_PERMANENTLY",
          businessStatusCheckedAt: new Date(NOW.getTime() - DAY_MS)
        })
      ]
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Bayview Harbour" }));
  });

  it("still blocks a raw provider closure when persistence fails", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-x",
        name: "Closed Place",
        location: { latitude: 5, longitude: 6 },
        businessStatus: "CLOSED_PERMANENTLY" as const,
        businessStatusCheckedAt: NOW
      }))
    };
    const { service, repository } = build({ maps });
    repository.saveProviderCandidate = (async () => {
      throw new Error("database unavailable");
    }) as any;
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Closed Place" }));
  });
});

describe("consider", () => {
  it("persists the observation, evaluates, and preserves every caller field", async () => {
    const { service, repository } = build();
    const session = await service.createSession("agency-1");

    const { candidate, verdict } = await session.consider({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-9",
      name: "Cafe Nine",
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: NOW,
      address: "9 Ninth St",
      rating: 4.5,
      types: ["cafe"]
    } as any);

    expect(verdict.allowed).toBe(true);
    expect(candidate).toMatchObject({ address: "9 Ninth St", rating: 4.5, types: ["cafe"] });
    expect(repository.store.find((entry) => entry.providerPlaceId === "g-9")?.businessStatus).toBe(
      "OPERATIONAL"
    );
  });

  it("merges a newer stored closure when this response omits status", async () => {
    const { service } = build({
      rows: [
        row({
          providerPlaceId: "g-9",
          businessStatus: "CLOSED_PERMANENTLY",
          businessStatusCheckedAt: NOW
        })
      ]
    });
    const session = await service.createSession("agency-1");

    const { verdict } = await session.consider({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-9",
      name: "Cafe Nine"
    } as any);

    expect(verdict).toMatchObject({ allowed: false, reason: "CLOSED_PERMANENTLY" });
  });

  it("records block explanations for later turns", async () => {
    const { service } = build({ notes: [note({ placeName: "Cafe Nine", status: "AVOID" })] });
    const session = await service.createSession("agency-1");

    await session.consider({ provider: "GOOGLE_MAPS", providerPlaceId: "g-9", name: "Cafe Nine" } as any);

    expect(session.explanations()).toEqual([
      expect.objectContaining({ name: "Cafe Nine", reason: "AGENCY_AVOID" })
    ]);
  });

  it("does not discard the observation of a blocked candidate", async () => {
    const { service, repository } = build();
    const session = await service.createSession("agency-1");

    await session.consider({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-dead",
      name: "Dead Place",
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: NOW
    } as any);

    expect(repository.store.find((entry) => entry.providerPlaceId === "g-dead")?.businessStatus).toBe(
      "CLOSED_PERMANENTLY"
    );
  });
});

describe("session scoping and memoization", () => {
  it("loads the gate once per session and reports notes availability", async () => {
    const createGate = vi.fn(async () => buildPlaceGate([], false));
    const repository = fakeRepository();
    const service = createPlaceSelectionService({
      repository: repository as any,
      maps: null,
      scheduler: fakeScheduler(),
      createGate,
      ttlMs: 30 * DAY_MS,
      now: () => NOW,
      runBudget: { remaining: 20 }
    });

    const session = await service.createSession("agency-1");
    await session.prepare({ placeName: "A" });
    await session.prepare({ placeName: "B" });

    expect(createGate).toHaveBeenCalledTimes(1);
    expect(createGate).toHaveBeenCalledWith("agency-1");
    expect(session.notesUnavailable).toBe(true);
    expect(session.agencyId).toBe("agency-1");
  });

  it("keeps two sessions isolated so agencies never share notes", async () => {
    const repository = fakeRepository();
    const service = createPlaceSelectionService({
      repository: repository as any,
      maps: null,
      scheduler: fakeScheduler(),
      createGate: async (agencyId: string | null) =>
        buildPlaceGate(agencyId === "agency-1" ? [note({ status: "CLOSED" })] : []),
      ttlMs: 30 * DAY_MS,
      now: () => NOW,
      runBudget: { remaining: 20 }
    });

    const first = await service.createSession("agency-1");
    const second = await service.createSession("agency-2");

    await expectBlocked(first.prepare({ placeName: "Bayview" }));
    await expect(second.prepare({ placeName: "Bayview" })).resolves.toBeTruthy();
  });

  it("memoizes the provider lookup, not the allowed verdict", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-shared",
        name: "Shared",
        location: { latitude: 1, longitude: 2 }
      }))
    };
    const { service, repository } = build({ maps });
    const session = await service.createSession("agency-1");

    const first = await session.prepare({ placeName: "Shared", cityContext: "Cebu" });
    expect(first.placeSnapshotId).toBeTruthy();
    expect(maps.resolvePlace).toHaveBeenCalledTimes(1);

    // Another tool in the same run learns the place is closed.
    await repository.observeStatus("GOOGLE_MAPS", "g-shared", {
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: NOW
    });

    // The second attachment must re-merge stored status rather than reuse the
    // earlier "allowed" decision.
    await expectBlocked(session.prepare({ placeName: "Shared", cityContext: "Cebu" }));
    expect(maps.resolvePlace).toHaveBeenCalledTimes(1);
  });

  it("evaluates without I/O and never queries notes for a null agency", async () => {
    const createGate = vi.fn(async (agencyId: string | null) => buildPlaceGate([], agencyId === null));
    const repository = fakeRepository();
    const service = createPlaceSelectionService({
      repository: repository as any,
      maps: null,
      scheduler: fakeScheduler(),
      createGate,
      ttlMs: 30 * DAY_MS,
      now: () => NOW,
      runBudget: { remaining: 20 }
    });

    const session = await service.createSession(null);

    expect(session.agencyId).toBeNull();
    expect(session.evaluate({ name: "Anything", businessStatus: "CLOSED_PERMANENTLY" })).toMatchObject({
      allowed: false,
      reason: "CLOSED_PERMANENTLY"
    });
    expect(session.evaluate({ name: "Anything" }).allowed).toBe(true);
  });
});

describe("city context versus search fallback", () => {
  it("uses a fallback for the provider search but not for city-specific notes", async () => {
    const maps = {
      resolvePlace: vi.fn(async () => ({
        provider: "GOOGLE_MAPS" as const,
        providerPlaceId: "g-fallback",
        name: "Bayview",
        location: { latitude: 1, longitude: 2 }
      }))
    };
    const { service } = build({
      maps,
      // A note that only applies in Cebu.
      notes: [note({ status: "CLOSED", placeName: "Bayview", cityContext: "Cebu" })]
    });
    const session = await service.createSession("agency-1");

    // The itinerary title is a search hint, not an established city, so the
    // Cebu-specific note must not match.
    const prepared = await session.prepare({ placeName: "Bayview" }, "Cebu Highlights Tour");

    expect(prepared.placeSnapshotId).toBeTruthy();
    expect(maps.resolvePlace).toHaveBeenCalledWith({
      placeName: "Bayview",
      cityContext: "Cebu Highlights Tour"
    });
  });

  it("still blocks when the caller explicitly established the city", async () => {
    const { service } = build({
      notes: [note({ status: "CLOSED", placeName: "Bayview", cityContext: "Cebu" })]
    });
    const session = await service.createSession("agency-1");

    await expectBlocked(session.prepare({ placeName: "Bayview", cityContext: "Cebu" }, "Somewhere Else"));
  });
});
