import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  CALENDAR_MAX_DAYS,
  buildCalendar,
  calendarWindow,
  type CalendarTripRef,
  type RawCalendarData
} from "../src/modules/dashboard/calendar";

describe("calendarWindow", () => {
  it("pads the requested local dates to cover every timezone", () => {
    const window = calendarWindow("2026-09-27", "2026-11-07");
    expect(window.from).toBe("2026-09-27");
    expect(window.to).toBe("2026-11-07");
    expect(window.fromDayStart.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(window.toDayStart.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.fromInstant.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(window.toInstant.toISOString()).toBe("2026-11-08T13:59:59.999Z");
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
