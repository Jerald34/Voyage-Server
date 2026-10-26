// tests/accountActionRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaAccountActionRepository } from "../src/modules/admin/accountActionRepository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-25T08:00:00.000Z");
const TRANSFER = { agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", toUserId: "22222222-2222-4222-8222-222222222222" };
const NOT_DELETED = { id: USER_ID, status: { not: "DELETED" } };

function makeClient() {
  const tx = {
    user: { updateMany: vi.fn(async () => ({ count: 1 })) },
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    authProviderAccount: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    emailVerificationToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    passwordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    agencyMembership: { deleteMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn(async () => ({ count: 1 })) },
    agency: { updateMany: vi.fn(async () => ({ count: 1 })) },
    agencyInvitation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    adminAuditEvent: { create: vi.fn(async () => ({})) }
  };
  const client = {
    ...tx,
    user: { ...tx.user, findUnique: vi.fn() },
    agency: { ...tx.agency, findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])))
  };
  return { client, tx };
}

let ctx: ReturnType<typeof makeClient>;
beforeEach(() => {
  ctx = makeClient();
});

const repo = () => createPrismaAccountActionRepository(ctx.client as never);

/** Resolves with the rejection, so a test can assert on it (and fails if the call did not reject). */
async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected the call to reject");
    },
    (error: unknown) => error
  );
}

describe("accountActionRepository", () => {
  it("disabling sets the status, deletes sessions and writes USER_DISABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: "spam" });
    // Guarded on status, so a row that was deleted a moment ago is never flipped back to DISABLED.
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({ where: NOT_DELETED, data: { status: "DISABLED" } });
    expect(ctx.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DISABLED", targetType: "User", targetId: USER_ID, reason: "spam" }
    });
  });

  it("enabling keeps sessions and writes USER_ENABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "ACTIVE", adminUserId: "admin-1", reason: null });
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({ where: NOT_DELETED, data: { status: "ACTIVE" } });
    expect(ctx.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_ENABLED", targetType: "User", targetId: USER_ID, reason: null }
    });
  });

  it("setStatus on a row that was deleted in the meantime answers 409 and writes nothing else", async () => {
    ctx.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().setStatus({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: null }));

    expect(error).toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    expect(ctx.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });

  it("sign-out deletes sessions and writes USER_SESSIONS_REVOKED", async () => {
    await repo().revokeSessions({ userId: USER_ID, adminUserId: "admin-1", reason: null });
    expect(ctx.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_SESSIONS_REVOKED", targetType: "User", targetId: USER_ID, reason: null }
    });
  });

  it("anonymize scrubs identity, removes access, revokes their invites, and keeps their work", async () => {
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: "Requested", emailDomain: "hops.travel", now: NOW, transfer: null });

    const deletedEmail = `deleted+${USER_ID}@deleted.invalid`;
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({
      where: NOT_DELETED,
      data: {
        email: deletedEmail,
        emailNormalized: deletedEmail,
        displayName: "Deleted user",
        passwordHash: null,
        emailVerifiedAt: null,
        avatarImageId: null,
        status: "DELETED",
        deletedAt: NOW,
        agentPausedAt: null,
        agentPausedUntil: null,
        agentPauseReason: null,
        agentPausedByUserId: null
      }
    });
    for (const table of ["session", "authProviderAccount", "emailVerificationToken", "passwordResetToken", "agencyMembership"] as const) {
      expect(ctx.tx[table].deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    }
    expect(ctx.tx.agencyInvitation.updateMany).toHaveBeenCalledWith({
      where: { invitedByUserId: USER_ID, acceptedAt: null, revokedAt: null },
      data: { revokedAt: NOW, revokedByUserId: "admin-1" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DELETED", targetType: "User", targetId: USER_ID, reason: "Requested", metadata: { emailDomain: "hops.travel" } }
    });
    expect(ctx.tx.agency.updateMany).not.toHaveBeenCalled();
  });

  it("anonymize claims the row first, so a concurrent double delete changes and audits nothing twice", async () => {
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer: TRANSFER });

    const claimed = ctx.tx.user.updateMany.mock.invocationCallOrder[0]!;
    expect(claimed).toBeLessThan(ctx.tx.agency.updateMany.mock.invocationCallOrder[0]!);
    expect(claimed).toBeLessThan(ctx.tx.session.deleteMany.mock.invocationCallOrder[0]!);
    expect(claimed).toBeLessThan(ctx.tx.agencyMembership.deleteMany.mock.invocationCallOrder[0]!);
  });

  it("anonymize on a row that is already deleted answers 409 before touching anything else", async () => {
    ctx.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer: TRANSFER }));

    expect(error).toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    expect(ctx.tx.agency.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.agencyMembership.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.agencyMembership.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });

  it("anonymize with a transfer hands the agency over (checked at write time) and audits it", async () => {
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer: TRANSFER });

    // Only moves the agency if the deleted user still owns it.
    expect(ctx.tx.agency.updateMany).toHaveBeenCalledWith({
      where: { id: TRANSFER.agencyId, ownerUserId: USER_ID },
      data: { ownerUserId: TRANSFER.toUserId }
    });
    // Only promotes the successor if they are still an active member with an active account.
    expect(ctx.tx.agencyMembership.updateMany).toHaveBeenCalledWith({
      where: { agencyId: TRANSFER.agencyId, userId: TRANSFER.toUserId, status: "ACTIVE", user: { status: "ACTIVE" } },
      data: { role: "OWNER" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: {
        adminUserId: "admin-1",
        action: "AGENCY_OWNERSHIP_TRANSFERRED",
        targetType: "Agency",
        targetId: TRANSFER.agencyId,
        reason: null,
        metadata: { fromUserId: USER_ID, toUserId: TRANSFER.toUserId }
      }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_DELETED", targetType: "User" }) }));
  });

  it("a transfer whose agency changed owner in the meantime answers 409 OWNERSHIP_CHANGED and stops", async () => {
    ctx.tx.agency.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer: TRANSFER }));

    expect(error).toMatchObject({ statusCode: 409, code: "OWNERSHIP_CHANGED" });
    expect(ctx.tx.agencyMembership.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });

  it("a transfer whose successor is no longer an active member answers 400 INVALID_NEW_OWNER and stops", async () => {
    ctx.tx.agencyMembership.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer: TRANSFER }));

    expect(error).toMatchObject({ statusCode: 400, code: "INVALID_NEW_OWNER" });
    expect(ctx.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.agencyMembership.deleteMany).not.toHaveBeenCalled();
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });

  it("lists agencies the user owns (by Agency.ownerUserId) with their other active members as successors", async () => {
    ctx.client.agency.findMany.mockResolvedValue([
      {
        id: "a1",
        name: "Bayani Tours",
        memberships: [{ role: "ADMIN", user: { id: "u2", displayName: "Liza Cruz" } }]
      }
    ] as never);

    const owned = await repo().listOwnedAgencies(USER_ID);

    // Keyed on the owner column, not the OWNER membership: a disabled owner membership must still block the delete.
    expect(ctx.client.agency.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: USER_ID },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        memberships: {
          where: { status: "ACTIVE", userId: { not: USER_ID }, user: { status: "ACTIVE" } },
          orderBy: { createdAt: "asc" },
          select: { role: true, user: { select: { id: true, displayName: true } } }
        }
      }
    });
    expect(owned).toEqual([{ agencyId: "a1", agencyName: "Bayani Tours", successors: [{ userId: "u2", displayName: "Liza Cruz", role: "ADMIN" }] }]);
  });

  it("setAgentPause sets the pause (guarded on status) and audits AGENT_PAUSED with the duration", async () => {
    const until = new Date("2026-10-26T08:00:00.000Z");
    await repo().setAgentPause({ userId: USER_ID, adminUserId: "admin-1", pausedAt: NOW, until, reason: "High usage", duration: "24h" });
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({
      where: NOT_DELETED,
      data: { agentPausedAt: NOW, agentPausedUntil: until, agentPauseReason: "High usage", agentPausedByUserId: "admin-1" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: {
        adminUserId: "admin-1",
        action: "AGENT_PAUSED",
        targetType: "User",
        targetId: USER_ID,
        reason: "High usage",
        metadata: { duration: "24h", until: "2026-10-26T08:00:00.000Z" }
      }
    });
  });

  it("an indefinite pause audits a null end", async () => {
    await repo().setAgentPause({ userId: USER_ID, adminUserId: "admin-1", pausedAt: NOW, until: null, reason: "Abuse", duration: "indefinite" });
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({
      where: NOT_DELETED,
      data: { agentPausedAt: NOW, agentPausedUntil: null, agentPauseReason: "Abuse", agentPausedByUserId: "admin-1" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "AGENT_PAUSED", metadata: { duration: "indefinite", until: null } })
    });
  });

  it("setAgentPause on a row that was deleted in the meantime answers 409 and audits nothing", async () => {
    ctx.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().setAgentPause({ userId: USER_ID, adminUserId: "admin-1", pausedAt: NOW, until: null, reason: "x", duration: "indefinite" }));

    expect(error).toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });

  it("clearAgentPause clears the pause (guarded on status) and audits AGENT_RESUMED", async () => {
    await repo().clearAgentPause({ userId: USER_ID, adminUserId: "admin-1" });
    expect(ctx.tx.user.updateMany).toHaveBeenCalledWith({
      where: NOT_DELETED,
      data: { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, agentPausedByUserId: null }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "AGENT_RESUMED", targetType: "User", targetId: USER_ID, reason: null }
    });
  });

  it("clearAgentPause on a row that was deleted in the meantime answers 409 and audits nothing", async () => {
    ctx.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    const error = await failure(repo().clearAgentPause({ userId: USER_ID, adminUserId: "admin-1" }));

    expect(error).toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
    expect(ctx.tx.adminAuditEvent.create).not.toHaveBeenCalled();
  });
});
