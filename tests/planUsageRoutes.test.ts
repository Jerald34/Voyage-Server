import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
// Deliberately different from the URL param, so the route must use the access result's agency id.
const RESOLVED_AGENCY_ID = "resolved-id";

const mocks = vi.hoisted(() => ({
  requireAgencyOwner: vi.fn(),
  getPlanUsage: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireAgencyOwner: mocks.requireAgencyOwner, requireVerifiedAgencyMember: vi.fn() }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({ dashboardService: { getDashboard: vi.fn() } }));
vi.mock("../src/modules/dashboard/calendarService", () => ({ calendarService: { getCalendar: vi.fn() } }));
vi.mock("../src/modules/dashboard/planUsageService", () => ({ getPlanUsage: mocks.getPlanUsage }));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const owner = { id: "user-owner", role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", displayName: "Owner", memberships: [] };
const usage = { periodStart: "2026-09-30T16:00:00.000Z", periodEnd: "2026-10-31T16:00:00.000Z", itinerariesCreated: 12, agentRequests: 85, activeMembers: 3 };

function createApp(authUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authUser) req.authUser = authUser as any;
    next();
  });
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAgencyOwner.mockResolvedValue({ agency: { id: RESOLVED_AGENCY_ID }, membership: { role: "OWNER", status: "ACTIVE" } });
  mocks.getPlanUsage.mockResolvedValue(usage);
});

describe("GET /agencies/:agencyId/dashboard/plan-usage", () => {
  it("answers the owner with this month's usage", async () => {
    const res = await request(createApp(owner)).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usage });
    expect(mocks.requireAgencyOwner).toHaveBeenCalledWith(owner, AGENCY_ID);
    expect(mocks.getPlanUsage).toHaveBeenCalledWith(RESOLVED_AGENCY_ID);
  });

  it("refuses anyone who isn't the owner", async () => {
    mocks.requireAgencyOwner.mockRejectedValue(new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can perform this action."));

    const res = await request(createApp(owner)).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);

    expect(res.status).toBe(403);
    expect(mocks.getPlanUsage).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    const res = await request(createApp()).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);
    expect(res.status).toBe(401);
  });
});
