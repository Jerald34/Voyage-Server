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
  return {
    id: USER_ID,
    email: "Mara@Hops.travel",
    role: "USER",
    status: "ACTIVE",
    agentPausedAt: null,
    agentPausedUntil: null,
    agentPauseReason: null,
    ...over
  };
}

function makeRepo(options: { target?: AccountActionTarget | null; owned?: OwnedAgency[] } = {}) {
  return {
    findTarget: vi.fn(async () => (options.target === undefined ? target() : options.target)),
    listOwnedAgencies: vi.fn(async () => options.owned ?? []),
    setStatus: vi.fn(async () => {}),
    revokeSessions: vi.fn(async () => {}),
    anonymize: vi.fn(async () => {}),
    setAgentPause: vi.fn(async () => {}),
    clearAgentPause: vi.fn(async () => {})
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

const agency = (over: Partial<OwnedAgency> = {}): OwnedAgency => ({
  agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agencyName: "Bayani Tours",
  successors: [{ userId: "22222222-2222-4222-8222-222222222222", displayName: "Liza Cruz", role: "ADMIN" }],
  ...over
});

describe("deleteAccount", () => {
  it("rejects a confirmation email that doesn't match", async () => {
    const repo = makeRepo();
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "someone@else.com" })).rejects.toMatchObject({
      statusCode: 400,
      code: "EMAIL_CONFIRMATION_MISMATCH"
    });
    expect(repo.anonymize).not.toHaveBeenCalled();
  });

  it("anonymizes a regular account, matching the email case-insensitively", async () => {
    const repo = makeRepo();
    await service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "  mara@hops.TRAVEL ", reason: "Requested by the user" });
    expect(repo.anonymize).toHaveBeenCalledWith({
      userId: USER_ID,
      adminUserId: ADMIN.id,
      reason: "Requested by the user",
      emailDomain: "hops.travel",
      now: NOW,
      transfer: null
    });
  });

  it("blocks a solo owner and says which agency", async () => {
    const repo = makeRepo({ owned: [agency({ successors: [] })] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 409,
      code: "OWNER_HAS_NO_SUCCESSOR",
      details: { agencyId: agency().agencyId, agencyName: "Bayani Tours" }
    });
  });

  it("blocks an owner of more than one agency", async () => {
    const repo = makeRepo({ owned: [agency(), agency({ agencyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agencyName: "Second" })] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 409,
      code: "MULTIPLE_OWNED_AGENCIES"
    });
  });

  it("requires a new owner when the account owns an agency with members", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 400,
      code: "NEW_OWNER_REQUIRED"
    });
  });

  it("rejects a new owner who isn't an active member of that agency", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await expect(
      service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel", newOwnerUserId: "33333333-3333-4333-8333-333333333333" })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_NEW_OWNER" });
  });

  it("hands the agency over, then anonymizes", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await service(repo).deleteAccount(ADMIN, USER_ID, {
      confirmEmail: "mara@hops.travel",
      newOwnerUserId: "22222222-2222-4222-8222-222222222222"
    });
    expect(repo.anonymize).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer: { agencyId: agency().agencyId, toUserId: "22222222-2222-4222-8222-222222222222" }
      })
    );
  });

  it("ignores a new owner sent for an account that owns nothing", async () => {
    const repo = makeRepo();
    await service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel", newOwnerUserId: "22222222-2222-4222-8222-222222222222" });
    expect(repo.anonymize).toHaveBeenCalledWith(expect.objectContaining({ transfer: null }));
  });
});

describe("agent pause", () => {
  it("pauses for the chosen duration with a trimmed reason", async () => {
    const repo = makeRepo();
    await service(repo).pauseAgent(ADMIN, USER_ID, { duration: "24h", reason: "  Unusually high usage " });
    expect(repo.setAgentPause).toHaveBeenCalledWith({
      userId: USER_ID,
      adminUserId: ADMIN.id,
      pausedAt: NOW,
      until: new Date("2026-10-26T08:00:00.000Z"),
      reason: "Unusually high usage",
      duration: "24h"
    });
  });

  it("pauses until lifted with no end time", async () => {
    const repo = makeRepo();
    await service(repo).pauseAgent(ADMIN, USER_ID, { duration: "indefinite", reason: "Abuse" });
    expect(repo.setAgentPause).toHaveBeenCalledWith(expect.objectContaining({ until: null }));
  });

  it("uses the same guards as the other actions", async () => {
    const repo = makeRepo({ target: target({ role: "SUPER_ADMIN" }) });
    await expect(service(repo).pauseAgent(ADMIN, USER_ID, { duration: "1h", reason: "x" })).rejects.toMatchObject({ code: "CANNOT_ACT_ON_SUPER_ADMIN" });
    expect(repo.setAgentPause).not.toHaveBeenCalled();
  });

  it("refuses to pause or resume a deleted account", async () => {
    const repo = makeRepo({ target: target({ status: "DELETED" }) });
    await expect(service(repo).pauseAgent(ADMIN, USER_ID, { duration: "1h", reason: "x" })).rejects.toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    await expect(service(repo).resumeAgent(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    expect(repo.setAgentPause).not.toHaveBeenCalled();
    expect(repo.clearAgentPause).not.toHaveBeenCalled();
  });

  it("resumes an active pause", async () => {
    const repo = makeRepo({ target: target({ agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "x" }) });
    await service(repo).resumeAgent(ADMIN, USER_ID);
    expect(repo.clearAgentPause).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: ADMIN.id });
  });

  it("treats resuming someone who isn't paused (or whose pause ended) as done", async () => {
    const repo = makeRepo({
      target: target({ agentPausedAt: new Date("2026-10-24T07:00:00.000Z"), agentPausedUntil: new Date("2026-10-24T08:00:00.000Z"), agentPauseReason: "x" })
    });
    await service(repo).resumeAgent(ADMIN, USER_ID);
    expect(repo.clearAgentPause).not.toHaveBeenCalled();
    const never = makeRepo();
    await service(never).resumeAgent(ADMIN, USER_ID);
    expect(never.clearAgentPause).not.toHaveBeenCalled();
  });
});
