import { z } from "zod";

export const createThreadSchema = z.object({
  title: z.string().max(200).optional(),
  tripId: z.uuid().optional()
});

export const createMessageSchema = z.object({
  content: z.string().min(1).max(12000)
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
    "map.pinpointed",
    "route.estimated",
    "source.added",
    "run.completed",
    "run.failed"
  ]),
  payload: z.record(z.string(), z.unknown())
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
