import { ApiError } from "../../http/errors";
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
  updateItineraryItemInputSchema,
  type structuredItineraryDaySchema
} from "./itinerarySchemas";
import type { z } from "zod";
import type { ItineraryRepository } from "./itineraryTypes";

// Re-export all types from itineraryTypes
export * from "./itineraryTypes";

export type StructuredItineraryInput = z.infer<typeof structuredItineraryInputSchema>;
export type ReplaceItineraryInput = z.infer<typeof replaceItinerarySchema>;
export type PlanItineraryInput = z.infer<typeof planItineraryInputSchema>;
export type AddItineraryDayInput = z.infer<typeof addItineraryDayInputSchema>;
export type UpdateItineraryDayInput = z.infer<typeof updateItineraryDayInputSchema>;
export type RemoveItineraryDayInput = z.infer<typeof removeItineraryDayInputSchema>;
export type AddItineraryItemInput = z.infer<typeof addItineraryItemInputSchema>;
export type UpdateItineraryItemInput = z.infer<typeof updateItineraryItemInputSchema>;
export type RemoveItineraryItemInput = z.infer<typeof removeItineraryItemInputSchema>;
export type MoveItineraryItemInput = z.infer<typeof moveItineraryItemInputSchema>;
export type DeleteItineraryInput = z.infer<typeof deleteItineraryInputSchema>;
type StructuredItineraryDay = z.infer<typeof structuredItineraryDaySchema>;
type StructuredItineraryItem = z.infer<typeof structuredItineraryItemSchema>;

// Matches canonical UUIDs (v1-v5) emitted by Postgres' uuid type. We accept any version
// because the database does not constrain to v4 specifically.
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Throws an instructive ApiError if `value` is not a UUID. Surfaced back to the agent so it
// can self-correct on its next continuation turn instead of crashing inside Prisma.
export function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    const received = typeof value === "string" ? value : typeof value;
    throw new ApiError(
      400,
      "AGENT_TOOL_INPUT_INVALID",
      `${field} must be a UUID. Use the exact UUIDs returned by plan_itinerary or the most recent itinerary tool result. Received: ${received}.`
    );
  }
}

export function createItineraryService(options: { repository: ItineraryRepository }) {
  return {
    async listTripsWithItineraries(agencyId: string) {
      return options.repository.listTripsWithItineraries(agencyId);
    },

    async createDraftFromStructuredInput(
      agencyId: string,
      createdByUserId: string,
      input: StructuredItineraryInput
    ) {
      const parsed = structuredItineraryInputSchema.parse(input);
      return options.repository.createTripWithItinerary({
        agencyId,
        createdByUserId,
        trip: parsed.trip,
        itinerary: parsed.itinerary
      });
    },

    async getItinerary(agencyId: string, itineraryId: string) {
      const itinerary = await options.repository.findItineraryByAgency(itineraryId, agencyId);
      if (!itinerary) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return itinerary;
    },

    async replaceDraft(agencyId: string, itineraryId: string, input: ReplaceItineraryInput) {
      const parsed = replaceItinerarySchema.parse(input);
      const existing = await options.repository.findItineraryByAgency(itineraryId, agencyId);
      if (!existing) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
      }

      const itinerary = await options.repository.replaceItineraryDraft(itineraryId, agencyId, parsed);
      if (!itinerary) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return itinerary;
    },

    async createPlanFromStructuredInput(
      agencyId: string,
      createdByUserId: string,
      input: PlanItineraryInput
    ) {
      const parsed = planItineraryInputSchema.parse(input);
      return options.repository.createPlanItinerary({
        agencyId,
        createdByUserId,
        trip: parsed.trip,
        itinerary: parsed.itinerary
      });
    },

    async deleteItinerary(agencyId: string, input: DeleteItineraryInput) {
      const parsed = deleteItineraryInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      return options.repository.deleteItinerary(parsed.itineraryId, agencyId, {
        deleteTrip: parsed.deleteTrip
      });
    },

    async deleteTrip(agencyId: string, tripId: string) {
      assertUuid(tripId, "tripId");
      return options.repository.deleteTrip(tripId, agencyId);
    },

    async addDay(agencyId: string, input: AddItineraryDayInput) {
      const parsed = addItineraryDayInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      return options.repository.addDay(parsed.itineraryId, agencyId, {
        dayNumber: parsed.dayNumber,
        title: parsed.title,
        summary: parsed.summary,
        date: parsed.date ?? null
      });
    },

    async updateDay(agencyId: string, input: UpdateItineraryDayInput) {
      const parsed = updateItineraryDayInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.dayId, "dayId");
      return options.repository.updateDay(parsed.itineraryId, agencyId, parsed.dayId, {
        title: parsed.title,
        summary: parsed.summary,
        date: parsed.date ?? undefined
      });
    },

    async removeDay(agencyId: string, input: RemoveItineraryDayInput) {
      const parsed = removeItineraryDayInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.dayId, "dayId");
      return options.repository.removeDay(parsed.itineraryId, agencyId, parsed.dayId);
    },

    async addItem(agencyId: string, input: AddItineraryItemInput) {
      const parsed = addItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.dayId, "dayId");
      return options.repository.addItem(parsed.itineraryId, agencyId, {
        dayId: parsed.dayId,
        sortOrder: parsed.sortOrder,
        item: parsed.item
      });
    },

    async updateItem(agencyId: string, input: UpdateItineraryItemInput) {
      const parsed = updateItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.itemId, "itemId");
      return options.repository.updateItem(parsed.itineraryId, agencyId, parsed.itemId, parsed.item);
    },

    async removeItem(agencyId: string, input: RemoveItineraryItemInput) {
      const parsed = removeItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.itemId, "itemId");
      return options.repository.removeItem(parsed.itineraryId, agencyId, parsed.itemId);
    },

    async moveItem(agencyId: string, input: MoveItineraryItemInput) {
      const parsed = moveItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.itemId, "itemId");
      assertUuid(parsed.toDayId, "toDayId");
      return options.repository.moveItem(parsed.itineraryId, agencyId, parsed.itemId, {
        toDayId: parsed.toDayId,
        toSortOrder: parsed.toSortOrder
      });
    }
  };
}

import { createPrismaItineraryRepository } from "./itineraryRepository";

export const itineraryService = createItineraryService({
  repository: createPrismaItineraryRepository()
});

