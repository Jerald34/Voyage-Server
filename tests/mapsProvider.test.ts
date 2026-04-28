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
