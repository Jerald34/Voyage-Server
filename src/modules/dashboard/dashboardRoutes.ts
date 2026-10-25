import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { calendarService } from "./calendarService";
import { calendarQuerySchema, dashboardQuerySchema, tripPreviewParamsSchema } from "./dashboardSchemas";
import { dashboardService } from "./dashboardService";
import { getPlanUsage } from "./planUsageService";
import { tripPreviewService } from "./tripPreviewService";

/**
 * Mounted at `/agencies/:agencyId/dashboard`.
 *
 * GET / — returns the role-branched dashboard payload.
 *   Query: view=owner|staff (optional), period=7d|30d|90d (optional, default 30d).
 *   Role enforcement: STAFF cannot request view=owner.
 *
 * GET /calendar — trips and client activity for the dashboard calendar.
 *   Query: from, to (YYYY-MM-DD local dates, inclusive, at most 42 days).
 *   STAFF get only the trips they created or organize.
 *
 * GET /trips/:tripId — the dashboard trip panel: the trip, its share link and
 *   every client comment, with stop names. Any verified member of the agency.
 *   Another agency's trip is a 404.
 *
 * GET /plan-usage — this month's usage for the owner's "Plan and usage" card in Settings.
 *   Owners only. Display only: no plan is stored or enforced.
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

dashboardRoutes.get("/calendar", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }

    const { from, to } = calendarQuerySchema.parse(request.query);

    const payload = await calendarService.getCalendar({
      agencyId: access.agency.id,
      userId: request.authUser!.id,
      role: access.membership.role,
      from,
      to
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

dashboardRoutes.get("/trips/:tripId", requireAuth, async (request, response, next) => {
  try {
    const { agencyId, tripId } = tripPreviewParamsSchema.parse(request.params);

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }

    response.json(await tripPreviewService.getTripPreview(access.agency.id, tripId));
  } catch (error) {
    next(error);
  }
});

dashboardRoutes.get("/plan-usage", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireAgencyOwner(request.authUser!, agencyId);
    response.json({ usage: await getPlanUsage(access.agency.id) });
  } catch (error) {
    next(error);
  }
});
