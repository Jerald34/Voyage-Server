import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { assertUuid } from "../itineraries/itineraryService";
import type { CreateShareInput, AddCommentInput } from "./shareSchemas";

// ---------- Record types ----------

export type ShareRecord = {
  id: string;
  token: string;
  itineraryId: string;
  tripId: string;
  agencyId: string;
  clientName: string | null;
  clientEmail: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentRecord = {
  id: string;
  shareId: string;
  authorName: string;
  authorEmail: string | null;
  content: string;
  dayNumber: number | null;
  itemId: string | null;
  status: "PENDING" | "SEEN" | "ADDRESSED";
  agencyReply: string | null;
  agencyRepliedAt: Date | null;
  createdAt: Date;
};

export type PublicShareData = {
  share: ShareRecord;
  trip: {
    id: string;
    title: string;
    clientName: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    destinationSummary: string | null;
  };
  itinerary: {
    id: string;
    title: string;
    summary: string | null;
    version: number;
    days: Array<{
      id: string;
      dayNumber: number;
      date: Date | null;
      title: string;
      summary: string | null;
      items: Array<{
        id: string;
        sortOrder: number;
        type: string;
        title: string;
        description: string | null;
        startTime: string | null;
        endTime: string | null;
        clientNotes: string | null;
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
      }>;
    }>;
  };
};

// ---------- Repository interface ----------

export interface ShareRepository {
  createShare(
    agencyId: string,
    itineraryId: string,
    input: CreateShareInput & { token: string }
  ): Promise<ShareRecord>;
  findShareByToken(token: string): Promise<PublicShareData | null>;
  incrementViewCount(shareId: string): Promise<void>;
  revokeShare(agencyId: string, shareId: string): Promise<ShareRecord>;
  listSharesForTrip(agencyId: string, tripId: string): Promise<ShareRecord[]>;
  listAllSharesForAgency(agencyId: string): Promise<ShareRecord[]>;
  addComment(shareId: string, input: AddCommentInput): Promise<CommentRecord>;
  listComments(agencyId: string, shareId: string): Promise<CommentRecord[]>;
  replyToComment(
    agencyId: string,
    commentId: string,
    content: string
  ): Promise<CommentRecord>;
  getUnreadCommentCount(agencyId: string): Promise<number>;
}

// ---------- Service factory ----------

export function createShareService(options: { repository: ShareRepository }) {
  return {
    async createShare(agencyId: string, itineraryId: string, input: CreateShareInput) {
      assertUuid(agencyId, "agencyId");
      assertUuid(itineraryId, "itineraryId");

      const token = nanoid(12);
      return options.repository.createShare(agencyId, itineraryId, { ...input, token });
    },

    async getShareByToken(token: string) {
      const data = await options.repository.findShareByToken(token);
      if (!data) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share link not found.");
      }

      const { share } = data;

      if (share.revokedAt !== null) {
        throw new ApiError(410, "SHARE_REVOKED", "This share link has been revoked.");
      }

      if (share.expiresAt !== null && share.expiresAt <= new Date()) {
        throw new ApiError(410, "SHARE_EXPIRED", "This share link has expired.");
      }

      // Increment view count asynchronously — don't block the response
      options.repository.incrementViewCount(share.id).catch(() => undefined);

      return data;
    },

    async revokeShare(agencyId: string, shareId: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.revokeShare(agencyId, shareId);
    },

    async listSharesForTrip(agencyId: string, tripId?: string) {
      assertUuid(agencyId, "agencyId");
      if (tripId !== undefined) {
        assertUuid(tripId, "tripId");
        return options.repository.listSharesForTrip(agencyId, tripId);
      }
      return options.repository.listAllSharesForAgency(agencyId);
    },

    async addComment(token: string, input: AddCommentInput) {
      const data = await options.repository.findShareByToken(token);
      if (!data) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share link not found.");
      }

      const { share } = data;

      if (share.revokedAt !== null) {
        throw new ApiError(410, "SHARE_REVOKED", "This share link has been revoked.");
      }

      if (share.expiresAt !== null && share.expiresAt <= new Date()) {
        throw new ApiError(410, "SHARE_EXPIRED", "This share link has expired.");
      }

      return options.repository.addComment(share.id, input);
    },

    async listComments(agencyId: string, shareId: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.listComments(agencyId, shareId);
    },

    async replyToComment(agencyId: string, commentId: string, content: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.replyToComment(agencyId, commentId, content);
    },

    async getUnreadCommentCount(agencyId: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.getUnreadCommentCount(agencyId);
    }
  };
}

// ---------- Prisma repository implementation ----------

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
    }
  };
}

export const shareService = createShareService({
  repository: createPrismaShareRepository()
});
