import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

const AGENCY = "agency-1";
const START = new Date("2026-11-01T00:00:00.000Z");
const END = new Date("2026-11-03T00:00:00.000Z");

function sourceTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    agencyId: AGENCY,
    createdByUserId: "owner-1",
    assignedOrganizerUserId: "staff-1",
    title: "Garcia itinerary",
    destinationSummary: "Baguio City",
    clientName: "Garcia",
    startDate: START,
    endDate: END,
    travelerCount: 4,
    budgetLevel: "Mid-range",
    status: "APPROVED_INTERNAL",
    itineraries: [
      {
        id: "itin-1",
        title: "Baguio weekend",
        summary: "Pines and food",
        status: "APPROVED_INTERNAL",
        version: 3,
        days: [
          {
            id: "day-1",
            dayNumber: 1,
            date: START,
            title: "Arrival",
            summary: null,
            items: [
              {
                id: "item-1", sortOrder: 1, type: "ACTIVITY", title: "Mines View Park", description: "Lookout",
                startTime: "09:00", endTime: "10:00", placeSnapshotId: "snap-1", routeFromPrevious: null,
                staffNotes: "Go early", clientNotes: "Bring a jacket", placeSnapshot: null
              },
              {
                id: "item-2", sortOrder: 2, type: "MEAL", title: "Good Taste", description: null,
                startTime: "12:00", endTime: null, placeSnapshotId: "snap-2", routeFromPrevious: { polyline: "abc" },
                staffNotes: null, clientNotes: null, placeSnapshot: null
              }
            ]
          }
        ]
      }
    ],
    agentThreads: [{ travelerNeeds: { needs: ["WHEELCHAIR"], notes: null } }],
    ...overrides
  };
}

function fakeClient(source: ReturnType<typeof sourceTrip> | null) {
  const calls: Record<string, any> = {};
  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      return fn(client);
    },
    clientTrip: {
      async findFirst({ where }: any) {
        return source && where.id === source.id && where.agencyId === source.agencyId ? source : null;
      },
      async create({ data }: any) {
        calls.trip = data;
        return { id: "trip-2", ...data, createdAt: new Date(), updatedAt: new Date() };
      }
    },
    itinerary: {
      async create(args: any) {
        calls.itinerary = args;
        return { id: "itin-2", status: args.data.status, version: 1 };
      },
      async findFirst(args: any) {
        calls.latest = args;
        return { id: "itin-9" };
      }
    },
    agentThread: {
      async create(args: any) {
        calls.thread = args;
        return { id: "thread-2", tripId: args.data.tripId, title: args.data.title, travelerNeeds: args.data.travelerNeeds ?? null, createdAt: new Date() };
      }
    }
  };
  return { client, calls };
}

const duplicate = (client: any, tripId = "trip-1") =>
  createPrismaItineraryRepository(client).duplicateTrip({ tripId, agencyId: AGENCY, createdByUserId: "staff-9" });

describe("duplicateTrip", () => {
  it("creates a new in-review trip for the same client, made by whoever copied it", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.trip).toEqual({
      agencyId: AGENCY,
      createdByUserId: "staff-9",
      assignedOrganizerUserId: "staff-1",
      title: "Garcia itinerary",
      destinationSummary: "Baguio City",
      clientName: "Garcia",
      startDate: START,
      endDate: END,
      travelerCount: 4,
      budgetLevel: "Mid-range",
      status: "IN_REVIEW"
    });
    expect(result.trip.id).toBe("trip-2");
  });

  it("copies every day and stop into an itinerary that can still be edited", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.itinerary.data).toMatchObject({
      agencyId: AGENCY,
      tripId: "trip-2",
      createdByUserId: "staff-9",
      title: "Baguio weekend",
      summary: "Pines and food",
      status: "NEEDS_REVIEW"
    });
    const [day] = calls.itinerary.data.days.create;
    expect(day).toMatchObject({ dayNumber: 1, date: START, title: "Arrival", summary: null });
    expect(day.items.create).toEqual([
      {
        sortOrder: 1, type: "ACTIVITY", title: "Mines View Park", description: "Lookout", startTime: "09:00",
        endTime: "10:00", placeSnapshotId: "snap-1", routeFromPrevious: undefined, staffNotes: "Go early",
        clientNotes: "Bring a jacket"
      },
      {
        sortOrder: 2, type: "MEAL", title: "Good Taste", description: null, startTime: "12:00", endTime: null,
        placeSnapshotId: "snap-2", routeFromPrevious: { polyline: "abc" }, staffNotes: null, clientNotes: null
      }
    ]);
    expect(result.itinerary).toEqual({ id: "itin-2", status: "NEEDS_REVIEW", version: 1 });
  });

  it("gives the copy a fresh chat with the same traveler needs", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.thread.data).toEqual({
      agencyId: AGENCY,
      tripId: "trip-2",
      createdByUserId: "staff-9",
      title: "Garcia (another option)",
      travelerNeeds: { needs: ["WHEELCHAIR"], notes: null }
    });
    expect(result.thread.id).toBe("thread-2");
  });

  it("leaves traveler needs off when the trip's chat had none", async () => {
    const { client, calls } = fakeClient(sourceTrip({ agentThreads: [] }));
    await duplicate(client);
    expect(calls.thread.data).not.toHaveProperty("travelerNeeds");
  });

  it("names the chat after the trip when there is no client name", async () => {
    const { client, calls } = fakeClient(sourceTrip({ clientName: null }));
    await duplicate(client);
    expect(calls.thread.data.title).toBe("Garcia itinerary (another option)");
  });

  it("refuses a trip from another agency", async () => {
    const { client } = fakeClient(sourceTrip());
    await expect(duplicate(client, "trip-other")).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
  });

  it("refuses a trip with no itinerary yet", async () => {
    const { client } = fakeClient(sourceTrip({ itineraries: [] }));
    await expect(duplicate(client)).rejects.toMatchObject({ statusCode: 409, code: "ITINERARY_REQUIRED" });
  });
});

describe("findTripLatestItineraryId", () => {
  it("returns the trip's newest itinerary in the agency", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const id = await createPrismaItineraryRepository(client).findTripLatestItineraryId("trip-1", AGENCY);

    expect(id).toBe("itin-9");
    expect(calls.latest).toEqual({
      where: { tripId: "trip-1", agencyId: AGENCY },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
  });
});
