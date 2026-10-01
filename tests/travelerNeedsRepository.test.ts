import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaAgentRepository } from "../src/modules/agent/agentRepository";

function fakeClient() {
  const tx = {
    agentThread: { update: vi.fn(async () => ({})) },
    agentMessage: { create: vi.fn(async ({ data }: any) => ({ id: "message-1", ...data })) },
    agentRun: { create: vi.fn(async ({ data }: any) => ({ id: "run-1", ...data })) }
  };
  const client = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) };
  return { tx, client: client as any };
}

const base = {
  threadId: "thread-1",
  agencyId: "agency-1",
  authorUserId: "user-1",
  content: "Plan 2 days in Baguio",
  modelProvider: "vertex",
  modelName: "gemini"
};

describe("createUserMessageAndRun traveler needs", () => {
  it("writes the needs onto the thread in the same transaction as the message", async () => {
    const { tx, client } = fakeClient();

    await createPrismaAgentRepository(client).createUserMessageAndRun({
      ...base,
      travelerNeeds: { needs: ["SENIOR"], notes: null }
    });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.agentThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { travelerNeeds: { needs: ["SENIOR"], notes: null } }
    });
    expect(tx.agentMessage.create).toHaveBeenCalledTimes(1);
  });

  it("leaves the thread alone when the message carries no needs", async () => {
    const { tx, client } = fakeClient();

    await createPrismaAgentRepository(client).createUserMessageAndRun(base);

    expect(tx.agentThread.update).not.toHaveBeenCalled();
  });
});
