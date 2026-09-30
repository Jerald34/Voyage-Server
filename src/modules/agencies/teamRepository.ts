import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type TeamMembershipRecord = {
  id: string;
  agencyId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
  user: { id: string; email: string; displayName: string };
  createdAt: Date;
};

export type TeamRepository = {
  listMembers(agencyId: string): Promise<TeamMembershipRecord[]>;
  findUserByEmail(emailNormalized: string): Promise<{ id: string } | null>;
  createMembership(input: { agencyId: string; userId: string; role: "ADMIN" | "STAFF" }): Promise<TeamMembershipRecord>;
  updateMembershipRole(membershipId: string, role: "ADMIN" | "STAFF"): Promise<TeamMembershipRecord>;
  deleteMembership(membershipId: string): Promise<void>;
  findMembershipById(membershipId: string): Promise<TeamMembershipRecord | null>;
  transferOwnership(input: { agencyId: string; fromUserId: string; toUserId: string }): Promise<void>;
};

export function createPrismaTeamRepository(client: PrismaClient = prisma): TeamRepository {
  const userSelect = { id: true, email: true, displayName: true } as const;
  return {
    async listMembers(agencyId) {
      return client.agencyMembership.findMany({
        where: { agencyId },
        include: { user: { select: userSelect } },
        orderBy: { createdAt: "asc" }
      }) as Promise<TeamMembershipRecord[]>;
    },
    async findUserByEmail(emailNormalized) {
      return client.user.findUnique({ where: { emailNormalized }, select: { id: true } });
    },
    async createMembership(input) {
      return client.agencyMembership.create({
        data: { ...input, status: "ACTIVE" },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord>;
    },
    async updateMembershipRole(membershipId, role) {
      return client.agencyMembership.update({
        where: { id: membershipId },
        data: { role },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord>;
    },
    async deleteMembership(membershipId) {
      await client.agencyMembership.delete({ where: { id: membershipId } });
    },
    async findMembershipById(membershipId) {
      return client.agencyMembership.findUnique({
        where: { id: membershipId },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord | null>;
    },
    async transferOwnership({ agencyId, fromUserId, toUserId }) {
      await client.$transaction([
        client.agencyMembership.update({
          where: { agencyId_userId: { agencyId, userId: fromUserId } },
          data: { role: "ADMIN" }
        }),
        client.agencyMembership.update({
          where: { agencyId_userId: { agencyId, userId: toUserId } },
          data: { role: "OWNER" }
        }),
        client.agency.update({ where: { id: agencyId }, data: { ownerUserId: toUserId } })
      ]);
    }
  };
}
