import { z } from "zod";
import { prisma } from "../../../db/prisma";
import type { PrismaClient } from "@prisma/client";
import type { MapsProvider, ResolvedPlace } from "../../../services/maps";
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
import { createRunRecord, inputError, toTitleCase, isRecordLike, upsertPlaceSnapshot } from "./toolUtils";
import { enrichResolvedPlaceForSnapshot } from "./placeSnapshotEnrichment";

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

async function resolveItineraryItemPlaces<T extends StructuredItineraryInput["itinerary"]>(options: {
  input: T;
  maps: MapsProvider;
  client: PrismaClient;
}): Promise<T> {
  const days = await Promise.all(
    options.input.days.map(async (day) => ({
      ...day,
      items: await Promise.all(
        day.items.map(async (item) => {
          if (item.placeSnapshotId || !item.placeName) {
            return item;
          }

          try {
            console.log(`[Maps] Resolving place: "${item.placeName}" in context: "${item.cityContext ?? options.input.title}"`);
            const resolved = await options.maps.resolvePlace({
              placeName: item.placeName,
              cityContext: item.cityContext ?? options.input.title
            });
            console.log(`[Maps] Successfully resolved "${item.placeName}" to ${resolved.location.latitude}, ${resolved.location.longitude}`);
            const enriched = await enrichResolvedPlaceForSnapshot(options.maps, resolved);
            const snapshot = await upsertPlaceSnapshot(options.client, enriched);
            return {
              ...item,
              placeSnapshotId: snapshot.id
            };
          } catch (error) {
            console.error(`[Maps] Failed to resolve place: "${item.placeName}"`, error);
            return item;
          }
        })
      )
    }))
  );

  return {
    ...options.input,
    days
  } as T;
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
      const resolvedItinerary = options.maps
        ? await resolveItineraryItemPlaces({
          input: parsed.itinerary,
          maps: options.maps,
          client: options.placeSnapshotClient ?? prisma
        })
        : parsed.itinerary;
      const result = await options.itineraryService.createDraftFromStructuredInput(context.agencyId, context.userId, {
        ...parsed,
        itinerary: resolvedItinerary
      });
      const createdItinerary = (result as { itinerary?: { id?: string; version?: number; status?: string } } | null)?.itinerary;
      if (createdItinerary?.id && options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.updated",
          payload: {
            itineraryId: createdItinerary.id,
            version: createdItinerary.version ?? null,
            status: createdItinerary.status ?? null,
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
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "update_itinerary",
    async execute(context, input) {
      const parsed = normalizeUpdateItineraryInput(input);
      const itinerary = options.maps
        ? await resolveItineraryItemPlaces({
          input: parsed.itinerary,
          maps: options.maps,
          client: options.placeSnapshotClient ?? prisma
        })
        : parsed.itinerary;
      const result = await options.itineraryService.replaceDraft(context.agencyId, parsed.itineraryId, itinerary);
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

// Resolve a single itinerary item's place via Maps. Used by add_itinerary_item and update_itinerary_item
// so the place pin can light up on the map alongside each progressive reveal.
async function resolveSingleItemPlace(options: {
  item: z.infer<typeof structuredItineraryItemSchema>;
  cityContextFallback?: string;
  maps: MapsProvider;
  client: PrismaClient;
}): Promise<{ item: z.infer<typeof structuredItineraryItemSchema>; resolved: ResolvedPlace | null }> {
  const { item } = options;
  if (item.placeSnapshotId || !item.placeName) {
    return { item, resolved: null };
  }

  try {
    const resolved = await options.maps.resolvePlace({
      placeName: item.placeName,
      cityContext: item.cityContext ?? options.cityContextFallback
    });
    const enriched = await enrichResolvedPlaceForSnapshot(options.maps, resolved);
    const snapshot = await upsertPlaceSnapshot(options.client, enriched);
    return {
      item: { ...item, placeSnapshotId: snapshot.id },
      resolved: enriched
    };
  } catch (error) {
    console.error(`[Maps] Failed to resolve item place: "${item.placeName}"`, error);
    return { item, resolved: null };
  }
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
  itineraryService: Pick<ItineraryAgentService, "addItem">;
  agentService?: AgentToolService;
  maps?: MapsProvider;
  placeSnapshotClient?: PrismaClient;
}): AgentTool {
  return {
    name: "add_itinerary_item",
    async execute(context, input) {
      const parsed = addItineraryItemInputSchema.parse(input);
      let item = parsed.item;
      if (options.maps) {
        const { item: resolvedItem } = await resolveSingleItemPlace({
          item,
          maps: options.maps,
          client: options.placeSnapshotClient ?? prisma
        });
        item = resolvedItem;
      }

      const result = (await options.itineraryService.addItem(context.agencyId, {
        ...parsed,
        item
      })) as {
        itinerary: { id: string };
        dayId: string;
        item: Record<string, unknown>;
      };
      if (options.agentService) {
        await options.agentService.recordRunEvent(createRunRecord(context), {
          type: "itinerary.item.added",
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
      // If the patch supplies a placeName but no placeSnapshotId, re-resolve via maps.
      // If neither is in the patch, leave the existing snapshot untouched (the repo preserves it).
      let patch = parsed.item;
      if (
        options.maps &&
        typeof patch.placeName === "string" &&
        patch.placeName.trim().length > 0 &&
        !patch.placeSnapshotId
      ) {
        // Build a minimum item shape so resolveSingleItemPlace can consume it.
        const itemForResolution = structuredItineraryItemSchema.parse({
          type: patch.type ?? "ACTIVITY",
          title: patch.title ?? patch.placeName,
          placeName: patch.placeName,
          cityContext: patch.cityContext
        });
        const { item: resolvedItem } = await resolveSingleItemPlace({
          item: itemForResolution,
          maps: options.maps,
          client: options.placeSnapshotClient ?? prisma
        });
        if (resolvedItem.placeSnapshotId) {
          patch = { ...patch, placeSnapshotId: resolvedItem.placeSnapshotId };
        }
      }

      const result = (await options.itineraryService.updateItem(context.agencyId, {
        itineraryId: parsed.itineraryId,
        itemId: parsed.itemId,
        item: patch
      })) as {
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
