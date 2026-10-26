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
  setAgentPause: vi.fn(),
  clearAgentPause: vi.fn(),
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
    anonymize: mocks.anonymize,
    setAgentPause: mocks.setAgentPause,
    clearAgentPause: mocks.clearAgentPause
  })
}));
vi.mock("../src/modules/admin/accountRepository", () => ({
  adminAccountRepository: {
    listAccounts: vi.fn(async () => []),
    findAccount: mocks.findAccount,
    listAuditEvents: vi.fn(async () => []),
    listOwnedAgencies: vi.fn(async () => []),
    usageSince: vi.fn(async () => ({ costUsd: 0, runCount: 0, costComplete: true }))
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
  agentPausedAt: null,
  agentPausedUntil: null,
  agentPauseReason: null,
  providerAccounts: [],
  memberships: [],
  _count: { createdItineraries: 0, createdClientTrips: 0, createdAgentThreads: 0 }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTarget.mockResolvedValue({
    id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE",
    agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null
  });
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
      usageThisMonth: { costUsd: 0, runCount: 0, costComplete: true }
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
    mocks.findTarget.mockResolvedValue({
      id: USER_ID, email: "mara@hops.travel", role: "USER", status: "DISABLED",
      agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null
    });
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
    ["agent-pause", { duration: "24h", reason: "High usage" }],
    ["agent-resume", {}],
    ["delete", { confirmEmail: "mara@hops.travel" }]
  ])("%s answers 403 to anyone who is not a super admin", async (action, body) => {
    const res = await request(createApp(staff)).post(`/admin/users/${USER_ID}/${action}`).send(body);

    expect(res.status).toBe(403);
    expect(mocks.findTarget).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
    expect(mocks.anonymize).not.toHaveBeenCalled();
    expect(mocks.setAgentPause).not.toHaveBeenCalled();
    expect(mocks.clearAgentPause).not.toHaveBeenCalled();
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

describe("agent pause routes", () => {
  it("pauses with a duration and reason and returns the account with agentPause", async () => {
    mocks.findAccount.mockResolvedValue({
      ...detailRow,
      status: "ACTIVE",
      agentPausedAt: new Date("2026-10-25T08:00:00.000Z"),
      agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"),
      agentPauseReason: "High usage"
    });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "24h", reason: "High usage" });
    expect(res.status).toBe(200);
    expect(mocks.setAgentPause).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, adminUserId: "admin-1", duration: "24h", reason: "High usage" })
    );
    expect(res.body.user.agentPause).toMatchObject({ reason: "High usage", until: "2999-01-01T00:00:00.000Z" });
    expect(res.body.user).not.toHaveProperty("agentPausedAt");
    expect(res.body.user).not.toHaveProperty("agentPauseReason");
  });

  it("trims the reason before it is stored", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "indefinite", reason: "  Abuse  " });
    expect(res.status).toBe(200);
    expect(mocks.setAgentPause).toHaveBeenCalledWith(expect.objectContaining({ duration: "indefinite", until: null, reason: "Abuse" }));
  });

  it("requires a reason and a known duration", async () => {
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "24h" })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "24h", reason: "   " })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "1y", reason: "x" })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ reason: "x" })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`)).status).toBe(400);
    expect(mocks.setAgentPause).not.toHaveBeenCalled();
  });

  it("rejects a reason over 300 characters and unknown fields", async () => {
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "1h", reason: "x".repeat(301) })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "1h", reason: "x", force: true })).status).toBe(400);
    expect(mocks.setAgentPause).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID id", async () => {
    const res = await request(createApp()).post("/admin/users/not-a-uuid/agent-pause").send({ duration: "1h", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("resumes a paused user", async () => {
    mocks.findTarget.mockResolvedValue({
      id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE",
      agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "x"
    });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-resume`).send({});
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPause).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: null });
    expect(res.body.user.agentPause).toBeNull();
  });

  it("passes a resume note through to the audit row", async () => {
    mocks.findTarget.mockResolvedValue({
      id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE",
      agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "x"
    });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-resume`).send({ reason: "  Checked with the owner  " });
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPause).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: "Checked with the owner" });
  });

  it("resume with no body at all works, and a user who is not paused is a no-op success", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-resume`);
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPause).not.toHaveBeenCalled();
  });
});
