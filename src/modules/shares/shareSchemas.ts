import { z } from "zod";

export const createShareInputSchema = z.object({
  clientName: z.string().max(200).optional(),
  clientEmail: z.string().email().max(320).optional(),
  expiresAt: z.string().optional()
});

export const addCommentInputSchema = z.object({
  authorName: z.string().min(1).max(200),
  authorEmail: z.string().email().max(320).optional(),
  content: z.string().min(1).max(5000),
  dayNumber: z.number().int().positive().optional(),
  itemId: z.string().uuid().optional()
});

export const replyCommentInputSchema = z.object({
  content: z.string().min(1).max(5000)
});

export type CreateShareInput = z.infer<typeof createShareInputSchema>;
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;
export type ReplyCommentInput = z.infer<typeof replyCommentInputSchema>;
