// tests/accountActionService.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  createAdminAccountActionService,
  type AccountActionRepository,
  type AccountActionTarget,
  type OwnedAgency
} from "../src/modules/admin/accountActionService";

const ADMIN = { id: "admin-1", role: "SUPER_ADMIN" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-25T08:00:00.000Z");

function target(over: Partial<AccountActionTarget> = {}): AccountActionTarget {
  return { id: USER_ID, email: "Mara@Hops.travel", role: "USER", status: "ACTIVE", ...over };
}

function makeRepo(options: { target?: AccountActionTarget | null; owned?: OwnedAgency[] } = {}) {
  return {
    findTarget: vi.fn(async () => (options.target === undefined ? target() : options.target)),
    listOwnedAgencies: vi.fn(async () => options.owned ?? []),
    setStatus: vi.fn(async () => {}),
    revokeSessions: vi.fn(async () => {}),
    anonymize: vi.fn(async () => {})
  } satisfies AccountActionRepository;
}

const service = (repo: AccountActionRepository) => createAdminAccountActionService({ repository: repo, now: () => NOW });

describe("account action guards", () => {
  it("requires a super admin before touching the repository", async () => {
    const repo = makeRepo();
    await expect(service(repo).disable({ id: "u", role: "USER" }, USER_ID)).rejects.toMatchObject({ statusCode: 403, code: "SUPER_ADMIN_REQUIRED" });
    expect(repo.findTarget).not.toHaveBeenCalled();
  });

  it("404s an unknown account", async () => {
    const repo = makeRepo({ target: null });
    await expect(service(repo).disable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 404, code: "ACCOUNT_NOT_FOUND" });
  });

  it("refuses to act on your own account", async () => {
    const repo = makeRepo({ target: target({ id: ADMIN.id, role: "SUPER_ADMIN" }) });
    await expect(service(repo).signOutEverywhere(ADMIN, ADMIN.id)).rejects.toMatchObject({ statusCode: 403, code: "CANNOT_ACT_ON_SELF" });
    expect(repo.revokeSessions).not.toHaveBeenCalled();
  });

  it("refuses to act on another super admin", async () => {
    const repo = makeRepo({ target: target({ role: "SUPER_ADMIN" }) });
    await expect(service(repo).disable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 403, code: "CANNOT_ACT_ON_SUPER_ADMIN" });
  });

  it("refuses any action on a deleted account", async () => {
    const repo = makeRepo({ target: target({ status: "DELETED" }) });
    await expect(service(repo).enable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
  });
});

describe("disable / enable / sign out", () => {
  it("disables an active account with the reason", async () => {
    const repo = makeRepo();
    await service(repo).disable(ADMIN, USER_ID, "Left the agency");
    expect(repo.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "DISABLED", adminUserId: ADMIN.id, reason: "Left the agency" });
  });

  it("treats disabling a disabled account as done, without a second audit row", async () => {
    const repo = makeRepo({ target: target({ status: "DISABLED" }) });
    await service(repo).disable(ADMIN, USER_ID);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("enables a disabled account", async () => {
    const repo = makeRepo({ target: target({ status: "DISABLED" }) });
    await service(repo).enable(ADMIN, USER_ID);
    expect(repo.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "ACTIVE", adminUserId: ADMIN.id, reason: null });
  });

  it("treats enabling an active account as done", async () => {
    const repo = makeRepo();
    await service(repo).enable(ADMIN, USER_ID);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("signs an account out everywhere", async () => {
    const repo = makeRepo();
    await service(repo).signOutEverywhere(ADMIN, USER_ID, "Lost phone");
    expect(repo.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: ADMIN.id, reason: "Lost phone" });
  });
});
