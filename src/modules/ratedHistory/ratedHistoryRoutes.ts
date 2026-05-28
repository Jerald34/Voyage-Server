import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../http/authMiddleware.js";
import { agencyAccessService } from "../agencyAccess/agencyAccessService.js";
import { listQuerySchema, detailParamsSchema, insertBodySchema } from "./ratedHistorySchemas.js";
import { ratedHistoryService } from "./ratedHistoryService.js";
import {
  MalformedSelectionError,
  SameAgencyViolationError,
  SourceNotFoundError,
  StaleVersionError
} from "./ratedHistoryErrors.js";

// ── Error-to-response helper ─────────────────────────────────────────────────

function handleServiceError(err: unknown, response: Response, next: (e: unknown) => void) {
  if (err instanceof MalformedSelectionError) {
    response.status(400).json({ error: "malformed_selection", detail: err.reason });
    return;
  }
  if (err instanceof SameAgencyViolationError) {
    response.status(403).json({ error: "forbidden" });
    return;
  }
  if (err instanceof SourceNotFoundError) {
    if (err.reason === "deleted") {
      response.status(410).json({ error: "source_deleted" });
    } else {
      response.status(404).json({ error: "not_found" });
    }
    return;
  }
  if (err instanceof StaleVersionError) {
    response.status(409).json({
      error: "stale_version",
      expected: err.expectedVersion,
      actual: err.actualVersion
    });
    return;
  }
  next(err);
}

// ── ratedHistoryListRoutes ────────────────────────────────────────────────────
//
// Mounted at: /agencies/:agencyId/rated-history
// Handles:
//   GET /                — list rated trips for an agency
//   GET /:tripId         — full itinerary detail for one rated trip

export const ratedHistoryListRoutes = Router({ mergeParams: true });

ratedHistoryListRoutes.use(requireAuth);
ratedHistoryListRoutes.use(async (request, _response, next) => {
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

// GET /agencies/:agencyId/rated-history
ratedHistoryListRoutes.get("/", async (request: Request, response: Response, next) => {
  try {
    const query = listQuerySchema.parse(request.query);
    const callerAgencyId = String(request.resolvedAgencyId);
    const result = await ratedHistoryService.listRatedHistory({
      callerAgencyId,
      filters: {
        destination: query.destination,
        durationDays: query.durationDays,
        season: query.season
      },
      page: query.page,
      pageSize: query.pageSize
    });
    response.status(200).json(result);
  } catch (error) {
    handleServiceError(error, response, next);
  }
});

// GET /agencies/:agencyId/rated-history/:tripId
ratedHistoryListRoutes.get("/:tripId", async (request: Request, response: Response, next) => {
  try {
    const { tripId } = detailParamsSchema.parse({ tripId: request.params.tripId });
    const callerAgencyId = String(request.resolvedAgencyId);
    const result = await ratedHistoryService.getRatedItinerary({
      callerAgencyId,
      tripId
    });
    response.status(200).json(result);
  } catch (error) {
    handleServiceError(error, response, next);
  }
});

// ── ratedHistoryInsertRoutes ──────────────────────────────────────────────────
//
// Mounted at: /trips/:tripId/itinerary
// Handles:
//   POST /:tripId/insert-from-rated — copy items from a rated trip into the target
//
// Agency membership is resolved inside the handler since the URL doesn't
// carry an agencyId. We look up the target trip first, derive its agencyId,
// then run requireVerifiedAgencyMember.

export const ratedHistoryInsertRoutes = Router({ mergeParams: true });

ratedHistoryInsertRoutes.use(requireAuth);

// POST /trips/:tripId/itinerary/insert-from-rated
ratedHistoryInsertRoutes.post(
  "/insert-from-rated",
  async (request: Request, response: Response, next) => {
    try {
      const body = insertBodySchema.parse(request.body);
      const tripId = String(request.params.tripId);
      const authUser = request.authUser!;

      // Look up the target trip to derive agencyId for the membership check.
      // We do this here (not in the service) so we can map "trip not found"
      // distinctly from "wrong agency" — the route's 403/404 mapping is
      // tighter than the service's SameAgencyViolationError.
      const { prisma } = await import("../../db/prisma.js");
      const trip = await prisma.clientTrip.findUnique({
        where: { id: tripId },
        select: { agencyId: true }
      });
      if (!trip) {
        response.status(404).json({ error: "not_found" });
        return;
      }

      const access = await agencyAccessService.requireVerifiedAgencyMember(
        authUser,
        trip.agencyId
      );

      const result = await ratedHistoryService.insertFromRated({
        callerAgencyId: access.agency.id,
        callerUserId: authUser.id,
        callerRole: access.membership!.role,
        targetTripId: tripId,
        sourceTripId: body.sourceTripId,
        selection: body.selection,
        target: body.target,
        ifMatchVersion: body.ifMatchVersion
      });

      response.status(200).json(result);
    } catch (error) {
      handleServiceError(error, response, next);
    }
  }
);
