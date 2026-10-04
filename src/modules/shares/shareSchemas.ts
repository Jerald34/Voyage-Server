import { z } from "zod";
import {
  cuidSchema,
  futureIsoDateTimeSchema,
  idParamsSchema,
  longTextSchema,
  normalizedNameSchema,
  nullableTextSchema,
  optionalTextSchema,
  uuidSchema
} from "../../http/requestSchemas";

const normalizedEmailSchema = z.string().trim().toLowerCase().email().max(254);
const optionalNormalizedEmailSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}, normalizedEmailSchema.optional());
const publicShareTokenSchema = z.string().min(12).max(512);

export const createShareInputSchema = z.object({
  clientName: optionalTextSchema(200),
  clientEmail: optionalNormalizedEmailSchema,
  expiresAt: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, futureIsoDateTimeSchema.optional())
}).strict();

export const addCommentInputSchema = z.object({
  authorName: normalizedNameSchema.max(200),
  authorEmail: normalizedEmailSchema.optional(),
  content: longTextSchema.max(5000),
  dayNumber: z.number().int().positive().optional(),
  itemId: uuidSchema.optional()
}).strict();

export const replyCommentInputSchema = z.object({
  content: longTextSchema
}).strict();

// Live public-share links are generated with nanoid(12), so the param lower bound
// must stay compatible with existing links while still rejecting obviously malformed input.
export const publicShareTokenParamsSchema = z.object({
  token: publicShareTokenSchema
}).strict();
// Mounted under `/agencies/:agencyId/shares` with a mergeParams router, so
// `req.params` also carries `agencyId`; include it or strict parsing rejects it.
// Share and comment ids are Prisma cuid()s, unlike the UUID agency id.
export const shareIdParamsSchema = z.object({ agencyId: uuidSchema, shareId: cuidSchema }).strict();
export const commentIdParamsSchema = z.object({ agencyId: uuidSchema, commentId: cuidSchema }).strict();
export const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
export const listSharesQuerySchema = z.object({
  tripId: uuidSchema.optional()
}).strict();

export type CreateShareInput = z.infer<typeof createShareInputSchema>;
export type AddCommentInput = z.infer<typeof addCommentInputSchema>;
export type ReplyCommentInput = z.infer<typeof replyCommentInputSchema>;
