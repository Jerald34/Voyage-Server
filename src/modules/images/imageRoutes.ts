import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { requestUploadSchema } from "./imageSchemas";
import { imageService } from "./imageService";

export const imageRoutes = Router();

imageRoutes.post("/upload-url", requireAuth, async (request, response, next) => {
  try {
    const input = requestUploadSchema.parse(request.body);
    const result = await imageService.requestUpload(request.authUser!, input);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

imageRoutes.post("/:imageId/complete", requireAuth, async (request, response, next) => {
  try {
    const image = await imageService.completeUpload(request.authUser!, String(request.params.imageId));
    response.json({ image });
  } catch (error) {
    next(error);
  }
});

imageRoutes.get("/:imageId/url", requireAuth, async (request, response, next) => {
  try {
    const result = await imageService.createReadUrl(request.authUser!, String(request.params.imageId));
    response.json(result);
  } catch (error) {
    next(error);
  }
});
