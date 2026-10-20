import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

/**
 * Raw reads for the dashboard's trip panel: one trip, its share links, every
 * comment on them and the titles of the stops those comments point at.
 * Scoped by agency, so another agency's trip reads as missing.
 */

export type RawTripPreview = {
  trip: {
    id: string;
    title: string;
    status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";
    clientName: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    destinationSummary: string | null;
  } | null;
  /** Newest first. */
  shares: Array<{
    id: string;
    /** The itinerary the link shows; read for the stop check, never sent to the panel. */
    itineraryId: string;
    clientName: string | null;
    viewCount: number;
    lastViewedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    proposalRating: number | null;
    createdAt: Date;
  }>;
  /** Oldest first. */
  comments: Array<{
    id: string;
    shareId: string;
    authorName: string;
    content: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    dayNumber: number | null;
    itemId: string | null;
    agencyReply: string | null;
    agencyRepliedAt: Date | null;
    createdAt: Date;
  }>;
  /** Each stop's title with the itinerary it sits in. */
  itemTitles: Array<{ id: string; title: string; itineraryId: string }>;
};

export interface TripPreviewRepository {
  fetchTripPreview(agencyId: string, tripId: string): Promise<RawTripPreview>;
}

export function createPrismaTripPreviewRepository(client: PrismaClient = prisma): TripPreviewRepository {
  return {
    async fetchTripPreview(agencyId, tripId) {
      const trip = await client.clientTrip.findFirst({
        where: { id: tripId, agencyId },
        select: {
          id: true,
          title: true,
          status: true,
          clientName: true,
          startDate: true,
          endDate: true,
          travelerCount: true,
          destinationSummary: true
        }
      });
      if (!trip) return { trip: null, shares: [], comments: [], itemTitles: [] };

      const shares = await client.itineraryShare.findMany({
        where: { agencyId, tripId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          itineraryId: true,
          clientName: true,
          viewCount: true,
          lastViewedAt: true,
          expiresAt: true,
          revokedAt: true,
          proposalRating: true,
          createdAt: true
        }
      });

      // authorEmail is left out on purpose: the panel never shows the client's email.
      const comments = shares.length
        ? await client.itineraryComment.findMany({
            where: { shareId: { in: shares.map((s) => s.id) } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              shareId: true,
              authorName: true,
              content: true,
              status: true,
              dayNumber: true,
              itemId: true,
              agencyReply: true,
              agencyRepliedAt: true,
              createdAt: true
            }
          })
        : [];

      // A comment's itemId comes from the public share page unchecked, so only
      // look up stops in this trip's itineraries, and carry each stop's
      // itinerary so the service names it only for a link that shows it.
      const itemIds = [...new Set(comments.flatMap((c) => (c.itemId ? [c.itemId] : [])))];
      const itemRows = itemIds.length
        ? await client.itineraryItem.findMany({
            where: {
              id: { in: itemIds },
              itineraryDay: { itinerary: { tripId, agencyId } }
            },
            select: { id: true, title: true, itineraryDay: { select: { itineraryId: true } } }
          })
        : [];
      const itemTitles = itemRows.map((item) => ({
        id: item.id,
        title: item.title,
        itineraryId: item.itineraryDay.itineraryId
      }));

      return { trip, shares, comments, itemTitles };
    }
  };
}

export const tripPreviewRepository = createPrismaTripPreviewRepository();
