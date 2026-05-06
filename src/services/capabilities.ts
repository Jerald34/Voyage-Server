import type { AgencyMembership, User } from "@prisma/client";

type UserWithMemberships = User & {
  memberships?: AgencyMembership[];
};

export function getUserCapabilities(user: UserWithMemberships) {
  return {
    canUseApp: user.status === "ACTIVE",
    canRegisterAgency: user.status === "ACTIVE" && Boolean(user.emailVerifiedAt),
    canReviewAgencies: user.status === "ACTIVE" && user.role === "ADMIN",
    agencyMembershipCount: user.memberships?.length ?? 0
  };
}
