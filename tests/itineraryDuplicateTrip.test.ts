import { Prisma } from "@prisma/client";
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

// A trip row as the option-number lookup sees it. The fake below answers that lookup the way the
// database would for the parts of the query it can be asked: this agency, these statuses, and
// only trips that have an itinerary. Matching the client and place is the repository's own job.
function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    agencyId: AGENCY,
    status: "IN_REVIEW",
    clientName: "Garcia",
    destinationSummary: "Baguio City",
    title: "Garcia itinerary",
    hasItinerary: true,
    ...overrides
  };
}

function fakeClient(source: ReturnType<typeof sourceTrip> | null, saved: Array<ReturnType<typeof savedRow>> | null = null) {
  const calls: Record<string, any> = {};
  // By default the only trip in the database is the one being copied.
  const rows = saved ?? (source ? [savedRow({ status: source.status })] : []);
  // Everything duplicateTrip writes must go through the transaction's own client, so the
  // outer client's writers throw: calling `client.x` instead of `tx.x` fails the test.
  const outsideTransaction = (name: string) => async () => {
    throw new Error(`${name} was called outside the transaction`);
  };
  const tx: any = {
    clientTrip: {
      async findFirst(args: any) {
        calls.tripQuery = args;
        const { where } = args;
        return source && where.id === source.id && where.agencyId === source.agencyId ? source : null;
      },
      async findMany(args: any) {
        calls.savedTripsQuery = args;
        const { where } = args;
        return rows
          .filter(
            (row) =>
              row.agencyId === where.agencyId &&
              where.status.in.includes(row.status) &&
              (!where.itineraries?.some || row.hasItinerary)
          )
          .map(({ clientName, destinationSummary, title }) => ({ clientName, destinationSummary, title }));
      },
      async create({ data }: any) {
        calls.trip = data;
        return { id: "trip-2", ...data, createdAt: new Date(), updatedAt: new Date() };
      }
    },
    itinerary: {
      async create(args: any) {
        calls.itinerary = args;
        return { id: "itin-2", title: args.data.title, status: args.data.status, version: 1 };
      }
    },
    agentThread: {
      async create(args: any) {
        calls.thread = args;
        return { id: "thread-2", tripId: args.data.tripId, title: args.data.title, travelerNeeds: args.data.travelerNeeds ?? null, createdAt: new Date() };
      }
    }
  };
  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      calls.transactions = (calls.transactions ?? 0) + 1;
      return fn(tx);
    },
    clientTrip: {
      findFirst: outsideTransaction("clientTrip.findFirst"),
      findMany: outsideTransaction("clientTrip.findMany"),
      create: outsideTransaction("clientTrip.create")
    },
    itinerary: {
      create: outsideTransaction("itinerary.create"),
      // The one plain read: the newest itinerary of a trip needs no transaction.
      async findFirst(args: any) {
        calls.latest = args;
        return { id: "itin-9" };
      }
    },
    agentThread: {
      create: outsideTransaction("agentThread.create")
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
      title: "Baguio weekend (option 2)",
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
    expect(result.itinerary).toEqual({ id: "itin-2", title: "Baguio weekend (option 2)", status: "NEEDS_REVIEW", version: 1 });
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

  it("refuses a trip id that doesn't exist", async () => {
    const { client } = fakeClient(sourceTrip());
    await expect(duplicate(client, "trip-other")).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
  });

  it("refuses a trip that belongs to another agency", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    await expect(
      createPrismaItineraryRepository(client).duplicateTrip({
        tripId: "trip-1",
        agencyId: "agency-2",
        createdByUserId: "staff-9"
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
    expect(calls.tripQuery.where).toEqual({ id: "trip-1", agencyId: "agency-2" });
    expect(calls.trip).toBeUndefined();
  });

  it.each(["DRAFT", "ARCHIVED"])("refuses a %s trip and creates nothing", async (status) => {
    const { client, calls } = fakeClient(sourceTrip({ status }));
    await expect(duplicate(client)).rejects.toMatchObject({ statusCode: 409, code: "TRIP_NOT_SAVED" });
    expect(calls.trip).toBeUndefined();
    expect(calls.itinerary).toBeUndefined();
    expect(calls.thread).toBeUndefined();
  });

  it("does all its reading and writing inside one transaction", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    await duplicate(client);
    expect(calls.transactions).toBe(1);
    expect(calls.trip).toBeDefined();
    expect(calls.itinerary).toBeDefined();
    expect(calls.thread).toBeDefined();
  });

  it("takes traveler needs from the latest chat that has some, not just the newest chat", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    await duplicate(client);
    expect(calls.tripQuery.include.agentThreads).toEqual({
      where: { travelerNeeds: { not: Prisma.AnyNull } },
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { travelerNeeds: true }
    });
  });

  it("refuses a trip with no itinerary yet", async () => {
    const { client } = fakeClient(sourceTrip({ itineraries: [] }));
    await expect(duplicate(client)).rejects.toMatchObject({ statusCode: 409, code: "ITINERARY_REQUIRED" });
  });
});

describe("duplicateTrip option numbering", () => {
  const optionTitleFor = async (source: ReturnType<typeof sourceTrip>, saved: Array<ReturnType<typeof savedRow>>) => {
    const { client, calls } = fakeClient(source, saved);
    const result = await duplicate(client);
    expect(calls.itinerary.data.title).toBe(result.itinerary.title);
    return result.itinerary.title;
  };
  const withTitle = (title: string) => {
    const source = sourceTrip();
    source.itineraries[0].title = title;
    return source;
  };

  it("titles the copy (option 2) when the source is the only saved trip to that place", async () => {
    expect(await optionTitleFor(sourceTrip(), [savedRow({ status: "APPROVED_INTERNAL" })])).toBe("Baguio weekend (option 2)");
  });

  it("only looks at this agency's saved trips, in review or approved, that have an itinerary", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    await duplicate(client);
    expect(calls.savedTripsQuery.where).toEqual({
      agencyId: AGENCY,
      status: { in: ["IN_REVIEW", "APPROVED_INTERNAL"] },
      itineraries: { some: {} }
    });
  });

  it("takes the next number when an option already exists", async () => {
    const saved = [savedRow({ status: "APPROVED_INTERNAL" }), savedRow()];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 3)");
  });

  it("does not stack suffixes when the source is already an option", async () => {
    const saved = [savedRow({ status: "APPROVED_INTERNAL" }), savedRow()];
    expect(await optionTitleFor(withTitle("Baguio weekend (option 2)"), saved)).toBe("Baguio weekend (option 3)");
    expect(await optionTitleFor(withTitle("Baguio weekend (Option 12)  "), saved)).toBe("Baguio weekend (option 3)");
  });

  it("keeps an option mention that is not a trailing number", async () => {
    expect(await optionTitleFor(withTitle("Baguio (option B) weekend"), [savedRow()])).toBe(
      "Baguio (option B) weekend (option 2)"
    );
  });

  it("does not count a trip to a different destination", async () => {
    const saved = [savedRow(), savedRow({ destinationSummary: "Sagada" })];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 2)");
  });

  it("does not count another client's trip to the same place", async () => {
    const saved = [savedRow(), savedRow({ clientName: "Reyes" })];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 2)");
  });

  it("does not count drafts or archived trips", async () => {
    const saved = [savedRow(), savedRow({ status: "DRAFT" }), savedRow({ status: "ARCHIVED" })];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 2)");
  });

  it("does not count a trip in another agency", async () => {
    const saved = [savedRow(), savedRow({ agencyId: "agency-2" })];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 2)");
  });

  it("does not count a trip with no itinerary, because the page never lists it", async () => {
    const saved = [savedRow(), savedRow({ hasItinerary: false })];
    expect(await optionTitleFor(sourceTrip(), saved)).toBe("Baguio weekend (option 2)");
  });

  it("counts names and places the way the tabs group them: case and spacing do not matter", async () => {
    const saved = [
      savedRow({ clientName: "  garcia " }),
      savedRow({ clientName: "GARCIA", destinationSummary: "baguio   city" }),
      savedRow({ clientName: "Gar  cia" })
    ];
    expect(await optionTitleFor(sourceTrip({ clientName: "Garcia  " }), saved)).toBe("Baguio weekend (option 3)");
  });

  it("falls back to the trip title for the place, like the tabs do, when the summary is blank", async () => {
    const source = sourceTrip({ destinationSummary: "  ", title: "Boracay" });
    const saved = [
      savedRow({ destinationSummary: null, title: "BORACAY" }),
      savedRow({ destinationSummary: "Boracay", title: "Something else" }),
      savedRow({ destinationSummary: "Baguio City", title: "Boracay" })
    ];
    expect(await optionTitleFor(source, saved)).toBe("Baguio weekend (option 3)");
  });

  it("keeps the whole title within the 200-character limit", async () => {
    const title = await optionTitleFor(withTitle("x".repeat(200)), [savedRow()]);
    expect(title).toHaveLength(200);
    expect(title.endsWith("x (option 2)")).toBe(true);
  });

  it("leaves the trip's own title alone, since the tabs group by it", async () => {
    const { client, calls } = fakeClient(sourceTrip(), [savedRow()]);
    await duplicate(client);
    expect(calls.trip.title).toBe("Garcia itinerary");
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
