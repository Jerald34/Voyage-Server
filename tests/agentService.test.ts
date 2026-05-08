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
  trips: {
    id: string;
    agencyId: string;
    clientName: string | null;
    title: string;
    destinationSummary: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    budgetLevel: string | null;
  }[];
  itineraries: {
    id: string;
    tripId: string;
    agencyId: string;
    version: number;
    status: string;
  }[];
} {
  const now = new Date("2026-04-28T00:00:00.000Z");
  const threads: AgentThreadRecord[] = [];
  const messages: AgentMessageRecord[] = [];
  const runs: AgentRunRecord[] = [];
  const events: AgentRunEventRecord[] = [];
  const toolCalls: AgentToolCallRecord[] = [];
  const tasks: AgentTaskRecord[] = [];
  const sources: AgentSourceRecord[] = [];
  const trips: {
    id: string;
    agencyId: string;
    clientName: string | null;
    title: string;
    destinationSummary: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    budgetLevel: string | null;
  }[] = [];
  const itineraries: {
    id: string;
    tripId: string;
    agencyId: string;
    version: number;
    status: string;
  }[] = [];
  const isTerminalRunStatus = (status: AgentRunStatus) =>
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";

  const hydrateThread = (thread: AgentThreadRecord): AgentThreadRecord => ({
    ...thread,
    messages: messages.filter((message) => message.threadId === thread.id),
    runs: runs.filter((run) => run.threadId === thread.id),
    toolCalls: toolCalls.filter((toolCall) => toolCall.threadId === thread.id),
    tasks: tasks.filter((task) => task.threadId === thread.id),
    sources: sources.filter((source) => source.threadId === thread.id),
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
    trips,
    itineraries,
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
      return threads
        .filter((thread) => thread.agencyId === agencyId)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map(hydrateThread);
    },
    async findThreadByAgency(id, agencyId) {
      const thread = threads.find((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      return thread ? hydrateThread(thread) : null;
    },
    async deleteThreadByAgency(id, agencyId) {
      const index = threads.findIndex((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      if (index === -1) {
        return false;
      }
      threads.splice(index, 1);
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].threadId === id) messages.splice(i, 1);
      }
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        if (runs[i].threadId === id) runs.splice(i, 1);
      }
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i].threadId === id) events.splice(i, 1);
      }
      return true;
    },
    async approveItineraryThread(data) {
      const thread = threads.find(
        (candidate) => candidate.id === data.threadId && candidate.agencyId === data.agencyId
      );
      if (!thread) {
        return null;
      }
      if (thread.tripId) {
        throw new ApiError(409, "THREAD_ALREADY_BOUND", "This thread is already attached to a trip.");
      }
      const itinerary = itineraries.find(
        (candidate) =>
          candidate.id === data.input.itineraryId && candidate.agencyId === data.agencyId && candidate.status === "DRAFT"
      );
      if (!itinerary) {
        throw new ApiError(409, "DRAFT_ITINERARY_REQUIRED", "Generate an itinerary before saving this draft.");
      }
      const itineraryWasGeneratedByThread = events.some((event) => {
        if (event.threadId !== data.threadId || event.type !== "itinerary.updated") {
          return false;
        }
        const payload = event.payload;
        return (
          typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload) &&
          "itineraryId" in payload &&
          payload.itineraryId === data.input.itineraryId
        );
      });
      if (!itineraryWasGeneratedByThread) {
        throw new ApiError(409, "DRAFT_ITINERARY_REQUIRED", "Generate an itinerary before saving this draft.");
      }
      const trip = trips.find((candidate) => candidate.id === itinerary.tripId && candidate.agencyId === data.agencyId);
      if (!trip) {
        throw new ApiError(409, "DRAFT_ITINERARY_REQUIRED", "Generate an itinerary before saving this draft.");
      }

      trip.clientName = data.input.clientName;
      trip.title = `${data.input.clientName} itinerary`;
      trip.destinationSummary = data.input.destination;
      trip.startDate = data.input.startDate ?? null;
      trip.endDate = data.input.endDate ?? null;
      trip.travelerCount = data.input.travelerCount ?? null;
      trip.budgetLevel = data.input.budgetLevel ?? null;
      thread.title = data.input.clientName;
      thread.tripId = trip.id;
      thread.updatedAt = now;

      return {
        thread: hydrateThread(thread),
        trip,
        itinerary
      };
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
    async listRunEvents(runId) {
      return events
        .filter((event) => event.runId === runId)
        .sort((left, right) => left.sequence - right.sequence || left.createdAt.getTime() - right.createdAt.getTime());
    },
    async touchThread(threadId, updatedAt) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (thread) {
        thread.updatedAt = updatedAt;
      }
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
        sequence: events.filter((event) => event.runId === data.runId).length + 1,
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
        sequence: events.filter((event) => event.runId === data.runId).length + 1,
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
          sequence: events.filter((event) => event.runId === data.runId).length + 1,
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
          sequence: events.filter((event) => event.runId === run.id).length + 1,
          createdAt: now
        },
        {
          id: `event-${events.length + 2}`,
          runId: run.id,
          threadId: run.threadId,
          type: "run.completed",
          payload: { runId: run.id },
          sequence: events.filter((event) => event.runId === run.id).length + 2,
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
    const unsubscribe = subscribeToAgentRun(run.id, (published) => received.push(published.event));

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

  it("lists persisted run events for stream replay", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    await service.recordRunEvent(run, {
      type: "run.started",
      payload: { runId: run.id }
    });
    await service.recordRunEvent(run, {
      type: "message.delta",
      payload: { delta: "Drafting..." }
    });

    await expect(service.listRunEvents(run.id)).resolves.toMatchObject([
      { type: "run.started", payload: { runId: run.id } },
      { type: "message.delta", payload: { delta: "Drafting..." } }
    ]);
  });

  it("orders agency threads by latest agent activity", async () => {
    const repository = createMemoryRepository();
    let currentTime = new Date("2026-04-28T01:00:00.000Z");
    const service = createAgentService({
      repository,
      now: () => currentTime
    });
    const firstThread = await service.createThread("agency-1", "user-1", { title: "First" });
    const secondThread = await service.createThread("agency-1", "user-1", { title: "Second" });

    currentTime = new Date("2026-04-28T02:00:00.000Z");
    await service.appendUserMessageAndCreateRun("agency-1", firstThread.id, "user-1", "Plan Cebu");

    currentTime = new Date("2026-04-28T03:00:00.000Z");
    await service.appendUserMessageAndCreateRun("agency-1", secondThread.id, "user-1", "Plan Bohol");

    await expect(service.listThreads("agency-1")).resolves.toMatchObject([
      { id: secondThread.id, title: "Second" },
      { id: firstThread.id, title: "First" }
    ]);
  });

  it("deletes an agency-scoped thread", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Draft" });
    await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start draft");

    await expect(service.deleteThread("agency-1", thread.id)).resolves.toBeUndefined();

    await expect(service.getThread("agency-1", thread.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "THREAD_NOT_FOUND"
    });
    expect(repository.messages).toHaveLength(0);
    expect(repository.runs).toHaveLength(0);
  });

  it("does not delete threads outside the resolved agency", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Draft" });

    await expect(service.deleteThread("agency-2", thread.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "THREAD_NOT_FOUND"
    });
    await expect(service.getThread("agency-1", thread.id)).resolves.toMatchObject({ id: thread.id });
  });

  it("does not fail durable agent writes when thread freshness update fails", async () => {
    const repository = createMemoryRepository();
    repository.touchThread = async () => {
      throw new Error("touch failed");
    };
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });

    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    await expect(
      service.recordRunEvent(run, {
        type: "run.started",
        payload: { runId: run.id }
      })
    ).resolves.toMatchObject({
      type: "run.started"
    });

    expect(repository.messages).toHaveLength(1);
    expect(repository.runs).toHaveLength(1);
    expect(repository.events).toHaveLength(1);
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
    const unsubscribeReceiving = subscribeToAgentRun(run.id, (published) => received.push(published.event));

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

  it("approves a draft itinerary thread by updating the draft trip and binding the thread", async () => {
    const repository = createMemoryRepository();
    const touchedAt = new Date("2026-04-28T04:00:00.000Z");
    const service = createAgentService({ repository, now: () => touchedAt });
    const thread = await service.createThread("agency-1", "user-1", { title: "Draft itinerary" });
    repository.trips.push({
      id: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      clientName: null,
      title: "Untitled draft",
      destinationSummary: null,
      startDate: null,
      endDate: null,
      travelerCount: null,
      budgetLevel: null
    });
    repository.itineraries.push({
      id: "00000000-0000-4000-8000-000000000201",
      tripId: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      version: 2,
      status: "DRAFT"
    });
    repository.events.push({
      id: "event-itinerary-1",
      runId: "run-itinerary-1",
      threadId: thread.id,
      type: "itinerary.updated",
      payload: {
        itineraryId: "00000000-0000-4000-8000-000000000201"
      },
      sequence: 1,
      createdAt: new Date("2026-04-28T03:00:00.000Z")
    });

    const approved = await service.approveItineraryThread("agency-1", thread.id, {
      itineraryId: "00000000-0000-4000-8000-000000000201",
      clientName: "  Santos Family  ",
      destination: "Olongapo City and Subic Bay",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      travelerCount: 4,
      budgetLevel: "midrange"
    });

    expect(approved.thread).toMatchObject({
      id: thread.id,
      agencyId: "agency-1",
      title: "Santos Family",
      tripId: "00000000-0000-4000-8000-000000000101"
    });
    expect(approved.trip).toMatchObject({
      id: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      clientName: "Santos Family",
      title: "Santos Family itinerary",
      destinationSummary: "Olongapo City and Subic Bay",
      travelerCount: 4,
      budgetLevel: "midrange"
    });
    expect(approved.trip.startDate).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    expect(approved.trip.endDate).toEqual(new Date("2026-06-05T00:00:00.000Z"));
    expect(approved.itinerary).toMatchObject({
      id: "00000000-0000-4000-8000-000000000201",
      tripId: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      version: 2,
      status: "DRAFT"
    });
    expect(repository.threads[0]).toMatchObject({
      title: "Santos Family",
      tripId: "00000000-0000-4000-8000-000000000101",
      updatedAt: touchedAt
    });
  });

  it("rejects approving a same-agency itinerary generated by another thread", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const producerThread = await service.createThread("agency-1", "user-1", { title: "Producer draft" });
    const approvingThread = await service.createThread("agency-1", "user-1", { title: "Approving draft" });
    repository.trips.push({
      id: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      clientName: null,
      title: "Untitled draft",
      destinationSummary: null,
      startDate: null,
      endDate: null,
      travelerCount: null,
      budgetLevel: null
    });
    repository.itineraries.push({
      id: "00000000-0000-4000-8000-000000000201",
      tripId: "00000000-0000-4000-8000-000000000101",
      agencyId: "agency-1",
      version: 1,
      status: "DRAFT"
    });
    repository.events.push({
      id: "event-itinerary-1",
      runId: "run-itinerary-1",
      threadId: producerThread.id,
      type: "itinerary.updated",
      payload: {
        itineraryId: "00000000-0000-4000-8000-000000000201"
      },
      sequence: 1,
      createdAt: new Date("2026-04-28T03:00:00.000Z")
    });

    await expect(
      service.approveItineraryThread("agency-1", approvingThread.id, {
        itineraryId: "00000000-0000-4000-8000-000000000201",
        clientName: "Santos Family",
        destination: "Olongapo City"
      })
    ).rejects.toMatchObject({
      code: "DRAFT_ITINERARY_REQUIRED",
      statusCode: 409,
      message: "Generate an itinerary before saving this draft."
    } satisfies Partial<ApiError>);
    expect(repository.threads[1]?.tripId).toBeNull();
  });

  it("rejects approving a thread from the wrong agency", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Draft itinerary" });

    await expect(
      service.approveItineraryThread("agency-2", thread.id, {
        itineraryId: "00000000-0000-4000-8000-000000000201",
        clientName: "Santos Family",
        destination: "Olongapo City"
      })
    ).rejects.toMatchObject({
      code: "THREAD_NOT_FOUND",
      statusCode: 404
    } satisfies Partial<ApiError>);
  });

  it("rejects approving a thread without a draft itinerary", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Draft itinerary" });

    await expect(
      service.approveItineraryThread("agency-1", thread.id, {
        itineraryId: "00000000-0000-4000-8000-000000000201",
        clientName: "Santos Family",
        destination: "Olongapo City"
      })
    ).rejects.toMatchObject({
      code: "DRAFT_ITINERARY_REQUIRED",
      statusCode: 409,
      message: "Generate an itinerary before saving this draft."
    } satisfies Partial<ApiError>);
  });
});
