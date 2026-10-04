import { describe, expect, it } from "vitest";
import {
  computeFunnelStages,
  computeMedianResponseTime,
  computeWinRate,
  computeWinRatePct,
  periodToDays,
  periodWindow,
  priorPeriodWindow,
  selectOwnerWorklistRows,
  selectRecentViews,
  selectStaffWorklistRows
} from "../src/modules/dashboard/aggregations";

describe("computeWinRate", () => {
  it("returns 0 when there are no trips", () => {
    expect(computeWinRate([])).toBe(0);
  });

  it("returns 0 when no trips are closed (no signal)", () => {
    expect(computeWinRate([{ status: "DRAFT" }, { status: "IN_REVIEW" }])).toBe(0);
  });

  it("computes approved / (approved + archived)", () => {
    expect(
      computeWinRate([
        { status: "APPROVED_INTERNAL" },
        { status: "APPROVED_INTERNAL" },
        { status: "ARCHIVED" },
        { status: "DRAFT" } // ignored
      ])
    ).toBeCloseTo(2 / 3, 6);
  });

  it("returns 1.0 when every closed trip approved", () => {
    expect(computeWinRate([{ status: "APPROVED_INTERNAL" }])).toBe(1);
  });
});

describe("computeWinRatePct", () => {
  it("returns null when no trips are closed (no signal, not 0%)", () => {
    expect(computeWinRatePct([{ status: "DRAFT" }, { status: "IN_REVIEW" }])).toBeNull();
  });

  it("returns approved / closed as a percentage", () => {
    expect(
      computeWinRatePct([
        { status: "APPROVED_INTERNAL" },
        { status: "APPROVED_INTERNAL" },
        { status: "ARCHIVED" }
      ])
    ).toBeCloseTo(66.667, 2);
  });

  it("returns 100 when every closed trip was approved", () => {
    expect(computeWinRatePct([{ status: "APPROVED_INTERNAL" }])).toBe(100);
  });
});

describe("computeMedianResponseTime", () => {
  it("returns null when no comments have replies", () => {
    expect(
      computeMedianResponseTime([{ createdAt: new Date(0), agencyRepliedAt: null }])
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(computeMedianResponseTime([])).toBeNull();
  });

  it("returns the single value when one comment is replied", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const replied = new Date("2026-01-01T02:00:00Z");
    expect(computeMedianResponseTime([{ createdAt: created, agencyRepliedAt: replied }])).toBe(2);
  });

  it("averages the middle two for an even-length list", () => {
    const c = (h: number) => new Date(2026, 0, 1, h);
    expect(
      computeMedianResponseTime([
        { createdAt: c(0), agencyRepliedAt: c(1) }, // 1h
        { createdAt: c(0), agencyRepliedAt: c(3) }, // 3h
        { createdAt: c(0), agencyRepliedAt: c(5) }, // 5h
        { createdAt: c(0), agencyRepliedAt: c(7) }  // 7h
      ])
    ).toBe(4); // (3 + 5) / 2
  });

  it("returns the middle for an odd-length list", () => {
    const c = (h: number) => new Date(2026, 0, 1, h);
    expect(
      computeMedianResponseTime([
        { createdAt: c(0), agencyRepliedAt: c(1) },
        { createdAt: c(0), agencyRepliedAt: c(3) },
        { createdAt: c(0), agencyRepliedAt: c(8) }
      ])
    ).toBe(3);
  });
});

describe("computeFunnelStages", () => {
  it("produces five stages in spec order", () => {
    const stages = computeFunnelStages({ created: 10, drafted: 8, sent: 6, viewed: 4, approved: 2 });
    expect(stages.map((s) => s.key)).toEqual(["created", "drafted", "sent", "viewed", "approved"]);
  });

  it("returns null dropOff for the first stage", () => {
    const stages = computeFunnelStages({ created: 10, drafted: 8, sent: 6, viewed: 4, approved: 2 });
    expect(stages[0].dropOffPct).toBeNull();
  });

  it("computes drop-off percent between stages", () => {
    const stages = computeFunnelStages({ created: 10, drafted: 8, sent: 6, viewed: 4, approved: 2 });
    expect(stages[1].dropOffPct).toBeCloseTo(20, 5);   // 10 → 8 = 20%
    expect(stages[2].dropOffPct).toBeCloseTo(25, 5);   // 8 → 6 = 25%
    expect(stages[3].dropOffPct).toBeCloseTo(33.333, 2); // 6 → 4
    expect(stages[4].dropOffPct).toBeCloseTo(50, 5);
  });

  it("returns null drop-off when the prior stage was zero", () => {
    const stages = computeFunnelStages({ created: 0, drafted: 0, sent: 0, viewed: 0, approved: 0 });
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].dropOffPct).toBeNull();
    }
  });
});

describe("periodWindow", () => {
  it("maps period to day count", () => {
    expect(periodToDays("7d")).toBe(7);
    expect(periodToDays("30d")).toBe(30);
    expect(periodToDays("90d")).toBe(90);
  });

  it("computes a window ending at `now`", () => {
    const now = new Date("2026-05-26T12:00:00Z");
    const w = periodWindow("7d", now);
    expect(w.end.getTime()).toBe(now.getTime());
    expect(w.start.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  });

  it("priorPeriodWindow shifts back by the period length", () => {
    const now = new Date("2026-05-26T12:00:00Z");
    const prior = priorPeriodWindow("30d", now);
    expect(prior.end.getTime()).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(prior.start.getTime()).toBe(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  });
});

// ---------- Worklist selectors ----------

const NOW = new Date("2026-05-26T12:00:00Z");

function trip(overrides: Partial<Parameters<typeof selectOwnerWorklistRows>[0]["trips"][number]> = {}) {
  return {
    id: "t1",
    title: "Sample trip",
    status: "DRAFT" as const,
    updatedAt: NOW,
    createdByUserId: "u1",
    assignedOrganizerUserId: null,
    startDate: null,
    endDate: null,
    travelerCount: null,
    clientName: null,
    ...overrides
  };
}

function share(overrides: Partial<Parameters<typeof selectOwnerWorklistRows>[0]["shares"][number]> = {}) {
  return {
    id: "s1",
    tripId: "t1",
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

function comment(overrides: Partial<Parameters<typeof selectOwnerWorklistRows>[0]["comments"][number]> = {}) {
  return {
    id: "c1",
    shareId: "s1",
    content: "Looks great",
    status: "PENDING" as const,
    agencyRepliedAt: null,
    createdAt: NOW,
    ...overrides
  };
}

describe("selectOwnerWorklistRows", () => {
  it("returns empty groups for empty inputs", () => {
    const r = selectOwnerWorklistRows({ trips: [], shares: [], comments: [], now: NOW });
    expect(r.unreadComments).toHaveLength(0);
    expect(r.viewedNotReplied).toHaveLength(0);
    expect(r.draftsStuck).toHaveLength(0);
    expect(r.sharesExpiring).toHaveLength(0);
    expect(r.lowRated).toHaveLength(0);
  });

  it("flags drafts stuck > 7 days", () => {
    const stale = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const r = selectOwnerWorklistRows({
      trips: [trip({ id: "t1", status: "DRAFT", updatedAt: stale })],
      shares: [],
      comments: [],
      now: NOW
    });
    expect(r.draftsStuck).toHaveLength(1);
    expect(r.draftsStuck[0].tripId).toBe("t1");
  });

  it("ignores drafts updated within 7 days", () => {
    const fresh = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    const r = selectOwnerWorklistRows({
      trips: [trip({ id: "t1", status: "DRAFT", updatedAt: fresh })],
      shares: [],
      comments: [],
      now: NOW
    });
    expect(r.draftsStuck).toHaveLength(0);
  });

  it("returns low-rated shares (rating ≤ 3) within 14 days with no follow-up", () => {
    const rated = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const r = selectOwnerWorklistRows({
      trips: [trip({ id: "t1" })],
      shares: [
        share({ id: "s1", tripId: "t1", proposalRating: 2, proposalRatedAt: rated })
      ],
      comments: [],
      now: NOW
    });
    expect(r.lowRated).toHaveLength(1);
    expect(r.lowRated[0].rating).toBe(2);
  });

  it("filters expiring shares strictly inside the 48h window", () => {
    const inWindow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000); // 24h
    const tooFar = new Date(NOW.getTime() + 72 * 60 * 60 * 1000);   // 72h
    const r = selectOwnerWorklistRows({
      trips: [trip({ id: "t1" })],
      shares: [
        share({ id: "s1", tripId: "t1", expiresAt: inWindow }),
        share({ id: "s2", tripId: "t1", expiresAt: tooFar })
      ],
      comments: [],
      now: NOW
    });
    expect(r.sharesExpiring.map((s) => s.shareId)).toEqual(["s1"]);
  });
});

describe("selectStaffWorklistRows", () => {
  it("scopes to trips owned by the requesting user", () => {
    const oldDate = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    const r = selectStaffWorklistRows({
      trips: [
        trip({ id: "mine", status: "DRAFT", updatedAt: oldDate, createdByUserId: "me" }),
        trip({ id: "theirs", status: "DRAFT", updatedAt: oldDate, createdByUserId: "someoneElse" })
      ],
      shares: [],
      comments: [],
      now: NOW,
      userId: "me"
    });
    expect(r.myDraftsStuck.map((d) => d.tripId)).toEqual(["mine"]);
  });

  it("uses a tighter 3-day draft-stuck threshold", () => {
    const fourDays = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000);
    const twoDays = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const r = selectStaffWorklistRows({
      trips: [
        trip({ id: "stale", status: "DRAFT", updatedAt: fourDays, createdByUserId: "me" }),
        trip({ id: "fresh", status: "DRAFT", updatedAt: twoDays, createdByUserId: "me" })
      ],
      shares: [],
      comments: [],
      now: NOW,
      userId: "me"
    });
    expect(r.myDraftsStuck.map((d) => d.tripId)).toEqual(["stale"]);
  });

  it("starting-soon includes APPROVED_INTERNAL trips within 7 days", () => {
    const in3Days = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in10Days = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
    const r = selectStaffWorklistRows({
      trips: [
        trip({ id: "soon", status: "APPROVED_INTERNAL", startDate: in3Days, createdByUserId: "me" }),
        trip({ id: "later", status: "APPROVED_INTERNAL", startDate: in10Days, createdByUserId: "me" })
      ],
      shares: [],
      comments: [],
      now: NOW,
      userId: "me"
    });
    expect(r.startingSoon.map((s) => s.tripId)).toEqual(["soon"]);
  });
});

describe("selectRecentViews", () => {
  const viewed = (id: string, overrides: Parameters<typeof trip>[0] = {}) => trip({ id, title: `Trip ${id}`, ...overrides });
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  it("sums views over a trip's links, revoked ones included, and keeps the latest view", () => {
    const rows = selectRecentViews({
      trips: [viewed("t1", { clientName: "Santos" })],
      shares: [
        share({ id: "s1", tripId: "t1", viewCount: 3, lastViewedAt: daysAgo(4) }),
        share({ id: "s2", tripId: "t1", viewCount: 2, lastViewedAt: daysAgo(1), revokedAt: daysAgo(0.5) }),
        share({ id: "s3", tripId: "t1", viewCount: 0, lastViewedAt: null })
      ],
      now: NOW
    });

    expect(rows).toEqual([
      { tripId: "t1", tripTitle: "Trip t1", clientName: "Santos", viewCount: 5, lastViewedAt: daysAgo(1).toISOString() }
    ]);
  });

  it("names the client on the most recently viewed link, else the trip's client", () => {
    const rows = selectRecentViews({
      trips: [viewed("t1", { clientName: "Santos" }), viewed("t2", { clientName: "Lim" })],
      shares: [
        { ...share({ id: "s1", tripId: "t1", viewCount: 1, lastViewedAt: daysAgo(3) }), clientName: "Old Contact" },
        { ...share({ id: "s2", tripId: "t1", viewCount: 1, lastViewedAt: daysAgo(1) }), clientName: "Maria Santos" },
        { ...share({ id: "s3", tripId: "t2", viewCount: 1, lastViewedAt: daysAgo(2) }), clientName: null }
      ],
      now: NOW
    });

    expect(rows.map((row) => [row.tripId, row.clientName])).toEqual([
      ["t1", "Maria Santos"],
      ["t2", "Lim"]
    ]);
  });

  it("on tied view times, prefers the link that names its client, whichever comes first", () => {
    const tied = daysAgo(2);
    const named = (id: string, tripId: string, clientName: string | null) => ({
      ...share({ id, tripId, viewCount: 1, lastViewedAt: tied }),
      clientName
    });
    const rows = selectRecentViews({
      trips: [viewed("t1", { clientName: "Santos" }), viewed("t2", { clientName: "Lim" }), viewed("t3", { clientName: "Ong" })],
      shares: [
        named("s1", "t1", null),
        named("s2", "t1", "Maria Santos"),
        named("s3", "t2", "Lee Lim"),
        named("s4", "t2", null),
        named("s5", "t3", "First Contact"),
        named("s6", "t3", "Second Contact")
      ],
      now: NOW
    });

    expect(Object.fromEntries(rows.map((row) => [row.tripId, row.clientName]))).toEqual({
      t1: "Maria Santos", // the null link came first, but the named one wins the tie
      t2: "Lee Lim", // the named link came first and keeps it
      t3: "First Contact" // both named: the first stays
    });
  });

  it("orders trips with the same last view by trip id, not by the order the links arrive", () => {
    const tied = daysAgo(2);
    const rows = selectRecentViews({
      trips: [viewed("t-b"), viewed("t-c"), viewed("t-a")],
      shares: [
        share({ id: "s1", tripId: "t-c", viewCount: 1, lastViewedAt: tied }),
        share({ id: "s2", tripId: "t-a", viewCount: 1, lastViewedAt: tied }),
        share({ id: "s3", tripId: "t-b", viewCount: 1, lastViewedAt: tied })
      ],
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["t-a", "t-b", "t-c"]);
  });

  it("draws the line at 30 days", () => {
    const rows = selectRecentViews({
      trips: [viewed("in"), viewed("out")],
      shares: [
        share({ id: "s-in", tripId: "in", viewCount: 1, lastViewedAt: daysAgo(29) }),
        share({ id: "s-out", tripId: "out", viewCount: 1, lastViewedAt: daysAgo(31) })
      ],
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["in"]);
  });

  it("lists at most five trips, newest view first", () => {
    const ages: Record<string, number> = { t1: 1, t2: 9, t3: 29, t4: 5, t5: 2, t6: 10, t7: 3 };
    const ids = Object.keys(ages);
    const rows = selectRecentViews({
      trips: ids.map((id) => viewed(id)),
      shares: ids.map((id) => share({ id: `s-${id}`, tripId: id, viewCount: 1, lastViewedAt: daysAgo(ages[id]) })),
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["t1", "t5", "t7", "t4", "t2"]);
  });

  it("leaves out archived trips, links without a trip and trips nobody viewed", () => {
    const rows = selectRecentViews({
      trips: [viewed("archived", { status: "ARCHIVED" }), viewed("unviewed"), viewed("viewed")],
      shares: [
        share({ id: "s1", tripId: "archived", viewCount: 2, lastViewedAt: daysAgo(1) }),
        share({ id: "s2", tripId: null, viewCount: 2, lastViewedAt: daysAgo(1) }),
        share({ id: "s3", tripId: "unviewed", viewCount: 0, lastViewedAt: null }),
        share({ id: "s4", tripId: "viewed", viewCount: 1, lastViewedAt: daysAgo(2) })
      ],
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["viewed"]);
  });

  it("shows a staff member only the trips they created or organize", () => {
    const rows = selectRecentViews({
      trips: [
        viewed("mine", { createdByUserId: "u-staff" }),
        viewed("organized", { createdByUserId: "u-other", assignedOrganizerUserId: "u-staff" }),
        viewed("theirs", { createdByUserId: "u-other" })
      ],
      shares: [
        share({ id: "s1", tripId: "mine", viewCount: 1, lastViewedAt: daysAgo(1) }),
        share({ id: "s2", tripId: "organized", viewCount: 1, lastViewedAt: daysAgo(2) }),
        share({ id: "s3", tripId: "theirs", viewCount: 1, lastViewedAt: daysAgo(3) })
      ],
      now: NOW,
      userId: "u-staff"
    });

    expect(rows.map((row) => row.tripId)).toEqual(["mine", "organized"]);
  });
});
