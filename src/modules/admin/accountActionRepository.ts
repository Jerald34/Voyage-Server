// src/modules/admin/accountActionRepository.ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { AccountActionRepository, OwnedAgency } from "./accountActionService";

type OwnedAgenciesClient = Pick<PrismaClient, "agencyMembership">;

/** Agencies the user owns, each with its other active members (the people who could take it over). */
export async function findOwnedAgencies(client: OwnedAgenciesClient, userId: string): Promise<OwnedAgency[]> {
  const rows = await client.agencyMembership.findMany({
    where: { userId, role: "OWNER", status: "ACTIVE" },
    select: {
      agency: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: { status: "ACTIVE", userId: { not: userId } },
            orderBy: { createdAt: "asc" },
            select: { role: true, user: { select: { id: true, displayName: true } } }
          }
        }
      }
    }
  });
  return rows.map((row) => ({
    agencyId: row.agency.id,
    agencyName: row.agency.name,
    successors: row.agency.memberships.map((member) => ({
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
        select: { id: true, email: true, role: true, status: true }
      });
    },

    listOwnedAgencies(userId) {
      return findOwnedAgencies(client, userId);
    },

    async setStatus({ userId, status, adminUserId, reason }) {
      await client.$transaction([
        client.user.update({ where: { id: userId }, data: { status } }),
        // A disabled user is already rejected on every request; deleting the sessions also clears their devices.
        ...(status === "DISABLED" ? [client.session.deleteMany({ where: { userId } })] : []),
        client.adminAuditEvent.create({
          data: { adminUserId, action: status === "DISABLED" ? "USER_DISABLED" : "USER_ENABLED", targetType: "USER", targetId: userId, reason }
        })
      ]);
    },

    async revokeSessions({ userId, adminUserId, reason }) {
      await client.$transaction([
        client.session.deleteMany({ where: { userId } }),
        client.adminAuditEvent.create({
          data: { adminUserId, action: "USER_SESSIONS_REVOKED", targetType: "USER", targetId: userId, reason }
        })
      ]);
    },

    async anonymize({ userId, adminUserId, reason, emailDomain, now, transfer }) {
      // Unique and unreachable, so the address can never sign in or collide with a real one.
      const deletedEmail = `deleted+${userId}@deleted.invalid`;
      await client.$transaction(async (tx) => {
        if (transfer) {
          await tx.agencyMembership.update({
            where: { agencyId_userId: { agencyId: transfer.agencyId, userId: transfer.toUserId } },
            data: { role: "OWNER" }
          });
          await tx.agency.update({ where: { id: transfer.agencyId }, data: { ownerUserId: transfer.toUserId } });
          await tx.adminAuditEvent.create({
            data: {
              adminUserId,
              action: "AGENCY_OWNERSHIP_TRANSFERRED",
              targetType: "AGENCY",
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
        // Trips, itineraries, chats and notes keep pointing at this row and now show "Deleted user".
        await tx.user.update({
          where: { id: userId },
          data: {
            email: deletedEmail,
            emailNormalized: deletedEmail,
            displayName: "Deleted user",
            passwordHash: null,
            emailVerifiedAt: null,
            avatarImageId: null,
            status: "DELETED",
            deletedAt: now
          }
        });
        await tx.adminAuditEvent.create({
          data: { adminUserId, action: "USER_DELETED", targetType: "USER", targetId: userId, reason, metadata: { emailDomain } }
        });
      });
    }
  };
}
