import { z } from "zod";

export const createThreadSchema = z.object({
  title: z.string().max(200).optional(),
  tripId: z.uuid().optional()
});

export const createMessageSchema = z.object({
  content: z.string().min(1).max(12000),
  imageUrls: z.array(z.string().url()).max(3).optional()
});

const optionalNullableDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.date().nullable().optional()
);

export const approveItineraryThreadSchema = z.object({
  itineraryId: z.uuid(),
  clientName: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(500),
  startDate: optionalNullableDateSchema,
  endDate: optionalNullableDateSchema,
  travelerCount: z.number().int().positive().max(999).optional(),
  budgetLevel: z.string().trim().max(100).optional()
});

export const agentEventSchema = z.object({
  type: z.enum([
    "run.started",
    "task.updated",
    "tool.started",
    "tool.completed",
    "tool.failed",
    "message.delta",
    "message.completed",
    "itinerary.updated",
    "itinerary.created",
    "itinerary.deleted",
    "itinerary.day.added",
    "itinerary.day.updated",
    "itinerary.day.removed",
    "itinerary.item.added",
    "itinerary.item.updated",
    "itinerary.item.removed",
    "itinerary.item.moved",
    "map.pinpointed",
    "route.estimated",
    "source.added",
    "run.completed",
    "run.failed"
  ]),
  payload: z.record(z.string(), z.unknown())
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
