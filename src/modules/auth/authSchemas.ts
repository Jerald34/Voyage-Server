import { z } from "zod";

function normalizeComparable(value: string) {
  return value.trim().toLowerCase();
}

function getEmailLocalPart(email: string) {
  return normalizeComparable(email).split("@")[0] ?? "";
}

const normalizedEmailSchema = z.string().trim().toLowerCase().email().max(254);
const verificationTokenSchema = z.string().min(16).max(512);
const loginPasswordSchema = z.string().min(1).max(1024);
const registerPasswordSchema = z.string().min(8).max(1024);
const resetPasswordSchema = z.string().min(8).max(1024);
const oauthStateSchema = z.string().min(1).max(512);
const googleAuthorizationCodeSchema = z.string().min(1).max(512);
const appleIdTokenSchema = z.string().min(1).max(4096);

export const registerSchema = z.object({
  email: normalizedEmailSchema,
  password: registerPasswordSchema,
  displayName: z.string().trim().min(1).max(120)
}).strict().superRefine((input, context) => {
  const normalizedPassword = normalizeComparable(input.password);
  const normalizedEmail = normalizeComparable(input.email);
  const normalizedDisplayName = normalizeComparable(input.displayName);
  const emailLocalPart = getEmailLocalPart(input.email);

  if (
    normalizedPassword === normalizedEmail ||
    normalizedPassword === normalizedDisplayName ||
    (emailLocalPart && normalizedPassword === emailLocalPart)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["password"],
      message: "Password must be different from your name and email."
    });
  }
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120)
}).strict();

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: loginPasswordSchema
}).strict();

export const emailCheckSchema = z.object({
  email: normalizedEmailSchema
}).strict();

export const confirmVerificationSchema = z.object({
  token: verificationTokenSchema
}).strict();

export const requestPasswordResetSchema = z.object({
  email: normalizedEmailSchema
}).strict();

export const confirmPasswordResetSchema = z.object({
  token: verificationTokenSchema,
  password: resetPasswordSchema
}).strict();

export const setAccountTypeSchema = z.object({
  accountType: z.enum(["PERSONAL", "AGENCY_USER"])
}).strict();

export const verificationRequestSchema = z.object({
  email: normalizedEmailSchema
}).strict();

export const googleCallbackQuerySchema = z.object({
  code: googleAuthorizationCodeSchema.optional(),
  state: oauthStateSchema.optional()
}).strict();

export const appleCallbackBodySchema = z.object({
  id_token: appleIdTokenSchema.optional(),
  state: oauthStateSchema.optional()
}).strict();
