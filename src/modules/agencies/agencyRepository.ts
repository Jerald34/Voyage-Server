import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type {
  AgencyRecord,
  AgencyWithOwner,
  AgencyMembershipRecord,
  AdminAuditRecord,
  AgencyRepository
} from "./agencyTypes";

const ownerSelect = { id: true, email: true, displayName: true } as const;
const auditInclude = { adminUser: { select: { id: true, displayName: true } } } as const;

export function createPrismaAgencyRepository(client: PrismaClient = prisma): AgencyRepository {
  return {
    async createAgency(data) {
      return client.agency.create({ data }) as Promise<AgencyRecord>;
    },
    async createOwnerMembership(data) {
      return client.agencyMembership.create({
        data: {
          ...data,
          role: "OWNER",
          status: "ACTIVE"
        }
      }) as Promise<AgencyMembershipRecord>;
    },
    async findMembership(agencyId, userId) {
      return client.agencyMembership.findUnique({
        where: {
          agencyId_userId: {
            agencyId,
            userId
          }
        }
      }) as Promise<AgencyMembershipRecord | null>;
    },
    async listPendingAgencies() {
      return client.agency.findMany({
        where: { status: "PENDING_REVIEW" },
        orderBy: { submittedAt: "asc" }
      }) as Promise<AgencyRecord[]>;
    },
    async listAgencies(status?) {
      const where = status ? { status: status as AgencyRecord["status"] } : {};
      return client.agency.findMany({
        where,
        include: { ownerUser: { select: ownerSelect } },
        orderBy: { submittedAt: "desc" }
      }) as Promise<AgencyWithOwner[]>;
    },
    async findAgencyById(id) {
      return client.agency.findUnique({ where: { id } }) as Promise<AgencyRecord | null>;
    },
    async findAgencyByIdWithOwner(id) {
      return client.agency.findUnique({
        where: { id },
        include: { ownerUser: { select: ownerSelect } }
      }) as Promise<AgencyWithOwner | null>;
    },
    async countAgenciesByStatus(status) {
      return client.agency.count({ where: { status: status as AgencyRecord["status"] } });
    },
    async listAuditEventsForTarget(targetType, targetId) {
      return client.adminAuditEvent.findMany({
        where: { targetType, targetId },
        include: auditInclude,
        orderBy: { createdAt: "desc" }
      }) as Promise<AdminAuditRecord[]>;
    },
    async updateAgency(id, data) {
      return client.agency.update({
        where: { id },
        data
      }) as Promise<AgencyRecord>;
    },
    async createAdminAuditEvent(data) {
      return client.adminAuditEvent.create({ data: data as never }) as Promise<AdminAuditRecord>;
    }
  };
}

export const agencyRepository = createPrismaAgencyRepository();
