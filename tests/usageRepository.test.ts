import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  threadFindMany: vi.fn(),
  userFindMany: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    agentRun: { findMany: m.runFindMany, findUnique: m.runFindUnique, findFirst: m.runFindFirst },
    agentThread: { findMany: m.threadFindMany },
    user: { findMany: m.userFindMany }
  }
}));

import { usageRepository } from "../src/modules/admin/usageRepository";

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-25T12:00:00Z");

const run = (over = {}) => ({
  id: "r1",
  status: "FAILED",
  createdAt: new Date("2026-10-02T10:00:00Z"),
  usageUserId: "u1",
  agencyId: "ag1",
  threadId: "t1",
  promptTokens: 100,
  outputTokens: 40,
  thoughtsTokens: 10,
  totalTokens: 150,
  cachedTokens: 50,
  costUsd: { toString: () => "0.0125" },
  costComplete: false,
  usageDetail: [
    { modelName: "gemini-3.5-flash-lite", costUsd: 0.0125 },
    { modelName: "mystery", costUsd: null }
  ],
  agency: { name: "Alpha" },
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  m.runFindMany.mockResolvedValue([run()]);
  m.threadFindMany.mockResolvedValue([{ id: "t1", title: "Baguio 3D" }]);
  m.userFindMany.mockResolvedValue([
    {
      id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [{ agencyId: "ag1", role: "OWNER" }],
      agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null
    }
  ]);
});

describe("usageRepository.listRunUsage", () => {
  it("reads completed and failed metered runs in range and joins user, role, agency and chat", async () => {
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });

    expect(m.runFindMany.mock.calls[0][0].where).toEqual({
      status: { in: ["COMPLETED", "FAILED"] },
      createdAt: { gte: FROM, lt: TO },
      totalTokens: { not: null }
    });
    expect(rows).toEqual([
      expect.objectContaining({
        runId: "r1",
        status: "FAILED",
        userLabel: "Ana",
        accountType: "AGENCY_USER",
        roleTag: "OWNER",
        agencyLabel: "Alpha",
        threadTitle: "Baguio 3D",
        costUsd: 0.0125,
        costComplete: false,
        modelNames: ["gemini-3.5-flash-lite", "mystery"],
        unpricedModelNames: ["mystery"],
        callCount: 2,
        userAgentPause: null,
        userIsSuperAdmin: false
      })
    ]);
  });

  it("marks a super admin's rows so the Usage tab doesn't offer to pause them", async () => {
    m.runFindMany.mockResolvedValue([run(), run({ id: "r2", usageUserId: "u2" }), run({ id: "r3", usageUserId: null, agencyId: null, agency: null })]);
    m.userFindMany.mockResolvedValue([
      { id: "u1", displayName: "Ana", role: "USER", accountType: "AGENCY_USER", memberships: [] },
      { id: "u2", displayName: "Root", role: "SUPER_ADMIN", accountType: "AGENCY_USER", memberships: [] }
    ]);
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });
    expect(rows.map((r) => r.userIsSuperAdmin)).toEqual([false, true, false]);
  });

  it("selects only the pause fields it needs and gives a paused user's row the active pause", async () => {
    m.userFindMany.mockResolvedValue([
      {
        id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [],
        agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"), agentPauseReason: "High usage"
      }
    ]);
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });

    expect(m.userFindMany.mock.calls[0][0].select).toEqual({
      id: true,
      displayName: true,
      accountType: true,
      role: true,
      memberships: { select: { agencyId: true, role: true } },
      agentPausedAt: true,
      agentPausedUntil: true,
      agentPauseReason: true
    });
    expect(rows[0]!.userAgentPause).toEqual({ pausedAt: "2026-10-25T07:00:00.000Z", until: "2999-01-01T00:00:00.000Z", reason: "High usage" });
  });

  it("treats an ended pause as no pause, and a run with no user as not paused", async () => {
    m.runFindMany.mockResolvedValue([run(), run({ id: "r2", usageUserId: null, agencyId: null, agency: null })]);
    m.userFindMany.mockResolvedValue([
      {
        id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [],
        agentPausedAt: new Date("2020-01-01T00:00:00.000Z"), agentPausedUntil: new Date("2020-01-02T00:00:00.000Z"), agentPauseReason: "Old"
      }
    ]);
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });
    expect(rows.map((r) => r.userAgentPause)).toEqual([null, null]);
  });

  it("tags personal accounts PERSONAL and people who left the agency as null", async () => {
    m.runFindMany.mockResolvedValue([run(), run({ id: "r2", usageUserId: "u2", agencyId: null, agency: null })]);
    m.userFindMany.mockResolvedValue([
      { id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [] },
      { id: "u2", displayName: "Ben", accountType: "PERSONAL", memberships: [] }
    ]);
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });
    expect(rows.map((r) => r.roleTag)).toEqual([null, "PERSONAL"]);
  });

  it("filters and limits for a drill-in, newest first", async () => {
    await usageRepository.listRunUsage({ from: FROM, to: TO }, { filter: { threadId: "t1" }, take: 50 });
    const args = m.runFindMany.mock.calls[0][0];
    expect(args.where.threadId).toBe("t1");
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(50);
  });

  it("maps a userId filter onto usageUserId", async () => {
    await usageRepository.listRunUsage({ from: FROM, to: TO }, { filter: { userId: "u1" }, take: 50 });
    expect(m.runFindMany.mock.calls[0][0].where.usageUserId).toBe("u1");
  });
});

describe("usageRepository.findRunUsage", () => {
  it("returns the run row and its per-call detail", async () => {
    m.runFindUnique.mockResolvedValue(
      run({
        usageDetail: [
          { callIndex: 0, phase: "loop", modelName: "gemini-3.5-flash-lite", promptTokens: 10, cachedTokens: 0, outputTokens: 5, thoughtsTokens: 1, totalTokens: 16, costUsd: 0.001 }
        ]
      })
    );
    const result = await usageRepository.findRunUsage("r1");
    expect(result?.row.runId).toBe("r1");
    expect(result?.calls).toEqual([
      { callIndex: 0, phase: "loop", modelName: "gemini-3.5-flash-lite", promptTokens: 10, cachedTokens: 0, outputTokens: 5, thoughtsTokens: 1, totalTokens: 16, costUsd: 0.001 }
    ]);
  });

  it("returns null for an unknown or unmetered run", async () => {
    m.runFindUnique.mockResolvedValue(null);
    expect(await usageRepository.findRunUsage("nope")).toBeNull();
  });
});

describe("usageRepository.firstMeteredAt", () => {
  it("returns the oldest metered run's date", async () => {
    m.runFindFirst.mockResolvedValue({ createdAt: new Date("2026-06-02T00:00:00Z") });
    expect(await usageRepository.firstMeteredAt()).toEqual(new Date("2026-06-02T00:00:00Z"));
  });
});
