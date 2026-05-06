import type { Request, Response } from "express";
import { formatSseEvent } from "./agentEvents";
import type { AgentEvent } from "./agentSchemas";
import type { AgentRunEventRecord } from "./agentTypes";

export type AgentRunSseRequest = Pick<Request, "aborted" | "on">;
export type AgentRunSseResponse = Pick<
  Response,
  "destroyed" | "on" | "write" | "writableEnded" | "writableFinished"
> & {
  closed?: boolean;
};

export function isSseConnectionClosed(request: AgentRunSseRequest, response: AgentRunSseResponse) {
  return Boolean(
    request.aborted || response.closed || response.destroyed || response.writableEnded || response.writableFinished
  );
}

export function createSafeSseWrite(
  request: AgentRunSseRequest,
  response: AgentRunSseResponse,
  cleanup: () => void,
  isStopped?: () => boolean
) {
  return (chunk: string) => {
    if (isStopped?.() || isSseConnectionClosed(request, response)) {
      cleanup();
      return false;
    }

    try {
      response.write(chunk);
      return true;
    } catch {
      cleanup();
      return false;
    }
  };
}

export function createAgentRunStreamController(options: {
  request: AgentRunSseRequest;
  response: AgentRunSseResponse;
  onCleanup: () => void;
}) {
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    options.onCleanup();
  };

  const safeWrite = createSafeSseWrite(options.request, options.response, cleanup, () => cleaned);

  options.request.on("aborted", cleanup);
  options.request.on("close", cleanup);
  options.response.on("close", cleanup);

  return {
    cleanup,
    safeWrite
  };
}

export function agentRunEventRecordToEvent(record: AgentRunEventRecord): AgentEvent {
  return {
    type: record.type,
    payload: record.payload
  } as AgentEvent;
}

export async function replayPersistedAgentRunEvents(options: {
  runId: string;
  listRunEvents: (runId: string) => Promise<AgentRunEventRecord[]>;
  safeWrite: (chunk: string) => boolean;
}) {
  const replayedEventIds = new Set<string>();
  const records = await options.listRunEvents(options.runId);

  for (const record of records) {
    const event = agentRunEventRecordToEvent(record);
    replayedEventIds.add(record.id);
    if (!options.safeWrite(formatSseEvent(event))) {
      return { completed: false, replayedEventIds };
    }
  }

  return { completed: true, replayedEventIds };
}

export function writeAgentEvent(safeWrite: (chunk: string) => boolean, event: AgentEvent) {
  return safeWrite(formatSseEvent(event));
}
