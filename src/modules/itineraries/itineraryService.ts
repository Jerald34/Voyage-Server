import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
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

export type ClientTripRecord = {
  id: string;
  agencyId: string;
  createdByUserId: string;
  assignedOrganizerUserId: string | null;
  title: string;
  destinationSummary: string | null;
  clientName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  travelerCount: number | null;
  budgetLevel: string | null;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
};

export type ItineraryItemRecord = {
  id: string;
  itineraryDayId: string;
  sortOrder: number;
  type: "ACTIVITY" | "MEAL" | "TRANSFER" | "CHECK_IN" | "CHECK_OUT" | "FREE_TIME" | "NOTE";
  title: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  placeSnapshotId: string | null;
  placeSnapshot: {
    id: string;
    provider: string;
    providerPlaceId: string;
    name: string;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    rating: number | null;
    websiteUrl: string | null;
    phoneNumber: string | null;
    metadata: unknown;
  } | null;
  routeFromPrevious: unknown;
  staffNotes: string | null;
  clientNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ItineraryDayRecord = {
  id: string;
  itineraryId: string;
  dayNumber: number;
  date: Date | null;
  title: string;
  summary: string | null;
  items: ItineraryItemRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type ItineraryRecord = {
  id: string;
  agencyId: string;
  tripId: string;
  createdByUserId: string;
  title: string;
  summary: string | null;
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED_INTERNAL";
  version: number;
  days: ItineraryDayRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type AddItineraryItemRepoInput = {
  dayId: string;
  sortOrder?: number;
  item: StructuredItineraryItem;
};

export type UpdateItineraryItemRepoInput = Partial<StructuredItineraryItem>;

export interface ItineraryRepository {
  createTripWithItinerary(data: {
    agencyId: string;
    createdByUserId: string;
    trip: StructuredItineraryInput["trip"];
    itinerary: StructuredItineraryInput["itinerary"];
  }): Promise<{ trip: ClientTripRecord; itinerary: ItineraryRecord }>;
  createPlanItinerary(data: {
    agencyId: string;
    createdByUserId: string;
    trip: PlanItineraryInput["trip"];
    itinerary: PlanItineraryInput["itinerary"];
  }): Promise<{ trip: ClientTripRecord; itinerary: ItineraryRecord }>;
  findItineraryByAgency(id: string, agencyId: string): Promise<ItineraryRecord | null>;
  replaceItineraryDraft(
    id: string,
    agencyId: string,
    data: ReplaceItineraryInput
  ): Promise<ItineraryRecord | null>;
  deleteItinerary(
    id: string,
    agencyId: string,
    opts: { deleteTrip: boolean }
  ): Promise<{ deleted: boolean; tripDeleted: boolean }>;
  addDay(
    itineraryId: string,
    agencyId: string,
    data: { dayNumber?: number; title: string; summary?: string; date?: Date | null }
  ): Promise<{ itinerary: ItineraryRecord; day: ItineraryDayRecord }>;
  updateDay(
    itineraryId: string,
    agencyId: string,
    dayId: string,
    patch: { title?: string; summary?: string; date?: Date | null }
  ): Promise<{ itinerary: ItineraryRecord; day: ItineraryDayRecord }>;
  removeDay(
    itineraryId: string,
    agencyId: string,
    dayId: string
  ): Promise<{ itinerary: ItineraryRecord; days: ItineraryDayRecord[] }>;
  addItem(
    itineraryId: string,
    agencyId: string,
    data: AddItineraryItemRepoInput
  ): Promise<{ itinerary: ItineraryRecord; dayId: string; item: ItineraryItemRecord }>;
  updateItem(
    itineraryId: string,
    agencyId: string,
    itemId: string,
    patch: UpdateItineraryItemRepoInput
  ): Promise<{ itinerary: ItineraryRecord; dayId: string; item: ItineraryItemRecord }>;
  removeItem(
    itineraryId: string,
    agencyId: string,
    itemId: string
  ): Promise<{ itinerary: ItineraryRecord; dayId: string; itemId: string; items: ItineraryItemRecord[] }>;
  moveItem(
    itineraryId: string,
    agencyId: string,
    itemId: string,
    target: { toDayId: string; toSortOrder?: number }
  ): Promise<{
    itinerary: ItineraryRecord;
    fromDayId: string;
    toDayId: string;
    itemId: string;
    fromItems: ItineraryItemRecord[];
    toItems: ItineraryItemRecord[];
  }>;
}

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

function includeItineraryDetails() {
  return {
    days: {
      orderBy: { dayNumber: "asc" as const },
      include: {
        items: {
          orderBy: { sortOrder: "asc" as const },
          include: {
            placeSnapshot: true
          }
        }
      }
    }
  } as const;
}

function createDayData(day: StructuredItineraryDay) {
  return {
    dayNumber: day.dayNumber,
    date: day.date,
    title: day.title,
    summary: day.summary,
    items: {
      create: day.items.map((item, index) => ({
        sortOrder: index + 1,
        type: item.type,
        title: item.title,
        description: item.description,
        startTime: item.startTime,
        endTime: item.endTime,
        placeSnapshotId: item.placeSnapshotId,
        routeFromPrevious:
          item.routeFromPrevious === undefined ? undefined : (item.routeFromPrevious as Prisma.InputJsonValue),
        staffNotes: item.staffNotes,
        clientNotes: item.clientNotes
      }))
    }
  };
}

export function createPrismaItineraryRepository(client: PrismaClient = prisma): ItineraryRepository {
  return {
    async createTripWithItinerary(data) {
      return client.$transaction(async (tx) => {
        const trip = await tx.clientTrip.create({
          data: {
            agencyId: data.agencyId,
            createdByUserId: data.createdByUserId,
            title: data.trip.title,
            destinationSummary: data.trip.destinationSummary,
            clientName: data.trip.clientName,
            startDate: data.trip.startDate,
            endDate: data.trip.endDate,
            travelerCount: data.trip.travelerCount,
            budgetLevel: data.trip.budgetLevel
          }
        });

        const itinerary = await tx.itinerary.create({
          data: {
            agencyId: data.agencyId,
            tripId: trip.id,
            createdByUserId: data.createdByUserId,
            title: data.itinerary.title,
            summary: data.itinerary.summary,
            days: {
              create: data.itinerary.days.map(createDayData)
            }
          },
          include: includeItineraryDetails()
        });

        return { trip, itinerary } as { trip: ClientTripRecord; itinerary: ItineraryRecord };
      });
    },

    async findItineraryByAgency(id, agencyId) {
      return client.itinerary.findFirst({
        where: { id, agencyId },
        include: includeItineraryDetails()
      }) as Promise<ItineraryRecord | null>;
    },

    async replaceItineraryDraft(id, agencyId, data) {
      return client.$transaction(async (tx) => {
        const existing = await tx.itinerary.findFirst({
          where: { id, agencyId },
          select: { id: true, status: true }
        });

        if (!existing) {
          return null;
        }
        if (existing.status !== "DRAFT") {
          throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
        }

        await tx.itineraryDay.deleteMany({
          where: { itineraryId: id }
        });

        const itinerary = await tx.itinerary.update({
          where: { id },
          data: {
            title: data.title,
            summary: data.summary,
            version: { increment: 1 },
            days: {
              create: data.days.map(createDayData)
            }
          },
          include: includeItineraryDetails()
        });

        return itinerary as ItineraryRecord;
      });
    },

    async createPlanItinerary(data) {
      return client.$transaction(async (tx) => {
        const trip = await tx.clientTrip.create({
          data: {
            agencyId: data.agencyId,
            createdByUserId: data.createdByUserId,
            title: data.trip.title,
            destinationSummary: data.trip.destinationSummary,
            clientName: data.trip.clientName,
            startDate: data.trip.startDate,
            endDate: data.trip.endDate,
            travelerCount: data.trip.travelerCount,
            budgetLevel: data.trip.budgetLevel
          }
        });

        // Skeleton: each day starts empty; agent populates items via add_itinerary_item.
        const itinerary = await tx.itinerary.create({
          data: {
            agencyId: data.agencyId,
            tripId: trip.id,
            createdByUserId: data.createdByUserId,
            title: data.itinerary.title,
            summary: data.itinerary.summary,
            days: {
              create: data.itinerary.days.map((day) => ({
                dayNumber: day.dayNumber,
                date: day.date,
                title: day.title,
                summary: day.summary
              }))
            }
          },
          include: includeItineraryDetails()
        });

        return { trip, itinerary } as { trip: ClientTripRecord; itinerary: ItineraryRecord };
      });
    },

    async deleteItinerary(id, agencyId, opts) {
      return client.$transaction(async (tx) => {
        const existing = await tx.itinerary.findFirst({
          where: { id, agencyId },
          select: { id: true, status: true, tripId: true }
        });
        if (!existing) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        if (existing.status !== "DRAFT") {
          throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be deleted.");
        }

        // ItineraryDay and ItineraryItem cascade from Itinerary, so a single delete is enough.
        await tx.itinerary.delete({ where: { id } });

        let tripDeleted = false;
        if (opts.deleteTrip && existing.tripId) {
          // Use compound unique [id, agencyId] to keep the agency boundary.
          await tx.clientTrip.delete({
            where: { id_agencyId: { id: existing.tripId, agencyId } }
          });
          tripDeleted = true;
        }

        return { deleted: true, tripDeleted };
      });
    },

    async addDay(itineraryId, agencyId, data) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existingDays = await tx.itineraryDay.findMany({
          where: { itineraryId },
          orderBy: { dayNumber: "asc" },
          select: { id: true, dayNumber: true }
        });
        const insertAt = data.dayNumber ?? existingDays.length + 1;
        const targetDayNumber = Math.max(1, Math.min(insertAt, existingDays.length + 1));

        // Shift all days at or after the target up by one to make room.
        // First park them in negative space to avoid hitting the (itineraryId, dayNumber) unique constraint.
        const toShift = existingDays.filter((day) => day.dayNumber >= targetDayNumber);
        for (const [index, day] of toShift.entries()) {
          await tx.itineraryDay.update({
            where: { id: day.id },
            data: { dayNumber: -1 - index }
          });
        }
        for (const day of toShift) {
          await tx.itineraryDay.update({
            where: { id: day.id },
            data: { dayNumber: day.dayNumber + 1 }
          });
        }

        const created = await tx.itineraryDay.create({
          data: {
            itineraryId,
            dayNumber: targetDayNumber,
            date: data.date ?? null,
            title: data.title,
            summary: data.summary
          },
          include: { items: { orderBy: { sortOrder: "asc" }, include: { placeSnapshot: true } } }
        });

        // Bump version once for the structural change.
        await tx.itinerary.update({
          where: { id: itineraryId },
          data: { version: { increment: 1 }, updatedAt: new Date() }
        });

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }

        return {
          itinerary: updated as ItineraryRecord,
          day: created as ItineraryDayRecord
        };
      });
    },

    async updateDay(itineraryId, agencyId, dayId, patch) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existingDay = await tx.itineraryDay.findFirst({
          where: { id: dayId, itineraryId },
          select: { id: true }
        });
        if (!existingDay) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary day not found.");
        }

        const data: { title?: string; summary?: string; date?: Date | null } = {};
        if (patch.title !== undefined) data.title = patch.title;
        if (patch.summary !== undefined) data.summary = patch.summary;
        if (patch.date !== undefined) data.date = patch.date;

        const day = await tx.itineraryDay.update({
          where: { id: dayId },
          data,
          include: { items: { orderBy: { sortOrder: "asc" }, include: { placeSnapshot: true } } }
        });

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        return {
          itinerary: updated as ItineraryRecord,
          day: day as ItineraryDayRecord
        };
      });
    },

    async removeDay(itineraryId, agencyId, dayId) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existingDay = await tx.itineraryDay.findFirst({
          where: { id: dayId, itineraryId },
          select: { id: true, dayNumber: true }
        });
        if (!existingDay) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary day not found.");
        }

        await tx.itineraryDay.delete({ where: { id: dayId } });

        // Re-sequence remaining days contiguously starting from 1.
        const remaining = await tx.itineraryDay.findMany({
          where: { itineraryId },
          orderBy: { dayNumber: "asc" },
          select: { id: true, dayNumber: true }
        });
        for (const [index, day] of remaining.entries()) {
          const nextDayNumber = index + 1;
          if (day.dayNumber !== nextDayNumber) {
            // Two-step shift to avoid unique constraint collisions when dayNumbers swap.
            await tx.itineraryDay.update({
              where: { id: day.id },
              data: { dayNumber: -1 * (index + 1) }
            });
          }
        }
        for (const [index, day] of remaining.entries()) {
          await tx.itineraryDay.update({
            where: { id: day.id },
            data: { dayNumber: index + 1 }
          });
        }

        await tx.itinerary.update({
          where: { id: itineraryId },
          data: { version: { increment: 1 }, updatedAt: new Date() }
        });

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        return {
          itinerary: updated as ItineraryRecord,
          days: (updated as ItineraryRecord).days
        };
      });
    },

    async addItem(itineraryId, agencyId, data) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const day = await tx.itineraryDay.findFirst({
          where: { id: data.dayId, itineraryId },
          select: { id: true }
        });
        if (!day) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary day not found.");
        }

        const existingItems = await tx.itineraryItem.findMany({
          where: { itineraryDayId: data.dayId },
          orderBy: { sortOrder: "asc" },
          select: { id: true, sortOrder: true }
        });
        const insertAt =
          typeof data.sortOrder === "number"
            ? Math.max(1, Math.min(data.sortOrder, existingItems.length + 1))
            : existingItems.length + 1;

        // Shift items at or after insertAt to make room.
        const toShift = existingItems
          .filter((item) => item.sortOrder >= insertAt)
          .sort((a, b) => b.sortOrder - a.sortOrder);
        for (const item of toShift) {
          await tx.itineraryItem.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder + 1 }
          });
        }

        const created = await tx.itineraryItem.create({
          data: {
            itineraryDayId: data.dayId,
            sortOrder: insertAt,
            type: data.item.type,
            title: data.item.title,
            description: data.item.description,
            startTime: data.item.startTime,
            endTime: data.item.endTime,
            placeSnapshotId: data.item.placeSnapshotId,
            routeFromPrevious:
              data.item.routeFromPrevious === undefined
                ? undefined
                : (data.item.routeFromPrevious as Prisma.InputJsonValue),
            staffNotes: data.item.staffNotes,
            clientNotes: data.item.clientNotes
          },
          include: { placeSnapshot: true }
        });

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        return {
          itinerary: updated as ItineraryRecord,
          dayId: data.dayId,
          item: created as ItineraryItemRecord
        };
      });
    },

    async updateItem(itineraryId, agencyId, itemId, patch) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existing = await tx.itineraryItem.findFirst({
          where: {
            id: itemId,
            itineraryDay: { itineraryId }
          },
          select: { id: true, itineraryDayId: true }
        });
        if (!existing) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary item not found.");
        }

        // Only patch the fields explicitly present. CRITICAL: do not stomp on placeSnapshotId or other fields not in the patch.
        const data: Prisma.ItineraryItemUpdateInput = {};
        if (patch.type !== undefined) data.type = patch.type;
        if (patch.title !== undefined) data.title = patch.title;
        if (patch.description !== undefined) data.description = patch.description;
        if (patch.startTime !== undefined) data.startTime = patch.startTime;
        if (patch.endTime !== undefined) data.endTime = patch.endTime;
        if (patch.placeSnapshotId !== undefined) {
          data.placeSnapshot = patch.placeSnapshotId
            ? { connect: { id: patch.placeSnapshotId } }
            : { disconnect: true };
        }
        if (patch.routeFromPrevious !== undefined) {
          data.routeFromPrevious = patch.routeFromPrevious as Prisma.InputJsonValue;
        }
        if (patch.staffNotes !== undefined) data.staffNotes = patch.staffNotes;
        if (patch.clientNotes !== undefined) data.clientNotes = patch.clientNotes;

        const updatedItem = await tx.itineraryItem.update({
          where: { id: itemId },
          data,
          include: { placeSnapshot: true }
        });

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        return {
          itinerary: updated as ItineraryRecord,
          dayId: existing.itineraryDayId,
          item: updatedItem as ItineraryItemRecord
        };
      });
    },

    async removeItem(itineraryId, agencyId, itemId) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existing = await tx.itineraryItem.findFirst({
          where: { id: itemId, itineraryDay: { itineraryId } },
          select: { id: true, itineraryDayId: true }
        });
        if (!existing) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary item not found.");
        }

        await tx.itineraryItem.delete({ where: { id: itemId } });
        await resequenceDayItems(tx, existing.itineraryDayId);

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        const day = (updated as ItineraryRecord).days.find((d) => d.id === existing.itineraryDayId);
        return {
          itinerary: updated as ItineraryRecord,
          dayId: existing.itineraryDayId,
          itemId,
          items: day?.items ?? []
        };
      });
    },

    async moveItem(itineraryId, agencyId, itemId, target) {
      return client.$transaction(async (tx) => {
        await assertDraftItinerary(tx, itineraryId, agencyId);
        const existing = await tx.itineraryItem.findFirst({
          where: { id: itemId, itineraryDay: { itineraryId } },
          select: { id: true, itineraryDayId: true }
        });
        if (!existing) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary item not found.");
        }
        const destDay = await tx.itineraryDay.findFirst({
          where: { id: target.toDayId, itineraryId },
          select: { id: true }
        });
        if (!destDay) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Destination itinerary day not found.");
        }

        const fromDayId = existing.itineraryDayId;
        const toDayId = target.toDayId;

        // Park the moved item on a sentinel sortOrder to escape the (dayId, sortOrder) unique constraint
        // while we re-pack the source day.
        await tx.itineraryItem.update({
          where: { id: itemId },
          data: { sortOrder: -1 }
        });

        if (fromDayId !== toDayId) {
          // Move to destination day next.
          await tx.itineraryItem.update({
            where: { id: itemId },
            data: { itineraryDayId: toDayId }
          });
        }

        // Pack the source day if we moved across days.
        if (fromDayId !== toDayId) {
          await resequenceDayItems(tx, fromDayId);
        }

        // Place the item at the requested sortOrder in the destination day, shifting peers.
        const destItems = await tx.itineraryItem.findMany({
          where: { itineraryDayId: toDayId, NOT: { id: itemId } },
          orderBy: { sortOrder: "asc" },
          select: { id: true, sortOrder: true }
        });
        const desiredSortOrder =
          typeof target.toSortOrder === "number"
            ? Math.max(1, Math.min(target.toSortOrder, destItems.length + 1))
            : destItems.length + 1;

        // Reset all destination peers to a contiguous sequence in two phases (negative scratch then positive)
        // so that shifting doesn't hit unique collisions.
        for (const [index, item] of destItems.entries()) {
          await tx.itineraryItem.update({
            where: { id: item.id },
            data: { sortOrder: -100 - index }
          });
        }
        let cursor = 1;
        for (const item of destItems) {
          if (cursor === desiredSortOrder) {
            cursor += 1;
          }
          await tx.itineraryItem.update({
            where: { id: item.id },
            data: { sortOrder: cursor }
          });
          cursor += 1;
        }
        await tx.itineraryItem.update({
          where: { id: itemId },
          data: { sortOrder: desiredSortOrder }
        });

        // Re-pack source if it was the same day to ensure contiguity.
        if (fromDayId === toDayId) {
          await resequenceDayItems(tx, toDayId);
        }

        const updated = await tx.itinerary.findFirst({
          where: { id: itineraryId, agencyId },
          include: includeItineraryDetails()
        });
        if (!updated) {
          throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
        }
        const fromDay = (updated as ItineraryRecord).days.find((d) => d.id === fromDayId);
        const toDay = (updated as ItineraryRecord).days.find((d) => d.id === toDayId);
        return {
          itinerary: updated as ItineraryRecord,
          fromDayId,
          toDayId,
          itemId,
          fromItems: fromDay?.items ?? [],
          toItems: toDay?.items ?? []
        };
      });
    }
  };
}

type ItineraryTx = Prisma.TransactionClient;

async function assertDraftItinerary(tx: ItineraryTx, id: string, agencyId: string) {
  const existing = await tx.itinerary.findFirst({
    where: { id, agencyId },
    select: { id: true, status: true }
  });
  if (!existing) {
    throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
  }
  if (existing.status !== "DRAFT") {
    throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be modified.");
  }
  return existing;
}

async function resequenceDayItems(tx: ItineraryTx, dayId: string) {
  const items = await tx.itineraryItem.findMany({
    where: { itineraryDayId: dayId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true }
  });
  // Two-pass shuffle through negative scratch values to avoid (dayId, sortOrder) unique violations.
  for (const [index, item] of items.entries()) {
    if (item.sortOrder !== index + 1) {
      await tx.itineraryItem.update({
        where: { id: item.id },
        data: { sortOrder: -100 - index }
      });
    }
  }
  for (const [index, item] of items.entries()) {
    await tx.itineraryItem.update({
      where: { id: item.id },
      data: { sortOrder: index + 1 }
    });
  }
}

export const itineraryService = createItineraryService({
  repository: createPrismaItineraryRepository()
});
