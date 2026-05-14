import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120)
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(120)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const emailCheckSchema = z.object({
  email: z.string().email()
});

export const confirmVerificationSchema = z.object({
  token: z.string().min(16)
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email()
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8)
});
