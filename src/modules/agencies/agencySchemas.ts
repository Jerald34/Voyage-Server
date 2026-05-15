import { z } from "zod";

const trimmedRequiredBusinessEmailSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string().email().max(254));

const trimmedNullableBusinessEmailSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}, z.string().email().max(254).nullable().optional());

const trimmedDigitsOnlyBusinessPhoneSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}, z.string().min(1).max(30).regex(/^\d+$/, "Business phone must contain digits only."));

export const createAgencySchema = z.object({
  name: z.string().min(1).max(160),
  businessPhone: trimmedDigitsOnlyBusinessPhoneSchema,
  businessEmail: trimmedRequiredBusinessEmailSchema,
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  logoImageId: z.string().uuid().optional(),
});

export const updateAgencySettingsSchema = z.object({
  name: z.string().min(1).max(160),
  businessPhone: trimmedDigitsOnlyBusinessPhoneSchema,
  businessEmail: trimmedNullableBusinessEmailSchema,
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100)
});

export const agencyReviewSchema = z.object({
  reason: z.string().min(1).max(1000)
});
