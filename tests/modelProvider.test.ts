import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  createGoogleVertexModelProvider,
  createLmStudioModelProvider,
  createOpenRouterModelProvider,
  getModelProviderInfo
} from "../src/services/modelProvider";

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

describe("Google Vertex AI model provider", () => {
  const originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const originalAppData = process.env.APPDATA;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:/does-not-exist";
    process.env.APPDATA = "";
    process.env.USERPROFILE = "";
  });

  afterAll(() => {
    if (originalCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials;
    }
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("posts generateContent requests with the Google Cloud API key and maps the response text", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Here is the itinerary." }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 500,
            totalTokenCount: 1500
          }
        }),
        { status: 200 }
      );
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [
        { role: "system", content: "You are Voyage." },
        { role: "user", content: "Build a Cebu itinerary." },
        { role: "assistant", content: "Understood." }
      ],
      temperature: 0.4
    });

    expect(result).toMatchObject({
      content: "Here is the itinerary.",
      usage: {
        model: "gemini-3-flash-preview",
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        totalTokenCount: 1500,
        estimatedCostUsd: {
          prompt: 0.0005,
          output: 0.0015,
          total: 0.002
        }
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:generateContent?key=test-cloud-key"
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      contents: [
        { role: "user", parts: [{ text: "Build a Cebu itinerary." }] },
        { role: "model", parts: [{ text: "Understood." }] }
      ],
      systemInstruction: {
        parts: [{ text: "You are Voyage." }]
      },
      generationConfig: {
        temperature: 0.4
      }
    });
  });

  it("streams generateContent deltas from SSE frames", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":1000,"candidatesTokenCount":500,"totalTokenCount":1500}}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });

    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(stream, { status: 200 });
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const chunks: string[] = [];
    const usages: Array<unknown> = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }],
      onUsage: (usage) => {
        usages.push(usage);
      }
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(usages).toEqual([
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        totalTokenCount: 1500
      })
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Stream this." }] }],
      generationConfig: {
        temperature: 0.2
      }
    });
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("stream");
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty("stream_options");
  });

  it("falls back to non-stream generateContent when Vertex blocks API-key streaming", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes(":streamGenerateContent")) {
        return new Response(
          JSON.stringify([
            {
              error: {
                code: 403,
                message: "Requests to this API aiplatform.googleapis.com method google.cloud.aiplatform.v1beta1.PredictionService.StreamGenerateContent are blocked.",
                status: "PERMISSION_DENIED",
                details: [
                  {
                    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                    reason: "API_KEY_SERVICE_BLOCKED",
                    domain: "googleapis.com",
                    metadata: {
                      service: "aiplatform.googleapis.com",
                      methodName: "google.cloud.aiplatform.v1beta1.PredictionService.StreamGenerateContent",
                      consumer: "projects/123",
                      apiName: "aiplatform.googleapis.com"
                    }
                  }
                ]
              }
            }
          ]),
          {
            status: 403,
            headers: {
              "content-type": "application/json; charset=UTF-8"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "fallback ok" }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 1,
            totalTokenCount: 8
          }
        }),
        { status: 200 }
      );
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const chunks: string[] = [];
    const usages: Array<unknown> = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }],
      onUsage: (usage) => usages.push(usage)
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["fallback ok"]);
    expect(usages).toEqual([
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        promptTokenCount: 7,
        candidatesTokenCount: 1,
        totalTokenCount: 8
      })
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:streamGenerateContent?key=test-cloud-key",
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:generateContent?key=test-cloud-key"
    ]);
  });

  it("parses JSON stream responses when Vertex returns application/json", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify([
          {
            candidates: [
              {
                content: {
                  parts: [{ text: "json stream ok" }]
                }
              }
            ],
            usageMetadata: {
              trafficType: "ON_DEMAND"
            },
            modelVersion: "gemini-3-flash-preview",
            createTime: "2026-05-12T18:30:16.747264Z",
            responseId: "first"
          },
          {
            candidates: [
              {
                content: {
                  parts: [{ text: "" }]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 9,
              candidatesTokenCount: 2,
              totalTokenCount: 11,
              thoughtsTokenCount: 0
            },
            modelVersion: "gemini-3-flash-preview",
            createTime: "2026-05-12T18:30:16.747264Z",
            responseId: "second"
          }
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=UTF-8"
          }
        }
      );
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const chunks: string[] = [];
    const usages: Array<unknown> = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }],
      onUsage: (usage) => usages.push(usage)
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["json stream ok"]);
    expect(usages).toEqual([
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        promptTokenCount: 9,
        candidatesTokenCount: 2,
        totalTokenCount: 11
      })
    ]);
    expect(calls).toHaveLength(1);
  });

  it("yields Vertex JSON stream chunks before the body closes", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
        nextController.enqueue(
          encoder.encode(
            '[{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":1}},'
          )
        );
      }
    });

    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8"
        }
      });
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      fetchImpl
    });

    const iterator = provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }],
      onUsage: () => undefined
    })[Symbol.asyncIterator]();

    const firstChunk = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Vertex stream did not yield early")), 50))
    ]);

    expect(firstChunk).toEqual({
      value: "Hello",
      done: false
    });

    controller?.enqueue(
      encoder.encode(
        '{"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}]'
      )
    );
    controller?.close();

    const secondChunk = await iterator.next();
    expect(secondChunk).toEqual({
      value: " world",
      done: false
    });

    const finalChunk = await iterator.next();
    expect(finalChunk).toEqual({
      value: undefined,
      done: true
    });
    expect(calls).toHaveLength(1);
  });

  it("uses ADC bearer auth when no API key is supplied", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "ADC response." }]
              }
            }
          ]
        }),
        { status: 200 }
      );
    };

    const provider = createGoogleVertexModelProvider({
      auth: {
        getAccessToken: async () => "adc-token",
        getProjectId: async () => "adc-project"
      } as never,
      projectId: "",
      model: "gemini-3-flash-preview",
      location: "global",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Use ADC." }]
    });

    expect(result.content).toBe("ADC response.");
    expect(result.usage).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/adc-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent"
    );
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer adc-token"
    });
  });

  it("does not attempt explicit cachedContent creation in API-key express mode", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "cached response." }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 16194,
            candidatesTokenCount: 3,
            totalTokenCount: 16197
          }
        }),
        { status: 200 }
      );
    };

    const provider = createGoogleVertexModelProvider({
      apiKey: "test-cloud-key",
      model: "gemini-3-flash-preview",
      projectId: "test-project",
      fetchImpl
    });

    const longSystemPrompt = "Voyage system instructions that are intentionally long enough to be cacheable. ".repeat(250);
    const result = await provider.complete({
      messages: [
        {
          role: "system" as const,
          content: longSystemPrompt
        },
        {
          role: "user" as const,
          content: "Build a Cebu itinerary."
        }
      ]
    });

    expect(result.content).toBe("cached response.");
    expect(calls.map((call) => call.url)).toEqual([
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:generateContent?key=test-cloud-key"
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [{ text: "Build a Cebu itinerary." }]
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: longSystemPrompt
          }
        ]
      }
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Vertex Cache] disabled: explicit cachedContent creation requires ADC/OAuth standard Vertex")
    );

    warnSpy.mockRestore();
  });

  it("creates and reuses an explicit cachedContent block for a large stable system prefix with ADC auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      if (String(url).includes(":countTokens")) {
        return new Response(
          JSON.stringify({
            totalTokens: 4096,
            totalBillableCharacters: 8192,
            promptTokensDetails: [{ modality: "TEXT", tokenCount: 4096 }]
          }),
          { status: 200 }
        );
      }

      if (String(url).includes("/cachedContents")) {
        return new Response(
          JSON.stringify({
            name: "projects/test-project/locations/global/cachedContents/abc123"
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "cached response." }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 3,
            totalTokenCount: 15,
            cachedContentTokenCount: 4096
          }
        }),
        { status: 200 }
      );
    };

    const provider = createGoogleVertexModelProvider({
      auth: {
        getAccessToken: async () => "adc-token",
        getProjectId: async () => "test-project"
      } as never,
      model: "gemini-3-flash-preview",
      projectId: "",
      location: "global",
      fetchImpl
    });

    const longSystemPrompt = "Voyage system instructions that are intentionally long enough to be cacheable. ".repeat(250);
    const input = {
      messages: [
        {
          role: "system" as const,
          content: longSystemPrompt
        },
        {
          role: "user" as const,
          content: "Build a Cebu itinerary."
        }
      ]
    };

    const first = await provider.complete(input);
    const second = await provider.complete(input);

    expect(first.content).toBe("cached response.");
    expect(second.content).toBe("cached response.");
    expect(calls.map((call) => call.url)).toEqual([
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview:countTokens",
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/cachedContents",
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent",
      "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent"
    ]);
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer adc-token" });
    expect(calls[1].init.headers).toMatchObject({ Authorization: "Bearer adc-token" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview",
      systemInstruction: {
        parts: [
          {
            text: longSystemPrompt
          }
        ]
      }
    });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      model: "projects/test-project/locations/global/publishers/google/models/gemini-3-flash-preview",
      systemInstruction: {
        parts: [
          {
            text: longSystemPrompt
          }
        ]
      }
    });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      contents: [
        {
          role: "user",
          parts: [{ text: "Build a Cebu itinerary." }]
        }
      ],
      cachedContent: "projects/test-project/locations/global/cachedContents/abc123",
      generationConfig: {
        temperature: 0.2
      }
    });
  });
});

describe("model provider info", () => {
  it("describes the selected provider and model", () => {
    const info = getModelProviderInfo();

    expect(info).toMatchObject({
      provider: expect.any(String),
      model: expect.any(String)
    });
  });
});

describe("OpenRouter model provider", () => {
  it("enables reasoning while excluding reasoning tokens from the response", async () => {
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
    const provider = createOpenRouterModelProvider({
      apiKey: "test-openrouter-key",
      model: "openai/gpt-5.2",
      reasoningEffort: "high",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Build an Olongapo itinerary." }]
    });

    expect(result).toEqual({ content: "Here is the itinerary." });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-openrouter-key"
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "openai/gpt-5.2",
      messages: [{ role: "user", content: "Build an Olongapo itinerary." }],
      temperature: 0.2,
      reasoning: {
        effort: "high",
        exclude: true
      }
    });
  });

  it("does not stream OpenRouter reasoning deltas to the user", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning":"private thinking"}}]}\n\ndata: {"choices":[{"delta":{"content":"Visible"}}]}\n\ndata: {"choices":[{"delta":{"content":" answer"}}]}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });

    const provider = createOpenRouterModelProvider({
      apiKey: "test-openrouter-key",
      model: "openai/gpt-5.2",
      fetchImpl: async () => new Response(stream, { status: 200 })
    });

    const chunks: string[] = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream this." }]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Visible", " answer"]);
  });

  it("retries transient OpenRouter completion failures up to 3 total attempts", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      if (calls.length < 3) {
        return new Response("provider busy", { status: 503 });
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Recovered itinerary." } }]
        }),
        { status: 200 }
      );
    };

    const provider = createOpenRouterModelProvider({
      apiKey: "test-openrouter-key",
      model: "openai/gpt-5.2",
      fetchImpl
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Try until OpenRouter responds." }]
    });

    expect(result).toEqual({ content: "Recovered itinerary." });
    expect(calls).toHaveLength(3);
  });

  it("retries transient OpenRouter stream startup failures up to 3 total attempts", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const encoder = new TextEncoder();

    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      if (calls.length < 3) {
        throw new Error("provider capacity reached");
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Recovered stream"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      );
    };

    const provider = createOpenRouterModelProvider({
      apiKey: "test-openrouter-key",
      model: "openai/gpt-5.2",
      fetchImpl
    });

    const chunks: string[] = [];
    for await (const chunk of provider.completeStream!({
      messages: [{ role: "user", content: "Stream after retries." }]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Recovered stream"]);
    expect(calls).toHaveLength(3);
  });
});
