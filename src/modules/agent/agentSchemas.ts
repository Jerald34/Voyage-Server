import { z } from "zod";
import {
  idParamsSchema,
  longTextSchema,
  nullableTextSchema,
  optionalTextSchema,
  paginationQuerySchema,
  requiredTextSchema,
  uuidSchema
} from "../../http/requestSchemas";

export const createThreadSchema = z.object({
  title: optionalTextSchema(200),
  tripId: uuidSchema.optional()
}).strict();

export const createMessageSchema = z.object({
  content: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1).max(12000)),
  imageUrls: z.array(z.string().url()).max(3).optional()
}).strict();

const optionalNullableDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.date().nullable().optional()
);

export const saveItineraryThreadSchema = z.object({
  itineraryId: uuidSchema,
  clientName: requiredTextSchema(200),
  destination: requiredTextSchema(500),
  startDate: optionalNullableDateSchema,
  endDate: optionalNullableDateSchema,
  travelerCount: z.number().int().positive().max(999).optional(),
  budgetLevel: optionalTextSchema(100)
}).strict().superRefine((value, context) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "endDate must be on or after startDate."
    });
  }
});

export const updateThreadTitleSchema = z.object({
  title: requiredTextSchema(200)
}).strict();

export const agentThreadParamsSchema = idParamsSchema("id");
export const agentRunParamsSchema = idParamsSchema("id");
export const listThreadMessagesQuerySchema = paginationQuerySchema;

export const agentEventSchema = z.object({
  type: z.enum([
    "run.started",
    "task.updated",
    "tool.started",
    "tool.completed",
    "tool.failed",
    "message.delta",
    "thought.delta",
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
