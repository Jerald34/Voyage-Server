import { z } from "zod";
import { longTextSchema, normalizedNameSchema, uuidSchema } from "../../http/requestSchemas";

const normalizedEmailSchema = z.string().trim().toLowerCase().email().max(254);
const publicShareTokenSchema = z.string().min(12).max(512);

export const createShareInputSchema = z.object({
  clientName: z.string().max(200).optional(),
  clientEmail: z.string().email().max(320).optional(),
  expiresAt: z.string().optional()
});

export const addCommentInputSchema = z.object({
  authorName: normalizedNameSchema.max(200),
  authorEmail: normalizedEmailSchema.optional(),
  content: longTextSchema.max(5000),
  dayNumber: z.number().int().positive().optional(),
  itemId: uuidSchema.optional()
}).strict();

export const replyCommentInputSchema = z.object({
  content: z.string().min(1).max(5000)
});

// Live public-share links are generated with nanoid(12), so the param lower bound
// must stay compatible with existing links while still rejecting obviously malformed input.
export const publicShareTokenParamsSchema = z.object({
  token: publicShareTokenSchema
}).strict();

export type CreateShareInput = z.infer<typeof createShareInputSchema>;
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;
export type ReplyCommentInput = z.infer<typeof replyCommentInputSchema>;
