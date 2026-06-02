import { ApiError } from "../../http/errors";

export interface SupportServiceUser {
  id: string;
  role: string;
}

export interface SupportRepository {
  createReport(data: {
    reporterUserId: string;
    agencyId: string | null;
    category: string;
    subject: string;
    message: string;
    appContext: string | null;
    userAgent: string | null;
  }): Promise<any>;
  listReports(filter: { status?: string }): Promise<any[]>;
  findReportById(id: string): Promise<any | null>;
  updateReport(id: string, patch: Record<string, any>): Promise<any>;
}

function assertSuperAdmin(user: SupportServiceUser) {
  if (user.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Super admin only.");
  }
}

export function createSupportService(options: {
  repository: SupportRepository;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());

  return {
    async createReport(
      user: SupportServiceUser,
      input: { category: string; subject: string; message: string; appContext?: string },
      context: { agencyId?: string | null; userAgent?: string | null }
    ) {
      return options.repository.createReport({
        reporterUserId: user.id,
        agencyId: context.agencyId ?? null,
        category: input.category,
        subject: input.subject,
        message: input.message,
        appContext: input.appContext ?? null,
        userAgent: context.userAgent ?? null
      });
    },

    async listReports(user: SupportServiceUser, filter: { status?: string }) {
      assertSuperAdmin(user);
      return options.repository.listReports(filter);
    },

    async getReport(user: SupportServiceUser, id: string) {
      assertSuperAdmin(user);
      const report = await options.repository.findReportById(id);
      if (!report) {
        throw new ApiError(404, "NOT_FOUND", "Report not found.");
      }
      return report;
    },

    async updateReport(user: SupportServiceUser, id: string, patch: Record<string, any>) {
      assertSuperAdmin(user);
      const resolvedStatuses = ["RESOLVED", "WONT_FIX"];
      if (patch.status && resolvedStatuses.includes(patch.status)) {
        patch = { ...patch, resolvedAt: now(), resolvedByAdminUserId: user.id };
      }
      return options.repository.updateReport(id, patch);
    }
  };
}
