// src/modules/admin/accountActionSchemas.ts
import { z } from "zod";

// A blank or null note means no note, so the audit trail never shows an empty reason.
const reason = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => value || undefined);

/** Disable / enable / sign out: an optional note for the audit trail, nothing else. */
export const accountActionReasonSchema = z.object({ reason }).strict();

export const deleteAccountSchema = z
  .object({
    confirmEmail: z.string().trim().min(1).max(320),
    reason,
    newOwnerUserId: z.string().uuid().optional()
  })
  .strict();

/** Pause a user's access to the agent. Strict: unknown fields are errors, like the other account actions. */
export const agentPauseSchema = z
  .object({
    duration: z.enum(["1h", "24h", "7d", "indefinite"]),
    // Shown to the user and their agency owner, so it is required.
    reason: z.string().trim().min(1).max(300)
  })
  .strict();
