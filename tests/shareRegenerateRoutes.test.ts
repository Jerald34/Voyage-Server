import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/http/errors";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  regenerateShare: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { regenerateShare: mocks.regenerateShare }
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

const regenerate = (shareId: string = SHARE_ID, body: object = {}) =>
  request(createApp()).post(`/agencies/${AGENCY_ID}/shares/${shareId}/regenerate`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "STAFF" } });
});

describe("POST /agencies/:agencyId/shares/:shareId/regenerate", () => {
  it("answers with the new link and clears the agency's cached dashboards", async () => {
    mocks.regenerateShare.mockResolvedValue({ id: "cmpt0a1b20003eohoq8r7s6tv", token: "new-token-12", clientName: "Reyes" });

    const response = await regenerate();

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ share: { id: "cmpt0a1b20003eohoq8r7s6tv", token: "new-token-12", clientName: "Reyes" } });
    expect(mocks.regenerateShare).toHaveBeenCalledWith(AGENCY_ID, SHARE_ID);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
    expect(mocks.requireVerifiedAgencyMember).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), AGENCY_ID);
  });

  it("takes no body", async () => {
    const response = await regenerate(SHARE_ID, { clientEmail: "someone@example.com" });
    expect(response.status).toBe(400);
    expect(mocks.regenerateShare).not.toHaveBeenCalled();
  });

  it("rejects a share id that is not a cuid", async () => {
    const response = await regenerate("not-a-cuid");
    expect(response.status).toBe(400);
    expect(mocks.regenerateShare).not.toHaveBeenCalled();
  });

  it("passes on a refusal and leaves the caches alone", async () => {
    mocks.regenerateShare.mockRejectedValue(new ApiError(409, "SHARE_REVOKED", "This link was turned off."));

    const response = await regenerate();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SHARE_REVOKED");
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
