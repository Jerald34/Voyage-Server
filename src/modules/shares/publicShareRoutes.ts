import { Router } from "express";
import { addCommentInputSchema, publicShareTokenParamsSchema } from "./shareSchemas";
import { shareService } from "./shareService";
import { buildShareResponseFromData, computeShareRevision } from "./publicShareService";
import { proposalRatingInputSchema } from "../reviews/reviewSchemas";
import { reviewService } from "../reviews/reviewService";
import { itineraryWeatherService } from "../weather/weatherService";

export const publicShareRoutes = Router();

// GET /shared/:token — fetch the itinerary data for a share link (no auth required)
publicShareRoutes.get("/:token", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const data = await shareService.getShareByToken(token);
    const result = buildShareResponseFromData(data);
    // `revision` fingerprints the itinerary this response carries, so an open page
    // can compare it with GET /shared/:token/revision to see whether it was edited.
    response.json({ ...result, revision: computeShareRevision(result) });
  } catch (error) {
    next(error);
  }
});

// GET /shared/:token/revision — cheap "has the itinerary changed?" check for an open
// share page (no auth, not a view). Same 404/410 as the page itself.
publicShareRoutes.get("/:token/revision", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const revision = await shareService.getShareRevision(token);
    response.setHeader("Cache-Control", "no-store");
    response.json({ revision });
  } catch (error) {
    next(error);
  }
});

// GET /shared/:token/weather — per-day weather for a share link (no auth, not a view)
publicShareRoutes.get("/:token/weather", async (request, response, next) => {
  try {
    const { token } = publicShareTokenParamsSchema.parse(request.params);
    const weather = await itineraryWeatherService.forShareToken(token);
    response.json({ weather });
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
