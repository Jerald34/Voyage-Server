// src/modules/admin/accountActionSchemas.ts
import { z } from "zod";

const reason = z.string().trim().max(500).optional();

/** Disable / enable / sign out: an optional note for the audit trail, nothing else. */
export const accountActionReasonSchema = z.object({ reason }).strict();

export const deleteAccountSchema = z
  .object({
    confirmEmail: z.string().trim().min(1).max(320),
    reason,
    newOwnerUserId: z.string().uuid().optional()
  })
  .strict();
