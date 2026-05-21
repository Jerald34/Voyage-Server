import { env } from "../../config/env";
import { ApiError } from "../../http/errors";
import type { GeoPoint, MapsProvider, PlaceDetailsResult, PlaceSearchResult, RouteEstimateResult, ResolvedPlace } from "./types";
import { parseNumber, parseDurationSeconds, parseRoute, parsePlace, parseResponseArray, isRecord, parseString, readJsonResponse } from "./parsing";

type GoogleMapsProviderOptions = {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

function mapsUnavailable(message = "Google Maps provider is unavailable.") {
  return new ApiError(503, "MAPS_PROVIDER_UNAVAILABLE", message);
}

function providerHeaders(apiKey: string, fieldMask: string) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask
  };
}

export function createGoogleMapsProvider(options: GoogleMapsProviderOptions = {}): MapsProvider {
  const apiKey = (options.apiKey ?? env.GOOGLE_MAPS_API_KEY).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw mapsUnavailable("Google Maps provider is not configured.");
  }

  return {
    async resolvePlace(input) {
      const query = [input.placeName, input.cityContext, input.countryCode].filter(Boolean).join(", ");
      const results = await this.searchPlaces({
        query,
        languageCode: input.languageCode,
        maxResultCount: 1
      });
      const place = results[0];
      if (!place?.id || !place.location) {
        throw mapsUnavailable("Place could not be resolved to coordinates.");
      }

      return {
        provider: "GOOGLE_MAPS",
        providerPlaceId: place.id,
        name: place.name,
        formattedAddress: place.address,
        location: place.location,
        rating: place.rating,
        metadata: {
          query,
          types: place.types,
          userRatingCount: place.userRatingCount ?? null,
          locationBias: input.locationBias ?? null
        }
      };
    },

    async searchPlaces(input) {
      const body: Record<string, unknown> = {
        textQuery: input.query
      };

      if (input.languageCode) {
        body.languageCode = input.languageCode;
      }

      if (input.maxResultCount !== undefined) {
        body.maxResultCount = input.maxResultCount;
      }

      const response = await readJsonResponse<unknown>(
        fetchImpl,
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: providerHeaders(
            apiKey,
            "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types"
          ),
          body: JSON.stringify(body)
        },
        timeoutMs,
        "Google Maps API"
      );

      return parseResponseArray(response, "places").map(parsePlace);
    },

    async searchNearby(input) {
      const body: Record<string, unknown> = {
        locationRestriction: {
          circle: {
            center: { latitude: input.location.latitude, longitude: input.location.longitude },
            radius: input.radius
          }
        }
      };

      if (input.includedTypes && input.includedTypes.length > 0) {
        body.includedTypes = input.includedTypes;
      }

      if (input.maxResultCount !== undefined) {
        body.maxResultCount = input.maxResultCount;
      }

      if (input.languageCode) {
        body.languageCode = input.languageCode;
      }

      const response = await readJsonResponse<unknown>(
        fetchImpl,
        "https://places.googleapis.com/v1/places:searchNearby",
        {
          method: "POST",
          headers: providerHeaders(
            apiKey,
            "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types"
          ),
          body: JSON.stringify(body)
        },
        timeoutMs,
        "Google Maps API"
      );

      return parseResponseArray(response, "places").map(parsePlace);
    },

    async getPlaceDetails(placeId) {
      const response = await readJsonResponse<unknown>(
        fetchImpl,
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        {
          method: "GET",
          headers: providerHeaders(
            apiKey,
            "id,displayName,formattedAddress,location,rating,userRatingCount,types,nationalPhoneNumber,internationalPhoneNumber,websiteUri"
          )
        },
        timeoutMs,
        "Google Maps API"
      );
      const place = parsePlace(response);
      const details = isRecord(response) ? response : {};

      return {
        ...place,
        phoneNumber: parseString(details.nationalPhoneNumber) ?? parseString(details.internationalPhoneNumber),
        websiteUri: parseString(details.websiteUri)
      };
    },

    async getPlacePhotos(placeId, maxResults = 5) {
      const response = await readJsonResponse<unknown>(
        fetchImpl,
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        {
          method: "GET",
          headers: providerHeaders(apiKey, "photos"),
        },
        timeoutMs,
        "Google Maps API"
      );

      if (!isRecord(response) || !Array.isArray(response.photos)) {
        return [];
      }

      const photos = response.photos.slice(0, maxResults);
      return photos.map((photo: any) => {
        const name = photo.name; // e.g. "places/PLACE_ID/photos/PHOTO_ID"
        // New API uses photo names directly for media requests
        return {
          name,
          photoUri: `https://places.googleapis.com/v1/${name}/media?key=${apiKey}&maxHeightPx=1000&maxWidthPx=1000`
        };
      });
    },

    async estimateRoute(input) {
      const body: Record<string, unknown> = {
        origin: { location: { latLng: input.origin } },
        destination: { location: { latLng: input.destination } },
        travelMode: input.travelMode ?? "DRIVE"
      };

      if (input.routingPreference) {
        body.routingPreference = input.routingPreference;
      }

      const response = await readJsonResponse<unknown>(
        fetchImpl,
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: providerHeaders(
            apiKey,
            "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline"
          ),
          body: JSON.stringify(body)
        },
        timeoutMs,
        "Google Maps API"
      );
      const route = parseResponseArray(response, "routes")[0] ?? {};

      return parseRoute(route);
    }
  };
}
