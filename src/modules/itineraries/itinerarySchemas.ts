import { z } from "zod";

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
  routeFromPrevious: z.unknown().optional(),
  staffNotes: z.string().max(2000).optional(),
  clientNotes: z.string().max(2000).optional()
});

export const structuredItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  date: z.coerce.date().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  items: z.array(structuredItineraryItemSchema).default([])
});

export const structuredItineraryInputSchema = z.object({
  trip: z.object({
    title: z.string().min(1).max(200),
    destinationSummary: z.string().max(500).optional(),
    clientName: z.string().max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
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
