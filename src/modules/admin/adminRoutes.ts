import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyReviewSchema } from "../agencies/agencySchemas";
import { agencyService } from "../agencies/agencyService";
import { createUsageService, usageQuerySchema, usageRunsQuerySchema } from "./usageService";
import { usageRepository } from "./usageRepository";
import { createAdminAccountService } from "./accountService";
import { adminAccountRepository } from "./accountRepository";
import { createAdminAccountActionService, type AccountActionActor } from "./accountActionService";
import { createPrismaAccountActionRepository } from "./accountActionRepository";
import { accountActionReasonSchema, agentPauseSchema, deleteAccountSchema } from "./accountActionSchemas";
import { supportService } from "../support/supportService";
import { updateReportSchema } from "../support/supportSchemas";

const usageService = createUsageService({ repository: usageRepository });
const accountService = createAdminAccountService({ repository: adminAccountRepository });
const accountActionService = createAdminAccountActionService({ repository: createPrismaAccountActionRepository() });
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
// The account list takes no filters; strict makes a stray query parameter a validation error like its siblings.
const adminUsersQuerySchema = z.object({}).strict();
const reportIdParamsSchema = idParamsSchema("id");
const agencyIdParamsSchema = idParamsSchema("agencyId");
const userIdParamsSchema = idParamsSchema("userId");
const runIdParamsSchema = idParamsSchema("runId");

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

adminRoutes.get("/users", requireSuperAdmin, async (request, response, next) => {
  try {
    adminUsersQuerySchema.parse(request.query);
    const users = await accountService.listAccounts(request.authUser!);
    response.json({ users });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get("/usage", requireSuperAdmin, async (request, response, next) => {
  try {
    const query = usageQuerySchema.parse(request.query);
    response.json(await usageService.getUsage(request.authUser!, query));
  } catch (error) { next(error); }
});

adminRoutes.get("/usage/runs", requireSuperAdmin, async (request, response, next) => {
  try {
    const query = usageRunsQuerySchema.parse(request.query);
    response.json(await usageService.getRuns(request.authUser!, query));
  } catch (error) { next(error); }
});

adminRoutes.get("/usage/runs/:runId", requireSuperAdmin, async (request, response, next) => {
  try {
    const { runId } = runIdParamsSchema.parse(request.params);
    response.json(await usageService.getRun(request.authUser!, runId));
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

adminRoutes.get("/users/:userId", requireSuperAdmin, async (request, response, next) => {
  try {
    const { userId } = userIdParamsSchema.parse(request.params);
    const user = await accountService.getAccount(request.authUser!, userId);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});

// Each account action answers with the refreshed account so the panel can redraw without a second request.
function accountActionRoute(run: (actor: AccountActionActor, userId: string, reason: string | null) => Promise<void>) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { userId } = userIdParamsSchema.parse(request.params);
      const { reason } = accountActionReasonSchema.parse(request.body ?? {});
      await run(request.authUser!, userId, reason ?? null);
      response.json({ user: await accountService.getAccount(request.authUser!, userId) });
    } catch (error) {
      next(error);
    }
  };
}

adminRoutes.post("/users/:userId/disable", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.disable(actor, userId, reason)));
adminRoutes.post("/users/:userId/enable", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.enable(actor, userId, reason)));
adminRoutes.post("/users/:userId/sign-out", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.signOutEverywhere(actor, userId, reason)));

adminRoutes.post("/users/:userId/agent-pause", requireSuperAdmin, async (request, response, next) => {
  try {
    const { userId } = userIdParamsSchema.parse(request.params);
    const input = agentPauseSchema.parse(request.body ?? {});
    await accountActionService.pauseAgent(request.authUser!, userId, input);
    response.json({ user: await accountService.getAccount(request.authUser!, userId) });
  } catch (error) {
    next(error);
  }
});

// Resuming needs no input. The shared helper accepts an empty body (and ignores a note); unknown fields are still rejected.
adminRoutes.post("/users/:userId/agent-resume", requireSuperAdmin, accountActionRoute((actor, userId) => accountActionService.resumeAgent(actor, userId)));

adminRoutes.post("/users/:userId/delete", requireSuperAdmin, async (request, response, next) => {
  try {
    const { userId } = userIdParamsSchema.parse(request.params);
    const input = deleteAccountSchema.parse(request.body ?? {});
    await accountActionService.deleteAccount(request.authUser!, userId, input);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

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
