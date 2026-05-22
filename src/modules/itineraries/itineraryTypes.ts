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
  listTripsWithItineraries(agencyId: string): Promise<Array<ClientTripRecord & { itineraries: Array<{ id: string; status: string; version: number }> }>>;
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
  deleteTrip(tripId: string, agencyId: string): Promise<{ deleted: boolean }>;
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

import { z } from "zod";
import {
  structuredItineraryInputSchema,
  structuredItineraryItemSchema,
  structuredItineraryDaySchema,
  replaceItinerarySchema,
  planItineraryInputSchema
} from "./itinerarySchemas";

export type StructuredItineraryInput = z.infer<typeof structuredItineraryInputSchema>;
export type StructuredItineraryItem = z.infer<typeof structuredItineraryItemSchema>;
export type StructuredItineraryDay = z.infer<typeof structuredItineraryDaySchema>;
export type ReplaceItineraryInput = z.infer<typeof replaceItinerarySchema>;
export type PlanItineraryInput = z.infer<typeof planItineraryInputSchema>;
