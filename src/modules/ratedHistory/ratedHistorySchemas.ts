import { z } from "zod";
import { idParamsSchema, optionalTextSchema, uuidSchema } from "../../http/requestSchemas";

// ── List query ──────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  destination: optionalTextSchema(200),
  durationDays: z.coerce.number().int().positive().optional(),
  season: z.enum(["spring", "summer", "fall", "winter"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20)
}).strict();

// ── Detail path params ───────────────────────────────────────────────────────

export const detailParamsSchema = idParamsSchema("tripId");
export const targetTripParamsSchema = idParamsSchema("tripId");

// ── Insert selection (discriminated union by kind) ───────────────────────────

export const insertSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    itemIds: z.array(uuidSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("day"),
    dayIds: z.array(uuidSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("segment"),
    dayIds: z.array(uuidSchema).min(1)
  }).strict()
]);

// ── Insert target ────────────────────────────────────────────────────────────

export const insertTargetSchema = z.object({
  itineraryId: uuidSchema,
  dayIndex: z.number().int().min(0),
  position: z.number().int().min(0).optional()
}).strict();

// ── Insert request body ──────────────────────────────────────────────────────

export const insertBodySchema = z.object({
  sourceTripId: uuidSchema,
  selection: insertSelectionSchema,
  target: insertTargetSchema,
  ifMatchVersion: z.number().int().min(1)
}).strict();
