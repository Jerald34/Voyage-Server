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
    },

    async *completeStream(input) {
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
            temperature: input.temperature ?? 0.2,
            stream: true
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          throw unavailableModelError();
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
        throw unavailableModelError();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export const lmStudioModelProvider = createLmStudioModelProvider();
