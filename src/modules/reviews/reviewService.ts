import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { reviewRepository } from "./reviewRepository";
import type {
  ProposalRatingInput,
  TripReviewSubmitInput
} from "./reviewSchemas";
import type {
  ReviewRepository,
  TripReviewPublic,
  TripReviewSummary
} from "./reviewTypes";
import { verifyTripReviewToken } from "./reviewTokens";

/**
 * Orchestration for the rating system.
 *
 * Two surfaces:
 *  - Proposal rating attached to an `ItineraryShare` (public, token-gated).
 *  - Trip-level review submitted from the one-shot post-trip email link.
 *
 * Both endpoints are public, so each operation strictly validates the token
 * before touching the DB.
 */

const RATING_UPDATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createReviewService(deps: { repository: ReviewRepository }) {
  /**
   * Apply (or update, within 24h) a proposal rating on the share identified by `token`.
   * Returns the persisted values for the client to echo in its UI.
   */
  async function rateProposal(token: string, input: ProposalRatingInput) {
    const share = await prisma.itineraryShare.findUnique({
      where: { token },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        proposalRating: true,
        proposalRatedAt: true
      }
    });
    if (!share) {
      throw new ApiError(404, "SHARE_NOT_FOUND", "Share link not found.");
    }
    if (share.revokedAt !== null) {
      throw new ApiError(410, "SHARE_REVOKED", "This share link has been revoked.");
    }
    if (share.expiresAt !== null && share.expiresAt <= new Date()) {
      throw new ApiError(410, "SHARE_EXPIRED", "This share link has expired.");
    }

    const now = new Date();
    if (share.proposalRatedAt !== null) {
      const elapsed = now.getTime() - share.proposalRatedAt.getTime();
      if (elapsed > RATING_UPDATE_WINDOW_MS) {
        throw new ApiError(409, "RATING_PERIOD_CLOSED", "Rating period closed.");
      }
    }

    const updated = await prisma.itineraryShare.update({
      where: { id: share.id },
      data: {
        proposalRating: input.rating,
        proposalRatingComment: input.comment ?? null,
        proposalRatedAt: now
      },
      select: { proposalRating: true, proposalRatingComment: true, proposalRatedAt: true }
    });

    return {
      rating: updated.proposalRating!,
      comment: updated.proposalRatingComment,
      ratedAt: updated.proposalRatedAt!.toISOString()
    };
  }

  /**
   * Validate the trip-review token and check whether a prior review exists.
   * Powers the "thanks, you've already reviewed this trip" UX in Stage 5B.
   */
  async function checkTripReviewToken(
    tripToken: string
  ): Promise<{ tripId: string; hasSubmitted: boolean; prior?: TripReviewSummary }> {
    const payload = verifyTripReviewToken(tripToken);
    if (!payload) {
      throw new ApiError(401, "INVALID_REVIEW_TOKEN", "This review link is invalid or expired.");
    }
    const existing = await deps.repository.findReviewByTripId(payload.tripId);
    return {
      tripId: payload.tripId,
      hasSubmitted: existing !== null,
      prior:
        existing !== null
          ? { id: existing.id, rating: existing.rating, submittedAt: existing.submittedAt }
          : undefined
    };
  }

  /**
   * Submit (or idempotently reject duplicate of) a trip review.
   * On a re-submission, return 409 with the prior record so the client can
   * show a thank-you state.
   */
  async function submitTripReview(
    tripToken: string,
    input: TripReviewSubmitInput
  ): Promise<TripReviewPublic> {
    const payload = verifyTripReviewToken(tripToken);
    if (!payload) {
      throw new ApiError(401, "INVALID_REVIEW_TOKEN", "This review link is invalid or expired.");
    }
    const agencyId = await deps.repository.findTripAgencyId(payload.tripId);
    if (!agencyId) {
      throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    }

    const existing = await deps.repository.findReviewByTripId(payload.tripId);
    if (existing !== null) {
      throw new ApiError(409, "REVIEW_ALREADY_SUBMITTED", "A review has already been submitted for this trip.");
    }

    const created = await deps.repository.createReview({
      ...input,
      tripId: payload.tripId,
      agencyId
    });

    return {
      id: created.id,
      tripId: created.tripId,
      agencyId: created.agencyId,
      rating: created.rating,
      npsScore: created.npsScore,
      reviewText: created.reviewText,
      respondentName: created.respondentName,
      respondentEmail: created.respondentEmail,
      consentToTestimonial: created.consentToTestimonial,
      submittedAt: created.submittedAt,
      createdAt: created.createdAt
    };
  }

  return { rateProposal, checkTripReviewToken, submitTripReview };
}

export const reviewService = createReviewService({ repository: reviewRepository });
