import type { Request } from "express";
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { replaceItinerarySchema } from "./itinerarySchemas";
import { itineraryService } from "./itineraryService";

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

export const itineraryRoutes = Router({ mergeParams: true });
const agencyIdParamsSchema = idParamsSchema("agencyId");
const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
const tripIdParamsSchema = idParamsSchema("agencyId", "tripId");

itineraryRoutes.use(requireAuth);
itineraryRoutes.use(async (request, _response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    // Store resolved UUID on request so all downstream handlers use the real ID
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    const role = access.membership!.role;
    const trips = await itineraryService.listTripsForUser(access.agency.id, {
      role,
      userId: request.authUser!.id
    });
    response.json({ trips });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const itinerary = await itineraryService.getItinerary(
      agencyId,
      itineraryId
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const input = replaceItinerarySchema.parse(request.body);
    const itinerary = await itineraryService.replaceDraft(
      agencyId,
      itineraryId,
      input
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.delete("/trips/:tripId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.deleteTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/trips/:tripId/approve", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    const result = await itineraryService.approveTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
