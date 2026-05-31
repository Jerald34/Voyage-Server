import { z } from "zod";

// ── List query ──────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  destination: z.string().optional(),
  durationDays: z.coerce.number().int().positive().optional(),
  season: z.enum(["spring", "summer", "fall", "winter"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20)
});

// ── Detail path params ───────────────────────────────────────────────────────

export const detailParamsSchema = z.object({
  tripId: z.string().uuid()
});

// ── Insert selection (discriminated union by kind) ───────────────────────────

export const insertSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    itemIds: z.array(z.string().uuid()).min(1)
  }),
  z.object({
    kind: z.literal("day"),
    dayIds: z.array(z.string().uuid()).min(1)
  }),
  z.object({
    kind: z.literal("segment"),
    dayIds: z.array(z.string().uuid()).min(1)
  })
]);

// ── Insert target ────────────────────────────────────────────────────────────

export const insertTargetSchema = z.object({
  itineraryId: z.string().uuid(),
  dayIndex: z.number().int().min(0),
  position: z.number().int().min(0).optional()
});

// ── Insert request body ──────────────────────────────────────────────────────

export const insertBodySchema = z.object({
  sourceTripId: z.string().uuid(),
  selection: insertSelectionSchema,
  target: insertTargetSchema,
  ifMatchVersion: z.number().int().min(1)
});
