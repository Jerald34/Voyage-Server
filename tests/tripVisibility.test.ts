import { describe, expect, it } from "vitest";
import { createItineraryService } from "../src/modules/itineraries/itineraryService";
import type { ItineraryRepository } from "../src/modules/itineraries/itineraryTypes";

function createFakeRepo(): ItineraryRepository {
  const trips = [
    { id: "trip-a", agencyId: "agency-1", assignedOrganizerUserId: "staff-1", title: "A", itineraries: [] },
    { id: "trip-b", agencyId: "agency-1", assignedOrganizerUserId: "staff-2", title: "B", itineraries: [] }
  ];
  return {
    listTripsWithItineraries: async (agencyId) => trips.filter((t) => t.agencyId === agencyId) as any,
    listTripsForUser: async (agencyId, filter) => {
      const base = trips.filter((t) => t.agencyId === agencyId);
      return (filter.role === "STAFF" ? base.filter((t) => t.assignedOrganizerUserId === filter.userId) : base) as any;
    },
  } as unknown as ItineraryRepository;
}

describe("trip visibility by role", () => {
  it("STAFF sees only trips they organize", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "STAFF", userId: "staff-1" });
    expect(trips.map((t) => t.id)).toEqual(["trip-a"]);
  });

  it("ADMIN sees every trip", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "ADMIN", userId: "any-admin" });
    expect(trips.map((t) => t.id).sort()).toEqual(["trip-a", "trip-b"]);
  });

  it("OWNER sees every trip", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "OWNER", userId: "owner-id" });
    expect(trips.map((t) => t.id).sort()).toEqual(["trip-a", "trip-b"]);
  });
});
