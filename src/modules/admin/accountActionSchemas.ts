// src/modules/admin/accountActionSchemas.ts
import { z } from "zod";

// A blank note means no note, so the audit trail never shows an empty reason.
const reason = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || undefined)
  .optional();

/** Disable / enable / sign out: an optional note for the audit trail, nothing else. */
export const accountActionReasonSchema = z.object({ reason }).strict();

export const deleteAccountSchema = z
  .object({
    confirmEmail: z.string().trim().min(1).max(320),
    reason,
    newOwnerUserId: z.string().uuid().optional()
  })
  .strict();
