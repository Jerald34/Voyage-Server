import { prisma } from "../../db/prisma";
import { findOwnedAgencies } from "./accountActionRepository";
import type { AdminAccountAuditRow, AdminAccountDetailRow, AdminAccountRepository, AdminAccountRow } from "./accountService";

/**
 * Explicit `select` only — never `include` on User — so no column the admin page does not
 * need (emailNormalized, avatar, sessions, tokens) can reach the response. `passwordHash`
 * is selected only so the mapper can report a PASSWORD sign-in method; accountService drops it.
 */
const accountSelect = {
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
    select: {
      role: true,
      status: true,
      agency: { select: { id: true, name: true, status: true } }
    }
  }
} as const;

export const adminAccountRepository: AdminAccountRepository = {
  async listAccounts(): Promise<AdminAccountRow[]> {
    return prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: accountSelect
    });
  },

  async findAccount(id: string): Promise<AdminAccountDetailRow | null> {
    return prisma.user.findUnique({
      where: { id },
      select: {
        ...accountSelect,
        updatedAt: true,
        _count: {
          select: { createdItineraries: true, createdClientTrips: true, createdAgentThreads: true }
        }
      }
    });
  },

  async listAuditEvents(userId: string): Promise<AdminAccountAuditRow[]> {
    return prisma.adminAuditEvent.findMany({
      where: { targetType: "User", targetId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, reason: true, createdAt: true, adminUser: { select: { displayName: true } } }
    });
  },

  listOwnedAgencies(userId: string) {
    return findOwnedAgencies(prisma, userId);
  },

  async usageSince(userId: string, from: Date) {
    // Same definition of "metered" as the Usage tab: finished runs that recorded token counts.
    const metered = {
      usageUserId: userId,
      createdAt: { gte: from },
      status: { in: ["COMPLETED" as const, "FAILED" as const] },
      totalTokens: { not: null }
    };
    const [result, unpriced] = await Promise.all([
      prisma.agentRun.aggregate({ where: metered, _sum: { costUsd: true }, _count: { _all: true } }),
      // A run that used a model with no price recorded a cost without it; the total is then a floor.
      prisma.agentRun.count({ where: { ...metered, costComplete: false } })
    ]);
    return { costUsd: Number(result._sum.costUsd ?? 0), runCount: result._count._all, costComplete: unpriced === 0 };
  }
};
