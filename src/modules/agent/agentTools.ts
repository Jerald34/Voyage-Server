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
  clearRun?(runId: string): void;
};

type AgentToolRegistryOptions = {
  maxCallsByTool?: Record<string, number>;
  maxCallsByGroup?: Record<string, number>;
  toolGroups?: Record<string, string>;
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
  ): Promise<{ itinerary?: { id?: string; version?: number; status?: string }; trip?: { id?: string } } | unknown>;
};

type UpdateItineraryService = {
  replaceDraft(
    agencyId: string,
    itineraryId: string,
    input: z.infer<typeof replaceItinerarySchema>
  ): Promise<{ id?: string; version?: number; status?: string } | unknown>;
};

const taskInputSchema = z.object({
  label: z.string().min(1).max(200),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).default("PENDING"),
  sortOrder: z.number().int().nonnegative().optional()
});

const taskShorthandInputSchema = z.object({
  task: z.string().min(1).max(200).optional(),
  task_name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.string().min(1).max(40).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  sortOrder: z.number().int().nonnegative().optional()
}).superRefine((value, context) => {
  if (!value.task && !value.task_name) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either task or task_name is required."
    });
  }
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

const createItineraryShorthandSchema = z.object({
  destination: z.string().min(1).max(500).optional(),
  location: z.string().min(1).max(500).optional(),
  duration_days: z.number().int().positive().max(60).default(3),
  activity_type: z.string().min(1).max(120).optional(),
  highlights: z.array(z.string().min(1).max(300)).max(50).optional(),
  traveler_count: z.number().int().positive().max(999).optional(),
  budget_level: z.string().max(100).optional()
}).superRefine((value, context) => {
  if (!value.destination && !value.location) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either destination or location is required."
    });
  }
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

function normalizeTaskInput(input: unknown): z.infer<typeof taskInputSchema> {
  const strict = taskInputSchema.safeParse(input);
  if (strict.success) {
    return strict.data;
  }

  const shorthand = taskShorthandInputSchema.parse(input);
  const rawStatus = shorthand.status?.trim().toUpperCase();
  const normalizedStatus =
    rawStatus === "PENDING" || rawStatus === "RUNNING" || rawStatus === "COMPLETED" || rawStatus === "FAILED"
      ? rawStatus
      : undefined;
  const mappedStatus =
    normalizedStatus ??
    (shorthand.priority === "high"
      ? "RUNNING"
      : shorthand.priority === "medium"
        ? "PENDING"
        : "PENDING");
  const baseLabel = (shorthand.task_name ?? shorthand.task ?? "").trim();
  const label = shorthand.description?.trim()
    ? `${baseLabel} — ${shorthand.description.trim()}`.slice(0, 200)
    : baseLabel;

  return taskInputSchema.parse({
    label,
    status: mappedStatus,
    sortOrder: shorthand.sortOrder
  });
}

function toTitleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCreateItineraryInput(input: unknown): StructuredItineraryInput {
  const structured = structuredItineraryInputSchema.safeParse(input);
  if (structured.success) {
    return structured.data;
  }

  // If input looks structured (has trip + itinerary keys) but failed strict validation,
  // do not fall through to shorthand which would fail on missing destination/location.
  if (isRecordLike(input) && isRecordLike((input as Record<string, unknown>).trip) && isRecordLike((input as Record<string, unknown>).itinerary)) {
    throw inputError();
  }

  const shorthandResult = createItineraryShorthandSchema.safeParse(input);
  if (!shorthandResult.success) {
    throw inputError();
  }
  const shorthand = shorthandResult.data;
  const destination = (shorthand.destination ?? shorthand.location ?? "").trim();
  const destinationTitle = toTitleCase(destination);
  const durationDays = shorthand.duration_days;
  const activityType = shorthand.activity_type?.trim();
  const highlights = shorthand.highlights ?? [];
  const tripTitle = `${durationDays}-Day ${destinationTitle} Trip`;
  const itineraryTitle = activityType
    ? `${durationDays}-Day ${destinationTitle} ${toTitleCase(activityType)} Itinerary`
    : `${durationDays}-Day ${destinationTitle} Itinerary`;

  const dayItems = Array.from({ length: durationDays }, (_, index) => {
    const mappedHighlight = highlights[index];
    const fallbackTitle = activityType
      ? `${destinationTitle} ${toTitleCase(activityType)} Stop`
      : `${destinationTitle} Planning Stop`;

    return [
      {
        type: "ACTIVITY" as const,
        title: mappedHighlight?.trim() || fallbackTitle,
        description: mappedHighlight
          ? `Requested highlight for Day ${index + 1} in ${destinationTitle}.`
          : `A flexible Day ${index + 1} activity in ${destinationTitle} based on the agency request.`
      }
    ];
  });

  return structuredItineraryInputSchema.parse({
    trip: {
      title: tripTitle,
      destinationSummary: destinationTitle,
      travelerCount: shorthand.traveler_count,
      budgetLevel: shorthand.budget_level
    },
    itinerary: {
      title: itineraryTitle,
      summary: activityType
        ? `A ${durationDays}-day ${activityType} itinerary in ${destinationTitle}.`
        : `A ${durationDays}-day itinerary in ${destinationTitle}.`,
      days: Array.from({ length: durationDays }, (_, index) => ({
        dayNumber: index + 1,
        title: index === 0 ? "Arrival And Orientation" : `Day ${index + 1} Plan`,
        items: dayItems[index]
      }))
    }
  });
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
          throw inputError();
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

export function createRecordAgentTaskTool(options: { agentService: AgentToolService }): AgentTool {
  return {
    name: "record_agent_task",
    async execute(context, input) {
      const parsed = normalizeTaskInput(input);
      const run = createRunRecord(context);
      return options.agentService.recordTask(run, {
        label: parsed.label,
        status: parsed.status,
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {})
      });
    }
  };
}

export function createCreateItineraryTool(options: {
  itineraryService: CreateItineraryService;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "create_itinerary",
    async execute(context, input) {
      const parsed = normalizeCreateItineraryInput(input);
      const result = await options.itineraryService.createDraftFromStructuredInput(context.agencyId, context.userId, parsed);
      const itinerary = (result as { itinerary?: { id?: string; version?: number; status?: string } } | null)?.itinerary;
      if (itinerary?.id && options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.updated",
          payload: {
            itineraryId: itinerary.id,
            version: itinerary.version ?? null,
            status: itinerary.status ?? null,
            change: "created"
          }
        });
      }
      return result;
    }
  };
}

export function createUpdateItineraryTool(options: {
  itineraryService: UpdateItineraryService;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "update_itinerary",
    async execute(context, input) {
      const parsed = updateItineraryInputSchema.parse(input);
      const result = await options.itineraryService.replaceDraft(context.agencyId, parsed.itineraryId, parsed.itinerary);
      const updated = result as { id?: string; version?: number; status?: string } | null;
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.updated",
          payload: {
            itineraryId: updated?.id ?? parsed.itineraryId,
            version: updated?.version ?? null,
            status: updated?.status ?? null,
            change: "updated"
          }
        });
      }
      return result;
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
        hl: parsed.language,
        gl: parsed.region
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
