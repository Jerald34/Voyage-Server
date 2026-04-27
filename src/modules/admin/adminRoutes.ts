import { Router } from "express";
import { requireAdmin } from "../../http/authMiddleware";
import { agencyReviewSchema } from "../agencies/agencySchemas";
import { agencyService } from "../agencies/agencyService";

export const adminRoutes = Router();

adminRoutes.get("/agencies/pending", requireAdmin, async (request, response, next) => {
  try {
    const agencies = await agencyService.listPendingAgencies(request.authUser!);
    response.json({ agencies });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/approve", requireAdmin, async (request, response, next) => {
  try {
    const agency = await agencyService.approveAgency(request.authUser!, String(request.params.agencyId));
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/reject", requireAdmin, async (request, response, next) => {
  try {
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.rejectAgency(request.authUser!, String(request.params.agencyId), input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/suspend", requireAdmin, async (request, response, next) => {
  try {
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.suspendAgency(request.authUser!, String(request.params.agencyId), input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});
