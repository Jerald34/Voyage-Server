import { z } from "zod";

export const createAgencySchema = z.object({
  name: z.string().min(1).max(160)
});

export const agencyReviewSchema = z.object({
  reason: z.string().min(1).max(1000)
});
