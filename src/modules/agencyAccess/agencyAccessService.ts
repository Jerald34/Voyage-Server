import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";

export type AgencyAccessUser = {
  id: string;
  status: "ACTIVE" | "DISABLED";
};

export type AgencyAccess = {
  agency: {
    id: string;
    status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  };
  membership: {
    id: string;
    userId: string;
    agencyId: string;
    role: "OWNER" | "ADMIN" | "STAFF";
    status: "ACTIVE" | "DISABLED";
  } | null;
};

export type AgencyAccessRepository = {
  findAgencyAccess(userId: string, agencyId: string): Promise<AgencyAccess | null>;
  findTripOrganizer(agencyId: string, tripId: string): Promise<{ assignedOrganizerUserId: string | null } | null>;
};

export function createAgencyAccessService(options: { repository: AgencyAccessRepository }) {
  async function requireVerifiedAgencyMember(
    user: AgencyAccessUser,
    agencyId: string,
    allowedRoles: Array<"OWNER" | "ADMIN" | "STAFF"> = ["OWNER", "ADMIN", "STAFF"]
  ) {
    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
    }

    const access = await options.repository.findAgencyAccess(user.id, agencyId);
    if (!access?.agency) {
      throw new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found.");
    }

    if (access.agency.status !== "VERIFIED") {
      throw new ApiError(
        403,
        "AGENCY_NOT_VERIFIED",
        "Agency must be verified before using itinerary agent features."
      );
    }

    if (
      !access.membership ||
      access.membership.status !== "ACTIVE" ||
      !allowedRoles.includes(access.membership.role)
    ) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }

    return access;
  }

  async function requireAgencyOwner(user: AgencyAccessUser, agencyId: string) {
    const access = await requireVerifiedAgencyMember(user, agencyId);
    if (!access.membership || access.membership.role !== "OWNER") {
      throw new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can perform this action.");
    }
    return access;
  }

  async function requireAgencyAdmin(user: AgencyAccessUser, agencyId: string) {
    const access = await requireVerifiedAgencyMember(user, agencyId);
    if (!access.membership || (access.membership.role !== "OWNER" && access.membership.role !== "ADMIN")) {
      throw new ApiError(403, "AGENCY_ADMIN_REQUIRED", "Only the agency owner or admin can perform this action.");
    }
    return access;
  }

  async function requireTripAccess(user: AgencyAccessUser, agencyId: string, tripId: string) {
    const access = await requireVerifiedAgencyMember(user, agencyId);

    // OWNER and ADMIN see every trip in the agency.
    if (access.membership && (access.membership.role === "OWNER" || access.membership.role === "ADMIN")) {
      return access;
    }

    // STAFF: must be the assigned organizer, else surface as 404 (prevent probing).
    const trip = await options.repository.findTripOrganizer(access.agency.id, tripId);
    if (!trip || trip.assignedOrganizerUserId !== user.id) {
      throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    }

    return access;
  }

  return { requireVerifiedAgencyMember, requireAgencyOwner, requireAgencyAdmin, requireTripAccess };
}

export function createPrismaAgencyAccessRepository(client: PrismaClient = prisma): AgencyAccessRepository {
  return {
    async findAgencyAccess(userId, agencyIdOrSlug) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agencyIdOrSlug);

      const agency = await client.agency.findUnique({
        where: isUuid ? { id: agencyIdOrSlug } : { slug: agencyIdOrSlug },
        include: {
          memberships: {
            where: { userId },
            take: 1
          }
        }
      });

      if (!agency) {
        return null;
      }

      return {
        agency,
        membership: agency.memberships[0] ?? null
      } as AgencyAccess;
    },
    async findTripOrganizer(agencyId, tripId) {
      return client.clientTrip.findFirst({
        where: { id: tripId, agencyId },
        select: { assignedOrganizerUserId: true }
      });
    }
  };
}

export const agencyAccessService = createAgencyAccessService({
  repository: createPrismaAgencyAccessRepository()
});
