import { describe, expect, it, vi } from "vitest";
import {
  createAdminAccountService,
  toAccountDetail,
  toAccountSummary,
  type AdminAccountDetailRow,
  type AdminAccountRepository,
  type AdminAccountRow
} from "../src/modules/admin/accountService";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

const admin = { id: "admin-1", role: "SUPER_ADMIN" };
const regularUser = { id: "user-1", role: "USER" };

function makeRow(overrides: Partial<AdminAccountRow> = {}): AdminAccountRow {
  return {
    id: USER_ID,
    email: "ana@example.com",
    displayName: "Ana Reyes",
    role: "USER",
    status: "ACTIVE",
    accountType: "PERSONAL",
    emailVerifiedAt: new Date("2026-09-01T08:00:00.000Z"),
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    passwordHash: PASSWORD_HASH,
    providerAccounts: [],
    memberships: [],
    ...overrides
  };
}

function makeDetailRow(overrides: Partial<AdminAccountDetailRow> = {}): AdminAccountDetailRow {
  return {
    ...makeRow(),
    updatedAt: new Date("2026-09-15T12:30:00.000Z"),
    _count: { createdItineraries: 4, createdClientTrips: 2, createdAgentThreads: 7 },
    ...overrides
  };
}

function makeRepository(options: { rows?: AdminAccountRow[]; detail?: AdminAccountDetailRow | null } = {}) {
  const repository = {
    listAccounts: vi.fn(async () => options.rows ?? []),
    findAccount: vi.fn(async () => (options.detail === undefined ? null : options.detail))
  } satisfies AdminAccountRepository;
  return repository;
}

describe("adminAccountService access control", () => {
  it("rejects non-super-admins on listAccounts without touching the repository", async () => {
    const repository = makeRepository();
    const service = createAdminAccountService({ repository });

    await expect(service.listAccounts(regularUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "SUPER_ADMIN_REQUIRED",
      message: "Super admin access is required."
    });
    expect(repository.listAccounts).not.toHaveBeenCalled();
  });

  it("rejects non-super-admins on getAccount without touching the repository", async () => {
    const repository = makeRepository({ detail: makeDetailRow() });
    const service = createAdminAccountService({ repository });

    await expect(service.getAccount(regularUser, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: "SUPER_ADMIN_REQUIRED"
    });
    expect(repository.findAccount).not.toHaveBeenCalled();
  });
});

describe("toAccountSummary", () => {
  it("maps a personal user with a password and no agency", () => {
    expect(toAccountSummary(makeRow())).toEqual({
      id: USER_ID,
      email: "ana@example.com",
      displayName: "Ana Reyes",
      role: "USER",
      status: "ACTIVE",
      accountType: "PERSONAL",
      emailVerified: true,
      createdAt: "2026-08-30T10:00:00.000Z",
      signInMethods: ["PASSWORD"],
      memberships: []
    });
  });

  it("flattens an agency owner's memberships, keeping the repository's order", () => {
    const summary = toAccountSummary(
      makeRow({
        accountType: "AGENCY_USER",
        memberships: [
          {
            role: "OWNER",
            status: "ACTIVE",
            agency: { id: AGENCY_A, name: "Alpha Travel", status: "VERIFIED" }
          },
          {
            role: "STAFF",
            status: "DISABLED",
            agency: { id: AGENCY_B, name: "Beta Tours", status: "SUSPENDED" }
          }
        ]
      })
    );

    expect(summary.memberships).toEqual([
      { agencyId: AGENCY_A, agencyName: "Alpha Travel", agencyStatus: "VERIFIED", role: "OWNER", status: "ACTIVE" },
      { agencyId: AGENCY_B, agencyName: "Beta Tours", agencyStatus: "SUSPENDED", role: "STAFF", status: "DISABLED" }
    ]);
  });

  it("reports a Google-only user as GOOGLE without PASSWORD", () => {
    const summary = toAccountSummary(
      makeRow({ passwordHash: null, providerAccounts: [{ provider: "GOOGLE" }] })
    );
    expect(summary.signInMethods).toEqual(["GOOGLE"]);
  });

  it("lists PASSWORD first, then providers, for a password + Google user", () => {
    const summary = toAccountSummary(makeRow({ providerAccounts: [{ provider: "GOOGLE" }] }));
    expect(summary.signInMethods).toEqual(["PASSWORD", "GOOGLE"]);
  });

  it("de-duplicates repeated provider rows", () => {
    const summary = toAccountSummary(
      makeRow({
        passwordHash: null,
        providerAccounts: [{ provider: "GOOGLE" }, { provider: "APPLE" }, { provider: "GOOGLE" }]
      })
    );
    expect(summary.signInMethods).toEqual(["GOOGLE", "APPLE"]);
  });

  it("does not count an empty or null passwordHash as a password sign-in", () => {
    expect(toAccountSummary(makeRow({ passwordHash: "" })).signInMethods).toEqual([]);
    expect(toAccountSummary(makeRow({ passwordHash: null })).signInMethods).toEqual([]);
  });

  it("reports emailVerified from emailVerifiedAt and keeps the super admin role and disabled status", () => {
    const summary = toAccountSummary(
      makeRow({ emailVerifiedAt: null, role: "SUPER_ADMIN", status: "DISABLED", accountType: "PENDING" })
    );
    expect(summary).toMatchObject({
      emailVerified: false,
      role: "SUPER_ADMIN",
      status: "DISABLED",
      accountType: "PENDING"
    });
  });

  it("only passes through the contract's fields, even if the row carries extra columns", () => {
    const leaky = {
      ...makeRow(),
      avatarImageId: "avatar-1",
      emailNormalized: "ana@example.com",
      sessions: [{ tokenHash: "session-token-hash" }],
      memberships: [
        {
          role: "OWNER",
          status: "ACTIVE",
          id: "membership-secret-id",
          agency: { id: AGENCY_A, name: "Alpha Travel", status: "VERIFIED", slug: "alpha-secret-slug" }
        }
      ]
    } as unknown as AdminAccountRow;

    const summary = toAccountSummary(leaky);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "accountType",
        "createdAt",
        "displayName",
        "email",
        "emailVerified",
        "id",
        "memberships",
        "role",
        "signInMethods",
        "status"
      ].sort()
    );
    expect(Object.keys(summary.memberships[0]!).sort()).toEqual(
      ["agencyId", "agencyName", "agencyStatus", "role", "status"].sort()
    );
    const json = JSON.stringify(summary);
    expect(json).not.toContain("session-token-hash");
    expect(json).not.toContain("alpha-secret-slug");
    expect(json).not.toContain("membership-secret-id");
  });
});

describe("toAccountDetail", () => {
  it("adds emailVerifiedAt, updatedAt and activity counts to the summary", () => {
    expect(toAccountDetail(makeDetailRow())).toEqual({
      id: USER_ID,
      email: "ana@example.com",
      displayName: "Ana Reyes",
      role: "USER",
      status: "ACTIVE",
      accountType: "PERSONAL",
      emailVerified: true,
      createdAt: "2026-08-30T10:00:00.000Z",
      signInMethods: ["PASSWORD"],
      memberships: [],
      emailVerifiedAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-15T12:30:00.000Z",
      activity: { itineraries: 4, clientTrips: 2, agentThreads: 7 }
    });
  });

  it("returns a null emailVerifiedAt for an unverified account", () => {
    const detail = toAccountDetail(makeDetailRow({ emailVerifiedAt: null }));
    expect(detail.emailVerifiedAt).toBeNull();
    expect(detail.emailVerified).toBe(false);
  });
});

describe("adminAccountService.listAccounts", () => {
  it("returns summaries in repository order", async () => {
    const repository = makeRepository({
      rows: [
        makeRow({ id: "22222222-2222-4222-8222-222222222222", displayName: "Newer" }),
        makeRow({ id: USER_ID, displayName: "Older" })
      ]
    });
    const service = createAdminAccountService({ repository });

    const users = await service.listAccounts(admin);

    expect(users.map((u) => u.displayName)).toEqual(["Newer", "Older"]);
    expect(repository.listAccounts).toHaveBeenCalledTimes(1);
  });

  it("never serializes passwordHash or the hash value", async () => {
    const repository = makeRepository({
      rows: [
        makeRow(),
        makeRow({ id: "22222222-2222-4222-8222-222222222222", providerAccounts: [{ provider: "GOOGLE" }] }),
        makeRow({ id: "33333333-3333-4333-8333-333333333333", passwordHash: null, providerAccounts: [{ provider: "APPLE" }] })
      ]
    });
    const service = createAdminAccountService({ repository });

    const json = JSON.stringify(await service.listAccounts(admin));

    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain(PASSWORD_HASH);
    expect(json).not.toMatch(/\$2[aby]\$/);
  });
});

describe("adminAccountService.getAccount", () => {
  it("returns the account detail", async () => {
    const repository = makeRepository({ detail: makeDetailRow() });
    const service = createAdminAccountService({ repository });

    const account = await service.getAccount(admin, USER_ID);

    expect(repository.findAccount).toHaveBeenCalledWith(USER_ID);
    expect(account.activity).toEqual({ itineraries: 4, clientTrips: 2, agentThreads: 7 });
  });

  it("never serializes passwordHash or the hash value in the detail", async () => {
    const repository = makeRepository({
      detail: makeDetailRow({
        providerAccounts: [{ provider: "GOOGLE" }],
        memberships: [
          { role: "OWNER", status: "ACTIVE", agency: { id: AGENCY_A, name: "Alpha Travel", status: "VERIFIED" } }
        ]
      })
    });
    const service = createAdminAccountService({ repository });

    const json = JSON.stringify(await service.getAccount(admin, USER_ID));

    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain(PASSWORD_HASH);
  });

  it("throws 404 ACCOUNT_NOT_FOUND when the repository returns null", async () => {
    const repository = makeRepository({ detail: null });
    const service = createAdminAccountService({ repository });

    await expect(service.getAccount(admin, USER_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "ACCOUNT_NOT_FOUND",
      message: "Account not found."
    });
  });
});
