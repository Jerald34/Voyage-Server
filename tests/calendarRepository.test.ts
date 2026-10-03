import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { calendarWindow } from "../src/modules/dashboard/calendar";
import { createPrismaCalendarRepository } from "../src/modules/dashboard/calendarRepository";

const WINDOW = calendarWindow("2026-09-27", "2026-11-07");

function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
    tripReview: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

async function fetchWith(client: ReturnType<typeof fakeClient>) {
  return createPrismaCalendarRepository(client as never).fetchCalendarWindow("agency-1", WINDOW);
}

describe("calendar repository", () => {
  it("scopes every query to the agency", async () => {
    const client = fakeClient();
    await fetchWith(client);

    for (const [args] of client.clientTrip.findMany.mock.calls) {
      expect(args.where.agencyId).toBe("agency-1");
    }
    expect(client.itineraryShare.findMany.mock.calls[0][0].where.agencyId).toBe("agency-1");
    expect(client.itineraryComment.findMany.mock.calls[0][0].where.share).toEqual({
      agencyId: "agency-1",
      trip: { agencyId: "agency-1" }
    });
    expect(client.tripReview.findMany.mock.calls[0][0].where.agencyId).toBe("agency-1");
  });

  it("also requires the related trip to belong to the agency", async () => {
    const client = fakeClient();
    await fetchWith(client);

    expect(client.itineraryShare.findMany.mock.calls[0][0].where.trip).toEqual({ agencyId: "agency-1" });
    expect(client.tripReview.findMany.mock.calls[0][0].where.trip).toEqual({ agencyId: "agency-1" });
  });

  it("asks only for non-archived trips that can overlap the window", async () => {
    const client = fakeClient();
    await fetchWith(client);

    const dated = client.clientTrip.findMany.mock.calls[0][0].where;
    expect(dated.status).toEqual({ not: "ARCHIVED" });
    // Strictly before the day after `to`, so a trip stored at 2026-11-07T09:00Z still counts.
    expect(dated.startDate).toEqual({ not: null, lt: new Date("2026-11-08T00:00:00.000Z") });
    expect(dated.OR).toEqual([
      { endDate: { gte: new Date("2026-09-27T00:00:00.000Z") } },
      { startDate: { gte: new Date("2026-09-27T00:00:00.000Z") } }
    ]);

    const undated = client.clientTrip.findMany.mock.calls[1][0].where;
    expect(undated).toEqual({ agencyId: "agency-1", status: { not: "ARCHIVED" }, startDate: null });
  });

  it("limits activity to the padded instant window", async () => {
    const client = fakeClient();
    await fetchWith(client);

    const range = { gte: WINDOW.fromInstant, lte: WINDOW.toInstant };
    const shares = client.itineraryShare.findMany.mock.calls[0][0].where;
    expect(shares.tripId).toEqual({ not: null });
    expect(shares.OR).toEqual([
      { createdAt: range },
      { expiresAt: range },
      { lastViewedAt: range },
      { proposalRatedAt: range }
    ]);
    expect(client.itineraryComment.findMany.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(client.tripReview.findMany.mock.calls[0][0].where.submittedAt).toEqual(range);
  });

  it("returns each query's rows under its own key", async () => {
    const client = fakeClient();
    client.clientTrip.findMany
      .mockResolvedValueOnce([{ id: "dated" }])
      .mockResolvedValueOnce([{ createdByUserId: "u1", assignedOrganizerUserId: null }]);
    client.itineraryShare.findMany.mockResolvedValueOnce([{ id: "s1" }]);
    client.itineraryComment.findMany.mockResolvedValueOnce([{ id: "c1" }]);
    client.tripReview.findMany.mockResolvedValueOnce([{ id: "r1" }]);

    expect(await fetchWith(client)).toEqual({
      trips: [{ id: "dated" }],
      undatedTrips: [{ createdByUserId: "u1", assignedOrganizerUserId: null }],
      shares: [{ id: "s1" }],
      comments: [{ id: "c1" }],
      reviews: [{ id: "r1" }]
    });
  });
});
