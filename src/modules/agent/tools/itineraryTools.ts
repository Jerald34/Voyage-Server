import { z } from "zod";
import { prisma } from "../../../db/prisma";
import type { PrismaClient } from "@prisma/client";
import type { MapsProvider } from "../../../services/maps";
import { replaceItinerarySchema, structuredItineraryInputSchema } from "../../itineraries/itinerarySchemas";
import type { StructuredItineraryInput } from "../../itineraries/itineraryService";
import type { AgentTool, AgentToolService, CreateItineraryService, UpdateItineraryService } from "../agentTools";
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

    return mappedHighlight
      ? [
        {
          type: "ACTIVITY" as const,
          title: mappedHighlight.trim(),
          placeName: mappedHighlight.trim(),
          cityContext: destinationTitle,
          description: `Requested highlight for Day ${index + 1} in ${destinationTitle}.`
        }
      ]
      : [];
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
      const parsed = updateItineraryInputSchema.parse(input);
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
