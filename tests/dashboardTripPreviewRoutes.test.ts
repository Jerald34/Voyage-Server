import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  getTripPreview: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({ dashboardService: { getDashboard: vi.fn() } }));
vi.mock("../src/modules/dashboard/calendarService", () => ({ calendarService: { getCalendar: vi.fn() } }));
vi.mock("../src/modules/dashboard/tripPreviewService", () => ({
  tripPreviewService: { getTripPreview: mocks.getTripPreview }
}));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const user = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff Member",
  memberships: []
};

function createApp(authUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authUser) req.authUser = authUser as never;
    next();
  });
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const preview = { trip: { id: TRIP_ID, title: "Kyoto" }, share: null, comments: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.getTripPreview.mockResolvedValue(preview);
});

describe("GET /agencies/:agencyId/dashboard/trips/:tripId", () => {
  it("returns the trip panel's data for a member", async () => {
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(preview);
    expect(mocks.requireVerifiedAgencyMember).toHaveBeenCalledWith(user, AGENCY_ID);
    expect(mocks.getTripPreview).toHaveBeenCalledWith(AGENCY_ID, TRIP_ID);
  });

  it("requires sign-in", async () => {
    const response = await request(createApp()).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(401);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("rejects a trip id that is not a UUID", async () => {
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/not-a-trip`);
    expect(response.status).toBe(400);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("refuses a member without an active membership", async () => {
    mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: null });
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(403);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("refuses an agency the user does not belong to before reading any trip", async () => {
    mocks.requireVerifiedAgencyMember.mockRejectedValue(new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found."));
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(404);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("answers 404, not 403, for a trip that belongs to another agency", async () => {
    mocks.getTripPreview.mockRejectedValue(new ApiError(404, "TRIP_NOT_FOUND", "Trip not found."));
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TRIP_NOT_FOUND");
  });
});
