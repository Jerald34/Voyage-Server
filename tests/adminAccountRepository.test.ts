import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany, mockFindUnique, mockAuditFindMany, mockAgencyFindMany, mockRunAggregate, mockRunCount } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockAuditFindMany: vi.fn(),
  mockAgencyFindMany: vi.fn(),
  mockRunAggregate: vi.fn(),
  mockRunCount: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    user: { findMany: mockFindMany, findUnique: mockFindUnique },
    adminAuditEvent: { findMany: mockAuditFindMany },
    agency: { findMany: mockAgencyFindMany },
    agentRun: { aggregate: mockRunAggregate, count: mockRunCount }
  }
}));

import { adminAccountRepository } from "../src/modules/admin/accountRepository";

const USER_ID = "11111111-1111-4111-8111-111111111111";

// Every column of User that must never be selected (credentials, tokens, relations holding secrets).
const FORBIDDEN_USER_KEYS = [
  "emailNormalized",
  "avatarImageId",
  "avatarImage",
  "sessions",
  "verificationTokens",
  "passwordResetTokens"
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue(null);
  mockAuditFindMany.mockResolvedValue([]);
  mockAgencyFindMany.mockResolvedValue([]);
  mockRunAggregate.mockResolvedValue({ _sum: { costUsd: null }, _count: { _all: 0 } });
  mockRunCount.mockResolvedValue(0);
});

describe("adminAccountRepository.listAccounts", () => {
  it("lists newest first with an explicit select and no include", async () => {
    await adminAccountRepository.listAccounts();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const args = mockFindMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args).not.toHaveProperty("include");
    expect(args.select).toEqual({
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      accountType: true,
      emailVerifiedAt: true,
      createdAt: true,
      passwordHash: true,
      agentPausedAt: true,
      agentPausedUntil: true,
      agentPauseReason: true,
      providerAccounts: { orderBy: { createdAt: "asc" }, select: { provider: true } },
      memberships: {
        orderBy: { createdAt: "asc" },
        select: { role: true, status: true, agency: { select: { id: true, name: true, status: true } } }
      }
    });
    for (const key of FORBIDDEN_USER_KEYS) {
      expect(args.select).not.toHaveProperty(key);
    }
  });

  it("returns the rows Prisma returns", async () => {
    const rows = [{ id: USER_ID }];
    mockFindMany.mockResolvedValue(rows);

    await expect(adminAccountRepository.listAccounts()).resolves.toBe(rows);
  });
});

describe("adminAccountRepository.findAccount", () => {
  it("looks the account up by id with the list select plus updatedAt and activity counts", async () => {
    await adminAccountRepository.findAccount(USER_ID);

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    const args = mockFindUnique.mock.calls[0]![0];
    expect(args.where).toEqual({ id: USER_ID });
    expect(args).not.toHaveProperty("include");
    expect(args.select).toEqual({
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      accountType: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
      passwordHash: true,
      agentPausedAt: true,
      agentPausedUntil: true,
      agentPauseReason: true,
      providerAccounts: { orderBy: { createdAt: "asc" }, select: { provider: true } },
      memberships: {
        orderBy: { createdAt: "asc" },
        select: { role: true, status: true, agency: { select: { id: true, name: true, status: true } } }
      },
      _count: { select: { createdItineraries: true, createdClientTrips: true, createdAgentThreads: true } }
    });
    for (const key of FORBIDDEN_USER_KEYS) {
      expect(args.select).not.toHaveProperty(key);
    }
  });

  it("returns null when no such account exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(adminAccountRepository.findAccount(USER_ID)).resolves.toBeNull();
  });
});

describe("adminAccountRepository.listAuditEvents", () => {
  it("reads the last 50 audit events targeting this user, newest first, with only the admin's display name", async () => {
    const rows = [{ id: "e1" }];
    mockAuditFindMany.mockResolvedValue(rows);

    await expect(adminAccountRepository.listAuditEvents(USER_ID)).resolves.toBe(rows);

    const args = mockAuditFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({ targetType: "User", targetId: USER_ID });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(50);
    expect(args).not.toHaveProperty("include");
    expect(args.select).toEqual({
      id: true,
      action: true,
      reason: true,
      createdAt: true,
      adminUser: { select: { displayName: true } }
    });
  });
});

describe("adminAccountRepository.listOwnedAgencies", () => {
  it("lists the agencies the user owns, with their other active members as successors", async () => {
    mockAgencyFindMany.mockResolvedValue([
      {
        id: "agency-1",
        name: "Bayani Tours",
        memberships: [{ role: "ADMIN", user: { id: "user-2", displayName: "Lia Cruz" } }]
      }
    ]);

    await expect(adminAccountRepository.listOwnedAgencies(USER_ID)).resolves.toEqual([
      {
        agencyId: "agency-1",
        agencyName: "Bayani Tours",
        successors: [{ userId: "user-2", displayName: "Lia Cruz", role: "ADMIN" }]
      }
    ]);
    expect(mockAgencyFindMany.mock.calls[0]![0].where).toEqual({ ownerUserId: USER_ID });
  });
});

describe("adminAccountRepository.usageSince", () => {
  it("sums the cost and counts the metered (completed or failed, token-counted) runs the user triggered since the date", async () => {
    mockRunAggregate.mockResolvedValue({ _sum: { costUsd: "1.400000" }, _count: { _all: 71 } });
    const from = new Date("2026-10-01T00:00:00.000Z");

    await expect(adminAccountRepository.usageSince(USER_ID, from)).resolves.toEqual({ costUsd: 1.4, runCount: 71, costComplete: true });

    expect(mockRunAggregate).toHaveBeenCalledWith({
      where: {
        usageUserId: USER_ID,
        createdAt: { gte: from },
        status: { in: ["COMPLETED", "FAILED"] },
        totalTokens: { not: null }
      },
      _sum: { costUsd: true },
      _count: { _all: true }
    });
  });

  it("treats a person with no runs as zero spend (a null sum)", async () => {
    await expect(adminAccountRepository.usageSince(USER_ID, new Date("2026-10-01T00:00:00.000Z"))).resolves.toEqual({
      costUsd: 0,
      runCount: 0,
      costComplete: true
    });
  });

  it("reports the cost as incomplete when any of those runs used a model with no price", async () => {
    mockRunAggregate.mockResolvedValue({ _sum: { costUsd: "0.900000" }, _count: { _all: 12 } });
    mockRunCount.mockResolvedValue(3);
    const from = new Date("2026-10-01T00:00:00.000Z");

    await expect(adminAccountRepository.usageSince(USER_ID, from)).resolves.toEqual({ costUsd: 0.9, runCount: 12, costComplete: false });

    // Same window and same definition of "metered", narrowed to runs whose cost is incomplete.
    expect(mockRunCount).toHaveBeenCalledWith({
      where: {
        usageUserId: USER_ID,
        createdAt: { gte: from },
        status: { in: ["COMPLETED", "FAILED"] },
        totalTokens: { not: null },
        costComplete: false
      }
    });
  });
});
