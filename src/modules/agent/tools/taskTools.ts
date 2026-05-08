import { z } from "zod";
import type { AgentTool, AgentToolService } from "../agentTools";
import { createRunRecord } from "./toolUtils";

const taskInputSchema = z.object({
  label: z.string().min(1).max(500),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).default("PENDING"),
  sortOrder: z.number().int().nonnegative().optional()
});

const taskNestedObjectSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  label: z.string().min(1).max(500).optional(),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  status: z.string().min(1).max(40).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  sortOrder: z.number().int().nonnegative().optional()
});

const taskShorthandInputSchema = z.object({
  task: z.union([z.string().min(1).max(500), taskNestedObjectSchema]).optional(),
  task_name: z.string().min(1).max(500).optional(),
  task_description: z.string().min(1).max(2000).optional(),
  description: z.string().max(2000).optional(),
  title: z.string().min(1).max(500).optional(),
  label: z.string().min(1).max(500).optional(),
  status: z.string().min(1).max(40).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  sortOrder: z.number().int().nonnegative().optional()
}).superRefine((value, context) => {
  const taskValue = value.task;
  const hasTaskString = typeof taskValue === "string" && taskValue.trim().length > 0;
  const nested = taskValue && typeof taskValue === "object" ? taskValue : null;
  const hasNestedLabel = nested
    ? Boolean(nested.title || nested.label || nested.name || nested.description)
    : false;
  if (
    !hasTaskString &&
    !hasNestedLabel &&
    !value.task_name &&
    !value.task_description &&
    !value.description &&
    !value.title &&
    !value.label
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide a task label via one of: label, task, title, task_name, task_description, or description."
    });
  }
});

function normalizeTaskInput(input: unknown): z.infer<typeof taskInputSchema> {
  const strict = taskInputSchema.safeParse(input);
  if (strict.success) {
    return strict.data;
  }

  const shorthand = taskShorthandInputSchema.parse(input);
  const taskValue = shorthand.task;
  const taskString = typeof taskValue === "string" ? taskValue : undefined;
  const taskNested = taskValue && typeof taskValue === "object" ? taskValue : undefined;

  const candidateStatus = shorthand.status ?? taskNested?.status;
  const rawStatus = candidateStatus?.trim().toUpperCase();
  const normalizedStatus =
    rawStatus === "PENDING" || rawStatus === "RUNNING" || rawStatus === "COMPLETED" || rawStatus === "FAILED"
      ? rawStatus
      : rawStatus === "IN_PROGRESS" || rawStatus === "ACTIVE" || rawStatus === "WORKING"
        ? "RUNNING"
        : rawStatus === "DONE" || rawStatus === "COMPLETE" || rawStatus === "SUCCESS"
          ? "COMPLETED"
          : rawStatus === "ERROR" || rawStatus === "FAIL"
            ? "FAILED"
            : undefined;
  const candidatePriority = shorthand.priority ?? taskNested?.priority;
  const mappedStatus =
    normalizedStatus ??
    (candidatePriority === "high"
      ? "RUNNING"
      : "PENDING");

  const baseLabel = (
    shorthand.label ??
    shorthand.title ??
    shorthand.task_name ??
    taskNested?.title ??
    taskNested?.label ??
    taskNested?.name ??
    taskString ??
    shorthand.task_description ??
    shorthand.description ??
    taskNested?.description ??
    ""
  ).trim();
  const description = shorthand.description ?? shorthand.task_description ?? taskNested?.description;
  const hasSeparateDescription =
    description && description.trim().length > 0 && description.trim() !== baseLabel;
  const label = hasSeparateDescription
    ? `${baseLabel} — ${description.trim()}`.slice(0, 500)
    : baseLabel.slice(0, 500);

  return taskInputSchema.parse({
    label,
    status: mappedStatus,
    sortOrder: shorthand.sortOrder ?? taskNested?.sortOrder
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
