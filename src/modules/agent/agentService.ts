import { ApiError } from "../../http/errors";
import { publishAgentRunEvent } from "./agentEvents";
import { agentLogger } from "./agentLogger";
import {
  agentEventSchema,
  approveItineraryThreadSchema,
  createMessageSchema,
  createThreadSchema,
  type AgentEvent
} from "./agentSchemas";
import type {
  AgentRepository,
  AgentRunRecord,
  AgentToolCallInput,
  AgentTaskInput,
  AgentSourceInput,
  AgentRunStatus
} from "./agentTypes";
import { createPrismaAgentRepository } from "./agentRepository";

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

  async function getRun(runId: string) {
    const run = await options.repository.findRunById(runId);
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

    async getThread(agencyId: string, threadId: string) {
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

    async approveItineraryThread(agencyId: string, threadId: string, input: unknown) {
      const parsed = approveItineraryThreadSchema.parse(input);
      const thread = await this.getThread(agencyId, threadId);
      if (thread.tripId) {
        throw new ApiError(409, "THREAD_ALREADY_BOUND", "This thread is already attached to a trip.");
      }

      const approved = await options.repository.approveItineraryThread({
        agencyId,
        threadId,
        input: parsed
      });
      if (!approved) {
        throw new ApiError(404, "THREAD_NOT_FOUND", "Agent thread not found.");
      }

      await touchThread(threadId);
      return approved;
    },

    async appendUserMessageAndCreateRun(
      agencyId: string,
      threadId: string,
      userId: string,
      content: string
    ) {
      const parsed = createMessageSchema.parse({ content });
      await this.getThread(agencyId, threadId);
      const result = await options.repository.createUserMessageAndRun({
        agencyId,
        threadId,
        authorUserId: userId,
        content: parsed.content,
        modelProvider,
        modelName
      });
      await touchThread(threadId);
      return result;
    },

    async startRun(runId: string, startedAtOverride?: Date) {
      const run = await getRun(runId);
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
      await touchThread(run.threadId);
      publishAgentRunEvent(run.id, parsed, persisted.id);
      return persisted;
    },

    async listRunEvents(runId: string) {
      await getRun(runId);
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
      await touchThread(run.threadId);
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
        await touchThread(toolCall.threadId);
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
        await touchThread(toolCall.threadId);
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
      await touchThread(run.threadId);
      publishAgentRunEvent(run.id, { type: event.type, payload: event.payload }, event.id);

      return task;
    },

    async recordSources(run: AgentRunRecord, sources: AgentSourceInput[]) {
      const { sources: created, events } = await options.repository.createSourcesAndEvents({
        runId: run.id,
        threadId: run.threadId,
        sources
      });
      await touchThread(run.threadId);

      for (const event of events) {
        publishAgentRunEvent(run.id, { type: event.type, payload: event.payload }, event.id);
      }

      return created;
    },

    async completeRun(runId: string, assistantContent: string) {
      agentLogger.agentResponse(runId, assistantContent);
      const run = await getRun(runId);
      assertRunOpen(run);
      const completedAt = now();
      const completed = await options.repository.completeRunIfOpen(runId, {
        assistantContent,
        completedAt
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
    }
  };
}

export const agentService = createAgentService({
  repository: createPrismaAgentRepository()
});
