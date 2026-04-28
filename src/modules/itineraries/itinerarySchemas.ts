import { z } from "zod";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isPlainObject(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

const optionalNullableDateSchema = z.preprocess(
  (value) => (value === null ? null : value),
  z.coerce.date().nullable().optional()
);

const routeFromPreviousSchema = z.custom<Exclude<JsonValue, null>>(
  (value) => value !== null && isJsonValue(value),
  "routeFromPrevious must be a JSON value and cannot be null."
);

export const itineraryItemTypeSchema = z.enum([
  "ACTIVITY",
  "MEAL",
  "TRANSFER",
  "CHECK_IN",
  "CHECK_OUT",
  "FREE_TIME",
  "NOTE"
]);

export const structuredItineraryItemSchema = z.object({
  type: itineraryItemTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startTime: z.string().max(20).optional(),
  endTime: z.string().max(20).optional(),
  placeSnapshotId: z.string().uuid().optional(),
  routeFromPrevious: routeFromPreviousSchema.optional(),
  staffNotes: z.string().max(2000).optional(),
  clientNotes: z.string().max(2000).optional()
});

export const structuredItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  date: optionalNullableDateSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  items: z.array(structuredItineraryItemSchema).default([])
});

export const structuredItineraryInputSchema = z.object({
  trip: z.object({
    title: z.string().min(1).max(200),
    destinationSummary: z.string().max(500).optional(),
    clientName: z.string().max(200).optional(),
    startDate: optionalNullableDateSchema,
    endDate: optionalNullableDateSchema,
    travelerCount: z.number().int().positive().max(999).optional(),
    budgetLevel: z.string().max(100).optional()
  }),
  itinerary: z.object({
    title: z.string().min(1).max(200),
    summary: z.string().max(3000).optional(),
    days: z.array(structuredItineraryDaySchema).min(1).max(60)
  })
});

export const replaceItinerarySchema = structuredItineraryInputSchema.shape.itinerary;
