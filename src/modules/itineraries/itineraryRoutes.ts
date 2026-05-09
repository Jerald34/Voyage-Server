import type { Request } from "express";
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { replaceItinerarySchema } from "./itinerarySchemas";
import { itineraryService } from "./itineraryService";

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

export const itineraryRoutes = Router({ mergeParams: true });

itineraryRoutes.use(requireAuth);
itineraryRoutes.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
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
    const agencyId = getAgencyId(request);
    const trips = await itineraryService.listTripsWithItineraries(agencyId);
    response.json({ trips });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const itinerary = await itineraryService.getItinerary(
      agencyId,
      String(request.params.itineraryId)
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const input = replaceItinerarySchema.parse(request.body);
    const itinerary = await itineraryService.replaceDraft(
      agencyId,
      String(request.params.itineraryId),
      input
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});
