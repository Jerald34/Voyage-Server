/**
 * Integration tests for the dashboard service composition layer.
 *
 * These tests exercise `createDashboardService` and `selectViewForRole` using
 * a fake repository (no Postgres) and a fresh TtlCache per test. They cover:
 *  - Role enforcement
 *  - Owner payload completeness
 *  - Staff payload scoping
 *  - Period window switching
 *  - Cache hit/miss behaviour
 *  - Deterministic `now` injection
 *
 * Pure aggregation math is already covered in dashboardAggregations.test.ts;
 * those tests are not duplicated here.
 */

import { describe, it, expect } from "vitest";
import {
  createDashboardService,
  selectViewForRole
} from "../src/modules/dashboard/dashboardService";
import { TtlCache } from "../src/modules/dashboard/cache";
import type {
  DashboardRepository,
  RawDashboardData
} from "../src/modules/dashboard/dashboardRepository";
import type { DashboardPayload } from "../src/modules/dashboard/dashboardTypes";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

function makeFakeRepo(data: RawDashboardData): DashboardRepository & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async fetchAgencyDashboardData(_agencyId: string): Promise<RawDashboardData> {
      calls += 1;
      return data;
    }
  } as DashboardRepository & { calls: number };
}

function emptyData(): RawDashboardData {
  return { trips: [], itineraries: [], shares: [], comments: [], reviews: [] };
}

const NOW = new Date("2026-05-26T12:00:00Z");
const AGENCY = "agency-1";
const USER_A = "user-a";
const USER_B = "user-b";

/** Build a minimal trip row. */
function makeTrip(
  id: string,
  overrides: Partial<RawDashboardData["trips"][number]> = {}
): RawDashboardData["trips"][number] {
  return {
    id,
    title: `Trip ${id}`,
    status: "DRAFT",
    createdAt: NOW,
    updatedAt: NOW,
    startDate: null,
    endDate: null,
    travelerCount: null,
    clientName: null,
    createdByUserId: USER_A,
    assignedOrganizerUserId: null,
    ...overrides
  };
}

/** Build a minimal share row. */
function makeShare(
  id: string,
  tripId: string,
  overrides: Partial<RawDashboardData["shares"][number]> = {}
): RawDashboardData["shares"][number] {
  return {
    id,
    tripId,
    viewCount: 0,
    lastViewedAt: null,
    expiresAt: null,
    revokedAt: null,
    proposalRating: null,
    proposalRatedAt: null,
    createdAt: NOW,
    ...overrides
  };
}

/** Build a minimal comment row. */
function makeComment(
  id: string,
  shareId: string,
  overrides: Partial<RawDashboardData["comments"][number]> = {}
): RawDashboardData["comments"][number] {
  return {
    id,
    shareId,
    content: "Test comment",
    status: "PENDING",
    agencyRepliedAt: null,
    createdAt: NOW,
    ...overrides
  };
}

/** Build a minimal review row. */
function makeReview(
  id: string,
  tripId: string,
  rating: number
): RawDashboardData["reviews"][number] {
  return {
    id,
    tripId,
    rating,
    reviewText: "Great trip!",
    respondentName: "Alice",
    consentToTestimonial: true,
    submittedAt: NOW
  };
}

/** Create a service with a fresh 60s cache. */
function makeService(data: RawDashboardData) {
  const repo = makeFakeRepo(data);
  const cache = new TtlCache<DashboardPayload>(60_000);
  const svc = createDashboardService({ repository: repo, cache });
  return { repo, cache, svc };
}

// ---------------------------------------------------------------------------
// 1. Role enforcement (selectViewForRole)
// ---------------------------------------------------------------------------

describe("selectViewForRole", () => {
  it("STAFF requesting 'owner' throws ApiError 403 with DASHBOARD_VIEW_FORBIDDEN", () => {
    expect(() => selectViewForRole("STAFF", "owner")).toThrow();
    try {
      selectViewForRole("STAFF", "owner");
    } catch (err: unknown) {
      expect((err as { statusCode: number }).statusCode).toBe(403);
      expect((err as { code: string }).code).toBe("DASHBOARD_VIEW_FORBIDDEN");
    }
  });

  it("OWNER requesting 'owner' returns 'owner'", () => {
    expect(selectViewForRole("OWNER", "owner")).toBe("owner");
  });

  it("ADMIN requesting 'owner' returns 'owner'", () => {
    expect(selectViewForRole("ADMIN", "owner")).toBe("owner");
  });

  it("STAFF requesting 'staff' returns 'staff'", () => {
    expect(selectViewForRole("STAFF", "staff")).toBe("staff");
  });

  it("OWNER requesting 'staff' returns 'staff' (staff view is open to all)", () => {
    expect(selectViewForRole("OWNER", "staff")).toBe("staff");
  });

  it("No view + STAFF role defaults to 'staff'", () => {
    expect(selectViewForRole("STAFF", undefined)).toBe("staff");
  });

  it("No view + OWNER role defaults to 'owner'", () => {
    expect(selectViewForRole("OWNER", undefined)).toBe("owner");
  });

  it("No view + ADMIN role defaults to 'owner'", () => {
    expect(selectViewForRole("ADMIN", undefined)).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// 2. Owner payload completeness
// ---------------------------------------------------------------------------

describe("getDashboard – owner payload completeness", () => {
  it("returns all required top-level fields with correct view and period", async () => {
    const trip1 = makeTrip("t1", { createdAt: NOW, status: "APPROVED_INTERNAL" });
    const share1 = makeShare("s1", "t1", {
      viewCount: 2,
      proposalRating: 4,
      proposalRatedAt: NOW,
      createdAt: NOW
    });
    const comment1 = makeComment("c1", "s1", { createdAt: NOW });
    const review1 = makeReview("r1", "t1", 5);

    const data: RawDashboardData = {
      trips: [trip1],
      itineraries: [{ id: "i1", tripId: "t1", createdAt: NOW }],
      shares: [share1],
      comments: [comment1],
      reviews: [review1]
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      period: "30d",
      now: NOW
    });

    expect(payload.view).toBe("owner");
    expect(payload.period).toBe("30d");

    // Must be the owner shape
    if (payload.view !== "owner") throw new Error("wrong view discriminant");

    // KPI tiles present
    expect(typeof payload.kpis.winRate.value).toBe("number");
    expect(typeof payload.kpis.timeToFirstShareDays.value).toBe("number");
    expect(typeof payload.kpis.medianCommentResponseHours.value).toBe("number");
    expect(typeof payload.kpis.avgProposalRating.value).toBe("number");

    // Worklist buckets are arrays
    expect(Array.isArray(payload.worklist.unreadComments)).toBe(true);
    expect(Array.isArray(payload.worklist.viewedNotReplied)).toBe(true);
    expect(Array.isArray(payload.worklist.draftsStuck)).toBe(true);
    expect(Array.isArray(payload.worklist.sharesExpiring)).toBe(true);
    expect(Array.isArray(payload.worklist.lowRated)).toBe(true);

    // Funnel has exactly 5 stages
    expect(payload.funnel.stages).toHaveLength(5);

    // Recent reviews is an array
    expect(Array.isArray(payload.recentReviews)).toBe(true);
    expect(payload.recentReviews[0].rating).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. Staff payload scoping
// ---------------------------------------------------------------------------

describe("getDashboard – staff payload scoping", () => {
  it("hero references only the requesting user's trip", async () => {
    const myTrip = makeTrip("mine", {
      createdByUserId: USER_A,
      assignedOrganizerUserId: null,
      updatedAt: new Date(NOW.getTime() - 1000) // slightly older
    });
    const theirTrip = makeTrip("theirs", {
      createdByUserId: USER_B,
      assignedOrganizerUserId: null,
      updatedAt: NOW // more recent, but not mine
    });

    const data: RawDashboardData = {
      trips: [myTrip, theirTrip],
      itineraries: [],
      shares: [],
      comments: [],
      reviews: []
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "STAFF",
      view: "staff",
      now: NOW
    });

    if (payload.view !== "staff") throw new Error("wrong view");
    expect(payload.hero?.tripId).toBe("mine");
  });

  it("worklist.myDraftsStuck excludes the unrelated trip's drafts", async () => {
    const staleDate = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const myTrip = makeTrip("mine", {
      createdByUserId: USER_A,
      status: "DRAFT",
      updatedAt: staleDate
    });
    const theirTrip = makeTrip("theirs", {
      createdByUserId: USER_B,
      status: "DRAFT",
      updatedAt: staleDate
    });

    const data: RawDashboardData = {
      trips: [myTrip, theirTrip],
      itineraries: [],
      shares: [],
      comments: [],
      reviews: []
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "STAFF",
      view: "staff",
      now: NOW
    });

    if (payload.view !== "staff") throw new Error("wrong view");
    expect(payload.worklist.myDraftsStuck.map((d) => d.tripId)).toEqual(["mine"]);
  });

  it("pipeline.drafts counts only my trips", async () => {
    const myDraft = makeTrip("mine", { createdByUserId: USER_A, status: "DRAFT" });
    const theirDraft = makeTrip("theirs", { createdByUserId: USER_B, status: "DRAFT" });

    const data: RawDashboardData = {
      trips: [myDraft, theirDraft],
      itineraries: [],
      shares: [],
      comments: [],
      reviews: []
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "STAFF",
      view: "staff",
      now: NOW
    });

    if (payload.view !== "staff") throw new Error("wrong view");
    expect(payload.pipeline.drafts).toBe(1);
  });

  it("hero is null when the user has no trips", async () => {
    const theirTrip = makeTrip("theirs", { createdByUserId: USER_B });

    const data: RawDashboardData = {
      trips: [theirTrip],
      itineraries: [],
      shares: [],
      comments: [],
      reviews: []
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "STAFF",
      view: "staff",
      now: NOW
    });

    if (payload.view !== "staff") throw new Error("wrong view");
    expect(payload.hero).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Period switching changes the window
// ---------------------------------------------------------------------------

describe("getDashboard – period switching changes the window", () => {
  // now = 2026-05-26T12:00:00Z
  // trip "recent" created 5 days ago → inside 7d and 30d and 90d
  // trip "old" created 60 days ago → outside 7d and 30d but inside 90d
  const recent = makeTrip("recent", {
    createdAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
  });
  const old = makeTrip("old", {
    createdAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000)
  });

  const data: RawDashboardData = {
    trips: [recent, old],
    itineraries: [],
    shares: [],
    comments: [],
    reviews: []
  };

  it("period '7d' includes only the recent trip in funnel stage[0]", async () => {
    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      period: "7d",
      now: NOW
    });
    if (payload.view !== "owner") throw new Error("wrong view");
    expect(payload.funnel.stages[0].count).toBe(1); // only "recent"
  });

  it("period '90d' includes both trips in funnel stage[0]", async () => {
    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      period: "90d",
      now: NOW
    });
    if (payload.view !== "owner") throw new Error("wrong view");
    expect(payload.funnel.stages[0].count).toBe(2); // "recent" + "old"
  });

  it("period '30d' includes only the recent trip in funnel stage[0]", async () => {
    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      period: "30d",
      now: NOW
    });
    if (payload.view !== "owner") throw new Error("wrong view");
    expect(payload.funnel.stages[0].count).toBe(1); // "old" is 60 days ago, outside 30d
  });
});

// ---------------------------------------------------------------------------
// 5. Cache behaviour
// ---------------------------------------------------------------------------

describe("getDashboard – cache behaviour", () => {
  it("first call hits the repository", async () => {
    const { svc, repo } = makeService(emptyData());
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    expect(repo.calls).toBe(1);
  });

  it("second call within TTL does NOT hit the repository (cache hit)", async () => {
    const { svc, repo } = makeService(emptyData());
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    expect(repo.calls).toBe(1);
  });

  it("after TTL expiry, repository is called again", async () => {
    const repo = makeFakeRepo(emptyData());
    const shortCache = new TtlCache<DashboardPayload>(50); // 50 ms TTL
    const svc = createDashboardService({ repository: repo, cache: shortCache });

    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    expect(repo.calls).toBe(1);

    // Wait for the cache entry to expire
    await new Promise((r) => setTimeout(r, 60));

    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    expect(repo.calls).toBe(2);
  });

  it("staff view cache is keyed by userId — two different users both trigger repository calls", async () => {
    const repo = makeFakeRepo(emptyData());
    const cache = new TtlCache<DashboardPayload>(60_000);
    const svc = createDashboardService({ repository: repo, cache });

    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "STAFF", view: "staff", now: NOW });
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", view: "staff", now: NOW });
    expect(repo.calls).toBe(2); // different userId keys → two separate repo fetches
  });

  it("owner view cache is shared across users of the same agency+period", async () => {
    const repo = makeFakeRepo(emptyData());
    const cache = new TtlCache<DashboardPayload>(60_000);
    const svc = createDashboardService({ repository: repo, cache });

    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", period: "30d", now: NOW });
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "OWNER", view: "owner", period: "30d", now: NOW });
    expect(repo.calls).toBe(1); // same owner cache key → second is a cache hit
  });
});

// ---------------------------------------------------------------------------
// 6. `now` injection for deterministic results
// ---------------------------------------------------------------------------

describe("getDashboard – now injection", () => {
  it("generatedAt matches the injected now value", async () => {
    const { svc } = makeService(emptyData());
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      now: NOW
    });
    expect(payload.generatedAt).toBe(NOW.toISOString());
  });

  it("period window uses injected now — trip just outside window is excluded", async () => {
    // "now" is 2026-05-26T12:00:00Z. 7d window starts 2026-05-19T12:00:00Z.
    // A trip created at exactly 2026-05-19T12:00:00Z (the boundary start) is INCLUDED.
    // A trip created 1ms before that is EXCLUDED.
    const atBoundary = makeTrip("boundary", {
      createdAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000) // exactly at start
    });
    const justBefore = makeTrip("outside", {
      createdAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1) // 1ms outside
    });

    const data: RawDashboardData = {
      trips: [atBoundary, justBefore],
      itineraries: [],
      shares: [],
      comments: [],
      reviews: []
    };

    const { svc } = makeService(data);
    const payload = await svc.getDashboard({
      agencyId: AGENCY,
      userId: USER_A,
      role: "OWNER",
      view: "owner",
      period: "7d",
      now: NOW
    });

    if (payload.view !== "owner") throw new Error("wrong view");
    // Only the trip exactly at the window boundary should appear
    expect(payload.funnel.stages[0].count).toBe(1);
  });
});
