import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { getBootstrap } from "./workspaceService";

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
    );
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/bootstrap", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
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
