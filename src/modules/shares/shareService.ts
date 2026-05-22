import { nanoid } from "nanoid";
import { ApiError } from "../../http/errors";
import { assertUuid } from "../itineraries/itineraryService";
import type { CreateShareInput, AddCommentInput } from "./shareSchemas";
import type { ShareRepository, PublicShareData, CommentRecord } from "./shareTypes";
import { shareRepository } from "./shareRepository";

// Re-export all types
export type { ShareRecord, CommentRecord, PublicShareData, ShareRepository } from "./shareTypes";

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

    async listPublicComments(token: string) {
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

      return options.repository.listCommentsByShareId(share.id);
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
    },

    async getUnreadCommentCountsByTrip(agencyId: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.getUnreadCommentCountsByTrip(agencyId);
    }
  };
}

// ---------- Singleton instance ----------

export const shareService = createShareService({
  repository: shareRepository
});
