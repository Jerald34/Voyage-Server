import { describe, expect, it, vi } from "vitest";
import { createPlaceSnapshotRepository } from "../src/services/places/placeSnapshotRepository";
import type { ResolvedPlace } from "../src/services/maps";

type Row = {
  id: string;
  provider: string;
  providerPlaceId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  businessStatus: string | null;
  businessStatusCheckedAt: Date | null;
  fetchedAt: Date;
  metadata?: unknown;
};

/**
 * In-memory PlaceSnapshot table that honours the conditional-update semantics
 * the real Prisma `updateMany` gives us, so out-of-order observations can be
 * tested without a database.
 */
function fakeClient(initial: Row[] = []) {
  const rows = [...initial];
  const calls = { upsert: 0, updateMany: 0, create: 0, findFirst: 0 };

  const find = (provider: string, providerPlaceId: string) =>
    rows.find((row) => row.provider === provider && row.providerPlaceId === providerPlaceId);

  return {
    calls,
    rows,
    placeSnapshot: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        calls.upsert += 1;
        const key = where.provider_providerPlaceId;
        const existing = find(key.provider, key.providerPlaceId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: Row = {
          id: `snap-${rows.length + 1}`,
          businessStatus: null,
          businessStatusCheckedAt: null,
          ...create
        };
        rows.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        calls.updateMany += 1;
        const existing = find(where.provider, where.providerPlaceId);
        if (!existing) return { count: 0 };

        const conditions = where.OR as Array<Record<string, any>> | undefined;
        const passes = !conditions
          ? true
          : conditions.some((condition) => {
              if ("businessStatusCheckedAt" in condition) {
                const value = condition.businessStatusCheckedAt;
                if (value === null) return existing.businessStatusCheckedAt === null;
                if (value?.lt) {
                  return (
                    existing.businessStatusCheckedAt !== null &&
                    existing.businessStatusCheckedAt.getTime() < value.lt.getTime()
                  );
                }
              }
              return false;
            });

        if (!passes) return { count: 0 };
        Object.assign(existing, data);
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        calls.findFirst += 1;
        if (where?.provider && where?.providerPlaceId) {
          return find(where.provider, where.providerPlaceId) ?? null;
        }
        return rows[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.provider_providerPlaceId;
        if (key) return find(key.provider, key.providerPlaceId) ?? null;
        return rows.find((row) => row.id === where.id) ?? null;
      })
    }
  } as any;
}

function resolved(overrides: Partial<ResolvedPlace> = {}): ResolvedPlace {
  return {
    provider: "GOOGLE_MAPS",
    providerPlaceId: "g-1",
    name: "Bayview",
    location: { latitude: 1, longitude: 2 },
    ...overrides
  } as ResolvedPlace;
}

describe("general snapshot writes", () => {
  it("does not advance the status clock", async () => {
    const checkedAt = new Date("2026-08-01T00:00:00.000Z");
    const client = fakeClient([
      {
        id: "snap-1",
        provider: "GOOGLE_MAPS",
        providerPlaceId: "g-1",
        name: "Bayview",
        latitude: 1,
        longitude: 2,
        businessStatus: "CLOSED_PERMANENTLY",
        businessStatusCheckedAt: checkedAt,
        fetchedAt: new Date("2026-08-01T00:00:00.000Z")
      }
    ]);
    const repository = createPlaceSnapshotRepository(client);

    await repository.upsertPlaceSnapshot(resolved({ name: "Bayview Renamed" }));

    const row = client.rows[0];
    expect(row.name).toBe("Bayview Renamed");
    expect(row.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(row.businessStatusCheckedAt).toBe(checkedAt);
    expect(row.fetchedAt.getTime()).toBeGreaterThan(checkedAt.getTime());
  });

  it("never writes status fields from a general upsert even if the object carries one", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);

    await repository.upsertPlaceSnapshot(
      resolved({ businessStatus: "OPERATIONAL", businessStatusCheckedAt: new Date() } as any)
    );

    const [{ create }] = client.placeSnapshot.upsert.mock.calls.map((call: any[]) => call[0]);
    expect(create).not.toHaveProperty("businessStatus");
    expect(create).not.toHaveProperty("businessStatusCheckedAt");
    expect(client.rows[0].businessStatus).toBeNull();
  });

  it("preserves NOMINATIM as the stored provider", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);

    await repository.upsertPlaceSnapshot(resolved({ provider: "NOMINATIM", providerPlaceId: "osm-1" }));

    expect(client.rows[0].provider).toBe("NOMINATIM");
  });
});

describe("observeStatus", () => {
  const early = new Date("2026-09-01T00:00:00.000Z");
  const late = new Date("2026-09-05T00:00:00.000Z");

  function seeded(status: string | null, checkedAt: Date | null) {
    return fakeClient([
      {
        id: "snap-1",
        provider: "GOOGLE_MAPS",
        providerPlaceId: "g-1",
        name: "Bayview",
        latitude: 1,
        longitude: 2,
        businessStatus: status,
        businessStatusCheckedAt: checkedAt,
        fetchedAt: early
      }
    ]);
  }

  it("records a first observation on a pre-migration null row", async () => {
    const client = seeded(null, null);
    const repository = createPlaceSnapshotRepository(client);

    const row = await repository.observeStatus("GOOGLE_MAPS", "g-1", {
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: late
    });

    expect(client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(client.rows[0].businessStatusCheckedAt).toBe(late);
    expect(row?.businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("lets an explicit newer operational observation reopen a closure", async () => {
    const client = seeded("CLOSED_PERMANENTLY", early);
    const repository = createPlaceSnapshotRepository(client);

    await repository.observeStatus("GOOGLE_MAPS", "g-1", {
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: late
    });

    expect(client.rows[0].businessStatus).toBe("OPERATIONAL");
    expect(client.rows[0].businessStatusCheckedAt).toBe(late);
  });

  it("refuses an older response that would overwrite a newer observation", async () => {
    const client = seeded("CLOSED_PERMANENTLY", late);
    const repository = createPlaceSnapshotRepository(client);

    await repository.observeStatus("GOOGLE_MAPS", "g-1", {
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: early
    });

    expect(client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(client.rows[0].businessStatusCheckedAt).toBe(late);
  });

  it("does not replace the stored observation on an exact time tie", async () => {
    const client = seeded("CLOSED_PERMANENTLY", late);
    const repository = createPlaceSnapshotRepository(client);

    await repository.observeStatus("GOOGLE_MAPS", "g-1", {
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: new Date(late.getTime())
    });

    expect(client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("resolves concurrent out-of-order observations to the newest one", async () => {
    const client = seeded(null, null);
    const repository = createPlaceSnapshotRepository(client);

    await Promise.all([
      repository.observeStatus("GOOGLE_MAPS", "g-1", {
        businessStatus: "OPERATIONAL",
        businessStatusCheckedAt: late
      }),
      repository.observeStatus("GOOGLE_MAPS", "g-1", {
        businessStatus: "CLOSED_PERMANENTLY",
        businessStatusCheckedAt: early
      })
    ]);

    expect(client.rows[0].businessStatus).toBe("OPERATIONAL");
    expect(client.rows[0].businessStatusCheckedAt).toBe(late);
  });

  it("returns the persisted row so callers decide on stored status, not their own response", async () => {
    const client = seeded("CLOSED_PERMANENTLY", late);
    const repository = createPlaceSnapshotRepository(client);

    const row = await repository.observeStatus("GOOGLE_MAPS", "g-1", {
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: early
    });

    expect(row?.businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("does not create a row for a status-only observation on an unknown place", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);

    const row = await repository.observeStatus("GOOGLE_MAPS", "missing", {
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: late
    });

    expect(row).toBeNull();
    expect(client.rows).toHaveLength(0);
    expect(client.placeSnapshot.upsert).not.toHaveBeenCalled();
  });
});

describe("provider candidates without coordinates", () => {
  it("creates a snapshot from a search observation with null coordinates", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);
    const checkedAt = new Date("2026-09-05T00:00:00.000Z");

    const row = await repository.saveProviderCandidate({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-2",
      name: "No Coordinates Cafe",
      observation: { businessStatus: "CLOSED_PERMANENTLY", businessStatusCheckedAt: checkedAt }
    });

    expect(row?.latitude ?? null).toBeNull();
    expect(row?.longitude ?? null).toBeNull();
    expect(client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(client.rows[0].businessStatusCheckedAt).toBe(checkedAt);
  });

  it("persists a blocked candidate's closure observation even though selection rejects it", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);
    const checkedAt = new Date("2026-09-05T00:00:00.000Z");

    await repository.saveProviderCandidate({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-blocked",
      name: "Closed Diner",
      location: { latitude: 3, longitude: 4 },
      observation: { businessStatus: "CLOSED_PERMANENTLY", businessStatusCheckedAt: checkedAt }
    });

    expect(client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");
  });

  it("writes no status when the provider response carried none", async () => {
    const client = fakeClient();
    const repository = createPlaceSnapshotRepository(client);

    await repository.saveProviderCandidate({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-3",
      name: "Unknown Status Cafe"
    });

    expect(client.rows[0].businessStatus).toBeNull();
    expect(client.rows[0].businessStatusCheckedAt).toBeNull();
  });
});

describe("enrichment status propagation", () => {
  const requestStart = new Date("2026-09-05T00:00:00.000Z");

  function mapsWithDetails(details: any) {
    return {
      getPlaceDetails: vi.fn(async () => details)
    } as any;
  }

  it("carries a recognized details observation with its original request time", async () => {
    const { enrichResolvedPlaceForSnapshot } = await import(
      "../src/modules/agent/tools/placeSnapshotEnrichment"
    );
    const maps = mapsWithDetails({
      id: "g-1",
      name: "Bayview",
      types: [],
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: requestStart
    });

    const enriched = await enrichResolvedPlaceForSnapshot(maps, resolved());

    expect(enriched.businessStatus).toBe("OPERATIONAL");
    expect(enriched.businessStatusCheckedAt).toBe(requestStart);
  });

  it("retains a known closure when the details response omits status", async () => {
    const { enrichResolvedPlaceForSnapshot } = await import(
      "../src/modules/agent/tools/placeSnapshotEnrichment"
    );
    const maps = mapsWithDetails({ id: "g-1", name: "Bayview", types: [] });
    const known = resolved({
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: requestStart
    } as any);

    const enriched = await enrichResolvedPlaceForSnapshot(maps, known);

    expect(enriched.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(enriched.businessStatusCheckedAt).toBe(requestStart);
  });

  it("retains status and time when the details call fails", async () => {
    const { enrichResolvedPlaceForSnapshot } = await import(
      "../src/modules/agent/tools/placeSnapshotEnrichment"
    );
    const maps = {
      getPlaceDetails: vi.fn(async () => {
        throw new Error("provider unavailable");
      })
    } as any;
    const known = resolved({
      businessStatus: "CLOSED_PERMANENTLY",
      businessStatusCheckedAt: requestStart
    } as any);

    const enriched = await enrichResolvedPlaceForSnapshot(maps, known);

    expect(enriched.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(enriched.businessStatusCheckedAt).toBe(requestStart);
  });

  it("does not treat a skipped enrichment as a status check", async () => {
    const { enrichResolvedPlaceForSnapshot } = await import(
      "../src/modules/agent/tools/placeSnapshotEnrichment"
    );
    const maps = mapsWithDetails({ id: "g-1", name: "Bayview", types: [] });

    const enriched = await enrichResolvedPlaceForSnapshot(null, resolved());

    expect(enriched.businessStatus).toBeUndefined();
    expect(enriched.businessStatusCheckedAt).toBeUndefined();
    expect(maps.getPlaceDetails).not.toHaveBeenCalled();
  });
});
