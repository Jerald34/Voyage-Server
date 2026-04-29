import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  createAgentOrchestrator,
  type AgentOrchestratorAgentService
} from "../src/modules/agent/agentOrchestrator";
import {
  createAgentToolRegistry,
  createCreateItineraryTool,
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createRecordAgentTaskTool,
  createSearchGooglePlacesTool,
  createWebSearchTool
} from "../src/modules/agent/agentTools";
import type { AgentRunRecord } from "../src/modules/agent/agentService";
import type { AgentEvent } from "../src/modules/agent/agentSchemas";
import type { ModelProvider } from "../src/services/modelProvider";

function createRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run-1",
    threadId: "thread-1",
    agencyId: "agency-1",
    triggerMessageId: null,
    status: "QUEUED",
    modelProvider: "fake",
    modelName: "fake-model",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides
  };
}

function createFakeAgentService(run = createRun()) {
  const events: AgentEvent[] = [];
  const toolCalls: Array<{
    id: string;
    runId: string;
    threadId: string;
    toolName: string;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    input: unknown;
    outputSummary: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }> = [];
  const tasks: Array<{
    id: string;
    runId: string;
    threadId: string;
    label: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const sources: Array<{
    id: string;
    runId: string;
    threadId: string;
    sourceType: "WEB" | "MAP_PLACE" | "MAP_ROUTE";
    title: string;
    url: string | null;
    snippet: string | null;
    provider: string;
    retrievedAt: Date;
    metadata: unknown;
    createdAt: Date;
  }> = [];
  const service: AgentOrchestratorAgentService = {
    async startRun(runId, startedAt) {
      if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
        throw new ApiError(409, "AGENT_RUN_ALREADY_FINISHED", "Agent run is already finished.");
      }
      run.status = "RUNNING";
      run.startedAt = startedAt;
      run.updatedAt = startedAt;
      return { ...run, id: runId };
    },
    async recordRunEvent(_run, event) {
      events.push(event);
      return {
        id: `event-${events.length}`,
        runId: run.id,
        threadId: run.threadId,
        type: event.type,
        payload: event.payload,
        createdAt: new Date("2026-04-28T00:00:00.000Z")
      };
    },
    async recordToolCallStarted(_run, input, startedAt) {
      const toolCall = {
        id: `tool-call-${toolCalls.length + 1}`,
        runId: run.id,
        threadId: run.threadId,
        toolName: input.toolName,
        status: "RUNNING" as const,
        input: input.input,
        outputSummary: null,
        errorCode: null,
        errorMessage: null,
        startedAt,
        completedAt: null
      };
      toolCalls.push(toolCall);
      return toolCall;
    },
    async completeToolCall(toolCallId, outputSummary, completedAt) {
      const toolCall = toolCalls.find((candidate) => candidate.id === toolCallId);
      if (!toolCall) {
        throw new Error("missing tool call");
      }
      toolCall.status = "COMPLETED";
      toolCall.outputSummary = outputSummary;
      toolCall.completedAt = completedAt;
      return toolCall;
    },
    async failToolCall(toolCallId, code, message, completedAt) {
      const toolCall = toolCalls.find((candidate) => candidate.id === toolCallId);
      if (!toolCall) {
        throw new Error("missing tool call");
      }
      toolCall.status = "FAILED";
      toolCall.errorCode = code;
      toolCall.errorMessage = message;
      toolCall.completedAt = completedAt;
      return toolCall;
    },
    async recordTask(_run, input) {
      const sortOrder =
        input.sortOrder ?? tasks.filter((task) => task.runId === run.id).reduce((max, task) => Math.max(max, task.sortOrder), 0) + 1;
      const task = {
        id: `task-${tasks.length + 1}`,
        runId: run.id,
        threadId: run.threadId,
        label: input.label,
        status: input.status,
        sortOrder,
        createdAt: new Date("2026-04-28T00:00:00.000Z"),
        updatedAt: new Date("2026-04-28T00:00:00.000Z")
      };
      tasks.push(task);
      events.push({
        type: "task.updated",
        payload: {
          label: task.label,
          status: task.status,
          sortOrder: task.sortOrder
        }
      });
      return task;
    },
    async recordSources(_run, input) {
      const created = input.map((source, index) => {
        const record = {
          id: `source-${sources.length + index + 1}`,
          runId: run.id,
          threadId: run.threadId,
          sourceType: source.sourceType,
          title: source.title,
          url: source.url ?? null,
          snippet: source.snippet ?? null,
          provider: source.provider,
          retrievedAt: source.retrievedAt,
          metadata: source.metadata,
          createdAt: new Date("2026-04-28T00:00:00.000Z")
        };
        sources.push(record);
        return record;
      });
      for (const source of created) {
        events.push({
          type: "source.added",
          payload: {
            sourceType: source.sourceType,
            title: source.title,
            url: source.url,
            snippet: source.snippet
          }
        });
      }
      return created;
    },
    async completeRun(runId, assistantContent) {
      run.status = "COMPLETED";
      run.completedAt = new Date("2026-04-28T00:00:00.000Z");
      events.push({
        type: "message.completed",
        payload: { messageId: "message-1", content: assistantContent }
      });
      events.push({
        type: "run.completed",
        payload: { runId }
      });
      return {
        run,
        message: {
          id: "message-1",
          threadId: run.threadId,
          runId,
          authorUserId: null,
          role: "ASSISTANT",
          content: assistantContent,
          metadata: null,
          createdAt: new Date("2026-04-28T00:00:00.000Z")
        }
      };
    },
    async failRun(runId, code, message) {
      run.status = "FAILED";
      run.failedAt = new Date("2026-04-28T00:00:00.000Z");
      run.errorCode = code;
      run.errorMessage = message;
      await service.recordRunEvent(run, {
        type: "run.failed",
        payload: { code, message }
      });
      return { ...run, id: runId };
    }
  };

  return { service, events, run, toolCalls, tasks, sources };
}

function createModelProvider(content: string | string[]): ModelProvider & { calls: Array<Parameters<ModelProvider["complete"]>[0]> } {
  const contents = Array.isArray(content) ? [...content] : [content];
  const calls: Array<Parameters<ModelProvider["complete"]>[0]> = [];
  return {
    calls,
    async complete(input) {
      calls.push(input);
      return { content: contents.shift() ?? contents.at(-1) ?? "" };
    }
  };
}

function createRunInput() {
  return {
    agencyId: "agency-1",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    userContent: "Build a Cebu itinerary."
  };
}

describe("agent orchestrator", () => {
  it("streams and completes plain model text", async () => {
    const { service, events, run } = createFakeAgentService();
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider("Here is a draft itinerary."),
      agentService: service,
      toolRegistry: createAgentToolRegistry([])
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
    expect(events[1]).toMatchObject({
      type: "message.delta",
      payload: { delta: "Here is a draft itinerary." }
    });
  });

  it("marks the run running before emitting run.started", async () => {
    const { service, events, run } = createFakeAgentService();
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider("Here is a draft itinerary."),
      agentService: service,
      toolRegistry: createAgentToolRegistry([])
    });

    await orchestrator.run(createRunInput());

    expect(run).toMatchObject({
      status: "COMPLETED",
    });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(events[0]).toEqual({
      type: "run.started",
      payload: { runId: "run-1" }
    });
  });

  it("executes create_itinerary from JSON model output and emits tool events", async () => {
    const { service, events, run, toolCalls } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        itineraryService: {
          async createDraftFromStructuredInput(agencyId, userId, input) {
            createdInputs.push({ agencyId, userId, input });
            return { trip: { id: "trip-1" }, itinerary: { id: "itinerary-1" } };
          }
        }
      })
    ]);
    const modelOutput = JSON.stringify({
      assistantMessage: "Created a draft itinerary.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            trip: { title: "Cebu Honeymoon" },
            itinerary: {
              title: "4-Day Cebu Honeymoon",
              days: [{ dayNumber: 1, title: "Arrival", items: [] }]
            }
          }
        }
      ]
    });
    const modelProvider = createModelProvider([modelOutput, "Created a draft itinerary from the itinerary tool."]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
    expect(toolCalls).toEqual([
      expect.objectContaining({
        toolName: "create_itinerary",
        status: "COMPLETED"
      })
    ]);
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      payload: { name: "create_itinerary", output: { trip: { id: "trip-1" }, itinerary: { id: "itinerary-1" } } }
    });
    expect(events[3]).toMatchObject({
      type: "message.delta",
      payload: { delta: "Created a draft itinerary from the itinerary tool." }
    });
    expect(modelProvider.calls).toHaveLength(2);
    expect(modelProvider.calls[1].messages.at(-1)?.content).toContain("itinerary-1");
  });

  it("uses tool output in the second model pass before completing", async () => {
    const { service, events } = createFakeAgentService();
    const modelOutput = JSON.stringify({
      assistantMessage: "I checked a tool.",
      toolCalls: [
        {
          name: "web_search",
          input: { query: "Cebu travel advisories", maxResults: 1 }
        }
      ]
    });
    const modelProvider = createModelProvider([
      modelOutput,
      "Final response grounded by Google Search: Cebu travel advisories result."
    ]);
    const registry = createAgentToolRegistry([
      createWebSearchTool({
        agentService: service,
        webSearch: {
          async search() {
            return [
              {
                title: "Cebu travel advisories",
                url: "https://example.com/advisories",
                snippet: "Official travel advisory result",
                provider: "google_custom_search" as const
              }
            ];
          }
        }
      })
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry
    });

    await orchestrator.run(createRunInput());

    expect(modelProvider.calls).toHaveLength(2);
    expect(modelProvider.calls[1].messages.at(-1)?.content).toContain("Official travel advisory result");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "source.added",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
    expect(events[4]).toMatchObject({
      type: "message.delta",
      payload: { delta: "Final response grounded by Google Search: Cebu travel advisories result." }
    });
  });

  it("falls back to the planned assistant message when second synthesis fails", async () => {
    const { service, events, run } = createFakeAgentService();
    let calls = 0;
    const modelOutput = JSON.stringify({
      assistantMessage: "Created a draft itinerary.",
      toolCalls: [
        {
          name: "record_agent_task",
          input: { label: "Create draft", status: "COMPLETED" }
        }
      ]
    });
    const modelProvider: ModelProvider = {
      async complete() {
        calls += 1;
        if (calls === 1) {
          return { content: modelOutput };
        }
        throw new ApiError(503, "LOCAL_MODEL_UNAVAILABLE", "Local model provider is unavailable.");
      }
    };
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: createAgentToolRegistry([
        createRecordAgentTaskTool({
          agentService: service
        })
      ])
    });

    await orchestrator.run(createRunInput());

    expect(calls).toBe(2);
    expect(run.status).toBe("COMPLETED");
    expect(events.at(-3)).toMatchObject({
      type: "message.delta",
      payload: { delta: "Created a draft itinerary." }
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed"
    });
  });

  it("record_agent_task emits task.updated", async () => {
    const { service, events, tasks } = createFakeAgentService();
    const registry = createAgentToolRegistry([
      createRecordAgentTaskTool({
        agentService: service
      })
    ]);

    await registry.execute("record_agent_task", createRunInput(), {
      label: "Research hotels",
      status: "RUNNING",
      sortOrder: 2
    });

    expect(events).toEqual([
      {
        type: "task.updated",
        payload: { label: "Research hotels", status: "RUNNING", sortOrder: 2 }
      }
    ]);
    expect(tasks).toEqual([
      expect.objectContaining({
        label: "Research hotels",
        status: "RUNNING",
        sortOrder: 2
      })
    ]);
  });

  it("persists sources for web search", async () => {
    const { service, sources, events } = createFakeAgentService();
    const registry = createAgentToolRegistry([
      createWebSearchTool({
        agentService: service,
        webSearch: {
          async search() {
            return [
              {
                title: "Cebu trip ideas",
                url: "https://example.com/cebu",
                snippet: "A short result",
                provider: "google_custom_search" as const
              }
            ];
          }
        }
      })
    ]);

    const output = await registry.execute("web_search", createRunInput(), {
      query: "Cebu travel",
      maxResults: 3
    });

    expect(output).toHaveLength(1);
    expect(sources).toEqual([
      expect.objectContaining({
        sourceType: "WEB",
        title: "Cebu trip ideas",
        url: "https://example.com/cebu"
      })
    ]);
    expect(events.some((event) => event.type === "source.added")).toBe(true);
  });

  it("enforces shared map and separate web tool call limits", async () => {
    const agentService = {
      async recordRunEvent() {
        return undefined;
      },
      async recordTask() {
        return undefined;
      },
      async recordSources() {
        return undefined;
      }
    };
    const registry = createAgentToolRegistry(
      [
        createSearchGooglePlacesTool({
          agentService,
          maps: {
            async searchPlaces() {
              return [];
            },
            async getPlaceDetails() {
              return {
                id: "place-1",
                name: "Cebu Hotel",
                address: "Cebu City",
                types: []
              };
            },
            async estimateRoute() {
              return {};
            }
          }
        }),
        createGetGooglePlaceDetailsTool({
          agentService,
          maps: {
            async searchPlaces() {
              throw new Error("not used");
            },
            async getPlaceDetails() {
              return {
                id: "place-1",
                name: "Cebu Hotel",
                address: "Cebu City",
                types: []
              };
            },
            async estimateRoute() {
              throw new Error("not used");
            }
          }
        }),
        createEstimateRouteTool({
          agentService,
          maps: {
            async searchPlaces() {
              throw new Error("not used");
            },
            async getPlaceDetails() {
              throw new Error("not used");
            },
            async estimateRoute() {
              return {};
            }
          }
        }),
        createWebSearchTool({
          agentService,
          webSearch: {
            async search() {
              return [];
            }
          }
        })
      ],
      {
        maxCallsByGroup: {
          google_maps: 2,
          web_search: 1
        },
        toolGroups: {
          search_google_places: "google_maps",
          get_google_place_details: "google_maps",
          estimate_route: "google_maps",
          web_search: "web_search"
        }
      }
    );
    const context = createRunInput();

    await registry.execute("search_google_places", context, { query: "Cebu hotels", maxResults: 3 });
    await registry.execute("get_google_place_details", context, { placeId: "place-1" });
    await expect(
      registry.execute("estimate_route", context, {
        origin: { latitude: 10.3157, longitude: 123.8854 },
        destination: { latitude: 10.295, longitude: 123.9 },
        travelMode: "DRIVE"
      })
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_LIMIT_REACHED",
      statusCode: 429
    } satisfies Partial<ApiError>);

    await registry.execute("web_search", context, { query: "Cebu travel", maxResults: 3 });
    await expect(registry.execute("web_search", context, { query: "Cebu weather", maxResults: 3 })).rejects.toMatchObject({
      code: "AGENT_TOOL_LIMIT_REACHED",
      statusCode: 429
    } satisfies Partial<ApiError>);
  });

  it("fails the run when model output looks like invalid JSON", async () => {
    const { service, events, run } = createFakeAgentService();
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider('{"assistantMessage": "Missing close"'),
      agentService: service,
      toolRegistry: createAgentToolRegistry([])
    });

    await orchestrator.run(createRunInput());

    expect(run).toMatchObject({
      status: "FAILED",
      errorCode: "MODEL_OUTPUT_INVALID"
    });
    expect(events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
  });

  it("fails when tool inputs exceed the per-run limit", async () => {
    const { service, events, run } = createFakeAgentService();
    const modelOutput = JSON.stringify({
      assistantMessage: "Done.",
      toolCalls: Array.from({ length: 21 }, (_, index) => ({
        name: "record_agent_task",
        input: {
          label: `Task ${index + 1}`,
          status: "RUNNING"
        }
      }))
    });
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider(modelOutput),
      agentService: service,
      toolRegistry: createAgentToolRegistry([
        createRecordAgentTaskTool({
          agentService: service
        })
      ]),
      maxToolCallsPerRun: 20
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("FAILED");
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: {
        code: "AGENT_TOOL_LIMIT_REACHED",
        message: "Agent tool call limit reached."
      }
    });
  });

  it("fails invalid tool input with AGENT_TOOL_INPUT_INVALID", async () => {
    const { service, events } = createFakeAgentService();
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider(
        JSON.stringify({
          assistantMessage: "Trying a bad tool call.",
          toolCalls: [
            {
              name: "record_agent_task",
              input: {
                label: "",
                status: "RUNNING"
              }
            }
          ]
        })
      ),
      agentService: service,
      toolRegistry: createAgentToolRegistry([
        createRecordAgentTaskTool({
          agentService: service
        })
      ])
    });

    await orchestrator.run(createRunInput());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "run.failed"
    ]);
    expect(events[2]).toMatchObject({
      type: "tool.failed",
      payload: {
        name: "record_agent_task",
        code: "AGENT_TOOL_INPUT_INVALID"
      }
    });
    expect(events[3]).toMatchObject({
      type: "run.failed",
      payload: {
        code: "AGENT_TOOL_INPUT_INVALID"
      }
    });
  });
});
