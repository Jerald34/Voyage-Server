import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import { createGoogleMapsProvider } from "../src/services/maps";
import { parseBusinessStatus } from "../src/services/maps/parsing";

describe("Google Maps provider", () => {
  it("rejects empty API keys", () => {
    expect(() => createGoogleMapsProvider({ apiKey: "" })).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        code: "MAPS_PROVIDER_UNAVAILABLE",
        message: "Google Maps provider is not configured."
      } satisfies Partial<ApiError>)
    );
  });

  it("searches places with text search request headers and compact parsing", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "places/abc",
              displayName: { text: "Fort San Pedro" },
              formattedAddress: "A. Pigafetta Street, Cebu City",
              location: { latitude: 10.2927, longitude: 123.9053 },
              rating: 4.4,
              userRatingCount: 812,
              types: ["tourist_attraction"]
            }
          ]
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    const results = await provider.searchPlaces({ query: "Fort San Pedro Cebu", languageCode: "en" });

    expect(results).toEqual([
      {
        id: "places/abc",
        name: "Fort San Pedro",
        address: "A. Pigafetta Street, Cebu City",
        location: { latitude: 10.2927, longitude: 123.9053 },
        rating: 4.4,
        userRatingCount: 812,
        types: ["tourist_attraction"]
      }
    ]);
    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "maps-key"
    });
    expect(calls[0].init.headers).toHaveProperty("X-Goog-FieldMask");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      textQuery: "Fort San Pedro Cebu",
      languageCode: "en"
    });
  });

  it("maps malformed search payloads to MAPS_PROVIDER_UNAVAILABLE", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () => new Response(JSON.stringify({ places: {} }), { status: 200 })
    });

    await expect(provider.searchPlaces({ query: "Cebu" })).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE",
      message: "Google Maps provider is unavailable."
    } satisfies Partial<ApiError>);
  });

  it("gets place details with the place details endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: "places/abc",
          displayName: { text: "Fort San Pedro" },
          formattedAddress: "A. Pigafetta Street, Cebu City",
          location: { latitude: 10.2927, longitude: 123.9053 },
          nationalPhoneNumber: "(032) 256 2284",
          websiteUri: "https://example.com",
          rating: 4.4,
          userRatingCount: 812
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    const result = await provider.getPlaceDetails("places/abc");

    expect(result).toEqual({
      id: "places/abc",
      name: "Fort San Pedro",
      address: "A. Pigafetta Street, Cebu City",
      location: { latitude: 10.2927, longitude: 123.9053 },
      phoneNumber: "(032) 256 2284",
      websiteUri: "https://example.com",
      rating: 4.4,
      userRatingCount: 812,
      types: []
    });
    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places/places%2Fabc");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toMatchObject({ "X-Goog-Api-Key": "maps-key" });
    expect(calls[0].init.headers).toHaveProperty("X-Goog-FieldMask");
  });

  it("estimates routes with computeRoutes request shape and compact parsing", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 3200,
              duration: "780s",
              staticDuration: "720s",
              polyline: { encodedPolyline: "abc123" }
            }
          ]
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    const result = await provider.estimateRoute({
      origin: { latitude: 10.2927, longitude: 123.9053 },
      destination: { latitude: 10.3157, longitude: 123.8854 },
      travelMode: "DRIVE"
    });

    expect(result).toEqual({
      distanceMeters: 3200,
      durationSeconds: 780,
      staticDurationSeconds: 720,
      polyline: "abc123"
    });
    expect(calls[0].url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Goog-Api-Key": "maps-key"
    });
    expect(calls[0].init.headers).toHaveProperty("X-Goog-FieldMask");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      origin: { location: { latLng: { latitude: 10.2927, longitude: 123.9053 } } },
      destination: { location: { latLng: { latitude: 10.3157, longitude: 123.8854 } } },
      travelMode: "DRIVE"
    });
  });

  it("maps malformed route payloads to MAPS_PROVIDER_UNAVAILABLE", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () => new Response(JSON.stringify({ routes: {} }), { status: 200 })
    });

    await expect(
      provider.estimateRoute({
        origin: { latitude: 10.2927, longitude: 123.9053 },
        destination: { latitude: 10.3157, longitude: 123.8854 }
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE",
      message: "Google Maps provider is unavailable."
    } satisfies Partial<ApiError>);
  });

  it("passes an abort signal and maps aborted fetches to MAPS_PROVIDER_UNAVAILABLE", async () => {
    let signal: AbortSignal | undefined;
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      timeoutMs: 50,
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
    });

    await expect(provider.searchPlaces({ query: "Cebu" })).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE",
      message: "Google Maps provider is unavailable."
    } satisfies Partial<ApiError>);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// fetchPlacePhoto tests (Task 10 – Maps key must never appear in URLs)
// ---------------------------------------------------------------------------

describe("fetchPlacePhoto", () => {
  const VALID_PHOTO_NAME = "places/ChIJabc123/photos/AUc7tXkDEF456";

  function makeFakeArrayBuffer(size = 100): ArrayBuffer {
    return new Uint8Array(size).fill(0xff).buffer;
  }

  function makeFetchImpl(opts: {
    status?: number;
    contentType?: string;
    contentLength?: string;
    bodySize?: number;
    captureCall?: (url: string, init: RequestInit) => void;
  }): typeof fetch {
    return async (url, init) => {
      opts.captureCall?.(String(url), init ?? {});
      const headers = new Headers();
      headers.set("content-type", opts.contentType ?? "image/jpeg");
      if (opts.contentLength !== undefined) {
        headers.set("content-length", opts.contentLength);
      }
      const ab = makeFakeArrayBuffer(opts.bodySize ?? 100);
      return new Response(new Uint8Array(ab), {
        status: opts.status ?? 200,
        headers
      });
    };
  }

  it("sends the API key in X-Goog-Api-Key header and NOT in the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({
        captureCall: (url, init) => {
          capturedUrl = url;
          capturedHeaders = (init.headers ?? {}) as Record<string, string>;
        }
      })
    });

    await provider.fetchPlacePhoto(VALID_PHOTO_NAME, { width: 400, height: 400 });

    expect(capturedUrl).not.toContain("key=");
    expect(capturedUrl).not.toContain("test-maps-api-key");
    expect(capturedHeaders["X-Goog-Api-Key"]).toBe("test-maps-api-key");
  });

  it("rejects a photoName that does not match the allowed pattern", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({})
    });

    await expect(
      provider.fetchPlacePhoto("places/../../../etc/passwd", { width: 400, height: 400 })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);

    await expect(
      provider.fetchPlacePhoto("invalid-format", { width: 400, height: 400 })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
  });

  it("validates that content-type starts with image/", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({ contentType: "application/json" })
    });

    await expect(
      provider.fetchPlacePhoto(VALID_PHOTO_NAME, { width: 400, height: 400 })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
  });

  it("returns { bytes: Buffer, contentType: string } on success", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({ contentType: "image/jpeg", bodySize: 200 })
    });

    const result = await provider.fetchPlacePhoto(VALID_PHOTO_NAME, { width: 400, height: 400 });

    expect(result).toHaveProperty("bytes");
    expect(result).toHaveProperty("contentType", "image/jpeg");
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.bytes.length).toBe(200);
  });

  it("rejects when content-length header exceeds the 10 MB cap", async () => {
    const TEN_MB_PLUS_ONE = 10 * 1024 * 1024 + 1;
    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({
        contentLength: String(TEN_MB_PLUS_ONE),
        contentType: "image/jpeg",
        bodySize: 100
      })
    });

    await expect(
      provider.fetchPlacePhoto(VALID_PHOTO_NAME, { width: 400, height: 400 })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
  });

  it("rejects non-OK responses from Google", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "test-maps-api-key",
      fetchImpl: makeFetchImpl({ status: 403, contentType: "application/json" })
    });

    await expect(
      provider.fetchPlacePhoto(VALID_PHOTO_NAME, { width: 400, height: 400 })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MAPS_PROVIDER_UNAVAILABLE"
    } satisfies Partial<ApiError>);
  });
});

// ---------------------------------------------------------------------------
// Business status propagation (Task 2 – place freshness gate)
// ---------------------------------------------------------------------------

describe("parseBusinessStatus", () => {
  it("recognizes OPERATIONAL, CLOSED_TEMPORARILY, and CLOSED_PERMANENTLY", () => {
    expect(parseBusinessStatus("OPERATIONAL")).toBe("OPERATIONAL");
    expect(parseBusinessStatus("CLOSED_TEMPORARILY")).toBe("CLOSED_TEMPORARILY");
    expect(parseBusinessStatus("CLOSED_PERMANENTLY")).toBe("CLOSED_PERMANENTLY");
  });

  it("returns undefined for missing or unrecognized values, never a default", () => {
    expect(parseBusinessStatus(undefined)).toBeUndefined();
    expect(parseBusinessStatus(null)).toBeUndefined();
    expect(parseBusinessStatus("")).toBeUndefined();
    expect(parseBusinessStatus("BUSINESS_STATUS_UNSPECIFIED")).toBeUndefined();
    expect(parseBusinessStatus("operational")).toBeUndefined();
    expect(parseBusinessStatus(42)).toBeUndefined();
  });
});

describe("Google Maps provider business status", () => {
  const FIXED_NOW = new Date("2026-09-06T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fieldMask(init: RequestInit): string {
    return (init.headers as Record<string, string>)["X-Goog-FieldMask"];
  }

  it("requests places.businessStatus in the resolvePlace field mask", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "places/abc",
              displayName: { text: "Fort San Pedro" },
              location: { latitude: 10.2927, longitude: 123.9053 }
            }
          ]
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.resolvePlace({ placeName: "Fort San Pedro", cityContext: "Cebu" });

    expect(fieldMask(calls[0].init)).toContain("places.businessStatus");
    // Existing fields must not be dropped.
    expect(fieldMask(calls[0].init)).toContain("places.id");
    expect(fieldMask(calls[0].init)).toContain("places.displayName");
    expect(fieldMask(calls[0].init)).toContain("places.location");
  });

  it("requests places.businessStatus in the searchPlaces field mask", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.searchPlaces({ query: "Cebu forts" });

    const mask = fieldMask(calls[0].init);
    expect(mask).toContain("places.businessStatus");
    for (const existing of [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.rating",
      "places.userRatingCount",
      "places.types"
    ]) {
      expect(mask).toContain(existing);
    }
  });

  it("requests places.businessStatus in the searchNearby field mask", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.searchNearby({ location: { latitude: 10.2927, longitude: 123.9053 }, radius: 500 });

    const mask = fieldMask(calls[0].init);
    expect(mask).toContain("places.businessStatus");
    for (const existing of [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.rating",
      "places.userRatingCount",
      "places.types"
    ]) {
      expect(mask).toContain(existing);
    }
  });

  it("requests businessStatus in the getPlaceDetails field mask", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: "places/abc",
          displayName: { text: "Fort San Pedro" },
          location: { latitude: 10.2927, longitude: 123.9053 }
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.getPlaceDetails("places/abc");

    const mask = fieldMask(calls[0].init);
    expect(mask).toContain("businessStatus");
    for (const existing of [
      "id",
      "displayName",
      "formattedAddress",
      "location",
      "rating",
      "userRatingCount",
      "types",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "photos"
    ]) {
      expect(mask).toContain(existing);
    }
  });

  it("resolvePlace copies a recognized OPERATIONAL status and its checked-at time", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/abc",
                displayName: { text: "Fort San Pedro" },
                location: { latitude: 10.2927, longitude: 123.9053 },
                businessStatus: "OPERATIONAL"
              }
            ]
          }),
          { status: 200 }
        )
    });

    const result = await provider.resolvePlace({ placeName: "Fort San Pedro" });

    expect(result.businessStatus).toBe("OPERATIONAL");
    expect(result.businessStatusCheckedAt).toEqual(FIXED_NOW);
  });

  it("resolvePlace copies a recognized CLOSED_PERMANENTLY status", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/closed",
                displayName: { text: "Old Shop" },
                location: { latitude: 10.29, longitude: 123.9 },
                businessStatus: "CLOSED_PERMANENTLY"
              }
            ]
          }),
          { status: 200 }
        )
    });

    const result = await provider.resolvePlace({ placeName: "Old Shop" });

    expect(result.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(result.businessStatusCheckedAt).toEqual(FIXED_NOW);
  });

  it("resolvePlace omits businessStatus and businessStatusCheckedAt when status is missing", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/abc",
                displayName: { text: "Fort San Pedro" },
                location: { latitude: 10.2927, longitude: 123.9053 }
              }
            ]
          }),
          { status: 200 }
        )
    });

    const result = await provider.resolvePlace({ placeName: "Fort San Pedro" });

    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
    // Existing missing-field shape assertions must still hold.
    expect(result).toEqual({
      provider: "GOOGLE_MAPS",
      providerPlaceId: "places/abc",
      name: "Fort San Pedro",
      formattedAddress: undefined,
      location: { latitude: 10.2927, longitude: 123.9053 },
      rating: undefined,
      metadata: {
        query: "Fort San Pedro",
        types: [],
        userRatingCount: null,
        locationBias: null
      }
    });
  });

  it("resolvePlace omits businessStatus when the value is unrecognized", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/abc",
                displayName: { text: "Fort San Pedro" },
                location: { latitude: 10.2927, longitude: 123.9053 },
                businessStatus: "BUSINESS_STATUS_UNSPECIFIED"
              }
            ]
          }),
          { status: 200 }
        )
    });

    const result = await provider.resolvePlace({ placeName: "Fort San Pedro" });

    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
  });

  it("searchPlaces attaches recognized status and checked-at per result, and never defaults to OPERATIONAL", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/open",
                displayName: { text: "Open Cafe" },
                location: { latitude: 10.29, longitude: 123.9 },
                types: [],
                businessStatus: "OPERATIONAL"
              },
              {
                id: "places/closed",
                displayName: { text: "Closed Cafe" },
                location: { latitude: 10.3, longitude: 123.91 },
                types: [],
                businessStatus: "CLOSED_TEMPORARILY"
              },
              {
                id: "places/unknown",
                displayName: { text: "Mystery Cafe" },
                location: { latitude: 10.31, longitude: 123.92 },
                types: []
                // no businessStatus field at all
              }
            ]
          }),
          { status: 200 }
        )
    });

    const results = await provider.searchPlaces({ query: "cafes" });

    expect(results[0].businessStatus).toBe("OPERATIONAL");
    expect(results[0].businessStatusCheckedAt).toEqual(FIXED_NOW);
    expect(results[1].businessStatus).toBe("CLOSED_TEMPORARILY");
    expect(results[1].businessStatusCheckedAt).toEqual(FIXED_NOW);
    expect(Object.prototype.hasOwnProperty.call(results[2], "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(results[2], "businessStatusCheckedAt")).toBe(false);
  });

  it("searchNearby attaches a recognized status and checked-at time", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "places/nearby",
                displayName: { text: "Nearby Spot" },
                location: { latitude: 10.29, longitude: 123.9 },
                types: [],
                businessStatus: "CLOSED_PERMANENTLY"
              }
            ]
          }),
          { status: 200 }
        )
    });

    const results = await provider.searchNearby({
      location: { latitude: 10.2927, longitude: 123.9053 },
      radius: 500
    });

    expect(results[0].businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(results[0].businessStatusCheckedAt).toEqual(FIXED_NOW);
  });

  it("getPlaceDetails surfaces a recognized status alongside existing fields", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "places/abc",
            displayName: { text: "Fort San Pedro" },
            location: { latitude: 10.2927, longitude: 123.9053 },
            businessStatus: "OPERATIONAL"
          }),
          { status: 200 }
        )
    });

    const result = await provider.getPlaceDetails("places/abc");

    expect(result.businessStatus).toBe("OPERATIONAL");
    expect(result.businessStatusCheckedAt).toEqual(FIXED_NOW);
  });

  it("getPlaceDetails surfaces a recognized closure status even without coordinates", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "places/no-coords",
            displayName: { text: "Undisclosed Location" },
            // no `location` field at all
            businessStatus: "CLOSED_PERMANENTLY"
          }),
          { status: 200 }
        )
    });

    const result = await provider.getPlaceDetails("places/no-coords");

    expect(result.location).toBeUndefined();
    expect(result.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(result.businessStatusCheckedAt).toEqual(FIXED_NOW);
  });

  it("getPlaceDetails omits businessStatus fields when status is missing", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "places/abc",
            displayName: { text: "Fort San Pedro" },
            location: { latitude: 10.2927, longitude: 123.9053 }
          }),
          { status: 200 }
        )
    });

    const result = await provider.getPlaceDetails("places/abc");

    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
  });

  it("getPlaceDetails omits businessStatus fields when the value is unrecognized", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "places/abc",
            displayName: { text: "Fort San Pedro" },
            location: { latitude: 10.2927, longitude: 123.9053 },
            businessStatus: "SOMETHING_ELSE"
          }),
          { status: 200 }
        )
    });

    const result = await provider.getPlaceDetails("places/abc");

    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
  });
});

describe("getPlaceStatus", () => {
  const FIXED_NOW = new Date("2026-09-06T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests GET https://places.googleapis.com/v1/places/{id} with field mask id,businessStatus", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "places/abc", businessStatus: "OPERATIONAL" }), { status: 200 });
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.getPlaceStatus?.("places/abc");

    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places/places%2Fabc");
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("id,businessStatus");
    expect((calls[0].init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("maps-key");
  });

  it("does not request photos", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "places/abc", businessStatus: "OPERATIONAL" }), { status: 200 });
    };
    const provider = createGoogleMapsProvider({ apiKey: "maps-key", fetchImpl });

    await provider.getPlaceStatus?.("places/abc");

    expect((calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"]).not.toContain("photos");
  });

  it("does not require coordinates in the response", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "places/abc", businessStatus: "CLOSED_TEMPORARILY" }), { status: 200 })
    });

    const result = await provider.getPlaceStatus?.("places/abc");

    expect(result).toEqual({ businessStatus: "CLOSED_TEMPORARILY", businessStatusCheckedAt: FIXED_NOW });
  });

  it("returns each recognized status with its checked-at time", async () => {
    for (const status of ["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"] as const) {
      const provider = createGoogleMapsProvider({
        apiKey: "maps-key",
        fetchImpl: async () => new Response(JSON.stringify({ id: "places/abc", businessStatus: status }), { status: 200 })
      });

      const result = await provider.getPlaceStatus?.("places/abc");

      expect(result?.businessStatus).toBe(status);
      expect(result?.businessStatusCheckedAt).toEqual(FIXED_NOW);
    }
  });

  it("omits businessStatus when the response has no status", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () => new Response(JSON.stringify({ id: "places/abc" }), { status: 200 })
    });

    const result = await provider.getPlaceStatus?.("places/abc");

    expect(result).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
  });

  it("omits businessStatus when the response has an unrecognized status", async () => {
    const provider = createGoogleMapsProvider({
      apiKey: "maps-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ id: "places/abc", businessStatus: "NOT_A_REAL_STATUS" }), { status: 200 })
    });

    const result = await provider.getPlaceStatus?.("places/abc");

    expect(Object.prototype.hasOwnProperty.call(result, "businessStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "businessStatusCheckedAt")).toBe(false);
  });
});
