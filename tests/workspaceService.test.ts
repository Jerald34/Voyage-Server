import { describe, expect, it, vi } from "vitest";

const tripFindManyMock = vi.fn();
const threadFindManyMock = vi.fn();
const itineraryFindManyMock = vi.fn();
const runEventFindManyMock = vi.fn();

vi.mock("../src/db/prisma", () => ({
  prisma: {
    clientTrip: { findMany: (...args: unknown[]) => tripFindManyMock(...args) },
    agentThread: { findMany: (...args: unknown[]) => threadFindManyMock(...args) },
    itinerary: { findMany: (...args: unknown[]) => itineraryFindManyMock(...args) },
    agentRunEvent: { findMany: (...args: unknown[]) => runEventFindManyMock(...args) },
  },
}));

import { getBootstrap } from "../src/modules/workspace/workspaceService";

function resetMocks() {
  tripFindManyMock.mockReset();
  threadFindManyMock.mockReset();
  itineraryFindManyMock.mockReset();
  runEventFindManyMock.mockReset();
}

describe("workspaceService.getBootstrap", () => {
  it("returns thread summaries without messages or events fields", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([
      { id: "t1", agencyId: "a1", tripId: null, title: "Draft", status: "ACTIVE", createdByUserId: "u1", createdAt: new Date(), updatedAt: new Date() },
    ]);
    runEventFindManyMock.mockResolvedValue([
      { threadId: "t1", payload: { itineraryId: "it1" } },
    ]);
    itineraryFindManyMock.mockResolvedValue([
      { id: "it1", tripId: "trip1", title: "Plan", summary: null, status: "DRAFT", version: 1, updatedAt: new Date() },
    ]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads).toHaveLength(1);
    const thread = result.threads[0];
    expect(thread).not.toHaveProperty("messages");
    expect(thread).not.toHaveProperty("events");
    expect(thread.itineraryId).toBe("it1");
  });

  it("fires exactly four DB queries regardless of thread count", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`,
        agencyId: "a1",
        tripId: null,
        title: `Thread ${i}`,
        status: "ACTIVE",
        createdByUserId: "u1",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    runEventFindManyMock.mockResolvedValue([]);
    itineraryFindManyMock.mockResolvedValue([]);

    await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    const totalCalls =
      tripFindManyMock.mock.calls.length +
      threadFindManyMock.mock.calls.length +
      runEventFindManyMock.mock.calls.length +
      itineraryFindManyMock.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(4);
  });

  it("short-circuits queries 3 and 4 when there are no threads", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads).toEqual([]);
    expect(result.itinerarySummaries).toEqual({});
    expect(runEventFindManyMock).not.toHaveBeenCalled();
    expect(itineraryFindManyMock).not.toHaveBeenCalled();
  });

  it("uses a slim select on threads (no messages/events keys requested)", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([]);

    await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    const threadArgs = threadFindManyMock.mock.calls[0]?.[0] as { select?: Record<string, boolean> };
    expect(threadArgs?.select).toBeDefined();
    expect(threadArgs?.select).not.toHaveProperty("messages");
    expect(threadArgs?.select).not.toHaveProperty("events");
  });

  it("returns each thread's traveler needs so the composer can restore them", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([
      {
        id: "t1",
        agencyId: "a1",
        tripId: null,
        title: "Draft",
        status: "ACTIVE",
        createdByUserId: "u1",
        createdAt: new Date(),
        updatedAt: new Date(),
        travelerNeeds: { needs: ["WHEELCHAIR"], notes: null }
      }
    ]);
    runEventFindManyMock.mockResolvedValue([]);
    itineraryFindManyMock.mockResolvedValue([]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    const threadArgs = threadFindManyMock.mock.calls[0]?.[0] as { select?: Record<string, boolean> };
    expect(threadArgs?.select).toHaveProperty("travelerNeeds", true);
    expect(result.threads[0].travelerNeeds).toEqual({ needs: ["WHEELCHAIR"], notes: null });
  });

  it("points a trip's chat with no itinerary events at the trip's newest itinerary", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([
      { id: "trip-2", itineraries: [{ id: "itin-2", status: "NEEDS_REVIEW", version: 1 }] }
    ]);
    threadFindManyMock.mockResolvedValue([
      { id: "t2", agencyId: "a1", tripId: "trip-2", title: "Garcia (another option)", status: "ACTIVE", createdByUserId: "u1", createdAt: new Date(), updatedAt: new Date(), travelerNeeds: null }
    ]);
    runEventFindManyMock.mockResolvedValue([]);
    itineraryFindManyMock.mockResolvedValue([
      { id: "itin-2", tripId: "trip-2", title: "Baguio weekend", summary: null, status: "NEEDS_REVIEW", version: 1, updatedAt: new Date() }
    ]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads[0].itineraryId).toBe("itin-2");
    expect(result.itinerarySummaries["itin-2"]).toBeDefined();
    expect(itineraryFindManyMock.mock.calls[0][0].where.id.in).toContain("itin-2");
  });

  it("keeps the itinerary named by the chat's own events", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([{ id: "trip-1", itineraries: [{ id: "itin-new", status: "DRAFT", version: 1 }] }]);
    threadFindManyMock.mockResolvedValue([
      { id: "t1", agencyId: "a1", tripId: "trip-1", title: "Plan", status: "ACTIVE", createdByUserId: "u1", createdAt: new Date(), updatedAt: new Date(), travelerNeeds: null }
    ]);
    runEventFindManyMock.mockResolvedValue([{ threadId: "t1", payload: { itineraryId: "itin-old" } }]);
    itineraryFindManyMock.mockResolvedValue([]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads[0].itineraryId).toBe("itin-old");
  });

  it("asks for each trip's creation time, so options can be numbered in order", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([]);

    await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(tripFindManyMock.mock.calls[0][0].select.createdAt).toBe(true);
  });
});
