import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import type {
  AgentRepository,
  AgentThreadRecord,
  AgentMessageRecord,
  AgentRunRecord,
  AgentRunEventRecord,
  AgentToolCallRecord,
  AgentTaskRecord,
  AgentSourceRecord,
  AgentRunStatus
} from "./agentTypes";

const OPEN_RUN_STATUSES: AgentRunStatus[] = ["QUEUED", "RUNNING"];

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

    async deleteThreadByAgency(id, agencyId) {
      const deleted = await client.agentThread.deleteMany({
        where: { id, agencyId }
      });
      return deleted.count > 0;
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

        const itineraryEvents = await tx.agentRunEvent.findMany({
          where: {
            threadId: data.threadId,
            type: { in: ["itinerary.updated", "itinerary.created"] }
          },
          select: {
            payload: true
          }
        });
        const itineraryWasGeneratedByThread = itineraryEvents.some((event) => {
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
            budgetLevel: data.input.budgetLevel ?? null,
            status: "APPROVED_INTERNAL",
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

        const bindThread = await tx.agentThread.updateMany({
          where: {
            id: data.threadId,
            agencyId: data.agencyId,
            tripId: null
          },
          data: {
            title: data.input.clientName,
            tripId: trip.id
          }
        });
        if (bindThread.count === 0) {
          throw new ApiError(409, "THREAD_ALREADY_BOUND", "This thread is already attached to a trip.");
        }

        const updatedThread = (await tx.agentThread.findFirst({
          where: {
            id: data.threadId,
            agencyId: data.agencyId
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
