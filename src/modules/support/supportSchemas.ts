import { z } from "zod";

export const createReportSchema = z.object({
  category: z.enum(["BUG", "BILLING", "FEATURE", "OTHER"]),
  subject: z.string().min(1).max(150),
  message: z.string().min(1).max(5000),
  appContext: z.string().max(300).optional()
});

export const updateReportSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "WONT_FIX"]).optional(),
  adminNotes: z.string().max(5000).optional(),
  githubIssueUrl: z.string().url().optional(),
  githubIssueNumber: z.number().int().optional()
});
