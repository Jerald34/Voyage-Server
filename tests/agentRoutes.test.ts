import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentRunStreamController,
  replayPersistedAgentRunEvents,
  startAgentRunInBackground
} from "../src/modules/agent/agentRoutes";
import type { AgentRunEventRecord } from "../src/modules/agent/agentService";

function createStreamHarness() {
  const request = new EventEmitter() as EventEmitter & { aborted?: boolean };
  const response = new EventEmitter() as EventEmitter & {
    closed?: boolean;
    destroyed?: boolean;
    writableEnded?: boolean;
    writableFinished?: boolean;
    write: ReturnType<typeof vi.fn>;
  };

  request.aborted = false;
  response.closed = false;
  response.destroyed = false;
  response.writableEnded = false;
  response.writableFinished = false;
  response.write = vi.fn(() => true);

  const onCleanup = vi.fn();
  const controller = createAgentRunStreamController({
    request,
    response,
    onCleanup
  });

  return {
    request,
    response,
    onCleanup,
    ...controller
  };
}

describe("agent route helpers", () => {
  it("stops SSE writes after request aborts and cleans up once", () => {
    const { request, response, onCleanup, safeWrite, cleanup } = createStreamHarness();

    expect(safeWrite("event: connected\ndata: {}\n\n")).toBe(true);
    expect(response.write).toHaveBeenCalledTimes(1);

    request.aborted = true;
    request.emit("aborted");

    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(safeWrite(": heartbeat\n\n")).toBe(false);
    expect(response.write).toHaveBeenCalledTimes(1);

    cleanup();
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up when the response closes", () => {
    const { response, onCleanup, safeWrite } = createStreamHarness();

    response.emit("close");

    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(safeWrite(": heartbeat\n\n")).toBe(false);
    expect(response.write).not.toHaveBeenCalled();
  });

  it("refuses to write after the response is destroyed", () => {
    const { response, onCleanup, safeWrite } = createStreamHarness();

    response.destroyed = true;

    expect(safeWrite(": heartbeat\n\n")).toBe(false);
    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(response.write).not.toHaveBeenCalled();
  });

  it("logs orchestration and failRun failures with agency context", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const orchestrator = {
      async run() {
        throw new Error("orchestrator exploded");
      }
    };
    const agentService = {
      async failRun() {
        throw new Error("persist failed");
      }
    };

    try {
      await expect(
        startAgentRunInBackground(
          {
            agencyId: "agency-1",
            threadId: "thread-1",
            runId: "run-1",
            userId: "user-1",
            userContent: "Plan a Cebu trip"
          },
          {
            orchestrator,
            agentService
          }
        )
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[0][0]).toBe("Agent orchestration failed");
      expect(errorSpy.mock.calls[0][1]).toMatchObject({
        agencyId: "agency-1",
        threadId: "thread-1",
        runId: "run-1"
      });
      expect(errorSpy.mock.calls[1][0]).toBe("Failed to mark agent run failed after orchestration failure");
      expect(errorSpy.mock.calls[1][1]).toMatchObject({
        agencyId: "agency-1",
        threadId: "thread-1",
        runId: "run-1",
        failureCode: "AGENT_RUN_FAILED",
        failureMessage: "Agent run failed."
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("replays persisted run events in creation order", async () => {
    const writes: string[] = [];
    const events: AgentRunEventRecord[] = [
      {
        id: "event-1",
        runId: "run-1",
        threadId: "thread-1",
        type: "run.started",
        payload: { runId: "run-1" },
        sequence: 1,
        createdAt: new Date("2026-04-28T01:00:00.000Z")
      },
      {
        id: "event-2",
        runId: "run-1",
        threadId: "thread-1",
        type: "message.delta",
        payload: { delta: "Drafting..." },
        sequence: 2,
        createdAt: new Date("2026-04-28T01:00:01.000Z")
      }
    ];

    const replay = await replayPersistedAgentRunEvents({
      runId: "run-1",
      async listRunEvents(runId) {
        expect(runId).toBe("run-1");
        return events;
      },
      safeWrite(chunk) {
        writes.push(chunk);
        return true;
      }
    });

    expect(replay.completed).toBe(true);
    expect(writes).toEqual([
      'event: run.started\ndata: {"type":"run.started","payload":{"runId":"run-1"}}\n\n',
      'event: message.delta\ndata: {"type":"message.delta","payload":{"delta":"Drafting..."}}\n\n'
    ]);
    expect(replay.replayedEventIds).toEqual(new Set(["event-1", "event-2"]));
  });

  it("stops replay when the SSE connection closes", async () => {
    const writes: string[] = [];

    const replay = await replayPersistedAgentRunEvents({
      runId: "run-1",
      async listRunEvents() {
        return [
          {
            id: "event-1",
            runId: "run-1",
            threadId: "thread-1",
            type: "run.started",
            payload: { runId: "run-1" },
            sequence: 1,
            createdAt: new Date("2026-04-28T01:00:00.000Z")
          },
          {
            id: "event-2",
            runId: "run-1",
            threadId: "thread-1",
            type: "message.delta",
            payload: { delta: "Lost" },
            sequence: 2,
            createdAt: new Date("2026-04-28T01:00:01.000Z")
          }
        ];
      },
      safeWrite(chunk) {
        writes.push(chunk);
        return false;
      }
    });

    expect(replay.completed).toBe(false);
    expect(writes).toHaveLength(1);
  });
});
