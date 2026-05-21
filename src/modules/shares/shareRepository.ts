import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import type {
  ShareRepository,
  ShareRecord,
  PublicShareData,
  CommentRecord
} from "./shareTypes";
import type { AddCommentInput } from "./shareSchemas";

// ---------- Helper function ----------

function includeItineraryPublicDetails() {
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

// ---------- Prisma repository implementation ----------

export function createPrismaShareRepository(client: PrismaClient = prisma): ShareRepository {
  return {
    async createShare(agencyId, itineraryId, input) {
      // Verify the itinerary belongs to this agency
      const itinerary = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId },
        select: { id: true, tripId: true }
      });

      if (!itinerary) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }

      const share = await client.itineraryShare.create({
        data: {
          token: input.token,
          itineraryId,
          tripId: itinerary.tripId,
          agencyId,
          clientName: input.clientName ?? null,
          clientEmail: input.clientEmail ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null
        }
      });

      return share as ShareRecord;
    },

    async findShareByToken(token) {
      const share = await client.itineraryShare.findUnique({
        where: { token }
      });

      if (!share) {
        return null;
      }

      const itinerary = await client.itinerary.findUnique({
        where: { id: share.itineraryId },
        select: {
          id: true,
          title: true,
          summary: true,
          version: true,
          ...includeItineraryPublicDetails()
        }
      });

      if (!itinerary) {
        return null;
      }

      const trip = await client.clientTrip.findUnique({
        where: { id: share.tripId },
        select: {
          id: true,
          title: true,
          clientName: true,
          startDate: true,
          endDate: true,
          travelerCount: true,
          destinationSummary: true
        }
      });

      if (!trip) {
        return null;
      }

      return {
        share: share as ShareRecord,
        trip,
        itinerary: {
          id: itinerary.id,
          title: itinerary.title,
          summary: itinerary.summary,
          version: itinerary.version,
          days: itinerary.days.map((day) => ({
            id: day.id,
            dayNumber: day.dayNumber,
            date: day.date,
            title: day.title,
            summary: day.summary,
            items: day.items.map((item) => ({
              id: item.id,
              sortOrder: item.sortOrder,
              type: item.type,
              title: item.title,
              description: item.description,
              startTime: item.startTime,
              endTime: item.endTime,
              clientNotes: item.clientNotes,
              placeSnapshot: item.placeSnapshot
                ? {
                    id: item.placeSnapshot.id,
                    provider: item.placeSnapshot.provider,
                    providerPlaceId: item.placeSnapshot.providerPlaceId,
                    name: item.placeSnapshot.name,
                    formattedAddress: item.placeSnapshot.formattedAddress,
                    latitude: item.placeSnapshot.latitude,
                    longitude: item.placeSnapshot.longitude,
                    rating: item.placeSnapshot.rating,
                    websiteUrl: item.placeSnapshot.websiteUrl,
                    phoneNumber: item.placeSnapshot.phoneNumber,
                    metadata: item.placeSnapshot.metadata
                  }
                : null
            }))
          }))
        }
      } as PublicShareData;
    },

    async incrementViewCount(shareId) {
      await client.itineraryShare.update({
        where: { id: shareId },
        data: {
          viewCount: { increment: 1 },
          lastViewedAt: new Date()
        }
      });
    },

    async revokeShare(agencyId, shareId) {
      const existing = await client.itineraryShare.findFirst({
        where: { id: shareId, agencyId }
      });

      if (!existing) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found.");
      }

      if (existing.revokedAt !== null) {
        throw new ApiError(409, "SHARE_ALREADY_REVOKED", "Share has already been revoked.");
      }

      const updated = await client.itineraryShare.update({
        where: { id: shareId },
        data: { revokedAt: new Date() }
      });

      return updated as ShareRecord;
    },

    async listSharesForTrip(agencyId, tripId) {
      const shares = await client.itineraryShare.findMany({
        where: { agencyId, tripId },
        orderBy: { createdAt: "desc" }
      });
      return shares as ShareRecord[];
    },

    async listAllSharesForAgency(agencyId) {
      const shares = await client.itineraryShare.findMany({
        where: { agencyId },
        orderBy: { createdAt: "desc" }
      });
      return shares as ShareRecord[];
    },

    async addComment(shareId, input) {
      const comment = await client.itineraryComment.create({
        data: {
          shareId,
          authorName: input.authorName,
          authorEmail: input.authorEmail ?? null,
          content: input.content,
          dayNumber: input.dayNumber ?? null,
          itemId: input.itemId ?? null
        }
      });
      return comment as CommentRecord;
    },

    async listCommentsByShareId(shareId) {
      const comments = await client.itineraryComment.findMany({
        where: { shareId },
        orderBy: { createdAt: "asc" }
      });
      return comments as CommentRecord[];
    },

    async listComments(agencyId, shareId) {
      // Verify the share belongs to this agency
      const share = await client.itineraryShare.findFirst({
        where: { id: shareId, agencyId },
        select: { id: true }
      });

      if (!share) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found.");
      }

      const comments = await client.itineraryComment.findMany({
        where: { shareId },
        orderBy: { createdAt: "asc" }
      });

      return comments as CommentRecord[];
    },

    async replyToComment(agencyId, commentId, content) {
      // Verify the comment belongs to a share owned by this agency
      const comment = await client.itineraryComment.findFirst({
        where: {
          id: commentId,
          share: { agencyId }
        },
        select: { id: true }
      });

      if (!comment) {
        throw new ApiError(404, "COMMENT_NOT_FOUND", "Comment not found.");
      }

      const updated = await client.itineraryComment.update({
        where: { id: commentId },
        data: {
          agencyReply: content,
          agencyRepliedAt: new Date(),
          status: "ADDRESSED"
        }
      });

      return updated as CommentRecord;
    },

    async getUnreadCommentCount(agencyId) {
      return client.itineraryComment.count({
        where: {
          status: "PENDING",
          share: { agencyId }
        }
      });
    },

    async getUnreadCommentCountsByTrip(agencyId) {
      const shares = await client.itineraryShare.findMany({
        where: { agencyId },
        select: {
          tripId: true,
          _count: {
            select: { comments: { where: { status: "PENDING" } } }
          }
        }
      });
      const perTrip = new Map<string, number>();
      for (const share of shares) {
        const prev = perTrip.get(share.tripId) ?? 0;
        perTrip.set(share.tripId, prev + share._count.comments);
      }
      return [...perTrip.entries()]
        .filter(([, count]) => count > 0)
        .map(([tripId, count]) => ({ tripId, count }));
    }
  };
}

export const shareRepository = createPrismaShareRepository();
