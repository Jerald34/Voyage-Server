import { env } from "../../config/env";
import { ApiError } from "../../http/errors";
import type { MapsProvider, ResolvedPlace } from "./types";
import { parseNominatimPlace, readJsonResponse } from "./parsing";

type NominatimMapsProviderOptions = {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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

function queryFromPlaceInput(input: Parameters<MapsProvider["resolvePlace"]>[0]) {
  return [input.placeName, input.cityContext, input.countryCode].filter(Boolean).join(", ");
}

function createUnsupportedMapsProviderMethod(methodName: string) {
  return () => {
    throw mapsUnavailable(`Nominatim maps provider does not support ${methodName}.`);
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
    getPlacePhotos: createUnsupportedMapsProviderMethod("place photos"),
    searchNearby: createUnsupportedMapsProviderMethod("nearby search"),
    estimateRoute: createUnsupportedMapsProviderMethod("route estimates")
  };
}
