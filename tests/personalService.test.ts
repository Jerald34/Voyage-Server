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

describe("personalService create/update/delete", () => {
  it("creates an itinerary owned by the caller", async () => {
    const repo = fakeRepo();
    const svc = createPersonalService({ repository: repo });
    const created = await svc.createItinerary("u-1", { title: "Trip to Tokyo" });
    expect(created.createdByUserId).toBe("u-1");
    expect(created.title).toBe("Trip to Tokyo");
    expect(created.agencyId).toBeNull();
  });

  it("rejects empty title with PERSONAL_ITINERARY_TITLE_REQUIRED", async () => {
    const repo = fakeRepo();
    const svc = createPersonalService({ repository: repo });
    await expect(svc.createItinerary("u-1", { title: "   " })).rejects.toMatchObject({
      statusCode: 400,
      code: "PERSONAL_ITINERARY_TITLE_REQUIRED"
    });
  });

  it("updates own itinerary", async () => {
    const repo = fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Old", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    const updated = await svc.updateItinerary("u-1", "a", { title: "New" });
    expect(updated.title).toBe("New");
  });

  it("rejects updating someone else's itinerary with PERSONAL_ITINERARY_NOT_FOUND", async () => {
    const repo = fakeRepo([{ id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.updateItinerary("u-1", "b", { title: "Hacked" })).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });

  it("deletes own itinerary", async () => {
    const repo = fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    const ok = await svc.deleteItinerary("u-1", "a");
    expect(ok).toEqual({ deleted: true });
    expect(await repo.listItinerariesForUser("u-1")).toHaveLength(0);
  });

  it("rejects deleting someone else's itinerary", async () => {
    const repo = fakeRepo([{ id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.deleteItinerary("u-1", "b")).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });
});

describe("personalService threads", () => {
  it("lists own threads only", async () => {
    const repo = {
      ...fakeRepo(),
      async listThreadsForUser(userId: string) {
        const all = [
          { id: "t1", createdByUserId: "u-1", title: "Mine", status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() },
          { id: "t2", createdByUserId: "u-2", title: "Theirs", status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() }
        ];
        return all.filter((t) => t.createdByUserId === userId);
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const list = await svc.listThreads("u-1");
    expect(list.map((t) => t.id)).toEqual(["t1"]);
  });

  it("creates a thread with default title", async () => {
    let created: any = null;
    const repo = {
      ...fakeRepo(),
      async createThreadForUser(input: any) {
        created = { id: "t-new", ...input, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        return created;
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const thread = await svc.createThread("u-1");
    expect(thread.title).toBe("New thread");
    expect(created.userId).toBe("u-1");
  });

  it("creates a thread with a custom title", async () => {
    let created: any = null;
    const repo = {
      ...fakeRepo(),
      async createThreadForUser(input: any) {
        created = { id: "t-new", ...input, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        return created;
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const thread = await svc.createThread("u-1", "Tokyo planning");
    expect(thread.title).toBe("Tokyo planning");
  });
});

describe("personalService shares", () => {
  it("creates a personal share for an own itinerary", async () => {
    const repo = {
      ...fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT" as const, version: 1, createdAt: new Date(), updatedAt: new Date() }]),
      async createShareForUserItinerary(input: any) {
        return { id: "s-1", token: "tok-abc", itineraryId: input.itineraryId, createdAt: new Date() };
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const share = await svc.createShare("u-1", { itineraryId: "a" });
    expect(share.token).toBe("tok-abc");
  });
});
