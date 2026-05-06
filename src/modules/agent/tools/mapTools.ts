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

const routeInputSchema = z.object({
  origin: geoPointSchema,
  destination: geoPointSchema,
  travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]).default("DRIVE")
});

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
  travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TRANSIT"]).default("DRIVE")
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
      const route = await options.maps.estimateRoute({
        origin: originPlace.location,
        destination: destinationPlace.location,
        travelMode: parsed.travelMode
      });
      const run = createRunRecord(context);
      const payload = {
        origin: mapPinpointPayload(originSnapshot.id, originPlace),
        destination: mapPinpointPayload(destinationSnapshot.id, destinationPlace),
        distanceMeters: route.distanceMeters ?? null,
        durationSeconds: route.durationSeconds ?? null,
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
      const results = await options.maps.searchPlaces({
        query: parsed.query,
        languageCode: parsed.languageCode,
        maxResultCount: Math.min(parsed.maxResults || 5, 5)
      });
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
      return results;
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

export function createEstimateRouteTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "estimate_route",
    async execute(_context, input) {
      const parsed = routeInputSchema.parse(input);
      console.log(`[Maps] estimateRoute via ${parsed.travelMode}`);
      const result = await options.maps.estimateRoute({
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode
      });
      await options.agentService.recordSources(createRunRecord(_context), [
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
            origin: parsed.origin,
            destination: parsed.destination,
            travelMode: parsed.travelMode,
            distanceMeters: result.distanceMeters ?? null,
            durationSeconds: result.durationSeconds ?? null,
            staticDurationSeconds: result.staticDurationSeconds ?? null
          })
        }
      ]);
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
      const results = await options.maps.searchNearby({
        location: parsed.location,
        radius: parsed.radius,
        includedTypes: parsed.includedTypes,
        maxResultCount: Math.min(parsed.maxResults || 5, 5),
        languageCode: parsed.languageCode
      });
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
      return results;
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
