import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

type FakeItem = {
  id: string;
  itineraryDayId: string;
  sortOrder: number;
  title: string;
  placeSnapshotId: string | null;
  routeFromPrevious: unknown;
};
type FakeState = {
  trips: Array<{ id: string; agencyId: string; status: string }>;
  itineraries: Array<{ id: string; agencyId: string; tripId: string; status: string; updatedAt: Date }>;
  days: Array<{ id: string; itineraryId: string; dayNumber: number; title: string }>;
  items: FakeItem[];
};

const AGENCY = "agency-1";
// Places with coordinates; a stop without one is a custom stop, off the map.
const POINTS: Record<string, { latitude: number; longitude: number }> = {
  "snap-a": { latitude: 1, longitude: 1 },
  "snap-b": { latitude: 2, longitude: 2 },
  "snap-c": { latitude: 3, longitude: 3 },
  "snap-d": { latitude: 4, longitude: 4 },
  "snap-x": { latitude: 5, longitude: 5 }
};

function createState(status: "NEEDS_REVIEW" | "APPROVED_INTERNAL" = "NEEDS_REVIEW"): FakeState {
  return {
    trips: [{ id: "trip-1", agencyId: AGENCY, status: status === "APPROVED_INTERNAL" ? "APPROVED_INTERNAL" : "IN_REVIEW" }],
    itineraries: [{ id: "itin-1", agencyId: AGENCY, tripId: "trip-1", status, updatedAt: new Date("2026-10-01") }],
    days: [
      { id: "day-1", itineraryId: "itin-1", dayNumber: 1, title: "Arrival" },
      { id: "day-2", itineraryId: "itin-1", dayNumber: 2, title: "Old town" }
    ],
    items: [
      { id: "a", itineraryDayId: "day-1", sortOrder: 1, title: "A", placeSnapshotId: "snap-a", routeFromPrevious: null },
      { id: "b", itineraryDayId: "day-1", sortOrder: 2, title: "B", placeSnapshotId: "snap-b", routeFromPrevious: { polyline: "a-b" } },
      { id: "c", itineraryDayId: "day-1", sortOrder: 3, title: "C", placeSnapshotId: "snap-c", routeFromPrevious: { polyline: "b-c" } },
      { id: "d", itineraryDayId: "day-2", sortOrder: 1, title: "D", placeSnapshotId: "snap-d", routeFromPrevious: null }
    ]
  };
}

function createFakeClient(state: FakeState): PrismaClient {
  const itemsOf = (dayId: string) =>
    state.items.filter((item) => item.itineraryDayId === dayId).sort((x, y) => x.sortOrder - y.sortOrder);
  const dayOf = (dayId: string) => state.days.find((day) => day.id === dayId);
  const fullItinerary = (itinerary: FakeState["itineraries"][number]) => ({
    ...itinerary,
    days: state.days
      .filter((day) => day.itineraryId === itinerary.id)
      .sort((x, y) => x.dayNumber - y.dayNumber)
      .map((day) => ({ ...day, items: itemsOf(day.id).map((item) => ({ ...item, placeSnapshot: null })) }))
  });

  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      return fn(client);
    },
    itinerary: {
      async findFirst({ where, include }: any) {
        const row = state.itineraries.find((it) => it.id === where.id && it.agencyId === where.agencyId);
        if (!row) return null;
        return include ? fullItinerary(row) : { id: row.id, status: row.status, tripId: row.tripId };
      },
      async update({ where, data }: any) {
        const row = state.itineraries.find((it) => it.id === where.id)!;
        if (typeof data.status === "string") row.status = data.status;
        return { id: row.id, status: row.status };
      }
    },
    clientTrip: {
      async findFirst({ where }: any) {
        const trip = state.trips.find((row) => row.id === where.id && row.agencyId === where.agencyId);
        if (!trip) return null;
        const itineraries = state.itineraries
          .filter((row) => row.tripId === trip.id)
          .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
          .slice(0, 1)
          .map((row) => ({ id: row.id, status: row.status }));
        return { ...trip, itineraries };
      },
      async update({ where, data }: any) {
        const trip = state.trips.find((row) => row.id === where.id)!;
        Object.assign(trip, data);
        return { ...trip };
      }
    },
    itineraryDay: {
      async findFirst({ where }: any) {
        const day = state.days.find((row) => row.id === where.id && row.itineraryId === where.itineraryId);
        return day ? { id: day.id, dayNumber: day.dayNumber } : null;
      },
      async findMany({ where }: any) {
        return state.days
          .filter((day) => where.id.in.includes(day.id))
          .map((day) => ({
            id: day.id,
            items: itemsOf(day.id).map((item) => ({
              id: item.id,
              placeSnapshot: item.placeSnapshotId ? POINTS[item.placeSnapshotId] ?? null : null
            }))
          }));
      },
      async update({ where, data }: any) {
        const day = dayOf(where.id)!;
        Object.assign(day, data);
        return { ...day, items: itemsOf(day.id) };
      }
    },
    itineraryItem: {
      async findFirst({ where }: any) {
        const item = state.items.find((row) => row.id === where.id);
        if (!item || dayOf(item.itineraryDayId)?.itineraryId !== where.itineraryDay.itineraryId) return null;
        return { id: item.id, itineraryDayId: item.itineraryDayId };
      },
      async findMany({ where }: any) {
        return itemsOf(where.itineraryDayId)
          .filter((item) => item.id !== where.NOT?.id)
          .map((item) => ({ id: item.id, sortOrder: item.sortOrder, startTime: null }));
      },
      async create({ data }: any) {
        const item = { routeFromPrevious: null, placeSnapshotId: null, ...data, id: `new-${state.items.length + 1}` };
        state.items.push(item);
        return { ...item, placeSnapshot: null };
      },
      async update({ where, data }: any) {
        const item = state.items.find((row) => row.id === where.id)!;
        Object.assign(item, data);
        return { ...item, placeSnapshot: null };
      },
      async updateMany({ where, data }: any) {
        const rows = state.items.filter((row) => where.id.in.includes(row.id));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      async delete({ where }: any) {
        state.items = state.items.filter((row) => row.id !== where.id);
      }
    }
  };
  return client as PrismaClient;
}

const repoFor = (state: FakeState) => createPrismaItineraryRepository(createFakeClient(state));
const orderOf = (state: FakeState, dayId: string) =>
  state.items
    .filter((item) => item.itineraryDayId === dayId)
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((item) => item.id);
const routeOf = (state: FakeState, itemId: string) => state.items.find((item) => item.id === itemId)?.routeFromPrevious;

describe("itinerary repository lock", () => {
  it("lets an itinerary in review be edited", async () => {
    const state = createState("NEEDS_REVIEW");
    await repoFor(state).updateItem("itin-1", AGENCY, "b", { title: "B, renamed" });
    expect(state.items.find((item) => item.id === "b")?.title).toBe("B, renamed");
  });

  it("refuses edits to an approved itinerary with ITINERARY_LOCKED", async () => {
    const state = createState("APPROVED_INTERNAL");
    await expect(repoFor(state).updateItem("itin-1", AGENCY, "b", { title: "Nope" })).rejects.toMatchObject({
      statusCode: 409,
      code: "ITINERARY_LOCKED"
    });
    await expect(repoFor(state).updateDay("itin-1", AGENCY, "day-1", { title: "Nope" })).rejects.toMatchObject({
      code: "ITINERARY_LOCKED"
    });
    expect(state.items.find((item) => item.id === "b")?.title).toBe("B");
    expect(state.days[0].title).toBe("Arrival");
  });
});

describe("stale route clearing", () => {
  it("clears the route of the stop after a removed stop", async () => {
    const state = createState();
    await repoFor(state).removeItem("itin-1", AGENCY, "b");
    expect(orderOf(state, "day-1")).toEqual(["a", "c"]);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
  });

  it("clears both routes that change when a stop moves up", async () => {
    const state = createState();
    await repoFor(state).moveItem("itin-1", AGENCY, "c", { toDayId: "day-1", toSortOrder: 2 });
    expect(orderOf(state, "day-1")).toEqual(["a", "c", "b"]);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
  });

  it("clears the moved stop's route and the one it leaves behind when moving to another day", async () => {
    const state = createState();
    await repoFor(state).moveItem("itin-1", AGENCY, "b", { toDayId: "day-2" });
    expect(orderOf(state, "day-1")).toEqual(["a", "c"]);
    expect(orderOf(state, "day-2")).toEqual(["d", "b"]);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
  });

  it("clears the next stop's route when a stop with a place is inserted before it", async () => {
    const state = createState();
    await repoFor(state).addItem("itin-1", AGENCY, {
      dayId: "day-1",
      sortOrder: 2,
      item: { type: "ACTIVITY", title: "Museum", placeSnapshotId: "snap-x" } as any
    });
    const added = state.items.find((item) => item.title === "Museum")!;
    expect(orderOf(state, "day-1")).toEqual(["a", added.id, "b", "c"]);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
    expect(routeOf(state, "c")).toEqual({ polyline: "b-c" });
  });

  // A route starts at the nearest earlier stop on the map, so a custom stop (no
  // place) between two places leaves the route between them as it was.
  it("keeps the next stop's route when a custom stop is inserted before it", async () => {
    const state = createState();
    await repoFor(state).addItem("itin-1", AGENCY, {
      dayId: "day-1",
      sortOrder: 2,
      item: { type: "NOTE", title: "Coffee" } as any
    });
    const added = state.items.find((item) => item.title === "Coffee")!;
    expect(orderOf(state, "day-1")).toEqual(["a", added.id, "b", "c"]);
    expect(routeOf(state, "b")).toEqual({ polyline: "a-b" });
    expect(routeOf(state, "c")).toEqual({ polyline: "b-c" });
  });

  it("keeps the next stop's route when a custom stop before it is deleted", async () => {
    const state = createState();
    state.items.find((item) => item.id === "b")!.placeSnapshotId = null;
    state.items.find((item) => item.id === "b")!.routeFromPrevious = null;
    state.items.find((item) => item.id === "c")!.routeFromPrevious = { polyline: "a-c" };
    await repoFor(state).removeItem("itin-1", AGENCY, "b");
    expect(routeOf(state, "c")).toEqual({ polyline: "a-c" });
  });

  it("clears a route whose start moved away from behind a custom stop", async () => {
    const state = createState();
    // a, b (custom), c: c's route starts at a.
    state.items.find((item) => item.id === "b")!.placeSnapshotId = null;
    state.items.find((item) => item.id === "b")!.routeFromPrevious = null;
    state.items.find((item) => item.id === "c")!.routeFromPrevious = { polyline: "a-c" };
    await repoFor(state).moveItem("itin-1", AGENCY, "a", { toDayId: "day-2" });
    expect(orderOf(state, "day-1")).toEqual(["b", "c"]);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
  });
});

describe("trip lookup and reopen", () => {
  it("finds the trip an itinerary belongs to, only inside the agency", async () => {
    const state = createState();
    await expect(repoFor(state).findItineraryTripId("itin-1", AGENCY)).resolves.toMatchObject({ tripId: "trip-1" });
    await expect(repoFor(state).findItineraryTripId("itin-1", "agency-2")).resolves.toBeNull();
  });

  it("moves an approved trip and its itinerary back to review", async () => {
    const state = createState("APPROVED_INTERNAL");
    const result = await repoFor(state).reopenTrip("trip-1", AGENCY);
    expect(state.trips[0].status).toBe("IN_REVIEW");
    expect(state.itineraries[0].status).toBe("NEEDS_REVIEW");
    expect(result.itinerary).toEqual({ id: "itin-1", status: "NEEDS_REVIEW" });
    expect(result.trip.status).toBe("IN_REVIEW");
  });

  it("returns a trip that is already in review unchanged", async () => {
    const state = createState("NEEDS_REVIEW");
    const result = await repoFor(state).reopenTrip("trip-1", AGENCY);
    expect(state.trips[0].status).toBe("IN_REVIEW");
    expect(result.itinerary).toEqual({ id: "itin-1", status: "NEEDS_REVIEW" });
  });

  it("404s for another agency's trip and changes nothing", async () => {
    const state = createState("APPROVED_INTERNAL");
    await expect(repoFor(state).reopenTrip("trip-1", "agency-2")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
    expect(state.trips[0].status).toBe("APPROVED_INTERNAL");
  });
});
