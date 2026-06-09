import { z } from "zod";
import { nullableTextSchema, optionalTextSchema, requiredTextSchema } from "../../http/requestSchemas";

export const createReportSchema = z.object({
  category: z.enum(["BUG", "BILLING", "FEATURE", "OTHER"]),
  subject: requiredTextSchema(150),
  message: requiredTextSchema(5000),
  appContext: optionalTextSchema(300)
}).strict();

export const updateReportSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "WONT_FIX"]).optional(),
  adminNotes: nullableTextSchema(5000),
  githubIssueUrl: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().url().nullable().optional()),
  githubIssueNumber: z.number().int().positive().optional()
}).strict();
