import { describe, expect, it } from "vitest";
import type { RawDashboardData } from "../src/modules/dashboard/dashboardRepository";
import { TRIP_LIST_LIMIT, selectFunnelCohort, toTripListRows } from "../src/modules/dashboard/tripLists";

const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const WINDOW = { start: at(-30 * DAY), end: NOW };

type Trip = RawDashboardData["trips"][number];
type Share = RawDashboardData["shares"][number];

const trip = (id: string, fields: Partial<Trip> = {}): Trip => ({
  id,
  title: `Trip ${id}`,
  status: "DRAFT",
  createdAt: at(-5 * DAY),
  updatedAt: at(-1 * DAY),
  startDate: null,
  endDate: null,
  travelerCount: null,
  clientName: null,
  createdByUserId: "u1",
  assignedOrganizerUserId: null,
  ...fields
});

const share = (tripId: string | null, viewCount = 0, fields: Partial<Share> = {}): Share => ({
  id: `share-${tripId}-${viewCount}`,
  tripId,
  clientName: null,
  viewCount,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  proposalRatedAt: null,
  createdAt: at(-1 * DAY),
  ...fields
});

const itinerary = (tripId: string | null, id = `it-${tripId}`) => ({ id, tripId, createdAt: NOW });

describe("selectFunnelCohort", () => {
  it("counts trips created in the window by the furthest stage each reached", () => {
    const trips = [
      trip("bare"),
      trip("drafted"),
      trip("shared"),
      trip("viewed", { status: "APPROVED_INTERNAL" }),
      trip("old", { createdAt: at(-60 * DAY) })
    ];
    const cohort = selectFunnelCohort(
      {
        trips,
        itineraries: ["drafted", "shared", "viewed", "old"].map((id) => ({ id: `it-${id}`, tripId: id, createdAt: NOW })),
        // Two links on one trip still count it once.
        shares: [share("shared"), share("shared"), share("viewed", 3), share("old", 9)]
      },
      WINDOW
    );

    const ids = (key: keyof typeof cohort) => cohort[key].map((t) => t.id).sort();
    expect(ids("created")).toEqual(["bare", "drafted", "shared", "viewed"]);
    expect(ids("drafted")).toEqual(["drafted", "shared", "viewed"]);
    expect(ids("sent")).toEqual(["shared", "viewed"]);
    expect(ids("viewed")).toEqual(["viewed"]);
    expect(ids("approved")).toEqual(["viewed"]);
  });

  it("counts a trip once however many itineraries it has", () => {
    const cohort = selectFunnelCohort(
      { trips: [trip("t")], itineraries: [itinerary("t", "it-1"), itinerary("t", "it-2")], shares: [] },
      WINDOW
    );
    expect(cohort.drafted.map((t) => t.id)).toEqual(["t"]);
  });

  it("still counts a revoked link as shared, and its views as viewed", () => {
    const cohort = selectFunnelCohort(
      {
        trips: [trip("t")],
        itineraries: [itinerary("t")],
        shares: [share("t", 2, { revokedAt: at(-1 * DAY) })]
      },
      WINDOW
    );
    expect(cohort.sent.map((t) => t.id)).toEqual(["t"]);
    expect(cohort.viewed.map((t) => t.id)).toEqual(["t"]);
  });

  it("treats a shared trip as drafted even when no itinerary row names the trip", () => {
    // A link always points at an itinerary, but that itinerary's own tripId can
    // be empty. The trip was still drafted, so shared never exceeds drafted.
    const cohort = selectFunnelCohort(
      { trips: [trip("t")], itineraries: [itinerary(null, "it-loose")], shares: [share("t", 1)] },
      WINDOW
    );
    expect(cohort.drafted.map((t) => t.id)).toEqual(["t"]);
    expect(cohort.sent.map((t) => t.id)).toEqual(["t"]);
    expect(cohort.viewed.map((t) => t.id)).toEqual(["t"]);
  });

  it("ignores links and itineraries that belong to no trip", () => {
    const cohort = selectFunnelCohort(
      { trips: [trip("t")], itineraries: [itinerary(null)], shares: [share(null, 4)] },
      WINDOW
    );
    expect(cohort.created).toHaveLength(1);
    expect(cohort.drafted).toEqual([]);
    expect(cohort.sent).toEqual([]);
    expect(cohort.viewed).toEqual([]);
  });

  it("counts approval without a link", () => {
    const cohort = selectFunnelCohort(
      { trips: [trip("t", { status: "APPROVED_INTERNAL" })], itineraries: [], shares: [] },
      WINDOW
    );
    expect(cohort.approved.map((t) => t.id)).toEqual(["t"]);
  });

  it("includes trips created exactly at either end of the window", () => {
    const cohort = selectFunnelCohort(
      {
        trips: [
          trip("at-start", { createdAt: WINDOW.start }),
          trip("at-end", { createdAt: WINDOW.end }),
          trip("before", { createdAt: new Date(WINDOW.start.getTime() - 1) }),
          trip("after", { createdAt: new Date(WINDOW.end.getTime() + 1) })
        ],
        itineraries: [],
        shares: []
      },
      WINDOW
    );
    expect(cohort.created.map((t) => t.id).sort()).toEqual(["at-end", "at-start"]);
  });

  it("never lets a stage hold a trip the stage before it lacks", () => {
    // Every mix of itinerary / link / viewed link for a trip in the window.
    const trips: Trip[] = [];
    const itineraries: RawDashboardData["itineraries"] = [];
    const shares: Share[] = [];
    for (let mask = 0; mask < 8; mask++) {
      const id = `m${mask}`;
      trips.push(trip(id));
      if (mask & 1) itineraries.push(itinerary(id));
      if (mask & 2) shares.push(share(id, mask & 4 ? 5 : 0));
    }
    const cohort = selectFunnelCohort({ trips, itineraries, shares }, WINDOW);
    const chain = [cohort.created, cohort.drafted, cohort.sent, cohort.viewed];
    for (let i = 1; i < chain.length; i++) {
      const before = new Set(chain[i - 1].map((t) => t.id));
      expect(chain[i].every((t) => before.has(t.id))).toBe(true);
    }
    for (const t of cohort.approved) expect(cohort.created).toContain(t);
  });
});

describe("toTripListRows", () => {
  it("lists trips newest first in the chosen order, as rows", () => {
    const rows = toTripListRows(
      [
        trip("a", { createdAt: at(-3 * DAY), updatedAt: at(-1 * DAY), title: "Alpha", clientName: "Ana" }),
        trip("b", { createdAt: at(-1 * DAY), updatedAt: at(-2 * DAY), title: "Beta" })
      ],
      "created"
    );
    expect(rows).toEqual([
      { tripId: "b", tripTitle: "Beta", clientName: null, status: "DRAFT" },
      { tripId: "a", tripTitle: "Alpha", clientName: "Ana", status: "DRAFT" }
    ]);
    expect(toTripListRows([trip("a", { updatedAt: at(-1 * DAY) }), trip("b", { updatedAt: at(-2 * DAY) })], "updated").map((r) => r.tripId)).toEqual(["a", "b"]);
  });

  it("keeps the newest 50 trips, whichever order they arrive in", () => {
    // Oldest first, so cutting the list before sorting it would keep the oldest.
    const pad = (i: number) => String(i).padStart(2, "0");
    const oldestFirst = Array.from({ length: TRIP_LIST_LIMIT + 3 }, (_, i) =>
      trip(`t${pad(i)}`, { createdAt: at(-(TRIP_LIST_LIMIT + 3 - i) * DAY), updatedAt: at(-(i + 1) * DAY) })
    );

    // By creation, t52 is the newest and t00-t02 are cut.
    expect(toTripListRows(oldestFirst, "created").map((row) => row.tripId)).toEqual(
      Array.from({ length: TRIP_LIST_LIMIT }, (_, i) => `t${pad(TRIP_LIST_LIMIT + 2 - i)}`)
    );
    // By last update, t00 is the newest and t51-t52 are cut.
    expect(toTripListRows(oldestFirst, "updated").map((row) => row.tripId)).toEqual(
      Array.from({ length: TRIP_LIST_LIMIT }, (_, i) => `t${pad(i)}`)
    );
  });
});
