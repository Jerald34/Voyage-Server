import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: "google_custom_search";
};

export type WebSearchProvider = {
  search(input: { query: string; num?: number; hl?: string }): Promise<WebSearchResult[]>;
};

type GoogleSearchProviderOptions = {
  apiKey?: string;
  searchEngineId?: string;
  fetchImpl?: typeof fetch;
};

function webSearchUnavailable(message = "Google Search provider is unavailable.") {
  return new ApiError(503, "WEB_SEARCH_PROVIDER_UNAVAILABLE", message);
}

function clampResultCount(num: number | undefined) {
  return Math.min(Math.max(num ?? 10, 1), 10);
}

export function createGoogleSearchProvider(options: GoogleSearchProviderOptions = {}): WebSearchProvider {
  const apiKey = (options.apiKey ?? env.GOOGLE_SEARCH_API_KEY).trim();
  const searchEngineId = (options.searchEngineId ?? env.GOOGLE_SEARCH_ENGINE_ID).trim();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey || !searchEngineId) {
    throw webSearchUnavailable("Google Search provider is not configured.");
  }

  return {
    async search(input) {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", searchEngineId);
      url.searchParams.set("q", input.query);
      url.searchParams.set("num", String(clampResultCount(input.num)));

      if (input.hl) {
        url.searchParams.set("hl", input.hl);
      }

      try {
        const response = await fetchImpl(url);

        if (!response.ok) {
          throw webSearchUnavailable();
        }

        const body = (await response.json()) as {
          items?: Array<{ title?: unknown; link?: unknown; snippet?: unknown }>;
        };

        return (body.items ?? []).map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          url: typeof item.link === "string" ? item.link : "",
          snippet: typeof item.snippet === "string" ? item.snippet : "",
          provider: "google_custom_search" as const
        }));
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        throw webSearchUnavailable();
      }
    }
  };
}
