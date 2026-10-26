import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaAgentRepository } from "../src/modules/agent/agentRepository";

function fakeClient() {
  const agentRun = {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({ id: "run-1", status: "FAILED" }))
  };
  return { agentRun, client: { agentRun } as any };
}

const failure = {
  failedAt: new Date("2026-10-26T00:00:00.000Z"),
  errorCode: "MODEL_ERROR",
  errorMessage: "Model request failed."
};

describe("failRunIfOpen usage columns", () => {
  it("writes the usage spent before the failure onto the run", async () => {
    const { agentRun, client } = fakeClient();
    const usage = {
      promptTokens: 900,
      outputTokens: 40,
      totalTokens: 940,
      cachedTokens: 0,
      thoughtsTokens: 12,
      costUsd: 0.0004,
      costComplete: false,
      detail: []
    };

    await createPrismaAgentRepository(client).failRunIfOpen("run-1", { ...failure, usage });

    expect(agentRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", status: { in: expect.any(Array) } },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "MODEL_ERROR",
        promptTokens: 900,
        outputTokens: 40,
        totalTokens: 940,
        thoughtsTokens: 12,
        costUsd: 0.0004,
        costComplete: false,
        usageDetail: []
      })
    });
  });

  it("leaves the usage columns untouched when no usage is given", async () => {
    const { agentRun, client } = fakeClient();

    await createPrismaAgentRepository(client).failRunIfOpen("run-1", failure);

    const call = agentRun.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(call[0].data).not.toHaveProperty("promptTokens");
    expect(call[0].data).not.toHaveProperty("costComplete");
  });
});
