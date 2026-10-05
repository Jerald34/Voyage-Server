import { ApiError } from "../../http/errors";

/**
 * An itinerary can be changed while it is a draft or in review. Approval locks it
 * until someone reopens the trip (POST /agencies/:agencyId/itineraries/trips/:tripId/reopen).
 * Every edit path uses this rule: the agent's tools, the full replace, hand edits
 * from the Itineraries page and Reuse.
 */
export const ITINERARY_LOCKED_CODE = "ITINERARY_LOCKED";
export const ITINERARY_LOCKED_MESSAGE = "This itinerary is approved. Reopen it to make changes.";

export function isItineraryEditable(status: string | null | undefined): boolean {
  return status === "DRAFT" || status === "NEEDS_REVIEW";
}

export function assertItineraryEditable(status: string | null | undefined): void {
  if (!isItineraryEditable(status)) {
    throw new ApiError(409, ITINERARY_LOCKED_CODE, ITINERARY_LOCKED_MESSAGE);
  }
}
