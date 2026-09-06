import { z } from "zod";
import type { MapsProvider } from "../../../services/maps";
import type { PlaceSelectionSession } from "../../../services/places/placeTypes";
import { structuredItineraryItemSchema } from "../../itineraries/itinerarySchemas";
import type { ItineraryAgentService } from "../agentTools";
import { isRecordLike } from "./toolUtils";

function toFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getItemSnapshotPoint(item: Record<string, unknown> | null | undefined) {
  const snapshot = isRecordLike(item?.placeSnapshot) ? item.placeSnapshot : null;
  const latitude = toFiniteNumber(snapshot?.latitude);
  const longitude = toFiniteNumber(snapshot?.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function getItineraryDayItems(itinerary: unknown, dayId: string): Array<Record<string, unknown>> {
  if (!isRecordLike(itinerary) || !Array.isArray(itinerary.days)) {
    return [];
  }

  const day = itinerary.days.find((candidate) => isRecordLike(candidate) && candidate.id === dayId);
  if (!isRecordLike(day) || !Array.isArray(day.items)) {
    return [];
  }

  return day.items.filter(isRecordLike).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
}

function findPreviousMappedItem(items: Array<Record<string, unknown>>, currentItemId: string) {
  const currentIndex = items.findIndex((item) => item.id === currentItemId);
  if (currentIndex <= 0) {
    return null;
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (getItemSnapshotPoint(item)) {
      return item;
    }
  }

  return null;
}

/**
 * Routing pass over days whose places the itinerary service has ALREADY prepared.
 *
 * Resolution and eligibility no longer live here: the guarded service owns which
 * items are new selections and which are preserved, so a tool can never pre-check
 * (or bypass) an exemption. This function only draws routes, using the trusted
 * coordinates the service supplies.
 */
export async function addRoutesToPreparedDays(options: {
  days: Array<Record<string, unknown>>;
  points: Map<string, { latitude: number; longitude: number }>;
  maps: MapsProvider;
}): Promise<Array<Record<string, unknown>>> {
  const { days, points, maps } = options;

  function pointFor(item: Record<string, unknown>) {
    const id = typeof item.placeSnapshotId === "string" ? item.placeSnapshotId : null;
    return id ? points.get(id) ?? null : null;
  }

  const routed: Array<Record<string, unknown>> = [];

  for (const day of days) {
    const items = Array.isArray(day.items) ? (day.items as Array<Record<string, unknown>>) : [];
    const routedItems: Array<Record<string, unknown>> = [];
    let previous: { item: Record<string, unknown>; point: { latitude: number; longitude: number } } | null =
      null;

    for (const current of items) {
      let item = current;
      const point = pointFor(current);

      if (previous && point && item.routeFromPrevious === undefined) {
        try {
          const route = await maps.estimateRoute({
            origin: previous.point,
            destination: point,
            travelMode: "DRIVE"
          });
          item = {
            ...item,
            routeFromPrevious: {
              originPlaceSnapshotId: previous.item.placeSnapshotId ?? null,
              destinationPlaceSnapshotId: item.placeSnapshotId ?? null,
              travelMode: "DRIVE",
              distanceMeters: route.distanceMeters ?? null,
              durationSeconds: route.durationSeconds ?? null,
              staticDurationSeconds: route.staticDurationSeconds ?? null,
              polyline: route.polyline ?? null
            }
          };
        } catch (error) {
          console.error("[Maps] Failed to estimate route for created itinerary item", error);
        }
      }

      routedItems.push(item);
      if (point) previous = { item, point };
    }

    routed.push({ ...day, items: routedItems });
  }

  return routed;
}

/**
 * Resolve one item's place through the run's selection session, so the cached and
 * supplied-ID early returns are checked as well as freshly resolved names. A
 * PLACE_BLOCKED or PLACE_SNAPSHOT_NOT_FOUND error propagates: it is a decision,
 * not a maps outage, and the registry turns it into recoverable tool output.
 */
export async function resolveSingleItemPlace(options: {
  item: z.infer<typeof structuredItineraryItemSchema>;
  cityContextFallback?: string;
  session: PlaceSelectionSession;
}): Promise<{
  item: z.infer<typeof structuredItineraryItemSchema>;
  point: { latitude: number; longitude: number } | null;
}> {
  const { item } = options;
  if (!item.placeSnapshotId && !item.placeName) {
    return { item, point: null };
  }

  const prepared = await options.session.prepare(
    {
      placeSnapshotId: item.placeSnapshotId,
      placeName: item.placeName,
      cityContext: item.cityContext
    },
    options.cityContextFallback
  );

  return {
    item: prepared.placeSnapshotId ? { ...item, placeSnapshotId: prepared.placeSnapshotId } : item,
    point: prepared.point
  };
}

export async function attachRouteFromPrevious(options: {
  maps: MapsProvider;
  itineraryService: Pick<ItineraryAgentService, "updateItem">;
  agencyId: string | null;
  itineraryId: string;
  dayId: string;
  result: {
    itinerary: unknown;
    item: Record<string, unknown>;
  };
}) {
  const currentItemId = typeof options.result.item.id === "string" ? options.result.item.id : "";
  if (!currentItemId || options.result.item.routeFromPrevious !== undefined) {
    return options.result;
  }

  const dayItems = getItineraryDayItems(options.result.itinerary, options.dayId);
  const currentItem = dayItems.find((item) => item.id === currentItemId) ?? options.result.item;
  const previousItem = findPreviousMappedItem(dayItems, currentItemId);
  const origin = getItemSnapshotPoint(previousItem);
  const destination = getItemSnapshotPoint(currentItem);

  if (!previousItem || !origin || !destination || typeof previousItem.id !== "string") {
    return options.result;
  }

  try {
    const route = await options.maps.estimateRoute({
      origin,
      destination,
      travelMode: "DRIVE"
    });
    const routeFromPrevious = {
      originItemId: previousItem.id,
      destinationItemId: currentItemId,
      travelMode: "DRIVE",
      distanceMeters: route.distanceMeters ?? null,
      durationSeconds: route.durationSeconds ?? null,
      staticDurationSeconds: route.staticDurationSeconds ?? null,
      polyline: route.polyline ?? null
    };
    const updated = await options.itineraryService.updateItem(options.agencyId, {
      itineraryId: options.itineraryId,
      itemId: currentItemId,
      item: { routeFromPrevious }
    });

    if (isRecordLike(updated) && isRecordLike(updated.item)) {
      return {
        ...options.result,
        ...updated,
        item: updated.item
      };
    }
  } catch (error) {
    console.error("[Maps] Failed to estimate route for itinerary item", error);
  }

  return options.result;
}
