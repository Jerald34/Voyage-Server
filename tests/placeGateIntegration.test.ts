import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import { buildPlaceGate } from "../src/services/places/placeGate";
import { createPlaceRefreshScheduler } from "../src/services/places/placeRefreshScheduler";
import { createPlaceSelectionService } from "../src/services/places/placeSelectionService";
import { createPlaceSnapshotRepository } from "../src/services/places/placeSnapshotRepository";
import { createItineraryService } from "../src/modules/itineraries/itineraryService";
import { overlayPlaceAdvisories } from "../src/modules/itineraries/savedPlaceAdvisories";
import type { PlaceNote } from "../src/services/places/placeTypes";

/**
 * One end-to-end scenario across every boundary this feature touches, with fake
 * providers only — no database, no paid Google call.
 *
 * An old saved stop stays visible; revalidation stores a closure; the next
 * authorized read warns about it; a new attachment by that snapshot ID fails;
 * an unrelated title edit still succeeds; the public projection carries only the
 * provider's status.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SAVED_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SAVED_ITEM_ID = "44444444-4444-4444-8444-444444444444";
const ITINERARY_ID = "11111111-1111-4111-8111-111111111111";

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
  metadata?: unknown;
};

/** Minimal in-memory PlaceSnapshot table with real conditional-update semantics. */
function memoryClient(rows: Row[]) {
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
        const row = { id: `snap-${rows.length + 1}`, businessStatus: null, businessStatusCheckedAt: null, ...create };
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

function buildWorld(
  options: { notes?: PlaceNote[]; closureAt?: Date; providerStatus?: "OPERATIONAL" | "CLOSED_PERMANENTLY" } = {}
) {
  const now = new Date("2026-09-06T12:00:00.000Z");
  // A saved stop last verified long ago: eligible for a status refresh.
  const saved: Row = {
    id: SAVED_SNAPSHOT_ID,
    provider: "GOOGLE_MAPS",
    providerPlaceId: "g-bayview",
    name: "Bayview",
    latitude: 10,
    longitude: 20,
    businessStatus: "OPERATIONAL",
    businessStatusCheckedAt: new Date(now.getTime() - 200 * DAY_MS),
    fetchedAt: new Date(now.getTime() - 200 * DAY_MS)
  };

  const client = memoryClient([saved]);
  const repository = createPlaceSnapshotRepository(client);

  const getPlaceStatus = vi.fn(async () => ({
    businessStatus: options.providerStatus ?? ("CLOSED_PERMANENTLY" as const),
    businessStatusCheckedAt: options.closureAt ?? now
  }));

  const scheduler = createPlaceRefreshScheduler({
    now: () => now,
    ttlMs: 30 * DAY_MS,
    concurrency: 3,
    perRead: 10,
    perHour: 120,
    cooldownMs: 300_000,
    getPlaceStatus,
    observeStatus: (provider, providerPlaceId, observation) =>
      repository.observeStatus(provider, providerPlaceId, observation)
  });

  const selection = createPlaceSelectionService({
    repository,
    maps: null,
    scheduler,
    createGate: async () => buildPlaceGate(options.notes ?? []),
    ttlMs: 30 * DAY_MS,
    now: () => now,
    runBudget: { remaining: 20 }
  });

  return { client, repository, scheduler, selection, saved, getPlaceStatus, now };
}

/** A stored itinerary that already references the saved stop. */
function storedItinerary(saved: Row) {
  return {
    id: "itin-1",
    status: "DRAFT",
    version: 1,
    days: [
      {
        id: "day-1",
        items: [
          { id: SAVED_ITEM_ID, title: "Lunch at Bayview", placeSnapshotId: saved.id, placeSnapshot: saved }
        ]
      }
    ]
  };
}

describe("place freshness gate — cross-boundary scenario", () => {
  it("keeps a saved stop, learns the closure, warns, then blocks re-attachment", async () => {
    const world = buildWorld();
    const stored = storedItinerary(world.saved);

    const repositoryFake = {
      findItineraryByAgency: vi.fn(async () => stored),
      updateItem: vi.fn(async (_id: string, _agency: string, _item: string, patch: unknown) => ({
        itinerary: stored,
        item: patch
      })),
      addItem: vi.fn(async () => ({ itinerary: stored, dayId: "day-1", item: {} }))
    } as any;
    const itineraries = createItineraryService({ repository: repositoryFake });

    // 1. The stop is visible today, with no warning: its status is still OPERATIONAL.
    let session = await world.selection.createSession("agency-1");
    const firstRead = overlayPlaceAdvisories(stored as any, session.gate);
    expect(firstRead.days[0].items[0].placeAdvisory).toBeUndefined();
    expect(firstRead.days[0].items).toHaveLength(1);

    // 2. A background revalidation learns the place is permanently closed.
    world.scheduler.scheduleRead([
      {
        id: world.saved.id,
        provider: world.saved.provider,
        providerPlaceId: world.saved.providerPlaceId,
        businessStatusCheckedAt: world.saved.businessStatusCheckedAt
      }
    ]);
    await world.scheduler.drain();
    expect(world.getPlaceStatus).toHaveBeenCalledTimes(1);
    expect(world.client.rows[0].businessStatus).toBe("CLOSED_PERMANENTLY");

    // 3. The next authorized read still shows the stop, now with a warning.
    session = await world.selection.createSession("agency-1");
    const secondRead = overlayPlaceAdvisories(stored as any, session.gate);
    expect(secondRead.days[0].items).toHaveLength(1);
    expect(secondRead.days[0].items[0].placeAdvisory).toEqual({
      reason: "CLOSED_PERMANENTLY",
      label: "Permanently closed"
    });

    // 4. Attaching that same place as a NEW stop fails, and writes nothing.
    const error = await itineraries
      .addItem(
        "agency-1",
        {
          itineraryId: "11111111-1111-4111-8111-111111111111",
          dayId: "22222222-2222-4222-8222-222222222222",
          item: { type: "ACTIVITY", title: "Dinner at Bayview", placeSnapshotId: world.saved.id }
        } as never,
        { session }
      )
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(repositoryFake.addItem).not.toHaveBeenCalled();

    // 5. An unrelated title edit on the existing closed stop still succeeds.
    await itineraries.updateItem(
      "agency-1",
      {
        itineraryId: ITINERARY_ID,
        itemId: SAVED_ITEM_ID,
        item: { title: "Lunch (confirm alternative)" }
      } as never,
      { session }
    );
    expect(repositoryFake.updateItem).toHaveBeenCalledTimes(1);
  });

  it("blocks an agency-noted place even with no provider closure and no maps", async () => {
    const world = buildWorld({
      notes: [
        {
          provider: null,
          providerPlaceId: null,
          placeName: "Bayview",
          cityContext: null,
          status: "AVOID",
          note: "Repeated complaints"
        }
      ]
    });
    const session = await world.selection.createSession("agency-1");

    await expect(session.prepare({ placeName: "Bayview" })).rejects.toMatchObject({
      code: "PLACE_BLOCKED"
    });
    // The block is the agency's own, not the provider's.
    expect(session.explanations()[0].reason).toBe("AGENCY_AVOID");
  });

  it("keeps agency verdicts out of the shared snapshot", async () => {
    // The provider keeps saying the place is open; only the agency says otherwise.
    const world = buildWorld({
      providerStatus: "OPERATIONAL",
      notes: [
        {
          provider: "GOOGLE_MAPS",
          providerPlaceId: "g-bayview",
          placeName: "Bayview",
          cityContext: null,
          status: "CLOSED",
          note: null
        }
      ]
    });
    const session = await world.selection.createSession("agency-1");

    await session.prepare({ placeSnapshotId: SAVED_SNAPSHOT_ID }).catch(() => undefined);

    // The agency said "closed"; the provider never did. The global row must not
    // have been rewritten by one agency's opinion.
    expect(world.client.rows[0].businessStatus).toBe("OPERATIONAL");
  });

  it("does not schedule provider work for a read with nothing eligible", async () => {
    const world = buildWorld();
    // A Nominatim row has no Google status to fetch.
    world.scheduler.scheduleRead([
      {
        id: "snap-osm",
        provider: "NOMINATIM",
        providerPlaceId: "osm-1",
        businessStatusCheckedAt: null
      }
    ]);
    await world.scheduler.drain();

    expect(world.getPlaceStatus).not.toHaveBeenCalled();
  });
});
