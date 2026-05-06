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
  createAgency(data: { name: string; slug: string; ownerUserId: string }): Promise<AgencyRecord>;
  createOwnerMembership(data: { agencyId: string; userId: string }): Promise<AgencyMembershipRecord>;
  listPendingAgencies(): Promise<AgencyRecord[]>;
  findAgencyById(id: string): Promise<AgencyRecord | null>;
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
    async createAgencyApplication(user: AgencyUser, input: { name: string }) {
      assertActive(user);
      if (!user.emailVerifiedAt) {
        throw new ApiError(403, "EMAIL_VERIFICATION_REQUIRED", "Verify your email before registering an agency.");
      }

      const name = input.name.trim();
      if (!name) {
        throw new ApiError(400, "AGENCY_NAME_REQUIRED", "Agency name is required.");
      }

      const agency = await options.repository.createAgency({
        name,
        slug: slugifyAgencyName(name),
        ownerUserId: user.id
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
    }
  };
}

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
    async findAgencyById(id) {
      return client.agency.findUnique({ where: { id } }) as Promise<AgencyRecord | null>;
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
