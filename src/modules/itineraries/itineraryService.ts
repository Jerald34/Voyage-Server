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
import type { PlaceSelectionSession } from "../../services/places/placeTypes";
import {
  prepareItineraryItems,
  prepareReplacementItems,
  prepareUpdatedItem,
  storedPointsBySnapshotId
} from "./itineraryPlaceGuard";

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

/**
 * Internal execution context for a mutation. It is never part of any request-body
 * schema: production composition supplies it, and isolated unit tests may inject a
 * deterministic fake. Without a session the service performs no place checks, so
 * every production call path must provide one.
 */
export type ItineraryPlaceExecution = {
  session: PlaceSelectionSession;
  /**
   * Optional routing pass, supplied by the agent tool layer which owns the maps
   * provider. It receives the already-prepared days plus trusted stored points so
   * preserved stops keep their routes without being re-resolved.
   */
  addRoutes?: (
    days: any[],
    points: Map<string, { latitude: number; longitude: number }>
  ) => Promise<any[]>;
};

export function createItineraryService(options: { repository: ItineraryRepository }) {
  /**
   * Points the routing pass may trust: freshly prepared coordinates plus the
   * stored coordinates of preserved stops, so a preserved place is never
   * re-resolved just to draw a route to it.
   */
  function mergePoints(
    prepared: Array<{ placeSnapshotId: string | null; point: { latitude: number; longitude: number } | null }>,
    existing?: unknown
  ) {
    const points = existing
      ? storedPointsBySnapshotId(existing as any)
      : new Map<string, { latitude: number; longitude: number }>();
    for (const entry of prepared) {
      if (entry.placeSnapshotId && entry.point) points.set(entry.placeSnapshotId, entry.point);
    }
    return points;
  }

  async function prepareCreatedItinerary(
    itinerary: StructuredItineraryInput["itinerary"],
    agencyId: string,
    execution?: ItineraryPlaceExecution
  ) {
    if (!execution) return itinerary;

    const days: unknown[] = [];
    const allPrepared: Array<{
      placeSnapshotId: string | null;
      point: { latitude: number; longitude: number } | null;
    }> = [];

    for (const day of itinerary.days) {
      const prepared = await prepareItineraryItems({
        session: execution.session,
        items: (day.items ?? []) as any[],
        cityContextFallback: itinerary.title,
        expectedAgencyId: agencyId
      });
      allPrepared.push(...prepared);
      days.push({ ...day, items: prepared.map((entry) => entry.item) });
    }

    const withDays = { ...itinerary, days } as StructuredItineraryInput["itinerary"];
    if (!execution.addRoutes) return withDays;
    return {
      ...withDays,
      days: await execution.addRoutes(days as any[], mergePoints(allPrepared))
    } as StructuredItineraryInput["itinerary"];
  }

  return {
    async listTripsWithItineraries(agencyId: string) {
      return options.repository.listTripsWithItineraries(agencyId);
    },

    async listTripsForUser(agencyId: string, filter: { role: "OWNER" | "ADMIN" | "STAFF"; userId: string }) {
      return options.repository.listTripsForUser(agencyId, filter);
    },

    async createDraftFromStructuredInput(
      agencyId: string,
      createdByUserId: string,
      input: StructuredItineraryInput,
      execution?: ItineraryPlaceExecution
    ) {
      const parsed = structuredItineraryInputSchema.parse(input);
      // Every place in a new itinerary is a new selection. The whole payload is
      // prepared and validated before a single row is written, so a blocked item
      // rejects the create atomically.
      const itinerary = await prepareCreatedItinerary(parsed.itinerary, agencyId, execution);
      return options.repository.createTripWithItinerary({
        agencyId,
        createdByUserId,
        trip: parsed.trip,
        itinerary
      });
    },

    async getItinerary(agencyId: string, itineraryId: string) {
      const itinerary = await options.repository.findItineraryByAgency(itineraryId, agencyId);
      if (!itinerary) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return itinerary;
    },

    async replaceDraft(
      agencyId: string,
      itineraryId: string,
      input: ReplaceItineraryInput,
      execution?: ItineraryPlaceExecution
    ) {
      const parsed = replaceItinerarySchema.parse(input);
      // Draft/ownership checks run before any provider work.
      const existing = await options.repository.findItineraryByAgency(itineraryId, agencyId);
      if (!existing) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
      }

      // Preservation is computed from the authorized stored itinerary, never from
      // anything a request body supplied.
      let prepared = parsed;
      if (execution) {
        // Freshly prepared coordinates land in the sink; preserved stops keep
        // their stored coordinates, so routing works for both without a re-resolve.
        const points = mergePoints([], existing);
        const days = await prepareReplacementItems({
          session: execution.session,
          existingItinerary: existing,
          days: parsed.days as any[],
          expectedAgencyId: agencyId,
          pointSink: points
        });
        prepared = {
          ...parsed,
          days: execution.addRoutes ? await execution.addRoutes(days, points) : days
        } as ReplaceItineraryInput;
      }

      const itinerary = await options.repository.replaceItineraryDraft(
        itineraryId,
        agencyId,
        prepared as ReplaceItineraryInput
      );
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

    async addItem(agencyId: string, input: AddItineraryItemInput, execution?: ItineraryPlaceExecution) {
      const parsed = addItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.dayId, "dayId");

      // An added stop is always a new selection, even if the place is cached.
      let item = parsed.item;
      if (execution) {
        const [prepared] = await prepareItineraryItems({
          session: execution.session,
          items: [item as any],
          expectedAgencyId: agencyId
        });
        item = prepared.item as typeof item;
      }

      return options.repository.addItem(parsed.itineraryId, agencyId, {
        dayId: parsed.dayId,
        sortOrder: parsed.sortOrder,
        item
      });
    },

    async updateItem(
      agencyId: string,
      input: UpdateItineraryItemInput,
      execution?: ItineraryPlaceExecution
    ) {
      const parsed = updateItineraryItemInputSchema.parse(input);
      assertUuid(parsed.itineraryId, "itineraryId");
      assertUuid(parsed.itemId, "itemId");

      // Only an identity change is a new selection. Retitling or retiming a saved
      // stop keeps it, closed or not, along with its route data.
      let patch = parsed.item;
      if (execution) {
        const existing = await options.repository.findItineraryByAgency(parsed.itineraryId, agencyId);
        if (!existing) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        patch = await prepareUpdatedItem({
          session: execution.session,
          existingItinerary: existing,
          itemId: parsed.itemId,
          patch: patch as any,
          expectedAgencyId: agencyId
        });
      }

      return options.repository.updateItem(parsed.itineraryId, agencyId, parsed.itemId, patch);
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
    },

    async approveTrip(agencyId: string, tripId: string) {
      return options.repository.approveTrip(tripId, agencyId);
    }
  };
}

import { createPrismaItineraryRepository } from "./itineraryRepository";

export const itineraryService = createItineraryService({
  repository: createPrismaItineraryRepository()
});

