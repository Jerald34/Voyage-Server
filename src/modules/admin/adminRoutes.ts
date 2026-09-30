import { Router } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyReviewSchema } from "../agencies/agencySchemas";
import { agencyService } from "../agencies/agencyService";
import { createUsageService, usageQuerySchema } from "./usageService";
import { usageRepository } from "./usageRepository";
import { supportService } from "../support/supportService";
import { updateReportSchema } from "../support/supportSchemas";

const usageService = createUsageService({ repository: usageRepository });
const adminAgencyStatusQuerySchema = z
  .object({
    status: z.enum(["PENDING_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"]).optional()
  })
  .strict();
const adminReportStatusQuerySchema = z
  .object({
    status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "WONT_FIX"]).optional()
  })
  .strict();
const reportIdParamsSchema = idParamsSchema("id");
const agencyIdParamsSchema = idParamsSchema("agencyId");

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
    const { status } = adminAgencyStatusQuerySchema.parse(request.query);
    const agencies = await agencyService.listAllAgencies(request.authUser!, status);
    response.json({ agencies });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/usage", requireSuperAdmin, async (request, response, next) => {
  try {
    const { period, groupBy, from, to } = usageQuerySchema.parse(request.query);
    const result = await usageService.getUsage(request.authUser!, { period, groupBy, from, to });
    response.json(result);
  } catch (error) { next(error); }
});

adminRoutes.get("/reports", requireSuperAdmin, async (request, response, next) => {
  try {
    const { status } = adminReportStatusQuerySchema.parse(request.query);
    const reports = await supportService.listReports(request.authUser!, { status });
    response.json({ reports });
  } catch (error) { next(error); }
});

adminRoutes.get("/reports/:id", requireSuperAdmin, async (request, response, next) => {
  try {
    const { id } = reportIdParamsSchema.parse(request.params);
    response.json({ report: await supportService.getReport(request.authUser!, id) });
  } catch (error) { next(error); }
});

adminRoutes.patch("/reports/:id", requireSuperAdmin, async (request, response, next) => {
  try {
    const { id } = reportIdParamsSchema.parse(request.params);
    const input = updateReportSchema.parse(request.body);
    response.json({ report: await supportService.updateReport(request.authUser!, id, input) });
  } catch (error) { next(error); }
});

// Parameterized routes

adminRoutes.get("/agencies/:agencyId", requireSuperAdmin, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const agency = await agencyService.getAgencyDetail(request.authUser!, agencyId);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/approve", requireSuperAdmin, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const agency = await agencyService.approveAgency(request.authUser!, agencyId);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/reject", requireSuperAdmin, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.rejectAgency(request.authUser!, agencyId, input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/suspend", requireSuperAdmin, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const input = agencyReviewSchema.parse(request.body);
    const agency = await agencyService.suspendAgency(request.authUser!, agencyId, input);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/agencies/:agencyId/unsuspend", requireSuperAdmin, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const agency = await agencyService.unsuspendAgency(request.authUser!, agencyId);
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});
