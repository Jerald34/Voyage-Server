import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
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

export type AgentToolCallInput = {
  toolName: string;
  input: unknown;
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

export type AgentTaskInput = {
  label: string;
  status: AgentTaskStatus;
  sortOrder?: number;
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

export type AgentSourceInput = {
  sourceType: AgentSourceType;
  title: string;
  url?: string | null;
  snippet?: string | null;
  provider: string;
  retrievedAt: Date;
  metadata?: unknown;
};

export type AgentRunEventRecord = {
  id: string;
  runId: string;
  threadId: string;
  type: AgentEvent["type"];
  payload: Record<string, unknown>;
  sequence: number;
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

export type ApproveItineraryThreadInput = {
  itineraryId: string;
  clientName: string;
  destination: string;
  startDate?: Date | null;
  endDate?: Date | null;
  travelerCount?: number;
  budgetLevel?: string;
};

export type ApprovedItineraryThreadRecord = {
  thread: AgentThreadRecord;
  trip: {
    id: string;
    agencyId: string;
    clientName: string | null;
    title: string;
    destinationSummary: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    budgetLevel: string | null;
  };
  itinerary: {
    id: string;
    tripId: string;
    agencyId: string;
    version: number;
    status: string;
  };
};

const OPEN_RUN_STATUSES: AgentRunStatus[] = ["QUEUED", "RUNNING"];
const TERMINAL_RUN_STATUSES: AgentRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

function isTerminalRunStatus(status: AgentRunStatus) {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export interface AgentRepository {
  createThread(data: {
    agencyId: string;
    createdByUserId: string;
    title: string;
    tripId?: string | null;
  }): Promise<AgentThreadRecord>;
  listThreadsByAgency(agencyId: string): Promise<AgentThreadRecord[]>;
  findThreadByAgency(id: string, agencyId: string): Promise<AgentThreadRecord | null>;
  approveItineraryThread(data: {
    agencyId: string;
    threadId: string;
    input: ApproveItineraryThreadInput;
  }): Promise<ApprovedItineraryThreadRecord | null>;
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
  startRun(id: string, startedAt: Date): Promise<AgentRunRecord | null>;
  createUserMessageAndRun(data: {
    threadId: string;
    agencyId: string;
    authorUserId: string;
    content: string;
    modelProvider: string;
    modelName: string;
  }): Promise<{ message: AgentMessageRecord; run: AgentRunRecord }>;
  findRunById(id: string): Promise<AgentRunRecord | null>;
  listRunEvents(runId: string): Promise<AgentRunEventRecord[]>;
  touchThread?(threadId: string, updatedAt: Date): Promise<void>;
  createRunEvent(data: {
    runId: string;
    threadId: string;
    type: AgentEvent["type"];
    payload: Record<string, unknown>;
  }): Promise<AgentRunEventRecord>;
  createToolCall(data: {
    runId: string;
    threadId: string;
    toolName: string;
    status: AgentToolCallStatus;
    input?: unknown;
    outputSummary?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }): Promise<AgentToolCallRecord>;
  updateToolCall(
    id: string,
    data: {
      status: AgentToolCallStatus;
      outputSummary?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: Date | null;
    }
  ): Promise<AgentToolCallRecord | null>;
  createTaskAndEvent(data: {
    runId: string;
    threadId: string;
    label: string;
    status: AgentTaskStatus;
    sortOrder?: number;
  }): Promise<{ task: AgentTaskRecord; event: AgentRunEventRecord }>;
  createSourcesAndEvents(data: {
    runId: string;
    threadId: string;
    sources: AgentSourceInput[];
  }): Promise<{ sources: AgentSourceRecord[]; events: AgentRunEventRecord[] }>;
  completeRunIfOpen(
    id: string,
    data: {
      assistantContent: string;
      completedAt: Date;
    }
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord; events: AgentRunEventRecord[] } | null>;
  failRunIfOpen(
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

async function nextRunEventSequence(client: Prisma.TransactionClient, runId: string) {
  const aggregate = await client.agentRunEvent.aggregate({
    where: { runId },
    _max: { sequence: true }
  });
  return (aggregate._max.sequence ?? 0) + 1;
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

    async approveItineraryThread(data) {
      return client.$transaction(async (tx) => {
        const thread = await tx.agentThread.findFirst({
          where: {
            id: data.threadId,
            agencyId: data.agencyId
          },
          select: {
            id: true,
            tripId: true
          }
        });
        if (!thread) {
          return null;
        }
        if (thread.tripId) {
          throw new ApiError(409, "THREAD_ALREADY_BOUND", "This thread is already attached to a trip.");
        }

        const itinerary = await tx.itinerary.findFirst({
          where: {
            id: data.input.itineraryId,
            agencyId: data.agencyId,
            status: "DRAFT"
          },
          select: {
            id: true,
            tripId: true,
            agencyId: true,
            version: true,
            status: true
          }
        });
        if (!itinerary) {
          throw new ApiError(409, "DRAFT_ITINERARY_REQUIRED", "Generate an itinerary before saving this draft.");
        }

        const trip = await tx.clientTrip.update({
          where: {
            id_agencyId: {
              id: itinerary.tripId,
              agencyId: data.agencyId
            }
          },
          data: {
            clientName: data.input.clientName,
            title: `${data.input.clientName} itinerary`,
            destinationSummary: data.input.destination,
            startDate: data.input.startDate ?? null,
            endDate: data.input.endDate ?? null,
            travelerCount: data.input.travelerCount ?? null,
            budgetLevel: data.input.budgetLevel ?? null
          },
          select: {
            id: true,
            agencyId: true,
            clientName: true,
            title: true,
            destinationSummary: true,
            startDate: true,
            endDate: true,
            travelerCount: true,
            budgetLevel: true
          }
        });

        const updatedThread = (await tx.agentThread.update({
          where: {
            id_agencyId: {
              id: data.threadId,
              agencyId: data.agencyId
            }
          },
          data: {
            title: data.input.clientName,
            tripId: trip.id
          },
          include: includeThreadDetails()
        })) as AgentThreadRecord;

        return {
          thread: updatedThread,
          trip,
          itinerary
        };
      });
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

    async startRun(id, startedAt) {
      const update = await client.agentRun.updateMany({
        where: {
          id,
          status: "QUEUED"
        },
        data: {
          status: "RUNNING",
          startedAt
        }
      });
      if (update.count === 0) {
        return null;
      }
      return client.agentRun.findUnique({ where: { id } }) as Promise<AgentRunRecord | null>;
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

    async listRunEvents(runId) {
      return client.agentRunEvent.findMany({
        where: { runId },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }]
      }) as Promise<AgentRunEventRecord[]>;
    },

    async touchThread(threadId, updatedAt) {
      await client.agentThread.update({
        where: { id: threadId },
        data: { updatedAt }
      });
    },

    async createRunEvent(data) {
      return client.$transaction(async (tx) => {
        const sequence = await nextRunEventSequence(tx, data.runId);
        return tx.agentRunEvent.create({
          data: {
            runId: data.runId,
            threadId: data.threadId,
            type: data.type,
            payload: data.payload as Prisma.InputJsonValue,
            sequence
          }
        }) as Promise<AgentRunEventRecord>;
      });
    },

    async createToolCall(data) {
      return client.agentToolCall.create({
        data: {
          runId: data.runId,
          threadId: data.threadId,
          toolName: data.toolName,
          status: data.status,
          input: toJsonInput(data.input),
          outputSummary: data.outputSummary ?? null,
          errorCode: data.errorCode ?? null,
          errorMessage: data.errorMessage ?? null,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null
        }
      }) as Promise<AgentToolCallRecord>;
    },

    async updateToolCall(id, data) {
      const update = await client.agentToolCall.updateMany({
        where: { id },
        data: {
          status: data.status,
          outputSummary: data.outputSummary ?? null,
          errorCode: data.errorCode ?? null,
          errorMessage: data.errorMessage ?? null,
          completedAt: data.completedAt ?? null
        }
      });
      if (update.count === 0) {
        return null;
      }
      return client.agentToolCall.findUnique({ where: { id } }) as Promise<AgentToolCallRecord | null>;
    },

    async createTaskAndEvent(data) {
      return client.$transaction(async (tx) => {
        const resolvedSortOrder =
          data.sortOrder ??
          ((await tx.agentTask.aggregate({
            where: { runId: data.runId },
            _max: { sortOrder: true }
          }))._max.sortOrder ?? 0) + 1;

        const task = (await tx.agentTask.create({
          data: {
            runId: data.runId,
            threadId: data.threadId,
            label: data.label,
            status: data.status,
            sortOrder: resolvedSortOrder
          }
        })) as AgentTaskRecord;
        const sequence = await nextRunEventSequence(tx, data.runId);
        const event = (await tx.agentRunEvent.create({
          data: {
            runId: data.runId,
            threadId: data.threadId,
            type: "task.updated",
            sequence,
            payload: {
              label: task.label,
              status: task.status,
              sortOrder: task.sortOrder
            } satisfies Record<string, unknown>
          }
        })) as AgentRunEventRecord;

        return { task, event };
      });
    },

    async createSourcesAndEvents(data) {
      return client.$transaction(async (tx) => {
        const created: AgentSourceRecord[] = [];
        const events: AgentRunEventRecord[] = [];
        let sequence = await nextRunEventSequence(tx, data.runId);

        for (const source of data.sources) {
          const createdSource = (await tx.agentSource.create({
            data: {
              runId: data.runId,
              threadId: data.threadId,
              sourceType: source.sourceType,
              title: source.title,
              url: source.url ?? null,
              snippet: source.snippet ?? null,
              provider: source.provider,
              retrievedAt: source.retrievedAt,
              metadata: toJsonInput(source.metadata)
            }
          })) as AgentSourceRecord;
          created.push(createdSource);
          events.push(
            (await tx.agentRunEvent.create({
              data: {
                runId: data.runId,
                threadId: data.threadId,
                type: "source.added",
                sequence,
                payload: {
                  sourceType: createdSource.sourceType,
                  title: createdSource.title,
                  url: createdSource.url,
                  snippet: createdSource.snippet
                } satisfies Record<string, unknown>
              }
            })) as AgentRunEventRecord
          );
          sequence += 1;
        }

        return { sources: created, events };
      });
    },

    async completeRunIfOpen(id, data) {
      return client.$transaction(async (tx) => {
        const update = await tx.agentRun.updateMany({
          where: {
            id,
            status: { in: OPEN_RUN_STATUSES }
          },
          data: {
            status: "COMPLETED",
            completedAt: data.completedAt
          }
        });
        if (update.count === 0) {
          return null;
        }

        const run = (await tx.agentRun.findUnique({ where: { id } })) as AgentRunRecord | null;
        if (!run) {
          return null;
        }

        const message = (await tx.agentMessage.create({
          data: {
            threadId: run.threadId,
            runId: run.id,
            role: "ASSISTANT",
            content: data.assistantContent
          }
        })) as AgentMessageRecord;

        const nextSequence = await nextRunEventSequence(tx, run.id);
        const events = [
          (await tx.agentRunEvent.create({
            data: {
              runId: run.id,
              threadId: run.threadId,
              type: "message.completed",
              sequence: nextSequence,
              payload: {
                messageId: message.id,
                content: data.assistantContent
              } satisfies Record<string, unknown>
            }
          })) as AgentRunEventRecord,
          (await tx.agentRunEvent.create({
            data: {
              runId: run.id,
              threadId: run.threadId,
              type: "run.completed",
              sequence: nextSequence + 1,
              payload: {
                runId: run.id
              } satisfies Record<string, unknown>
            }
          })) as AgentRunEventRecord
        ];

        return { run, message, events };
      });
    },

    async failRunIfOpen(id, data) {
      const update = await client.agentRun.updateMany({
        where: {
          id,
          status: { in: OPEN_RUN_STATUSES }
        },
        data: {
          status: "FAILED",
          failedAt: data.failedAt,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage
        }
      });
      if (update.count === 0) {
        return null;
      }
      return client.agentRun.findUnique({ where: { id } }) as Promise<AgentRunRecord | null>;
    }
  };
}

export const agentService = createAgentService({
  repository: createPrismaAgentRepository()
});
