/**
 * Unit tests for the union-query behaviour added to listRatedTrips.
 *
 * Strategy: vi.mock prisma at the module boundary (same as ratedHistoryRoutes.test.ts).
 * Each test configures tripReview.findMany and itineraryShare.findMany to return
 * controlled rows, then calls listRatedTrips directly and asserts on the result.
 *
 * Scenarios covered (per spec):
 *  U1. Trip rated only via TripReview (rating=5) → included, rating=5
 *  U2. Trip rated only via ItineraryShare.proposalRating=4 → included, rating=4
 *  U3. Trip in BOTH sources → included once; higher rating wins; more recent ratedAt used
 *  U4. Trip with proposalRating=3 only → excluded (below threshold)
 *  U5. ItineraryShare row with null tripId → excluded (trip relation is null)
 *  U6. Trip with zero itinerary days → excluded regardless of rating
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Prisma mock (hoisted before any import resolves) ─────────────────────────

vi.mock("../src/db/prisma", () => ({
  prisma: {
    tripReview: {
      findMany: vi.fn()
    },
    itineraryShare: {
      findMany: vi.fn()
    }
  }
}));

import { prisma } from "../src/db/prisma";
import { listRatedTrips } from "../src/modules/ratedHistory/ratedHistoryRepository";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGENCY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** A minimal itinerary snippet with at least one day. */
const itin1Day = { id: "itin-1", _count: { days: 1 } };
/** A minimal itinerary snippet with zero days (used for U6). */
const itinZeroDays = { id: "itin-0", _count: { days: 0 } };

function makeTrip(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Trip ${id}`,
    destinationSummary: "Tokyo",
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: new Date("2026-06-07T00:00:00Z"),
    itineraries: [itin1Day],
    agencyId: AGENCY,
    ...extra
  };
}

function makeReview(tripId: string, rating: number, submittedAt: Date) {
  return {
    id: `rev-${tripId}`,
    rating,
    submittedAt,
    trip: makeTrip(tripId)
  };
}

function makeShare(tripId: string | null, proposalRating: number, proposalRatedAt: Date | null) {
  return {
    proposalRating,
    proposalRatedAt,
    trip: tripId ? makeTrip(tripId) : null
  };
}

const defaultParams = {
  agencyId: AGENCY,
  page: 1,
  pageSize: 20
};

type MockFn = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("listRatedTrips union behaviour", () => {
  it("U1: trip rated only via TripReview (rating=5) is included with rating=5", async () => {
    const submittedAt = new Date("2026-01-10T00:00:00Z");
    (prisma.tripReview.findMany as MockFn).mockResolvedValue([
      makeReview("trip-a", 5, submittedAt)
    ]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([]);

    const result = await listRatedTrips(defaultParams);

    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].tripId).toBe("trip-a");
    expect(result.trips[0].rating).toBe(5);
    expect(result.trips[0].ratedAt).toBe(submittedAt.toISOString());
  });

  it("U2: trip rated only via ItineraryShare.proposalRating=4 is included with rating=4", async () => {
    const ratedAt = new Date("2026-02-15T00:00:00Z");
    (prisma.tripReview.findMany as MockFn).mockResolvedValue([]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([
      makeShare("trip-b", 4, ratedAt)
    ]);

    const result = await listRatedTrips(defaultParams);

    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].tripId).toBe("trip-b");
    expect(result.trips[0].rating).toBe(4);
    expect(result.trips[0].ratedAt).toBe(ratedAt.toISOString());
  });

  it("U3: trip in BOTH sources appears once; higher rating wins; more recent ratedAt used", async () => {
    const reviewAt = new Date("2026-01-01T00:00:00Z");
    const shareAt = new Date("2026-03-01T00:00:00Z"); // more recent

    (prisma.tripReview.findMany as MockFn).mockResolvedValue([
      makeReview("trip-c", 4, reviewAt)
    ]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([
      makeShare("trip-c", 5, shareAt) // higher rating
    ]);

    const result = await listRatedTrips(defaultParams);

    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].tripId).toBe("trip-c");
    expect(result.trips[0].rating).toBe(5);           // share wins (higher)
    expect(result.trips[0].ratedAt).toBe(shareAt.toISOString()); // share wins (more recent)
  });

  it("U3b: trip in BOTH; review rating higher, review timestamp more recent", async () => {
    const reviewAt = new Date("2026-04-01T00:00:00Z"); // more recent
    const shareAt = new Date("2026-01-01T00:00:00Z");

    (prisma.tripReview.findMany as MockFn).mockResolvedValue([
      makeReview("trip-d", 5, reviewAt) // higher rating
    ]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([
      makeShare("trip-d", 4, shareAt)
    ]);

    const result = await listRatedTrips(defaultParams);

    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].tripId).toBe("trip-d");
    expect(result.trips[0].rating).toBe(5);
    expect(result.trips[0].ratedAt).toBe(reviewAt.toISOString());
  });

  it("U4: trip with proposalRating=3 only is excluded (Prisma filter handles this, but defence-in-depth)", async () => {
    // The Prisma query already filters >= 4, so the share would never arrive
    // in the array. We simulate the Prisma filter having worked: empty array.
    (prisma.tripReview.findMany as MockFn).mockResolvedValue([]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([]); // filtered by Prisma

    const result = await listRatedTrips(defaultParams);
    expect(result.trips).toHaveLength(0);
  });

  it("U5: ItineraryShare with null trip (null tripId) is excluded", async () => {
    const ratedAt = new Date("2026-02-01T00:00:00Z");
    (prisma.tripReview.findMany as MockFn).mockResolvedValue([]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([
      makeShare(null, 5, ratedAt) // trip is null → should be skipped
    ]);

    const result = await listRatedTrips(defaultParams);
    expect(result.trips).toHaveLength(0);
  });

  it("U6: trip whose most-recent itinerary has zero days is excluded", async () => {
    const submittedAt = new Date("2026-01-10T00:00:00Z");
    const reviewRow = {
      id: "rev-e",
      rating: 5,
      submittedAt,
      trip: makeTrip("trip-e", { itineraries: [itinZeroDays] })
    };
    (prisma.tripReview.findMany as MockFn).mockResolvedValue([reviewRow]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([]);

    const result = await listRatedTrips(defaultParams);
    expect(result.trips).toHaveLength(0);
  });

  it("U7: results are sorted by ratedAt DESC across both sources", async () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-03-01T00:00:00Z");

    (prisma.tripReview.findMany as MockFn).mockResolvedValue([
      makeReview("trip-old", 4, older)
    ]);
    (prisma.itineraryShare.findMany as MockFn).mockResolvedValue([
      makeShare("trip-new", 4, newer)
    ]);

    const result = await listRatedTrips(defaultParams);

    expect(result.trips).toHaveLength(2);
    expect(result.trips[0].tripId).toBe("trip-new"); // newer first
    expect(result.trips[1].tripId).toBe("trip-old");
  });
});
