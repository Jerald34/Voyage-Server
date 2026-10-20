import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/http/errors";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  extendShare: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { extendShare: mocks.extendShare }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SHARE_ID = "cmpt0a1b20003eohoq8r7s6tu";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = { id: "user-1", role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", memberships: [] } as never;
    next();
  });
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const extend = (body: unknown, shareId: string = SHARE_ID) =>
  request(createApp()).patch(`/agencies/${AGENCY_ID}/shares/${shareId}/expiry`).send(body as object);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "STAFF" } });
});

describe("PATCH /agencies/:agencyId/shares/:shareId/expiry", () => {
  it("extends the link and clears the agency's cached dashboards", async () => {
    mocks.extendShare.mockResolvedValue({ id: SHARE_ID, expiresAt: "2026-10-27T12:00:00.000Z" });

    const response = await extend({ extendDays: 7 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ share: { id: SHARE_ID, expiresAt: "2026-10-27T12:00:00.000Z" } });
    expect(mocks.extendShare).toHaveBeenCalledWith(AGENCY_ID, SHARE_ID, 7);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("runs the same agency-member check as revoking a link", async () => {
    mocks.extendShare.mockResolvedValue({ id: SHARE_ID });
    await extend({ extendDays: 30 });
    expect(mocks.requireVerifiedAgencyMember).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), AGENCY_ID);
  });

  it("only offers 7 or 30 days", async () => {
    const response = await extend({ extendDays: 365 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.extendShare).not.toHaveBeenCalled();
  });

  it("rejects a missing or extra body field", async () => {
    expect((await extend({})).status).toBe(400);
    expect((await extend({ extendDays: 7, expiresAt: "2030-01-01T00:00:00Z" })).status).toBe(400);
    expect(mocks.extendShare).not.toHaveBeenCalled();
  });

  it("rejects a share id that is not a cuid", async () => {
    const response = await extend({ extendDays: 7 }, "not-a-cuid");
    expect(response.status).toBe(400);
    expect(mocks.extendShare).not.toHaveBeenCalled();
  });

  it("answers 404 for another agency's link, like revoking does", async () => {
    mocks.extendShare.mockRejectedValue(new ApiError(404, "SHARE_NOT_FOUND", "Share not found."));
    const response = await extend({ extendDays: 7 });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SHARE_NOT_FOUND");
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });

  it("answers 409 SHARE_REVOKED for a link that was turned off", async () => {
    mocks.extendShare.mockRejectedValue(
      new ApiError(409, "SHARE_REVOKED", "This link was turned off. Share the itinerary again instead.")
    );
    const response = await extend({ extendDays: 7 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SHARE_REVOKED");
  });

  it("answers 409 SHARE_NEVER_EXPIRES for a link with no expiry", async () => {
    mocks.extendShare.mockRejectedValue(new ApiError(409, "SHARE_NEVER_EXPIRES", "This link never expires."));
    const response = await extend({ extendDays: 7 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SHARE_NEVER_EXPIRES");
  });

  it("leaves the caches alone when the extension fails", async () => {
    mocks.extendShare.mockRejectedValue(new Error("boom"));
    await extend({ extendDays: 30 });
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
