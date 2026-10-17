import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaAgentRepository } from "../src/modules/agent/agentRepository";
import { normalizeAskUserInput } from "../src/modules/agent/askUser";

const askUser = normalizeAskUserInput({
  questions: [{ header: "Transport", question: "How will the travelers get around?", options: ["Private car", "Public transit"] }]
});

// A fake transaction client: just the calls these two repository methods make.
function createTx(latestMessageId: string | null = null) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    agentRun: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({ id: "run-1", threadId: "thread-1" })),
      create: vi.fn(async ({ data }: any) => ({ id: "run-2", ...data }))
    },
    agentThread: { updateMany: vi.fn(async () => ({ count: 1 })) },
    agentMessage: {
      create: vi.fn(async ({ data }: any) => ({ id: "message-9", ...data })),
      findFirst: vi.fn(async () => (latestMessageId ? { id: latestMessageId } : null))
    },
    agentRunEvent: {
      aggregate: vi.fn(async () => ({ _max: { sequence: 4 } })),
      create: vi.fn(async ({ data }: any) => ({ id: `event-${data.sequence}`, ...data }))
    }
  };
  const client = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx))
  } as unknown as PrismaClient;
  return { tx, client };
}

describe("completeRunIfOpen with questions", () => {
  it("writes the questions into the reply's metadata and the message.completed payload", async () => {
    const { tx, client } = createTx();

    await createPrismaAgentRepository(client).completeRunIfOpen("run-1", {
      assistantContent: "A couple of details first.",
      completedAt: new Date("2026-10-08T00:00:00Z"),
      processSnapshot: { status: "done" },
      askUser
    });

    expect(tx.agentMessage.create.mock.calls[0][0].data.metadata).toEqual({ process: { status: "done" }, askUser });
    const completedEvent = tx.agentRunEvent.create.mock.calls[0][0].data;
    expect(completedEvent.type).toBe("message.completed");
    expect(completedEvent.payload).toMatchObject({ content: "A couple of details first.", askUser });
  });
});

describe("createUserMessageAndRun with answers", () => {
  const base = {
    threadId: "thread-1",
    agencyId: "agency-1",
    authorUserId: "user-1",
    content: "Transport: Public transit",
    metadata: { answers: { messageId: "message-1", items: [] } },
    modelProvider: "fake",
    modelName: "fake-model"
  };

  it("saves the answer while its question is the newest chat message", async () => {
    const { tx, client } = createTx("message-1");

    await createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, answersTo: "message-1" });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.agentMessage.findFirst).toHaveBeenCalledWith({
      where: { threadId: "thread-1", role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    expect(tx.agentMessage.create).toHaveBeenCalledTimes(1);
    expect(tx.agentRun.create).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer once a newer message exists", async () => {
    const { tx, client } = createTx("message-2");

    await expect(
      createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, answersTo: "message-1" })
    ).rejects.toMatchObject({ code: "QUESTION_NOT_PENDING", statusCode: 409 });
    expect(tx.agentMessage.create).not.toHaveBeenCalled();
  });

  it("does not lock or check for an ordinary message", async () => {
    const { tx, client } = createTx("message-2");

    await createPrismaAgentRepository(client).createUserMessageAndRun({ ...base, metadata: undefined });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.agentMessage.findFirst).not.toHaveBeenCalled();
  });
});
