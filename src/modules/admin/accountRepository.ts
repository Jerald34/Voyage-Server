import { prisma } from "../../db/prisma";
import type { AdminAccountDetailRow, AdminAccountRepository, AdminAccountRow } from "./accountService";

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
  }
};
