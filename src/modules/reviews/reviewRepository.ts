import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { ReviewRepository, TripReviewRecord } from "./reviewTypes";
import type { TripReviewSubmitInput } from "./reviewSchemas";

export function createPrismaReviewRepository(client: PrismaClient = prisma): ReviewRepository {
  return {
    async findTripAgencyId(tripId: string): Promise<string | null> {
      const trip = await client.clientTrip.findUnique({
        where: { id: tripId },
        select: { agencyId: true }
      });
      return trip?.agencyId ?? null;
    },

    async findReviewByTripId(tripId: string): Promise<TripReviewRecord | null> {
      const review = await client.tripReview.findFirst({
        where: { tripId }
      });
      return review as TripReviewRecord | null;
    },

    async createReview(
      input: TripReviewSubmitInput & { tripId: string; agencyId: string }
    ): Promise<TripReviewRecord> {
      const review = await client.tripReview.create({
        data: {
          tripId: input.tripId,
          agencyId: input.agencyId,
          rating: input.rating,
          npsScore: input.npsScore ?? null,
          reviewText: input.reviewText ?? null,
          respondentName: input.respondentName ?? null,
          respondentEmail: input.respondentEmail ?? null,
          consentToTestimonial: input.consentToTestimonial,
          submittedAt: new Date()
        }
      });
      return review as TripReviewRecord;
    }
  };
}

export const reviewRepository = createPrismaReviewRepository();
