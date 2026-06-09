import { z } from "zod";
import { requiredTextSchema, uuidSchema } from "../../http/requestSchemas";

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
}, z.string().min(7, "Enter a valid phone number (7–15 digits)").max(15, "Enter a valid phone number (7–15 digits)").regex(/^\d+$/, "Business phone must contain digits only."));

export const createAgencySchema = z.object({
  name: requiredTextSchema(160),
  businessPhone: trimmedDigitsOnlyBusinessPhoneSchema,
  businessEmail: trimmedRequiredBusinessEmailSchema,
  country: requiredTextSchema(100),
  city: requiredTextSchema(100),
  logoImageId: uuidSchema.optional()
}).strict();

export const updateAgencySettingsSchema = z.object({
  name: requiredTextSchema(160),
  businessPhone: trimmedDigitsOnlyBusinessPhoneSchema,
  businessEmail: trimmedNullableBusinessEmailSchema,
  country: requiredTextSchema(100),
  city: requiredTextSchema(100)
}).strict();

export const agencyReviewSchema = z.object({
  reason: requiredTextSchema(1000)
}).strict();

export const deleteAgencySchema = z.object({
  confirmName: requiredTextSchema(160)
}).strict();
