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
  AgentRunStatus,
  ListTasksOptions,
  AgentTaskUpdateInput
} from "./agentTypes";

const OPEN_RUN_STATUSES: AgentRunStatus[] = ["QUEUED", "RUNNING"];

// Cap the number of run events loaded per thread read. `buildActiveItineraryContext` does
// a reverse-scan to find the latest itinerary tool output, which is almost always within
// the last few dozen events — capping at 200 keeps even pathological long-running threads
// well under the recovery cutoff while preventing megabytes of historical events (each
// payload can hold a full itinerary snapshot) from being deserialized on every message.
//
// Messages are NOT capped here because the orchestrator uses the full message list as the
// model's conversation history. Truncating would silently lose user context. If thread
// growth becomes a problem there, the right fix is explicit pagination in the orchestrator,
// not a quiet cap here.
const THREAD_EVENT_TAIL_LIMIT = 200;

function includeThreadDetails() {
  return {
    messages: { orderBy: { createdAt: "asc" as const } },
    // `take: -N` with an `asc` orderBy returns the LAST N rows in that order — i.e. the
    // most recent events, still oldest-first. This preserves consumer iteration semantics
    // (e.g. `[...thread.events].reverse()` in buildActiveItineraryContext).
    events: { orderBy: { createdAt: "asc" as const }, take: -THREAD_EVENT_TAIL_LIMIT }
  } as const;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

/**
 * Acquire a per-run advisory lock for the lifetime of the current transaction.
 *
 * `nextRunEventSequence` performs a read-then-write (`MAX(sequence) + 1`) and is therefore
 * vulnerable to a race when two transactions for the same run interleave: both observe the
 * same max value and both write the same next sequence, producing duplicate `sequence`
 * numbers within the run. Postgres' default READ COMMITTED isolation does not protect us
 * here because the read is against pre-existing rows, not the row we are about to insert.
 *
 * Calling this at the top of any transaction that uses `nextRunEventSequence` serializes
 * concurrent transactions on the same `runId`. The lock is released automatically when the
 * transaction commits or rolls back (that's what `_xact_` means). Different runIds do not
 * block each other because the lock key is derived from the runId via `hashtext`.
 */
async function lockRunForSequence(client: Prisma.TransactionClient, runId: string) {
  // `hashtext` returns int; cast to bigint so we use the single-key `pg_advisory_xact_lock`
  // signature unambiguously.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${runId})::bigint)`;
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
      }) as unknown as Promise<AgentThreadRecord>;
    },

    async listThreadsByAgency(agencyId) {
      const rows = await client.agentThread.findMany({
        where: { agencyId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          agencyId: true,
          tripId: true,
          createdByUserId: true,
          title: true,
          status: true,
          titleSetByUser: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return rows.map((row) => ({ ...row, messages: [], events: [] })) as AgentThreadRecord[];
    },

    async findThreadByAgency(id, agencyId) {
      return client.agentThread.findFirst({
        where: { id, agencyId },
        include: includeThreadDetails()
      }) as Promise<AgentThreadRecord | null>;
    },

    async deleteThreadByAgency(id, agencyId) {
      return client.$transaction(async (tx) => {
        // Capture the thread's bound tripId before deletion so we can
        // garbage-collect an orphan draft ClientTrip in the same transaction.
        const thread = await tx.agentThread.findFirst({
          where: { id, agencyId },
          select: { id: true, tripId: true }
        });
        if (!thread) return false;

        const deleted = await tx.agentThread.deleteMany({
          where: { id, agencyId }
        });
        if (deleted.count === 0) return false;

        // Cascade: if this thread was bound to a draft ClientTrip that was
        // never saved-to-client (clientName === null) and no other thread
        // still references it, delete the trip too. Trips that have been
        // saved (clientName set) or approved must NEVER be deleted by this
        // path — those are real client trips.
        if (thread.tripId) {
          const trip = await tx.clientTrip.findFirst({
            where: { id: thread.tripId, agencyId },
            select: { id: true, status: true, clientName: true }
          });
          if (
            trip &&
            trip.status === "DRAFT" &&
            (trip.clientName === null || trip.clientName === "")
          ) {
            const otherThreadCount = await tx.agentThread.count({
              where: { tripId: thread.tripId, agencyId }
            });
            if (otherThreadCount === 0) {
              await tx.clientTrip.deleteMany({
                where: { id: thread.tripId, agencyId }
              });
            }
          }
        }

        return true;
      });
    },

    async saveItineraryThread(data) {
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
              id: itinerary.tripId!,
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
            status: "IN_REVIEW",
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

        await tx.itinerary.update({
          where: { id: itinerary.id },
          data: { status: "NEEDS_REVIEW" }
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
            content: data.content,
            metadata: toJsonInput(data.metadata)
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
        await lockRunForSequence(tx, data.runId);
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
        await lockRunForSequence(tx, data.runId);
        // NOTE: We previously acquired a second advisory lock here on threadId to
        // prevent sortOrder races against the @@unique([threadId, sortOrder]) constraint.
        // That doubled the lock-holding time per task insert and, combined with the
        // parallel recordRunEvent transactions fired from executeToolCallsBatch,
        // exhausted the Prisma connection pool (P2028: "Unable to start a transaction
        // in the given time"). In practice each agent thread has one active user, so
        // truly concurrent task inserts are rare. If a race ever does fire, the
        // unique constraint will reject one insert and the agent will see the tool
        // error and retry — far better than holding the pool hostage.
        const resolvedSortOrder =
          data.sortOrder ??
          ((await tx.agentTask.aggregate({
            where: { threadId: data.threadId },
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
              id: task.id,
              label: task.label,
              status: task.status,
              sortOrder: task.sortOrder
            } satisfies Record<string, unknown>
          }
        })) as AgentRunEventRecord;

        return { task, event };
      });
    },

    async listForThread(threadId: string, opts: ListTasksOptions) {
      const where: Prisma.AgentTaskWhereInput = { threadId };
      if (opts.openOnly) {
        where.status = { in: ["PENDING", "RUNNING"] };
      }
      return client.agentTask.findMany({
        where,
        orderBy: { sortOrder: "asc" }
      }) as Promise<AgentTaskRecord[]>;
    },

    async updateTaskAndEvent(data) {
      return client.$transaction(async (tx) => {
        await lockRunForSequence(tx, data.runId);
        const task = (await tx.agentTask.update({
          where: { id: data.id },
          data: {
            ...(data.patch.label !== undefined ? { label: data.patch.label } : {}),
            ...(data.patch.status !== undefined ? { status: data.patch.status } : {}),
            ...(data.patch.sortOrder !== undefined ? { sortOrder: data.patch.sortOrder } : {}),
            runId: data.runId
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
              id: task.id,
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
        await lockRunForSequence(tx, data.runId);
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
        await lockRunForSequence(tx, id);
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
            content: data.assistantContent,
            ...(data.processSnapshot != null
              ? { metadata: toJsonInput({ process: data.processSnapshot }) }
              : {})
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
              payload: toJsonInput({
                messageId: message.id,
                content: data.assistantContent,
                ...(data.processSnapshot != null ? { process: data.processSnapshot } : {})
              }) as Prisma.InputJsonValue
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
    },

    async cancelRunIfOpen(id) {
      const update = await client.agentRun.updateMany({
        where: { id, status: { in: OPEN_RUN_STATUSES } },
        data: { status: "CANCELLED" }
      });
      if (update.count === 0) return null;
      return client.agentRun.findUnique({ where: { id } }) as Promise<AgentRunRecord | null>;
    },

    async listThreadMessages({ threadId, agencyId, cursor, limit }) {
      const rows = await client.agentMessage.findMany({
        where: { threadId, thread: { agencyId } },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, role: true, content: true, createdAt: true, runId: true, metadata: true },
      });
      const hasMore = rows.length > limit;
      const messages = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? rows[limit - 1]?.id ?? null : null;
      return { messages, nextCursor };
    },

    async updateThreadTitle({ threadId, title, manual }) {
      const trimmed = title.trim();
      if (!trimmed) return null;

      // Manual: always write + set the flag.
      // Automatic: only write when titleSetByUser is false, and never flip the flag.
      if (manual) {
        return client.agentThread.update({
          where: { id: threadId },
          data: { title: trimmed, titleSetByUser: true },
          include: includeThreadDetails()
        }) as unknown as Promise<AgentThreadRecord>;
      }

      const updated = await client.agentThread.updateMany({
        where: { id: threadId, titleSetByUser: false },
        data: { title: trimmed }
      });
      if (updated.count === 0) return null;
      return client.agentThread.findUnique({
        where: { id: threadId },
        include: includeThreadDetails()
      }) as Promise<AgentThreadRecord | null>;
    }
  };
}
