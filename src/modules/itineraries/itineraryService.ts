import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import {
  replaceItinerarySchema,
  structuredItineraryInputSchema,
  type structuredItineraryDaySchema
} from "./itinerarySchemas";
import type { z } from "zod";

export type StructuredItineraryInput = z.infer<typeof structuredItineraryInputSchema>;
export type ReplaceItineraryInput = z.infer<typeof replaceItinerarySchema>;
type StructuredItineraryDay = z.infer<typeof structuredItineraryDaySchema>;

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

export interface ItineraryRepository {
  createTripWithItinerary(data: {
    agencyId: string;
    createdByUserId: string;
    trip: StructuredItineraryInput["trip"];
    itinerary: StructuredItineraryInput["itinerary"];
  }): Promise<{ trip: ClientTripRecord; itinerary: ItineraryRecord }>;
  findItineraryByAgency(id: string, agencyId: string): Promise<ItineraryRecord | null>;
  replaceItineraryDraft(
    id: string,
    agencyId: string,
    data: ReplaceItineraryInput
  ): Promise<ItineraryRecord | null>;
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
    }
  };
}

export const itineraryService = createItineraryService({
  repository: createPrismaItineraryRepository()
});
