import { z } from "zod";
import { longTextSchema, normalizedNameSchema } from "../../http/requestSchemas";

const normalizedEmailSchema = z.string().trim().toLowerCase().email().max(254);
const reviewTokenSchema = z.string().min(16).max(512);

// ---------- Proposal rating (POST /shared/:token/rate) ----------

export const proposalRatingInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(1000).optional()
}).strict();

export type ProposalRatingInput = z.infer<typeof proposalRatingInputSchema>;

// ---------- Trip review (POST /reviews/:tripToken/submit) ----------

export const tripReviewSubmitInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  npsScore: z.number().int().min(0).max(10).optional(),
  reviewText: longTextSchema.max(4000).optional(),
  respondentName: normalizedNameSchema.max(200).optional(),
  respondentEmail: normalizedEmailSchema.optional(),
  consentToTestimonial: z.boolean()
}).strict();

export const tripReviewTokenParamsSchema = z.object({
  tripToken: reviewTokenSchema
}).strict();

export type TripReviewSubmitInput = z.infer<typeof tripReviewSubmitInputSchema>;
