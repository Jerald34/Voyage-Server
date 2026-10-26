// tests/adminAccountActionRoutes.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  findTarget: vi.fn(),
  listOwnedAgencies: vi.fn(),
  setStatus: vi.fn(),
  revokeSessions: vi.fn(),
  anonymize: vi.fn(),
  findAccount: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/agencyService", () => ({ agencyService: {} }));
vi.mock("../src/modules/support/supportService", () => ({ supportService: {} }));
vi.mock("../src/modules/admin/accountActionRepository", () => ({
  findOwnedAgencies: vi.fn(),
  createPrismaAccountActionRepository: () => ({
    findTarget: mocks.findTarget,
    listOwnedAgencies: mocks.listOwnedAgencies,
    setStatus: mocks.setStatus,
    revokeSessions: mocks.revokeSessions,
    anonymize: mocks.anonymize
  })
}));
vi.mock("../src/modules/admin/accountRepository", () => ({
  adminAccountRepository: {
    listAccounts: vi.fn(async () => []),
    findAccount: mocks.findAccount,
    listAuditEvents: vi.fn(async () => []),
    listOwnedAgencies: vi.fn(async () => []),
    usageSince: vi.fn(async () => ({ costUsd: 0, runCount: 0 }))
  }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { adminRoutes } from "../src/modules/admin/adminRoutes";

const admin = { id: "admin-1", role: "SUPER_ADMIN", status: "ACTIVE", memberships: [] };
const staff = { id: "user-9", role: "USER", status: "ACTIVE", memberships: [] };

function createApp(authUser: Record<string, unknown> = admin) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = authUser as any;
    next();
  });
  app.use("/admin", adminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const detailRow = {
  id: USER_ID,
  email: "mara@hops.travel",
  displayName: "Mara Santos",
  role: "USER",
  status: "DISABLED",
  accountType: "AGENCY_USER",
  emailVerifiedAt: null,
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  updatedAt: new Date("2026-10-25T00:00:00.000Z"),
  passwordHash: null,
  providerAccounts: [],
  memberships: [],
  _count: { createdItineraries: 0, createdClientTrips: 0, createdAgentThreads: 0 }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTarget.mockResolvedValue({ id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE" });
  mocks.listOwnedAgencies.mockResolvedValue([]);
  mocks.findAccount.mockResolvedValue(detailRow);
});

describe("POST /admin/users/:userId/disable", () => {
  it("disables and answers with the refreshed account", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`).send({ reason: "spam" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: USER_ID,
      status: "DISABLED",
      auditEvents: [],
      ownedAgencies: [],
      usageThisMonth: { costUsd: 0, runCount: 0 }
    });
    expect(mocks.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: "spam" });
  });

  it("works with no body at all", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`);
    expect(res.status).toBe(200);
  });

  it("rejects unknown body fields", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`).send({ reason: "x", force: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-UUID id", async () => {
    const res = await request(createApp()).post("/admin/users/not-a-uuid/disable").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/users/:userId/enable and /sign-out", () => {
  it("enables", async () => {
    mocks.findTarget.mockResolvedValue({ id: USER_ID, email: "mara@hops.travel", role: "USER", status: "DISABLED" });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/enable`).send({});
    expect(res.status).toBe(200);
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" }));
  });

  it("signs out everywhere", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/sign-out`).send({});
    expect(res.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: null });
  });

  it("stores a null reason as no reason", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/sign-out`).send({ reason: null });
    expect(res.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: null });
  });

  it("stores a blank reason as no reason", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/sign-out`).send({ reason: "   " });
    expect(res.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: null });
  });
});

describe("every account action is super-admin only", () => {
  it.each([
    ["disable", {}],
    ["enable", {}],
    ["sign-out", {}],
    ["delete", { confirmEmail: "mara@hops.travel" }]
  ])("%s answers 403 to anyone who is not a super admin", async (action, body) => {
    const res = await request(createApp(staff)).post(`/admin/users/${USER_ID}/${action}`).send(body);

    expect(res.status).toBe(403);
    expect(mocks.findTarget).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });
});

describe("POST /admin/users/:userId/delete", () => {
  it("anonymizes and answers 204", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel", reason: "Asked" });
    expect(res.status).toBe(204);
    expect(mocks.anonymize).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, reason: "Asked", transfer: null }));
  });

  it("treats a null reason as no reason", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel", reason: null });
    expect(res.status).toBe(204);
    expect(mocks.anonymize).toHaveBeenCalledWith(expect.objectContaining({ reason: null }));
  });

  it("needs confirmEmail", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({});
    expect(res.status).toBe(400);
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("explains a solo owner with the agency in the error body", async () => {
    mocks.listOwnedAgencies.mockResolvedValue([{ agencyId: AGENCY_ID, agencyName: "Bayani Tours", successors: [] }]);
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OWNER_HAS_NO_SUCCESSOR", agencyId: AGENCY_ID, agencyName: "Bayani Tours" });
  });

  it("rejects a malformed newOwnerUserId", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel", newOwnerUserId: "bob" });
    expect(res.status).toBe(400);
  });
});
