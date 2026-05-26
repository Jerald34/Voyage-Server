import { ApiError } from "../../http/errors";
import { env } from "../../config/env";
import { createRandomToken, hashToken } from "../../services/tokens";
import { sendAgencyInvitationEmail } from "../../services/email";
import type { InvitationRecord, InvitationRepository } from "./invitationRepository";
import type { TeamRepository } from "./teamRepository";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export type InvitationServiceOptions = {
  invitationRepository: InvitationRepository;
  teamRepository: TeamRepository;
  findUserByEmail(emailNormalized: string): Promise<{ id: string; emailNormalized: string } | null>;
  addExistingUserToAgency(input: { agencyId: string; userId: string; role: "ADMIN" | "STAFF" }): Promise<void>;
  promoteUserToAgencyAccount(userId: string): Promise<void>;
  emailSender?: { sendAgencyInvitationEmail: typeof sendAgencyInvitationEmail };
  now?: () => Date;
  appOrigin?: string;
};

export type AcceptInvitationUser = {
  id: string;
  emailNormalized: string;
  accountType: "PENDING" | "PERSONAL" | "AGENCY_USER";
};

export function createInvitationService(options: InvitationServiceOptions) {
  const now = options.now ?? (() => new Date());
  const appOrigin = options.appOrigin ?? env.APP_ORIGIN;
  const emailSender = options.emailSender ?? { sendAgencyInvitationEmail };

  return {
    async invite(input: {
      agencyId: string;
      agencyName: string;
      inviter: { id: string; displayName: string };
      email: string;
      role: "ADMIN" | "STAFF";
    }) {
      if (input.role !== "ADMIN" && input.role !== "STAFF") {
        throw new ApiError(400, "INVALID_INVITE_ROLE", "Members can only be invited as ADMIN or STAFF.");
      }

      const emailNormalized = normalizeEmail(input.email);
      if (!emailNormalized) {
        throw new ApiError(400, "EMAIL_REQUIRED", "Email is required.");
      }

      const issuedAt = now();

      const existingUser = await options.findUserByEmail(emailNormalized);
      if (existingUser) {
        const members = await options.teamRepository.listMembers(input.agencyId);
        if (members.some((m) => m.userId === existingUser.id)) {
          throw new ApiError(409, "ALREADY_A_MEMBER", "That user is already a member of this agency.");
        }
      }

      const existingInvite = await options.invitationRepository.findActiveByAgencyAndEmail(
        input.agencyId,
        emailNormalized,
        issuedAt
      );
      if (existingInvite) {
        throw new ApiError(
          409,
          "INVITATION_ALREADY_PENDING",
          "An outstanding invitation already exists for this email. Revoke it before sending a new one."
        );
      }

      const rawToken = createRandomToken();
      const invitation = await options.invitationRepository.create({
        agencyId: input.agencyId,
        email: input.email.trim(),
        emailNormalized,
        role: input.role,
        invitedByUserId: input.inviter.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(issuedAt.getTime() + INVITATION_TTL_MS)
      });

      const acceptUrl = new URL("/accept-invite", appOrigin);
      acceptUrl.searchParams.set("token", rawToken);

      await emailSender.sendAgencyInvitationEmail({
        to: input.email,
        inviterName: input.inviter.displayName,
        agencyName: input.agencyName,
        role: input.role,
        acceptUrl: acceptUrl.toString()
      });

      return invitation;
    },

    async lookup(rawToken: string) {
      const invitation = await options.invitationRepository.findByTokenHash(hashToken(rawToken));
      if (!invitation) {
        throw new ApiError(404, "INVITATION_NOT_FOUND", "This invitation link is invalid.");
      }
      const issuedAt = now();
      if (invitation.acceptedAt) {
        throw new ApiError(409, "INVITATION_ALREADY_ACCEPTED", "This invitation has already been accepted.");
      }
      if (invitation.revokedAt) {
        throw new ApiError(410, "INVITATION_REVOKED", "This invitation has been revoked.");
      }
      if (invitation.expiresAt <= issuedAt) {
        throw new ApiError(410, "INVITATION_EXPIRED", "This invitation link has expired.");
      }

      const existingUser = await options.findUserByEmail(invitation.emailNormalized);
      return {
        email: invitation.email,
        emailNormalized: invitation.emailNormalized,
        role: invitation.role,
        agencyName: invitation.agency.name,
        agencyId: invitation.agencyId,
        agencyStatus: invitation.agency.status,
        inviterName: invitation.invitedByUser.displayName,
        accountExists: existingUser != null,
        expiresAt: invitation.expiresAt
      };
    },

    async accept(input: { rawToken: string; user: AcceptInvitationUser }) {
      const invitation = await options.invitationRepository.findByTokenHash(hashToken(input.rawToken));
      if (!invitation) {
        throw new ApiError(404, "INVITATION_NOT_FOUND", "This invitation link is invalid.");
      }
      const issuedAt = now();
      if (invitation.acceptedAt) {
        throw new ApiError(409, "INVITATION_ALREADY_ACCEPTED", "This invitation has already been accepted.");
      }
      if (invitation.revokedAt) {
        throw new ApiError(410, "INVITATION_REVOKED", "This invitation has been revoked.");
      }
      if (invitation.expiresAt <= issuedAt) {
        throw new ApiError(410, "INVITATION_EXPIRED", "This invitation link has expired.");
      }
      if (invitation.emailNormalized !== input.user.emailNormalized) {
        throw new ApiError(
          403,
          "INVITATION_EMAIL_MISMATCH",
          `This invitation is for ${invitation.email}. Sign in with that email to accept it.`
        );
      }
      const members = await options.teamRepository.listMembers(invitation.agencyId);
      if (members.some((m) => m.userId === input.user.id)) {
        if (input.user.accountType !== "AGENCY_USER") {
          await options.promoteUserToAgencyAccount(input.user.id);
        }
        await options.invitationRepository.markAccepted(invitation.id, issuedAt, input.user.id);
        return { agencyId: invitation.agencyId, alreadyMember: true as const };
      }

      await options.addExistingUserToAgency({
        agencyId: invitation.agencyId,
        userId: input.user.id,
        role: invitation.role
      });

      // Accepting an invitation is itself an explicit opt-in to agency use,
      // so promote PENDING and PERSONAL accounts alike.
      if (input.user.accountType !== "AGENCY_USER") {
        await options.promoteUserToAgencyAccount(input.user.id);
      }

      await options.invitationRepository.markAccepted(invitation.id, issuedAt, input.user.id);

      return { agencyId: invitation.agencyId, alreadyMember: false as const };
    },

    async listOutstanding(agencyId: string): Promise<InvitationRecord[]> {
      return options.invitationRepository.listOutstanding(agencyId, now());
    },

    async revoke(input: { agencyId: string; invitationId: string; revokerUserId: string }) {
      const invitation = await options.invitationRepository.findById(input.invitationId);
      if (!invitation || invitation.agencyId !== input.agencyId) {
        throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
      }
      if (invitation.acceptedAt) {
        throw new ApiError(409, "INVITATION_ALREADY_ACCEPTED", "Cannot revoke an accepted invitation.");
      }
      if (invitation.revokedAt) {
        return invitation;
      }
      return options.invitationRepository.markRevoked(input.invitationId, now(), input.revokerUserId);
    }
  };
}
