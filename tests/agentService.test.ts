import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { subscribeToAgentRun } from "../src/modules/agent/agentEvents";
import {
  createAgentService,
  type AgentMessageRecord,
  type AgentRepository,
  type AgentRunEventRecord,
  type AgentRunRecord,
  type AgentThreadRecord
} from "../src/modules/agent/agentService";
import type { AgentEvent } from "../src/modules/agent/agentSchemas";

function createMemoryRepository(): AgentRepository & {
  threads: AgentThreadRecord[];
  messages: AgentMessageRecord[];
  runs: AgentRunRecord[];
  events: AgentRunEventRecord[];
} {
  const now = new Date("2026-04-28T00:00:00.000Z");
  const threads: AgentThreadRecord[] = [];
  const messages: AgentMessageRecord[] = [];
  const runs: AgentRunRecord[] = [];
  const events: AgentRunEventRecord[] = [];

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
    async completeRun(id, completedAt) {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run) {
        return null;
      }
      run.status = "COMPLETED";
      run.completedAt = completedAt;
      run.updatedAt = completedAt;
      return run;
    },
    async failRun(id, data) {
      const run = runs.find((candidate) => candidate.id === id);
      if (!run) {
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

  it("throws THREAD_NOT_FOUND for missing thread loads", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });

    await expect(service.getThread("agency-1", "missing-thread")).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
      statusCode: 404
    } satisfies Partial<ApiError>);
  });
});
