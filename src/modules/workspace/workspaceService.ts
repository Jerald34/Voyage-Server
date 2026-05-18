import { prisma } from "../../db/prisma";

export type TripSummary = {
  id: string;
  clientName: string | null;
  title: string;
  destinationSummary: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: string;
  assignedOrganizerUserId: string | null;
  travelerCount: number | null;
  budgetLevel: string | null;
  updatedAt: Date;
  itineraries: Array<{ id: string; status: string; version: number }>;
};

export type ThreadSummary = {
  id: string;
  agencyId: string;
  tripId: string | null;
  title: string;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  itineraryId: string | null;
};

export type ItinerarySummary = {
  id: string;
  tripId: string;
  title: string;
  summary: string | null;
  status: string;
  version: number;
  updatedAt: Date;
};

export type BootstrapResult = {
  trips: TripSummary[];
  threads: ThreadSummary[];
  itinerarySummaries: Record<string, ItinerarySummary>;
};

function safeExtractItineraryId(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    "itineraryId" in payload &&
    typeof (payload as Record<string, unknown>).itineraryId === "string"
  ) {
    return (payload as Record<string, string>).itineraryId;
  }
  return null;
}

export async function getBootstrap(agencyId: string): Promise<BootstrapResult> {
  const [trips, rawThreads] = await Promise.all([
    prisma.clientTrip.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        clientName: true,
        title: true,
        destinationSummary: true,
        startDate: true,
        endDate: true,
        status: true,
        assignedOrganizerUserId: true,
        travelerCount: true,
        budgetLevel: true,
        updatedAt: true,
        itineraries: {
          select: { id: true, status: true, version: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.agentThread.findMany({
      where: { agencyId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        agencyId: true,
        tripId: true,
        title: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  if (rawThreads.length === 0) {
    return { trips: trips as TripSummary[], threads: [], itinerarySummaries: {} };
  }

  const threadIds = rawThreads.map((t) => t.id);

  const tripItineraryIds = trips
    .map((t) => t.itineraries[0]?.id)
    .filter((id): id is string => id !== undefined);

  const [runEvents] = await Promise.all([
    prisma.agentRunEvent.findMany({
      where: {
        threadId: { in: threadIds },
        type: { in: ["itinerary.updated", "itinerary.created"] },
      },
      orderBy: [{ threadId: "asc" }, { createdAt: "desc" }],
      distinct: ["threadId"],
      select: { threadId: true, payload: true },
    }),
  ]);

  const threadItineraryMap = new Map<string, string | null>();
  for (const event of runEvents) {
    const itineraryId = safeExtractItineraryId(event.payload);
    threadItineraryMap.set(event.threadId, itineraryId);
  }

  const eventItineraryIds = Array.from(threadItineraryMap.values()).filter(
    (id): id is string => id !== null
  );

  const allItineraryIds = Array.from(new Set([...tripItineraryIds, ...eventItineraryIds]));

  const itineraries =
    allItineraryIds.length > 0
      ? await prisma.itinerary.findMany({
          where: { id: { in: allItineraryIds }, agencyId },
          select: {
            id: true,
            tripId: true,
            title: true,
            summary: true,
            status: true,
            version: true,
            updatedAt: true,
          },
        })
      : [];

  const itinerarySummaries: Record<string, ItinerarySummary> = {};
  for (const it of itineraries) {
    itinerarySummaries[it.id] = it as ItinerarySummary;
  }

  const threads: ThreadSummary[] = rawThreads.map((t) => ({
    ...t,
    itineraryId: threadItineraryMap.get(t.id) ?? null,
  }));

  return { trips: trips as TripSummary[], threads, itinerarySummaries };
}
