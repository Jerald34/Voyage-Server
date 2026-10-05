import { ApiError } from "../../http/errors";

export type AdminAccountRole = "USER" | "SUPER_ADMIN";
export type AdminAccountStatus = "ACTIVE" | "DISABLED";
export type AdminAccountType = "PENDING" | "PERSONAL" | "AGENCY_USER";
export type AdminAccountProvider = "GOOGLE" | "APPLE";
export type AdminAccountSignInMethod = "PASSWORD" | AdminAccountProvider;
export type AdminAccountMembershipRole = "OWNER" | "ADMIN" | "STAFF";
export type AdminAccountMembershipStatus = "ACTIVE" | "DISABLED";
export type AdminAccountAgencyStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";

/**
 * Row shapes the repository selects from Prisma. `passwordHash` is selected only so the
 * mapper can tell whether a password sign-in exists; it is never copied to the output.
 */
export interface AdminAccountMembershipRow {
  role: AdminAccountMembershipRole;
  status: AdminAccountMembershipStatus;
  agency: { id: string; name: string; status: AdminAccountAgencyStatus };
}

export interface AdminAccountRow {
  id: string;
  email: string;
  displayName: string;
  role: AdminAccountRole;
  status: AdminAccountStatus;
  accountType: AdminAccountType;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  passwordHash: string | null;
  providerAccounts: Array<{ provider: AdminAccountProvider }>;
  memberships: AdminAccountMembershipRow[];
}

export interface AdminAccountDetailRow extends AdminAccountRow {
  updatedAt: Date;
  _count: {
    createdItineraries: number;
    createdClientTrips: number;
    createdAgentThreads: number;
  };
}

export interface AdminAccountRepository {
  listAccounts(): Promise<AdminAccountRow[]>;
  findAccount(id: string): Promise<AdminAccountDetailRow | null>;
}

export interface AdminAccountServiceUser {
  id: string;
  role: string;
}

export interface AdminAccountMembership {
  agencyId: string;
  agencyName: string;
  agencyStatus: AdminAccountAgencyStatus;
  role: AdminAccountMembershipRole;
  status: AdminAccountMembershipStatus;
}

export interface AdminAccountSummary {
  id: string;
  email: string;
  displayName: string;
  role: AdminAccountRole;
  status: AdminAccountStatus;
  accountType: AdminAccountType;
  emailVerified: boolean;
  createdAt: string;
  signInMethods: AdminAccountSignInMethod[];
  memberships: AdminAccountMembership[];
}

export interface AdminAccountDetail extends AdminAccountSummary {
  emailVerifiedAt: string | null;
  updatedAt: string;
  activity: { itineraries: number; clientTrips: number; agentThreads: number };
}

function toSignInMethods(row: AdminAccountRow): AdminAccountSignInMethod[] {
  const methods: AdminAccountSignInMethod[] = [];
  if (typeof row.passwordHash === "string" && row.passwordHash.length > 0) {
    methods.push("PASSWORD");
  }
  for (const account of row.providerAccounts) {
    if (!methods.includes(account.provider)) {
      methods.push(account.provider);
    }
  }
  return methods;
}

/**
 * Pure mapper: builds the response field by field (never spreads the row) so a column
 * added to the repository's select can never reach the API by accident.
 */
export function toAccountSummary(row: AdminAccountRow): AdminAccountSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    accountType: row.accountType,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
    signInMethods: toSignInMethods(row),
    memberships: row.memberships.map((membership) => ({
      agencyId: membership.agency.id,
      agencyName: membership.agency.name,
      agencyStatus: membership.agency.status,
      role: membership.role,
      status: membership.status
    }))
  };
}

export function toAccountDetail(row: AdminAccountDetailRow): AdminAccountDetail {
  return {
    ...toAccountSummary(row),
    emailVerifiedAt: row.emailVerifiedAt ? row.emailVerifiedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    activity: {
      itineraries: row._count.createdItineraries,
      clientTrips: row._count.createdClientTrips,
      agentThreads: row._count.createdAgentThreads
    }
  };
}

function assertSuperAdmin(user: AdminAccountServiceUser) {
  if (user.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required.");
  }
}

export function createAdminAccountService(options: { repository: AdminAccountRepository }) {
  return {
    async listAccounts(user: AdminAccountServiceUser): Promise<AdminAccountSummary[]> {
      assertSuperAdmin(user);
      const rows = await options.repository.listAccounts();
      return rows.map(toAccountSummary);
    },

    async getAccount(user: AdminAccountServiceUser, userId: string): Promise<AdminAccountDetail> {
      assertSuperAdmin(user);
      const row = await options.repository.findAccount(userId);
      if (!row) {
        throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
      }
      return toAccountDetail(row);
    }
  };
}
