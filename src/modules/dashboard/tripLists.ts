import type { RawDashboardData } from "./dashboardRepository";
import type { FunnelStageKey, TripListRow } from "./dashboardTypes";

/** Most trips any one dashboard list sends; the count beside it stays exact. */
export const TRIP_LIST_LIMIT = 50;

type Trip = RawDashboardData["trips"][number];

/** Trips as list rows, newest first by creation or by last update. */
export function toTripListRows(trips: Trip[], order: "created" | "updated"): TripListRow[] {
  const time = (trip: Trip) => (order === "created" ? trip.createdAt : trip.updatedAt).getTime();
  return [...trips]
    .sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, TRIP_LIST_LIMIT)
    .map((trip) => ({ tripId: trip.id, tripTitle: trip.title, clientName: trip.clientName, status: trip.status }));
}

/**
 * Trip progress as a cohort: the trips created in the window (both ends
 * included, like the rest of the period code), and which of them reached each
 * stage (has an itinerary, was ever shared, was ever viewed, is approved).
 * Revoked links still count as shared. Each of drafted, sent and viewed is
 * taken from the stage before it, so created ≥ drafted ≥ sent ≥ viewed always
 * holds. Approval is a trip status that needs no link, so it is taken from
 * the whole cohort and can exceed viewed.
 */
export function selectFunnelCohort(
  raw: Pick<RawDashboardData, "trips" | "itineraries" | "shares">,
  window: { start: Date; end: Date }
): Record<FunnelStageKey, Trip[]> {
  const created = raw.trips.filter((t) => t.createdAt >= window.start && t.createdAt <= window.end);
  const shared = new Set(raw.shares.flatMap((s) => (s.tripId ? [s.tripId] : [])));
  const everViewed = new Set(raw.shares.flatMap((s) => (s.tripId && s.viewCount > 0 ? [s.tripId] : [])));
  // A link always points at an itinerary, even when that itinerary's own
  // tripId is empty, so a shared trip was drafted.
  const hasItinerary = new Set([...raw.itineraries.flatMap((i) => (i.tripId ? [i.tripId] : [])), ...shared]);

  const drafted = created.filter((t) => hasItinerary.has(t.id));
  const sent = drafted.filter((t) => shared.has(t.id));
  const viewed = sent.filter((t) => everViewed.has(t.id));
  return {
    created,
    drafted,
    sent,
    viewed,
    approved: created.filter((t) => t.status === "APPROVED_INTERNAL")
  };
}
