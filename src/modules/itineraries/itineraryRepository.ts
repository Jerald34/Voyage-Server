import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { assertUuid } from "./itineraryService";
import type {
  ClientTripRecord,
  ItineraryRecord,
  ItineraryDayRecord,
  ItineraryItemRecord,
  ItineraryRepository,
  AddItineraryItemRepoInput,
  UpdateItineraryItemRepoInput,
  StructuredItineraryInput,
  StructuredItineraryItem,
  ReplaceItineraryInput,
  PlanItineraryInput,
  StructuredItineraryDay
} from "./itineraryTypes";

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
    async listTripsWithItineraries(agencyId) {
      const trips = await client.clientTrip.findMany({
        where: { agencyId },
        orderBy: { createdAt: "desc" },
        include: {
          itineraries: {
            select: { id: true, status: true, version: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
      return trips as Array<ClientTripRecord & { itineraries: Array<{ id: string; status: string; version: number }> }>;
    },

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

    async deleteTrip(tripId, agencyId) {
      return client.$transaction(async (tx) => {
        const existing = await tx.clientTrip.findFirst({
          where: { id: tripId, agencyId },
          select: { id: true }
        });
        if (!existing) {
          throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
        }
        await tx.agentThread.updateMany({
          where: { tripId, agencyId },
          data: { tripId: null }
        });
        await tx.clientTrip.delete({
          where: { id_agencyId: { id: tripId, agencyId } }
        });
        return { deleted: true };
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

