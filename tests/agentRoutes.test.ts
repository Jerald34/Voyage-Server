import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentRunStreamController,
  startAgentRunInBackground
} from "../src/modules/agent/agentRoutes";

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
});
