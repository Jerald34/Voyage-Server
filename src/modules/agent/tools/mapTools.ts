import { z } from "zod";
import { prisma } from "../../../db/prisma";
import type { PrismaClient } from "@prisma/client";
import type { MapsProvider } from "../../../services/maps";
import type { AgentTool, AgentToolService } from "../agentTools";
import { 
  createRunRecord, 
  upsertPlaceSnapshot, 
  mapPinpointPayload, 
  toProviderName, 
  toCompactMetadata 
} from "./toolUtils";
import { ApiError } from "../../../http/errors";
import type { PlaceSearchResult, ResolvedPlace } from "../../../services/maps";
import type { AgentToolContext } from "../agentTools";
import type { PlaceSelectionSession, PlaceVerdict } from "../../../services/places/placeTypes";

/**
 * Eligibility helpers shared by every place-producing map tool.
 *
 * `context.places` is the per-run selection session. It is optional only so an
 * isolated unit test can construct a bare tool; production always supplies it,
 * and without it these helpers fall back to today's ungated behavior.
 */

function blocked(name: string, verdict: Extract<PlaceVerdict, { allowed: false }>) {
  return new ApiError(409, "PLACE_BLOCKED", `${name} cannot be used: ${verdict.detail}`);
}

/** Normalize a raw search/details result into the gate's candidate shape. */
function toCandidate<T extends { id?: string; name?: string }>(result: T) {
  return {
    ...result,
    provider: "GOOGLE_MAPS" as const,
    providerPlaceId: result.id ?? "",
    name: result.name ?? ""
  };
}

/**
 * Persist observations for a batch of raw provider results, then split them into
 * usable results and minimal explanations. Blocked entries expose only a name,
 * reason and detail — never coordinates, IDs or URLs that could be reused.
 */
async function partitionResults<T extends PlaceSearchResult>(
  session: PlaceSelectionSession | undefined,
  results: T[]
): Promise<{ results: T[]; blocked: Array<{ name: string; reason: string; detail: string }> }> {
  if (!session) return { results, blocked: [] };

  const allowed: T[] = [];
  const rejected: Array<{ name: string; reason: string; detail: string }> = [];

  // Sequential so input order is preserved in both output lists.
  for (const result of results) {
    const { candidate, verdict } = await session.consider(toCandidate(result) as never);
    if (verdict.allowed) {
      // Keep every field the provider returned, including a temporary-closure
      // advisory, minus the normalization fields the gate added.
      const { provider: _p, providerPlaceId: _i, ...rest } = candidate as Record<string, unknown>;
      allowed.push(rest as T);
    } else {
      rejected.push({ name: result.name ?? "", reason: verdict.reason, detail: verdict.detail });
    }
  }

  return { results: allowed, blocked: rejected };
}

/**
 * Check one already-resolved place. The snapshot has already been written, so
 * `consider` records the observation and merges any newer stored closure before
 * the verdict. Throws PLACE_BLOCKED, which the registry turns into recoverable
 * tool output.
 */
async function assertPlaceAllowed(
  session: PlaceSelectionSession | undefined,
  place: ResolvedPlace
): Promise<void> {
  if (!session) return;
  const { verdict } = await session.consider({
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    name: place.name,
    businessStatus: place.businessStatus ?? null,
    businessStatusCheckedAt: place.businessStatusCheckedAt
  } as never);
  if (!verdict.allowed) throw blocked(place.name, verdict);
}

function sessionOf(context: AgentToolContext) {
  return context.places;
}

const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const searchPlacesInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(20).default(5),
  locationBias: z.unknown().optional(),
  languageCode: z.string().min(2).max(20).optional()
});

const placeDetailsInputSchema = z.object({
  placeId: z.string().min(1).max(500)
});

const routeInputSchema = z.union([
  z.object({
    origin: geoPointSchema,
    destination: geoPointSchema,
    travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]).default("DRIVE")
  }),
  z.object({
    originPlaceName: z.string().min(1).max(500),
    destinationPlaceName: z.string().min(1).max(500),
    cityContext: z.string().min(1).max(200).optional(),
    travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]).default("DRIVE")
  })
]);


const searchNearbyInputSchema = z.object({
  location: geoPointSchema,
  radius: z.number().int().positive().max(50000).default(1000),
  includedTypes: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().max(20).default(5),
  languageCode: z.string().min(2).max(20).optional()
});

const placePhotosInputSchema = z.object({
  placeId: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(10).default(5)
});

const placeReferenceInputSchema = z.object({
  placeName: z.string().min(1).max(500),
  cityContext: z.string().min(1).max(200).optional(),
  countryCode: z.string().min(2).max(10).optional()
}).strict();

const routeLogisticsInputSchema = z.object({
  originPlaceName: z.string().min(1).max(500),
  destinationPlaceName: z.string().min(1).max(500),
  cityContext: z.string().min(1).max(200).optional(),
  travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]).default("DRIVE")
}).strict();

export function createMapPinpointTool(options: {
  maps: MapsProvider;
  agentService: AgentToolService;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "map_pinpoint",
    async execute(context, input) {
      const parsed = placeReferenceInputSchema.parse(input);
      console.log(`[Maps] map_pinpoint resolving place: "${parsed.placeName}" in context: "${parsed.cityContext}"`);
      const resolved = await options.maps.resolvePlace(parsed);
      const snapshot = await upsertPlaceSnapshot(options.placeSnapshotClient ?? prisma, resolved);
      // Eligibility is decided after the snapshot exists, so a closure observation
      // is never lost, but before any map event or source is recorded.
      await assertPlaceAllowed(sessionOf(context), resolved);
      const run = createRunRecord(context);
      const payload = mapPinpointPayload(snapshot.id, resolved);

      await options.agentService.recordSources(run, [
        {
          sourceType: "MAP_PLACE",
          title: resolved.name,
          url: resolved.websiteUrl ?? null,
          snippet: resolved.formattedAddress ?? null,
          provider: toProviderName(resolved.provider),
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            placeSnapshotId: snapshot.id,
            providerPlaceId: resolved.providerPlaceId,
            input: parsed,
            rating: resolved.rating ?? null
          })
        }
      ]);
      await options.agentService.recordRunEvent(run, {
        type: "map.pinpointed",
        payload
      });

      return payload;
    }
  };
}

export function createRouteLogisticsTool(options: {
  maps: MapsProvider;
  agentService: AgentToolService;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "route_logistics",
    async execute(context, input) {
      const parsed = routeLogisticsInputSchema.parse(input);
      console.log(`[Maps] route_logistics resolving origin: "${parsed.originPlaceName}" and destination: "${parsed.destinationPlaceName}"`);
      const [originPlace, destinationPlace] = await Promise.all([
        options.maps.resolvePlace({
          placeName: parsed.originPlaceName,
          cityContext: parsed.cityContext
        }),
        options.maps.resolvePlace({
          placeName: parsed.destinationPlaceName,
          cityContext: parsed.cityContext
        })
      ]);
      const client = options.placeSnapshotClient ?? prisma;
      const [originSnapshot, destinationSnapshot] = await Promise.all([
        upsertPlaceSnapshot(client, originPlace),
        upsertPlaceSnapshot(client, destinationPlace)
      ]);
      // Both endpoints must be eligible before we pay for a route or emit one.
      await assertPlaceAllowed(sessionOf(context), originPlace);
      await assertPlaceAllowed(sessionOf(context), destinationPlace);
      const route = await options.maps.estimateRoute({
        origin: originPlace.location,
        destination: destinationPlace.location,
        travelMode: parsed.travelMode
      });
      const run = createRunRecord(context);
      const payload = {
        origin: mapPinpointPayload(originSnapshot.id, originPlace),
        destination: mapPinpointPayload(destinationSnapshot.id, destinationPlace),
        travelMode: parsed.travelMode,
        distanceMeters: route.distanceMeters ?? null,
        durationSeconds: route.durationSeconds ?? null,
        staticDurationSeconds: route.staticDurationSeconds ?? null,
        polyline: route.polyline ?? null
      };

      await options.agentService.recordSources(run, [
        {
          sourceType: "MAP_ROUTE",
          title: `${originPlace.name} to ${destinationPlace.name}`,
          url: null,
          snippet:
            route.distanceMeters !== undefined || route.durationSeconds !== undefined
              ? `distance=${route.distanceMeters ?? "unknown"} duration=${route.durationSeconds ?? "unknown"}`
              : null,
          provider: toProviderName(originPlace.provider),
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            input: parsed,
            originPlaceSnapshotId: originSnapshot.id,
            destinationPlaceSnapshotId: destinationSnapshot.id,
            distanceMeters: route.distanceMeters ?? null,
            durationSeconds: route.durationSeconds ?? null
          })
        }
      ]);
      await options.agentService.recordRunEvent(run, {
        type: "route.estimated",
        payload
      });

      return payload;
    }
  };
}

export function createPlaceInsightsTool(options: {
  maps: MapsProvider;
  agentService: AgentToolService;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "place_insights",
    async execute(context, input) {
      const parsed = placeReferenceInputSchema.parse(input);
      console.log(`[Maps] place_insights resolving place: "${parsed.placeName}" in context: "${parsed.cityContext}"`);
      const resolved = await options.maps.resolvePlace(parsed);
      const snapshot = await upsertPlaceSnapshot(options.placeSnapshotClient ?? prisma, resolved);
      // Agency policy applies before these insights can become a candidate.
      await assertPlaceAllowed(sessionOf(context), resolved);
      const run = createRunRecord(context);
      await options.agentService.recordSources(run, [
        {
          sourceType: "MAP_PLACE",
          title: resolved.name,
          url: resolved.websiteUrl ?? null,
          snippet: resolved.formattedAddress ?? null,
          provider: toProviderName(resolved.provider),
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            placeSnapshotId: snapshot.id,
            providerPlaceId: resolved.providerPlaceId,
            input: parsed,
            rating: resolved.rating ?? null
          })
        }
      ]);

      return {
        ...mapPinpointPayload(snapshot.id, resolved),
        rating: resolved.rating ?? null,
        websiteUrl: resolved.websiteUrl ?? null,
        phoneNumber: resolved.phoneNumber ?? null
      };
    }
  };
}

export function createSearchGooglePlacesTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "search_google_places",
    async execute(_context, input) {
      const parsed = searchPlacesInputSchema.parse(input);
      console.log(`[Maps] searchPlaces query: "${parsed.query}"`);
      const raw = await options.maps.searchPlaces({
        query: parsed.query,
        languageCode: parsed.languageCode,
        maxResultCount: Math.min(parsed.maxResults || 5, 5)
      });
      // Observations are persisted for every candidate; only allowed ones are
      // offered back, and only they are recorded as sources.
      const { results, blocked: rejected } = await partitionResults(sessionOf(_context), raw);
      await options.agentService.recordSources(
        createRunRecord(_context),
        results.map((result, index) => ({
          sourceType: "MAP_PLACE",
          title: result.name,
          url: null,
          snippet: result.address ?? null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            query: parsed.query,
            languageCode: parsed.languageCode ?? null,
            maxResults: parsed.maxResults,
            index,
            placeId: result.id,
            rating: result.rating ?? null,
            userRatingCount: result.userRatingCount ?? null,
            types: result.types
          })
        }))
      );
      return { results, blocked: rejected };
    }
  };
}

export function createGetGooglePlaceDetailsTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "get_google_place_details",
    async execute(_context, input) {
      const parsed = placeDetailsInputSchema.parse(input);
      console.log(`[Maps] getPlaceDetails for: "${parsed.placeId}"`);
      const result = await options.maps.getPlaceDetails(parsed.placeId);

      // Persist the observation, then decide. A blocked place is never returned
      // as usable detail and records no source.
      const session = sessionOf(_context);
      if (session) {
        const { verdict } = await session.consider(toCandidate(result) as never);
        if (!verdict.allowed) throw blocked(result.name ?? parsed.placeId, verdict);
      }

      await options.agentService.recordSources(createRunRecord(_context), [
        {
          sourceType: "MAP_PLACE",
          title: result.name,
          url: result.websiteUri ?? null,
          snippet: result.address ?? null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            placeId: result.id,
            phoneNumber: result.phoneNumber ?? null,
            websiteUri: result.websiteUri ?? null,
            rating: result.rating ?? null,
            userRatingCount: result.userRatingCount ?? null,
            types: result.types
          })
        }
      ]);
      return result;
    }
  };
}

export function createEstimateRouteTool(options: {
  maps: MapsProvider;
  agentService: AgentToolService;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "estimate_route",
    async execute(_context, input) {
      const parsed = routeInputSchema.parse(input);
      let origin: { latitude: number; longitude: number };
      let destination: { latitude: number; longitude: number };
      let travelMode: "DRIVE" | "BICYCLE" | "WALK" | "TWO_WHEELER" | "TRANSIT";
      let originPayload: unknown;
      let destinationPayload: unknown;

      if ("origin" in parsed) {
        origin = parsed.origin;
        destination = parsed.destination;
        travelMode = parsed.travelMode;
        originPayload = origin;
        destinationPayload = destination;
      } else {
        console.log(
          `[Maps] estimate_route resolving origin: "${parsed.originPlaceName}" and destination: "${parsed.destinationPlaceName}"`
        );
        const [originPlace, destinationPlace] = await Promise.all([
          options.maps.resolvePlace({
            placeName: parsed.originPlaceName,
            cityContext: parsed.cityContext
          }),
          options.maps.resolvePlace({
            placeName: parsed.destinationPlaceName,
            cityContext: parsed.cityContext
          })
        ]);

        const client = options.placeSnapshotClient ?? prisma;
        const [originSnapshot, destinationSnapshot] = await Promise.all([
          upsertPlaceSnapshot(client, originPlace),
          upsertPlaceSnapshot(client, destinationPlace)
        ]);
        // Name mode is a selection, so both endpoints are checked. Coordinate-only
        // routing above stays a pure geometric calculation and is not gated.
        await assertPlaceAllowed(sessionOf(_context), originPlace);
        await assertPlaceAllowed(sessionOf(_context), destinationPlace);

        origin = originPlace.location;
        destination = destinationPlace.location;
        travelMode = parsed.travelMode;
        originPayload = mapPinpointPayload(originSnapshot.id, originPlace);
        destinationPayload = mapPinpointPayload(destinationSnapshot.id, destinationPlace);
      }

      console.log(`[Maps] estimateRoute via ${travelMode}`);
      const result = await options.maps.estimateRoute({
        origin,
        destination,
        travelMode
      });
      const run = createRunRecord(_context);

      await options.agentService.recordSources(run, [
        {
          sourceType: "MAP_ROUTE",
          title: "Route estimate",
          url: null,
          snippet:
            result.distanceMeters !== undefined || result.durationSeconds !== undefined
              ? `distance=${result.distanceMeters ?? "unknown"} duration=${result.durationSeconds ?? "unknown"}`
              : null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            origin,
            destination,
            travelMode,
            distanceMeters: result.distanceMeters ?? null,
            durationSeconds: result.durationSeconds ?? null,
            staticDurationSeconds: result.staticDurationSeconds ?? null,
            input: parsed
          })
        }
      ]);
      await options.agentService.recordRunEvent(run, {
        type: "route.estimated",
        payload: {
          origin: originPayload,
          destination: destinationPayload,
          travelMode,
          distanceMeters: result.distanceMeters ?? null,
          durationSeconds: result.durationSeconds ?? null,
          staticDurationSeconds: result.staticDurationSeconds ?? null,
          polyline: result.polyline ?? null
        }
      });
      return result;
    }
  };
}


export function createSearchNearbyGooglePlacesTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "search_nearby_google_places",
    async execute(_context, input) {
      const parsed = searchNearbyInputSchema.parse(input);
      console.log(`[Maps] searchNearby radius ${parsed.radius}`);
      const raw = await options.maps.searchNearby({
        location: parsed.location,
        radius: parsed.radius,
        includedTypes: parsed.includedTypes,
        maxResultCount: Math.min(parsed.maxResults || 5, 5),
        languageCode: parsed.languageCode
      });
      const { results, blocked: rejected } = await partitionResults(sessionOf(_context), raw);
      await options.agentService.recordSources(
        createRunRecord(_context),
        results.map((result, index) => ({
          sourceType: "MAP_PLACE",
          title: result.name,
          url: null,
          snippet: result.address ?? null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            location: parsed.location,
            radius: parsed.radius,
            includedTypes: parsed.includedTypes,
            maxResults: parsed.maxResults,
            index,
            placeId: result.id,
            rating: result.rating ?? null,
            userRatingCount: result.userRatingCount ?? null,
            types: result.types
          })
        }))
      );
      return { results, blocked: rejected };
    }
  };
}

export function createGetGooglePlacePhotosTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "get_google_place_photos",
    async execute(_context, input) {
      const parsed = placePhotosInputSchema.parse(input);
      console.log(`[Maps] getPlacePhotos for: "${parsed.placeId}"`);
      const results = await options.maps.getPlacePhotos(parsed.placeId, parsed.maxResults);
      return results;
    }
  };
}
