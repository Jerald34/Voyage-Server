import { ApiError } from "../../http/errors";
import type { GeoPoint, PlaceSearchResult, RouteEstimateResult, ResolvedPlace, MapsProvider } from "./types";
import { redactSecrets } from "../../utils/redaction";

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
  businessStatus?: unknown;
};

function mapsUnavailable(message = "Google Maps provider is unavailable.") {
  return new ApiError(503, "MAPS_PROVIDER_UNAVAILABLE", message);
}

export function parseNumber(value: unknown) {
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

/**
 * Strict businessStatus parser: only the three recognized Google Places values are
 * accepted. Missing or unrecognized input yields `undefined` (unverified), never a
 * default of OPERATIONAL — a closed place must never be masked by an unrelated parse
 * fallback.
 */
export function parseBusinessStatus(value: unknown) {
  return value === "OPERATIONAL" || value === "CLOSED_TEMPORARILY" || value === "CLOSED_PERMANENTLY"
    ? value
    : undefined;
}

function parsePlace(place: unknown): PlaceSearchResult {
  if (!isRecord(place)) {
    throw mapsUnavailable();
  }

  const displayName = isRecord(place.displayName) ? place.displayName : undefined;
  const location = isRecord(place.location) ? place.location : undefined;
  const businessStatus = parseBusinessStatus(place.businessStatus);

  return {
    id: parseString(place.id) ?? "",
    name: parseString(displayName?.text) ?? "",
    address: parseString(place.formattedAddress),
    location: parseLocation(location),
    rating: parseNumber(place.rating),
    userRatingCount: parseNumber(place.userRatingCount),
    types: Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : [],
    // Only add the key when recognized so existing missing-field object shapes
    // (deep-equality assertions with no businessStatus key) remain unchanged.
    ...(businessStatus !== undefined ? { businessStatus } : {})
  };
}

export function parseDurationSeconds(duration: unknown) {
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

export function parseRoute(route: unknown): RouteEstimateResult {
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

export function parseNominatimPlace(place: unknown, query: string): ResolvedPlace {
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

export async function readJsonResponse<T>(
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
      console.error(redactSecrets(`[${providerName}] Request failed: ${response.status} ${response.statusText}\nURL: ${url}\nBody: ${errorBody}`));
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

// Internal helpers used by the provider implementations
export { parsePlace, parseResponseArray, isRecord, parseString, parseStringNumber };
