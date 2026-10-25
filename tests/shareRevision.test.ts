import { describe, expect, it } from "vitest";
import { buildShareResponse, computeShareRevision } from "../src/modules/shares/publicShareService";

type Stop = Record<string, unknown>;

function stop(id: string, sortOrder: number, title: string, extra: Stop = {}): Stop {
  return {
    id,
    sortOrder,
    type: "ACTIVITY",
    title,
    description: null,
    startTime: "09:00",
    endTime: "10:00",
    clientNotes: null,
    placeSnapshot: null,
    ...extra
  };
}

function content(overrides: { items?: Stop[]; tripStart?: Date | null; version?: number } = {}) {
  return {
    itinerary: {
      id: "it-1",
      title: "Baguio weekend",
      summary: "Cool air and strawberries",
      version: overrides.version ?? 1,
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: new Date("2026-11-02T00:00:00.000Z"),
          title: "Arrival",
          summary: null,
          items: overrides.items ?? [stop("s-1", 0, "Burnham Park"), stop("s-2", 1, "Session Road")]
        },
        { id: "day-2", dayNumber: 2, date: new Date("2026-11-03T00:00:00.000Z"), title: "Highlands", summary: null, items: [] }
      ]
    },
    trip: {
      id: "trip-1",
      title: "Reyes family",
      clientName: "Reyes",
      startDate: overrides.tripStart === undefined ? new Date("2026-11-02T00:00:00.000Z") : overrides.tripStart,
      endDate: new Date("2026-11-03T00:00:00.000Z"),
      travelerCount: 4,
      destinationSummary: "Baguio"
    }
  };
}

const shareRow = {
  id: "share-1",
  token: "token-123456789",
  itineraryId: "it-1",
  tripId: "trip-1",
  agencyId: "agency-1",
  clientName: null,
  clientEmail: null,
  expiresAt: null,
  revokedAt: null,
  viewCount: 3,
  lastViewedAt: null,
  createdAt: new Date("2026-10-20T00:00:00.000Z"),
  updatedAt: new Date("2026-10-20T00:00:00.000Z")
};

describe("computeShareRevision", () => {
  it("returns a short lowercase hex fingerprint", () => {
    expect(computeShareRevision(content())).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives the same revision for the same content", () => {
    expect(computeShareRevision(content())).toBe(computeShareRevision(content()));
  });

  it("changes when a stop title changes", () => {
    const edited = content({ items: [stop("s-1", 0, "Burnham Park lake"), stop("s-2", 1, "Session Road")] });
    expect(computeShareRevision(edited)).not.toBe(computeShareRevision(content()));
  });

  it("changes when a stop time or note changes", () => {
    const retimed = content({ items: [stop("s-1", 0, "Burnham Park", { startTime: "10:00" }), stop("s-2", 1, "Session Road")] });
    const noted = content({ items: [stop("s-1", 0, "Burnham Park", { clientNotes: "Bring a jacket" }), stop("s-2", 1, "Session Road")] });
    expect(computeShareRevision(retimed)).not.toBe(computeShareRevision(content()));
    expect(computeShareRevision(noted)).not.toBe(computeShareRevision(content()));
  });

  it("changes when a stop is added", () => {
    const added = content({ items: [stop("s-1", 0, "Burnham Park"), stop("s-2", 1, "Session Road"), stop("s-3", 2, "Mines View")] });
    expect(computeShareRevision(added)).not.toBe(computeShareRevision(content()));
  });

  it("changes when a stop is removed", () => {
    const removed = content({ items: [stop("s-1", 0, "Burnham Park")] });
    expect(computeShareRevision(removed)).not.toBe(computeShareRevision(content()));
  });

  it("changes when stops are reordered within a day", () => {
    const swapped = content({ items: [stop("s-2", 0, "Session Road"), stop("s-1", 1, "Burnham Park")] });
    expect(computeShareRevision(swapped)).not.toBe(computeShareRevision(content()));
  });

  it("changes when a stop moves to another day", () => {
    const base = content();
    const moved = content();
    const days = moved.itinerary.days as Array<{ items: Stop[] }>;
    days[1]!.items = [days[0]!.items.pop()!];
    expect(computeShareRevision(moved)).not.toBe(computeShareRevision(base));
  });

  it("changes when the trip dates change", () => {
    const shifted = content({ tripStart: new Date("2026-11-09T00:00:00.000Z") });
    expect(computeShareRevision(shifted)).not.toBe(computeShareRevision(content()));
    expect(computeShareRevision(content({ tripStart: null }))).not.toBe(computeShareRevision(content()));
  });

  it("changes when the trip is missing", () => {
    expect(computeShareRevision({ ...content(), trip: null })).not.toBe(computeShareRevision(content()));
  });

  it("ignores object key order, including nested keys", () => {
    const base = content();
    const reordered = {
      trip: Object.fromEntries(Object.entries(base.trip).reverse()),
      itinerary: {
        days: base.itinerary.days.map((day) => ({
          items: day.items.map((item) => Object.fromEntries(Object.entries(item).reverse())),
          ...Object.fromEntries(Object.entries(day).filter(([key]) => key !== "items").reverse())
        })),
        ...Object.fromEntries(Object.entries(base.itinerary).filter(([key]) => key !== "days").reverse())
      }
    };
    expect(computeShareRevision(reordered)).toBe(computeShareRevision(base));
  });

  it("treats a Date and its ISO string alike, as the JSON response does", () => {
    const withStrings = JSON.parse(JSON.stringify(content()));
    expect(computeShareRevision(withStrings)).toBe(computeShareRevision(content()));
  });

  it("does not move when only the itinerary version counter moves", () => {
    expect(computeShareRevision(content({ version: 9 }))).toBe(computeShareRevision(content({ version: 1 })));
  });

  describe("place details", () => {
    const place = {
      id: "p-1",
      provider: "GOOGLE_PLACES",
      providerPlaceId: "g-1",
      name: "Burnham Park",
      formattedAddress: "Baguio",
      latitude: 16.41,
      longitude: 120.59,
      rating: 4.5,
      websiteUrl: null,
      phoneNumber: null,
      metadata: { openNow: true },
      businessStatus: "OPERATIONAL",
      businessStatusCheckedAt: new Date("2026-10-01T00:00:00.000Z")
    };
    const withPlace = (placeSnapshot: Record<string, unknown>) =>
      content({ items: [stop("s-1", 0, "Burnham Park", { placeSnapshot }), stop("s-2", 1, "Session Road")] });

    it("does not move when a background refresh re-checks a place without changing its status", () => {
      const refreshed = { ...place, rating: 4.6, metadata: { openNow: false }, businessStatusCheckedAt: new Date("2026-10-20T00:00:00.000Z") };
      expect(computeShareRevision(withPlace(refreshed))).toBe(computeShareRevision(withPlace(place)));
    });

    it("moves when the saved place or its closed status changes", () => {
      const closed = { ...place, businessStatus: "CLOSED_PERMANENTLY" };
      const otherPlace = { ...place, id: "p-2", providerPlaceId: "g-2", name: "Wright Park" };
      expect(computeShareRevision(withPlace(closed))).not.toBe(computeShareRevision(withPlace(place)));
      expect(computeShareRevision(withPlace(otherPlace))).not.toBe(computeShareRevision(withPlace(place)));
    });
  });

  describe("on a built share response", () => {
    const build = (share: Record<string, unknown>, parts = content()) =>
      buildShareResponse({
        share: { ...shareRow, ...share } as never,
        agency: { id: "agency-1", name: "Wanderlust", logoImage: null },
        itinerary: parts.itinerary,
        trip: parts.trip,
        creator: { id: "u-1", displayName: "Alice" }
      });

    it("does not move for a page view, an Extend, or a revoke-state change", () => {
      const before = computeShareRevision(build({}));
      const viewed = build({ viewCount: 40, lastViewedAt: new Date("2026-10-21T08:00:00.000Z") });
      const extended = build({ expiresAt: new Date("2026-12-01T00:00:00.000Z"), updatedAt: new Date("2026-10-21T09:00:00.000Z") });
      const revoked = build({ revokedAt: new Date("2026-10-21T10:00:00.000Z") });
      expect(computeShareRevision(viewed)).toBe(before);
      expect(computeShareRevision(extended)).toBe(before);
      expect(computeShareRevision(revoked)).toBe(before);
    });

    it("does not move for a share rating or client details", () => {
      const before = computeShareRevision(build({}));
      expect(computeShareRevision(build({ rating: 5, clientName: "Maria", clientEmail: "m@example.com" }))).toBe(before);
    });

    it("moves when the itinerary behind the share is edited", () => {
      const before = computeShareRevision(build({}));
      const edited = content({ items: [stop("s-1", 0, "Burnham Park"), stop("s-2", 1, "Strawberry Farm")] });
      expect(computeShareRevision(build({}, edited))).not.toBe(before);
    });
  });
});
