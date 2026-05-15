import { z } from "zod";

function normalizeComparable(value: string) {
  return value.trim().toLowerCase();
}

function getEmailLocalPart(email: string) {
  return normalizeComparable(email).split("@")[0] ?? "";
}

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  displayName: z.string().trim().min(1).max(120)
}).superRefine((input, context) => {
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
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

export const emailCheckSchema = z.object({
  email: z.string().trim().email()
});

export const confirmVerificationSchema = z.object({
  token: z.string().min(16)
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().email()
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8)
});
