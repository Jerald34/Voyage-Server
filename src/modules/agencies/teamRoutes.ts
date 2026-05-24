import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { inviteMemberSchema, changeRoleSchema } from "./teamSchemas";
import { createTeamService } from "./teamService";
import { createPrismaTeamRepository } from "./teamRepository";

const teamService = createTeamService({ repository: createPrismaTeamRepository() });

export const teamRoutes = Router({ mergeParams: true });

teamRoutes.use(requireAuth);

// List members — any active member (including STAFF) can read
teamRoutes.get("/", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, String(params.agencyId));
    const members = await teamService.listMembers(access.agency.id);
    response.json({ members, viewerRole: access.membership!.role });
  } catch (error) {
    next(error);
  }
});

// Invite — OWNER or ADMIN
teamRoutes.post("/", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    const input = inviteMemberSchema.parse(request.body);
    const member = await teamService.inviteMember({ agencyId: access.agency.id, ...input });
    response.status(201).json({ member });
  } catch (error) {
    next(error);
  }
});

// Change role — OWNER or ADMIN
teamRoutes.patch("/:membershipId/role", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    const input = changeRoleSchema.parse(request.body);
    const member = await teamService.changeMemberRole({
      agencyId: access.agency.id,
      membershipId: String(request.params.membershipId),
      role: input.role
    });
    response.json({ member });
  } catch (error) {
    next(error);
  }
});

// Remove — OWNER or ADMIN
teamRoutes.delete("/:membershipId", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    await teamService.removeMember({
      agencyId: access.agency.id,
      membershipId: String(request.params.membershipId)
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Transfer ownership — OWNER only
teamRoutes.post("/transfer-ownership", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyOwner(request.authUser!, String(params.agencyId));
    const { targetMembershipId } = request.body as { targetMembershipId: string };
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
