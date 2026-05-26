// ---------- TripReview record ----------

export type TripReviewRecord = {
  id: string;
  tripId: string;
  agencyId: string;
  rating: number;
  npsScore: number | null;
  reviewText: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  consentToTestimonial: boolean;
  submittedAt: Date;
  emailSentAt: Date | null;
  createdAt: Date;
};

/** Subset exposed in public API responses (no internal fields). */
export type TripReviewPublic = Omit<TripReviewRecord, "emailSentAt">;

/** Brief summary returned by GET .../check when a prior review exists. */
export type TripReviewSummary = {
  id: string;
  rating: number;
  submittedAt: Date;
};

// ---------- Repository interface ----------

import type { TripReviewSubmitInput } from "./reviewSchemas";

export interface ReviewRepository {
  findTripAgencyId(tripId: string): Promise<string | null>;
  findReviewByTripId(tripId: string): Promise<TripReviewRecord | null>;
  createReview(input: TripReviewSubmitInput & { tripId: string; agencyId: string }): Promise<TripReviewRecord>;
}
