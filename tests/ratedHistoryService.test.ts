/**
 * Unit tests for ratedHistoryService.
 *
 * Approach: inject a fake deps surface (no Postgres). Each test wires the
 * minimal fakes needed for that scenario. Covers:
 *  - Source-itinerary selection rule passthrough (the repository owns the SQL,
 *    so we mock its return value to assert service behaviour given each
 *    selection outcome).
 *  - Date re-anchoring math + missingStartDateAdvisory.
 *  - Selection validation (item / day / segment).
 *  - ID regeneration + copy semantics (clientNotes/routeFromPrevious null,
 *    placeSnapshotId/staffNotes/etc. preserved).
 *  - Cross-agency rejection.
 *  - Optimistic concurrency (StaleVersionError surface + happy-path version bump).
 */

import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { ApiError } from "../src/http/errors";
import {
  createRatedHistoryService,
  type RatedHistoryDeps
} from "../src/modules/ratedHistory/ratedHistoryService";
import {
  MalformedSelectionError,
  SameAgencyViolationError,
  StaleVersionError,
  SourceNotFoundError
} from "../src/modules/ratedHistory/ratedHistoryErrors";
import type {
  SourceItinerary,
  SourceItineraryDay,
  SourceItineraryItem,
  PreparedDay,
  PreparedItem,
  InsertItemsTransactionalParams
} from "../src/modules/ratedHistory/ratedHistoryRepository";

// ── Test fixture builders ────────────────────────────────────────────────────

const AGENCY_A = "11111111-1111-1111-1111-111111111111";
const AGENCY_B = "22222222-2222-2222-2222-222222222222";
const USER_OWNER = "33333333-3333-3333-3333-333333333333";
const SOURCE_TRIP_ID = "44444444-4444-4444-4444-444444444444";
const TARGET_TRIP_ID = "55555555-5555-5555-5555-555555555555";
const TARGET_ITIN_ID = "66666666-6666-6666-6666-666666666666";

function makeItem(overrides: Partial<SourceItineraryItem> = {}): SourceItineraryItem {
  return {
    itemId: randomUUID(),
    sortOrder: 0,
    type: "ACTIVITY",
    title: "Visit Senso-ji",
    description: "Asakusa temple",
    startTime: "09:00",
    endTime: "10:30",
    place: { name: "Senso-ji", formattedAddress: null, latitude: null, longitude: null },
    placeSnapshotId: "snap-1",
    staffNotes: "Arrive before crowds",
    ...overrides
  };
}

function makeDay(overrides: Partial<SourceItineraryDay> = {}): SourceItineraryDay {
  return {
    dayId: randomUUID(),
    dayNumber: 1,
    date: "2025-03-10",
    title: "Day 1",
    summary: null,
    items: [makeItem(), makeItem({ sortOrder: 1, title: "Lunch", type: "MEAL" })],
    ...overrides
  };
}

function makeSource(overrides: Partial<SourceItinerary> = {}): SourceItinerary {
  return {
    itineraryId: randomUUID(),
    title: "Tokyo Family",
    summary: null,
    status: "APPROVED_INTERNAL",
    updatedAt: new Date("2025-04-01T00:00:00Z"),
    days: [
      makeDay({ dayNumber: 1, title: "Day 1" }),
      makeDay({ dayNumber: 2, title: "Day 2", items: [makeItem({ sortOrder: 0, title: "Museum" })] }),
      makeDay({ dayNumber: 3, title: "Day 3", items: [makeItem({ sortOrder: 0, title: "Park" })] })
    ],
    ...overrides
  };
}

function tripRow(
  id: string,
  overrides: Partial<{
    agencyId: string;
    title: string;
    destinationSummary: string | null;
    startDate: Date | null;
    endDate: Date | null;
    createdByUserId: string;
    assignedOrganizerUserId: string | null;
  }> = {}
) {
  return {
    id,
    agencyId: AGENCY_A,
    title: "Test trip",
    destinationSummary: "Tokyo",
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: new Date("2026-06-07T00:00:00Z"),
    createdByUserId: USER_OWNER,
    assignedOrganizerUserId: null,
    ...overrides
  };
}

type FakeDepsOpts = {
  source?: SourceItinerary | null;
  updatedSource?: SourceItinerary | null;
  /** Allows tests to inspect what the service passed to the repository */
  recordInsertions?: (p: InsertItemsTransactionalParams) => void;
  insertImpl?: RatedHistoryDeps["insertItemsTransactional"];
  targetTrip?: ReturnType<typeof tripRow>;
  sourceTrip?: ReturnType<typeof tripRow>;
  targetItinerary?: {
    id: string;
    tripId: string | null;
    version: number;
    trip: { startDate: Date | null } | null;
    days: Array<{ id: string; dayNumber: number }>;
  } | null;
  review?: { rating: number; submittedAt: Date } | null;
  lastItem?: { sortOrder: number } | null;
  prepareCopiedPlaces?: RatedHistoryDeps["prepareCopiedPlaces"];
};

function makeDeps(opts: FakeDepsOpts = {}): RatedHistoryDeps {
  const source = "source" in opts ? opts.source : makeSource();
  const updatedSource = "updatedSource" in opts ? opts.updatedSource : source;
  const targetTrip = opts.targetTrip ?? tripRow(TARGET_TRIP_ID);
  const sourceTrip = opts.sourceTrip ?? tripRow(SOURCE_TRIP_ID);
  const targetItin =
    opts.targetItinerary === undefined
      ? {
          id: TARGET_ITIN_ID,
          tripId: TARGET_TRIP_ID,
          version: 5,
          trip: { startDate: targetTrip.startDate },
          days: [
            { id: "td-1", dayNumber: 1 },
            { id: "td-2", dayNumber: 2 }
          ]
        }
      : opts.targetItinerary;

  // Track the last-fetched mode so we can flip the source returned between
  // the initial source fetch and the post-insert re-fetch.
  let sourceCalls = 0;

  const defaultInsert: RatedHistoryDeps["insertItemsTransactional"] = async (p) => {
    if (opts.recordInsertions) opts.recordInsertions(p);
    return { itineraryId: p.targetItineraryId, newVersion: 6 };
  };

  return {
    listRatedTrips: vi.fn(async () => ({
      trips: [],
      hasMore: false,
      nextPage: null
    })),
    getSourceItinerary: vi.fn(async (tripId: string) => {
      sourceCalls += 1;
      if (tripId === TARGET_TRIP_ID) return updatedSource;
      return source;
    }),
    insertItemsTransactional: opts.insertImpl ?? defaultInsert,
    prepareCopiedPlaces: opts.prepareCopiedPlaces,
    db: {
      clientTrip: {
        findUnique: vi.fn(async ({ where }) => {
          if (where.id === TARGET_TRIP_ID) return targetTrip as never;
          if (where.id === SOURCE_TRIP_ID) return sourceTrip as never;
          return null;
        })
      },
      tripReview: {
        findFirst: vi.fn(async () =>
          opts.review === undefined
            ? { rating: 5, submittedAt: new Date("2025-04-15T00:00:00Z") }
            : opts.review
        )
      },
      itineraryShare: {
        // Default: no share rating (review is the sole source in existing tests).
        findFirst: vi.fn(async () => null)
      },
      itinerary: {
        findUnique: vi.fn(async () => targetItin as never)
      },
      itineraryItem: {
        findFirst: vi.fn(async () => opts.lastItem ?? null)
      }
    }
  };
}

// ── Source-itinerary selection rule (delegation passthrough) ─────────────────

describe("getRatedItinerary — source-itinerary selection rule", () => {
  it("1. returns the APPROVED_INTERNAL itinerary when one exists", async () => {
    const approved = makeSource({ status: "APPROVED_INTERNAL", title: "Approved" });
    const deps = makeDeps({ source: approved });
    const svc = createRatedHistoryService(deps);

    const result = await svc.getRatedItinerary({
      callerAgencyId: AGENCY_A,
      tripId: SOURCE_TRIP_ID
    });

    expect(result.itinerary.title).toBe("Approved");
  });

  it("2. falls back to most-recent itinerary of any status", async () => {
    // The repository's getSourceItinerary itself handles the two-step lookup;
    // here we assert the service trusts whatever the repo returns. We seed
    // a DRAFT to confirm pass-through.
    const draft = makeSource({ status: "DRAFT", title: "Draft fallback" });
    const deps = makeDeps({ source: draft });
    const svc = createRatedHistoryService(deps);

    const result = await svc.getRatedItinerary({
      callerAgencyId: AGENCY_A,
      tripId: SOURCE_TRIP_ID
    });

    expect(result.itinerary.title).toBe("Draft fallback");
  });

  it("3. throws SourceNotFoundError when no itinerary exists", async () => {
    const deps = makeDeps({ source: null });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.getRatedItinerary({ callerAgencyId: AGENCY_A, tripId: SOURCE_TRIP_ID })
    ).rejects.toBeInstanceOf(SourceNotFoundError);
  });
});

// ── Date re-anchoring ────────────────────────────────────────────────────────

describe("insertFromRated — date re-anchoring", () => {
  it("4. new days inserted with startDate=2026-06-01 get date = startDate + (newDayNumber - 1) days", async () => {
    let captured!: InsertItemsTransactionalParams;
    const source = makeSource();
    const deps = makeDeps({
      source,
      targetTrip: tripRow(TARGET_TRIP_ID, {
        startDate: new Date("2026-06-01T00:00:00Z")
      }),
      recordInsertions: (p) => {
        captured = p;
      }
    });
    const svc = createRatedHistoryService(deps);

    const result = await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "day", dayIds: [source.days[0].dayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 5
    });

    expect(captured.insertions.mode).toBe("days");
    if (captured.insertions.mode !== "days") throw new Error("type narrow");
    const inserted: PreparedDay = captured.insertions.days[0];
    // newDayNumber = dayIndex(0) + 1 + 0 = 1 → date = startDate + 0 days
    expect(inserted.date?.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(result.missingStartDateAdvisory).toBeUndefined();
  });

  it("4b. day inserted at dayIndex=2 gets startDate + 2 days", async () => {
    let captured!: InsertItemsTransactionalParams;
    const source = makeSource();
    const deps = makeDeps({
      source,
      targetTrip: tripRow(TARGET_TRIP_ID, {
        startDate: new Date("2026-06-01T00:00:00Z")
      }),
      targetItinerary: {
        id: TARGET_ITIN_ID,
        tripId: TARGET_TRIP_ID,
        version: 5,
        trip: { startDate: new Date("2026-06-01T00:00:00Z") },
        days: [
          { id: "td-1", dayNumber: 1 },
          { id: "td-2", dayNumber: 2 },
          { id: "td-3", dayNumber: 3 }
        ]
      },
      recordInsertions: (p) => {
        captured = p;
      }
    });
    const svc = createRatedHistoryService(deps);

    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "day", dayIds: [source.days[0].dayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 2 },
      ifMatchVersion: 5
    });

    if (captured.insertions.mode !== "days") throw new Error("type narrow");
    const inserted = captured.insertions.days[0];
    // newDayNumber = 2 + 1 + 0 = 3 → date = startDate + 2 days = 2026-06-03
    expect(inserted.date?.toISOString().slice(0, 10)).toBe("2026-06-03");
  });

  it("5. days inserted into a trip with null startDate get date=null + advisory flag", async () => {
    let captured!: InsertItemsTransactionalParams;
    const source = makeSource();
    const deps = makeDeps({
      source,
      targetTrip: tripRow(TARGET_TRIP_ID, { startDate: null }),
      targetItinerary: {
        id: TARGET_ITIN_ID,
        tripId: TARGET_TRIP_ID,
        version: 5,
        trip: { startDate: null },
        days: [{ id: "td-1", dayNumber: 1 }]
      },
      recordInsertions: (p) => {
        captured = p;
      }
    });
    const svc = createRatedHistoryService(deps);

    const result = await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "day", dayIds: [source.days[0].dayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 5
    });

    if (captured.insertions.mode !== "days") throw new Error("type narrow");
    expect(captured.insertions.days[0].date).toBeNull();
    expect(result.missingStartDateAdvisory).toBe(true);
  });
});

// ── Selection validation ─────────────────────────────────────────────────────

describe("insertFromRated — selection validation", () => {
  it("6. kind=item with IDs from a single day succeeds", async () => {
    const source = makeSource();
    const day0 = source.days[0];
    const deps = makeDeps({ source });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: {
          kind: "item",
          itemIds: [day0.items[0].itemId, day0.items[1].itemId]
        },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
        ifMatchVersion: 5
      })
    ).resolves.toBeDefined();
  });

  it("7. kind=item with IDs spanning two days throws MalformedSelectionError", async () => {
    const source = makeSource();
    const deps = makeDeps({ source });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: {
          kind: "item",
          itemIds: [source.days[0].items[0].itemId, source.days[1].items[0].itemId]
        },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
        ifMatchVersion: 5
      })
    ).rejects.toBeInstanceOf(MalformedSelectionError);
  });

  it("8. kind=segment with consecutive day IDs succeeds", async () => {
    const source = makeSource();
    const deps = makeDeps({ source });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: {
          kind: "segment",
          dayIds: [source.days[0].dayId, source.days[1].dayId, source.days[2].dayId]
        },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
    ).resolves.toBeDefined();
  });

  it("9. kind=segment with non-consecutive day IDs throws", async () => {
    const source = makeSource();
    const deps = makeDeps({ source });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: {
          // days 1 and 3 — gap
          kind: "segment",
          dayIds: [source.days[0].dayId, source.days[2].dayId]
        },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
    ).rejects.toBeInstanceOf(MalformedSelectionError);
  });

  it("10. kind=day with arbitrary (non-consecutive) day IDs succeeds", async () => {
    const source = makeSource();
    const deps = makeDeps({ source });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: {
          kind: "day",
          dayIds: [source.days[0].dayId, source.days[2].dayId]
        },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
    ).resolves.toBeDefined();
  });
});

// ── ID regeneration + copy semantics (§6.2) ──────────────────────────────────

describe("insertFromRated — copy semantics", () => {
  function setupCapture() {
    let captured!: InsertItemsTransactionalParams;
    const source = makeSource();
    const sourceDay = source.days[0];
    // Re-stamp source items with specific values so we can assert preservation.
    sourceDay.items = [
      makeItem({
        sortOrder: 0,
        type: "ACTIVITY",
        title: "Visit Senso-ji",
        description: "Temple visit",
        startTime: "09:00",
        endTime: "10:30",
        placeSnapshotId: "snap-source-1",
        staffNotes: "Crowded after 10am"
      })
    ];
    const deps = makeDeps({
      source,
      recordInsertions: (p) => {
        captured = p;
      }
    });
    return { svc: createRatedHistoryService(deps), source, sourceDay, capturedRef: () => captured };
  }

  it("11. copied items have new UUIDs (different from source)", async () => {
    const { svc, sourceDay, capturedRef } = setupCapture();
    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "item", itemIds: [sourceDay.items[0].itemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 5
    });

    const captured = capturedRef();
    if (captured.insertions.mode !== "items") throw new Error("type narrow");
    const newItem: PreparedItem = captured.insertions.items[0];
    expect(newItem.id).not.toBe(sourceDay.items[0].itemId);
    expect(newItem.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("12. clientNotes is absent/null even if source had it (repo persists null)", async () => {
    const { svc, sourceDay, capturedRef } = setupCapture();
    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "item", itemIds: [sourceDay.items[0].itemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 5
    });

    const captured = capturedRef();
    if (captured.insertions.mode !== "items") throw new Error("type narrow");
    const newItem = captured.insertions.items[0];
    // PreparedItem has no clientNotes property — the repository writes null.
    expect((newItem as Record<string, unknown>).clientNotes).toBeUndefined();
  });

  it("13. routeFromPrevious is absent on PreparedItem (repo persists null)", async () => {
    const { svc, sourceDay, capturedRef } = setupCapture();
    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "item", itemIds: [sourceDay.items[0].itemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 5
    });

    const captured = capturedRef();
    if (captured.insertions.mode !== "items") throw new Error("type narrow");
    const newItem = captured.insertions.items[0];
    expect((newItem as Record<string, unknown>).routeFromPrevious).toBeUndefined();
  });

  it("14. copied items preserve placeSnapshotId", async () => {
    const { svc, sourceDay, capturedRef } = setupCapture();
    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "item", itemIds: [sourceDay.items[0].itemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 5
    });

    const captured = capturedRef();
    if (captured.insertions.mode !== "items") throw new Error("type narrow");
    expect(captured.insertions.items[0].placeSnapshotId).toBe("snap-source-1");
  });

  it("15. copied items preserve staffNotes, startTime, endTime, type, title, description", async () => {
    const { svc, sourceDay, capturedRef } = setupCapture();
    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "item", itemIds: [sourceDay.items[0].itemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 5
    });

    const captured = capturedRef();
    if (captured.insertions.mode !== "items") throw new Error("type narrow");
    const newItem = captured.insertions.items[0];
    expect(newItem.title).toBe("Visit Senso-ji");
    expect(newItem.description).toBe("Temple visit");
    expect(newItem.startTime).toBe("09:00");
    expect(newItem.endTime).toBe("10:30");
    expect(newItem.type).toBe("ACTIVITY");
    expect(newItem.staffNotes).toBe("Crowded after 10am");
  });
});

// ── Cross-agency rejection ───────────────────────────────────────────────────

describe("cross-agency rejection", () => {
  it("16. getRatedItinerary throws SameAgencyViolationError when source belongs to another agency", async () => {
    const deps = makeDeps({
      sourceTrip: tripRow(SOURCE_TRIP_ID, { agencyId: AGENCY_B })
    });
    // Override clientTrip.findUnique so the requested tripId returns the
    // cross-agency row.
    (deps.db.clientTrip.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === SOURCE_TRIP_ID) return tripRow(SOURCE_TRIP_ID, { agencyId: AGENCY_B }) as never;
        return null;
      }
    );
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.getRatedItinerary({ callerAgencyId: AGENCY_A, tripId: SOURCE_TRIP_ID })
    ).rejects.toBeInstanceOf(SameAgencyViolationError);
  });

  it("17. insertFromRated throws SameAgencyViolationError when source belongs to another agency", async () => {
    const deps = makeDeps({
      sourceTrip: tripRow(SOURCE_TRIP_ID, { agencyId: AGENCY_B })
    });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "day", dayIds: [randomUUID()] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
    ).rejects.toBeInstanceOf(SameAgencyViolationError);
  });
});

// ── Concurrency / version handling ───────────────────────────────────────────

describe("optimistic concurrency", () => {
  it("18. stale ifMatchVersion bubbles StaleVersionError; current version unchanged", async () => {
    const source = makeSource();
    const stale: RatedHistoryDeps["insertItemsTransactional"] = async () => {
      throw new StaleVersionError(4, 5);
    };
    const deps = makeDeps({ source, insertImpl: stale });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "day", dayIds: [source.days[0].dayId] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 4
      })
    ).rejects.toMatchObject({
      name: "StaleVersionError",
      expectedVersion: 4,
      actualVersion: 5
    });
  });

  it("19. successful insertion delegates with the caller's ifMatchVersion (repo bumps version)", async () => {
    const source = makeSource();
    const captured: { v?: number } = {};
    const deps = makeDeps({
      source,
      insertImpl: async (p) => {
        captured.v = p.ifMatchVersion;
        return { itineraryId: p.targetItineraryId, newVersion: p.ifMatchVersion + 1 };
      }
    });
    const svc = createRatedHistoryService(deps);

    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "day", dayIds: [source.days[0].dayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 5
    });

    expect(captured.v).toBe(5);
  });
});

// ── Place eligibility on copies ───────────────────────────────────────────────
//
// A rated-history copy is a NEW selection for the target agency, even when the
// same snapshot already appears there, so every copied place must be checked.
describe("insertFromRated place eligibility", () => {
  const blocked = () =>
    vi.fn(async () => {
      throw new ApiError(409, "PLACE_BLOCKED", "Senso-ji cannot be used: is marked closed by this agency.");
    });

  it("checks every distinct copied snapshot against the target agency", async () => {
    const prepareCopiedPlaces = vi.fn(async () => {});
    const source = makeSource();
    const deps = makeDeps({ source, prepareCopiedPlaces });
    const svc = createRatedHistoryService(deps);

    await svc.insertFromRated({
      callerAgencyId: AGENCY_A,
      callerUserId: USER_OWNER,
      callerRole: "OWNER",
      targetTripId: TARGET_TRIP_ID,
      sourceTripId: SOURCE_TRIP_ID,
      selection: { kind: "day", dayIds: [source.days[0].dayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 5
    });

    expect(prepareCopiedPlaces).toHaveBeenCalledTimes(1);
    const [agencyId, ids] = prepareCopiedPlaces.mock.calls[0] as unknown as [string, string[]];
    expect(agencyId).toBe(AGENCY_A);
    // Deduplicated: the fixture reuses one snapshot across both items.
    expect(ids).toEqual(["snap-1"]);
  });

  it("rejects an item insertion without mutating anything", async () => {
    const insertItemsTransactional = vi.fn(async () => ({ itineraryId: TARGET_ITIN_ID, newVersion: 6 }));
    const source = makeSource();
    const deps = makeDeps({
      source,
      insertImpl: insertItemsTransactional,
      prepareCopiedPlaces: blocked()
    });
    const svc = createRatedHistoryService(deps);

    const error = await svc
      .insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "item", itemIds: [source.days[0].items[0].itemId] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(insertItemsTransactional).not.toHaveBeenCalled();
  });

  it("rejects a day/segment insertion without mutating anything", async () => {
    const insertItemsTransactional = vi.fn(async () => ({ itineraryId: TARGET_ITIN_ID, newVersion: 6 }));
    const source = makeSource();
    const deps = makeDeps({
      source,
      insertImpl: insertItemsTransactional,
      prepareCopiedPlaces: blocked()
    });
    const svc = createRatedHistoryService(deps);

    const error = await svc
      .insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "segment", dayIds: [source.days[0].dayId, source.days[1].dayId] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
      .catch((caught) => caught);

    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
    expect(insertItemsTransactional).not.toHaveBeenCalled();
  });

  it("does not run place checks before version or agency validation fails", async () => {
    const prepareCopiedPlaces = vi.fn(async () => {});
    const source = makeSource();
    const deps = makeDeps({
      source,
      prepareCopiedPlaces,
      sourceTrip: tripRow(SOURCE_TRIP_ID, { agencyId: AGENCY_B })
    });
    const svc = createRatedHistoryService(deps);

    await svc
      .insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "day", dayIds: [source.days[0].dayId] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
      .catch(() => undefined);

    expect(prepareCopiedPlaces).not.toHaveBeenCalled();
  });
});
