import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  createShare: vi.fn(),
  revokeShare: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { createShare: mocks.createShare, revokeShare: mocks.revokeShare }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const ITINERARY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "OWNER" } });
});

describe("share link changes refresh the dashboard", () => {
  it("clears the caches after a link is created", async () => {
    mocks.createShare.mockResolvedValue({ id: SHARE_ID });
    const response = await request(createApp()).post(`/agencies/${AGENCY_ID}/shares/${ITINERARY_ID}`).send({});
    expect(response.status).toBe(201);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("clears the caches after a link is revoked", async () => {
    mocks.revokeShare.mockResolvedValue({ id: SHARE_ID });
    const response = await request(createApp()).delete(`/agencies/${AGENCY_ID}/shares/${SHARE_ID}`);
    expect(response.status).toBe(200);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("leaves the caches alone when revoking fails", async () => {
    mocks.revokeShare.mockRejectedValue(new Error("boom"));
    await request(createApp()).delete(`/agencies/${AGENCY_ID}/shares/${SHARE_ID}`);
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
