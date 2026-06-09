import { prisma } from "../../db/prisma";
import { ProblemCategory, ReportStatus } from "@prisma/client";
import type { SupportRepository } from "./supportService";

const reportIncludes = {
  reporterUser: { select: { displayName: true, email: true } },
  agency: { select: { name: true } }
} as const;

export const supportRepository: SupportRepository & {
  countByStatus(status: string): Promise<number>;
} = {
  async createReport(data) {
    return prisma.problemReport.create({
      data: {
        ...data,
        category: data.category as ProblemCategory
      }
    });
  },

  async listReports(filter) {
    return prisma.problemReport.findMany({
      where: filter.status ? { status: filter.status as any } : undefined,
      orderBy: { createdAt: "desc" },
      include: reportIncludes
    });
  },

  async findReportById(id) {
    return prisma.problemReport.findUnique({
      where: { id },
      include: reportIncludes
    });
  },

  async updateReport(id, patch) {
    return prisma.problemReport.update({
      where: { id },
      data: patch
    });
  },

  async countByStatus(status) {
    return prisma.problemReport.count({ where: { status: status as any } });
  }
};
