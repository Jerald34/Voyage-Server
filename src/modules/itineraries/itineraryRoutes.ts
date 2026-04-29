import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { replaceItinerarySchema } from "./itinerarySchemas";
import { itineraryService } from "./itineraryService";

export const itineraryRoutes = Router({ mergeParams: true });

itineraryRoutes.use(requireAuth);
itineraryRoutes.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
    );
    next();
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/:itineraryId", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const itinerary = await itineraryService.getItinerary(
      String(params.agencyId),
      String(params.itineraryId)
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const input = replaceItinerarySchema.parse(request.body);
    const itinerary = await itineraryService.replaceDraft(
      String(params.agencyId),
      String(params.itineraryId),
      input
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});
