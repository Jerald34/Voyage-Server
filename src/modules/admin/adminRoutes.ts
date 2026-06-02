import { Router } from "express";
import { requireSuperAdmin } from "../../http/authMiddleware";
import { agencyReviewSchema } from "../agencies/agencySchemas";
import { agencyService } from "../agencies/agencyService";
import { createUsageService } from "./usageService";
import { usageRepository } from "./usageRepository";
import { supportService } from "../support/supportService";
import { updateReportSchema } from "../support/supportSchemas";

const usageService = createUsageService({ repository: usageRepository });

export const adminRoutes = Router();

// Literal paths first — before parameterized :agencyId routes

adminRoutes.get("/agencies/pending", requireSuperAdmin, async (request, response, next) => {
  try {
    const agencies = await agencyService.listPendingAgencies(request.authUser!);
    response.json({ agencies });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/agencies/pending-count", requireSuperAdmin, async (request, response, next) => {
  try {
    const count = await agencyService.getPendingCount(request.authUser!);
    response.json({ count });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/agencies", requireSuperAdmin, async (request, response, next) => {
  try {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const agencies = await agencyService.listAllAgencies(request.authUser!, status);
    response.json({ agencies });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/usage", requireSuperAdmin, async (request, response, next) => {
  try {
    const { period, groupBy, from, to } = request.query as Record<string, string>;
    const result = await usageService.getUsage(request.authUser!, { period: period as any, groupBy: groupBy as any, from, to });
    response.json(result);
  } catch (error) { next(error); }
});

adminRoutes.get("/reports", requireSuperAdmin, async (request, response, next) => {
  try {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const reports = await supportService.listReports(request.authUser!, { status });
    response.json({ reports });
  } catch (error) { next(error); }
});

adminRoutes.get("/reports/:id", requireSuperAdmin, async (request, response, next) => {
  try {
    response.json({ report: await supportService.getReport(request.authUser!, String(request.params.id)) });
  } catch (error) { next(error); }
});

adminRoutes.patch("/reports/:id", requireSuperAdmin, async (request, response, next) => {
  try {
    const input = updateReportSchema.parse(request.body);
    response.json({ report: await supportService.updateReport(request.authUser!, String(request.params.id), input) });
  } catch (error) { next(error); }
});

// Parameterized routes

adminRoutes.get("/agencies/:agencyId", requireSuperAdmin, async (request, response, next) => {
  try {
    const agency = await agencyService.getAgencyDetail(request.authUser!, String(request.params.agencyId));
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/approve", requireSuperAdmin, async (request, response, next) => {
  try {
    const agency = await agencyService.approveAgency(request.authUser!, String(request.params.agencyId));
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/reject", requireSuperAdmin, async (request, response, next) => {
  try {
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.rejectAgency(request.authUser!, String(request.params.agencyId), input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/suspend", requireSuperAdmin, async (request, response, next) => {
  try {
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.suspendAgency(request.authUser!, String(request.params.agencyId), input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/unsuspend", requireSuperAdmin, async (request, response, next) => {
  try {
    const agency = await agencyService.unsuspendAgency(request.authUser!, String(request.params.agencyId));
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});
