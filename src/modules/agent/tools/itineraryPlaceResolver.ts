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

  const days = await Promise.all(
    options.input.days.map(async (day) => {
      const resolvedItems = await Promise.all(
        day.items.map(async (item): Promise<ResolvedItem> => {
          if (item.placeSnapshotId || !item.placeName) {
            return { item, point: null, placeSnapshotId: item.placeSnapshotId ?? null };
          }

          try {
            console.log(`[Maps] Resolving place: "${item.placeName}" in context: "${item.cityContext ?? options.input.title}"`);
            const resolved = await options.maps.resolvePlace({
              placeName: item.placeName,
              cityContext: item.cityContext ?? options.input.title
            });
            console.log(`[Maps] Successfully resolved "${item.placeName}" to ${resolved.location.latitude}, ${resolved.location.longitude}`);
            const enriched = await enrichResolvedPlaceForSnapshot(options.maps, resolved);
            const snapshot = await upsertPlaceSnapshot(options.client, enriched);
            return {
              item: {
                ...item,
                placeSnapshotId: snapshot.id
              },
              point: enriched.location,
              placeSnapshotId: snapshot.id
            };
          } catch (error) {
            console.error(`[Maps] Failed to resolve place: "${item.placeName}"`, error);
            return { item, point: null, placeSnapshotId: item.placeSnapshotId ?? null };
          }
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
}): Promise<{ item: z.infer<typeof structuredItineraryItemSchema>; resolved: ResolvedPlace | null }> {
  const { item } = options;
  if (item.placeSnapshotId || !item.placeName) {
    return { item, resolved: null };
  }

  try {
    const resolved = await options.maps.resolvePlace({
      placeName: item.placeName,
      cityContext: item.cityContext ?? options.cityContextFallback
    });
    const enriched = await enrichResolvedPlaceForSnapshot(options.maps, resolved);
    const snapshot = await upsertPlaceSnapshot(options.client, enriched);
    return {
      item: { ...item, placeSnapshotId: snapshot.id },
      resolved: enriched
    };
  } catch (error) {
    console.error(`[Maps] Failed to resolve item place: "${item.placeName}"`, error);
    return { item, resolved: null };
  }
}

export async function attachRouteFromPrevious(options: {
  maps: MapsProvider;
  itineraryService: Pick<ItineraryAgentService, "updateItem">;
  agencyId: string;
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
