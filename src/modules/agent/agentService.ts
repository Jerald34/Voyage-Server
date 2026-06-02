import { ApiError } from "../../http/errors";
import { publishAgentRunEvent } from "./agentEvents";
import { agentLogger } from "./agentLogger";
import {
  agentEventSchema,
  saveItineraryThreadSchema,
  createMessageSchema,
  createThreadSchema,
  updateThreadTitleSchema,
  type AgentEvent
} from "./agentSchemas";
import {
  deriveTitleFromMessage,
  deriveTitleFromItineraryPayload
} from "./agentThreadTitler";
import type {
  AgentRepository,
  AgentRunRecord,
  AgentRunEventRecord,
  AgentToolCallInput,
  AgentTaskInput,
  AgentTaskUpdateInput,
  AgentTaskRecord,
  AgentSourceInput,
  AgentRunStatus,
  CompleteRunUsage
} from "./agentTypes";
import { createPrismaAgentRepository } from "./agentRepository";

// ---------------------------------------------------------------------------
// ProcessSnapshot — server-side representation of a completed run's process.
// Mirrors the client-side shape expected by ProcessBubble.
// ---------------------------------------------------------------------------

type ProcessTimelineEntry =
  | { id: string; kind: "thought"; text: string }
  | { id: string; kind: "tool"; name: string };

export type ProcessSnapshot = {
  status: "done";
  activeLabel: string;
  timeline: ProcessTimelineEntry[];
  tasks: Array<{ id: string; label: string; status: string }>;
  durationMs: number | null;
  defaultOpen: false;
};

function humanizeToolName(name: string): string {
  return String(name ?? "")
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarizeTimeline(timeline: ProcessTimelineEntry[], durationMs: number | null): string {
  const durationStr =
    durationMs != null ? (durationMs / 1000).toFixed(1) + "s" : "-";

  const toolEntries = timeline.filter((e): e is { id: string; kind: "tool"; name: string } => e.kind === "tool");

  if (toolEntries.length === 0) {
    return `Thought for ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((e) => e.name === "map_pinpoint");
  if (hasMapPinpoint) {
    return `Researched ${toolEntries.length} places · ${durationStr}`;
  }

  const allAddItem = toolEntries.every((e) => e.name === "add_itinerary_item");
  if (allAddItem) {
    if (toolEntries.length >= 3) {
      return `Built itinerary · ${durationStr}`;
    }
    return `Added ${toolEntries.length} items · ${durationStr}`;
  }

  return `Worked for ${durationStr}`;
}

function buildProcessSnapshot(
  runEvents: AgentRunEventRecord[],
  startedAt: Date | null,
  completedAt: Date,
  tasks: AgentTaskRecord[] = []
): ProcessSnapshot | null {
  const timeline: ProcessTimelineEntry[] = [];
  let currentThoughtText: string | null = null;
  let thoughtIndex = 0;
  let toolIndex = 0;

  // Track whether the previous event was a tool boundary (tool.started, tool.completed, tool.failed)
  // to decide when to start a new thought entry.
  let atToolBoundary = true; // true at start so first thought begins a new entry

  const sorted = [...runEvents].sort((a, b) => a.sequence - b.sequence);

  // Collect task ids touched during this run via task.updated events.
  const runTouchedTaskIds = new Set<string>();
  for (const event of sorted) {
    if (event.type === "task.updated") {
      const id = typeof event.payload?.id === "string" ? event.payload.id : null;
      if (id) runTouchedTaskIds.add(id);
    }
  }

  for (const event of sorted) {
    if (event.type === "tool.started") {
      // Flush any accumulated thought text before the tool.
      if (currentThoughtText !== null && currentThoughtText.trim()) {
        thoughtIndex += 1;
        timeline.push({ id: `thought-${thoughtIndex}`, kind: "thought", text: currentThoughtText });
      }
      currentThoughtText = null;
      atToolBoundary = true;

      const name =
        typeof event.payload.name === "string" ? event.payload.name : humanizeToolName(String(event.payload.name ?? ""));
      toolIndex += 1;
      timeline.push({ id: `tool-${event.sequence}`, kind: "tool", name });
    } else if (event.type === "tool.completed" || event.type === "tool.failed") {
      // Flush thought if any accumulated before this boundary.
      if (currentThoughtText !== null && currentThoughtText.trim()) {
        thoughtIndex += 1;
        timeline.push({ id: `thought-${thoughtIndex}`, kind: "thought", text: currentThoughtText });
      }
      currentThoughtText = null;
      atToolBoundary = true;
    } else if (event.type === "thought.delta") {
      const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
      if (atToolBoundary || currentThoughtText === null) {
        currentThoughtText = delta;
        atToolBoundary = false;
      } else {
        currentThoughtText += delta;
      }
    }
    // All other event types are ignored.
  }

  // Flush any trailing thought.
  if (currentThoughtText !== null && currentThoughtText.trim()) {
    thoughtIndex += 1;
    timeline.push({ id: `thought-${thoughtIndex}`, kind: "thought", text: currentThoughtText });
  }

  // Skip snapshot entirely if timeline is empty.
  if (timeline.length === 0) {
    return null;
  }

  const durationMs =
    startedAt != null ? completedAt.getTime() - startedAt.getTime() : null;

  const tasksForSnapshot = tasks
    .filter(t => runTouchedTaskIds.has(t.id))
    .map(t => ({ id: t.id, label: t.label, status: t.status }));

  return {
    status: "done",
    activeLabel: summarizeTimeline(timeline, durationMs),
    timeline,
    tasks: tasksForSnapshot,
    durationMs,
    defaultOpen: false
  };
}

const TERMINAL_RUN_STATUSES: AgentRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

function isTerminalRunStatus(status: AgentRunStatus) {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function createAgentService(options: {
  repository: AgentRepository;
  now?: () => Date;
  modelProvider?: string;
  modelName?: string;
}) {
  const now = options.now ?? (() => new Date());
  const modelProvider = options.modelProvider ?? "openai";
  const modelName = options.modelName ?? "gpt-5-mini";

  /**
   * F2: When agencyId is provided, only returns the run if it belongs to that
   * agency. Returns 404 RUN_NOT_FOUND for both "not found" and "wrong agency"
   * cases to avoid exposing which run IDs exist in other tenants (mirrors the
   * thread-level findThreadByAgency 404 behaviour).
   */
  async function getRun(runId: string, agencyId?: string | null) {
    const run = await options.repository.findRunById(runId, agencyId);
    if (!run) {
      throw new ApiError(404, "RUN_NOT_FOUND", "Agent run not found.");
    }
    return run;
  }

  function assertRunOpen(run: AgentRunRecord) {
    if (isTerminalRunStatus(run.status)) {
      throw new ApiError(409, "AGENT_RUN_ALREADY_FINISHED", "Agent run is already finished.");
    }
  }

  function summarizeValue(value: unknown) {
    if (value === undefined) {
      return null;
    }

    try {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (text === undefined) {
        return null;
      }
      return text.length > 500 ? `${text.slice(0, 497)}...` : text;
    } catch {
      const text = String(value);
      return text.length > 500 ? `${text.slice(0, 497)}...` : text;
    }
  }

  async function touchThread(threadId: string) {
    try {
      await options.repository.touchThread?.(threadId, now());
    } catch {
      // Thread freshness should not fail the durable agent write that already succeeded.
    }
  }

  // Leading-edge debounce: fires immediately on the first call, then suppresses
  // subsequent calls for the same threadId within the debounce window.  Terminal
  // operations (completeRun, failRun) still call `await touchThread()` directly
  // to guarantee the final timestamp is flushed.
  const TOUCH_DEBOUNCE_MS = 2000;
  const _lastTouchMs = new Map<string, number>();

  function debouncedTouchThread(threadId: string) {
    const last = _lastTouchMs.get(threadId) ?? 0;
    if (Date.now() - last < TOUCH_DEBOUNCE_MS) return;
    _lastTouchMs.set(threadId, Date.now());
    touchThread(threadId).catch(() => {});
  }

  async function maybeRenameFromFirstMessage(threadId: string, content: string) {
    try {
      const result = await options.repository.listThreadMessages({
        threadId,
        agencyId: null,
        cursor: null,
        limit: 2
      });
      const userCount = (result?.messages ?? []).filter((m) => m.role === "USER").length;
      if (userCount !== 1) return; // bail if this isn't the first user message
      const derived = deriveTitleFromMessage(content);
      if (!derived) return;
      await options.repository.updateThreadTitle({ threadId, title: derived, manual: false });
    } catch {
      // best-effort; never block the user write
    }
  }

  async function maybeRenameFromItineraryEvent(threadId: string, event: AgentEvent) {
    if (event.type !== "itinerary.created" && event.type !== "itinerary.updated") return;
    const derived = deriveTitleFromItineraryPayload(event.payload);
    if (!derived) return;
    try {
      await options.repository.updateThreadTitle({ threadId, title: derived, manual: false });
    } catch {
      // best-effort
    }
  }

  return {
    async createThread(agencyId: string, userId: string, input: unknown) {
      const parsed = createThreadSchema.parse(input);
      return options.repository.createThread({
        agencyId,
        createdByUserId: userId,
        title: parsed.title?.trim() || "New agent thread",
        tripId: parsed.tripId ?? null
      });
    },

    async listThreads(agencyId: string) {
      return options.repository.listThreadsByAgency(agencyId);
    },

    async getThread(agencyId: string | null, threadId: string) {
      const thread = await options.repository.findThreadByAgency(threadId, agencyId);
      if (!thread) {
        throw new ApiError(404, "THREAD_NOT_FOUND", "Agent thread not found.");
      }
      return thread;
    },

    async deleteThread(agencyId: string, threadId: string) {
      const deleted = await options.repository.deleteThreadByAgency(threadId, agencyId);
      if (!deleted) {
        throw new ApiError(404, "THREAD_NOT_FOUND", "Agent thread not found.");
      }
    },

    async saveItineraryThread(agencyId: string, threadId: string, input: unknown) {
      const parsed = saveItineraryThreadSchema.parse(input);
      const thread = await this.getThread(agencyId, threadId);
      if (thread.tripId) {
        throw new ApiError(409, "THREAD_ALREADY_BOUND", "This thread is already attached to a trip.");
      }

      const saved = await options.repository.saveItineraryThread({
        agencyId,
        threadId,
        input: parsed
      });
      if (!saved) {
        throw new ApiError(404, "THREAD_NOT_FOUND", "Agent thread not found.");
      }

      await touchThread(threadId);
      return saved;
    },

    async updateThreadTitle(agencyId: string, threadId: string, input: unknown) {
      const parsed = updateThreadTitleSchema.parse(input);
      await this.getThread(agencyId, threadId); // 404 if cross-agency
      const updated = await options.repository.updateThreadTitle({
        threadId,
        title: parsed.title,
        manual: true
      });
      if (!updated) {
        throw new ApiError(404, "THREAD_NOT_FOUND", "Agent thread not found.");
      }
      return updated;
    },

    async appendUserMessageAndCreateRun(
      agencyId: string,
      threadId: string,
      userId: string,
      content: string,
      imageUrls?: string[]
    ) {
      const parsed = createMessageSchema.parse({ content, imageUrls });
      await this.getThread(agencyId, threadId);
      const metadata = parsed.imageUrls?.length ? { imageUrls: parsed.imageUrls } : undefined;
      const result = await options.repository.createUserMessageAndRun({
        agencyId,
        threadId,
        authorUserId: userId,
        content: parsed.content,
        metadata,
        modelProvider,
        modelName
      });
      await touchThread(threadId);
      await maybeRenameFromFirstMessage(threadId, parsed.content);
      return result;
    },

    async startRun(runId: string, startedAtOverride?: Date, agencyId?: string | null) {
      // F2: Pass agencyId to scope the run lookup to the calling agency.
      const run = await getRun(runId, agencyId);
      assertRunOpen(run);

      const startedAt = startedAtOverride ?? now();
      const startedRun = await options.repository.startRun(runId, startedAt);
      if (startedRun) {
        await touchThread(startedRun.threadId);
        return startedRun;
      }

      const current = await getRun(runId);
      if (current.status === "RUNNING") {
        return current;
      }

      assertRunOpen(current);
      throw new ApiError(409, "AGENT_RUN_ALREADY_FINISHED", "Agent run is already finished.");
    },

    async recordRunEvent(run: AgentRunRecord, event: AgentEvent) {
      const parsed = agentEventSchema.parse(event);
      const persisted = await options.repository.createRunEvent({
        runId: run.id,
        threadId: run.threadId,
        type: parsed.type,
        payload: parsed.payload
      });
      debouncedTouchThread(run.threadId);
      publishAgentRunEvent(run.id, parsed, persisted.id);
      await maybeRenameFromItineraryEvent(run.threadId, parsed);
      return persisted;
    },

    async listRunEvents(runId: string, agencyId?: string | null) {
      // F2: Scope the run lookup to the calling agency before returning events.
      await getRun(runId, agencyId);
      return options.repository.listRunEvents(runId);
    },

    async recordToolCallStarted(run: AgentRunRecord, input: AgentToolCallInput, startedAt = now()) {
      agentLogger.toolStart(input.toolName, input.input);
      const toolCall = await options.repository.createToolCall({
        runId: run.id,
        threadId: run.threadId,
        toolName: input.toolName,
        status: "RUNNING",
        input: input.input,
        startedAt
      });
      debouncedTouchThread(run.threadId);
      return toolCall;
    },

    async completeToolCall(toolCallId: string, output: unknown, completedAt = now()) {
      const summary = summarizeValue(output);
      const toolCall = await options.repository.updateToolCall(toolCallId, {
        status: "COMPLETED",
        outputSummary: summary,
        completedAt
      });
      if (toolCall) {
        agentLogger.toolSuccess(toolCallId, toolCall.toolName, summary);
        debouncedTouchThread(toolCall.threadId);
      }
      return toolCall;
    },

    async failToolCall(toolCallId: string, code: string, message: string, completedAt = now()) {
      const toolCall = await options.repository.updateToolCall(toolCallId, {
        status: "FAILED",
        errorCode: code,
        errorMessage: message,
        completedAt
      });
      if (toolCall) {
        agentLogger.toolFail(toolCallId, toolCall.toolName, code, message);
        debouncedTouchThread(toolCall.threadId);
      }
      return toolCall;
    },

    async recordTask(run: AgentRunRecord, input: AgentTaskInput) {
      const { task, event } = await options.repository.createTaskAndEvent({
        runId: run.id,
        threadId: run.threadId,
        label: input.label,
        status: input.status,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {})
      });
      debouncedTouchThread(run.threadId);
      publishAgentRunEvent(run.id, { type: event.type, payload: event.payload }, event.id);

      return task;
    },

    async updateTask(run: AgentRunRecord, input: { id: string } & AgentTaskUpdateInput) {
      const { task, event } = await options.repository.updateTaskAndEvent({
        id: input.id,
        runId: run.id,
        threadId: run.threadId,
        patch: { label: input.label, status: input.status, sortOrder: input.sortOrder }
      });
      debouncedTouchThread(run.threadId);
      publishAgentRunEvent(run.id, { type: event.type, payload: event.payload }, event.id);
      return task;
    },

    async listOpenTasksForThread(threadId: string) {
      return options.repository.listForThread(threadId, { openOnly: true });
    },

    async recordSources(run: AgentRunRecord, sources: AgentSourceInput[]) {
      const { sources: created, events } = await options.repository.createSourcesAndEvents({
        runId: run.id,
        threadId: run.threadId,
        sources
      });
      debouncedTouchThread(run.threadId);

      for (const event of events) {
        publishAgentRunEvent(run.id, { type: event.type, payload: event.payload }, event.id);
      }

      return created;
    },

    async completeRun(runId: string, assistantContent: string, usage?: CompleteRunUsage) {
      agentLogger.agentResponse(runId, assistantContent);
      const run = await getRun(runId);
      assertRunOpen(run);
      const completedAt = now();

      // Compute the process snapshot from persisted run events before writing the message.
      let processSnapshot: ProcessSnapshot | null = null;
      try {
        const runEvents = await options.repository.listRunEvents(runId);
        let tasks: AgentTaskRecord[] = [];
        try {
          tasks = await options.repository.listForThread(run.threadId, { openOnly: false });
        } catch {
          // best-effort
        }
        processSnapshot = buildProcessSnapshot(runEvents, run.startedAt, completedAt, tasks);
      } catch {
        // Best-effort: don't let snapshot failure block message persistence.
      }

      const completed = await options.repository.completeRunIfOpen(runId, {
        assistantContent,
        completedAt,
        processSnapshot: processSnapshot ?? undefined,
        usage
      });
      if (!completed) {
        throw new ApiError(409, "AGENT_RUN_ALREADY_FINISHED", "Agent run is already finished.");
      }

      for (const event of completed.events) {
        publishAgentRunEvent(completed.run.id, { type: event.type, payload: event.payload }, event.id);
      }
      await touchThread(completed.run.threadId);

      return completed;
    },

    async failRun(runId: string, code: string, message: string) {
      const run = await getRun(runId);
      assertRunOpen(run);
      const failedAt = now();
      const failedRun = await options.repository.failRunIfOpen(runId, {
        failedAt,
        errorCode: code,
        errorMessage: message
      });
      if (!failedRun) {
        throw new ApiError(409, "AGENT_RUN_ALREADY_FINISHED", "Agent run is already finished.");
      }

      await this.recordRunEvent(failedRun, {
        type: "run.failed",
        payload: { code, message }
      });
      await touchThread(failedRun.threadId);

      return failedRun;
    },

    async cancelRun(runId: string, agencyId?: string | null) {
      // F2: Scope the run lookup to the calling agency before cancelling.
      const run = await getRun(runId, agencyId);
      if (isTerminalRunStatus(run.status)) return;
      await options.repository.cancelRunIfOpen(runId);
      // Notify connected SSE clients so they close the stream
      publishAgentRunEvent(run.id, {
        type: "run.failed",
        payload: { code: "USER_CANCELLED", message: "Run cancelled by user." }
      });
      await touchThread(run.threadId);
    }
  };
}

export const agentService = createAgentService({
  repository: createPrismaAgentRepository()
});
