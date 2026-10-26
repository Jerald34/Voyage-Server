// src/modules/admin/accountActionService.ts
import { ApiError } from "../../http/errors";
import { getActiveAgentPause, pauseUntil, type AgentPauseDuration, type AgentPauseFields } from "../agentPause/agentPause";

export type AccountActionUserStatus = "ACTIVE" | "DISABLED" | "DELETED";

/** The fields the rules need about the account being acted on. */
export interface AccountActionTarget extends AgentPauseFields {
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
  /** Sets the pause and writes the audit row in one transaction; never writes to a deleted account. */
  setAgentPause(input: {
    userId: string;
    adminUserId: string;
    pausedAt: Date;
    until: Date | null;
    reason: string;
    duration: AgentPauseDuration;
  }): Promise<void>;
  clearAgentPause(input: { userId: string; adminUserId: string }): Promise<void>;
}

export interface AccountActionActor {
  id: string;
  role: string;
}

export interface PauseAgentInput {
  duration: AgentPauseDuration;
  /** Shown to the user and their agency owner, so it is required. */
  reason: string;
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

    async pauseAgent(actor: AccountActionActor, userId: string, input: PauseAgentInput) {
      await loadTarget(actor, userId);
      const pausedAt = now();
      await repository.setAgentPause({
        userId,
        adminUserId: actor.id,
        pausedAt,
        until: pauseUntil(input.duration, pausedAt),
        reason: input.reason.trim(),
        duration: input.duration
      });
    },

    async resumeAgent(actor: AccountActionActor, userId: string) {
      const target = await loadTarget(actor, userId);
      // Resuming someone who isn't paused (or whose pause already ended) is done; no audit row for a no-op.
      if (!getActiveAgentPause(target, now())) return;
      await repository.clearAgentPause({ userId, adminUserId: actor.id });
    },

    async deleteAccount(actor: AccountActionActor, userId: string, input: DeleteAccountInput) {
      const target = await loadTarget(actor, userId);
      if (input.confirmEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
        throw new ApiError(400, "EMAIL_CONFIRMATION_MISMATCH", "The confirmation email does not match this account.");
      }

      // Order matters: a solo owner is the case the dialog explains, so it wins over the others.
      const owned = await repository.listOwnedAgencies(userId);
      const solo = owned.find((agency) => agency.successors.length === 0);
      if (solo) {
        throw new ApiError(409, "OWNER_HAS_NO_SUCCESSOR", `${solo.agencyName} has no other members.`, {
          agencyId: solo.agencyId,
          agencyName: solo.agencyName
        });
      }
      if (owned.length > 1) {
        throw new ApiError(409, "MULTIPLE_OWNED_AGENCIES", "This account owns more than one agency.");
      }

      let transfer: AnonymizeInput["transfer"] = null;
      if (owned.length === 1) {
        const agency = owned[0]!;
        if (!input.newOwnerUserId) {
          throw new ApiError(400, "NEW_OWNER_REQUIRED", `Choose a new owner for ${agency.agencyName} first.`, {
            agencyId: agency.agencyId,
            agencyName: agency.agencyName
          });
        }
        if (!agency.successors.some((successor) => successor.userId === input.newOwnerUserId)) {
          throw new ApiError(400, "INVALID_NEW_OWNER", "The new owner must be an active member of the agency.");
        }
        transfer = { agencyId: agency.agencyId, toUserId: input.newOwnerUserId };
      }

      await repository.anonymize({
        userId,
        adminUserId: actor.id,
        reason: input.reason ?? null,
        emailDomain: target.email.split("@")[1]?.trim().toLowerCase() ?? "",
        now: now(),
        transfer
      });
    }
  };
}
