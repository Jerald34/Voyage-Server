import { describe, expect, it } from "vitest";
import { createPersonalService } from "../src/modules/personal/personalService";
import type { PersonalRepository, PersonalItineraryRecord } from "../src/modules/personal/personalRepository";

function fakeRepo(seed: PersonalItineraryRecord[] = []): PersonalRepository {
  const rows = [...seed];
  return {
    async listItinerariesForUser(userId) {
      return rows.filter((r) => r.createdByUserId === userId);
    },
    async findItineraryForUser(userId, itineraryId) {
      return rows.find((r) => r.id === itineraryId && r.createdByUserId === userId) ?? null;
    },
    async createItineraryForUser(input) {
      const r: PersonalItineraryRecord = {
        id: `it-${rows.length + 1}`,
        createdByUserId: input.userId,
        agencyId: null,
        title: input.title,
        summary: input.summary ?? null,
        status: "DRAFT",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      rows.push(r);
      return r;
    },
    async updateItineraryForUser({ userId, itineraryId, data }) {
      const r = rows.find((x) => x.id === itineraryId && x.createdByUserId === userId);
      if (!r) return null;
      Object.assign(r, data);
      return r;
    },
    async deleteItineraryForUser(userId, itineraryId) {
      const i = rows.findIndex((r) => r.id === itineraryId && r.createdByUserId === userId);
      if (i === -1) return false;
      rows.splice(i, 1);
      return true;
    },
    async listThreadsForUser(userId) {
      return [];
    },
    async findThreadForUser(userId, threadId) {
      return null;
    },
    async createThreadForUser(input) {
      return { id: "t-stub", title: input.title, status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() };
    },
    async createShareForUserItinerary(input) {
      return { id: "s-stub", token: "tok-stub", itineraryId: input.itineraryId, createdAt: new Date() };
    }
  };
}

describe("personalService itineraries", () => {
  it("lists only the user's own itineraries", async () => {
    const repo = fakeRepo([
      { id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() },
      { id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }
    ]);
    const svc = createPersonalService({ repository: repo });
    const list = await svc.listItineraries("u-1");
    expect(list.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns 404 NOT_FOUND when fetching another user's itinerary", async () => {
    const repo = fakeRepo([
      { id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }
    ]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.getItinerary("u-1", "b")).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });
});
