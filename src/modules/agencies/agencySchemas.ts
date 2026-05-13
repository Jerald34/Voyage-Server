import { z } from "zod";

export const createAgencySchema = z.object({
  name: z.string().min(1).max(160),
  businessPhone: z.string().min(1).max(30),
  businessEmail: z.string().email().max(254).optional(),
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  logoImageId: z.string().uuid().optional(),
});

export const updateAgencySettingsSchema = z.object({
  name: z.string().min(1).max(160),
  businessPhone: z.string().min(1).max(30),
  businessEmail: z.string().email().max(254).optional().or(z.literal("")),
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100)
});

export const agencyReviewSchema = z.object({
  reason: z.string().min(1).max(1000)
});
