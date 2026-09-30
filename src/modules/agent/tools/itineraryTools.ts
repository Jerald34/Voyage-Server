import { z } from "zod";
import { prisma } from "../../../db/prisma";
import type { PrismaClient } from "@prisma/client";
import type { MapsProvider } from "../../../services/maps";
import {
  addItineraryDayInputSchema,
  addItineraryItemInputSchema,
  deleteItineraryInputSchema,
  moveItineraryItemInputSchema,
  planItineraryInputSchema,
  removeItineraryDayInputSchema,
  removeItineraryItemInputSchema,
  replaceItinerarySchema,
  structuredItineraryInputSchema,
  structuredItineraryItemSchema,
  updateItineraryDayInputSchema,
  updateItineraryItemInputSchema
} from "../../itineraries/itinerarySchemas";
import type { StructuredItineraryInput } from "../../itineraries/itineraryService";
import type {
  AgentTool,
  AgentToolService,
  CreateItineraryService,
  ItineraryAgentService,
  UpdateItineraryService
} from "../agentTools";
import { createRunRecord, inputError, toTitleCase, isRecordLike } from "./toolUtils";
import { addRoutesToPreparedDays, resolveSingleItemPlace, attachRouteFromPrevious } from "./itineraryPlaceResolver";
import type { ItineraryPlaceExecution } from "../../itineraries/itineraryService";
import type { AgentToolContext } from "../agentTools";
import { ApiError } from "../../../http/errors";

const updateItineraryInputSchema = z.object({
  itineraryId: z.string().min(1),
  itinerary: replaceItinerarySchema
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

function normalizeCreateItineraryInput(input: any): StructuredItineraryInput {
  const data = (input && typeof input === 'object' && 'tripData' in input) ? input.tripData : input;

  const structured = structuredItineraryInputSchema.safeParse(data);
  if (structured.success) {
    return structured.data;
  }

  if (isRecordLike(input) && isRecordLike((input as Record<string, unknown>).trip) && isRecordLike((input as Record<string, unknown>).itinerary)) {
    throw inputError(structured.error);
  }

  const shorthandResult = createItineraryShorthandSchema.safeParse(input);
  if (!shorthandResult.success) {
    throw inputError(shorthandResult.error);
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

  // Round-robin highlight distribution: every highlight lands on some day, every day with a turn gets one.
  // (Previous behaviour mapped highlights[i] -> day i and silently dropped surplus highlights / left tail days empty.)
  const dayItems: Array<Array<{
    type: "ACTIVITY";
    title: string;
    placeName: string;
    cityContext: string;
    description: string;
  }>> = Array.from({ length: durationDays }, () => []);
  highlights.forEach((highlight, highlightIndex) => {
    const trimmed = highlight.trim();
    if (!trimmed) return;
    const dayIndex = highlightIndex % durationDays;
    dayItems[dayIndex].push({
      type: "ACTIVITY",
      title: trimmed,
      placeName: trimmed,
      cityContext: destinationTitle,
      description: `Requested highlight for Day ${dayIndex + 1} in ${destinationTitle}.`
    });
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
        title: `Day ${index + 1}`,
        items: dayItems[index]
      }))
    }
  });
}

function normalizeUpdateItineraryInput(input: any) {
  if (!isRecordLike(input)) {
    throw inputError();
  }

  // Standard format: { itineraryId: string, itinerary: { title, days, ... } }
  if ("itineraryId" in input && isRecordLike(input.itinerary)) {
    return updateItineraryInputSchema.parse(input);
  }

  // Flat format: { itineraryId: string, title: string, days: [], ... }
  // This happens when the model extracts the fields to the top level.
  if ("itineraryId" in input && Array.isArray(input.days)) {
    const { itineraryId, ...itineraryData } = input;
    try {
      return {
        itineraryId: String(itineraryId),
        itinerary: replaceItinerarySchema.parse(itineraryData)
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[Agent] normalizeUpdateItineraryInput Flat format Zod Error:", error.issues);
      }
      throw error;
    }
  }

  // Attempt to parse directly if it matches the schema but is missing the wrapper
  try {
    return updateItineraryInputSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[Agent] normalizeUpdateItineraryInput Zod Error:", error.issues);
    }
    throw error;
  }
}

/**
 * Build the internal execution context handed to the itinerary service. The
 * session comes from the run, never from a singleton, and the routing pass stays
 * in this layer because it owns the maps provider.
 *
 * Production always supplies a session; a tool constructed without one in an
 * isolated unit test simply performs no place checks.
 */
function placeExecution(
  context: AgentToolContext,
  maps?: MapsProvider
): ItineraryPlaceExecution | undefined {
  if (!context.places) return undefined;
  return {
    session: context.places,
    addRoutes: maps
      ? (days, points) => addRoutesToPreparedDays({ days, points, maps })
      : undefined
  };
}

export function createCreateItineraryTool(options: {
  itineraryService: CreateItineraryService;
  agentService?: AgentToolService;
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "create_itinerary",
    async execute(context, input) {
      const parsed = normalizeCreateItineraryInput(input);
      // The guarded service owns resolution and eligibility; this tool only
      // supplies the routing pass, so no place can be attached unchecked.
      const result = await options.itineraryService.createDraftFromStructuredInput(
        context.agencyId,
        context.userId,
        parsed,
        placeExecution(context, options.maps)
      );
      const createdItinerary = (result as { itinerary?: Record<string, unknown> & { id?: string; version?: number; status?: string } } | null)?.itinerary;
      if (createdItinerary?.id && options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.created",
          payload: {
            itineraryId: createdItinerary.id,
            version: createdItinerary.version ?? null,
            status: createdItinerary.status ?? null,
            change: "created",
            itinerary: createdItinerary as Record<string, unknown>
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
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "update_itinerary",
    async execute(context, input) {
      const parsed = normalizeUpdateItineraryInput(input);
      // Preservation of existing stops is computed by the service from the stored
      // itinerary, so this tool must not pre-resolve anything.
      const result = await options.itineraryService.replaceDraft(
        context.agencyId,
        parsed.itineraryId,
        parsed.itinerary,
        placeExecution(context, options.maps)
      );
      const updated = result as (Record<string, unknown> & { id?: string; version?: number; status?: string }) | null;
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.updated",
          payload: {
            itineraryId: updated?.id ?? parsed.itineraryId,
            version: updated?.version ?? null,
            status: updated?.status ?? null,
            change: "updated",
            itinerary: (updated ?? undefined) as Record<string, unknown> | undefined
          }
        });
      }
      return result;
    }
  };
}

export function createPlanItineraryTool(options: {
  itineraryService: Pick<ItineraryAgentService, "createPlanFromStructuredInput">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "plan_itinerary",
    async execute(context, input) {
      const parsed = planItineraryInputSchema.parse(input);
      const result = (await options.itineraryService.createPlanFromStructuredInput(
        context.agencyId,
        context.userId,
        parsed
      )) as { itinerary?: { id?: string; version?: number; status?: string }; trip?: { id?: string } } | null;
      const itinerary = result?.itinerary;
      if (options.agentService && itinerary?.id) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.created",
          payload: {
            itineraryId: itinerary.id,
            version: itinerary.version ?? null,
            status: itinerary.status ?? null,
            itinerary: itinerary as Record<string, unknown>
          }
        });
      }
      return result;
    }
  };
}

export function createDeleteItineraryTool(options: {
  itineraryService: Pick<ItineraryAgentService, "deleteItinerary">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "delete_itinerary",
    async execute(context, input) {
      const parsed = deleteItineraryInputSchema.parse(input);
      const result = await options.itineraryService.deleteItinerary(context.agencyId, parsed);
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.deleted",
          payload: {
            itineraryId: parsed.itineraryId,
            tripDeleted: result.tripDeleted
          }
        });
      }
      return { itineraryId: parsed.itineraryId, ...result };
    }
  };
}

export function createAddItineraryDayTool(options: {
  itineraryService: Pick<ItineraryAgentService, "addDay">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "add_itinerary_day",
    async execute(context, input) {
      const parsed = addItineraryDayInputSchema.parse(input);
      const result = (await options.itineraryService.addDay(context.agencyId, parsed)) as {
        itinerary: { id: string };
        day: Record<string, unknown>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.day.added",
          payload: {
            itineraryId: result.itinerary.id,
            day: result.day
          }
        });
      }
      return result;
    }
  };
}

export function createUpdateItineraryDayTool(options: {
  itineraryService: Pick<ItineraryAgentService, "updateDay">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "update_itinerary_day",
    async execute(context, input) {
      const parsed = updateItineraryDayInputSchema.parse(input);
      const result = (await options.itineraryService.updateDay(context.agencyId, parsed)) as {
        itinerary: { id: string };
        day: Record<string, unknown>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.day.updated",
          payload: {
            itineraryId: result.itinerary.id,
            day: result.day
          }
        });
      }
      return result;
    }
  };
}

export function createRemoveItineraryDayTool(options: {
  itineraryService: Pick<ItineraryAgentService, "removeDay">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "remove_itinerary_day",
    async execute(context, input) {
      const parsed = removeItineraryDayInputSchema.parse(input);
      const result = (await options.itineraryService.removeDay(context.agencyId, parsed)) as {
        itinerary: { id: string };
        days: Array<Record<string, unknown>>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.day.removed",
          payload: {
            itineraryId: result.itinerary.id,
            dayId: parsed.dayId,
            days: result.days
          }
        });
      }
      return result;
    }
  };
}

export function createAddItineraryItemTool(options: {
  itineraryService: Pick<ItineraryAgentService, "addItem" | "updateItem">;
  agentService?: AgentToolService;
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "add_itinerary_item",
    async execute(context, input) {
      const parsed = addItineraryItemInputSchema.parse(input);

      let result = (await options.itineraryService.addItem(
        context.agencyId,
        parsed,
        placeExecution(context, options.maps)
      )) as {
        itinerary: { id: string };
        dayId: string;
        item: Record<string, unknown>;
      };

      // Fire the SSE event immediately (so the card appears on the client) while
      // estimating the route from the previous item in parallel. The route update,
      // if successful, will trigger its own SSE event via updateItem.
      const routePromise = options.maps
        ? attachRouteFromPrevious({
            maps: options.maps,
            itineraryService: options.itineraryService,
            agencyId: context.agencyId,
            itineraryId: parsed.itineraryId,
            dayId: parsed.dayId,
            result
          })
        : Promise.resolve(result);

      const ssePromise = options.agentService
        ? options.agentService.recordRunEvent(createRunRecord(context), {
            type: "itinerary.item.added",
            payload: {
              itineraryId: result.itinerary.id,
              dayId: result.dayId,
              item: result.item
            }
          })
        : Promise.resolve(undefined);

      const [routedResult] = await Promise.all([routePromise, ssePromise]);
      result = routedResult as typeof result;

      return result;
    }
  };
}

export function createUpdateItineraryItemTool(options: {
  itineraryService: Pick<ItineraryAgentService, "updateItem">;
  agentService?: AgentToolService;
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "update_itinerary_item",
    async execute(context, input) {
      const parsed = updateItineraryItemInputSchema.parse(input);
      // The service decides whether this patch changes the stop's place identity.
      // A title, time or note edit keeps the saved stop and its route data even
      // when that stop is closed.
      const result = (await options.itineraryService.updateItem(
        context.agencyId,
        {
          itineraryId: parsed.itineraryId,
          itemId: parsed.itemId,
          item: parsed.item
        },
        placeExecution(context, options.maps)
      )) as {
        itinerary: { id: string };
        dayId: string;
        item: Record<string, unknown>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.item.updated",
          payload: {
            itineraryId: result.itinerary.id,
            dayId: result.dayId,
            item: result.item
          }
        });
      }
      return result;
    }
  };
}

export function createRemoveItineraryItemTool(options: {
  itineraryService: Pick<ItineraryAgentService, "removeItem">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "remove_itinerary_item",
    async execute(context, input) {
      const parsed = removeItineraryItemInputSchema.parse(input);
      const result = (await options.itineraryService.removeItem(context.agencyId, parsed)) as {
        itinerary: { id: string };
        dayId: string;
        itemId: string;
        items: Array<Record<string, unknown>>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.item.removed",
          payload: {
            itineraryId: result.itinerary.id,
            dayId: result.dayId,
            itemId: result.itemId,
            items: result.items
          }
        });
      }
      return result;
    }
  };
}

export function createMoveItineraryItemTool(options: {
  itineraryService: Pick<ItineraryAgentService, "moveItem">;
  agentService?: AgentToolService;
}): AgentTool {
  return {
    name: "move_itinerary_item",
    async execute(context, input) {
      const parsed = moveItineraryItemInputSchema.parse(input);
      const result = (await options.itineraryService.moveItem(context.agencyId, parsed)) as {
        itinerary: { id: string };
        fromDayId: string;
        toDayId: string;
        itemId: string;
        fromItems: Array<Record<string, unknown>>;
        toItems: Array<Record<string, unknown>>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.item.moved",
          payload: {
            itineraryId: result.itinerary.id,
            fromDayId: result.fromDayId,
            toDayId: result.toDayId,
            itemId: result.itemId,
            fromItems: result.fromItems,
            toItems: result.toItems
          }
        });
      }
      return result;
    }
  };
}
