import { z } from "zod";
import type { AgentTool, AgentToolService } from "../agentTools";
import { createRunRecord } from "./toolUtils";

const taskInputSchema = z.object({
  label: z.string().min(1).max(500),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).default("PENDING"),
  sortOrder: z.number().int().nonnegative().optional()
});

const taskShorthandInputSchema = z.object({
  task: z.string().min(1).max(500).optional(),
  task_name: z.string().min(1).max(500).optional(),
  task_description: z.string().min(1).max(2000).optional(),
  description: z.string().max(2000).optional(),
  status: z.string().min(1).max(40).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  sortOrder: z.number().int().nonnegative().optional()
}).superRefine((value, context) => {
  if (!value.task && !value.task_name && !value.task_description && !value.description) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either task, task_name, task_description, or description is required."
    });
  }
});

function normalizeTaskInput(input: unknown): z.infer<typeof taskInputSchema> {
  const strict = taskInputSchema.safeParse(input);
  if (strict.success) {
    return strict.data;
  }

  const shorthand = taskShorthandInputSchema.parse(input);
  const rawStatus = shorthand.status?.trim().toUpperCase();
  const normalizedStatus =
    rawStatus === "PENDING" || rawStatus === "RUNNING" || rawStatus === "COMPLETED" || rawStatus === "FAILED"
      ? rawStatus
      : undefined;
  const mappedStatus =
    normalizedStatus ??
    (shorthand.priority === "high"
      ? "RUNNING"
      : shorthand.priority === "medium"
        ? "PENDING"
        : "PENDING");
  const baseLabel = (shorthand.task_name ?? shorthand.task ?? shorthand.task_description ?? shorthand.description ?? "").trim();
  const label = (shorthand.description && (shorthand.task || shorthand.task_name))
    ? `${baseLabel} — ${shorthand.description.trim()}`.slice(0, 500)
    : baseLabel.slice(0, 500);

  return taskInputSchema.parse({
    label,
    status: mappedStatus,
    sortOrder: shorthand.sortOrder
  });
}

export function createRecordAgentTaskTool(options: { agentService: AgentToolService }): AgentTool {
  return {
    name: "record_agent_task",
    async execute(context, input) {
      const parsed = normalizeTaskInput(input);
      const run = createRunRecord(context);
      return options.agentService.recordTask(run, {
        label: parsed.label,
        status: parsed.status,
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {})
      });
    }
  };
}
