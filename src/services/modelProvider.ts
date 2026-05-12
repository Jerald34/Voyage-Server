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
  maxAttempts?: number;
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
              stream: true
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

type GoogleModelProviderOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_GOOGLE_AI_MODEL = "gemini-3-flash-preview";

type VertexAiModelProviderOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function encodeGoogleModel(model: string) {
  return encodeURIComponent(model);
}

function normalizeModelMessages(messages: ModelMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content).filter(Boolean);
  const conversationMessages = messages.filter((message) => message.role !== "system");

  const contents = conversationMessages.map((message) => ({
    role: message.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: message.content }]
  }));

  const systemInstruction =
    systemMessages.length > 0
      ? {
          parts: [
            {
              text: systemMessages.join("\n\n")
            }
          ]
        }
      : undefined;

  return { contents, systemInstruction };
}

function extractVertexText(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") {
    return "";
  }

  const candidates = (responseBody as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const firstCandidate = candidates[0];
  if (!firstCandidate || typeof firstCandidate !== "object") {
    return "";
  }

  const content = (firstCandidate as { content?: unknown }).content;
  if (!content || typeof content !== "object") {
    return "";
  }

  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : undefined))
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("");
}

function buildVertexEndpoint(model: string, apiKey: string, stream = false) {
  const method = stream ? "streamGenerateContent" : "generateContent";
  return `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeGoogleModel(model)}:${method}?key=${encodeURIComponent(apiKey)}`;
}

export function createGoogleVertexModelProvider(options: VertexAiModelProviderOptions = {}): ModelProvider {
  const model = options.model ?? env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL;
  const apiKey = (options.apiKey ?? env.GOOGLE_CLOUD_API_KEY).trim();
  const timeoutMs = options.timeoutMs ?? 120000;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Configure a Google Cloud API key.");
  }

  return {
    async complete(input) {
      const { contents, systemInstruction } = normalizeModelMessages(input.messages);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(buildVertexEndpoint(model, apiKey), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents,
            ...(systemInstruction ? { systemInstruction } : {}),
            generationConfig: {
              temperature: input.temperature ?? 0.2
            }
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "Could not read error body");
          console.error(`Vertex AI provider error (${response.status}):`, errorBody);
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
        }

        const body = (await response.json()) as unknown;
        const content = extractVertexText(body);

        if (!content) {
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider returned an empty response.");
        }

        return { content };
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
      } finally {
        clearTimeout(timeout);
      }
    },

    async *completeStream(input) {
      const { contents, systemInstruction } = normalizeModelMessages(input.messages);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(buildVertexEndpoint(model, apiKey, true), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents,
            ...(systemInstruction ? { systemInstruction } : {}),
            generationConfig: {
              temperature: input.temperature ?? 0.2
            }
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          const errorBody = await response.text().catch(() => "Could not read error body");
          console.error(`Vertex AI provider error (${response.status}):`, errorBody);
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
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
            if (!payloadText || payloadText === "[DONE]") {
              continue;
            }

            try {
              const payload = JSON.parse(payloadText) as unknown;
              const chunk = extractVertexText(payload);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // Ignore malformed or partial stream frames.
            }
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function createGoogleModelProvider(options: GoogleModelProviderOptions = {}): ModelProvider {
  if (options.apiKey || env.GOOGLE_CLOUD_API_KEY) {
    return createGoogleVertexModelProvider(options);
  }

  return createOpenAiCompatibleProvider({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: options.model ?? (env.GOOGLE_AI_MODEL || DEFAULT_GOOGLE_AI_MODEL),
    apiKey: env.GOOGLE_AI_API_KEY,
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

export const lmStudioModelProvider = createLmStudioModelProvider();
export const googleModelProvider = createGoogleModelProvider();
export const openRouterModelProvider = createOpenRouterModelProvider();

export function getModelProvider(): ModelProvider {
  if (env.OPENROUTER_API_KEY) {
    return openRouterModelProvider;
  }
  if (env.GOOGLE_CLOUD_API_KEY) {
    return createGoogleVertexModelProvider();
  }
  if (env.GOOGLE_AI_API_KEY) {
    return googleModelProvider;
  }
  return lmStudioModelProvider;
}
