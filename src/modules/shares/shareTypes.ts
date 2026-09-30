import type { CreateShareInput, AddCommentInput } from "./shareSchemas";

// ---------- Record types ----------

export type ShareRecord = {
  id: string;
  token: string;
  itineraryId: string;
  tripId: string;
  agencyId: string | null;
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

export type PublicShareAgency = {
  id: string;
  name: string;
  logoImage: { bucket: string; objectKey: string } | null;
};

export type PublicShareCreator = {
  id: string;
  displayName: string;
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
  } | null;
  agency: PublicShareAgency | null;
  creator: PublicShareCreator;
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
          /** Provider status only; null means unverified, never open. */
          businessStatus: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
          businessStatusCheckedAt: Date | null;
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
  listCommentsByShareId(shareId: string): Promise<CommentRecord[]>;
  listComments(agencyId: string, shareId: string): Promise<CommentRecord[]>;
  replyToComment(
    agencyId: string,
    commentId: string,
    content: string
  ): Promise<CommentRecord>;
  getUnreadCommentCount(agencyId: string): Promise<number>;
  getUnreadCommentCountsByTrip(agencyId: string): Promise<Array<{ tripId: string; count: number }>>;
}
