import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany, mockFindUnique } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: { user: { findMany: mockFindMany, findUnique: mockFindUnique } }
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
    expect(args.select).toMatchObject({
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
      providerAccounts: { select: { provider: true } },
      memberships: { select: { role: true, status: true, agency: { select: { id: true, name: true, status: true } } } },
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
