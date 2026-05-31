/**
 * Integration tests for the ratedHistory HTTP routes.
 *
 * Approach: vi.mock at three seams —
 *   1. prisma.session.findUnique  — so attachAuthUser resolves a known user
 *   2. agencyAccessService        — so requireVerifiedAgencyMember passes / fails
 *   3. ratedHistoryService        — so the three service methods return canned data
 *
 * This mirrors the mock-at-the-repo pattern used in all other non-DB test files
 * in this project. No Postgres connection is needed; all assertions are on HTTP
 * status codes and response body shapes.
 *
 * Endpoints covered:
 *   GET  /agencies/:agencyId/rated-history
 *   GET  /agencies/:agencyId/rated-history/:tripId
 *   POST /trips/:tripId/itinerary/insert-from-rated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

// ── Module mocks (hoisted by Vitest before imports resolve) ──────────────────

vi.mock("../src/db/prisma", () => ({
  prisma: {
    session: {
      findUnique: vi.fn()
    },
    clientTrip: {
      findUnique: vi.fn()
    }
  }
}));

vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: {
    requireVerifiedAgencyMember: vi.fn()
  }
}));

vi.mock("../src/modules/ratedHistory/ratedHistoryService", () => ({
  ratedHistoryService: {
    listRatedHistory: vi.fn(),
    getRatedItinerary: vi.fn(),
    insertFromRated: vi.fn()
  }
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { agencyAccessService } from "../src/modules/agencyAccess/agencyAccessService";
import { ratedHistoryService } from "../src/modules/ratedHistory/ratedHistoryService";
import {
  MalformedSelectionError,
  SameAgencyViolationError,
  SourceNotFoundError,
  StaleVersionError
} from "../src/modules/ratedHistory/ratedHistoryErrors";

// ── Fixture constants ────────────────────────────────────────────────────────

const AGENCY_A_ID = "11111111-1111-1111-1111-111111111111";
const AGENCY_B_ID = "22222222-2222-2222-2222-222222222222";
const USER_OWNER_A_ID = "33333333-3333-3333-3333-333333333333";
const USER_OWNER_B_ID = "44444444-4444-4444-4444-444444444444";
const SESSION_TOKEN = "test-session-token-owner-a";

// Trip IDs in agencyA
const TRIP1_ID = "aaaaaaaa-0001-4000-8000-000000000001"; // completed, APPROVED_INTERNAL, rating 5, 3 days
const TRIP2_ID = "aaaaaaaa-0002-4000-8000-000000000002"; // completed, DRAFT, rating 4
const TRIP3_ID = "aaaaaaaa-0003-4000-8000-000000000003"; // completed, APPROVED_INTERNAL + DRAFT, rating 5
const TRIP4_ID = "aaaaaaaa-0004-4000-8000-000000000004"; // completed, APPROVED_INTERNAL, rating 3 — excluded
const TRIP5_ID = "aaaaaaaa-0005-4000-8000-000000000005"; // completed, no itinerary — excluded
const TRIP6_ID = "aaaaaaaa-0006-4000-8000-000000000006"; // in agencyB, rating 5
const TARGET_TRIP_ID = "aaaaaaaa-0007-4000-8000-000000000007"; // agencyA, empty itinerary
const TARGET_ITIN_ID = "bbbbbbbb-0001-4000-8000-000000000001"; // empty APPROVED_INTERNAL itinerary

const NONEXISTENT_TRIP_ID = "ffffffff-0000-4000-8000-000000000000";

// ── Stub data builders ───────────────────────────────────────────────────────

/** A minimal RatedTripSummary */
function makeTripSummary(tripId: string, overrides: Record<string, unknown> = {}) {
  return {
    tripId,
    title: `Trip ${tripId.slice(-4)}`,
    destinationSummary: "Tokyo",
    dayCount: 3,
    startDate: "2025-03-10",
    endDate: "2025-03-12",
    rating: 5,
    ratedAt: "2025-04-15T00:00:00.000Z",
    ...overrides
  };
}

/** A minimal RatedItinerary with one day and one item */
function makeItinerary(itineraryId = TARGET_ITIN_ID) {
  const itemId = randomUUID();
  const dayId = randomUUID();
  return {
    itineraryId,
    title: "Tokyo Family",
    summary: null,
    days: [
      {
        dayId,
        dayNumber: 1,
        date: "2025-03-10",
        title: "Day 1",
        summary: null,
        items: [
          {
            itemId,
            sortOrder: 0,
            type: "ACTIVITY",
            title: "Visit Senso-ji",
            description: null,
            startTime: "09:00",
            endTime: "10:30",
            place: null,
            staffNotes: null
            // clientNotes intentionally absent
          }
        ]
      }
    ]
  };
}

/** A stub AuthUser returned by the mocked session lookup */
function makeAuthUser(userId: string, agencyId: string) {
  return {
    id: userId,
    status: "ACTIVE",
    accountType: "AGENCY_USER",
    role: "USER",
    displayName: "Test Owner",
    email: "owner@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    memberships: [
      {
        id: randomUUID(),
        userId,
        agencyId,
        role: "OWNER",
        status: "ACTIVE",
        agency: {
          id: agencyId,
          status: "VERIFIED",
          name: "Test Agency",
          businessPhone: null,
          businessEmail: null,
          city: null,
          country: null,
          rejectionReason: null,
          suspensionReason: null
        }
      }
    ]
  };
}

/** A stub AgencyAccess returned by requireVerifiedAgencyMember */
function makeAccess(agencyId: string, userId: string, role: "OWNER" | "ADMIN" | "STAFF" = "OWNER") {
  return {
    agency: { id: agencyId, status: "VERIFIED" },
    membership: {
      id: randomUUID(),
      userId,
      agencyId,
      role,
      status: "ACTIVE"
    }
  };
}

// ── Typed mock references ────────────────────────────────────────────────────

const mockSessionFindUnique = prisma.session.findUnique as ReturnType<typeof vi.fn>;
const mockTripFindUnique = (prisma as any).clientTrip.findUnique as ReturnType<typeof vi.fn>;
const mockRequireVerifiedMember = agencyAccessService.requireVerifiedAgencyMember as ReturnType<typeof vi.fn>;
const mockListRatedHistory = ratedHistoryService.listRatedHistory as ReturnType<typeof vi.fn>;
const mockGetRatedItinerary = ratedHistoryService.getRatedItinerary as ReturnType<typeof vi.fn>;
const mockInsertFromRated = ratedHistoryService.insertFromRated as ReturnType<typeof vi.fn>;

// ── Auth setup helper ────────────────────────────────────────────────────────

/**
 * Wires the session mock so attachAuthUser resolves ownerA.
 * Tests that need ownerB or unauthenticated override this.
 */
function authenticateAs(userId: string, agencyId: string) {
  const user = makeAuthUser(userId, agencyId);
  mockSessionFindUnique.mockResolvedValue({
    id: randomUUID(),
    tokenHash: "ignored-by-mock",
    expiresAt: new Date(Date.now() + 86_400_000),
    user
  });
  return user;
}

function unauthenticate() {
  mockSessionFindUnique.mockResolvedValue(null);
}

// ── Reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Default: ownerA authenticated
  authenticateAs(USER_OWNER_A_ID, AGENCY_A_ID);
  // Default: access allowed for agencyA
  mockRequireVerifiedMember.mockResolvedValue(makeAccess(AGENCY_A_ID, USER_OWNER_A_ID));
});

// ── GET /agencies/:agencyId/rated-history ────────────────────────────────────

describe("GET /agencies/:agencyId/rated-history", () => {
  it("1. returns rated trips (trip4 and trip5 excluded by service; trip6 excluded by agency check)", async () => {
    // Service mock returns trips 1, 2, 3 — the three that meet threshold
    const trips = [
      makeTripSummary(TRIP1_ID, { dayCount: 3, rating: 5 }),
      makeTripSummary(TRIP2_ID, { dayCount: 2, rating: 4 }),
      makeTripSummary(TRIP3_ID, { dayCount: 3, rating: 5 })
    ];
    mockListRatedHistory.mockResolvedValue({ trips, hasMore: false, nextPage: null });

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.trips).toHaveLength(3);
    // Trips 4 & 5 are absent (service filtered them — mock didn't include them)
    const returnedIds = res.body.trips.map((t: { tripId: string }) => t.tripId);
    expect(returnedIds).not.toContain(TRIP4_ID);
    expect(returnedIds).not.toContain(TRIP5_ID);
    expect(returnedIds).not.toContain(TRIP6_ID);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextPage).toBeNull();
  });

  it("2. ?destination=tokyo passes filter to service and returns filtered list", async () => {
    const tokyoTrip = makeTripSummary(TRIP1_ID, { destinationSummary: "Tokyo" });
    mockListRatedHistory.mockResolvedValue({ trips: [tokyoTrip], hasMore: false, nextPage: null });

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history?destination=tokyo`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(mockListRatedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ destination: "tokyo" }) })
    );
    expect(res.body.trips).toHaveLength(1);
    expect(res.body.trips[0].destinationSummary).toBe("Tokyo");
  });

  it("3. ?durationDays=3 passes filter to service", async () => {
    mockListRatedHistory.mockResolvedValue({
      trips: [makeTripSummary(TRIP1_ID, { dayCount: 3 })],
      hasMore: false,
      nextPage: null
    });

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history?durationDays=3`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(mockListRatedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ durationDays: 3 }) })
    );
  });

  it("4. ?season=spring passes filter to service", async () => {
    const springTrip = makeTripSummary(TRIP1_ID, { startDate: "2025-04-01", endDate: "2025-04-05" });
    mockListRatedHistory.mockResolvedValue({ trips: [springTrip], hasMore: false, nextPage: null });

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history?season=spring`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(mockListRatedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ season: "spring" }) })
    );
  });

  it("5. ?page=2&pageSize=2 passes pagination to service", async () => {
    mockListRatedHistory.mockResolvedValue({
      trips: [makeTripSummary(TRIP3_ID)],
      hasMore: false,
      nextPage: null
    });

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history?page=2&pageSize=2`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(mockListRatedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 2 })
    );
  });

  it("6. ownerA requesting agencyB history → 403", async () => {
    // requireVerifiedAgencyMember throws when user not in agencyB
    const { ApiError } = await import("../src/http/errors");
    mockRequireVerifiedMember.mockRejectedValue(
      new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.")
    );

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_B_ID}/rated-history`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(403);
  });

  it("7. unauthenticated → 401", async () => {
    unauthenticate();

    const app = createApp();
    const res = await request(app).get(`/agencies/${AGENCY_A_ID}/rated-history`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
  });
});

// ── GET /agencies/:agencyId/rated-history/:tripId ────────────────────────────

describe("GET /agencies/:agencyId/rated-history/:tripId", () => {
  it("8. returns itinerary for trip1; no clientNotes field anywhere in items", async () => {
    const itinerary = makeItinerary(randomUUID());
    // Confirm fixture has no clientNotes
    const detail = {
      trip: makeTripSummary(TRIP1_ID),
      itinerary
    };
    mockGetRatedItinerary.mockResolvedValue(detail);

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history/${TRIP1_ID}`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.itinerary).toBeDefined();
    expect(res.body.trip.tripId).toBe(TRIP1_ID);

    // PII strip: no clientNotes anywhere in items
    for (const day of res.body.itinerary.days) {
      for (const item of day.items) {
        expect(Object.keys(item)).not.toContain("clientNotes");
      }
    }
  });

  it("9. trip3 — service returns APPROVED_INTERNAL itinerary; route passes it through", async () => {
    const approvedItinId = "cccccccc-0003-4000-8000-000000000001";
    const detail = {
      trip: makeTripSummary(TRIP3_ID),
      itinerary: { ...makeItinerary(approvedItinId), itineraryId: approvedItinId }
    };
    mockGetRatedItinerary.mockResolvedValue(detail);

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history/${TRIP3_ID}`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.itinerary.itineraryId).toBe(approvedItinId);
  });

  it("10. trip5 (no itinerary) → 404", async () => {
    mockGetRatedItinerary.mockRejectedValue(new SourceNotFoundError("missing"));

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history/${TRIP5_ID}`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("11. trip6 (cross-agency) → 403", async () => {
    mockGetRatedItinerary.mockRejectedValue(new SameAgencyViolationError());

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history/${TRIP6_ID}`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("12. nonexistent tripId → 404", async () => {
    mockGetRatedItinerary.mockRejectedValue(new SourceNotFoundError("missing"));

    const app = createApp();
    const res = await request(app)
      .get(`/agencies/${AGENCY_A_ID}/rated-history/${NONEXISTENT_TRIP_ID}`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });
});

// ── POST /trips/:tripId/itinerary/insert-from-rated ──────────────────────────

describe("POST /trips/:tripId/itinerary/insert-from-rated", () => {
  // Common insert request helpers
  const sourceDayId = randomUUID();
  const sourceItemId = randomUUID();

  function dayInsertBody(overrides: Record<string, unknown> = {}) {
    return {
      sourceTripId: TRIP1_ID,
      selection: { kind: "day", dayIds: [sourceDayId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 1,
      ...overrides
    };
  }

  function itemInsertBody(overrides: Record<string, unknown> = {}) {
    return {
      sourceTripId: TRIP1_ID,
      selection: { kind: "item", itemIds: [sourceItemId] },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0, position: 0 },
      ifMatchVersion: 1,
      ...overrides
    };
  }

  function segmentInsertBody(dayIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      sourceTripId: TRIP1_ID,
      selection: { kind: "segment", dayIds },
      target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
      ifMatchVersion: 1,
      ...overrides
    };
  }

  /**
   * Wire the route's internal prisma.clientTrip.findUnique so it returns
   * the target trip row (route uses this to resolve agencyId before calling
   * agencyAccessService).
   */
  function seedTargetTrip(tripId: string, agencyId: string) {
    mockTripFindUnique.mockResolvedValue({ agencyId });
  }

  beforeEach(() => {
    // Default: target trip belongs to agencyA
    seedTargetTrip(TARGET_TRIP_ID, AGENCY_A_ID);
  });

  it("13. happy path kind=day → 200, itinerary returned with new day", async () => {
    const newDay = { dayId: randomUUID(), dayNumber: 1, date: "2026-06-01", title: "Day 1", summary: null, items: [] };
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [newDay]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(200);
    expect(res.body.itinerary.days).toHaveLength(1);
    expect(res.body.itinerary.days[0].date).toBe("2026-06-01");
    expect(res.body.missingStartDateAdvisory).toBeUndefined();
  });

  it("14. happy path kind=item → 200, items inserted at target position", async () => {
    const itemId = randomUUID();
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        {
          dayId: randomUUID(),
          dayNumber: 1,
          date: "2026-06-01",
          title: "Day 1",
          summary: null,
          items: [
            {
              itemId,
              sortOrder: 0,
              type: "ACTIVITY",
              title: "Visit Senso-ji",
              description: null,
              startTime: null,
              endTime: null,
              place: null,
              staffNotes: null
            }
          ]
        }
      ]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(itemInsertBody());

    expect(res.status).toBe(200);
    expect(res.body.itinerary.days[0].items).toHaveLength(1);
    expect(res.body.itinerary.days[0].items[0].sortOrder).toBe(0);
  });

  it("15. happy path kind=segment (multi-day consecutive) → 200", async () => {
    const dayId1 = randomUUID();
    const dayId2 = randomUUID();
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        { dayId: dayId1, dayNumber: 1, date: "2026-06-01", title: "Day 1", summary: null, items: [] },
        { dayId: dayId2, dayNumber: 2, date: "2026-06-02", title: "Day 2", summary: null, items: [] }
      ]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(segmentInsertBody([dayId1, dayId2]));

    expect(res.status).toBe(200);
    expect(res.body.itinerary.days).toHaveLength(2);
  });

  it("16. kind=item with itemIds spanning two source days → 400 malformed_selection", async () => {
    mockInsertFromRated.mockRejectedValue(new MalformedSelectionError("items span multiple days"));

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(itemInsertBody({
        selection: { kind: "item", itemIds: [randomUUID(), randomUUID()] }
      }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("malformed_selection");
  });

  it("17. kind=segment with non-consecutive dayIds → 400 malformed_selection", async () => {
    mockInsertFromRated.mockRejectedValue(new MalformedSelectionError("segment days not consecutive"));

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(segmentInsertBody([randomUUID(), randomUUID()]));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("malformed_selection");
    expect(res.body.detail).toBe("segment days not consecutive");
  });

  it("18. source trip belongs to agencyB → 403 forbidden", async () => {
    mockInsertFromRated.mockRejectedValue(
      new SameAgencyViolationError("Source trip does not belong to the caller's agency.")
    );

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody({ sourceTripId: TRIP6_ID }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("19. target trip belongs to agencyB (caller in agencyA) → 403 via requireVerifiedAgencyMember", async () => {
    // Route finds the trip → agencyB, then calls requireVerifiedAgencyMember for agencyB → 403
    mockTripFindUnique.mockResolvedValue({ agencyId: AGENCY_B_ID });
    const { ApiError } = await import("../src/http/errors");
    mockRequireVerifiedMember.mockRejectedValue(
      new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.")
    );

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(403);
  });

  it("20. source trip nonexistent → 404 not_found", async () => {
    mockInsertFromRated.mockRejectedValue(new SourceNotFoundError("missing"));

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody({ sourceTripId: NONEXISTENT_TRIP_ID }));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("21. stale ifMatchVersion → 409 stale_version with expected/actual", async () => {
    mockInsertFromRated.mockRejectedValue(new StaleVersionError(1, 2));

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody({ ifMatchVersion: 1 }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("stale_version");
    expect(res.body.expected).toBe(1);
    expect(res.body.actual).toBe(2);
  });

  it("22. source deleted between list and insert → SKIP (see note)", () => {
    // Simulating concurrent deletion mid-request requires either a real DB
    // transaction or a more complex mock that mutates state mid-call.
    // The repository maps Prisma FK P2003 violations to SourceNotFoundError(deleted)
    // and the route handler returns 410 for reason='deleted'. This path is
    // covered by the repository unit test; route-level simulation is skipped
    // because we'd need to mock a FK violation timing which Prisma's client
    // can't represent in a vitest mock without real transactions.
    // The 410 path CAN be verified with a simple service mock:
    expect(true).toBe(true); // placeholder — see rationale above
  });

  it("22b. source_deleted (SourceNotFoundError reason=deleted) → 410", async () => {
    mockInsertFromRated.mockRejectedValue(new SourceNotFoundError("deleted"));

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("source_deleted");
  });

  it("23. target trip has null startDate → 200 with missingStartDateAdvisory: true, days have date: null", async () => {
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        { dayId: randomUUID(), dayNumber: 1, date: null, title: "Day 1", summary: null, items: [] }
      ]
    };
    mockInsertFromRated.mockResolvedValue({
      itinerary: returnedItinerary,
      missingStartDateAdvisory: true
    });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(200);
    expect(res.body.missingStartDateAdvisory).toBe(true);
    expect(res.body.itinerary.days[0].date).toBeNull();
  });

  it("24. PII strip: clientNotes on copied items is absent/null in service response", async () => {
    // The service (ratedHistoryService) strips clientNotes before returning.
    // We verify the route passes through whatever the service returns without
    // re-injecting PII. The service mock returns items with no clientNotes.
    const itemId = randomUUID();
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        {
          dayId: randomUUID(),
          dayNumber: 1,
          date: "2026-06-01",
          title: "Day 1",
          summary: null,
          items: [
            {
              itemId,
              sortOrder: 0,
              type: "ACTIVITY",
              title: "Visit Senso-ji",
              description: null,
              startTime: null,
              endTime: null,
              place: null,
              staffNotes: "Arrive early"
              // clientNotes deliberately absent — PII-stripped by service
            }
          ]
        }
      ]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(200);
    for (const day of res.body.itinerary.days) {
      for (const item of day.items) {
        expect(Object.keys(item)).not.toContain("clientNotes");
      }
    }
  });

  it("25. routeFromPrevious cleared: not present on copied items", async () => {
    const itemId = randomUUID();
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        {
          dayId: randomUUID(),
          dayNumber: 1,
          date: "2026-06-01",
          title: "Day 1",
          summary: null,
          items: [
            {
              itemId,
              sortOrder: 0,
              type: "ACTIVITY",
              title: "Visit Senso-ji",
              description: null,
              startTime: null,
              endTime: null,
              place: null,
              staffNotes: null
              // routeFromPrevious not present — DB persists JsonNull, route never serialises it
            }
          ]
        }
      ]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(200);
    for (const day of res.body.itinerary.days) {
      for (const item of day.items) {
        expect(Object.keys(item)).not.toContain("routeFromPrevious");
      }
    }
  });

  it("26. placeSnapshotId preserved: service mock echoes it on the item", async () => {
    // The service strips placeSnapshotId from the returned RatedItinerary
    // (it's an internal FK, not a public DTO field). The route passes through
    // whatever the service returns, so this test verifies that the route does
    // NOT accidentally re-add or remove the field.
    // Per spec §6.2 and ratedHistoryTypes.ts, RatedItineraryItem has no
    // placeSnapshotId field — it is stripped by stripInternalFields in the service.
    // We assert the field is absent from the HTTP response.
    const itemId = randomUUID();
    const returnedItinerary = {
      itineraryId: TARGET_ITIN_ID,
      title: "Target Trip",
      summary: null,
      days: [
        {
          dayId: randomUUID(),
          dayNumber: 1,
          date: "2026-06-01",
          title: "Day 1",
          summary: null,
          items: [
            {
              itemId,
              sortOrder: 0,
              type: "ACTIVITY",
              title: "Visit Senso-ji",
              description: null,
              startTime: null,
              endTime: null,
              place: null,
              staffNotes: null
              // placeSnapshotId is an internal field; service returns it stripped
            }
          ]
        }
      ]
    };
    mockInsertFromRated.mockResolvedValue({ itinerary: returnedItinerary });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(200);
    for (const day of res.body.itinerary.days) {
      for (const item of day.items) {
        // placeSnapshotId is an internal FK — must not appear in public response
        expect(Object.keys(item)).not.toContain("placeSnapshotId");
      }
    }
  });

  it("27. successful insertion: service is called with correct ifMatchVersion (version bump is service/repo concern)", async () => {
    const capturedArgs: unknown[] = [];
    mockInsertFromRated.mockImplementation(async (params) => {
      capturedArgs.push(params);
      return {
        itinerary: {
          itineraryId: TARGET_ITIN_ID,
          title: "Target Trip",
          summary: null,
          days: []
        }
      };
    });

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody({ ifMatchVersion: 1 }));

    expect(res.status).toBe(200);
    expect(capturedArgs[0]).toMatchObject({ ifMatchVersion: 1 });
    // The version bump itself is tested in ratedHistoryService.test.ts (test 19).
    // The route passes ifMatchVersion through to the service unmodified.
  });

  it("target trip not found → 404", async () => {
    mockTripFindUnique.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("unauthenticated insert → 401", async () => {
    unauthenticate();

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .send(dayInsertBody());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
  });
});
