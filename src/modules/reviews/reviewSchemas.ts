import { z } from "zod";

// ---------- Proposal rating (POST /shared/:token/rate) ----------

export const proposalRatingInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional()
});

export type ProposalRatingInput = z.infer<typeof proposalRatingInputSchema>;

// ---------- Trip review (POST /reviews/:tripToken/submit) ----------

export const tripReviewSubmitInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  npsScore: z.number().int().min(0).max(10).optional(),
  reviewText: z.string().max(4000).optional(),
  respondentName: z.string().max(200).optional(),
  respondentEmail: z.string().email().max(320).optional(),
  consentToTestimonial: z.boolean()
});

export type TripReviewSubmitInput = z.infer<typeof tripReviewSubmitInputSchema>;
