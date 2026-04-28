import type { AgentEvent } from "./agentSchemas";

type AgentRunEventListener = (event: AgentEvent) => void;

const listenersByRunId = new Map<string, Set<AgentRunEventListener>>();

export function publishAgentRunEvent(runId: string, event: AgentEvent) {
  const listeners = listenersByRunId.get(runId);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeToAgentRun(runId: string, listener: AgentRunEventListener) {
  const listeners = listenersByRunId.get(runId) ?? new Set<AgentRunEventListener>();
  listeners.add(listener);
  listenersByRunId.set(runId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByRunId.delete(runId);
    }
  };
}

export function formatSseEvent(event: AgentEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
