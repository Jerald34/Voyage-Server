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
              createdAt: true
            }
          })
        : [];

      return { trips, itineraries, shares, comments, reviews };
    }
  };
}

export const dashboardRepository = createPrismaDashboardRepository();
