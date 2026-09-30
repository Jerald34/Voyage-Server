import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { getBootstrap } from "./workspaceService";

const router = Router({ mergeParams: true });
const agencyIdParamsSchema = idParamsSchema("agencyId");

router.use(requireAuth);
router.use(async (request, _response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/bootstrap", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    const result = await getBootstrap(access.agency.id, {
      role: access.membership!.role,
      userId: request.authUser!.id
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as workspaceRoutes };
