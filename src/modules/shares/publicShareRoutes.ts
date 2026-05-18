import { Router } from "express";
import { addCommentInputSchema } from "./shareSchemas";
import { shareService } from "./shareService";

export const publicShareRoutes = Router();

// GET /shared/:token — fetch the itinerary data for a share link (no auth required)
publicShareRoutes.get("/:token", async (request, response, next) => {
  try {
    const token = String(request.params.token);
    const data = await shareService.getShareByToken(token);
    response.json(data);
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
