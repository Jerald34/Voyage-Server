import type { Request } from "express";
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import {
  manualDayRenameSchema,
  manualStopCreateSchema,
  manualStopMoveSchema,
  manualStopPatchSchema,
  replaceItinerarySchema
} from "./itinerarySchemas";
import { createPlaceSession, getPlaceRefreshScheduler } from "../../services/places/placeServices";
import { itineraryService } from "./itineraryService";
import { itineraryWeatherService } from "../weather/weatherService";

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

export const itineraryRoutes = Router({ mergeParams: true });
const agencyIdParamsSchema = idParamsSchema("agencyId");
const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
const itineraryDayParamsSchema = idParamsSchema("agencyId", "itineraryId", "dayId");
const itineraryItemParamsSchema = idParamsSchema("agencyId", "itineraryId", "itemId");
const tripIdParamsSchema = idParamsSchema("agencyId", "tripId");

/**
 * Changing, approving or reopening an itinerary acts on one trip. Owners and admins
 * may do it for any trip in the agency; staff only for trips assigned to them
 * (anything else is a 404, so trips can't be probed).
 */
async function requireItineraryTripAccess(request: Request, agencyId: string, itineraryId: string) {
  const tripId = await itineraryService.getItineraryTripId(agencyId, itineraryId);
  await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
}

/**
 * The authorized single-itinerary read: a request-scoped session puts this agency's
 * place warnings on the response and starts a bounded refresh. Hand edits answer
 * with the same read, so the page can replace its copy with the response.
 */
async function readItinerary(agencyId: string, itineraryId: string) {
  return itineraryService.getItinerary(agencyId, itineraryId, {
    session: await createPlaceSession(agencyId),
    scheduler: getPlaceRefreshScheduler()
  });
}

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
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/itineraries/:itineraryId/weather — per-day forecast or
// typical weather. Same membership rule as the itinerary read above.
itineraryRoutes.get("/:itineraryId/weather", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const weather = await itineraryWeatherService.forAgencyItinerary(agencyId, itineraryId);
    response.json({ weather });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const input = replaceItinerarySchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
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

// ── Hand edits from the Itineraries page ─────────────────────────────────────
// Allowed while the itinerary is a draft or in review; an approved one answers
// 409 ITINERARY_LOCKED until the trip is reopened. None of these take a place
// session: the schemas refuse place fields, so there is no place to check.

itineraryRoutes.patch("/:itineraryId/days/:dayId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, dayId } = itineraryDayParamsSchema.parse(request.params);
    const { title } = manualDayRenameSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.updateDay(agencyId, { itineraryId, dayId, title });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/:itineraryId/days/:dayId/items", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, dayId } = itineraryDayParamsSchema.parse(request.params);
    const item = manualStopCreateSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.addItem(agencyId, { itineraryId, dayId, item });
    response.status(201).json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId/items/:itemId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    const item = manualStopPatchSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.updateItem(agencyId, { itineraryId, itemId, item });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.delete("/:itineraryId/items/:itemId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.removeItem(agencyId, { itineraryId, itemId });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/:itineraryId/items/:itemId/move", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    const target = manualStopMoveSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.moveItem(agencyId, { itineraryId, itemId, ...target });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
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
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.approveTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// Undo an approval so the trip can be changed again: it goes back to review and
// needs approving again. A trip that isn't approved comes back unchanged.
itineraryRoutes.post("/trips/:tripId/reopen", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.reopenTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
