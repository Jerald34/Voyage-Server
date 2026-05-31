import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { dashboardQuerySchema } from "./dashboardSchemas";
import { dashboardService } from "./dashboardService";

/**
 * Mounted at `/agencies/:agencyId/dashboard`.
 *
 * GET / — returns the role-branched dashboard payload.
 *   Query: view=owner|staff (optional), period=7d|30d|90d (optional, default 30d).
 *   Role enforcement: STAFF cannot request view=owner.
 */
export const dashboardRoutes: Router = Router({ mergeParams: true });

dashboardRoutes.get("/", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }
    const role = access.membership.role;

    const parsed = dashboardQuerySchema.parse(request.query);

    const payload = await dashboardService.getDashboard({
      agencyId: access.agency.id,
      userId: request.authUser!.id,
      role,
      view: parsed.view,
      period: parsed.period
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});
