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

export type ResolvedPlace = {
  provider: "GOOGLE_MAPS" | "NOMINATIM";
  providerPlaceId: string;
  name: string;
  formattedAddress?: string;
  location: GeoPoint;
  rating?: number;
  websiteUrl?: string;
  phoneNumber?: string;
  metadata?: Record<string, unknown>;
};

export type RouteEstimateResult = {
  distanceMeters?: number;
  durationSeconds?: number;
  staticDurationSeconds?: number;
  polyline?: string;
};

export type MapsProvider = {
  resolvePlace(input: {
    placeName: string;
    cityContext?: string;
    countryCode?: string;
    languageCode?: string;
    locationBias?: GeoPoint;
  }): Promise<ResolvedPlace>;
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
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type NominatimMapsProviderOptions = {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
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

type NominatimPlace = {
  place_id?: unknown;
  osm_type?: unknown;
  osm_id?: unknown;
  display_name?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  type?: unknown;
  class?: unknown;
  importance?: unknown;
  boundingbox?: unknown;
  licence?: unknown;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let lastNominatimRequestAt = 0;

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

function parseStringNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocation(location: GooglePlace["location"]): GeoPoint | undefined {
  const latitude = parseNumber(location?.latitude);
  const longitude = parseNumber(location?.longitude);

  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  return { latitude, longitude };
}

function parsePlace(place: unknown): PlaceSearchResult {
  if (!isRecord(place)) {
    throw mapsUnavailable();
  }

  const displayName = isRecord(place.displayName) ? place.displayName : undefined;
  const location = isRecord(place.location) ? place.location : undefined;

  return {
    id: parseString(place.id) ?? "",
    name: parseString(displayName?.text) ?? "",
    address: parseString(place.formattedAddress),
    location: parseLocation(location),
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

function parseResponseArray(body: unknown, key: string): unknown[] {
  if (!isRecord(body)) {
    throw mapsUnavailable();
  }

  const value = body[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw mapsUnavailable();
  }

  return value;
}

function parseRoute(route: unknown): RouteEstimateResult {
  if (!isRecord(route)) {
    throw mapsUnavailable();
  }

  const polyline = isRecord(route.polyline) ? route.polyline : undefined;

  return {
    distanceMeters: parseNumber(route.distanceMeters),
    durationSeconds: parseDurationSeconds(route.duration),
    staticDurationSeconds: parseDurationSeconds(route.staticDuration),
    polyline: parseString(polyline?.encodedPolyline)
  };
}

function createUnsupportedMapsProviderMethod(methodName: string) {
  return () => {
    throw mapsUnavailable(`Nominatim maps provider does not support ${methodName}.`);
  };
}

function queryFromPlaceInput(input: Parameters<MapsProvider["resolvePlace"]>[0]) {
  return [input.placeName, input.cityContext, input.countryCode].filter(Boolean).join(", ");
}

function parseNominatimPlace(place: unknown, query: string): ResolvedPlace {
  if (!isRecord(place)) {
    throw mapsUnavailable("Nominatim returned an invalid place payload.");
  }

  const latitude = parseStringNumber(place.lat);
  const longitude = parseStringNumber(place.lon);
  const displayName = parseString(place.display_name);
  const placeId =
    parseString(place.place_id) ??
    (typeof place.place_id === "number" ? String(place.place_id) : undefined) ??
    [parseString(place.osm_type), parseString(place.osm_id) ?? (typeof place.osm_id === "number" ? String(place.osm_id) : undefined)]
      .filter(Boolean)
      .join(":");

  if (latitude === undefined || longitude === undefined || !displayName || !placeId) {
    throw mapsUnavailable("Nominatim could not resolve the place to coordinates.");
  }

  return {
    provider: "NOMINATIM",
    providerPlaceId: placeId,
    name: parseString(place.name) ?? displayName.split(",")[0]?.trim() ?? displayName,
    formattedAddress: displayName,
    location: { latitude, longitude },
    metadata: {
      query,
      osmType: parseString(place.osm_type) ?? null,
      osmId: parseString(place.osm_id) ?? (typeof place.osm_id === "number" ? String(place.osm_id) : null),
      class: parseString(place.class) ?? null,
      type: parseString(place.type) ?? null,
      importance: parseStringNumber(place.importance) ?? null,
      boundingbox: Array.isArray(place.boundingbox) ? place.boundingbox : null,
      licence: parseString(place.licence) ?? null
    }
  };
}

async function throttleNominatimRequest() {
  const now = Date.now();
  const elapsed = now - lastNominatimRequestAt;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }
  lastNominatimRequestAt = Date.now();
}

async function readJsonResponse<T>(
  fetchImpl: typeof fetch,
  url: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  providerName = "Maps API"
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error body");
      console.error(`[${providerName}] Request failed: ${response.status} ${response.statusText}\nURL: ${url}\nBody: ${errorBody}`);
      throw mapsUnavailable(`${providerName} returned ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw mapsUnavailable();
  } finally {
    clearTimeout(timeout);
  }
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

export function createNominatimMapsProvider(options: NominatimMapsProviderOptions = {}): MapsProvider {
  const baseUrl = (options.baseUrl ?? env.NOMINATIM_BASE_URL).replace(/\/+$/, "");
  const userAgent = (options.userAgent ?? env.NOMINATIM_USER_AGENT).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = new Map<string, ResolvedPlace>();

  if (!baseUrl) {
    throw mapsUnavailable("Nominatim provider is not configured.");
  }
  if (!userAgent) {
    throw mapsUnavailable("Nominatim provider requires a User-Agent.");
  }

  return {
    async resolvePlace(input) {
      const query = queryFromPlaceInput(input);
      if (!query.trim()) {
        throw mapsUnavailable("Place query is empty.");
      }

      const cacheKey = query.trim().toLowerCase();
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const url = new URL(`${baseUrl}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("addressdetails", "1");
      if (input.languageCode) {
        url.searchParams.set("accept-language", input.languageCode);
      }
      if (input.countryCode) {
        url.searchParams.set("countrycodes", input.countryCode.toLowerCase());
      }

      await throttleNominatimRequest();
      const response = await readJsonResponse<unknown>(
        fetchImpl,
        url,
        {
          method: "GET",
          headers: {
            "User-Agent": userAgent,
            "Accept": "application/json"
          }
        },
        timeoutMs,
        "Nominatim"
      );

      const place = Array.isArray(response) ? response[0] : undefined;
      if (!place) {
        throw mapsUnavailable("Nominatim could not find the requested place.");
      }

      const resolved = parseNominatimPlace(place, query);
      cache.set(cacheKey, resolved);
      return resolved;
    },

    async searchPlaces(input) {
      const resolved = await this.resolvePlace({ placeName: input.query, languageCode: input.languageCode });
      return [
        {
          id: resolved.providerPlaceId,
          name: resolved.name,
          address: resolved.formattedAddress,
          location: resolved.location,
          types: []
        }
      ];
    },

    getPlaceDetails: createUnsupportedMapsProviderMethod("place details"),
    estimateRoute: createUnsupportedMapsProviderMethod("route estimates")
  };
}
