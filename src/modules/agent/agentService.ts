import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { publishAgentRunEvent } from "./agentEvents";
import { agentEventSchema, createMessageSchema, createThreadSchema, type AgentEvent } from "./agentSchemas";

export type AgentThreadStatus = "ACTIVE" | "ARCHIVED";
export type AgentMessageRole = "USER" | "ASSISTANT" | "SYSTEM_VISIBLE";
export type AgentRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type AgentToolCallStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type AgentTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type AgentSourceType = "WEB" | "MAP_PLACE" | "MAP_ROUTE";

export type AgentMessageRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  authorUserId: string | null;
  role: AgentMessageRole;
  content: string;
  metadata: unknown;
  createdAt: Date;
};

export type AgentRunRecord = {
  id: string;
  threadId: string;
  agencyId: string;
  triggerMessageId: string | null;
  status: AgentRunStatus;
  modelProvider: string;
  modelName: string;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentToolCallRecord = {
  id: string;
  runId: string;
  threadId: string;
  toolName: string;
  status: AgentToolCallStatus;
  input: unknown;
  outputSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type AgentTaskRecord = {
  id: string;
  runId: string;
  threadId: string;
  label: string;
  status: AgentTaskStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentSourceRecord = {
  id: string;
  runId: string;
  threadId: string;
  sourceType: AgentSourceType;
  title: string;
  url: string | null;
  snippet: string | null;
  provider: string;
  retrievedAt: Date;
  metadata: unknown;
  createdAt: Date;
};

export type AgentRunEventRecord = {
  id: string;
  runId: string;
  threadId: string;
  type: AgentEvent["type"];
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type AgentThreadRecord = {
  id: string;
  agencyId: string;
  tripId: string | null;
  createdByUserId: string;
  title: string;
  status: AgentThreadStatus;
  messages: AgentMessageRecord[];
  runs: AgentRunRecord[];
  toolCalls: AgentToolCallRecord[];
  tasks: AgentTaskRecord[];
  sources: AgentSourceRecord[];
  events: AgentRunEventRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export interface AgentRepository {
  createThread(data: {
    agencyId: string;
    createdByUserId: string;
    title: string;
    tripId?: string | null;
  }): Promise<AgentThreadRecord>;
  listThreadsByAgency(agencyId: string): Promise<AgentThreadRecord[]>;
  findThreadByAgency(id: string, agencyId: string): Promise<AgentThreadRecord | null>;
  createMessage(data: {
    threadId: string;
    runId?: string | null;
    authorUserId?: string | null;
    role: AgentMessageRole;
    content: string;
    metadata?: unknown;
  }): Promise<AgentMessageRecord>;
  createRun(data: {
    threadId: string;
    agencyId: string;
    triggerMessageId?: string | null;
    modelProvider: string;
    modelName: string;
  }): Promise<AgentRunRecord>;
  createUserMessageAndRun(data: {
    threadId: string;
    agencyId: string;
    authorUserId: string;
    content: string;
    modelProvider: string;
    modelName: string;
  }): Promise<{ message: AgentMessageRecord; run: AgentRunRecord }>;
  findRunById(id: string): Promise<AgentRunRecord | null>;
  createRunEvent(data: {
    runId: string;
    threadId: string;
    type: AgentEvent["type"];
    payload: Record<string, unknown>;
  }): Promise<AgentRunEventRecord>;
  completeRun(id: string, completedAt: Date): Promise<AgentRunRecord | null>;
  failRun(
    id: string,
    data: {
      failedAt: Date;
      errorCode: string;
      errorMessage: string;
    }
  ): Promise<AgentRunRecord | null>;
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

    async appendUserMessageAndCreateRun(
      agencyId: string,
      threadId: string,
      userId: string,
      content: string
    ) {
      const parsed = createMessageSchema.parse({ content });
      await this.getThread(agencyId, threadId);
      return options.repository.createUserMessageAndRun({
        agencyId,
        threadId,
        authorUserId: userId,
        content: parsed.content,
        modelProvider,
        modelName
      });
    },

    async recordRunEvent(run: AgentRunRecord, event: AgentEvent) {
      const parsed = agentEventSchema.parse(event);
      const persisted = await options.repository.createRunEvent({
        runId: run.id,
        threadId: run.threadId,
        type: parsed.type,
        payload: parsed.payload
      });
      publishAgentRunEvent(run.id, parsed);
      return persisted;
    },

    async completeRun(runId: string, assistantContent: string) {
      const run = await getRun(runId);
      const completedAt = now();
      const completedRun = await options.repository.completeRun(runId, completedAt);
      if (!completedRun) {
        throw new ApiError(404, "RUN_NOT_FOUND", "Agent run not found.");
      }

      const message = await options.repository.createMessage({
        threadId: run.threadId,
        runId: run.id,
        role: "ASSISTANT",
        content: assistantContent
      });

      await this.recordRunEvent(completedRun, {
        type: "message.completed",
        payload: { messageId: message.id, content: assistantContent }
      });
      await this.recordRunEvent(completedRun, {
        type: "run.completed",
        payload: { runId: completedRun.id }
      });

      return { run: completedRun, message };
    },

    async failRun(runId: string, code: string, message: string) {
      const run = await getRun(runId);
      const failedAt = now();
      const failedRun = await options.repository.failRun(runId, {
        failedAt,
        errorCode: code,
        errorMessage: message
      });
      if (!failedRun) {
        throw new ApiError(404, "RUN_NOT_FOUND", "Agent run not found.");
      }

      await this.recordRunEvent(failedRun, {
        type: "run.failed",
        payload: { code, message }
      });

      return failedRun;
    }
  };
}

function includeThreadDetails() {
  return {
    messages: { orderBy: { createdAt: "asc" as const } },
    runs: { orderBy: { createdAt: "asc" as const } },
    tasks: { orderBy: { sortOrder: "asc" as const } },
    toolCalls: { orderBy: { createdAt: "asc" as const } },
    sources: { orderBy: { createdAt: "asc" as const } },
    events: { orderBy: { createdAt: "asc" as const } }
  } as const;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

export function createPrismaAgentRepository(client: PrismaClient = prisma): AgentRepository {
  return {
    async createThread(data) {
      return client.agentThread.create({
        data: {
          agencyId: data.agencyId,
          createdByUserId: data.createdByUserId,
          title: data.title,
          tripId: data.tripId
        },
        include: includeThreadDetails()
      }) as Promise<AgentThreadRecord>;
    },

    async listThreadsByAgency(agencyId) {
      return client.agentThread.findMany({
        where: { agencyId },
        orderBy: { updatedAt: "desc" },
        include: includeThreadDetails()
      }) as Promise<AgentThreadRecord[]>;
    },

    async findThreadByAgency(id, agencyId) {
      return client.agentThread.findFirst({
        where: { id, agencyId },
        include: includeThreadDetails()
      }) as Promise<AgentThreadRecord | null>;
    },

    async createMessage(data) {
      return client.agentMessage.create({
        data: {
          threadId: data.threadId,
          runId: data.runId,
          authorUserId: data.authorUserId,
          role: data.role,
          content: data.content,
          metadata: toJsonInput(data.metadata)
        }
      }) as Promise<AgentMessageRecord>;
    },

    async createRun(data) {
      return client.agentRun.create({
        data: {
          threadId: data.threadId,
          agencyId: data.agencyId,
          triggerMessageId: data.triggerMessageId,
          status: "QUEUED",
          modelProvider: data.modelProvider,
          modelName: data.modelName
        }
      }) as Promise<AgentRunRecord>;
    },

    async createUserMessageAndRun(data) {
      return client.$transaction(async (tx) => {
        const message = await tx.agentMessage.create({
          data: {
            threadId: data.threadId,
            authorUserId: data.authorUserId,
            role: "USER",
            content: data.content
          }
        });
        const run = await tx.agentRun.create({
          data: {
            threadId: data.threadId,
            agencyId: data.agencyId,
            triggerMessageId: message.id,
            status: "QUEUED",
            modelProvider: data.modelProvider,
            modelName: data.modelName
          }
        });
        return { message, run } as { message: AgentMessageRecord; run: AgentRunRecord };
      });
    },

    async findRunById(id) {
      return client.agentRun.findUnique({ where: { id } }) as Promise<AgentRunRecord | null>;
    },

    async createRunEvent(data) {
      return client.agentRunEvent.create({
        data: {
          runId: data.runId,
          threadId: data.threadId,
          type: data.type,
          payload: data.payload as Prisma.InputJsonValue
        }
      }) as Promise<AgentRunEventRecord>;
    },

    async completeRun(id, completedAt) {
      return client.agentRun.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt
        }
      }) as Promise<AgentRunRecord | null>;
    },

    async failRun(id, data) {
      return client.agentRun.update({
        where: { id },
        data: {
          status: "FAILED",
          failedAt: data.failedAt,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage
        }
      }) as Promise<AgentRunRecord | null>;
    }
  };
}

export const agentService = createAgentService({
  repository: createPrismaAgentRepository()
});
