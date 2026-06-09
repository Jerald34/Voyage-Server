import { Router } from "express";
import { addCommentInputSchema, publicShareTokenParamsSchema } from "./shareSchemas";
import { shareService } from "./shareService";
import { buildShareResponse } from "./publicShareService";
import { proposalRatingInputSchema } from "../reviews/reviewSchemas";
import { reviewService } from "../reviews/reviewService";

export const publicShareRoutes = Router();

// GET /shared/:token — fetch the itinerary data for a share link (no auth required)
publicShareRoutes.get("/:token", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const data = await shareService.getShareByToken(token);
    const result = buildShareResponse({
      share: data.share,
      agency: data.agency,
      itinerary: data.itinerary as Record<string, unknown>,
      trip: data.trip as Record<string, unknown> | null,
      creator: data.creator
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /shared/:token/comments — add a comment to a shared itinerary (no auth required)
publicShareRoutes.post("/:token/comments", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const input = addCommentInputSchema.parse(request.body);
    const comment = await shareService.addComment(token, input);
    response.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
});

// GET /shared/:token/comments — list comments on a shared itinerary (no auth required)
publicShareRoutes.get("/:token/comments", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const comments = await shareService.listPublicComments(token);
    response.json({ comments });
  } catch (error) {
    next(error);
  }
});

// POST /shared/:token/rate — client-side proposal rating, rate-limited (no auth required)
publicShareRoutes.post("/:token/rate", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const input = proposalRatingInputSchema.parse(request.body);
    const result = await reviewService.rateProposal(token, input);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
