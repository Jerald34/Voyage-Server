import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { createReportSchema } from "./supportSchemas";
import { supportService } from "./supportService";

export const supportRoutes = Router();

supportRoutes.post("/reports", requireAuth, async (request, response, next) => {
  try {
    const input = createReportSchema.parse(request.body);
    const agencyId =
      request.authUser?.memberships?.find(
        (m) => m?.status === "ACTIVE" && m?.agencyId
      )?.agencyId ?? null;
    const report = await supportService.createReport(request.authUser!, input, {
      agencyId,
      userAgent: request.get("user-agent") ?? null
    });
    response.status(201).json({ report });
  } catch (error) {
    next(error);
  }
});
