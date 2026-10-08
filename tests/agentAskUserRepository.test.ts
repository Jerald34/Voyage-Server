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
