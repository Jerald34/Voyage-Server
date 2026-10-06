import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaAgentRepository } from "../src/modules/agent/agentRepository";

type Row = { id: string; role: "USER" | "ASSISTANT"; content: string; createdAt: Date; runId: string | null; metadata: unknown };

function createClient(rows: Row[], runItineraries: Array<{ runId: string; itineraryId: string }>) {
  const queryRaw = vi.fn(async () => runItineraries);
  const client = {
    agentMessage: { findMany: vi.fn(async () => rows) },
    $queryRaw: queryRaw
  } as unknown as PrismaClient;
  return { client, queryRaw };
}

const at = new Date("2026-10-06T00:00:00Z");

describe("listThreadMessages links replies to the itinerary their run touched", () => {
  it("tags an assistant reply with the itinerary from its run, whatever the reply says", async () => {
    const { client } = createClient(
      [
        { id: "a-2", role: "ASSISTANT", content: "Sure, anything else?", createdAt: at, runId: "run-chat", metadata: null },
        { id: "a-1", role: "ASSISTANT", content: "The 3-Day Da Nang Accessible Family Itinerary has been created.", createdAt: at, runId: "run-build", metadata: null },
        { id: "u-1", role: "USER", content: "Plan Da Nang", createdAt: at, runId: null, metadata: null }
      ],
      [{ runId: "run-build", itineraryId: "itin-1" }]
    );

    const { messages } = await createPrismaAgentRepository(client).listThreadMessages({
      threadId: "thread-1",
      agencyId: "agency-1",
      limit: 50
    });

    expect(messages.find((m) => m.id === "a-1")).toMatchObject({ itineraryId: "itin-1" });
    expect(messages.find((m) => m.id === "a-2")).not.toHaveProperty("itineraryId");
    expect(messages.find((m) => m.id === "u-1")).not.toHaveProperty("itineraryId");
  });

  it("skips the itinerary lookup when no assistant reply has a run", async () => {
    const { client, queryRaw } = createClient(
      [{ id: "u-1", role: "USER", content: "Hello", createdAt: at, runId: null, metadata: null }],
      []
    );

    await createPrismaAgentRepository(client).listThreadMessages({
      threadId: "thread-1",
      agencyId: "agency-1",
      limit: 50
    });

    expect(queryRaw).not.toHaveBeenCalled();
  });
});
