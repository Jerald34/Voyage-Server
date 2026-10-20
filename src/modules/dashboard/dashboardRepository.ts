import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

/**
 * Repository for the dashboard composition layer.
 *
 * One responsibility: fetch the raw rows the service needs to assemble payloads.
 * No business logic, no aggregation math — those live in `aggregations.ts` and
 * `dashboardService.ts`. This makes the queries swappable for tests.
 */

export type RawDashboardData = {
  trips: Array<{
    id: string;
    title: string;
    status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";
    createdAt: Date;
    updatedAt: Date;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    clientName: string | null;
    createdByUserId: string;
    assignedOrganizerUserId: string | null;
  }>;
  itineraries: Array<{ id: string; tripId: string | null; createdAt: Date }>;
  shares: Array<{
    id: string;
    tripId: string | null;
    /** Who the link was shared with; the Recently viewed card prefers it to the trip's client. */
    clientName: string | null;
    viewCount: number;
    lastViewedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    proposalRating: number | null;
    proposalRatedAt: Date | null;
    createdAt: Date;
  }>;
  comments: Array<{
    id: string;
    shareId: string;
    content: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    agencyRepliedAt: Date | null;
    createdAt: Date;
    /** Who wrote it, as typed on the share page. */
    authorName: string;
    agencyReply: string | null;
    dayNumber: number | null;
    /** The ItineraryItem the comment is on; its title is in `itemTitles`. */
    itemId: string | null;
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    reviewText: string | null;
    respondentName: string | null;
    consentToTestimonial: boolean;
    submittedAt: Date;
    tripId: string;
  }>;
  /**
   * Titles of the stops comments point at. Optional so hand-built fixtures can
   * leave it out; a missing entry means the stop has no known title.
   */
  itemTitles?: Array<{ id: string; title: string }>;
};

export interface DashboardRepository {
  fetchAgencyDashboardData(agencyId: string): Promise<RawDashboardData>;
}

export function createPrismaDashboardRepository(client: PrismaClient = prisma): DashboardRepository {
  return {
    async fetchAgencyDashboardData(agencyId: string): Promise<RawDashboardData> {
      // Pull a bounded snapshot scoped to this agency. The dashboard reads at
      // most a few hundred rows per slice in v1 — explicit selects keep payload
      // size small. Add pagination only when actual usage shows we need it.
      const [trips, itineraries, shares, reviews] = await Promise.all([
        client.clientTrip.findMany({
          where: { agencyId },
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            startDate: true,
            endDate: true,
            travelerCount: true,
            clientName: true,
            createdByUserId: true,
            assignedOrganizerUserId: true
          }
        }),
        client.itinerary.findMany({
          where: { agencyId },
          select: { id: true, tripId: true, createdAt: true }
        }),
        client.itineraryShare.findMany({
          where: { agencyId },
          select: {
            id: true,
            tripId: true,
            clientName: true,
            viewCount: true,
            lastViewedAt: true,
            expiresAt: true,
            revokedAt: true,
            proposalRating: true,
            proposalRatedAt: true,
            createdAt: true
          }
        }),
        client.tripReview.findMany({
          where: { agencyId },
          orderBy: { submittedAt: "desc" },
          take: 20,
          select: {
            id: true,
            rating: true,
            reviewText: true,
            respondentName: true,
            consentToTestimonial: true,
            submittedAt: true,
            tripId: true
          }
        })
      ]);

      // Comments are joined via shares — fetch by shareId set.
      const shareIds = shares.map((s) => s.id);
      const comments = shareIds.length
        ? await client.itineraryComment.findMany({
            where: { shareId: { in: shareIds } },
            select: {
              id: true,
              shareId: true,
              content: true,
              status: true,
              agencyRepliedAt: true,
              createdAt: true,
              authorName: true,
              agencyReply: true,
              dayNumber: true,
              itemId: true
            }
          })
        : [];

      // One lookup for every stop a comment points at, so the dashboard can name it.
      const itemIds = [...new Set(comments.flatMap((c) => (c.itemId ? [c.itemId] : [])))];
      const itemTitles = itemIds.length
        ? await client.itineraryItem.findMany({
            // Scoped to this agency: itemId comes from the public share page unchecked.
            where: { id: { in: itemIds }, itineraryDay: { itinerary: { agencyId } } },
            select: { id: true, title: true }
          })
        : [];

      return { trips, itineraries, shares, comments, reviews, itemTitles };
    }
  };
}

export const dashboardRepository = createPrismaDashboardRepository();
