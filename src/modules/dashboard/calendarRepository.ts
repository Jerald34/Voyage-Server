import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { CalendarWindow, RawCalendarData } from "./calendar";

/**
 * Reads the rows the dashboard calendar needs for one agency and one window.
 * Every query is scoped to the agency, and the related trip must belong to it
 * as well. Role scoping (staff see their own trips) happens in
 * `buildCalendar`, so the rules stay unit-testable.
 */
export interface CalendarRepository {
  fetchCalendarWindow(agencyId: string, window: CalendarWindow): Promise<RawCalendarData>;
}

const tripRefSelect = {
  id: true,
  title: true,
  clientName: true,
  createdByUserId: true,
  assignedOrganizerUserId: true
} as const;

export function createPrismaCalendarRepository(client: PrismaClient = prisma): CalendarRepository {
  return {
    async fetchCalendarWindow(agencyId, window) {
      const instantRange = { gte: window.fromInstant, lte: window.toInstant };

      const [trips, undatedTrips, shares, comments, reviews] = await Promise.all([
        client.clientTrip.findMany({
          where: {
            agencyId,
            status: { not: "ARCHIVED" },
            // Before the day after `to`, the same cut `buildCalendar` makes on
            // dates, so a trip stored mid-day on `to` is not dropped here.
            startDate: { not: null, lt: window.toDayEnd },
            // Ends inside or after the window, or starts inside it (covers
            // trips with no end date and end dates before the start).
            OR: [{ endDate: { gte: window.fromDayStart } }, { startDate: { gte: window.fromDayStart } }]
          },
          select: {
            ...tripRefSelect,
            destinationSummary: true,
            startDate: true,
            endDate: true,
            status: true,
            travelerCount: true
          }
        }),
        client.clientTrip.findMany({
          where: { agencyId, status: { not: "ARCHIVED" }, startDate: null },
          select: { createdByUserId: true, assignedOrganizerUserId: true }
        }),
        client.itineraryShare.findMany({
          where: {
            agencyId,
            tripId: { not: null },
            // Defence in depth: the trip must be this agency's too.
            trip: { agencyId },
            OR: [
              { createdAt: instantRange },
              { expiresAt: instantRange },
              { lastViewedAt: instantRange },
              { proposalRatedAt: instantRange }
            ]
          },
          select: {
            id: true,
            clientName: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
            lastViewedAt: true,
            viewCount: true,
            proposalRating: true,
            proposalRatedAt: true,
            trip: { select: tripRefSelect }
          }
        }),
        client.itineraryComment.findMany({
          where: { createdAt: instantRange, share: { agencyId, trip: { agencyId } } },
          select: {
            id: true,
            content: true,
            authorName: true,
            createdAt: true,
            share: { select: { clientName: true, trip: { select: tripRefSelect } } }
          }
        }),
        client.tripReview.findMany({
          where: { agencyId, trip: { agencyId }, submittedAt: instantRange },
          select: {
            id: true,
            rating: true,
            reviewText: true,
            respondentName: true,
            submittedAt: true,
            trip: { select: tripRefSelect }
          }
        })
      ]);

      return { trips, undatedTrips, shares, comments, reviews };
    }
  };
}

export const calendarRepository = createPrismaCalendarRepository();
