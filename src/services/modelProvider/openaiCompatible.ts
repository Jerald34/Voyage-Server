import { ApiError } from "../../http/errors";
import { env } from "../../config/env";
import type { ModelProvider, ModelMessage, ModelCompletionInput, ModelStreamInput, ModelUsage } from "./types";

type OpenAiCompatibleProviderOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  errorFactory?: (error?: unknown) => ApiError;
  requestBodyExtras?: Record<string, unknown>;
  maxAttempts?: number;
};

type OpenAiUsageShape = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cached_tokens?: unknown;
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
  cachedContentTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
};

function defaultErrorFactory() {
  return new ApiError(503, "MODEL_PROVIDER_ERROR", "The model provider is currently unavailable.");
}

function normalizeTokenDetails(details: unknown) {
  if (!Array.isArray(details)) {
    return undefined;
  }

  const normalized = details
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const modality = (item as { modality?: unknown }).modality;
      const tokenCount = (item as { tokenCount?: unknown }).tokenCount;
      return {
        modality: typeof modality === "string" ? modality : undefined,
        tokenCount: typeof tokenCount === "number" ? tokenCount : undefined
      };
    })
    .filter(
      (item): item is { modality: string | undefined; tokenCount: number | undefined } => Boolean(item)
    );

  return normalized.length > 0 ? normalized : undefined;
}

function toModelUsageFromOpenAi(model: string, usage: OpenAiUsageShape | undefined) {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const promptTokenCount =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.promptTokenCount === "number"
        ? usage.promptTokenCount
        : undefined;
  const candidatesTokenCount =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.candidatesTokenCount === "number"
        ? usage.candidatesTokenCount
        : undefined;
  const totalTokenCount =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : typeof usage.totalTokenCount === "number"
        ? usage.totalTokenCount
        : undefined;
  const cachedContentTokenCount =
    typeof usage.cached_tokens === "number"
      ? usage.cached_tokens
      : typeof usage.cachedContentTokenCount === "number"
        ? usage.cachedContentTokenCount
        : undefined;
  const thoughtsTokenCount = typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : undefined;

  if (
    promptTokenCount === undefined &&
    candidatesTokenCount === undefined &&
    totalTokenCount === undefined &&
    cachedContentTokenCount === undefined &&
    thoughtsTokenCount === undefined
  ) {
    return undefined;
  }

  return {
    model,
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
    cachedContentTokenCount,
    thoughtsTokenCount
  };
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleProviderOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const {
    model,
    apiKey,
    timeoutMs = 120000,
    fetchImpl = fetch,
    errorFactory = defaultErrorFactory,
    requestBodyExtras = {},
    maxAttempts = 1
  } = options;
  const attemptCount = Math.max(1, maxAttempts);

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return {
    async complete(input) {
      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
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
            if (attempt < attemptCount) {
              continue;
            }
            throw errorFactory();
          }

          const body = (await response.json()) as {
            choices?: Array<{ message?: { content?: unknown } }>;
            usage?: OpenAiUsageShape;
          };
          const content = body.choices?.[0]?.message?.content;
          const usage = toModelUsageFromOpenAi(model, body.usage);

          if (typeof content !== "string") {
            throw errorFactory();
          }

          return { content, usage };
        } catch (error) {
          if (error instanceof ApiError) {
            throw error;
          }

          if (attempt >= attemptCount) {
            throw errorFactory(error);
          }
        } finally {
          clearTimeout(timeout);
        }
      }

      throw errorFactory();
    },

    async *completeStream(input) {
      let response: Response | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages: input.messages,
              temperature: input.temperature ?? 0.2,
              ...requestBodyExtras,
              stream: true,
              stream_options: {
                include_usage: true
              }
            }),
            signal: controller.signal
          });

          if (!response.ok || !response.body) {
            const errorBody = await response.text().catch(() => "Could not read error body");
            console.error(`Model provider error (${response.status}):`, errorBody);
            if (attempt < attemptCount) {
              clearTimeout(timeout);
              timeout = undefined;
              continue;
            }
            throw errorFactory();
          }

          break;
        } catch (error) {
          clearTimeout(timeout);
          timeout = undefined;

          if (error instanceof ApiError) {
            throw error;
          }

          if (attempt >= attemptCount) {
            throw errorFactory(error);
          }
        }
      }

      if (!response?.body) {
        throw errorFactory();
      }

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let latestUsage: OpenAiUsageShape | undefined;

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
                usage?: OpenAiUsageShape;
                choices?: Array<{ delta?: { content?: unknown } }>;
              };

              if (payload.usage) {
                latestUsage = payload.usage;
              }

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

        const usage = toModelUsageFromOpenAi(model, latestUsage);
        if (usage) {
          input.onUsage?.(usage);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw errorFactory(error);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
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
    maxAttempts: 3,
    requestBodyExtras: {
      reasoning: {
        effort: options.reasoningEffort ?? env.OPENROUTER_REASONING_EFFORT,
        exclude: true
      }
    },
    errorFactory: () => new ApiError(503, "OPENROUTER_UNAVAILABLE", "OpenRouter provider is unavailable. Check your API key and try again.")
  });
}
