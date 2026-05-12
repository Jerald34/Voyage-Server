import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../config/env";
import { ApiError } from "../http/errors";
import { GoogleAuth } from "google-auth-library";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelUsage = {
  model: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
  trafficType?: string;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  cacheTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  estimatedCostUsd?: {
    prompt: number;
    output: number;
    total: number;
  };
};

type ModelCompletionInput = {
  messages: ModelMessage[];
  temperature?: number;
};

type ModelStreamInput = ModelCompletionInput & {
  onUsage?: (usage: ModelUsage) => void;
};

export type ModelProvider = {
  complete(input: ModelCompletionInput): Promise<{ content: string; usage?: ModelUsage }>;
  completeStream?(input: ModelStreamInput): AsyncIterable<string>;
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

type VertexUsageShape = {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
  cachedContentTokenCount?: unknown;
  toolUsePromptTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  trafficType?: unknown;
  promptTokensDetails?: unknown;
  cacheTokensDetails?: unknown;
  candidatesTokensDetails?: unknown;
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
    .filter((item): item is { modality?: string; tokenCount?: number } => Boolean(item));

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

function toModelUsageFromVertex(model: string, usage: VertexUsageShape | undefined) {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const promptTokenCount = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : undefined;
  const candidatesTokenCount = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : undefined;
  const totalTokenCount = typeof usage.totalTokenCount === "number" ? usage.totalTokenCount : undefined;
  const cachedContentTokenCount = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : undefined;
  const toolUsePromptTokenCount = typeof usage.toolUsePromptTokenCount === "number" ? usage.toolUsePromptTokenCount : undefined;
  const thoughtsTokenCount = typeof usage.thoughtsTokenCount === "number" ? usage.thoughtsTokenCount : undefined;
  const trafficType = typeof usage.trafficType === "string" ? usage.trafficType : undefined;
  const promptTokensDetails = normalizeTokenDetails(usage.promptTokensDetails);
  const cacheTokensDetails = normalizeTokenDetails(usage.cacheTokensDetails);
  const candidatesTokensDetails = normalizeTokenDetails(usage.candidatesTokensDetails);

  if (
    promptTokenCount === undefined &&
    candidatesTokenCount === undefined &&
    totalTokenCount === undefined &&
    cachedContentTokenCount === undefined &&
    toolUsePromptTokenCount === undefined &&
    thoughtsTokenCount === undefined &&
    trafficType === undefined &&
    !promptTokensDetails &&
    !cacheTokensDetails &&
    !candidatesTokensDetails
  ) {
    return undefined;
  }

  return {
    model,
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
    cachedContentTokenCount,
    toolUsePromptTokenCount,
    thoughtsTokenCount,
    trafficType,
    promptTokensDetails,
    cacheTokensDetails,
    candidatesTokensDetails
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

type GoogleModelProviderOptions = {
  apiKey?: string;
  model?: string;
  projectId?: string;
  location?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_GOOGLE_AI_MODEL = "gemini-3-flash-preview";
const GOOGLE_VERTEX_MODEL_PRICING: Record<
  string,
  {
    inputPerMillionTokens: number;
    outputPerMillionTokens: number;
  }
> = {
  "gemini-3-flash-preview": {
    inputPerMillionTokens: 0.5,
    outputPerMillionTokens: 3
  },
  "gemini-3-pro-preview": {
    inputPerMillionTokens: 2,
    outputPerMillionTokens: 12
  }
};

type VertexAiModelProviderOptions = {
  apiKey?: string;
  model?: string;
  projectId?: string;
  location?: string;
  auth?: GoogleAuth;
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
  if (Array.isArray(responseBody)) {
    return responseBody.map((entry) => extractVertexText(entry)).filter((text) => text.length > 0).join("");
  }

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

function extractNextVertexJsonPayload(
  buffer: string,
  mode: "array" | "object" | undefined
): { payloadText: string; remainder: string; mode: "array" | "object" } | null {
  let index = 0;
  while (index < buffer.length && /[\s,]/.test(buffer[index] ?? "")) {
    index += 1;
  }

  if (index >= buffer.length) {
    return null;
  }

  let nextMode = mode;
  if (!nextMode) {
    if (buffer[index] === "[") {
      nextMode = "array";
      index += 1;
      while (index < buffer.length && /[\s,]/.test(buffer[index] ?? "")) {
        index += 1;
      }
    } else if (buffer[index] === "{") {
      nextMode = "object";
    } else {
      return null;
    }
  } else if (nextMode === "array" && buffer[index] === "[") {
    index += 1;
    while (index < buffer.length && /[\s,]/.test(buffer[index] ?? "")) {
      index += 1;
    }
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let payloadStart = -1;

  for (let i = index; i < buffer.length; i += 1) {
    const char = buffer[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0 && payloadStart < 0) {
        payloadStart = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      if (depth > 0) {
        depth -= 1;
      }

      if (depth === 0 && payloadStart >= 0) {
        return {
          payloadText: buffer.slice(payloadStart, i + 1),
          remainder: buffer.slice(i + 1),
          mode: nextMode ?? "object"
        };
      }
    }
  }

  return null;
}

function extractVertexUsage(responseBody: unknown) {
  if (Array.isArray(responseBody)) {
    const merged = responseBody
      .map((entry) => extractVertexUsage(entry))
      .filter((usage): usage is NonNullable<ReturnType<typeof extractVertexUsage>> => Boolean(usage))
      .reduce<NonNullable<ReturnType<typeof extractVertexUsage>> | undefined>((acc, usage) => {
        if (!acc) {
          return { ...usage };
        }
        return {
          promptTokenCount: acc.promptTokenCount ?? usage.promptTokenCount,
          candidatesTokenCount: acc.candidatesTokenCount ?? usage.candidatesTokenCount,
          totalTokenCount: acc.totalTokenCount ?? usage.totalTokenCount,
          cachedContentTokenCount: acc.cachedContentTokenCount ?? usage.cachedContentTokenCount,
          toolUsePromptTokenCount: acc.toolUsePromptTokenCount ?? usage.toolUsePromptTokenCount,
          thoughtsTokenCount: acc.thoughtsTokenCount ?? usage.thoughtsTokenCount,
          trafficType: acc.trafficType ?? usage.trafficType,
          promptTokensDetails: acc.promptTokensDetails ?? usage.promptTokensDetails,
          cacheTokensDetails: acc.cacheTokensDetails ?? usage.cacheTokensDetails,
          candidatesTokensDetails: acc.candidatesTokensDetails ?? usage.candidatesTokensDetails
        };
      }, undefined);

    return merged;
  }

  if (!responseBody || typeof responseBody !== "object") {
    return undefined;
  }

  const usageMetadata = (responseBody as { usageMetadata?: unknown }).usageMetadata;
  if (!usageMetadata || typeof usageMetadata !== "object") {
    return undefined;
  }

  const promptTokenCount = (usageMetadata as VertexUsageShape).promptTokenCount;
  const candidatesTokenCount = (usageMetadata as VertexUsageShape).candidatesTokenCount;
  const totalTokenCount = (usageMetadata as VertexUsageShape).totalTokenCount;
  const cachedContentTokenCount = (usageMetadata as VertexUsageShape).cachedContentTokenCount;
  const toolUsePromptTokenCount = (usageMetadata as VertexUsageShape).toolUsePromptTokenCount;
  const thoughtsTokenCount = (usageMetadata as VertexUsageShape).thoughtsTokenCount;
  const trafficType = (usageMetadata as VertexUsageShape).trafficType;
  const promptTokensDetails = (usageMetadata as VertexUsageShape).promptTokensDetails;
  const cacheTokensDetails = (usageMetadata as VertexUsageShape).cacheTokensDetails;
  const candidatesTokensDetails = (usageMetadata as VertexUsageShape).candidatesTokensDetails;

  return {
    promptTokenCount: typeof promptTokenCount === "number" ? promptTokenCount : undefined,
    candidatesTokenCount: typeof candidatesTokenCount === "number" ? candidatesTokenCount : undefined,
    totalTokenCount: typeof totalTokenCount === "number" ? totalTokenCount : undefined,
    cachedContentTokenCount: typeof cachedContentTokenCount === "number" ? cachedContentTokenCount : undefined,
    toolUsePromptTokenCount: typeof toolUsePromptTokenCount === "number" ? toolUsePromptTokenCount : undefined,
    thoughtsTokenCount: typeof thoughtsTokenCount === "number" ? thoughtsTokenCount : undefined,
    trafficType: typeof trafficType === "string" ? trafficType : undefined,
    promptTokensDetails: normalizeTokenDetails(promptTokensDetails),
    cacheTokensDetails: normalizeTokenDetails(cacheTokensDetails),
    candidatesTokensDetails: normalizeTokenDetails(candidatesTokensDetails)
  };
}

function hasLocalAdcCredentials() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json"),
    join(process.env.USERPROFILE ?? "", ".config", "gcloud", "application_default_credentials.json")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return candidates.some((filePath) => existsSync(filePath));
}

function estimateVertexCost(model: string, usage: ReturnType<typeof extractVertexUsage>) {
  if (!usage) {
    return undefined;
  }

  const pricing = GOOGLE_VERTEX_MODEL_PRICING[model];
  if (!pricing || typeof usage.promptTokenCount !== "number" || typeof usage.candidatesTokenCount !== "number") {
    return undefined;
  }

  const promptCost = (usage.promptTokenCount / 1_000_000) * pricing.inputPerMillionTokens;
  const outputCost = (usage.candidatesTokenCount / 1_000_000) * pricing.outputPerMillionTokens;

  return {
    promptCost,
    outputCost,
    totalCost: promptCost + outputCost
  };
}

function toModelUsage(model: string, usage: ReturnType<typeof extractVertexUsage>) {
  if (!usage) {
    return undefined;
  }

  const estimatedCostUsd = estimateVertexCost(model, usage);
  return {
    model,
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount,
    toolUsePromptTokenCount: usage.toolUsePromptTokenCount,
    thoughtsTokenCount: usage.thoughtsTokenCount,
    trafficType: usage.trafficType,
    promptTokensDetails: usage.promptTokensDetails,
    cacheTokensDetails: usage.cacheTokensDetails,
    candidatesTokensDetails: usage.candidatesTokensDetails,
    estimatedCostUsd: estimatedCostUsd
      ? {
          prompt: estimatedCostUsd.promptCost,
          output: estimatedCostUsd.outputCost,
          total: estimatedCostUsd.totalCost
        }
      : undefined
  };
}

function buildVertexEndpoint(model: string, projectId: string, location: string, stream = false) {
  const method = stream ? "streamGenerateContent" : "generateContent";
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeGoogleModel(model)}:${method}`;
}

function buildExpressVertexEndpoint(model: string, apiKey: string, stream = false) {
  const method = stream ? "streamGenerateContent" : "generateContent";
  return `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeGoogleModel(model)}:${method}?key=${encodeURIComponent(apiKey)}`;
}

export function createGoogleVertexModelProvider(options: VertexAiModelProviderOptions = {}): ModelProvider {
  const model = options.model ?? env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL;
  const hasAdc = hasLocalAdcCredentials() || Boolean(options.auth);
  const apiKey = hasAdc ? "" : (options.apiKey ?? env.GOOGLE_CLOUD_API_KEY).trim();
  const projectId = (options.projectId ?? env.GOOGLE_CLOUD_PROJECT).trim();
  const location = (options.location ?? env.GOOGLE_CLOUD_LOCATION).trim() || "global";
  const timeoutMs = options.timeoutMs ?? 120000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = options.auth ?? new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  if (!apiKey && !hasLocalAdcCredentials() && !options.auth) {
    throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Configure a Google Cloud API key.");
  }

  async function fetchVertexCompletion(input: ModelCompletionInput) {
    const { contents, systemInstruction } = normalizeModelMessages(input.messages);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      let requestUrl: string;
      if (!apiKey) {
        const accessToken = await auth.getAccessToken();
        if (!accessToken) {
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. No ADC access token could be resolved.");
        }
        headers.Authorization = `Bearer ${accessToken}`;
        const effectiveProjectId = projectId || (await auth.getProjectId()) || "";
        if (!effectiveProjectId) {
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Configure GOOGLE_CLOUD_PROJECT or ADC project metadata.");
        }
        requestUrl = buildVertexEndpoint(model, effectiveProjectId, location);
      } else {
        requestUrl = buildExpressVertexEndpoint(model, apiKey);
      }

      const response = await fetchImpl(requestUrl, {
        method: "POST",
        headers,
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
      const usage = toModelUsage(model, extractVertexUsage(body));

      if (!content) {
        throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider returned an empty response.");
      }

      return { content, usage };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async complete(input) {
      return fetchVertexCompletion(input);
    },

    async *completeStream(input) {
      const { contents, systemInstruction } = normalizeModelMessages(input.messages);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };
        let requestUrl: string;
        if (!apiKey) {
          const accessToken = await auth.getAccessToken();
          if (!accessToken) {
            throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. No ADC access token could be resolved.");
          }
          headers.Authorization = `Bearer ${accessToken}`;
          const effectiveProjectId = projectId || (await auth.getProjectId()) || "";
          if (!effectiveProjectId) {
            throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Configure GOOGLE_CLOUD_PROJECT or ADC project metadata.");
          }
          requestUrl = buildVertexEndpoint(model, effectiveProjectId, location, true);
        } else {
          requestUrl = buildExpressVertexEndpoint(model, apiKey, true);
        }

        const response = await fetchImpl(requestUrl, {
          method: "POST",
          headers,
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
          if (
            apiKey &&
            errorBody.includes("API_KEY_SERVICE_BLOCKED") &&
            errorBody.includes("StreamGenerateContent")
          ) {
            const completion = await fetchVertexCompletion(input);
            if (completion.content) {
              yield completion.content;
            }
            if (completion.usage) {
              input.onUsage?.(completion.usage);
            }
            return;
          }
          throw new ApiError(503, "GOOGLE_VERTEX_UNAVAILABLE", "Google Vertex AI provider is unavailable. Check your Google Cloud API key and try again.");
        }

        const contentType = response.headers.get("content-type") ?? "";
        let latestUsage: ReturnType<typeof extractVertexUsage>;

        if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let mode: "array" | "object" | undefined;

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            while (true) {
              const extracted = extractNextVertexJsonPayload(buffer, mode);
              if (!extracted) {
                break;
              }

              mode = extracted.mode;
              buffer = extracted.remainder;

              try {
                const payload = JSON.parse(extracted.payloadText) as unknown;
                const chunkUsage = extractVertexUsage(payload);
                if (chunkUsage) {
                  latestUsage = chunkUsage;
                }
                const chunk = extractVertexText(payload);
                if (chunk) {
                  yield chunk;
                }
              } catch {
                // Ignore malformed chunks and continue consuming the stream.
              }
            }
          }

          while (true) {
            const extracted = extractNextVertexJsonPayload(buffer, mode);
            if (!extracted) {
              break;
            }

            mode = extracted.mode;
            buffer = extracted.remainder;

            try {
              const payload = JSON.parse(extracted.payloadText) as unknown;
              const chunkUsage = extractVertexUsage(payload);
              if (chunkUsage) {
                latestUsage = chunkUsage;
              }
              const chunk = extractVertexText(payload);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // Ignore malformed chunks and continue consuming the stream.
            }
          }

          const usage = toModelUsage(model, latestUsage);
          if (usage) {
            input.onUsage?.(usage);
          }
          return;
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
              const chunkUsage = extractVertexUsage(payload);
              if (chunkUsage) {
                latestUsage = chunkUsage;
              }
              const chunk = extractVertexText(payload);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // Ignore malformed or partial stream frames.
            }
          }
        }

        const usage = toModelUsage(model, latestUsage);
        if (usage) {
          input.onUsage?.(usage);
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
  if (options.apiKey || env.GOOGLE_CLOUD_API_KEY || hasLocalAdcCredentials() || options.auth) {
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

export type ModelProviderInfo = {
  provider: "vertex" | "openrouter" | "google_ai" | "lm_studio";
  model: string;
};

function resolveModelProviderSelection() {
  const selected = env.MODEL_PROVIDER;

  if (selected === "vertex") {
    return {
      provider: "vertex" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => createGoogleVertexModelProvider()
    };
  }

  if (selected === "openrouter") {
    return {
      provider: "openrouter" as const,
      model: env.OPENROUTER_MODEL,
      create: () => openRouterModelProvider
    };
  }

  if (selected === "google_ai" || selected === "gemini") {
    return {
      provider: "google_ai" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => googleModelProvider
    };
  }

  if (selected === "lm_studio") {
    return {
      provider: "lm_studio" as const,
      model: env.LM_STUDIO_MODEL,
      create: () => lmStudioModelProvider
    };
  }

  if (env.GOOGLE_CLOUD_API_KEY || hasLocalAdcCredentials()) {
    return {
      provider: "vertex" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => createGoogleVertexModelProvider()
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter" as const,
      model: env.OPENROUTER_MODEL,
      create: () => openRouterModelProvider
    };
  }

  if (env.GOOGLE_AI_API_KEY) {
    return {
      provider: "google_ai" as const,
      model: env.GOOGLE_AI_MODEL ?? DEFAULT_GOOGLE_AI_MODEL,
      create: () => googleModelProvider
    };
  }

  return {
    provider: "lm_studio" as const,
    model: env.LM_STUDIO_MODEL,
    create: () => lmStudioModelProvider
  };
}

export function getModelProviderInfo(): ModelProviderInfo {
  const selection = resolveModelProviderSelection();
  return {
    provider: selection.provider,
    model: selection.model
  };
}

export function getModelProvider(): ModelProvider {
  return resolveModelProviderSelection().create();
}
