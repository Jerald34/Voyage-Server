import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import * as agentController from "./agentController";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 }
});

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
router.get("/threads/:id/messages", agentController.listThreadMessages);
router.delete("/threads/:id", agentController.deleteThread);
router.post("/threads/:id/approve-itinerary", agentController.approveItineraryThread);
router.post("/threads/:id/approve", agentController.approveItineraryThread);
router.post("/threads/:id/messages", agentController.createMessage);
router.post("/threads/:id/images", upload.array("images", 3), agentController.uploadChatImages);
router.get("/runs/:id/stream", agentController.runStream);
router.post("/runs/:id/cancel", agentController.cancelRun);
router.get("/runs/:id/events", agentController.listRunEvents);

export { router as agentRoutes };
