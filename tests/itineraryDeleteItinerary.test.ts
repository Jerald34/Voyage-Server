import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

const AGENCY = "agency-1";

// Records the order of writes. The agent tool's deleteTrip option removes the trip, and the chat it
// runs in still points at that trip: the chat must be detached (tripId -> null), never deleted. The
// fake thread records deletes too, so the tests can show none happened.
function fakeClient(opts: { status?: string; tripId?: string | null; exists?: boolean } = {}) {
  const { status = "DRAFT", tripId = "trip-1", exists = true } = opts;
  const calls: string[] = [];
  const args: Record<string, any> = {};
  const tx: any = {
    itinerary: {
      async findFirst(a: any) {
        args.find = a;
        const { where } = a;
        return exists && where.id === "it-1" && where.agencyId === AGENCY ? { id: "it-1", status, tripId } : null;
      },
      async delete(a: any) {
        calls.push("itinerary.delete");
        args.itineraryDelete = a;
        return { id: "it-1" };
      }
    },
    agentThread: {
      async updateMany(a: any) {
        calls.push("threads.updateMany");
        args.threadUpdate = a;
        return { count: 1 };
      },
      async deleteMany() {
        calls.push("threads.deleteMany");
        return { count: 1 };
      },
      async delete() {
        calls.push("threads.delete");
        return { id: "thread-1" };
      }
    },
    clientTrip: {
      async delete(a: any) {
        calls.push("trip.delete");
        args.tripDelete = a;
        return { id: "trip-1" };
      }
    }
  };
  const outside = (name: string) => async () => {
    throw new Error(`${name} was called outside the transaction`);
  };
  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      calls.push("transaction");
      return fn(tx);
    },
    itinerary: { findFirst: outside("itinerary.findFirst"), delete: outside("itinerary.delete") },
    agentThread: { updateMany: outside("agentThread.updateMany") },
    clientTrip: { delete: outside("clientTrip.delete") }
  };
  return { client, calls, args };
}

const remove = (client: any, deleteTrip: boolean) =>
  createPrismaItineraryRepository(client).deleteItinerary("it-1", AGENCY, { deleteTrip });

describe("deleteItinerary with deleteTrip", () => {
  it("detaches the trip's chats before deleting the trip, in one transaction, and keeps the chats", async () => {
    const { client, calls, args } = fakeClient();

    await expect(remove(client, true)).resolves.toEqual({ deleted: true, tripDeleted: true });

    // The chat-to-trip link is NoAction: the detach must come before the trip delete, or Postgres
    // rejects the delete (P2003) and the whole transaction rolls back.
    expect(calls).toEqual(["transaction", "itinerary.delete", "threads.updateMany", "trip.delete"]);
    expect(args.threadUpdate).toEqual({ where: { tripId: "trip-1", agencyId: AGENCY }, data: { tripId: null } });
    expect(args.tripDelete).toEqual({ where: { id_agencyId: { id: "trip-1", agencyId: AGENCY } } });
  });

  it("never deletes a chat, so the chat the agent is running in stays as a draft", async () => {
    const { client, calls } = fakeClient();

    await expect(remove(client, true)).resolves.toMatchObject({ tripDeleted: true });

    expect(calls).not.toContain("threads.delete");
    expect(calls).not.toContain("threads.deleteMany");
    expect(calls.filter((c) => c === "threads.updateMany")).toHaveLength(1);
  });

  it("leaves the trip and its chats alone when deleteTrip is off", async () => {
    const { client, calls } = fakeClient();

    await expect(remove(client, false)).resolves.toEqual({ deleted: true, tripDeleted: false });
    expect(calls).toEqual(["transaction", "itinerary.delete"]);
  });

  it("touches no chat when the itinerary has no trip", async () => {
    const { client, calls } = fakeClient({ tripId: null });

    await expect(remove(client, true)).resolves.toEqual({ deleted: true, tripDeleted: false });
    expect(calls).toEqual(["transaction", "itinerary.delete"]);
  });

  it("deletes and detaches nothing for a non-draft or missing itinerary", async () => {
    const approved = fakeClient({ status: "APPROVED" });
    await expect(remove(approved.client, true)).rejects.toMatchObject({ statusCode: 409, code: "ITINERARY_NOT_DRAFT" });
    expect(approved.calls).toEqual(["transaction"]);

    const missing = fakeClient({ exists: false });
    await expect(remove(missing.client, true)).rejects.toMatchObject({ statusCode: 404, code: "ITINERARY_NOT_FOUND" });
    expect(missing.calls).toEqual(["transaction"]);
  });
});
