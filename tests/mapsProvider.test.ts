import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { createGoogleMapsProvider } from "../src/services/maps";

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
