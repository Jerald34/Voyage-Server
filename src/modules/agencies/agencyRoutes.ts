import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { createAgencySchema } from "./agencySchemas";
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
