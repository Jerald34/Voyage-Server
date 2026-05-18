import type { Request } from "express";
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { createShareInputSchema, replyCommentInputSchema } from "./shareSchemas";
import { shareService } from "./shareService";

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

export const shareRoutes = Router({ mergeParams: true });

shareRoutes.use(requireAuth);
shareRoutes.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
    );
    // Store resolved UUID on request so all downstream handlers use the real ID
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

// POST /agencies/:agencyId/shares/:itineraryId — create a share link
shareRoutes.post("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const itineraryId = String(request.params.itineraryId);
    const input = createShareInputSchema.parse(request.body);
    const share = await shareService.createShare(agencyId, itineraryId, input);
    response.status(201).json({ share });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/shares — list shares (optionally filtered by ?tripId=)
shareRoutes.get("/", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const tripId = typeof request.query.tripId === "string" ? request.query.tripId : undefined;
    const shares = await shareService.listSharesForTrip(agencyId, tripId);
    response.json({ shares });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/shares/unread-count — get unread comment count
// NOTE: this route must be declared before /:shareId to avoid param shadowing
shareRoutes.get("/unread-count", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const count = await shareService.getUnreadCommentCount(agencyId);
    response.json({ count });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/shares/unread-counts-by-trip — per-trip unread counts
// NOTE: this route must be declared before /:shareId to avoid param shadowing
shareRoutes.get("/unread-counts-by-trip", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const counts = await shareService.getUnreadCommentCountsByTrip(agencyId);
    response.json({ counts });
  } catch (error) {
    next(error);
  }
});

// DELETE /agencies/:agencyId/shares/:shareId — revoke a share
shareRoutes.delete("/:shareId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const shareId = String(request.params.shareId);
    const share = await shareService.revokeShare(agencyId, shareId);
    response.json({ share });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/shares/:shareId/comments — list comments on a share
shareRoutes.get("/:shareId/comments", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const shareId = String(request.params.shareId);
    const comments = await shareService.listComments(agencyId, shareId);
    response.json({ comments });
  } catch (error) {
    next(error);
  }
});

// POST /agencies/:agencyId/shares/comments/:commentId/reply — reply to a comment
shareRoutes.post("/comments/:commentId/reply", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const commentId = String(request.params.commentId);
    const { content } = replyCommentInputSchema.parse(request.body);
    const comment = await shareService.replyToComment(agencyId, commentId, content);
    response.json({ comment });
  } catch (error) {
    next(error);
  }
});
