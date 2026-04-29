import type { AgentEvent } from "./agentSchemas";

export type PublishedAgentEvent = {
  event: AgentEvent;
  eventId?: string;
};

type AgentRunEventListener = (event: PublishedAgentEvent) => void;

const listenersByRunId = new Map<string, Set<AgentRunEventListener>>();

export function publishAgentRunEvent(runId: string, event: AgentEvent, eventId?: string) {
  const listeners = listenersByRunId.get(runId);
  if (!listeners) {
    return;
  }

  const published = { event, eventId };
  for (const listener of listeners) {
    try {
      listener(published);
    } catch {
      // Listener failures should not prevent persistence or other subscribers.
    }
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
