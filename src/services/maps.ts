import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type PlaceSearchResult = {
  id: string;
  name: string;
  address?: string;
  location?: GeoPoint;
  rating?: number;
  userRatingCount?: number;
  types: string[];
};

export type PlaceDetailsResult = PlaceSearchResult & {
  phoneNumber?: string;
  websiteUri?: string;
};

export type RouteEstimateResult = {
  distanceMeters?: number;
  durationSeconds?: number;
  staticDurationSeconds?: number;
  polyline?: string;
};

export type MapsProvider = {
  searchPlaces(input: { query: string; languageCode?: string; maxResultCount?: number }): Promise<PlaceSearchResult[]>;
  getPlaceDetails(placeId: string): Promise<PlaceDetailsResult>;
  estimateRoute(input: {
    origin: GeoPoint;
    destination: GeoPoint;
    travelMode?: "DRIVE" | "BICYCLE" | "WALK" | "TWO_WHEELER" | "TRANSIT";
    routingPreference?: "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
  }): Promise<RouteEstimateResult>;
};

type GoogleMapsProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type GooglePlace = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  rating?: unknown;
  userRatingCount?: unknown;
  types?: unknown;
  nationalPhoneNumber?: unknown;
  internationalPhoneNumber?: unknown;
  websiteUri?: unknown;
};

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

function parseNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function parseString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function parseLocation(location: GooglePlace["location"]): GeoPoint | undefined {
  const latitude = parseNumber(location?.latitude);
  const longitude = parseNumber(location?.longitude);

  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  return { latitude, longitude };
}

function parsePlace(place: GooglePlace): PlaceSearchResult {
  return {
    id: parseString(place.id) ?? "",
    name: parseString(place.displayName?.text) ?? "",
    address: parseString(place.formattedAddress),
    location: parseLocation(place.location),
    rating: parseNumber(place.rating),
    userRatingCount: parseNumber(place.userRatingCount),
    types: Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : []
  };
}

function parseDurationSeconds(duration: unknown) {
  if (typeof duration !== "string") {
    return undefined;
  }

  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  return match ? Number(match[1]) : undefined;
}

async function readJsonResponse<T>(request: Promise<Response>): Promise<T> {
  try {
    const response = await request;

    if (!response.ok) {
      throw mapsUnavailable();
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw mapsUnavailable();
  }
}

export function createGoogleMapsProvider(options: GoogleMapsProviderOptions = {}): MapsProvider {
  const apiKey = (options.apiKey ?? env.GOOGLE_MAPS_API_KEY).trim();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw mapsUnavailable("Google Maps provider is not configured.");
  }

  return {
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

      const response = await readJsonResponse<{ places?: GooglePlace[] }>(
        fetchImpl("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: providerHeaders(
            apiKey,
            "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types"
          ),
          body: JSON.stringify(body)
        })
      );

      return (response.places ?? []).map(parsePlace);
    },

    async getPlaceDetails(placeId) {
      const response = await readJsonResponse<GooglePlace>(
        fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
          method: "GET",
          headers: providerHeaders(
            apiKey,
            "id,displayName,formattedAddress,location,rating,userRatingCount,types,nationalPhoneNumber,internationalPhoneNumber,websiteUri"
          )
        })
      );
      const place = parsePlace(response);

      return {
        ...place,
        phoneNumber: parseString(response.nationalPhoneNumber) ?? parseString(response.internationalPhoneNumber),
        websiteUri: parseString(response.websiteUri)
      };
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

      const response = await readJsonResponse<{
        routes?: Array<{
          distanceMeters?: unknown;
          duration?: unknown;
          staticDuration?: unknown;
          polyline?: { encodedPolyline?: unknown };
        }>;
      }>(
        fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: providerHeaders(
            apiKey,
            "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline"
          ),
          body: JSON.stringify(body)
        })
      );
      const route = response.routes?.[0] ?? {};

      return {
        distanceMeters: parseNumber(route.distanceMeters),
        durationSeconds: parseDurationSeconds(route.duration),
        staticDurationSeconds: parseDurationSeconds(route.staticDuration),
        polyline: parseString(route.polyline?.encodedPolyline)
      };
    }
  };
}
