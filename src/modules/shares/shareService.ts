import { nanoid } from "nanoid";
import { ApiError } from "../../http/errors";
import { assertUuid } from "../itineraries/itineraryService";
import type { CreateShareInput, AddCommentInput } from "./shareSchemas";
import type { ShareRepository, PublicShareData, CommentRecord } from "./shareTypes";
import { shareRepository } from "./shareRepository";
import { computeExtendedExpiry } from "./shareExpiry";
import { buildShareResponseFromData, computeShareRevision } from "./publicShareService";
import { invalidateAgencyDashboards } from "../dashboard/dashboardFreshness";

// Re-export all types
export type { ShareRecord, CommentRecord, PublicShareData, ShareRepository } from "./shareTypes";

// ---------- Service factory ----------

/**
 * `onAgencyActivity(agencyId)` runs after a client touches an agency's link
 * (a comment, a view), so the agency's dashboard caches can be cleared. The
 * public routes don't know the agency; the share record does.
 */
export function createShareService(options: { repository: ShareRepository; onAgencyActivity?: (agencyId: string) => void }) {
  // The client's comment or view is already saved; a failing hook must not
  // turn that into an error for a public page.
  function reportAgencyActivity(agencyId: string | null) {
    if (!agencyId) return;
    try {
      options.onAgencyActivity?.(agencyId);
    } catch {
      // Worst case the dashboard shows the change once its cache expires.
    }
  }

  // The share for a public token, or the 404/410 a client should see for a link
  // that does not exist, was turned off, or has run out.
  async function readLiveShare(token: string): Promise<PublicShareData> {
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

    return data;
  }

  return {
    async createShare(agencyId: string, itineraryId: string, input: CreateShareInput) {
      assertUuid(agencyId, "agencyId");
      assertUuid(itineraryId, "itineraryId");

      const token = nanoid(12);
      return options.repository.createShare(agencyId, itineraryId, { ...input, token });
    },

    async getShareByToken(token: string) {
      const data = await readLiveShare(token);
      const { share } = data;

      // Increment view count asynchronously — don't block the response
      options.repository
        .incrementViewCount(share.id)
        .then(() => reportAgencyActivity(share.agencyId))
        .catch(() => undefined);

      return data;
    },

    /**
     * The fingerprint of the itinerary a share link shows, for an open page to
     * ask "has it changed?". Unlike getShareByToken this is not a view: it does
     * not count one and does not report agency activity.
     */
    async getShareRevision(token: string) {
      const data = await readLiveShare(token);
      return computeShareRevision(buildShareResponseFromData(data));
    },

    async revokeShare(agencyId: string, shareId: string) {
      assertUuid(agencyId, "agencyId");
      return options.repository.revokeShare(agencyId, shareId);
    },

    async extendShare(agencyId: string, shareId: string, extendDays: number, now: Date = new Date()) {
      assertUuid(agencyId, "agencyId");
      const share = await options.repository.findShareForAgency(agencyId, shareId);
      if (!share) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found.");
      }
      if (share.revokedAt !== null) {
        throw new ApiError(409, "SHARE_REVOKED", "This link was turned off. Share the itinerary again instead.");
      }
      if (share.expiresAt === null) {
        throw new ApiError(409, "SHARE_NEVER_EXPIRES", "This link never expires.");
      }
      const updated = await options.repository.updateShareExpiry(
        agencyId,
        shareId,
        computeExtendedExpiry(share.expiresAt, extendDays, now)
      );
      if (updated) return updated;

      // Nothing was written: the link was revoked or removed after it was read.
      const current = await options.repository.findShareForAgency(agencyId, shareId);
      if (current?.revokedAt) {
        throw new ApiError(409, "SHARE_REVOKED", "This link was turned off. Share the itinerary again instead.");
      }
      throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found.");
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

      const comment = await options.repository.addComment(share.id, input);
      reportAgencyActivity(share.agencyId);
      return comment;
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
  repository: shareRepository,
  onAgencyActivity: invalidateAgencyDashboards
});
