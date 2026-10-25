// tests/accountActionRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaAccountActionRepository } from "../src/modules/admin/accountActionRepository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-25T08:00:00.000Z");

function makeClient() {
  const tx = {
    user: { update: vi.fn(async () => ({})) },
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    authProviderAccount: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    emailVerificationToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    passwordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    agencyMembership: { deleteMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
    agency: { update: vi.fn(async () => ({})) },
    agencyInvitation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    adminAuditEvent: { create: vi.fn(async () => ({})) }
  };
  const client = {
    ...tx,
    user: { ...tx.user, findUnique: vi.fn() },
    agencyMembership: { ...tx.agencyMembership, findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])))
  };
  return { client, tx };
}

let ctx: ReturnType<typeof makeClient>;
beforeEach(() => {
  ctx = makeClient();
});

const repo = () => createPrismaAccountActionRepository(ctx.client as never);

describe("accountActionRepository", () => {
  it("disabling sets the status, deletes sessions and writes USER_DISABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: "spam" });
    expect(ctx.client.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { status: "DISABLED" } });
    expect(ctx.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DISABLED", targetType: "USER", targetId: USER_ID, reason: "spam" }
    });
  });

  it("enabling keeps sessions and writes USER_ENABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "ACTIVE", adminUserId: "admin-1", reason: null });
    expect(ctx.client.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_ENABLED" }) }));
  });

  it("sign-out deletes sessions and writes USER_SESSIONS_REVOKED", async () => {
    await repo().revokeSessions({ userId: USER_ID, adminUserId: "admin-1", reason: null });
    expect(ctx.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_SESSIONS_REVOKED" }) }));
  });

  it("anonymize scrubs identity, removes access, revokes their invites, and keeps their work", async () => {
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: "Requested", emailDomain: "hops.travel", now: NOW, transfer: null });

    const deletedEmail = `deleted+${USER_ID}@deleted.invalid`;
    expect(ctx.tx.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        email: deletedEmail,
        emailNormalized: deletedEmail,
        displayName: "Deleted user",
        passwordHash: null,
        emailVerifiedAt: null,
        avatarImageId: null,
        status: "DELETED",
        deletedAt: NOW
      }
    });
    for (const table of ["session", "authProviderAccount", "emailVerificationToken", "passwordResetToken", "agencyMembership"] as const) {
      expect(ctx.tx[table].deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    }
    expect(ctx.tx.agencyInvitation.updateMany).toHaveBeenCalledWith({
      where: { invitedByUserId: USER_ID, acceptedAt: null, revokedAt: null },
      data: { revokedAt: NOW, revokedByUserId: "admin-1" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DELETED", targetType: "USER", targetId: USER_ID, reason: "Requested", metadata: { emailDomain: "hops.travel" } }
    });
    expect(ctx.tx.agency.update).not.toHaveBeenCalled();
  });

  it("anonymize with a transfer makes the successor owner first and audits it", async () => {
    const transfer = { agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", toUserId: "22222222-2222-4222-8222-222222222222" };
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer });

    expect(ctx.tx.agencyMembership.update).toHaveBeenCalledWith({
      where: { agencyId_userId: { agencyId: transfer.agencyId, userId: transfer.toUserId } },
      data: { role: "OWNER" }
    });
    expect(ctx.tx.agency.update).toHaveBeenCalledWith({ where: { id: transfer.agencyId }, data: { ownerUserId: transfer.toUserId } });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: {
        adminUserId: "admin-1",
        action: "AGENCY_OWNERSHIP_TRANSFERRED",
        targetType: "AGENCY",
        targetId: transfer.agencyId,
        reason: null,
        metadata: { fromUserId: USER_ID, toUserId: transfer.toUserId }
      }
    });
  });

  it("lists owned agencies with their other active members as successors", async () => {
    ctx.client.agencyMembership.findMany.mockResolvedValue([
      {
        agency: {
          id: "a1",
          name: "Bayani Tours",
          memberships: [{ role: "ADMIN", user: { id: "u2", displayName: "Liza Cruz" } }]
        }
      }
    ] as never);

    const owned = await repo().listOwnedAgencies(USER_ID);

    expect(ctx.client.agencyMembership.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, role: "OWNER", status: "ACTIVE" },
      select: {
        agency: {
          select: {
            id: true,
            name: true,
            memberships: {
              where: { status: "ACTIVE", userId: { not: USER_ID } },
              orderBy: { createdAt: "asc" },
              select: { role: true, user: { select: { id: true, displayName: true } } }
            }
          }
        }
      }
    });
    expect(owned).toEqual([{ agencyId: "a1", agencyName: "Bayani Tours", successors: [{ userId: "u2", displayName: "Liza Cruz", role: "ADMIN" }] }]);
  });
});
