import { z } from "zod";

export const requestUploadSchema = z.object({
  purpose: z.enum(["PROFILE_AVATAR", "AGENCY_LOGO", "TRIP_ITINERARY_IMAGE", "CLIENT_ITINERARY_IMAGE"]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  agencyId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional()
});
