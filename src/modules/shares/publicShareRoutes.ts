import { Router } from "express";
import { addCommentInputSchema } from "./shareSchemas";
import { shareService } from "./shareService";
import { buildShareResponse } from "./publicShareService";
import { proposalRatingInputSchema } from "../reviews/reviewSchemas";
import { reviewService } from "../reviews/reviewService";
import { ApiError } from "../../http/errors";

export const publicShareRoutes = Router();

// ---------- Tiny in-process rate limiter keyed by share token ----------
// 10 requests per 60s per token. Replace with a shared store when we run
// more than one server instance behind a balancer.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(token: string) {
  const now = Date.now();
  const recent = (rateBuckets.get(token) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again in a minute.");
  }
  recent.push(now);
  rateBuckets.set(token, recent);
}

// GET /shared/:token — fetch the itinerary data for a share link (no auth required)
publicShareRoutes.get("/:token", async (request, response, next) => {
  try {
    const token = String(request.params.token);
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
    const token = String(request.params.token);
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
    const token = String(request.params.token);
    const comments = await shareService.listPublicComments(token);
    response.json({ comments });
  } catch (error) {
    next(error);
  }
});

// POST /shared/:token/rate — client-side proposal rating, rate-limited (no auth required)
publicShareRoutes.post("/:token/rate", async (request, response, next) => {
  try {
    const token = String(request.params.token);
    checkRateLimit(token);
    const input = proposalRatingInputSchema.parse(request.body);
    const result = await reviewService.rateProposal(token, input);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
