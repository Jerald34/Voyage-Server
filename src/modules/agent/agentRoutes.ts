import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import * as agentController from "./agentController";

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
    );
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/threads", agentController.listThreads);
router.post("/threads", agentController.createThread);
router.get("/threads/:id", agentController.getThread);
router.delete("/threads/:id", agentController.deleteThread);
router.post("/threads/:id/approve-itinerary", agentController.approveItineraryThread);
router.post("/threads/:id/approve", agentController.approveItineraryThread);
router.post("/threads/:id/messages", agentController.createMessage);
router.get("/runs/:id/stream", agentController.runStream);
router.post("/runs/:id/cancel", agentController.cancelRun);
router.get("/runs/:id/events", agentController.listRunEvents);

export { router as agentRoutes };
