import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  createAgentOrchestrator,
  type AgentOrchestratorAgentService
} from "../src/modules/agent/agentOrchestrator";
import {
  createAgentToolRegistry,
  createCreateItineraryTool,
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
  const service: AgentOrchestratorAgentService = {
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
    async completeRun(runId, assistantContent) {
      run.status = "COMPLETED";
      run.completedAt = new Date("2026-04-28T00:00:00.000Z");
      await service.recordRunEvent(run, {
        type: "message.completed",
        payload: { messageId: "message-1", content: assistantContent }
      });
      await service.recordRunEvent(run, {
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

  return { service, events, run };
}

function createModelProvider(content: string): ModelProvider {
  return {
    async complete() {
      return { content };
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

  it("executes create_itinerary from JSON model output and emits tool events", async () => {
    const { service, events, run } = createFakeAgentService();
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
    const orchestrator = createAgentOrchestrator({
      modelProvider: createModelProvider(modelOutput),
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
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      payload: { name: "create_itinerary", output: { trip: { id: "trip-1" }, itinerary: { id: "itinerary-1" } } }
    });
  });

  it("record_agent_task emits task.updated", async () => {
    const { service, events } = createFakeAgentService();
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
  });

  it("enforces map and web tool call limits", async () => {
    const registry = createAgentToolRegistry(
      [
        createSearchGooglePlacesTool({
          maps: {
            async searchPlaces() {
              return [];
            },
            async getPlaceDetails() {
              throw new Error("not used");
            },
            async estimateRoute() {
              throw new Error("not used");
            }
          }
        }),
        createWebSearchTool({
          webSearch: {
            async search() {
              return [];
            }
          }
        })
      ],
      {
        maxCallsByTool: {
          search_google_places: 1,
          web_search: 1
        }
      }
    );
    const context = createRunInput();

    await registry.execute("search_google_places", context, { query: "Cebu hotels", maxResults: 3 });
    await expect(
      registry.execute("search_google_places", context, { query: "Cebu restaurants", maxResults: 3 })
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
});
