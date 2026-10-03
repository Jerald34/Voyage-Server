import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  CALENDAR_MAX_DAYS,
  buildCalendar,
  calendarWindow,
  type CalendarTripRef,
  type RawCalendarData
} from "../src/modules/dashboard/calendar";
import { calendarPayloadSchema } from "../src/modules/dashboard/dashboardSchemas";

describe("calendarWindow", () => {
  it("pads the requested local dates to cover every timezone", () => {
    const window = calendarWindow("2026-09-27", "2026-11-07");
    expect(window.from).toBe("2026-09-27");
    expect(window.to).toBe("2026-11-07");
    expect(window.fromDayStart.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(window.toDayStart.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.toDayEnd.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(window.fromInstant.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(window.toInstant.toISOString()).toBe("2026-11-08T13:59:59.999Z");
  });

  it("ends the day window at the start of the next UTC day, across month and year ends", () => {
    expect(calendarWindow("2026-12-01", "2026-12-31").toDayEnd.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(calendarWindow("2026-10-03", "2026-10-03").toDayEnd.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("allows a single day", () => {
    expect(() => calendarWindow("2026-10-03", "2026-10-03")).not.toThrow();
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => calendarWindow("2026-10-08", "2026-10-01")).toThrow(ApiError);
  });

  it(`allows ${CALENDAR_MAX_DAYS} days and rejects more`, () => {
    expect(() => calendarWindow("2026-09-27", "2026-11-07")).not.toThrow();
    try {
      calendarWindow("2026-09-27", "2026-11-08");
      expect.unreachable("a 43-day range should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(400);
      expect((error as ApiError).code).toBe("CALENDAR_RANGE_INVALID");
    }
  });
});

const NOW = new Date("2026-10-03T04:00:00.000Z");
const WINDOW = calendarWindow("2026-09-27", "2026-11-07");
const OWNER = "user-owner";
const STAFF = "user-staff";

function emptyRaw(): RawCalendarData {
  return { trips: [], undatedTrips: [], shares: [], comments: [], reviews: [] };
}

function tripRef(id: string, overrides: Partial<CalendarTripRef> = {}): CalendarTripRef {
  return {
    id,
    title: `Trip ${id}`,
    clientName: `Client ${id}`,
    createdByUserId: OWNER,
    assignedOrganizerUserId: null,
    ...overrides
  };
}

function datedTrip(
  id: string,
  startDate: string | null,
  endDate: string | null,
  overrides: Partial<RawCalendarData["trips"][number]> = {}
): RawCalendarData["trips"][number] {
  return {
    ...tripRef(id),
    destinationSummary: null,
    startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : null,
    endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
    status: "IN_REVIEW",
    travelerCount: 2,
    ...overrides
  };
}

function build(raw: RawCalendarData, role: "OWNER" | "ADMIN" | "STAFF" = "OWNER", userId = OWNER) {
  return buildCalendar(raw, { role, userId, window: WINDOW, now: NOW });
}

describe("buildCalendar trip spans", () => {
  it("keeps trips that overlap the window at either edge, sorted by start", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("after-overlap", "2026-11-07", "2026-11-12"),
      datedTrip("before-overlap", "2026-09-20", "2026-09-27"),
      datedTrip("ends-before", "2026-09-10", "2026-09-26"),
      datedTrip("starts-after", "2026-11-08", "2026-11-10")
    ];
    expect(build(raw).trips.map((trip) => trip.tripId)).toEqual(["before-overlap", "after-overlap"]);
  });

  it("serialises trip dates as calendar dates", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("kyoto", "2026-10-08", "2026-10-14", { destinationSummary: "Kyoto" })];
    expect(build(raw).trips).toEqual([
      {
        tripId: "kyoto",
        tripTitle: "Trip kyoto",
        clientName: "Client kyoto",
        placeLabel: "Kyoto",
        startDate: "2026-10-08",
        endDate: "2026-10-14",
        status: "IN_REVIEW",
        travelerCount: 2
      }
    ]);
  });

  it("treats a trip without an end date as a single day", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("day", "2026-10-10", null)];
    expect(build(raw).trips[0]).toMatchObject({ startDate: "2026-10-10", endDate: "2026-10-10" });
  });

  it("treats an end date before the start date as a single day on the start date", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("odd", "2026-10-10", "2026-10-05")];
    expect(build(raw).trips[0]).toMatchObject({ startDate: "2026-10-10", endDate: "2026-10-10" });
  });

  it("leaves out archived trips and trips without a start date", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("archived", "2026-10-10", "2026-10-12", { status: "ARCHIVED" }),
      datedTrip("undated", null, null)
    ];
    expect(build(raw).trips).toEqual([]);
  });

  it("labels each trip with its destination, falling back to the title", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("a", "2026-10-08", "2026-10-14", { destinationSummary: "  Kyoto  " }),
      datedTrip("b", "2026-10-20", "2026-10-25", { destinationSummary: "   " })
    ];
    expect(build(raw).trips.map((trip) => trip.placeLabel)).toEqual(["Kyoto", "Trip b"]);
  });
});

describe("buildCalendar staff scoping", () => {
  it("shows staff only the trips they created or organize", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("mine", "2026-10-08", "2026-10-09", { createdByUserId: STAFF }),
      datedTrip("assigned", "2026-10-10", "2026-10-11", { assignedOrganizerUserId: STAFF }),
      datedTrip("other", "2026-10-12", "2026-10-13")
    ];
    expect(build(raw, "STAFF", STAFF).trips.map((trip) => trip.tripId)).toEqual(["mine", "assigned"]);
    expect(build(raw, "ADMIN", OWNER).trips).toHaveLength(3);
  });

  it("counts undated trips in scope", () => {
    const raw = emptyRaw();
    raw.undatedTrips = [
      { createdByUserId: STAFF, assignedOrganizerUserId: null },
      { createdByUserId: OWNER, assignedOrganizerUserId: null }
    ];
    expect(build(raw, "STAFF", STAFF).tripsWithoutDates).toBe(1);
    expect(build(raw).tripsWithoutDates).toBe(2);
  });

  it("stamps the payload with the window and the time it was built", () => {
    const payload = build(emptyRaw());
    expect(payload).toMatchObject({
      from: "2026-09-27",
      to: "2026-11-07",
      generatedAt: "2026-10-03T04:00:00.000Z",
      trips: [],
      events: []
    });
  });
});

describe("buildCalendar events", () => {
  const lisbon = tripRef("t1", { title: "Lisbon Getaway", clientName: "Tanaka" });

  function share(overrides: Partial<RawCalendarData["shares"][number]> = {}): RawCalendarData["shares"][number] {
    return {
      id: "s1",
      clientName: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"), // before the window
      expiresAt: null,
      revokedAt: null,
      lastViewedAt: null,
      viewCount: 0,
      proposalRating: null,
      proposalRatedAt: null,
      trip: lisbon,
      ...overrides
    };
  }

  function expected(kind: string, occurredAt: string, detail: Record<string, unknown> = {}) {
    return {
      id: `${kind}:s1`,
      kind,
      tripId: "t1",
      tripTitle: "Lisbon Getaway",
      clientName: "Tanaka",
      occurredAt,
      detail
    };
  }

  it("turns share timestamps inside the window into events, in time order", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        expiresAt: new Date("2026-10-05T09:00:00.000Z"),
        lastViewedAt: new Date("2026-10-03T02:00:00.000Z"),
        viewCount: 4,
        proposalRating: 5,
        proposalRatedAt: new Date("2026-10-02T08:00:00.000Z")
      })
    ];
    expect(build(raw).events).toEqual([
      expected("share_sent", "2026-09-28T09:00:00.000Z"),
      expected("proposal_rated", "2026-10-02T08:00:00.000Z", { rating: 5 }),
      expected("client_viewed", "2026-10-03T02:00:00.000Z", { viewCount: 4 }),
      expected("share_expires", "2026-10-05T09:00:00.000Z")
    ]);
  });

  it("names the client the link was shared with", () => {
    const raw = emptyRaw();
    raw.shares = [share({ clientName: "Ken Tanaka", createdAt: new Date("2026-09-28T09:00:00.000Z") })];
    expect(build(raw).events[0].clientName).toBe("Ken Tanaka");
  });

  it("skips the expiry of a revoked link", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({ expiresAt: new Date("2026-10-05T09:00:00.000Z"), revokedAt: new Date("2026-10-01T00:00:00.000Z") })
    ];
    expect(build(raw).events).toEqual([]);
  });

  it("skips shares that are not linked to a trip", () => {
    const raw = emptyRaw();
    raw.shares = [share({ trip: null, createdAt: new Date("2026-09-28T09:00:00.000Z") })];
    expect(build(raw).events).toEqual([]);
  });

  it("adds client comments with a short excerpt", () => {
    const raw = emptyRaw();
    raw.comments = [
      {
        id: "c1",
        content: `Can we swap the day 2 lunch spot? ${"x".repeat(100)}`,
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: lisbon }
      }
    ];
    const [event] = build(raw).events;
    expect(event).toMatchObject({ id: "client_commented:c1", kind: "client_commented", clientName: "Tanaka" });
    expect(event.detail.excerpt).toHaveLength(80);
    expect(event.detail.excerpt?.startsWith("Can we swap the day 2 lunch spot?")).toBe(true);
    expect(event.detail.excerpt?.endsWith("…")).toBe(true);
  });

  it("never splits an emoji when it cuts the excerpt", () => {
    const raw = emptyRaw();
    const comment = (id: string, content: string) => ({
      id,
      content,
      authorName: "Ken",
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      share: { clientName: null, trip: lisbon }
    });
    // The emoji is the 79th character, so a cut after 79 UTF-16 units lands inside it.
    raw.comments = [
      comment("straddle", `${"a".repeat(78)}😀${"b".repeat(20)}`),
      // 60 emoji are 60 characters (120 UTF-16 units), so they fit without a cut.
      comment("fits", "😀".repeat(60))
    ];
    const events = build(raw).events;
    const straddle = events.find((event) => event.id === "client_commented:straddle")!;
    const fits = events.find((event) => event.id === "client_commented:fits")!;

    expect(straddle.detail.excerpt).toBe(`${"a".repeat(78)}😀…`);
    expect(Array.from(straddle.detail.excerpt!)).toHaveLength(80);
    expect(straddle.detail.excerpt!.isWellFormed()).toBe(true);
    expect(fits.detail.excerpt).toBe("😀".repeat(60));
  });

  it("falls back to the comment author when the trip has no client name", () => {
    const raw = emptyRaw();
    raw.comments = [
      {
        id: "c2",
        content: "Looks great",
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: tripRef("t9", { clientName: null }) }
      }
    ];
    expect(build(raw).events[0]).toMatchObject({ clientName: "Ken", detail: { excerpt: "Looks great" } });
  });

  it("adds submitted reviews with their rating", () => {
    const raw = emptyRaw();
    raw.reviews = [
      {
        id: "r1",
        rating: 5,
        reviewText: "Seamless trip, every detail handled.",
        respondentName: "Maria Cruz",
        submittedAt: new Date("2026-09-30T12:00:00.000Z"),
        trip: tripRef("t2", { title: "Bali Honeymoon", clientName: null })
      }
    ];
    expect(build(raw).events).toEqual([
      {
        id: "review_submitted:r1",
        kind: "review_submitted",
        tripId: "t2",
        tripTitle: "Bali Honeymoon",
        clientName: "Maria Cruz",
        occurredAt: "2026-09-30T12:00:00.000Z",
        detail: { rating: 5, excerpt: "Seamless trip, every detail handled." }
      }
    ]);
  });

  it("keeps events that could fall on the first day in any timezone", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({ id: "edge", createdAt: new Date("2026-09-26T10:00:00.000Z") }),
      share({ id: "early", createdAt: new Date("2026-09-26T09:59:59.999Z") })
    ];
    expect(build(raw).events.map((event) => event.id)).toEqual(["share_sent:edge"]);
  });

  it("leaves out events on other people's trips for staff", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        trip: tripRef("theirs", { createdByUserId: "someone-else" })
      })
    ];
    expect(build(raw, "STAFF", STAFF).events).toEqual([]);
    expect(build(raw, "OWNER", OWNER).events).toHaveLength(1);
  });

  it("produces a payload the response schema accepts", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("kyoto", "2026-10-08", "2026-10-14")];
    raw.undatedTrips = [{ createdByUserId: OWNER, assignedOrganizerUserId: null }];
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        lastViewedAt: new Date("2026-10-03T02:00:00.000Z"),
        viewCount: 2
      })
    ];
    raw.comments = [
      {
        id: "c1",
        content: "Hi",
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: lisbon }
      }
    ];
    expect(calendarPayloadSchema.safeParse(build(raw)).success).toBe(true);
  });
});
