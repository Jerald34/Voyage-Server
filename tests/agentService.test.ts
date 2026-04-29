import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { formatSseEvent, subscribeToAgentRun } from "../src/modules/agent/agentEvents";
import {
  createAgentService,
  type AgentMessageRecord,
  type AgentRepository,
  type AgentRunEventRecord,
  type AgentSourceRecord,
  type AgentTaskRecord,
  type AgentToolCallRecord,
  type AgentRunRecord,
  type AgentRunStatus,
  type AgentThreadRecord
} from "../src/modules/agent/agentService";
import type { AgentEvent } from "../src/modules/agent/agentSchemas";

function createMemoryRepository(): AgentRepository & {
  threads: AgentThreadRecord[];
  messages: AgentMessageRecord[];
  runs: AgentRunRecord[];
  events: AgentRunEventRecord[];
  toolCalls: AgentToolCallRecord[];
  tasks: AgentTaskRecord[];
  sources: AgentSourceRecord[];
} {
  const now = new Date("2026-04-28T00:00:00.000Z");
  const threads: AgentThreadRecord[] = [];
  const messages: AgentMessageRecord[] = [];
  const runs: AgentRunRecord[] = [];
  const events: AgentRunEventRecord[] = [];
  const toolCalls: AgentToolCallRecord[] = [];
  const tasks: AgentTaskRecord[] = [];
  const sources: AgentSourceRecord[] = [];
  const isTerminalRunStatus = (status: AgentRunStatus) =>
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";

  const hydrateThread = (thread: AgentThreadRecord): AgentThreadRecord => ({
    ...thread,
    messages: messages.filter((message) => message.threadId === thread.id),
    runs: runs.filter((run) => run.threadId === thread.id),
    events: events.filter((event) => event.threadId === thread.id)
  });

  return {
    threads,
    messages,
    runs,
    events,
    toolCalls,
    tasks,
    sources,
    async createThread(data) {
      const thread: AgentThreadRecord = {
        id: `thread-${threads.length + 1}`,
        agencyId: data.agencyId,
        tripId: data.tripId ?? null,
        createdByUserId: data.createdByUserId,
        title: data.title,
        status: "ACTIVE",
        messages: [],
        runs: [],
        toolCalls: [],
        tasks: [],
        sources: [],
        events: [],
        createdAt: now,
        updatedAt: now
      };
      threads.push(thread);
      return hydrateThread(thread);
    },
    async listThreadsByAgency(agencyId) {
      return threads.filter((thread) => thread.agencyId === agencyId).map(hydrateThread);
    },
    async findThreadByAgency(id, agencyId) {
      const thread = threads.find((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      return thread ? hydrateThread(thread) : null;
    },
    async createMessage(data) {
      const message: AgentMessageRecord = {
        id: `message-${messages.length + 1}`,
        threadId: data.threadId,
        runId: data.runId ?? null,
        authorUserId: data.authorUserId ?? null,
        role: data.role,
        content: data.content,
        metadata: data.metadata ?? null,
        createdAt: now
      };
      messages.push(message);
      return message;
    },
    async createRun(data) {
      const run: AgentRunRecord = {
        id: `run-${runs.length + 1}`,
        threadId: data.threadId,
        agencyId: data.agencyId,
        triggerMessageId: data.triggerMessageId ?? null,
        status: "QUEUED",
        modelProvider: data.modelProvider,
        modelName: data.modelName,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now
      };
      runs.push(run);
      return run;
    },
    async createUserMessageAndRun(data) {
      const message = await this.createMessage({
        threadId: data.threadId,
        authorUserId: data.authorUserId,
        role: "USER",
        content: data.content
      });
      const run = await this.createRun({
        threadId: data.threadId,
        agencyId: data.agencyId,
        triggerMessageId: message.id,
        modelProvider: data.modelProvider,
        modelName: data.modelName
      });
      return { message, run };
    },
    async findRunById(id) {
      return runs.find((run) => run.id === id) ?? null;
    },
    async startRun(id, startedAt) {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run || run.status !== "QUEUED") {
        return null;
      }
      run.status = "RUNNING";
      run.startedAt = startedAt;
      run.updatedAt = startedAt;
      return run;
    },
    async createRunEvent(data) {
      const event: AgentRunEventRecord = {
        id: `event-${events.length + 1}`,
        runId: data.runId,
        threadId: data.threadId,
        type: data.type,
        payload: data.payload,
        createdAt: now
      };
      events.push(event);
      return event;
    },
    async createToolCall(data) {
      const toolCall: AgentToolCallRecord = {
        id: `tool-call-${toolCalls.length + 1}`,
        runId: data.runId,
        threadId: data.threadId,
        toolName: data.toolName,
        status: data.status,
        input: data.input ?? null,
        outputSummary: data.outputSummary ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: now
      };
      toolCalls.push(toolCall);
      return toolCall;
    },
    async updateToolCall(id, data) {
      const toolCall = toolCalls.find((candidate) => candidate.id === id);
      if (!toolCall) {
        return null;
      }
      toolCall.status = data.status;
      toolCall.outputSummary = data.outputSummary ?? toolCall.outputSummary;
      toolCall.errorCode = data.errorCode ?? toolCall.errorCode;
      toolCall.errorMessage = data.errorMessage ?? toolCall.errorMessage;
      toolCall.completedAt = data.completedAt ?? toolCall.completedAt;
      return toolCall;
    },
    async createTaskAndEvent(data) {
      const sortOrder =
        data.sortOrder ?? tasks.filter((task) => task.runId === data.runId).reduce((max, task) => Math.max(max, task.sortOrder), 0) + 1;
      const task: AgentTaskRecord = {
        id: `task-${tasks.length + 1}`,
        runId: data.runId,
        threadId: data.threadId,
        label: data.label,
        status: data.status,
        sortOrder,
        createdAt: now,
        updatedAt: now
      };
      tasks.push(task);
      const event: AgentRunEventRecord = {
        id: `event-${events.length + 1}`,
        runId: data.runId,
        threadId: data.threadId,
        type: "task.updated",
        payload: {
          label: task.label,
          status: task.status,
          sortOrder: task.sortOrder
        },
        createdAt: now
      };
      events.push(event);
      return { task, event };
    },
    async createSourcesAndEvents(data) {
      const created: AgentSourceRecord[] = data.sources.map((source, index) => ({
        id: `source-${sources.length + index + 1}`,
        runId: data.runId,
        threadId: data.threadId,
        sourceType: source.sourceType,
        title: source.title,
        url: source.url ?? null,
        snippet: source.snippet ?? null,
        provider: source.provider,
        retrievedAt: source.retrievedAt,
        metadata: source.metadata ?? null,
        createdAt: now
      }));
      sources.push(...created);
      const createdEvents = created.map((source) => {
        const event: AgentRunEventRecord = {
          id: `event-${events.length + 1}`,
          runId: data.runId,
          threadId: data.threadId,
          type: "source.added",
          payload: {
            sourceType: source.sourceType,
            title: source.title,
            url: source.url,
            snippet: source.snippet
          },
          createdAt: now
        };
        events.push(event);
        return event;
      });
      return { sources: created, events: createdEvents };
    },
    async completeRunIfOpen(id, data) {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run) {
        return null;
      }
      if (isTerminalRunStatus(run.status)) {
        return null;
      }
      run.status = "COMPLETED";
      run.completedAt = data.completedAt;
      run.updatedAt = data.completedAt;
      const message = await this.createMessage({
        threadId: run.threadId,
        runId: run.id,
        role: "ASSISTANT",
        content: data.assistantContent
      });
      const completedEvents: AgentRunEventRecord[] = [
        {
          id: `event-${events.length + 1}`,
          runId: run.id,
          threadId: run.threadId,
          type: "message.completed",
          payload: { messageId: message.id, content: data.assistantContent },
          createdAt: now
        },
        {
          id: `event-${events.length + 2}`,
          runId: run.id,
          threadId: run.threadId,
          type: "run.completed",
          payload: { runId: run.id },
          createdAt: now
        }
      ];
      events.push(...completedEvents);
      return { run, message, events: completedEvents };
    },
    async failRunIfOpen(id, data) {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run) {
        return null;
      }
      if (isTerminalRunStatus(run.status)) {
        return null;
      }
      run.status = "FAILED";
      run.failedAt = data.failedAt;
      run.errorCode = data.errorCode;
      run.errorMessage = data.errorMessage;
      run.updatedAt = data.failedAt;
      return run;
    }
  };
}

describe("agent service", () => {
  it("creates a thread with agency, user, title, and trip", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });

    const thread = await service.createThread("agency-1", "user-1", {
      title: "Cebu planning",
      tripId: "00000000-0000-4000-8000-000000000001"
    });

    expect(thread).toMatchObject({
      id: "thread-1",
      agencyId: "agency-1",
      createdByUserId: "user-1",
      title: "Cebu planning",
      tripId: "00000000-0000-4000-8000-000000000001",
      status: "ACTIVE"
    });
    expect(repository.threads).toHaveLength(1);
  });

  it("appends a user message and creates a queued run", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({
      repository,
      modelProvider: "openai",
      modelName: "gpt-test"
    });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });

    const result = await service.appendUserMessageAndCreateRun(
      "agency-1",
      thread.id,
      "user-2",
      "Build a 3-day itinerary."
    );

    expect(result.message).toMatchObject({
      id: "message-1",
      threadId: thread.id,
      authorUserId: "user-2",
      role: "USER",
      content: "Build a 3-day itinerary."
    });
    expect(result.run).toMatchObject({
      id: "run-1",
      threadId: thread.id,
      agencyId: "agency-1",
      triggerMessageId: "message-1",
      status: "QUEUED",
      modelProvider: "openai",
      modelName: "gpt-test"
    });
  });

  it("marks a queued run running with startedAt", async () => {
    const repository = createMemoryRepository();
    const now = new Date("2026-04-28T01:02:03.000Z");
    const service = createAgentService({ repository, now: () => now });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    const started = await service.startRun(run.id);

    expect(started).toMatchObject({
      id: run.id,
      status: "RUNNING",
      startedAt: now
    });
    expect(repository.runs[0]).toMatchObject({
      status: "RUNNING",
      startedAt: now
    });
  });

  it("rejects starting a finished run", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    await service.completeRun(run.id, "Here is the itinerary.");
    await expect(service.startRun(run.id)).rejects.toMatchObject({
      code: "AGENT_RUN_ALREADY_FINISHED",
      statusCode: 409
    } satisfies Partial<ApiError>);
  });

  it("persists and publishes run events", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    const received: AgentEvent[] = [];
    const unsubscribe = subscribeToAgentRun(run.id, (event) => received.push(event));

    const event = await service.recordRunEvent(run, {
      type: "task.updated",
      payload: { label: "Research hotels", status: "RUNNING" }
    });
    unsubscribe();

    expect(event).toMatchObject({
      id: "event-1",
      runId: run.id,
      threadId: thread.id,
      type: "task.updated",
      payload: { label: "Research hotels", status: "RUNNING" }
    });
    expect(repository.events).toHaveLength(1);
    expect(received).toEqual([
      {
        type: "task.updated",
        payload: { label: "Research hotels", status: "RUNNING" }
      }
    ]);
  });

  it("assigns distinct sortOrder values when record_task omits sortOrder", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    const first = await service.recordTask(run, {
      label: "Research hotels",
      status: "RUNNING"
    });
    const second = await service.recordTask(run, {
      label: "Book transfers",
      status: "PENDING"
    });

    expect(first.sortOrder).toBe(1);
    expect(second.sortOrder).toBe(2);
    expect(repository.tasks.map((task) => task.sortOrder)).toEqual([1, 2]);
    expect(repository.events.map((event) => event.type)).toEqual(["task.updated", "task.updated"]);
    expect(repository.events.map((event) => event.payload)).toEqual([
      { label: "Research hotels", status: "RUNNING", sortOrder: 1 },
      { label: "Book transfers", status: "PENDING", sortOrder: 2 }
    ]);
  });

  it("records source events along with source rows", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    const created = await service.recordSources(run, [
      {
        sourceType: "WEB",
        title: "Cebu trip ideas",
        url: "https://example.com/cebu",
        snippet: "A short result",
        provider: "google_custom_search",
        retrievedAt: new Date("2026-04-28T02:00:00.000Z")
      }
    ]);

    expect(created).toHaveLength(1);
    expect(repository.sources).toHaveLength(1);
    expect(repository.events).toEqual([
      expect.objectContaining({
        type: "source.added",
        payload: {
          sourceType: "WEB",
          title: "Cebu trip ideas",
          url: "https://example.com/cebu",
          snippet: "A short result"
        }
      })
    ]);
  });

  it("marks a run complete and creates an assistant message", async () => {
    const repository = createMemoryRepository();
    const now = new Date("2026-04-28T01:02:03.000Z");
    const service = createAgentService({ repository, now: () => now });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    const result = await service.completeRun(run.id, "Here is the itinerary.");

    expect(result.run).toMatchObject({
      id: run.id,
      status: "COMPLETED",
      completedAt: now
    });
    expect(result.message).toMatchObject({
      id: "message-2",
      threadId: thread.id,
      runId: run.id,
      role: "ASSISTANT",
      content: "Here is the itinerary."
    });
    expect(repository.events.map((event) => event.type)).toEqual(["message.completed", "run.completed"]);
  });

  it("rejects duplicate completion without duplicating assistant messages or events", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    await service.completeRun(run.id, "Here is the itinerary.");
    await expect(service.completeRun(run.id, "Duplicate itinerary.")).rejects.toMatchObject({
      code: "AGENT_RUN_ALREADY_FINISHED",
      statusCode: 409,
      message: "Agent run is already finished."
    } satisfies Partial<ApiError>);

    expect(repository.messages.filter((message) => message.role === "ASSISTANT")).toHaveLength(1);
    expect(repository.events.map((event) => event.type)).toEqual(["message.completed", "run.completed"]);
  });

  it("rejects failing a completed run without adding failure events", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    await service.completeRun(run.id, "Here is the itinerary.");
    await expect(service.failRun(run.id, "MODEL_ERROR", "Model request failed.")).rejects.toMatchObject({
      code: "AGENT_RUN_ALREADY_FINISHED",
      statusCode: 409
    } satisfies Partial<ApiError>);

    expect(repository.runs[0]).toMatchObject({
      status: "COMPLETED",
      errorCode: null,
      errorMessage: null
    });
    expect(repository.events.map((event) => event.type)).toEqual(["message.completed", "run.completed"]);
  });

  it("marks a run failed with code and message", async () => {
    const repository = createMemoryRepository();
    const now = new Date("2026-04-28T01:02:03.000Z");
    const service = createAgentService({ repository, now: () => now });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    const failed = await service.failRun(run.id, "MODEL_ERROR", "Model request failed.");

    expect(failed).toMatchObject({
      id: run.id,
      status: "FAILED",
      failedAt: now,
      errorCode: "MODEL_ERROR",
      errorMessage: "Model request failed."
    });
    expect(repository.events).toMatchObject([
      {
        runId: run.id,
        threadId: thread.id,
        type: "run.failed",
        payload: {
          code: "MODEL_ERROR",
          message: "Model request failed."
        }
      }
    ]);
  });

  it("rejects completing a failed run without adding assistant messages", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    await service.failRun(run.id, "MODEL_ERROR", "Model request failed.");
    await expect(service.completeRun(run.id, "Late itinerary.")).rejects.toMatchObject({
      code: "AGENT_RUN_ALREADY_FINISHED",
      statusCode: 409
    } satisfies Partial<ApiError>);

    expect(repository.runs[0]).toMatchObject({
      status: "FAILED",
      completedAt: null
    });
    expect(repository.messages.filter((message) => message.role === "ASSISTANT")).toHaveLength(0);
    expect(repository.events.map((event) => event.type)).toEqual(["run.failed"]);
  });

  it("publishes run events to remaining listeners when one listener throws", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    const received: AgentEvent[] = [];
    const unsubscribeThrowing = subscribeToAgentRun(run.id, () => {
      throw new Error("subscriber failed");
    });
    const unsubscribeReceiving = subscribeToAgentRun(run.id, (event) => received.push(event));

    await expect(
      service.recordRunEvent(run, {
        type: "task.updated",
        payload: { label: "Research hotels", status: "RUNNING" }
      })
    ).resolves.toMatchObject({
      type: "task.updated"
    });
    unsubscribeThrowing();
    unsubscribeReceiving();

    expect(repository.events).toHaveLength(1);
    expect(received).toEqual([
      {
        type: "task.updated",
        payload: { label: "Research hotels", status: "RUNNING" }
      }
    ]);
  });

  it("formats agent events for server-sent events", () => {
    expect(
      formatSseEvent({
        type: "run.completed",
        payload: { runId: "run-1" }
      })
    ).toBe('event: run.completed\ndata: {"type":"run.completed","payload":{"runId":"run-1"}}\n\n');
  });

  it("throws THREAD_NOT_FOUND for missing thread loads", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });

    await expect(service.getThread("agency-1", "missing-thread")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
      statusCode: 404
    } satisfies Partial<ApiError>);
  });
});
