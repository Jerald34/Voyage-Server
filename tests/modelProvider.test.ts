import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { createLmStudioModelProvider } from "../src/services/modelProvider";

describe("LM Studio model provider", () => {
  it("posts chat completions with defaults and parses the first choice content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Here is the itinerary." } }]
        }),
        { status: 200 }
      );
    };
    const provider = createLmStudioModelProvider({
      baseUrl: "http://localhost:1234/v1/",
      model: "local-test",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Build a Cebu itinerary." }]
    });

    expect(result).toEqual({ content: "Here is the itinerary." });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:1234/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "local-test",
      messages: [{ role: "user", content: "Build a Cebu itinerary." }],
      temperature: 0.2
    });
  });

  it("maps failed fetches and non-ok responses to LOCAL_MODEL_UNAVAILABLE", async () => {
    const failingProvider = createLmStudioModelProvider({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      }
    });
    const nonOkProvider = createLmStudioModelProvider({
      fetchImpl: async () => new Response("server down", { status: 500 })
    });

    await expect(failingProvider.complete({ messages: [] })).rejects.toMatchObject({
      statusCode: 503,
      code: "LOCAL_MODEL_UNAVAILABLE",
      message: "Local model provider is unavailable. Start LM Studio and try again."
    } satisfies Partial<ApiError>);
    await expect(nonOkProvider.complete({ messages: [] })).rejects.toMatchObject({
      statusCode: 503,
      code: "LOCAL_MODEL_UNAVAILABLE",
      message: "Local model provider is unavailable. Start LM Studio and try again."
    } satisfies Partial<ApiError>);
  });

  it("streams chat completion deltas when stream=true is enabled", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });

    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(stream, { status: 200 });
    };

    const provider = createLmStudioModelProvider({
      baseUrl: "http://localhost:1234/v1/",
      model: "local-test",
      fetchImpl
    });

    const chunks: string[] = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: "local-test",
      stream: true
    });
  });
});
