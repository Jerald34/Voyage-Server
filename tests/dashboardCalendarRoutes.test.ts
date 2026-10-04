import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  getCalendar: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({
  dashboardService: { getDashboard: vi.fn() }
}));
vi.mock("../src/modules/dashboard/calendarService", () => ({
  calendarService: { getCalendar: mocks.getCalendar }
}));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const staffUser = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff Member",
  memberships: []
};

const payload = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T04:00:00.000Z",
  tripsWithoutDates: 0,
  trips: [],
  events: []
};

const path = (query: string) => `/agencies/${AGENCY_ID}/dashboard/calendar?${query}`;

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
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.getCalendar.mockResolvedValue(payload);
});

describe("GET /agencies/:agencyId/dashboard/calendar", () => {
  it("returns the calendar for the caller's role", async () => {
    const response = await request(createApp(staffUser)).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(mocks.getCalendar).toHaveBeenCalledWith({
      agencyId: AGENCY_ID,
      userId: "user-staff",
      role: "STAFF",
      from: "2026-09-27",
      to: "2026-11-07"
    });
  });

  it("requires sign-in", async () => {
    const response = await request(createApp()).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(401);
    expect(mocks.getCalendar).not.toHaveBeenCalled();
  });

  it("refuses people who are not members of the agency", async () => {
    mocks.requireVerifiedAgencyMember.mockResolvedValue({
      agency: { id: AGENCY_ID, status: "VERIFIED" },
      membership: null
    });

    const response = await request(createApp(staffUser)).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("AGENCY_ACCESS_REQUIRED");
  });

  it("rejects dates that are not YYYY-MM-DD", async () => {
    const response = await request(createApp(staffUser)).get(path("from=27-09-2026&to=2026-11-07"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.getCalendar).not.toHaveBeenCalled();
  });

  it("passes on range errors from the calendar service", async () => {
    mocks.getCalendar.mockRejectedValue(new ApiError(400, "CALENDAR_RANGE_INVALID", "Too long."));

    const response = await request(createApp(staffUser)).get(path("from=2026-01-01&to=2026-12-31"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CALENDAR_RANGE_INVALID");
  });
});
