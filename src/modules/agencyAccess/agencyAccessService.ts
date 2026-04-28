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
    userId: string;
    agencyId: string;
    role: "OWNER" | "ADMIN" | "STAFF";
    status: "ACTIVE" | "DISABLED";
  } | null;
};

export type AgencyAccessRepository = {
  findAgencyAccess(userId: string, agencyId: string): Promise<AgencyAccess | null>;
};

export function createAgencyAccessService(options: { repository: AgencyAccessRepository }) {
  return {
    async requireVerifiedAgencyMember(
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
  };
}

export function createPrismaAgencyAccessRepository(client: PrismaClient = prisma): AgencyAccessRepository {
  return {
    async findAgencyAccess(userId, agencyId) {
      const agency = await client.agency.findUnique({
        where: { id: agencyId },
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
    }
  };
}

export const agencyAccessService = createAgencyAccessService({
  repository: createPrismaAgencyAccessRepository()
});
