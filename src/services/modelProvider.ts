import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelProvider = {
  complete(input: { messages: ModelMessage[]; temperature?: number }): Promise<{ content: string }>;
  completeStream?(input: { messages: ModelMessage[]; temperature?: number }): AsyncIterable<string>;
};

type OpenAiCompatibleProviderOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  errorFactory?: (error?: unknown) => ApiError;
  requestBodyExtras?: Record<string, unknown>;
};

function defaultErrorFactory() {
  return new ApiError(503, "MODEL_PROVIDER_ERROR", "The model provider is currently unavailable.");
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleProviderOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const {
    model,
    apiKey,
    timeoutMs = 120000,
    fetchImpl = fetch,
    errorFactory = defaultErrorFactory,
    requestBodyExtras = {}
  } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return {
    async complete(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2,
            ...requestBodyExtras
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "Could not read error body");
          console.error(`Model provider error (${response.status}):`, errorBody);
          throw errorFactory();
        }

        const body = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = body.choices?.[0]?.message?.content;

        if (typeof content !== "string") {
          throw errorFactory();
        }

        return { content };
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        throw errorFactory(error);
      } finally {
        clearTimeout(timeout);
      }
    },

    async *completeStream(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2,
            ...requestBodyExtras,
            stream: true
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          const errorBody = await response.text().catch(() => "Could not read error body");
          console.error(`Model provider error (${response.status}):`, errorBody);
          throw errorFactory();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let lineBreakIndex = buffer.indexOf("\n");
          while (lineBreakIndex >= 0) {
            const rawLine = buffer.slice(0, lineBreakIndex);
            buffer = buffer.slice(lineBreakIndex + 1);
            lineBreakIndex = buffer.indexOf("\n");

            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) {
              continue;
            }

            const payloadText = line.slice(5).trim();
            if (!payloadText) {
              continue;
            }
            if (payloadText === "[DONE]") {
              return;
            }

            try {
              const payload = JSON.parse(payloadText) as {
                type?: string;
                content?: unknown;
                choices?: Array<{ delta?: { content?: unknown } }>;
              };

              const openAiDelta = payload.choices?.[0]?.delta?.content;
              if (typeof openAiDelta === "string" && openAiDelta.length > 0) {
                yield openAiDelta;
                continue;
              }

              if (payload.type === "message.delta" && typeof payload.content === "string" && payload.content.length > 0) {
                yield payload.content;
              }
            } catch {
              // Ignore non-JSON or partial lines and continue consuming.
            }
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw errorFactory(error);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

type LmStudioModelProviderOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createLmStudioModelProvider(options: LmStudioModelProviderOptions = {}): ModelProvider {
  return createOpenAiCompatibleProvider({
    baseUrl: options.baseUrl ?? env.LM_STUDIO_BASE_URL,
    model: options.model ?? env.LM_STUDIO_MODEL,
    timeoutMs: options.timeoutMs ?? env.LM_STUDIO_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
    errorFactory: () => new ApiError(503, "LOCAL_MODEL_UNAVAILABLE", "Local model provider is unavailable. Start LM Studio and try again.")
  });
}

type GoogleModelProviderOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createGoogleModelProvider(options: GoogleModelProviderOptions = {}): ModelProvider {
  return createOpenAiCompatibleProvider({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: options.model ?? env.GOOGLE_AI_MODEL,
    apiKey: options.apiKey ?? env.GOOGLE_AI_API_KEY,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    errorFactory: () => new ApiError(503, "GOOGLE_AI_UNAVAILABLE", "Google AI provider is unavailable. Check your API key and try again.")
  });
}

type OpenRouterReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

type OpenRouterModelProviderOptions = {
  apiKey?: string;
  model?: string;
  reasoningEffort?: OpenRouterReasoningEffort;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createOpenRouterModelProvider(options: OpenRouterModelProviderOptions = {}): ModelProvider {
  return createOpenAiCompatibleProvider({
    baseUrl: "https://openrouter.ai/api/v1",
    model: options.model ?? env.OPENROUTER_MODEL,
    apiKey: options.apiKey ?? env.OPENROUTER_API_KEY,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    requestBodyExtras: {
      reasoning: {
        effort: options.reasoningEffort ?? env.OPENROUTER_REASONING_EFFORT,
        exclude: true
      }
    },
    errorFactory: () => new ApiError(503, "OPENROUTER_UNAVAILABLE", "OpenRouter provider is unavailable. Check your API key and try again.")
  });
}

export const lmStudioModelProvider = createLmStudioModelProvider();
export const googleModelProvider = createGoogleModelProvider();
export const openRouterModelProvider = createOpenRouterModelProvider();

export function getModelProvider(): ModelProvider {
  if (env.OPENROUTER_API_KEY) {
    return openRouterModelProvider;
  }
  if (env.GOOGLE_AI_API_KEY) {
    return googleModelProvider;
  }
  return lmStudioModelProvider;
}
