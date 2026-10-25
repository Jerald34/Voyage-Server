// src/modules/admin/accountActionService.ts
import { ApiError } from "../../http/errors";

export type AccountActionUserStatus = "ACTIVE" | "DISABLED" | "DELETED";

/** The fields the rules need about the account being acted on. */
export interface AccountActionTarget {
  id: string;
  email: string;
  role: string;
  status: AccountActionUserStatus;
}

export interface OwnedAgencySuccessor {
  userId: string;
  displayName: string;
  role: "ADMIN" | "STAFF";
}

/** An agency the account owns, with the active members who could take it over. */
export interface OwnedAgency {
  agencyId: string;
  agencyName: string;
  successors: OwnedAgencySuccessor[];
}

export interface AnonymizeInput {
  userId: string;
  adminUserId: string;
  reason: string | null;
  /** Only the domain of the old email is kept, in the audit row. */
  emailDomain: string;
  now: Date;
  transfer: { agencyId: string; toUserId: string } | null;
}

export interface AccountActionRepository {
  findTarget(userId: string): Promise<AccountActionTarget | null>;
  listOwnedAgencies(userId: string): Promise<OwnedAgency[]>;
  /** Sets the status, writes the audit row, and (for DISABLED) deletes every session — in one transaction. */
  setStatus(input: { userId: string; status: "ACTIVE" | "DISABLED"; adminUserId: string; reason: string | null }): Promise<void>;
  revokeSessions(input: { userId: string; adminUserId: string; reason: string | null }): Promise<void>;
  anonymize(input: AnonymizeInput): Promise<void>;
}

export interface AccountActionActor {
  id: string;
  role: string;
}

export interface DeleteAccountInput {
  confirmEmail: string;
  reason?: string | null;
  newOwnerUserId?: string | null;
}

export function createAdminAccountActionService(options: { repository: AccountActionRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const { repository } = options;

  async function loadTarget(actor: AccountActionActor, userId: string): Promise<AccountActionTarget> {
    if (actor.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required.");
    }
    const target = await repository.findTarget(userId);
    if (!target) {
      throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    }
    if (target.id === actor.id) {
      throw new ApiError(403, "CANNOT_ACT_ON_SELF", "You can't do this to your own account.");
    }
    if (target.role === "SUPER_ADMIN") {
      throw new ApiError(403, "CANNOT_ACT_ON_SUPER_ADMIN", "Super admin accounts can't be changed here.");
    }
    if (target.status === "DELETED") {
      throw new ApiError(409, "ACCOUNT_DELETED", "This account has been deleted.");
    }
    return target;
  }

  return {
    async disable(actor: AccountActionActor, userId: string, reason: string | null = null) {
      const target = await loadTarget(actor, userId);
      if (target.status === "DISABLED") return;
      await repository.setStatus({ userId, status: "DISABLED", adminUserId: actor.id, reason });
    },

    async enable(actor: AccountActionActor, userId: string, reason: string | null = null) {
      const target = await loadTarget(actor, userId);
      if (target.status === "ACTIVE") return;
      await repository.setStatus({ userId, status: "ACTIVE", adminUserId: actor.id, reason });
    },

    async signOutEverywhere(actor: AccountActionActor, userId: string, reason: string | null = null) {
      await loadTarget(actor, userId);
      await repository.revokeSessions({ userId, adminUserId: actor.id, reason });
    },

    async deleteAccount(actor: AccountActionActor, userId: string, input: DeleteAccountInput) {
      // Filled in by Task 4.
      await loadTarget(actor, userId);
      void input;
      throw new ApiError(501, "NOT_IMPLEMENTED", "Delete is not implemented yet.");
    }
  };
}
