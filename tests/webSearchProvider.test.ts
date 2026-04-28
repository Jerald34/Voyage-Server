import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { createGoogleSearchProvider } from "../src/services/webSearch";

describe("Google Search provider", () => {
  it("rejects empty Google Search credentials", () => {
    expect(() => createGoogleSearchProvider({ apiKey: "", searchEngineId: "cx" })).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
        message: "Google Search provider is not configured."
      } satisfies Partial<ApiError>)
    );
    expect(() => createGoogleSearchProvider({ apiKey: "key", searchEngineId: "" })).toThrowError(
      expect.objectContaining({
        statusCode: 503,
        code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
        message: "Google Search provider is not configured."
      } satisfies Partial<ApiError>)
    );
  });

  it("calls Custom Search with capped result count and maps results", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          items: [
            {
              title: "Cebu travel guide",
              link: "https://example.com/cebu",
              snippet: "Ideas for a Cebu itinerary."
            }
          ]
        }),
        { status: 200 }
      );
    };
    const provider = createGoogleSearchProvider({
      apiKey: "search-key",
      searchEngineId: "engine-id",
      fetchImpl
    });

    const results = await provider.search({ query: "Cebu itinerary", num: 25, hl: "en" });

    expect(results).toEqual([
      {
        title: "Cebu travel guide",
        url: "https://example.com/cebu",
        snippet: "Ideas for a Cebu itinerary.",
        provider: "google_custom_search"
      }
    ]);
    const requestUrl = new URL(urls[0]);
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://www.googleapis.com/customsearch/v1");
    expect(requestUrl.searchParams.get("key")).toBe("search-key");
    expect(requestUrl.searchParams.get("cx")).toBe("engine-id");
    expect(requestUrl.searchParams.get("q")).toBe("Cebu itinerary");
    expect(requestUrl.searchParams.get("num")).toBe("10");
    expect(requestUrl.searchParams.get("hl")).toBe("en");
  });

  it("maps failed fetches and non-ok responses to WEB_SEARCH_PROVIDER_UNAVAILABLE", async () => {
    const failingProvider = createGoogleSearchProvider({
      apiKey: "search-key",
      searchEngineId: "engine-id",
      fetchImpl: async () => {
        throw new Error("network");
      }
    });
    const nonOkProvider = createGoogleSearchProvider({
      apiKey: "search-key",
      searchEngineId: "engine-id",
      fetchImpl: async () => new Response("quota", { status: 429 })
    });

    await expect(failingProvider.search({ query: "Cebu" })).rejects.toMatchObject({
      statusCode: 503,
      code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
      message: "Google Search provider is unavailable."
    } satisfies Partial<ApiError>);
    await expect(nonOkProvider.search({ query: "Cebu" })).rejects.toMatchObject({
      statusCode: 503,
      code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
      message: "Google Search provider is unavailable."
    } satisfies Partial<ApiError>);
  });
});
