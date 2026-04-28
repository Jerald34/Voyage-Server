import { z } from "zod";
import { ApiError } from "../../http/errors";
import type { MapsProvider } from "../../services/maps";
import type { WebSearchProvider } from "../../services/webSearch";
import { replaceItinerarySchema, structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
import type { StructuredItineraryInput } from "../itineraries/itineraryService";
import type { AgentRunRecord } from "./agentService";
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
};

type AgentToolRegistryOptions = {
  maxCallsByTool?: Record<string, number>;
};

type AgentTaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

type AgentTaskEventService = {
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<unknown>;
};

type CreateItineraryService = {
  createDraftFromStructuredInput(
    agencyId: string,
    createdByUserId: string,
    input: StructuredItineraryInput
  ): Promise<unknown>;
};

type UpdateItineraryService = {
  replaceDraft(agencyId: string, itineraryId: string, input: z.infer<typeof replaceItinerarySchema>): Promise<unknown>;
};

const taskInputSchema = z.object({
  label: z.string().min(1).max(200),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).default("PENDING"),
  sortOrder: z.number().int().nonnegative().optional()
});

const updateItineraryInputSchema = z.object({
  itineraryId: z.string().min(1),
  itinerary: replaceItinerarySchema
});

const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const searchPlacesInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(20).default(5),
  locationBias: z.unknown().optional(),
  languageCode: z.string().min(2).max(20).optional()
});

const placeDetailsInputSchema = z.object({
  placeId: z.string().min(1).max(500)
});

const routeInputSchema = z.object({
  origin: geoPointSchema,
  destination: geoPointSchema,
  travelMode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]).default("DRIVE")
});

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(10).default(5),
  region: z.string().min(2).max(20).optional(),
  language: z.string().min(2).max(20).optional()
});

function createRunRecord(context: AgentToolContext): AgentRunRecord {
  const now = new Date();
  return {
    id: context.runId,
    threadId: context.threadId,
    agencyId: context.agencyId,
    triggerMessageId: null,
    status: "RUNNING",
    modelProvider: "agent-orchestrator",
    modelName: "agent-orchestrator",
    startedAt: now,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now
  };
}

function limitKey(runId: string, toolName: string) {
  return `${runId}:${toolName}`;
}

export function createAgentToolRegistry(tools: AgentTool[], options: AgentToolRegistryOptions = {}): AgentToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const callsByRunAndTool = new Map<string, number>();

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

      return tool.execute(context, input);
    }
  };
}

export function createRecordAgentTaskTool(options: { agentService: AgentTaskEventService }): AgentTool {
  return {
    name: "record_agent_task",
    async execute(context, input) {
      const parsed = taskInputSchema.parse(input);
      const payload: { label: string; status: AgentTaskStatus; sortOrder?: number } = {
        label: parsed.label,
        status: parsed.status
      };
      if (parsed.sortOrder !== undefined) {
        payload.sortOrder = parsed.sortOrder;
      }

      await options.agentService.recordRunEvent(createRunRecord(context), {
        type: "task.updated",
        payload
      });

      return payload;
    }
  };
}

export function createCreateItineraryTool(options: { itineraryService: CreateItineraryService }): AgentTool {
  return {
    name: "create_itinerary",
    async execute(context, input) {
      const parsed = structuredItineraryInputSchema.parse(input);
      return options.itineraryService.createDraftFromStructuredInput(context.agencyId, context.userId, parsed);
    }
  };
}

export function createUpdateItineraryTool(options: { itineraryService: UpdateItineraryService }): AgentTool {
  return {
    name: "update_itinerary",
    async execute(context, input) {
      const parsed = updateItineraryInputSchema.parse(input);
      return options.itineraryService.replaceDraft(context.agencyId, parsed.itineraryId, parsed.itinerary);
    }
  };
}

export function createSearchGooglePlacesTool(options: { maps: MapsProvider }): AgentTool {
  return {
    name: "search_google_places",
    async execute(_context, input) {
      const parsed = searchPlacesInputSchema.parse(input);
      return options.maps.searchPlaces({
        query: parsed.query,
        languageCode: parsed.languageCode,
        maxResultCount: parsed.maxResults
      });
    }
  };
}

export function createGetGooglePlaceDetailsTool(options: { maps: MapsProvider }): AgentTool {
  return {
    name: "get_google_place_details",
    async execute(_context, input) {
      const parsed = placeDetailsInputSchema.parse(input);
      return options.maps.getPlaceDetails(parsed.placeId);
    }
  };
}

export function createEstimateRouteTool(options: { maps: MapsProvider }): AgentTool {
  return {
    name: "estimate_route",
    async execute(_context, input) {
      const parsed = routeInputSchema.parse(input);
      return options.maps.estimateRoute({
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode
      });
    }
  };
}

export function createWebSearchTool(options: { webSearch: WebSearchProvider }): AgentTool {
  return {
    name: "web_search",
    async execute(_context, input) {
      const parsed = webSearchInputSchema.parse(input);
      return options.webSearch.search({
        query: parsed.query,
        num: parsed.maxResults,
        hl: parsed.language
      });
    }
  };
}
