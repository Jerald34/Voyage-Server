import express, { type Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const VALID_AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const VALID_ITINERARY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_SHARE_TOKEN = "share-token-12";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  forAgencyItinerary: vi.fn(),
  forShareToken: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/itineraries/itineraryService", () => ({ itineraryService: {} }));
vi.mock("../src/services/places/placeServices", () => ({
  createPlaceSession: vi.fn(),
  getPlaceRefreshScheduler: vi.fn()
}));
vi.mock("../src/modules/shares/shareService", () => ({ shareService: {} }));
vi.mock("../src/modules/reviews/reviewService", () => ({ reviewService: {} }));
vi.mock("../src/modules/weather/weatherService", () => ({
  itineraryWeatherService: {
    forAgencyItinerary: mocks.forAgencyItinerary,
    forShareToken: mocks.forShareToken
  }
}));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { itineraryRoutes } from "../src/modules/itineraries/itineraryRoutes";
import { publicShareRoutes } from "../src/modules/shares/publicShareRoutes";

const agencyUser = {
  id: "user-agency",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Agency User",
  memberships: []
};

const sampleWeather = {
  provider: "open-meteo",
  attribution: { text: "Weather data by Open-Meteo.com", url: "https://open-meteo.com/" },
  days: [{ dayId: "day-1", dayNumber: 1, date: "2026-10-10", status: "NO_LOCATION", weather: null }]
};

function createRouteApp(mountPath: string, router: Router, authUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authUser) req.authUser = authUser as any;
    next();
  });
  app.use(mountPath, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: VALID_AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.forAgencyItinerary.mockResolvedValue(sampleWeather);
  mocks.forShareToken.mockResolvedValue(sampleWeather);
});

describe("GET /agencies/:agencyId/itineraries/:itineraryId/weather", () => {
  const path = `/agencies/${VALID_AGENCY_ID}/itineraries/${VALID_ITINERARY_ID}/weather`;

  it("returns weather to a verified member", async () => {
    const app = createRouteApp("/agencies/:agencyId/itineraries", itineraryRoutes, agencyUser);

    const res = await request(app).get(path);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weather: sampleWeather });
    expect(mocks.forAgencyItinerary).toHaveBeenCalledWith(VALID_AGENCY_ID, VALID_ITINERARY_ID);
  });

  it("requires sign-in", async () => {
    const app = createRouteApp("/agencies/:agencyId/itineraries", itineraryRoutes);

    const res = await request(app).get(path);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("AUTH_REQUIRED");
    expect(mocks.forAgencyItinerary).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID itinerary id", async () => {
    const app = createRouteApp("/agencies/:agencyId/itineraries", itineraryRoutes, agencyUser);

    const res = await request(app).get(`/agencies/${VALID_AGENCY_ID}/itineraries/not-a-uuid/weather`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses users without agency access", async () => {
    mocks.requireVerifiedAgencyMember.mockRejectedValue(
      new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.")
    );
    const app = createRouteApp("/agencies/:agencyId/itineraries", itineraryRoutes, agencyUser);

    const res = await request(app).get(path);

    expect(res.status).toBe(403);
    expect(mocks.forAgencyItinerary).not.toHaveBeenCalled();
  });

  it("passes through another agency's itinerary as 404", async () => {
    mocks.forAgencyItinerary.mockRejectedValue(new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found."));
    const app = createRouteApp("/agencies/:agencyId/itineraries", itineraryRoutes, agencyUser);

    const res = await request(app).get(path);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ITINERARY_NOT_FOUND");
  });
});

describe("GET /shared/:token/weather", () => {
  it("returns weather for a valid token without sign-in", async () => {
    const app = createRouteApp("/shared", publicShareRoutes);

    const res = await request(app).get(`/shared/${VALID_SHARE_TOKEN}/weather`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weather: sampleWeather });
    expect(mocks.forShareToken).toHaveBeenCalledWith(VALID_SHARE_TOKEN);
  });

  it("rejects malformed tokens before any lookup", async () => {
    const app = createRouteApp("/shared", publicShareRoutes);

    const res = await request(app).get("/shared/short/weather");

    expect(res.status).toBe(400);
    expect(mocks.forShareToken).not.toHaveBeenCalled();
  });

  it("maps a revoked share to 410", async () => {
    mocks.forShareToken.mockRejectedValue(new ApiError(410, "SHARE_REVOKED", "This share link has been revoked."));
    const app = createRouteApp("/shared", publicShareRoutes);

    const res = await request(app).get(`/shared/${VALID_SHARE_TOKEN}/weather`);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("SHARE_REVOKED");
  });
});
