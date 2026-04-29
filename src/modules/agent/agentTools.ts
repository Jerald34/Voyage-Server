import { ZodError, z } from "zod";
import { ApiError } from "../../http/errors";
import type { MapsProvider } from "../../services/maps";
import type { WebSearchProvider } from "../../services/webSearch";
import { replaceItinerarySchema, structuredItineraryInputSchema } from "../itineraries/itinerarySchemas";
import type { StructuredItineraryInput } from "../itineraries/itineraryService";
import type { AgentRunRecord, AgentSourceInput, AgentTaskInput } from "./agentService";
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

type AgentToolService = {
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<unknown>;
  recordTask(run: AgentRunRecord, input: AgentTaskInput): Promise<unknown>;
  recordSources(run: AgentRunRecord, sources: AgentSourceInput[]): Promise<unknown>;
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

function inputError() {
  return new ApiError(400, "AGENT_TOOL_INPUT_INVALID", "Agent tool input was invalid.");
}

function toCompactMetadata(value: Record<string, unknown>) {
  return value;
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

      try {
        return await tool.execute(context, input);
      } catch (error) {
        if (error instanceof ZodError) {
          throw inputError();
        }
        throw error;
      }
    }
  };
}

export function createRecordAgentTaskTool(options: { agentService: AgentToolService }): AgentTool {
  return {
    name: "record_agent_task",
    async execute(context, input) {
      const parsed = taskInputSchema.parse(input);
      const run = createRunRecord(context);
      return options.agentService.recordTask(run, {
        label: parsed.label,
        status: parsed.status,
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {})
      });
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

export function createSearchGooglePlacesTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "search_google_places",
    async execute(_context, input) {
      const parsed = searchPlacesInputSchema.parse(input);
      const results = await options.maps.searchPlaces({
        query: parsed.query,
        languageCode: parsed.languageCode,
        maxResultCount: parsed.maxResults
      });
      await options.agentService.recordSources(
        createRunRecord(_context),
        results.map((result, index) => ({
          sourceType: "MAP_PLACE",
          title: result.name,
          url: null,
          snippet: result.address ?? null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            query: parsed.query,
            languageCode: parsed.languageCode ?? null,
            maxResults: parsed.maxResults,
            index,
            placeId: result.id,
            rating: result.rating ?? null,
            userRatingCount: result.userRatingCount ?? null,
            types: result.types
          })
        }))
      );
      return results;
    }
  };
}

export function createGetGooglePlaceDetailsTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "get_google_place_details",
    async execute(_context, input) {
      const parsed = placeDetailsInputSchema.parse(input);
      const result = await options.maps.getPlaceDetails(parsed.placeId);
      await options.agentService.recordSources(createRunRecord(_context), [
        {
          sourceType: "MAP_PLACE",
          title: result.name,
          url: result.websiteUri ?? null,
          snippet: result.address ?? null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            placeId: result.id,
            phoneNumber: result.phoneNumber ?? null,
            websiteUri: result.websiteUri ?? null,
            rating: result.rating ?? null,
            userRatingCount: result.userRatingCount ?? null,
            types: result.types
          })
        }
      ]);
      return result;
    }
  };
}

export function createEstimateRouteTool(options: { maps: MapsProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "estimate_route",
    async execute(_context, input) {
      const parsed = routeInputSchema.parse(input);
      const result = await options.maps.estimateRoute({
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode
      });
      await options.agentService.recordSources(createRunRecord(_context), [
        {
          sourceType: "MAP_ROUTE",
          title: "Route estimate",
          url: null,
          snippet:
            result.distanceMeters !== undefined || result.durationSeconds !== undefined
              ? `distance=${result.distanceMeters ?? "unknown"} duration=${result.durationSeconds ?? "unknown"}`
              : null,
          provider: "google_maps",
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            origin: parsed.origin,
            destination: parsed.destination,
            travelMode: parsed.travelMode,
            distanceMeters: result.distanceMeters ?? null,
            durationSeconds: result.durationSeconds ?? null,
            staticDurationSeconds: result.staticDurationSeconds ?? null
          })
        }
      ]);
      return result;
    }
  };
}

export function createWebSearchTool(options: { webSearch: WebSearchProvider; agentService: AgentToolService }): AgentTool {
  return {
    name: "web_search",
    async execute(_context, input) {
      const parsed = webSearchInputSchema.parse(input);
      const results = await options.webSearch.search({
        query: parsed.query,
        num: parsed.maxResults,
        hl: parsed.language
      });
      await options.agentService.recordSources(
        createRunRecord(_context),
        results.map((result, index) => ({
          sourceType: "WEB",
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          provider: result.provider,
          retrievedAt: new Date(),
          metadata: toCompactMetadata({
            query: parsed.query,
            index,
            language: parsed.language ?? null,
            region: parsed.region ?? null
          })
        }))
      );
      return results;
    }
  };
}
