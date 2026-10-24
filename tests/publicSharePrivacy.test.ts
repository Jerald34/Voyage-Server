import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_SHARE_TOKEN = "share-token-12";

const mocks = vi.hoisted(() => ({
  findShareByToken: vi.fn(),
  incrementViewCount: vi.fn(),
  addComment: vi.fn(),
  listCommentsByShareId: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/shares/shareRepository", () => ({
  shareRepository: {
    findShareByToken: mocks.findShareByToken,
    incrementViewCount: mocks.incrementViewCount,
    addComment: mocks.addComment,
    listCommentsByShareId: mocks.listCommentsByShareId
  }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));
vi.mock("../src/modules/reviews/reviewService", () => ({ reviewService: {} }));
vi.mock("../src/modules/weather/weatherService", () => ({ itineraryWeatherService: {} }));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { publicShareRoutes } from "../src/modules/shares/publicShareRoutes";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/shared", publicShareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const PRIVATE_EMAIL = "client@private.example";
const COMMENTER_EMAIL = "commenter@private.example";

function shareData(overrides: { agency?: unknown } = {}) {
  return {
    share: {
      id: "share-1",
      token: VALID_SHARE_TOKEN,
      itineraryId: "it-1",
      tripId: "trip-1",
      agencyId: "agency-1",
      clientName: "Reyes",
      clientEmail: PRIVATE_EMAIL,
      expiresAt: null,
      revokedAt: null,
      viewCount: 41,
      lastViewedAt: new Date("2026-10-21T00:00:00.000Z"),
      proposalRating: 4,
      proposalRatingComment: "Lovely",
      proposalRatedAt: new Date("2026-10-22T00:00:00.000Z"),
      createdAt: new Date("2026-10-20T00:00:00.000Z"),
      updatedAt: new Date("2026-10-20T00:00:00.000Z")
    },
    trip: {
      id: "trip-1",
      title: "Reyes family",
      clientName: "Reyes",
      startDate: new Date("2026-11-02T00:00:00.000Z"),
      endDate: new Date("2026-11-03T00:00:00.000Z"),
      travelerCount: 4,
      destinationSummary: "Baguio"
    },
    agency:
      overrides.agency !== undefined
        ? overrides.agency
        : { id: "agency-1", name: "Wanderlust", logoImage: { bucket: "voyage-assets", objectKey: "logos/wanderlust-mark.png" } },
    creator: { id: "user-1", displayName: "Alice" },
    itinerary: {
      id: "it-1",
      title: "Baguio weekend",
      summary: "Two easy days",
      version: 3,
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: new Date("2026-11-02T00:00:00.000Z"),
          title: "Arrival",
          summary: null,
          items: [
            {
              id: "item-1",
              sortOrder: 0,
              type: "ACTIVITY",
              title: "Burnham Park",
              description: null,
              startTime: "09:00",
              endTime: "10:00",
              clientNotes: null,
              placeSnapshot: null
            }
          ]
        }
      ]
    }
  };
}

function commentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    shareId: "share-1",
    authorName: "Jhoy",
    authorEmail: COMMENTER_EMAIL,
    content: "Start later?",
    dayNumber: 1,
    itemId: null,
    status: "ADDRESSED",
    agencyReply: "Done",
    agencyRepliedAt: new Date("2026-10-22T01:00:00.000Z"),
    createdAt: new Date("2026-10-22T00:00:00.000Z"),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findShareByToken.mockResolvedValue(shareData());
  mocks.incrementViewCount.mockResolvedValue(undefined);
});

describe("GET /shared/:token sends only what the share page shows", () => {
  it("answers with brand, trip, itinerary, the link's client-facing fields and the revision", async () => {
    const response = await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["brand", "itinerary", "revision", "share", "trip"]);
    expect(response.body.share).toEqual({
      clientName: "Reyes",
      proposalRating: 4,
      proposalRatingComment: "Lovely",
      proposalRatedAt: "2026-10-22T00:00:00.000Z"
    });
    expect(response.body.trip).toEqual({
      title: "Reyes family",
      clientName: "Reyes",
      startDate: "2026-11-02T00:00:00.000Z",
      endDate: "2026-11-03T00:00:00.000Z",
      travelerCount: 4,
      destinationSummary: "Baguio"
    });
    expect(response.body.brand).toEqual({
      type: "agency",
      name: "Wanderlust",
      logoUrl: "https://storage.googleapis.com/voyage-assets/logos/wanderlust-mark.png"
    });
    expect(response.body.itinerary).toMatchObject({ title: "Baguio weekend", summary: "Two easy days", version: 3 });
    expect(response.body.itinerary.days[0].items[0]).toMatchObject({ id: "item-1", title: "Burnham Park" });
  });

  it("is not a view: loading (or reloading, or Show latest) never counts one", async () => {
    await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}`);
    await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.incrementViewCount).not.toHaveBeenCalled();
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });

  it("never carries the client's email, view stats or internal ids", async () => {
    const response = await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}`);
    const text = JSON.stringify(response.body);

    expect(text).not.toContain(PRIVATE_EMAIL);
    expect(text).not.toContain("clientEmail");
    expect(text).not.toContain("viewCount");
    expect(text).not.toContain("lastViewedAt");
    expect(text).not.toContain("agency-1");
    expect(text).not.toContain("user-1");
    expect(text).not.toContain("share-1");
    expect(text).not.toContain("trip-1");
    expect(text).not.toContain("objectKey");
    expect(response.body.itinerary).not.toHaveProperty("id");
  });

  it("keeps a personal share's brand and has no trip", async () => {
    mocks.findShareByToken.mockResolvedValue({ ...shareData({ agency: null }), trip: null, share: { ...shareData().share, agencyId: null, tripId: null } });

    const response = await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.brand).toEqual({ type: "personal", displayName: "Alice" });
    expect(response.body.trip).toBeNull();
  });
});

describe("public comments never show anyone's email", () => {
  it("GET /shared/:token/comments lists comments without author emails or share ids", async () => {
    mocks.listCommentsByShareId.mockResolvedValue([commentRecord(), commentRecord({ id: "c-2", authorEmail: null, status: "PENDING", agencyReply: null, agencyRepliedAt: null })]);

    const response = await request(createApp()).get(`/shared/${VALID_SHARE_TOKEN}/comments`);

    expect(response.status).toBe(200);
    expect(response.body.comments).toEqual([
      {
        id: "c-1",
        authorName: "Jhoy",
        content: "Start later?",
        dayNumber: 1,
        itemId: null,
        status: "ADDRESSED",
        agencyReply: "Done",
        agencyRepliedAt: "2026-10-22T01:00:00.000Z",
        createdAt: "2026-10-22T00:00:00.000Z"
      },
      {
        id: "c-2",
        authorName: "Jhoy",
        content: "Start later?",
        dayNumber: 1,
        itemId: null,
        status: "PENDING",
        agencyReply: null,
        agencyRepliedAt: null,
        createdAt: "2026-10-22T00:00:00.000Z"
      }
    ]);
    expect(JSON.stringify(response.body)).not.toContain(COMMENTER_EMAIL);
  });

  it("POST /shared/:token/comments still saves the email but does not echo it back", async () => {
    mocks.addComment.mockResolvedValue(commentRecord({ status: "PENDING", agencyReply: null, agencyRepliedAt: null }));

    const response = await request(createApp())
      .post(`/shared/${VALID_SHARE_TOKEN}/comments`)
      .send({ authorName: "Jhoy", authorEmail: COMMENTER_EMAIL, content: "Start later?", dayNumber: 1 });

    expect(response.status).toBe(201);
    expect(mocks.addComment).toHaveBeenCalledWith("share-1", expect.objectContaining({ authorEmail: COMMENTER_EMAIL }));
    expect(response.body.comment).toMatchObject({ id: "c-1", authorName: "Jhoy", status: "PENDING" });
    expect(response.body.comment).not.toHaveProperty("authorEmail");
    expect(response.body.comment).not.toHaveProperty("shareId");
  });
});
