import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_SHARE_TOKEN = "share-token-12";

const mocks = vi.hoisted(() => ({
  findShareByToken: vi.fn(),
  incrementViewCount: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/shares/shareRepository", () => ({
  shareRepository: {
    findShareByToken: mocks.findShareByToken,
    incrementViewCount: mocks.incrementViewCount
  }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));
vi.mock("../src/modules/reviews/reviewService", () => ({ reviewService: {} }));
vi.mock("../src/modules/weather/weatherService", () => ({ itineraryWeatherService: {} }));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { publicShareRoutes } from "../src/modules/shares/publicShareRoutes";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/shared", publicShareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function shareData(overrides: { share?: Record<string, unknown>; stopTitle?: string; stopCount?: number } = {}) {
  const stopTitle = overrides.stopTitle ?? "Burnham Park";
  const stops = [{ id: "s-1", title: stopTitle }, { id: "s-2", title: "Session Road" }, { id: "s-3", title: "Mines View" }]
    .slice(0, overrides.stopCount ?? 2)
    .map((entry, index) => ({
      id: entry.id,
      sortOrder: index,
      type: "ACTIVITY",
      title: entry.title,
      description: null,
      startTime: "09:00",
      endTime: "10:00",
      clientNotes: null,
      placeSnapshot: null
    }));

  return {
    share: {
      id: "share-1",
      token: VALID_SHARE_TOKEN,
      itineraryId: "it-1",
      tripId: "trip-1",
      agencyId: "agency-1",
      clientName: null,
      clientEmail: null,
      expiresAt: null,
      revokedAt: null,
      viewCount: 3,
      lastViewedAt: null,
      createdAt: new Date("2026-10-20T00:00:00.000Z"),
      updatedAt: new Date("2026-10-20T00:00:00.000Z"),
      ...overrides.share
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
    agency: { id: "agency-1", name: "Wanderlust", logoImage: null },
    creator: { id: "u-1", displayName: "Alice" },
    itinerary: {
      id: "it-1",
      title: "Baguio weekend",
      summary: null,
      version: 1,
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: new Date("2026-11-02T00:00:00.000Z"),
          title: "Arrival",
          summary: null,
          items: stops
        }
      ]
    }
  };
}

const getRevision = (token: string = VALID_SHARE_TOKEN) => request(createApp()).get(`/shared/${token}/revision`);
const getShare = (token: string = VALID_SHARE_TOKEN) => request(createApp()).get(`/shared/${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findShareByToken.mockResolvedValue(shareData());
  mocks.incrementViewCount.mockResolvedValue(undefined);
});

describe("GET /shared/:token (revision field)", () => {
  it("adds a top-level revision beside the public fields", async () => {
    const response = await getShare();

    expect(response.status).toBe(200);
    expect(response.body.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(response.body).sort()).toEqual(["brand", "itinerary", "revision", "share", "trip"]);
    expect(response.body.itinerary.days[0].items).toHaveLength(2);
    expect(response.body.brand).toEqual({ type: "agency", name: "Wanderlust", logoUrl: null });
  });
});

describe("GET /shared/:token/revision", () => {
  it("answers with only the revision", async () => {
    const response = await getRevision();

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(["revision"]);
    expect(response.body.revision).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches the revision the main share response carries for the same data", async () => {
    const main = await getShare();
    const check = await getRevision();

    expect(check.status).toBe(200);
    expect(check.body.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(check.body.revision).toBe(main.body.revision);
  });

  it("is not a view: it never counts one or reports agency activity", async () => {
    expect((await getRevision()).status).toBe(200);
    expect((await getRevision()).status).toBe(200);
    await flush();

    expect(mocks.incrementViewCount).not.toHaveBeenCalled();
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });

  it("recording a view counts one (so the spies are live)", async () => {
    const response = await request(createApp()).post(`/shared/${VALID_SHARE_TOKEN}/view`);

    expect(response.status).toBe(204);
    expect(mocks.incrementViewCount).toHaveBeenCalledWith("share-1");
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith("agency-1");
  });

  it("is never cached", async () => {
    const response = await getRevision();

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("changes after the agency edits the itinerary", async () => {
    const before = await getRevision();

    mocks.findShareByToken.mockResolvedValue(shareData({ stopTitle: "Burnham Park lake" }));
    const renamed = await getRevision();

    mocks.findShareByToken.mockResolvedValue(shareData({ stopCount: 3 }));
    const added = await getRevision();

    expect(renamed.body.revision).not.toBe(before.body.revision);
    expect(added.body.revision).not.toBe(before.body.revision);
    expect(added.body.revision).not.toBe(renamed.body.revision);
  });

  it("stays put when only a view count or the expiry changes", async () => {
    const before = await getRevision();

    mocks.findShareByToken.mockResolvedValue(
      shareData({ share: { viewCount: 99, lastViewedAt: new Date("2026-10-21T08:00:00.000Z"), expiresAt: new Date("2099-01-01T00:00:00.000Z") } })
    );
    const after = await getRevision();

    expect(before.body.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(after.body.revision).toBe(before.body.revision);
  });

  it("answers 404 for an unknown token", async () => {
    mocks.findShareByToken.mockResolvedValue(null);

    const response = await getRevision();

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SHARE_NOT_FOUND");
  });

  it("answers 410 for a revoked link", async () => {
    mocks.findShareByToken.mockResolvedValue(shareData({ share: { revokedAt: new Date("2026-10-21T00:00:00.000Z") } }));

    const response = await getRevision();

    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe("SHARE_REVOKED");
  });

  it("answers 410 for an expired link", async () => {
    mocks.findShareByToken.mockResolvedValue(shareData({ share: { expiresAt: new Date("2020-01-01T00:00:00.000Z") } }));

    const response = await getRevision();

    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe("SHARE_EXPIRED");
  });

  it("rejects a malformed token without reading the share", async () => {
    const response = await getRevision("short");

    expect(response.status).toBe(400);
    expect(mocks.findShareByToken).not.toHaveBeenCalled();
  });
});
