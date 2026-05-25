import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type InvitationRecord = {
  id: string;
  agencyId: string;
  email: string;
  emailNormalized: string;
  role: "ADMIN" | "STAFF";
  invitedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
};

export type InvitationWithContext = InvitationRecord & {
  agency: { id: string; name: string; status: string };
  invitedByUser: { id: string; displayName: string; email: string };
};

export type InvitationRepository = {
  create(input: {
    agencyId: string;
    email: string;
    emailNormalized: string;
    role: "ADMIN" | "STAFF";
    invitedByUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<InvitationRecord>;
  findByTokenHash(tokenHash: string): Promise<InvitationWithContext | null>;
  findById(id: string): Promise<InvitationRecord | null>;
  findActiveByAgencyAndEmail(
    agencyId: string,
    emailNormalized: string,
    now: Date
  ): Promise<InvitationRecord | null>;
  listOutstanding(agencyId: string, now: Date): Promise<InvitationRecord[]>;
  markAccepted(id: string, acceptedAt: Date, acceptedByUserId: string): Promise<InvitationRecord>;
  markRevoked(id: string, revokedAt: Date, revokedByUserId: string): Promise<InvitationRecord>;
};

export function createPrismaInvitationRepository(client: PrismaClient = prisma): InvitationRepository {
  return {
    async create(input) {
      return client.agencyInvitation.create({ data: input }) as Promise<InvitationRecord>;
    },
    async findByTokenHash(tokenHash) {
      return client.agencyInvitation.findUnique({
        where: { tokenHash },
        include: {
          agency: { select: { id: true, name: true, status: true } },
          invitedByUser: { select: { id: true, displayName: true, email: true } }
        }
      }) as unknown as Promise<InvitationWithContext | null>;
    },
    async findById(id) {
      return client.agencyInvitation.findUnique({ where: { id } }) as Promise<InvitationRecord | null>;
    },
    async findActiveByAgencyAndEmail(agencyId, emailNormalized, now) {
      return client.agencyInvitation.findFirst({
        where: {
          agencyId,
          emailNormalized,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now }
        }
      }) as Promise<InvitationRecord | null>;
    },
    async listOutstanding(agencyId, now) {
      return client.agencyInvitation.findMany({
        where: {
          agencyId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        orderBy: { createdAt: "desc" }
      }) as Promise<InvitationRecord[]>;
    },
    async markAccepted(id, acceptedAt, acceptedByUserId) {
      return client.agencyInvitation.update({
        where: { id },
        data: { acceptedAt, acceptedByUserId }
      }) as Promise<InvitationRecord>;
    },
    async markRevoked(id, revokedAt, revokedByUserId) {
      return client.agencyInvitation.update({
        where: { id },
        data: { revokedAt, revokedByUserId }
      }) as Promise<InvitationRecord>;
    }
  };
}
