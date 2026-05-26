import { ApiError } from "../../http/errors";
import type { TeamRepository, TeamMembershipRecord } from "./teamRepository";

export function createTeamService(options: { repository: TeamRepository }) {
  return {
    async listMembers(agencyId: string): Promise<TeamMembershipRecord[]> {
      return options.repository.listMembers(agencyId);
    },

    async addExistingUserToAgency(input: { agencyId: string; userId: string; role: "ADMIN" | "STAFF" }) {
      if (input.role !== "ADMIN" && input.role !== "STAFF") {
        throw new ApiError(400, "INVALID_INVITE_ROLE", "Members can only be invited as ADMIN or STAFF.");
      }
      await options.repository.createMembership(input);
    },

    async removeMember(input: { agencyId: string; membershipId: string }) {
      const membership = await options.repository.findMembershipById(input.membershipId);
      if (!membership || membership.agencyId !== input.agencyId) {
        throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
      }
      if (membership.role === "OWNER") {
        throw new ApiError(403, "OWNER_PROTECTED", "The owner can only be changed via Transfer Ownership.");
      }
      await options.repository.deleteMembership(membership.id);
    },

    async changeMemberRole(input: { agencyId: string; membershipId: string; role: "ADMIN" | "STAFF" }) {
      if (input.role !== "ADMIN" && input.role !== "STAFF") {
        throw new ApiError(400, "INVALID_TARGET_ROLE", "Members can only be promoted to ADMIN or demoted to STAFF. Use Transfer Ownership to change the owner.");
      }
      const membership = await options.repository.findMembershipById(input.membershipId);
      if (!membership || membership.agencyId !== input.agencyId) {
        throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
      }
      if (membership.role === "OWNER") {
        throw new ApiError(403, "OWNER_PROTECTED", "The owner can only be changed via Transfer Ownership.");
      }
      return options.repository.updateMembershipRole(membership.id, input.role);
    },

    async transferOwnership(input: { agencyId: string; currentOwnerMembershipId: string; targetMembershipId: string }) {
      const current = await options.repository.findMembershipById(input.currentOwnerMembershipId);
      if (!current || current.agencyId !== input.agencyId || current.role !== "OWNER") {
        throw new ApiError(400, "NOT_CURRENT_OWNER", "Source membership is not the current owner.");
      }
      if (input.currentOwnerMembershipId === input.targetMembershipId) {
        throw new ApiError(400, "TRANSFER_SAME_USER", "The new owner must be a different member.");
      }
      const target = await options.repository.findMembershipById(input.targetMembershipId);
      if (!target || target.agencyId !== input.agencyId) {
        throw new ApiError(404, "MEMBER_NOT_FOUND", "Target member not found.");
      }
      await options.repository.transferOwnership({
        agencyId: input.agencyId,
        fromUserId: current.userId,
        toUserId: target.userId
      });
    }
  };
}
