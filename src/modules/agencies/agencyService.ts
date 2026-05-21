import { ApiError } from "../../http/errors";
import type { AgencyUser, AgencyRepository, AgencyMembershipRecord } from "./agencyTypes";

import { createPrismaAgencyRepository } from "./agencyRepository";

export { createPrismaAgencyRepository } from "./agencyRepository";
export type {
  AgencyUser,
  AgencyRecord,
  AgencyWithOwner,
  AgencyDetailRecord,
  AgencyMembershipRecord,
  AdminAuditRecord,
  AgencyRepository
} from "./agencyTypes";

export function slugifyAgencyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeBusinessEmail(businessEmail: string | null | undefined) {
  if (businessEmail == null) {
    return businessEmail;
  }

  const trimmed = businessEmail.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeDigitsOnlyBusinessPhone(businessPhone: string) {
  const trimmed = businessPhone.trim();
  if (!trimmed) {
    throw new ApiError(400, "AGENCY_BUSINESS_PHONE_REQUIRED", "Business phone is required.");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new ApiError(400, "AGENCY_BUSINESS_PHONE_INVALID", "Business phone must contain digits only.");
  }
  return trimmed;
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

function assertAgencyOwnerMembership(membership: AgencyMembershipRecord | null) {
  if (!membership || membership.status !== "ACTIVE" || membership.role !== "OWNER") {
    throw new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can edit workspace settings.");
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
      businessEmail: string;
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
        businessPhone: normalizeDigitsOnlyBusinessPhone(input.businessPhone),
        businessEmail: input.businessEmail.trim(),
        country: input.country.trim(),
        city: input.city.trim(),
        logoImageId: input.logoImageId,
      });
      await options.repository.createOwnerMembership({ agencyId: agency.id, userId: user.id });
      return agency;
    },

    async updateAgencySettings(user: AgencyUser, agencyId: string, input: {
      name: string;
      businessPhone: string;
      businessEmail?: string | null;
      country: string;
      city: string;
    }) {
      assertActive(user);
      await findRequiredAgency(agencyId);

      const membership = await options.repository.findMembership(agencyId, user.id);
      assertAgencyOwnerMembership(membership);

      const name = input.name.trim();
      const businessPhone = normalizeDigitsOnlyBusinessPhone(input.businessPhone);
      const businessEmail = normalizeBusinessEmail(input.businessEmail);
      const country = input.country.trim();
      const city = input.city.trim();

      if (!name) throw new ApiError(400, "AGENCY_NAME_REQUIRED", "Agency name is required.");
      if (!businessPhone) throw new ApiError(400, "AGENCY_BUSINESS_PHONE_REQUIRED", "Business phone is required.");
      if (!country) throw new ApiError(400, "AGENCY_COUNTRY_REQUIRED", "Country is required.");
      if (!city) throw new ApiError(400, "AGENCY_CITY_REQUIRED", "City is required.");

      return options.repository.updateAgency(agencyId, {
        name,
        businessPhone,
        businessEmail,
        country,
        city
      });
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

    async getAgencyDetail(user: AgencyUser, agencyId: string) {
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

export const agencyService = createAgencyService({ repository: createPrismaAgencyRepository() });
