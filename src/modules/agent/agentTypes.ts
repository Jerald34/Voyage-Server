import type { AgentEvent } from "./agentSchemas";

export type AgentThreadStatus = "ACTIVE" | "ARCHIVED";
export type AgentMessageRole = "USER" | "ASSISTANT" | "SYSTEM_VISIBLE";
export type AgentRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type AgentToolCallStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type AgentTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type AgentSourceType = "WEB" | "MAP_PLACE" | "MAP_ROUTE";

export type AgentMessageRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  authorUserId: string | null;
  role: AgentMessageRole;
  content: string;
  metadata: unknown;
  createdAt: Date;
};

export type AgentRunRecord = {
  id: string;
  threadId: string;
  agencyId: string;
  triggerMessageId: string | null;
  status: AgentRunStatus;
  modelProvider: string;
  modelName: string;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentToolCallRecord = {
  id: string;
  runId: string;
  threadId: string;
  toolName: string;
  status: AgentToolCallStatus;
  input: unknown;
  outputSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type AgentToolCallInput = {
  toolName: string;
  input: unknown;
};

export type AgentTaskRecord = {
  id: string;
  runId: string;
  threadId: string;
  label: string;
  status: AgentTaskStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentTaskInput = {
  label: string;
  status: AgentTaskStatus;
  sortOrder?: number;
};

export type AgentSourceRecord = {
  id: string;
  runId: string;
  threadId: string;
  sourceType: AgentSourceType;
  title: string;
  url: string | null;
  snippet: string | null;
  provider: string;
  retrievedAt: Date;
  metadata: unknown;
  createdAt: Date;
};

export type AgentSourceInput = {
  sourceType: AgentSourceType;
  title: string;
  url?: string | null;
  snippet?: string | null;
  provider: string;
  retrievedAt: Date;
  metadata?: unknown;
};

export type AgentRunEventRecord = {
  id: string;
  runId: string;
  threadId: string;
  type: AgentEvent["type"];
  payload: Record<string, unknown>;
  sequence: number;
  createdAt: Date;
};

export type AgentThreadRecord = {
  id: string;
  agencyId: string;
  tripId: string | null;
  createdByUserId: string;
  title: string;
  status: AgentThreadStatus;
  messages: AgentMessageRecord[];
  events: AgentRunEventRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type ApproveItineraryThreadInput = {
  itineraryId: string;
  clientName: string;
  destination: string;
  startDate?: Date | null;
  endDate?: Date | null;
  travelerCount?: number;
  budgetLevel?: string;
};

export type ApprovedItineraryThreadRecord = {
  thread: AgentThreadRecord;
  trip: {
    id: string;
    agencyId: string;
    clientName: string | null;
    title: string;
    destinationSummary: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    budgetLevel: string | null;
  };
  itinerary: {
    id: string;
    tripId: string;
    agencyId: string;
    version: number;
    status: string;
  };
};

export type AgentOrchestratorRunInput = {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
  userContent: string;
  signal?: AbortSignal;
};

import type { AgentToolRegistry } from "./agentTools";

export type AgentOrchestrator = {
  run(input: AgentOrchestratorRunInput): Promise<void>;
  toolRegistry: AgentToolRegistry;
};

export type AgentOrchestratorAgentService = {
  getThread(
    agencyId: string,
    threadId: string
  ): Promise<{ messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM_VISIBLE"; content: string }> }>;
  startRun(runId: string, startedAt: Date): Promise<AgentRunRecord>;
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<AgentRunEventRecord>;
  recordToolCallStarted(
    run: AgentRunRecord,
    input: { toolName: string; input: unknown },
    startedAt: Date
  ): Promise<{ id: string }>;
  completeToolCall(toolCallId: string, output: unknown, completedAt: Date): Promise<unknown>;
  failToolCall(toolCallId: string, code: string, message: string, completedAt: Date): Promise<unknown>;
  completeRun(
    runId: string,
    assistantContent: string
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord }>;
  failRun(runId: string, code: string, message: string): Promise<AgentRunRecord>;
};

export interface AgentRepository {
  createThread(data: {
    agencyId: string;
    createdByUserId: string;
    title: string;
    tripId?: string | null;
  }): Promise<AgentThreadRecord>;
  listThreadsByAgency(agencyId: string): Promise<AgentThreadRecord[]>;
  findThreadByAgency(id: string, agencyId: string): Promise<AgentThreadRecord | null>;
  deleteThreadByAgency(id: string, agencyId: string): Promise<boolean>;
  approveItineraryThread(data: {
    agencyId: string;
    threadId: string;
    input: ApproveItineraryThreadInput;
  }): Promise<ApprovedItineraryThreadRecord | null>;
  createMessage(data: {
    threadId: string;
    runId?: string | null;
    authorUserId?: string | null;
    role: AgentMessageRole;
    content: string;
    metadata?: unknown;
  }): Promise<AgentMessageRecord>;
  createRun(data: {
    threadId: string;
    agencyId: string;
    triggerMessageId?: string | null;
    modelProvider: string;
    modelName: string;
  }): Promise<AgentRunRecord>;
  startRun(id: string, startedAt: Date): Promise<AgentRunRecord | null>;
  createUserMessageAndRun(data: {
    threadId: string;
    agencyId: string;
    authorUserId: string;
    content: string;
    modelProvider: string;
    modelName: string;
  }): Promise<{ message: AgentMessageRecord; run: AgentRunRecord }>;
  findRunById(id: string): Promise<AgentRunRecord | null>;
  listRunEvents(runId: string): Promise<AgentRunEventRecord[]>;
  touchThread?(threadId: string, updatedAt: Date): Promise<void>;
  createRunEvent(data: {
    runId: string;
    threadId: string;
    type: AgentEvent["type"];
    payload: Record<string, unknown>;
  }): Promise<AgentRunEventRecord>;
  createToolCall(data: {
    runId: string;
    threadId: string;
    toolName: string;
    status: AgentToolCallStatus;
    input?: unknown;
    outputSummary?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }): Promise<AgentToolCallRecord>;
  updateToolCall(
    id: string,
    data: {
      status: AgentToolCallStatus;
      outputSummary?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: Date | null;
    }
  ): Promise<AgentToolCallRecord | null>;
  createTaskAndEvent(data: {
    runId: string;
    threadId: string;
    label: string;
    status: AgentTaskStatus;
    sortOrder?: number;
  }): Promise<{ task: AgentTaskRecord; event: AgentRunEventRecord }>;
  createSourcesAndEvents(data: {
    runId: string;
    threadId: string;
    sources: AgentSourceInput[];
  }): Promise<{ sources: AgentSourceRecord[]; events: AgentRunEventRecord[] }>;
  completeRunIfOpen(
    id: string,
    data: {
      assistantContent: string;
      completedAt: Date;
    }
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord; events: AgentRunEventRecord[] } | null>;
  failRunIfOpen(
    id: string,
    data: {
      failedAt: Date;
      errorCode: string;
      errorMessage: string;
    }
  ): Promise<AgentRunRecord | null>;
  cancelRunIfOpen(id: string): Promise<AgentRunRecord | null>;
}
