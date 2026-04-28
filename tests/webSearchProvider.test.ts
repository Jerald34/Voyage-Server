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
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
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
    const requestUrl = new URL(calls[0].url);
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://www.googleapis.com/customsearch/v1");
    expect(requestUrl.searchParams.get("key")).toBe("search-key");
    expect(requestUrl.searchParams.get("cx")).toBe("engine-id");
    expect(requestUrl.searchParams.get("q")).toBe("Cebu itinerary");
    expect(requestUrl.searchParams.get("num")).toBe("10");
    expect(requestUrl.searchParams.get("hl")).toBe("en");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
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

  it("passes an abort signal and maps aborted fetches to WEB_SEARCH_PROVIDER_UNAVAILABLE", async () => {
    let signal: AbortSignal | undefined;
    const provider = createGoogleSearchProvider({
      apiKey: "search-key",
      searchEngineId: "engine-id",
      timeoutMs: 50,
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
    });

    await expect(provider.search({ query: "Cebu" })).rejects.toMatchObject({
      statusCode: 503,
      code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
      message: "Google Search provider is unavailable."
    } satisfies Partial<ApiError>);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
