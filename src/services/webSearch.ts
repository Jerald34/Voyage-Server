import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: "serper";
};

export type WebSearchProvider = {
  search(input: { query: string; num?: number }): Promise<WebSearchResult[]>;
};

type SerperProviderOptions = {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

function webSearchUnavailable(message = "Web Search provider is unavailable.") {
  return new ApiError(503, "WEB_SEARCH_PROVIDER_UNAVAILABLE", message);
}

export function createSerperSearchProvider(options: SerperProviderOptions = {}): WebSearchProvider {
  const apiKey = (options.apiKey ?? env.SERPER_API_KEY).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw webSearchUnavailable("Serper API key is not configured.");
  }

  return {
    async search(input) {
      const url = "https://google.serper.dev/search";
      const body = {
        q: input.query,
        num: Math.min(Math.max(input.num ?? 10, 1), 20)
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        console.log(`[WebSearch] Fetching from Serper: ${input.query}`);
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "Unknown error");
          console.error(`[WebSearch] Serper API Error:`, errorBody);
          throw webSearchUnavailable(
            `Serper provider returned ${response.status}. Detail: ${errorBody.slice(0, 500)}`
          );
        }

        const data = (await response.json()) as {
          organic?: Array<{ title?: string; link?: string; snippet?: string }>;
        };

        return (data.organic ?? []).map((item) => ({
          title: item.title ?? "",
          url: item.link ?? "",
          snippet: item.snippet ?? "",
          provider: "serper" as const
        }));
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        console.error(`[WebSearch] Request failed:`, error);
        throw webSearchUnavailable();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

// Keep the factory name similar for easier migration in agentRoutes
export function createWebSearchProvider() {
  return createSerperSearchProvider();
}
