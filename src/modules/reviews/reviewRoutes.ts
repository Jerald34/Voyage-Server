import { Router } from "express";
import { tripReviewSubmitInputSchema, tripReviewTokenParamsSchema } from "./reviewSchemas";
import { reviewService } from "./reviewService";

/**
 * Mounted at `/reviews`. Public, token-gated endpoints.
 *
 * GET  /:tripToken/check   — does a review already exist for this trip?
 * POST /:tripToken/submit  — create a TripReview (idempotent, returns 409 if duplicate)
 */
export const reviewRoutes: Router = Router();

reviewRoutes.get("/:tripToken/check", async (request, response, next) => {
  try {
    const { tripToken } = tripReviewTokenParamsSchema.parse(request.params);
    const result = await reviewService.checkTripReviewToken(tripToken);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

reviewRoutes.post("/:tripToken/submit", async (request, response, next) => {
  try {
    const { tripToken } = tripReviewTokenParamsSchema.parse(request.params);
    const input = tripReviewSubmitInputSchema.parse(request.body);
    const review = await reviewService.submitTripReview(tripToken, input);
    response.status(201).json({ review });
  } catch (error) {
    next(error);
  }
});
