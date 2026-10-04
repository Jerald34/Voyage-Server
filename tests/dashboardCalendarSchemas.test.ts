import { describe, expect, it } from "vitest";
import { calendarPayloadSchema, calendarQuerySchema } from "../src/modules/dashboard/dashboardSchemas";

const trip = {
  tripId: "t1",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Reyes",
  placeLabel: "Kyoto",
  startDate: "2026-10-08",
  endDate: "2026-10-14",
  status: "APPROVED_INTERNAL",
  travelerCount: 2
};

const event = {
  id: "client_viewed:s1",
  kind: "client_viewed",
  tripId: "t1",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Reyes",
  occurredAt: "2026-10-03T02:00:00.000Z",
  detail: { viewCount: 4 }
};

const payload = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T04:00:00.000Z",
  tripsWithoutDates: 1,
  trips: [trip],
  events: [event]
};

describe("calendarPayloadSchema", () => {
  it("accepts trips and events", () => {
    expect(calendarPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an event kind the calendar does not know", () => {
    const parsed = calendarPayloadSchema.safeParse({ ...payload, events: [{ ...event, kind: "itinerary_approved" }] });
    expect(parsed.success).toBe(false);
  });

  it("rejects archived trips", () => {
    const parsed = calendarPayloadSchema.safeParse({ ...payload, trips: [{ ...trip, status: "ARCHIVED" }] });
    expect(parsed.success).toBe(false);
  });

  it("keeps needsReply on a comment event and rejects a non-boolean", () => {
    const comment = {
      ...event,
      id: "client_commented:c1",
      kind: "client_commented",
      detail: { excerpt: "Can we swap lunch?", needsReply: true }
    };
    const parsed = calendarPayloadSchema.parse({ ...payload, events: [comment] });
    expect(parsed.events[0].detail.needsReply).toBe(true);

    const notBoolean = { ...comment, detail: { excerpt: "Can we swap lunch?", needsReply: "yes" } };
    expect(calendarPayloadSchema.safeParse({ ...payload, events: [notBoolean] }).success).toBe(false);
  });
});

describe("calendarQuerySchema", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(calendarQuerySchema.safeParse({ from: "2026-09-27", to: "2026-11-07" }).success).toBe(true);
  });

  it("rejects impossible or misformatted dates and missing bounds", () => {
    expect(calendarQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-07" }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ from: "27/09/2026", to: "2026-11-07" }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ to: "2026-11-07" }).success).toBe(false);
  });
});
