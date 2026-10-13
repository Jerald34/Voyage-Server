import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

const AGENCY = "agency-1";

// Records the order of writes. The fake has no updateMany on the thread: detaching the chats
// instead of deleting them would throw.
function fakeClient(exists = true) {
  const calls: string[] = [];
  const args: Record<string, any> = {};
  const tx: any = {
    clientTrip: {
      async findFirst(a: any) {
        args.find = a;
        const { where } = a;
        return exists && where.id === "trip-1" && where.agencyId === AGENCY ? { id: "trip-1" } : null;
      },
      async delete(a: any) {
        calls.push("trip.delete");
        args.tripDelete = a;
        return { id: "trip-1" };
      }
    },
    agentThread: {
      async deleteMany(a: any) {
        calls.push("threads.deleteMany");
        args.threadDelete = a;
        return { count: 2 };
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
    clientTrip: { findFirst: outside("clientTrip.findFirst"), delete: outside("clientTrip.delete") },
    agentThread: { deleteMany: outside("agentThread.deleteMany") }
  };
  return { client, calls, args };
}

const remove = (client: any, tripId = "trip-1") => createPrismaItineraryRepository(client).deleteTrip(tripId, AGENCY);

describe("deleteTrip", () => {
  it("deletes the trip's chats, then the trip, in one transaction", async () => {
    const { client, calls, args } = fakeClient();

    await expect(remove(client)).resolves.toEqual({ deleted: true });

    // Chats first: the link from a chat to its trip blocks deleting the trip.
    expect(calls).toEqual(["transaction", "threads.deleteMany", "trip.delete"]);
    expect(args.threadDelete).toEqual({ where: { tripId: "trip-1", agencyId: AGENCY } });
    expect(args.tripDelete).toEqual({ where: { id_agencyId: { id: "trip-1", agencyId: AGENCY } } });
  });

  it("deletes nothing for a trip that doesn't exist or belongs to another agency", async () => {
    const missing = fakeClient(false);
    await expect(remove(missing.client)).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
    expect(missing.calls).toEqual(["transaction"]);

    const other = fakeClient();
    await expect(
      createPrismaItineraryRepository(other.client).deleteTrip("trip-1", "agency-2")
    ).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
    expect(other.args.find.where).toEqual({ id: "trip-1", agencyId: "agency-2" });
    expect(other.calls).toEqual(["transaction"]);
  });
});
