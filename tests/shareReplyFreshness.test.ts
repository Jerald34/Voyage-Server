import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  replyToComment: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { replyToComment: mocks.replyToComment }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
// ItineraryComment ids are Prisma cuid()s.
const COMMENT_ID = "cmpt0a1b20003eohoq8r7s6tu";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = {
      id: "user-1",
      role: "USER",
      status: "ACTIVE",
      accountType: "AGENCY_USER",
      memberships: []
    } as never;
    next();
  });
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function reply() {
  return request(createApp())
    .post(`/agencies/${AGENCY_ID}/shares/comments/${COMMENT_ID}/reply`)
    .send({ content: "Yes, we can swap it." });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "OWNER" } });
});

describe("POST /agencies/:agencyId/shares/comments/:commentId/reply", () => {
  it("clears the agency's cached dashboards once the reply is saved", async () => {
    mocks.replyToComment.mockImplementation(async () => {
      // Not before the reply is saved: a failed reply leaves the caches alone.
      expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
      return { id: COMMENT_ID, status: "ADDRESSED" };
    });

    const response = await reply();

    expect(response.status).toBe(200);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledOnce();
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("leaves the caches alone when the reply fails", async () => {
    mocks.replyToComment.mockRejectedValue(new Error("database down"));

    const response = await reply();

    expect(response.status).toBe(500);
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
