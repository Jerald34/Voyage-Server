// src/modules/admin/accountActionRepository.ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import type { AccountActionRepository, OwnedAgency } from "./accountActionService";

type OwnedAgenciesClient = Pick<PrismaClient, "agency">;

const accountDeleted = () => new ApiError(409, "ACCOUNT_DELETED", "This account has been deleted.");

/** Agencies the user owns, each with its other active members (the people who could take it over). */
export async function findOwnedAgencies(client: OwnedAgenciesClient, userId: string): Promise<OwnedAgency[]> {
  // Keyed on Agency.ownerUserId rather than the OWNER membership, so an owner whose membership
  // was disabled still has to hand the agency over instead of leaving it owned by a deleted user.
  const agencies = await client.agency.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      memberships: {
        where: { status: "ACTIVE", userId: { not: userId }, user: { status: "ACTIVE" } },
        orderBy: { createdAt: "asc" },
        select: { role: true, user: { select: { id: true, displayName: true } } }
      }
    }
  });
  return agencies.map((agency) => ({
    agencyId: agency.id,
    agencyName: agency.name,
    successors: agency.memberships.map((member) => ({
      userId: member.user.id,
      displayName: member.user.displayName,
      role: member.role as "ADMIN" | "STAFF"
    }))
  }));
}

export function createPrismaAccountActionRepository(client: PrismaClient = prisma): AccountActionRepository {
  return {
    async findTarget(userId) {
      return client.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true, agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true }
      });
    },

    listOwnedAgencies(userId) {
      return findOwnedAgencies(client, userId);
    },

    async setStatus({ userId, status, adminUserId, reason }) {
      await client.$transaction(async (tx) => {
        // Guarded on status, so a delete that landed after the service's check is never undone.
        const { count } = await tx.user.updateMany({ where: { id: userId, status: { not: "DELETED" } }, data: { status } });
        if (count === 0) throw accountDeleted();
        // A disabled user is already rejected on every request; deleting the sessions also clears their devices.
        if (status === "DISABLED") await tx.session.deleteMany({ where: { userId } });
        await tx.adminAuditEvent.create({
          data: { adminUserId, action: status === "DISABLED" ? "USER_DISABLED" : "USER_ENABLED", targetType: "User", targetId: userId, reason }
        });
      });
    },

    async revokeSessions({ userId, adminUserId, reason }) {
      await client.$transaction([
        client.session.deleteMany({ where: { userId } }),
        client.adminAuditEvent.create({
          data: { adminUserId, action: "USER_SESSIONS_REVOKED", targetType: "User", targetId: userId, reason }
        })
      ]);
    },

    async setAgentPause({ userId, adminUserId, pausedAt, until, reason, duration }) {
      await client.$transaction(async (tx) => {
        // Guarded on status, so a delete that landed after the service's check never gets a pause written onto it.
        const { count } = await tx.user.updateMany({
          where: { id: userId, status: { not: "DELETED" } },
          data: { agentPausedAt: pausedAt, agentPausedUntil: until, agentPauseReason: reason, agentPausedByUserId: adminUserId }
        });
        if (count === 0) throw accountDeleted();
        await tx.adminAuditEvent.create({
          data: {
            adminUserId,
            action: "AGENT_PAUSED",
            targetType: "User",
            targetId: userId,
            reason,
            metadata: { duration, until: until ? until.toISOString() : null }
          }
        });
      });
    },

    async clearAgentPause({ userId, adminUserId, reason }) {
      await client.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id: userId, status: { not: "DELETED" } },
          data: { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, agentPausedByUserId: null }
        });
        if (count === 0) throw accountDeleted();
        await tx.adminAuditEvent.create({
          data: { adminUserId, action: "AGENT_RESUMED", targetType: "User", targetId: userId, reason }
        });
      });
    },

    async anonymize({ userId, adminUserId, reason, emailDomain, now, transfer }) {
      // Unique and unreachable, so the address can never sign in or collide with a real one.
      const deletedEmail = `deleted+${userId}@deleted.invalid`;
      await client.$transaction(async (tx) => {
        // Claim the row first: of two concurrent deletes only one gets past this, so only one audit row is written.
        // Trips, itineraries, chats and notes keep pointing at this row and now show "Deleted user".
        const { count } = await tx.user.updateMany({
          where: { id: userId, status: { not: "DELETED" } },
          data: {
            email: deletedEmail,
            emailNormalized: deletedEmail,
            displayName: "Deleted user",
            passwordHash: null,
            emailVerifiedAt: null,
            avatarImageId: null,
            status: "DELETED",
            deletedAt: now,
            agentPausedAt: null,
            agentPausedUntil: null,
            agentPauseReason: null,
            agentPausedByUserId: null
          }
        });
        if (count === 0) throw accountDeleted();

        if (transfer) {
          // Re-checked here, not trusted from the earlier read: the owner or the successor may have changed since.
          const moved = await tx.agency.updateMany({
            where: { id: transfer.agencyId, ownerUserId: userId },
            data: { ownerUserId: transfer.toUserId }
          });
          if (moved.count !== 1) {
            throw new ApiError(409, "OWNERSHIP_CHANGED", "This agency's owner changed. Reload and try again.");
          }
          const promoted = await tx.agencyMembership.updateMany({
            where: { agencyId: transfer.agencyId, userId: transfer.toUserId, status: "ACTIVE", user: { status: "ACTIVE" } },
            data: { role: "OWNER" }
          });
          if (promoted.count !== 1) {
            throw new ApiError(400, "INVALID_NEW_OWNER", "The new owner must be an active member of the agency.");
          }
          await tx.adminAuditEvent.create({
            data: {
              adminUserId,
              action: "AGENCY_OWNERSHIP_TRANSFERRED",
              targetType: "Agency",
              targetId: transfer.agencyId,
              reason,
              metadata: { fromUserId: userId, toUserId: transfer.toUserId }
            }
          });
        }

        await tx.agencyInvitation.updateMany({
          where: { invitedByUserId: userId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now, revokedByUserId: adminUserId }
        });
        await tx.session.deleteMany({ where: { userId } });
        await tx.authProviderAccount.deleteMany({ where: { userId } });
        await tx.emailVerificationToken.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.agencyMembership.deleteMany({ where: { userId } });
        await tx.adminAuditEvent.create({
          data: { adminUserId, action: "USER_DELETED", targetType: "User", targetId: userId, reason, metadata: { emailDomain } }
        });
      });
    }
  };
}
