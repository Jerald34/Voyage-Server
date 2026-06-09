import { Router } from "express";
import { ApiError } from "../../http/errors";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { idParamsSchema } from "../../http/requestSchemas";
import {
  createAgencySchema,
  deleteAgencySchema,
  updateAgencySettingsSchema
} from "./agencySchemas";
import { agencyService } from "./agencyService";

export const agencyRoutes = Router();
const agencyIdParamsSchema = idParamsSchema("agencyId");

agencyRoutes.post("/", requireAuth, async (request, response, next) => {
  try {
    const input = createAgencySchema.parse(request.body);
    const agency = await agencyService.createAgencyApplication(request.authUser!, input);
    response.status(201).json({ agency });
  } catch (error) {
    next(error);
  }
});

agencyRoutes.get("/me", requireAuth, (request, response) => {
  response.json({ memberships: request.authUser!.memberships });
});

agencyRoutes.patch("/:agencyId/settings", requireAuth, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    await agencyAccessService.requireAgencyAdmin(request.authUser!, agencyId);
    const input = updateAgencySettingsSchema.parse(request.body);
    const agency = await agencyService.updateAgencySettings(request.authUser!, agencyId, {
      ...input
    });
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

agencyRoutes.delete("/:agencyId", requireAuth, async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const parsed = deleteAgencySchema.safeParse(request.body);
    if (!parsed.success) {
      const hasOnlyConfirmNameIssues = parsed.error.issues.every(
        (issue) => issue.path[0] === "confirmName" && issue.code !== "unrecognized_keys"
      );
      if (hasOnlyConfirmNameIssues) {
        throw new ApiError(400, "NAME_CONFIRMATION_REQUIRED", "confirmName is required to delete an agency.");
      }
      throw parsed.error;
    }
    const input = parsed.data;
    await agencyService.deleteAgency(request.authUser!, agencyId, input);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
