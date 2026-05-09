import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";

export type AgencyUser = {
  id: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  emailVerifiedAt: Date | null;
};

export type AgencyRecord = {
  id: string;
  name: string;
  slug: string;
  status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  ownerUserId: string;
  submittedAt: Date;
  verifiedAt: Date | null;
  verifiedByAdminUserId: string | null;
  rejectedAt: Date | null;
  rejectedByAdminUserId: string | null;
  rejectionReason: string | null;
  suspendedAt: Date | null;
  suspendedByAdminUserId: string | null;
  suspensionReason: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  country: string | null;
  city: string | null;
};

export type AgencyWithOwner = AgencyRecord & {
  ownerUser: { id: string; email: string; displayName: string };
};

export type AgencyDetailRecord = AgencyWithOwner & {
  auditEvents: AdminAuditRecord[];
};

export type AgencyMembershipRecord = {
  id: string;
  agencyId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
};

export type AdminAuditRecord = {
  id: string;
  adminUserId: string;
  action:
    | "AGENCY_APPROVED"
    | "AGENCY_REJECTED"
    | "AGENCY_SUSPENDED"
    | "AGENCY_UNSUSPENDED"
    | "USER_PROMOTED_TO_ADMIN"
    | "USER_DISABLED";
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata?: unknown;
  createdAt: Date;
};

export type AgencyRepository = {
  createAgency(data: {
    name: string;
    slug: string;
    ownerUserId: string;
    businessPhone?: string;
    businessEmail?: string;
    country?: string;
    city?: string;
    logoImageId?: string;
  }): Promise<AgencyRecord>;
  createOwnerMembership(data: { agencyId: string; userId: string }): Promise<AgencyMembershipRecord>;
  listPendingAgencies(): Promise<AgencyRecord[]>;
  listAgencies(status?: string): Promise<AgencyWithOwner[]>;
  findAgencyById(id: string): Promise<AgencyRecord | null>;
  findAgencyByIdWithOwner(id: string): Promise<AgencyWithOwner | null>;
  countAgenciesByStatus(status: string): Promise<number>;
  listAuditEventsForTarget(targetType: string, targetId: string): Promise<AdminAuditRecord[]>;
  updateAgency(id: string, data: Partial<AgencyRecord>): Promise<AgencyRecord>;
  createAdminAuditEvent(data: Omit<AdminAuditRecord, "id" | "createdAt">): Promise<AdminAuditRecord>;
};

export function slugifyAgencyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function assertActive(user: AgencyUser) {
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
  }
}

function assertAdmin(user: AgencyUser) {
  assertActive(user);
  if (user.role !== "ADMIN") {
    throw new ApiError(403, "ADMIN_REQUIRED", "Admin access is required.");
  }
}

export function createAgencyService(options: { repository: AgencyRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());

  async function findRequiredAgency(agencyId: string) {
    const agency = await options.repository.findAgencyById(agencyId);
    if (!agency) {
      throw new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found.");
    }
    return agency;
  }

  return {
    async createAgencyApplication(user: AgencyUser, input: {
      name: string;
      businessPhone: string;
      businessEmail?: string;
      country: string;
      city: string;
      logoImageId?: string;
    }) {
      assertActive(user);

      const name = input.name.trim();
      if (!name) {
        throw new ApiError(400, "AGENCY_NAME_REQUIRED", "Agency name is required.");
      }

      const agency = await options.repository.createAgency({
        name,
        slug: slugifyAgencyName(name),
        ownerUserId: user.id,
        businessPhone: input.businessPhone.trim(),
        businessEmail: input.businessEmail?.trim(),
        country: input.country.trim(),
        city: input.city.trim(),
        logoImageId: input.logoImageId,
      });
      await options.repository.createOwnerMembership({ agencyId: agency.id, userId: user.id });
      return agency;
    },

    async listPendingAgencies(user: AgencyUser) {
      assertAdmin(user);
      return options.repository.listPendingAgencies();
    },

    async approveAgency(user: AgencyUser, agencyId: string) {
      assertAdmin(user);
      await findRequiredAgency(agencyId);
      const reviewedAt = now();
      const agency = await options.repository.updateAgency(agencyId, {
        status: "VERIFIED",
        verifiedAt: reviewedAt,
        verifiedByAdminUserId: user.id,
        rejectedAt: null,
        rejectedByAdminUserId: null,
        rejectionReason: null,
        suspendedAt: null,
        suspendedByAdminUserId: null,
        suspensionReason: null
      });
      await options.repository.createAdminAuditEvent({
        adminUserId: user.id,
        action: "AGENCY_APPROVED",
        targetType: "Agency",
        targetId: agencyId,
        reason: null
      });
      return agency;
    },

    async rejectAgency(user: AgencyUser, agencyId: string, input: { reason: string }) {
      assertAdmin(user);
      await findRequiredAgency(agencyId);
      const reason = input.reason.trim();
      if (!reason) {
        throw new ApiError(400, "REJECTION_REASON_REQUIRED", "Rejection reason is required.");
      }
      const agency = await options.repository.updateAgency(agencyId, {
        status: "REJECTED",
        rejectedAt: now(),
        rejectedByAdminUserId: user.id,
        rejectionReason: reason
      });
      await options.repository.createAdminAuditEvent({
        adminUserId: user.id,
        action: "AGENCY_REJECTED",
        targetType: "Agency",
        targetId: agencyId,
        reason
      });
      return agency;
    },

    async suspendAgency(user: AgencyUser, agencyId: string, input: { reason: string }) {
      assertAdmin(user);
      await findRequiredAgency(agencyId);
      const reason = input.reason.trim();
      if (!reason) {
        throw new ApiError(400, "SUSPENSION_REASON_REQUIRED", "Suspension reason is required.");
      }
      const agency = await options.repository.updateAgency(agencyId, {
        status: "SUSPENDED",
        suspendedAt: now(),
        suspendedByAdminUserId: user.id,
        suspensionReason: reason
      });
      await options.repository.createAdminAuditEvent({
        adminUserId: user.id,
        action: "AGENCY_SUSPENDED",
        targetType: "Agency",
        targetId: agencyId,
        reason
      });
      return agency;
    },

    async unsuspendAgency(user: AgencyUser, agencyId: string) {
      assertAdmin(user);
      const agency = await findRequiredAgency(agencyId);
      if (agency.status !== "SUSPENDED") {
        throw new ApiError(400, "AGENCY_NOT_SUSPENDED", "Only suspended agencies can be unsuspended.");
      }
      const updated = await options.repository.updateAgency(agencyId, {
        status: "VERIFIED",
        suspendedAt: null,
        suspendedByAdminUserId: null,
        suspensionReason: null
      });
      await options.repository.createAdminAuditEvent({
        adminUserId: user.id,
        action: "AGENCY_UNSUSPENDED",
        targetType: "Agency",
        targetId: agencyId,
        reason: null
      });
      return updated;
    },

    async listAllAgencies(user: AgencyUser, status?: string) {
      assertAdmin(user);
      return options.repository.listAgencies(status);
    },

    async getAgencyDetail(user: AgencyUser, agencyId: string): Promise<AgencyDetailRecord> {
      assertAdmin(user);
      const agency = await options.repository.findAgencyByIdWithOwner(agencyId);
      if (!agency) {
        throw new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found.");
      }
      const auditEvents = await options.repository.listAuditEventsForTarget("Agency", agencyId);
      return { ...agency, auditEvents };
    },

    async getPendingCount(user: AgencyUser) {
      assertAdmin(user);
      return options.repository.countAgenciesByStatus("PENDING_REVIEW");
    }
  };
}

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

export const agencyService = createAgencyService({
  repository: createPrismaAgencyRepository()
});
