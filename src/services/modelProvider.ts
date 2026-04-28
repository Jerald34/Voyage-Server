import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelProvider = {
  complete(input: { messages: ModelMessage[]; temperature?: number }): Promise<{ content: string }>;
};

type LmStudioModelProviderOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const LOCAL_MODEL_UNAVAILABLE = new ApiError(
  503,
  "LOCAL_MODEL_UNAVAILABLE",
  "Local model provider is unavailable. Start LM Studio and try again."
);

function unavailableModelError() {
  return new ApiError(LOCAL_MODEL_UNAVAILABLE.statusCode, LOCAL_MODEL_UNAVAILABLE.code, LOCAL_MODEL_UNAVAILABLE.message);
}

export function createLmStudioModelProvider(options: LmStudioModelProviderOptions = {}): ModelProvider {
  const baseUrl = (options.baseUrl ?? env.LM_STUDIO_BASE_URL).replace(/\/+$/, "");
  const model = options.model ?? env.LM_STUDIO_MODEL;
  const timeoutMs = options.timeoutMs ?? env.LM_STUDIO_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw unavailableModelError();
        }

        const body = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = body.choices?.[0]?.message?.content;

        if (typeof content !== "string") {
          throw unavailableModelError();
        }

        return { content };
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        throw unavailableModelError();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export const lmStudioModelProvider = createLmStudioModelProvider();
