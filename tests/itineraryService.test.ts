import { describe, expect, it } from "vitest";
import {
  createItineraryService,
  type ItineraryRepository,
  type StructuredItineraryInput
} from "../src/modules/itineraries/itineraryService";

type TripRecord = Awaited<ReturnType<ItineraryRepository["createTripWithItinerary"]>>["trip"];
type ItineraryRecord = Awaited<ReturnType<ItineraryRepository["createTripWithItinerary"]>>["itinerary"];

function createMemoryRepository(): ItineraryRepository & {
  trips: TripRecord[];
  itineraries: ItineraryRecord[];
} {
  const trips: TripRecord[] = [];
  const itineraries: ItineraryRecord[] = [];

  return {
    trips,
    itineraries,
    async createTripWithItinerary(data) {
      const now = new Date("2026-04-28T00:00:00.000Z");
      const trip = {
        id: `trip-${trips.length + 1}`,
        agencyId: data.agencyId,
        createdByUserId: data.createdByUserId,
        assignedOrganizerUserId: null,
        title: data.trip.title,
        destinationSummary: data.trip.destinationSummary ?? null,
        clientName: data.trip.clientName ?? null,
        startDate: data.trip.startDate ?? null,
        endDate: data.trip.endDate ?? null,
        travelerCount: data.trip.travelerCount ?? null,
        budgetLevel: data.trip.budgetLevel ?? null,
        status: "DRAFT" as const,
        createdAt: now,
        updatedAt: now
      };
      const itineraryId = `itinerary-${itineraries.length + 1}`;
      const itinerary = {
        id: itineraryId,
        agencyId: data.agencyId,
        tripId: trip.id,
        createdByUserId: data.createdByUserId,
        title: data.itinerary.title,
        summary: data.itinerary.summary ?? null,
        status: "DRAFT" as const,
        version: 1,
        days: data.itinerary.days.map((day, dayIndex) => ({
          id: `day-${dayIndex + 1}`,
          itineraryId,
          dayNumber: day.dayNumber,
          date: day.date ?? null,
          title: day.title,
          summary: day.summary ?? null,
          createdAt: now,
          updatedAt: now,
          items: day.items.map((item, itemIndex) => ({
            id: `item-${dayIndex + 1}-${itemIndex + 1}`,
            itineraryDayId: `day-${dayIndex + 1}`,
            sortOrder: itemIndex + 1,
            description: item.description ?? null,
            startTime: item.startTime ?? null,
            endTime: item.endTime ?? null,
            placeSnapshotId: item.placeSnapshotId ?? null,
            routeFromPrevious: item.routeFromPrevious ?? null,
            staffNotes: item.staffNotes ?? null,
            clientNotes: item.clientNotes ?? null,
            createdAt: now,
            updatedAt: now,
            ...item
          }))
        })),
        createdAt: now,
        updatedAt: now
      };
      trips.push(trip);
      itineraries.push(itinerary);
      return { trip, itinerary };
    },
    async findItineraryByAgency(id, agencyId) {
      return itineraries.find((itinerary) => itinerary.id === id && itinerary.agencyId === agencyId) ?? null;
    },
    async replaceItineraryDraft(id, agencyId, data) {
      const itinerary = itineraries.find((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      if (!itinerary) {
        return null;
      }

      const now = new Date("2026-04-28T00:00:00.000Z");
      itinerary.title = data.title;
      itinerary.summary = data.summary ?? null;
      itinerary.version += 1;
      itinerary.updatedAt = now;
      itinerary.days = data.days.map((day, dayIndex) => ({
        id: `replacement-day-${dayIndex + 1}`,
        itineraryId: id,
        dayNumber: day.dayNumber,
        date: day.date ?? null,
        title: day.title,
        summary: day.summary ?? null,
        createdAt: now,
        updatedAt: now,
        items: day.items.map((item, itemIndex) => ({
          id: `replacement-item-${dayIndex + 1}-${itemIndex + 1}`,
          itineraryDayId: `replacement-day-${dayIndex + 1}`,
          sortOrder: itemIndex + 1,
          description: item.description ?? null,
          startTime: item.startTime ?? null,
          endTime: item.endTime ?? null,
          placeSnapshotId: item.placeSnapshotId ?? null,
          routeFromPrevious: item.routeFromPrevious ?? null,
          staffNotes: item.staffNotes ?? null,
          clientNotes: item.clientNotes ?? null,
          createdAt: now,
          updatedAt: now,
          ...item
        }))
      }));
      return itinerary;
    }
  };
}

function createStructuredInput(overrides: Partial<StructuredItineraryInput> = {}): StructuredItineraryInput {
  return {
    trip: {
      title: "Cebu Honeymoon",
      destinationSummary: "Cebu, Philippines",
      clientName: "Reyes Couple",
      travelerCount: 2,
      budgetLevel: "mid-range"
    },
    itinerary: {
      title: "4-Day Cebu Honeymoon",
      summary: "A relaxed romantic Cebu itinerary.",
      days: [
        {
          dayNumber: 1,
          title: "Arrival and city food crawl",
          summary: "Light first day.",
          items: [
            {
              type: "MEAL",
              title: "Dinner in Cebu City",
              description: "Start with local seafood.",
              startTime: "18:30"
            }
          ]
        }
      ]
    },
    ...overrides
  };
}

describe("itinerary service", () => {
  it("creates a client trip with structured itinerary days and items", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });

    const result = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    expect(result.trip).toMatchObject({
      id: "trip-1",
      agencyId: "agency-1",
      createdByUserId: "user-1",
      title: "Cebu Honeymoon",
      destinationSummary: "Cebu, Philippines",
      travelerCount: 2
    });
    expect(result.itinerary).toMatchObject({
      agencyId: "agency-1",
      tripId: "trip-1",
      title: "4-Day Cebu Honeymoon",
      status: "DRAFT",
      version: 1,
      days: [
        {
          dayNumber: 1,
          title: "Arrival and city food crawl",
          items: [
            {
              sortOrder: 1,
              type: "MEAL",
              title: "Dinner in Cebu City"
            }
          ]
        }
      ]
    });
  });

  it("rejects cross-agency itinerary loads", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    await expect(service.getItinerary("agency-2", created.itinerary.id)).rejects.toMatchObject({
      code: "ITINERARY_NOT_FOUND",
      statusCode: 404
    });
  });

  it("replaces draft content and increments version", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    const updated = await service.replaceDraft("agency-1", created.itinerary.id, {
      title: "Updated Cebu Plan",
      summary: "Updated pacing.",
      days: [
        {
          dayNumber: 1,
          title: "Slower arrival",
          items: [{ type: "FREE_TIME", title: "Hotel recovery time" }]
        }
      ]
    });

    expect(updated).toMatchObject({
      title: "Updated Cebu Plan",
      summary: "Updated pacing.",
      version: 2,
      days: [
        {
          title: "Slower arrival",
          items: [
            {
              sortOrder: 1,
              type: "FREE_TIME",
              title: "Hotel recovery time"
            }
          ]
        }
      ]
    });
  });

  it("rejects invalid structured input", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });

    await expect(
      service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput({
        trip: { title: "" },
        itinerary: {
          title: "Invalid",
          days: []
        }
      }))
    ).rejects.toMatchObject({
      name: "ZodError"
    });
    expect(repository.trips).toHaveLength(0);
  });
});
