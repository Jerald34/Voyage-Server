import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { MapsProvider, ResolvedPlace } from "../../../services/maps";
import { structuredItineraryItemSchema } from "../../itineraries/itinerarySchemas";
import type { StructuredItineraryInput } from "../../itineraries/itineraryService";
import type { ItineraryAgentService } from "../agentTools";
import { isRecordLike, upsertPlaceSnapshot } from "./toolUtils";
import { enrichResolvedPlaceForSnapshot } from "./placeSnapshotEnrichment";

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

export async function resolveItineraryItemPlaces<T extends StructuredItineraryInput["itinerary"]>(options: {
  input: T;
  maps: MapsProvider;
  client: PrismaClient;
}): Promise<T> {
  type StructuredItem = z.infer<typeof structuredItineraryItemSchema>;
  type ResolvedItem = {
    item: StructuredItem;
    point: { latitude: number; longitude: number } | null;
    placeSnapshotId: string | null;
  };

  async function addRoutesWithinDay(items: ResolvedItem[]) {
    const routedItems: StructuredItem[] = [];
    let previousMappedItem: ResolvedItem | null = null;

    for (const current of items) {
      let item = current.item;

      if (previousMappedItem?.point && current.point && item.routeFromPrevious === undefined) {
        try {
          const route = await options.maps.estimateRoute({
            origin: previousMappedItem.point,
            destination: current.point,
            travelMode: "DRIVE"
          });
          item = {
            ...item,
            routeFromPrevious: {
              originPlaceSnapshotId: previousMappedItem.placeSnapshotId,
              destinationPlaceSnapshotId: current.placeSnapshotId,
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

      if (current.point) {
        previousMappedItem = {
          ...current,
          item
        };
      }
    }

    return routedItems;
  }

  // In-run dedup: if the same place appears multiple times in one itinerary
  // (e.g., a hotel used on day 1 and day 3), resolve it once and reuse the snapshot.
  const resolveDedup = new Map<string, Promise<{ snapshot: { id: string }; enriched: ResolvedPlace } | null>>();

  const days = await Promise.all(
    options.input.days.map(async (day) => {
      const resolvedItems = await Promise.all(
        day.items.map(async (item): Promise<ResolvedItem> => {
          if (item.placeSnapshotId || !item.placeName) {
            return { item, point: null, placeSnapshotId: item.placeSnapshotId ?? null };
          }

          const cityContext = item.cityContext ?? options.input.title;

          // Pre-lookup: check if we already have a PlaceSnapshot for this name+city.
          try {
            const cached = await options.client.placeSnapshot.findFirst({
              where: {
                name: { equals: item.placeName, mode: "insensitive" },
                ...(cityContext ? { formattedAddress: { contains: cityContext, mode: "insensitive" } } : {})
              }
            });
            if (cached) {
              const point = (typeof cached.latitude === "number" && typeof cached.longitude === "number")
                ? { latitude: cached.latitude, longitude: cached.longitude }
                : null;
              return {
                item: { ...item, placeSnapshotId: cached.id },
                point,
                placeSnapshotId: cached.id
              };
            }
          } catch {
            // Pre-lookup is best-effort.
          }

          // In-run dedup: coalesce identical resolve calls within this itinerary build.
          const placeName = item.placeName;
          const dedupKey = `${placeName.toLowerCase()}|${cityContext.toLowerCase()}`;
          if (!resolveDedup.has(dedupKey)) {
            resolveDedup.set(dedupKey, (async () => {
              try {
                console.log(`[Maps] Resolving place: "${placeName}" in context: "${cityContext}"`);
                const resolved = await options.maps.resolvePlace({
                  placeName,
                  cityContext
                });
                console.log(`[Maps] Successfully resolved "${placeName}" to ${resolved.location.latitude}, ${resolved.location.longitude}`);
                const enriched = await enrichResolvedPlaceForSnapshot(options.maps, resolved);
                const snapshot = await upsertPlaceSnapshot(options.client, enriched);
                return { snapshot, enriched };
              } catch (error) {
                console.error(`[Maps] Failed to resolve place: "${placeName}"`, error);
                return null;
              }
            })());
          }

          const result = await resolveDedup.get(dedupKey)!;
          if (!result) {
            return { item, point: null, placeSnapshotId: item.placeSnapshotId ?? null };
          }

          return {
            item: { ...item, placeSnapshotId: result.snapshot.id },
            point: result.enriched.location,
            placeSnapshotId: result.snapshot.id
          };
        })
      );

      return {
        ...day,
        items: await addRoutesWithinDay(resolvedItems)
      };
    })
  );

  return {
    ...options.input,
    days
  } as T;
}

export async function resolveSingleItemPlace(options: {
  item: z.infer<typeof structuredItineraryItemSchema>;
  cityContextFallback?: string;
  maps: MapsProvider;
  client: PrismaClient;
  /** Skip enrichment (getPlaceDetails) to reduce latency during streaming.
   *  The post-run backfill job will enrich unenriched snapshots afterwards. */
  skipEnrichment?: boolean;
}): Promise<{ item: z.infer<typeof structuredItineraryItemSchema>; resolved: ResolvedPlace | null }> {
  const { item } = options;
  if (item.placeSnapshotId || !item.placeName) {
    return { item, resolved: null };
  }

  // Pre-lookup: check if we already have a PlaceSnapshot for this name+city
  // before making any Google API calls. Saves ~$0.04 per cache hit.
  try {
    const cityContext = item.cityContext ?? options.cityContextFallback ?? "";
    const cached = await options.client.placeSnapshot.findFirst({
      where: {
        name: { equals: item.placeName, mode: "insensitive" },
        ...(cityContext ? { formattedAddress: { contains: cityContext, mode: "insensitive" } } : {})
      }
    });
    if (cached) {
      return {
        item: { ...item, placeSnapshotId: cached.id },
        resolved: null
      };
    }
  } catch {
    // Pre-lookup is best-effort; fall through to Google resolution.
  }

  try {
    const resolved = await options.maps.resolvePlace({
      placeName: item.placeName,
      cityContext: item.cityContext ?? options.cityContextFallback
    });
    // When skipEnrichment is true, persist the basic resolved data immediately
    // (coordinates are enough for map pins). Full enrichment (rating, photos,
    // etc.) runs in the post-run backfill job.
    const finalPlace = options.skipEnrichment
      ? resolved
      : await enrichResolvedPlaceForSnapshot(options.maps, resolved);
    const snapshot = await upsertPlaceSnapshot(options.client, finalPlace);
    return {
      item: { ...item, placeSnapshotId: snapshot.id },
      resolved: finalPlace
    };
  } catch (error) {
    console.error(`[Maps] Failed to resolve item place: "${item.placeName}"`, error);
    return { item, resolved: null };
  }
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
