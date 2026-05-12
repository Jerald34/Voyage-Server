import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  createAgentOrchestrator,
  type AgentOrchestratorAgentService
} from "../src/modules/agent/agentOrchestrator";
import {
  createAddItineraryItemTool,
  createAgentToolRegistry,
  createCreateItineraryTool,
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createMapPinpointTool,
  createRecordAgentTaskTool,
  createSearchGooglePlacesTool,
  createUpdateItineraryTool,
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
    async getThread() {
      return {
        messages: [
          { role: "SYSTEM_VISIBLE", content: "You are helping an agency planner." },
          { role: "USER", content: "We are planning a Cebu itinerary." },
          { role: "ASSISTANT", content: "Great, what dates are you targeting?" },
          { role: "USER", content: "Build a Cebu itinerary." }
        ]
      };
    },
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

function createStreamingModelProvider(
  content: string | string[]
): ModelProvider & {
  calls: Array<Parameters<ModelProvider["complete"]>[0]>;
  completeCalls: number;
  streamCalls: number;
} {
  const contents = Array.isArray(content) ? [...content] : [content];
  const calls: Array<Parameters<ModelProvider["complete"]>[0]> = [];
  let completeCalls = 0;
  let streamCalls = 0;
  return {
    calls,
    get completeCalls() {
      return completeCalls;
    },
    get streamCalls() {
      return streamCalls;
    },
    async complete(input) {
      completeCalls += 1;
      calls.push(input);
      return { content: contents.shift() ?? contents.at(-1) ?? "" };
    },
    async *completeStream(input) {
      streamCalls += 1;
      calls.push(input);
      const next = contents.shift() ?? contents.at(-1) ?? "";
      for (const char of next) {
        yield char;
      }
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
    const provider = createModelProvider("Here is a draft itinerary.");
    const orchestrator = createAgentOrchestrator({
      modelProvider: provider,
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
    expect(provider.calls[0].messages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "We are planning a Cebu itinerary." },
        { role: "assistant", content: "Great, what dates are you targeting?" },
        { role: "user", content: "Build a Cebu itinerary." }
      ])
    );
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
        agentService: service,
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
      "itinerary.updated",
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
      type: "itinerary.updated",
      payload: { itineraryId: "itinerary-1", change: "created" }
    });
    expect(events[3]).toMatchObject({
      type: "tool.completed",
      payload: { name: "create_itinerary", output: { trip: { id: "trip-1" }, itinerary: { id: "itinerary-1" } } }
    });
    expect(events[4]).toMatchObject({
      type: "message.delta",
      payload: { delta: "Created a draft itinerary from the itinerary tool." }
    });
    expect(modelProvider.calls).toHaveLength(2);
    expect(modelProvider.calls[1].messages.at(-1)?.content).toContain("create_itinerary");
  });

  it("accepts shorthand create_itinerary payloads from the model", async () => {
    const { service, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-2" }, itinerary: { id: "itinerary-2" } };
          }
        }
      })
    ]);
    const modelOutput = JSON.stringify({
      assistantMessage: "Creating your itinerary now.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            destination: "Hokkaido",
            duration_days: 3,
            activity_type: "adventure"
          }
        }
      ]
    });
    const modelProvider = createModelProvider([modelOutput, "Your draft itinerary has been created."]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      trip: {
        destinationSummary: "Hokkaido"
      },
      itinerary: {
        title: "3-Day Hokkaido Adventure Itinerary",
        days: [{ dayNumber: 1 }, { dayNumber: 2 }, { dayNumber: 3 }]
      }
    });
  });

  it("enriches weak create_itinerary shorthand from the user request before executing the tool", async () => {
    const { service, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-olongapo" }, itinerary: { id: "itinerary-olongapo" } };
          }
        }
      })
    ]);
    const modelOutput = JSON.stringify({
      assistantMessage: "Creating your Olongapo itinerary now.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            destination: "Olongapo City"
          }
        }
      ]
    });
    const modelProvider = createModelProvider([
      modelOutput,
      JSON.stringify({
        trip: {
          title: "1-Day Olongapo Nature And Restaurant Trip",
          destinationSummary: "Olongapo City"
        },
        itinerary: {
          title: "Olongapo City Nature And Restaurant Day",
          summary: "A one-day Olongapo City plan customized around nature, dining, and a 10:00 AM to 4:00 PM window.",
          days: [
            {
              dayNumber: 1,
              title: "Nature And Dining",
              items: [
                {
                  type: "ACTIVITY",
                  title: "Nature walk near Subic Bay",
                  startTime: "10:00 AM",
                  endTime: "12:15 PM"
                },
                {
                  type: "MEAL",
                  title: "Local restaurant lunch",
                  startTime: "12:30 PM",
                  endTime: "1:45 PM"
                },
                {
                  type: "ACTIVITY",
                  title: "Scenic afternoon stop",
                  startTime: "2:00 PM",
                  endTime: "4:00 PM"
                }
              ]
            }
          ]
        }
      }),
      "Your one-day Olongapo itinerary has been created."
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["create_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent: "Create a one-day nature and restaurant itinerary in Olongapo City from 10:00 AM to 4:00 PM."
    });

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      trip: {
        destinationSummary: "Olongapo City"
      },
      itinerary: {
        days: [
          {
            dayNumber: 1,
            items: [
              expect.objectContaining({
                type: "ACTIVITY",
                startTime: "10:00 AM"
              }),
              expect.objectContaining({
                type: "MEAL"
              }),
              expect.objectContaining({
                endTime: "4:00 PM"
              })
            ]
          }
        ]
      }
    });
    expect(modelProvider.calls).toHaveLength(3);
    expect(modelProvider.calls[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("10:00 AM to 4:00 PM")
        })
      ])
    );
  });

  it("accepts location and highlights shorthand in create_itinerary payload", async () => {
    const { service, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-3" }, itinerary: { id: "itinerary-3" } };
          }
        }
      })
    ]);
    const modelOutput = JSON.stringify({
      assistantMessage: "Creating your itinerary now.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            location: "Hokkaido, Japan",
            duration_days: 3,
            activity_type: "adventure",
            highlights: [
              "Sapporo city exploration",
              "Mount Moiwa views",
              "Onsen hot springs"
            ]
          }
        }
      ]
    });
    const modelProvider = createModelProvider([modelOutput, "Your draft itinerary has been created."]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      trip: {
        destinationSummary: "Hokkaido, Japan"
      },
      itinerary: {
        title: "3-Day Hokkaido, Japan Adventure Itinerary",
        days: [
          {
            dayNumber: 1,
            items: [{ title: "Sapporo city exploration" }]
          },
          {
            dayNumber: 2,
            items: [{ title: "Mount Moiwa views" }]
          },
          {
            dayNumber: 3,
            items: [{ title: "Onsen hot springs" }]
          }
        ]
      }
    });
  });

  it("resolves shorthand highlights as itinerary places when maps are available", async () => {
    const { service } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const resolvedPlaces: Array<{ placeName: string; cityContext?: string }> = [];
    const detailsCalls: string[] = [];
    const photoCalls: Array<{ placeId: string; maxResults?: number }> = [];
    const upsertedPlaces: string[] = [];
    const upsertCreateInputs: Array<{
      name: string;
      rating?: number;
      websiteUrl?: string;
      phoneNumber?: string;
      metadata?: Record<string, unknown>;
    }> = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        maps: {
          async searchPlaces() {
            return [];
          },
          async getPlaceDetails(placeId) {
            detailsCalls.push(placeId);
            return {
              id: placeId,
              name: `${placeId} detailed name`,
              address: `${placeId} detailed address`,
              location: { latitude: 16.4111, longitude: 120.5988 },
              rating: 4.7,
              userRatingCount: 321,
              types: ["park", "tourist_attraction"],
              phoneNumber: "+63 74 111 2222",
              websiteUri: "https://example.com/baguio-place"
            };
          },
          async getPlacePhotos(placeId, maxResults) {
            photoCalls.push({ placeId, maxResults });
            return [
              { name: `${placeId}/photos/1`, photoUri: "https://example.com/photo-1.jpg" },
              { name: `${placeId}/photos/2`, photoUri: "https://example.com/photo-2.jpg" },
              { name: `${placeId}/photos/empty`, photoUri: "" }
            ];
          },
          async estimateRoute() {
            return {};
          },
          async resolvePlace(input) {
            resolvedPlaces.push(input);
            return {
              provider: "GOOGLE_MAPS",
              providerPlaceId: `google:${input.placeName.toLowerCase().replace(/\s+/g, "-")}`,
              name: input.placeName,
              formattedAddress: `${input.placeName}, ${input.cityContext}`,
              location: { latitude: 16.4023, longitude: 120.596 },
              metadata: { source: "resolved" }
            };
          }
        },
        placeSnapshotClient: {
          placeSnapshot: {
            async upsert(args: { create: { name: string; metadata?: Record<string, unknown> } }) {
              upsertedPlaces.push(args.create.name);
              upsertCreateInputs.push(args.create);
              return { id: "11111111-1111-4111-8111-111111111111" };
            }
          }
        } as never,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-baguio" }, itinerary: { id: "itinerary-baguio" } };
          }
        }
      })
    ]);

    await registry.execute("create_itinerary", createRunInput(), {
      location: "Baguio City, Philippines",
      duration_days: 2,
      highlights: ["Burnham Park boating", "Mines View Park views"]
    });

    expect(resolvedPlaces).toEqual([
      { placeName: "Burnham Park boating", cityContext: "Baguio City, Philippines" },
      { placeName: "Mines View Park views", cityContext: "Baguio City, Philippines" }
    ]);
    expect(detailsCalls).toEqual([
      "google:burnham-park-boating",
      "google:mines-view-park-views"
    ]);
    expect(photoCalls).toEqual([
      { placeId: "google:burnham-park-boating", maxResults: 3 },
      { placeId: "google:mines-view-park-views", maxResults: 3 }
    ]);
    expect(upsertedPlaces).toEqual([
      "google:burnham-park-boating detailed name",
      "google:mines-view-park-views detailed name"
    ]);
    expect(upsertCreateInputs).toHaveLength(2);
    expect(upsertCreateInputs[0]).toMatchObject({
      rating: 4.7,
      websiteUrl: "https://example.com/baguio-place",
      phoneNumber: "+63 74 111 2222",
      metadata: {
        source: "resolved",
        primaryPhotoUrl: "https://example.com/photo-1.jpg",
        photoUrls: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"],
        googleTypes: ["park", "tourist_attraction"],
        userRatingCount: 321
      }
    });
    expect(createdInputs[0]).toMatchObject({
      itinerary: {
        days: [
          { items: [{ title: "Burnham Park boating", placeSnapshotId: "11111111-1111-4111-8111-111111111111" }] },
          { items: [{ title: "Mines View Park views", placeSnapshotId: "11111111-1111-4111-8111-111111111111" }] }
        ]
      }
    });
  });

  it("converts weak multi-day shorthand into a fully scheduled itinerary when the user asks for a proper timed plan", async () => {
    const { service, run } = createFakeAgentService();
    const createdInputs: any[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-baguio" }, itinerary: { id: "itinerary-baguio" } };
          }
        }
      })
    ]);
    const modelOutput = JSON.stringify({
      assistantMessage: "Creating your Baguio itinerary now.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            location: "Baguio City, Philippines",
            duration_days: 5,
            activity_type: "nature and restaurant tour",
            highlights: [
              "Burnham Park boating and Session Road food crawl",
              "Mines View Park views and Wright Park horseback riding",
              "Botanical Garden stroll and Camp John Hay pine forest walk",
              "Tam-awan Village culture and local Igorot cuisine",
              "Strawberry Farm visit and Good Shepherd shopping"
            ]
          }
        }
      ]
    });
    const structuredBaguioInput = {
      trip: {
        title: "5-Day Baguio City, Philippines Nature And Restaurant Tour Trip",
        destinationSummary: "Baguio City, Philippines"
      },
      itinerary: {
        title: "5-Day Baguio City, Philippines Nature And Restaurant Tour Itinerary",
        summary: "A five-day Baguio plan from 10:00 AM to 4:00 PM daily with nature stops and restaurants.",
        days: Array.from({ length: 5 }, (_, index) => ({
          dayNumber: index + 1,
          title: `Day ${index + 1}`,
          items: [
            {
              type: "ACTIVITY",
              title: `Day ${index + 1} morning tourist stop`,
              description: "Start with a major Baguio tourist stop.",
              startTime: "10:00 AM",
              endTime: "11:30 AM",
              placeName: "Burnham Park",
              cityContext: "Baguio City, Philippines"
            },
            {
              type: "MEAL",
              title: `Day ${index + 1} restaurant lunch`,
              description: "Add a restaurant or cafe stop that fits the route.",
              startTime: "12:00 PM",
              endTime: "1:00 PM",
              placeName: "Session Road",
              cityContext: "Baguio City, Philippines"
            },
            {
              type: "ACTIVITY",
              title: `Day ${index + 1} afternoon nature stop`,
              description: "End with a scenic or nature-focused activity.",
              startTime: "1:30 PM",
              endTime: "4:00 PM",
              placeName: "Baguio Botanical Garden",
              cityContext: "Baguio City, Philippines"
            }
          ]
        }))
      }
    };
    const modelProvider = createModelProvider([
      modelOutput,
      JSON.stringify(structuredBaguioInput),
      "Your fully scheduled Baguio itinerary has been created."
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["create_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent:
        "Create a proper itinerary plan for Baguio City, Philippines. This is a 5 day itinerary plan that has nature and resto trip. The itinerary will start at 10am and end at 4pm everyday and they want to visit all the tourist spots on Baguio."
    });

    expect(run.status).toBe("COMPLETED");
    expect(modelProvider.calls).toHaveLength(3);
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0].itinerary.days).toHaveLength(5);
    for (const day of createdInputs[0].itinerary.days) {
      expect(day.items.length).toBeGreaterThanOrEqual(3);
      expect(day.items[0].startTime).toBe("10:00 AM");
      expect(day.items.at(-1).endTime).toBe("4:00 PM");
      expect(day.items.some((item: any) => item.type === "MEAL")).toBe(true);
    }
  });

  it("converts plain itinerary prose into a draft itinerary tool call", async () => {
    const { service, events, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-prose" }, itinerary: { id: "itinerary-prose" } };
          }
        }
      })
    ]);
    const proseItinerary = [
      "**Olongapo City Nature & Dining Itinerary Plan**",
      "Morning (10:00 AM - 12:30 PM): Nature Experience",
      "- Activity: Visit Subic Bay Freeport Zone for beach, hiking, and scenic nature options.",
      "Lunch (12:30 PM - 1:30 PM): Dining Experience",
      "- Activity: Eat at a restaurant within or near the Subic Bay Freeport Zone."
    ].join("\n");
    const modelProvider = createModelProvider([
      proseItinerary,
      JSON.stringify({
        assistantMessage: "Creating the Olongapo draft itinerary now.",
        toolCalls: [
          {
            name: "create_itinerary",
            input: {
              trip: { title: "Olongapo City Nature & Dining Trip", destinationSummary: "Olongapo City" },
              itinerary: {
                title: "Olongapo City Nature & Dining Itinerary Plan",
                summary: "A 1-day nature and dining itinerary in Olongapo City.",
                days: [
                  {
                    dayNumber: 1,
                    title: "Nature And Dining",
                    items: [
                      {
                        type: "ACTIVITY",
                        title: "Subic Bay Freeport Zone nature experience",
                        startTime: "10:00 AM",
                        endTime: "12:30 PM"
                      },
                      {
                        type: "MEAL",
                        title: "Dining near Subic Bay Freeport Zone",
                        startTime: "12:30 PM",
                        endTime: "1:30 PM"
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }),
      "Your Olongapo City draft itinerary has been created."
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["create_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent: "Create a proper itinerary plan for Olongapo City from 10am to 4pm."
    });

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(modelProvider.calls).toHaveLength(3);
    expect(modelProvider.calls[1].messages.at(-1)?.content).toContain(proseItinerary);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "itinerary.updated",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
    expect(events[2]).toMatchObject({
      type: "itinerary.updated",
      payload: { itineraryId: "itinerary-prose", change: "created" }
    });
  });

  it("directly creates a multi-stop one-day itinerary from a custom time window when model output is invalid", async () => {
    const { service, run } = createFakeAgentService();
    const createdInputs: any[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-baguio-night" }, itinerary: { id: "itinerary-baguio-night" } };
          }
        }
      })
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider('{"assistantMessage": "Missing close"'),
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["create_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent: "Create a 1-day Baguio City nature and resto itinerary from 3pm to 9pm."
    });

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0].itinerary.days).toHaveLength(1);
    const items = createdInputs[0].itinerary.days[0].items;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0].startTime).toBe("3:00 PM");
    expect(items.at(-1).endTime).toBe("9:00 PM");
    expect(items.some((item: any) => item.type === "MEAL")).toBe(true);
  });

  it("parses and executes <|toolcall|> tagged create_itinerary output", async () => {
    const { service, events, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-tag" }, itinerary: { id: "itinerary-tag" } };
          }
        }
      })
    ]);
    const taggedOutput =
      '<|toolcall|>call:create_itinerary{destination:"Osaka",duration_days:3,activity_type:"adventure"}<tool_call|>';
    const modelProvider = createModelProvider([taggedOutput, "Draft created from tagged tool output."]);
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
      "itinerary.updated",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
  });

  it("parses aliased tagged tool call with wrapped input object", async () => {
    const { service, events, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-tag-2" }, itinerary: { id: "itinerary-tag-2" } };
          }
        }
      })
    ]);
    const taggedOutput =
      '<|toolcall|>call:createitinerary{input:{location:"Hokkaido, Japan",duration_days:3,activity_type:"adventure"}}<tool_call|>';
    const modelProvider = createModelProvider([taggedOutput, "Draft created from wrapped tagged tool output."]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry
    });

    await orchestrator.run(createRunInput());

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      trip: {
        destinationSummary: "Hokkaido, Japan"
      }
    });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "itinerary.updated",
      "tool.completed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
  });

  it("does not stream escaped tool JSON as assistant text", async () => {
    const { service, events, run } = createFakeAgentService();
    const createdInputs: unknown[] = [];
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput(_agencyId, _userId, input) {
            createdInputs.push(input);
            return { trip: { id: "trip-escaped" }, itinerary: { id: "itinerary-escaped" } };
          }
        }
      })
    ]);
    const escapedJson = JSON.stringify(
      JSON.stringify({
        assistantMessage: "I will create the draft itinerary.",
        toolCalls: [
          {
            name: "create_itinerary",
            input: {
              destination: "Olongapo City",
              duration_days: 2,
              highlights: ["Subic Bay nature stop", "Waterfront dinner"]
            }
          }
        ]
      })
    );
    const modelProvider = createStreamingModelProvider([
      escapedJson,
      "Your Olongapo City draft itinerary has been created."
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["create_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent: "Create a 2-day Olongapo City itinerary."
    });

    expect(run.status).toBe("COMPLETED");
    expect(createdInputs).toHaveLength(1);
    expect(events.some((event) => event.type === "message.delta" && String(event.payload.delta).includes('\\"assistantMessage\\"'))).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(true);
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

    expect(modelProvider.calls).toHaveLength(3);
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

  it("does not fail the run when web_search provider is unavailable", async () => {
    const { service, events, run, toolCalls } = createFakeAgentService();
    const modelOutput = JSON.stringify({
      assistantMessage: "I will check current flight options.",
      toolCalls: [
        {
          name: "web_search",
          input: { query: "flights from Clark to Davao", maxResults: 3 }
        }
      ]
    });
    const modelProvider = createModelProvider([
      modelOutput,
      "I could not access live web search right now, but I can still draft options and what to verify."
    ]);
    const registry = createAgentToolRegistry([
      createWebSearchTool({
        agentService: service,
        webSearch: {
          async search() {
            throw new ApiError(503, "WEB_SEARCH_PROVIDER_UNAVAILABLE", "Google Search provider is unavailable.");
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

    expect(run.status).toBe("COMPLETED");
    expect(toolCalls).toEqual([
      expect.objectContaining({
        toolName: "web_search",
        status: "FAILED",
        errorCode: "WEB_SEARCH_PROVIDER_UNAVAILABLE"
      })
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.failed",
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
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

    expect(calls).toBe(3);
    expect(run.status).toBe("COMPLETED");
    expect(events.at(-3)).toMatchObject({
      type: "message.delta",
      payload: { delta: "Created a draft itinerary." }
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed"
    });
  });

  it("streams synthesized assistant responses after tool execution", async () => {
    const { service, events, run } = createFakeAgentService();
    const modelOutput = JSON.stringify({
      assistantMessage: "Created a draft itinerary.",
      toolCalls: [
        {
          name: "record_agent_task",
          input: { label: "Create draft", status: "COMPLETED" }
        }
      ]
    });
    const modelProvider = createStreamingModelProvider([
      modelOutput,
      "Created a draft itinerary with the requested updates."
    ]);
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

    expect(run.status).toBe("COMPLETED");
    expect(modelProvider.streamCalls).toBe(2);
    expect(modelProvider.completeCalls).toBe(2);
    expect(events.at(-2)).toMatchObject({
      type: "message.completed",
      payload: { content: "Created a draft itinerary with the requested updates." }
    });
  });

  it("includes active itinerary context so update requests can call update_itinerary", async () => {
    const { service, run } = createFakeAgentService();
    const replacedInputs: Array<{ itineraryId: string; itinerary: unknown }> = [];
    service.getThread = async () => ({
      messages: [
        { role: "USER", content: "Create a Baguio itinerary." },
        { role: "ASSISTANT", content: "Created the draft itinerary." },
        { role: "USER", content: "Change Day 1 lunch to a cheaper restaurant." }
      ],
      events: [
        {
          type: "tool.completed",
          payload: {
            name: "create_itinerary",
            output: {
              itinerary: {
                id: "itinerary-active",
                title: "Baguio Draft",
                days: [
                  {
                    dayNumber: 1,
                    title: "Day 1",
                    items: [
                      {
                        type: "ACTIVITY",
                        title: "Burnham Park",
                        startTime: "10:00 AM",
                        endTime: "11:30 AM"
                      },
                      {
                        type: "MEAL",
                        title: "Premium lunch on Session Road",
                        startTime: "12:00 PM",
                        endTime: "1:00 PM"
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      ]
    } as any);
    const modelProvider: ModelProvider & { sawActiveContext: boolean } = {
      sawActiveContext: false,
      async complete(input) {
        if (input.messages.some((message) => message.content.includes("Active itinerary draft context"))) {
          this.sawActiveContext = true;
        }
        if (this.sawActiveContext && input.messages[0].role === "system") {
          return {
              content: JSON.stringify({
                assistantMessage: "Updating Day 1 lunch.",
                toolCalls: [
                  {
                    name: "update_itinerary",
                    input: {
                      itineraryId: "itinerary-active",
                      itinerary: {
                        title: "Baguio Draft",
                        days: [
                          {
                            dayNumber: 1,
                            title: "Day 1",
                            items: [
                              {
                                type: "ACTIVITY",
                                title: "Burnham Park",
                                startTime: "10:00 AM",
                                endTime: "11:30 AM"
                              },
                              {
                                title: "Budget lunch near Session Road",
                                startTime: "12:00 PM",
                                endTime: "1:00 PM",
                                placeName: "Session Road",
                                cityContext: "Baguio City, Philippines"
                              }
                            ]
                          }
                      ]
                    }
                  }
                }
              ]
            })
          };
        }
        return { content: "Updated Day 1 lunch." };
      }
    };
    const registry = createAgentToolRegistry([
      createUpdateItineraryTool({
        agentService: service,
        itineraryService: {
          async replaceDraft(_agencyId, itineraryId, itinerary) {
            replacedInputs.push({ itineraryId, itinerary });
            return { id: itineraryId, version: 2, status: "DRAFT" };
          }
        }
      })
    ]);
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: registry,
      availableToolNames: ["update_itinerary"]
    });

    await orchestrator.run({
      ...createRunInput(),
      userContent: "Change Day 1 lunch to a cheaper restaurant."
    });

    expect(run.status).toBe("COMPLETED");
    expect(modelProvider.sawActiveContext).toBe(true);
    expect(replacedInputs).toEqual([
      expect.objectContaining({
        itineraryId: "itinerary-active",
        itinerary: expect.objectContaining({
          title: "Baguio Draft",
          days: [
            expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ type: "MEAL", title: "Budget lunch near Session Road" })
              ])
            })
          ]
        })
      })
    ]);
  });

  it("replaces object-coerced synthesis with a readable itinerary summary", async () => {
    const { service, events, run } = createFakeAgentService();
    const modelOutput = JSON.stringify({
      assistantMessage: "Created the Baguio itinerary draft.",
      toolCalls: [
        {
          name: "create_itinerary",
          input: {
            destination: "Baguio City, Philippines",
            duration_days: 1,
            highlights: ["Burnham Park boating"]
          }
        }
      ]
    });
    const modelProvider = createModelProvider([
      modelOutput,
      "I have successfully created the itinerary draft: [object Object]\n- Burnham Park boating\n[object Object]"
    ]);
    const registry = createAgentToolRegistry([
      createCreateItineraryTool({
        agentService: service,
        itineraryService: {
          async createDraftFromStructuredInput() {
            return {
              trip: { id: "trip-baguio", title: "1-Day Baguio City, Philippines Trip" },
              itinerary: {
                id: "itinerary-baguio",
                title: "1-Day Baguio City, Philippines Itinerary",
                days: [
                  {
                    dayNumber: 1,
                    title: "Day 1",
                    items: [
                      {
                        title: "Burnham Park boating",
                        startTime: "10:00 AM",
                        endTime: "11:30 AM",
                        placeSnapshot: {
                          name: "Burnham Park",
                          formattedAddress: "Jose Abad Santos Dr, Baguio"
                        }
                      }
                    ]
                  }
                ]
              }
            };
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

    expect(run.status).toBe("COMPLETED");
    const completed = events.find((event) => event.type === "message.completed");
    expect(completed?.payload).toMatchObject({
      content: expect.stringContaining("1-Day Baguio City, Philippines Itinerary")
    });
    expect(completed?.payload).toMatchObject({
      content: expect.stringContaining("Burnham Park boating")
    });
    expect(JSON.stringify(completed?.payload)).not.toContain("[object Object]");
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

  it("record_agent_task accepts shorthand task and priority input", async () => {
    const { service, events, tasks } = createFakeAgentService();
    const registry = createAgentToolRegistry([
      createRecordAgentTaskTool({
        agentService: service
      })
    ]);

    await registry.execute("record_agent_task", createRunInput(), {
      task: "Create 1-day Olongapo City itinerary with nature and rest",
      priority: "high"
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        label: "Create 1-day Olongapo City itinerary with nature and rest",
        status: "RUNNING"
      })
    ]);
    expect(events).toEqual([
      {
        type: "task.updated",
        payload: expect.objectContaining({
          label: "Create 1-day Olongapo City itinerary with nature and rest",
          status: "RUNNING"
        })
      }
    ]);
  });

  it("record_agent_task accepts task_name, description, and lowercase status", async () => {
    const { service, events, tasks } = createFakeAgentService();
    const registry = createAgentToolRegistry([
      createRecordAgentTaskTool({
        agentService: service
      })
    ]);

    await registry.execute("record_agent_task", createRunInput(), {
      task_name: "Test Task - Tool Verification",
      description: "This is a test task to verify the record_agent_task tool.",
      status: "pending",
      priority: "medium"
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        label: "Test Task - Tool Verification — This is a test task to verify the record_agent_task tool.",
        status: "PENDING"
      })
    ]);
    expect(events).toEqual([
      {
        type: "task.updated",
        payload: expect.objectContaining({
          label: "Test Task - Tool Verification — This is a test task to verify the record_agent_task tool.",
          status: "PENDING"
        })
      }
    ]);
  });

  it("adds routeFromPrevious to newly added itinerary stops when the previous stop is mapped", async () => {
    const { service, events } = createFakeAgentService();
    const updateInputs: unknown[] = [];
    const tool = createAddItineraryItemTool({
      agentService: service,
      itineraryService: {
        async addItem(_agencyId, input) {
          return {
            itinerary: {
              id: input.itineraryId,
              days: [
                {
                  id: input.dayId,
                  items: [
                    {
                      id: "item-previous",
                      sortOrder: 1,
                      title: "Burnham Park",
                      placeSnapshot: {
                        latitude: 16.411,
                        longitude: 120.593
                      }
                    },
                    {
                      id: "item-current",
                      sortOrder: 2,
                      title: input.item.title,
                      placeSnapshot: {
                        latitude: 16.402,
                        longitude: 120.596
                      }
                    }
                  ]
                }
              ]
            },
            dayId: input.dayId,
            item: {
              id: "item-current",
              sortOrder: 2,
              title: input.item.title,
              placeSnapshot: {
                latitude: 16.402,
                longitude: 120.596
              }
            }
          };
        },
        async updateItem(_agencyId, input) {
          updateInputs.push(input);
          return {
            itinerary: { id: input.itineraryId },
            dayId: "day-1",
            item: {
              id: input.itemId,
              title: "Baguio Cathedral",
              routeFromPrevious: input.item.routeFromPrevious
            }
          };
        }
      },
      maps: {
        async resolvePlace() {
          return {
            provider: "GOOGLE_MAPS",
            providerPlaceId: "google-place-current",
            name: "Baguio Cathedral",
            formattedAddress: "Baguio Cathedral, Baguio City",
            location: { latitude: 16.402, longitude: 120.596 }
          };
        },
        async getPlaceDetails() {
          return {
            id: "google-place-current",
            name: "Baguio Cathedral",
            address: "Baguio Cathedral, Baguio City",
            types: []
          };
        },
        async getPlacePhotos() {
          return [];
        },
        async searchPlaces() {
          return [];
        },
        async searchNearby() {
          return [];
        },
        async estimateRoute(input) {
          return {
            distanceMeters: 1400,
            durationSeconds: 480,
            polyline: "encoded-route",
            staticDurationSeconds: 420
          };
        }
      },
      placeSnapshotClient: {
        placeSnapshot: {
          async upsert() {
            return { id: "snapshot-current" };
          }
        }
      } as never
    });

    const output = await tool.execute(createRunInput(), {
      itineraryId: "itinerary-1",
      dayId: "day-1",
      item: {
        type: "ACTIVITY",
        title: "Baguio Cathedral",
        placeName: "Baguio Cathedral",
        cityContext: "Baguio City"
      }
    });

    expect(updateInputs).toEqual([
      expect.objectContaining({
        itineraryId: "itinerary-1",
        itemId: "item-current",
        item: expect.objectContaining({
          routeFromPrevious: {
            originItemId: "item-previous",
            destinationItemId: "item-current",
            travelMode: "DRIVE",
            distanceMeters: 1400,
            durationSeconds: 480,
            staticDurationSeconds: 420,
            polyline: "encoded-route"
          }
        })
      })
    ]);
    expect(output).toMatchObject({
      item: {
        id: "item-current",
        routeFromPrevious: expect.objectContaining({
          polyline: "encoded-route"
        })
      }
    });
    expect(events).toContainEqual({
      type: "itinerary.item.added",
      payload: expect.objectContaining({
        item: expect.objectContaining({
          routeFromPrevious: expect.objectContaining({
            polyline: "encoded-route"
          })
        })
      })
    });
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
      "message.delta",
      "message.completed",
      "run.completed"
    ]);
    expect(events[2]).toMatchObject({
      type: "tool.failed",
      payload: {
        name: "record_agent_task",
        code: "AGENT_TOOL_INPUT_INVALID"
      }
    });
    expect(events[3]).toMatchObject({
      type: "message.delta",
      payload: {
        delta: "Trying a bad tool call."
      }
    });
  });

  it("persists NOMINATIM snapshots with a DB-safe provider enum", async () => {
    const captured: Array<{
      provider: string;
      providerPlaceId: string;
      name: string;
      formattedAddress: string | null;
    }> = [];
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
    const tool = createMapPinpointTool({
      agentService,
      maps: {
        async searchPlaces() {
          return [];
        },
        async getPlaceDetails() {
          return {
            id: "place-1",
            name: "Olongapo City",
            address: "Olongapo City, Zambales",
            types: []
          };
        },
        async estimateRoute() {
          return {};
        },
        async resolvePlace() {
          return {
            provider: "NOMINATIM",
            providerPlaceId: "nominatim:olongapo-city",
            name: "Olongapo City",
            formattedAddress: "Olongapo City, Zambales",
            location: { latitude: 14.8363313, longitude: 120.2828655 }
          };
        }
      },
      placeSnapshotClient: {
        placeSnapshot: {
          async upsert(args: {
            create: {
              provider: string;
              providerPlaceId: string;
              name: string;
              formattedAddress: string | null;
              latitude: number;
              longitude: number;
              rating?: number | null;
              websiteUrl?: string | null;
              phoneNumber?: string | null;
              metadata?: unknown;
              fetchedAt: Date;
            };
            update: unknown;
            where: unknown;
          }) {
            captured.push({
              provider: args.create.provider,
              providerPlaceId: args.create.providerPlaceId,
              name: args.create.name,
              formattedAddress: args.create.formattedAddress ?? null
            });
            return { id: "snapshot-1" };
          }
        }
      } as never
    });

    const result = await tool.execute(createRunInput(), {
      placeName: "Olongapo City",
      cityContext: "Olongapo City"
    });

    expect(result).toEqual({
      placeSnapshotId: "snapshot-1",
      name: "Olongapo City",
      formattedAddress: "Olongapo City, Zambales",
      lat: 14.8363313,
      lng: 120.2828655,
      provider: "NOMINATIM"
    });
    expect(captured).toEqual([
      {
        provider: "GOOGLE_MAPS",
        providerPlaceId: "nominatim:olongapo-city",
        name: "Olongapo City",
        formattedAddress: "Olongapo City, Zambales"
      }
    ]);
  });
});
