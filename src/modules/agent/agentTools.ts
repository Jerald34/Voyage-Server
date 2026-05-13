import { ZodError } from "zod";
import { ApiError } from "../../http/errors";
import type {
  AddItineraryDayInput,
  AddItineraryItemInput,
  DeleteItineraryInput,
  MoveItineraryItemInput,
  PlanItineraryInput,
  RemoveItineraryDayInput,
  RemoveItineraryItemInput,
  StructuredItineraryInput,
  UpdateItineraryDayInput,
  UpdateItineraryItemInput
} from "../itineraries/itineraryService";
import type { AgentRunRecord, AgentSourceInput, AgentTaskInput } from "./agentTypes";
import type { AgentEvent } from "./agentSchemas";

export type AgentToolContext = {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
};

export type AgentTool = {
  name: string;
  execute(context: AgentToolContext, input: unknown): Promise<unknown>;
};

export type AgentToolRegistry = {
  execute(name: string, context: AgentToolContext, input: unknown): Promise<unknown>;
  clearRun?(runId: string): void;
};

export type AgentToolRegistryOptions = {
  maxCallsByTool?: Record<string, number>;
  maxCallsByGroup?: Record<string, number>;
  toolGroups?: Record<string, string>;
};

export type AgentToolService = {
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<unknown>;
  recordTask(run: AgentRunRecord, input: AgentTaskInput): Promise<unknown>;
  recordSources(run: AgentRunRecord, sources: AgentSourceInput[]): Promise<unknown>;
};

export type CreateItineraryService = {
  createDraftFromStructuredInput(
    agencyId: string,
    createdByUserId: string,
    input: StructuredItineraryInput
  ): Promise<{ itinerary?: { id?: string; version?: number; status?: string }; trip?: { id?: string } } | unknown>;
};

export type UpdateItineraryService = {
  replaceDraft(
    agencyId: string,
    itineraryId: string,
    input: any // Using any to avoid complex zod dependency here
  ): Promise<{ id?: string; version?: number; status?: string } | unknown>;
};

// Combined service surface used by the granular itinerary tools (plan, delete, day/item-level ops).
// Tool factories accept a thin subset of this shape so they remain unit-testable.
export type ItineraryAgentService = {
  createDraftFromStructuredInput(
    agencyId: string,
    createdByUserId: string,
    input: StructuredItineraryInput
  ): Promise<unknown>;
  replaceDraft(
    agencyId: string,
    itineraryId: string,
    input: any
  ): Promise<unknown>;
  createPlanFromStructuredInput(
    agencyId: string,
    createdByUserId: string,
    input: PlanItineraryInput
  ): Promise<unknown>;
  deleteItinerary(
    agencyId: string,
    input: DeleteItineraryInput
  ): Promise<{ deleted: boolean; tripDeleted: boolean }>;
  addDay(agencyId: string, input: AddItineraryDayInput): Promise<unknown>;
  updateDay(agencyId: string, input: UpdateItineraryDayInput): Promise<unknown>;
  removeDay(agencyId: string, input: RemoveItineraryDayInput): Promise<unknown>;
  addItem(agencyId: string, input: AddItineraryItemInput): Promise<unknown>;
  updateItem(agencyId: string, input: UpdateItineraryItemInput): Promise<unknown>;
  removeItem(agencyId: string, input: RemoveItineraryItemInput): Promise<unknown>;
  moveItem(agencyId: string, input: MoveItineraryItemInput): Promise<unknown>;
};

function limitKey(runId: string, toolName: string) {
  return `${runId}:${toolName}`;
}

export function createAgentToolRegistry(tools: AgentTool[], options: AgentToolRegistryOptions = {}): AgentToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const callsByRunAndTool = new Map<string, number>();
  const callsByRunAndGroup = new Map<string, number>();

  return {
    async execute(name, context, input) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ApiError(400, "AGENT_TOOL_NOT_FOUND", `Unknown agent tool: ${name}`);
      }

      const maxCalls = options.maxCallsByTool?.[name];
      if (maxCalls !== undefined) {
        const key = limitKey(context.runId, name);
        const currentCalls = callsByRunAndTool.get(key) ?? 0;
        if (currentCalls >= maxCalls) {
          throw new ApiError(429, "AGENT_TOOL_LIMIT_REACHED", `Agent tool call limit reached: ${name}`);
        }
        callsByRunAndTool.set(key, currentCalls + 1);
      }

      const groupName = options.toolGroups?.[name];
      const maxGroupCalls = groupName ? options.maxCallsByGroup?.[groupName] : undefined;
      if (groupName && maxGroupCalls !== undefined) {
        const key = limitKey(context.runId, groupName);
        const currentCalls = callsByRunAndGroup.get(key) ?? 0;
        if (currentCalls >= maxGroupCalls) {
          throw new ApiError(429, "AGENT_TOOL_LIMIT_REACHED", `Agent tool call limit reached: ${groupName}`);
        }
        callsByRunAndGroup.set(key, currentCalls + 1);
      }

      try {
        return await tool.execute(context, input);
      } catch (error) {
        if (error instanceof ZodError) {
          const summary = error.issues
            .slice(0, 5)
            .map((issue) => {
              const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
              return `${path}: ${issue.message}`;
            })
            .join("; ");
          throw new ApiError(
            400,
            "AGENT_TOOL_INPUT_INVALID",
            `Agent tool input invalid: ${summary || "validation failed"}`
          );
        }
        throw error;
      }
    },

    clearRun(runId) {
      for (const key of callsByRunAndTool.keys()) {
        if (key.startsWith(`${runId}:`)) callsByRunAndTool.delete(key);
      }
      for (const key of callsByRunAndGroup.keys()) {
        if (key.startsWith(`${runId}:`)) callsByRunAndGroup.delete(key);
      }
    }
  };
}

export * from "./tools";
