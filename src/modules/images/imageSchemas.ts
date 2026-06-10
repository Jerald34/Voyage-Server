import { z } from "zod";
import { idParamsSchema, requiredTextSchema, uuidSchema } from "../../http/requestSchemas";

export const requestUploadSchema = z.object({
  purpose: z.enum(["PROFILE_AVATAR", "AGENCY_LOGO", "TRIP_ITINERARY_IMAGE", "CLIENT_ITINERARY_IMAGE"]),
  mimeType: requiredTextSchema(200),
  sizeBytes: z.number().int().positive(),
  agencyId: uuidSchema.optional(),
  tripId: uuidSchema.optional()
}).strict();

export const imageIdParamsSchema = idParamsSchema("imageId");
