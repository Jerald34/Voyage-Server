import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { prisma } from "../../db/prisma";
import { idParamsSchema } from "../../http/requestSchemas";
import {
  inviteMemberSchema,
  changeRoleSchema,
  transferOwnershipSchema
} from "./teamSchemas";
import { createTeamService } from "./teamService";
import { createPrismaTeamRepository } from "./teamRepository";
import { createInvitationService } from "./invitationService";
import { createPrismaInvitationRepository } from "./invitationRepository";

const teamRepository = createPrismaTeamRepository();
const teamService = createTeamService({ repository: teamRepository });
const invitationRepository = createPrismaInvitationRepository();
const invitationService = createInvitationService({
  invitationRepository,
  teamRepository,
  findUserByEmail: async (emailNormalized) => {
    const user = await prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true, emailNormalized: true }
    });
    return user;
  },
  addExistingUserToAgency: (input) => teamService.addExistingUserToAgency(input),
  promoteUserToAgencyAccount: async (userId) => {
    await prisma.user.update({
      where: { id: userId },
      data: { accountType: "AGENCY_USER" }
    });
  }
});

export { invitationService };

export const teamRoutes = Router({ mergeParams: true });
const agencyIdParamsSchema = idParamsSchema("agencyId");
const invitationParamsSchema = idParamsSchema("agencyId", "invitationId");
const membershipParamsSchema = idParamsSchema("agencyId", "membershipId");

teamRoutes.use(requireAuth);

teamRoutes.get("/", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    const members = await teamService.listMembers(access.agency.id);
    response.json({ members, viewerRole: access.membership!.role });
  } catch (error) {
    next(error);
  }
});

teamRoutes.post("/", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    const input = inviteMemberSchema.parse(request.body);
    const agency = await prisma.agency.findUnique({
      where: { id: access.agency.id },
      select: { name: true }
    });
    const invitation = await invitationService.invite({
      agencyId: access.agency.id,
      agencyName: agency?.name ?? "Voyage",
      inviter: { id: request.authUser!.id, displayName: request.authUser!.displayName },
      email: input.email,
      role: input.role
    });
    response.status(201).json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

teamRoutes.get("/invitations", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    const invitations = await invitationService.listOutstanding(access.agency.id);
    response.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

teamRoutes.delete("/invitations/:invitationId", async (request, response, next) => {
  try {
    const { agencyId, invitationId } = invitationParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    await invitationService.revoke({
      agencyId: access.agency.id,
      invitationId,
      revokerUserId: request.authUser!.id
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

teamRoutes.patch("/:membershipId/role", async (request, response, next) => {
  try {
    const { agencyId, membershipId } = membershipParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    const input = changeRoleSchema.parse(request.body);
    const member = await teamService.changeMemberRole({
      agencyId: access.agency.id,
      membershipId,
      role: input.role
    });
    response.json({ member });
  } catch (error) {
    next(error);
  }
});

teamRoutes.delete("/:membershipId", async (request, response, next) => {
  try {
    const { agencyId, membershipId } = membershipParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    await teamService.removeMember({
      agencyId: access.agency.id,
      membershipId
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

teamRoutes.post("/transfer-ownership", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireAgencyOwner(request.authUser!, agencyId);
    const { targetMembershipId } = transferOwnershipSchema.parse(request.body);
    const currentOwnerMembership = access.membership!;
    await teamService.transferOwnership({
      agencyId: access.agency.id,
      currentOwnerMembershipId: currentOwnerMembership.id,
      targetMembershipId
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});
