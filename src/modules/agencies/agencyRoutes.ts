import { Router } from "express";
import { ApiError } from "../../http/errors";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { createAgencySchema, updateAgencySettingsSchema } from "./agencySchemas";
import { agencyService } from "./agencyService";

export const agencyRoutes = Router();

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
    await agencyAccessService.requireAgencyAdmin(request.authUser!, String(request.params.agencyId));
    const input = updateAgencySettingsSchema.parse(request.body);
    const agency = await agencyService.updateAgencySettings(request.authUser!, String(request.params.agencyId), {
      ...input
    });
    response.json({ agency });
  } catch (error) {
    next(error);
  }
});

agencyRoutes.delete("/:agencyId", requireAuth, async (request, response, next) => {
  try {
    const confirmName = request.body?.confirmName;
    if (typeof confirmName !== "string" || !confirmName.trim()) {
      throw new ApiError(400, "NAME_CONFIRMATION_REQUIRED", "confirmName is required to delete an agency.");
    }
    await agencyService.deleteAgency(request.authUser!, String(request.params.agencyId), { confirmName });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
