import { z } from "zod";
import { ApiError } from "../../http/errors";
import { bucketSeries, rollupBy, type UsageRow, type UsagePeriod, type UsageGroupBy } from "./usageAggregations";

export const usageQuerySchema = z.object({
  period: z.enum(["day", "week", "month"]).optional(),
  groupBy: z.enum(["user", "agency"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
});

export interface UsageServiceRepository {
  listRunUsage(range: { from: Date; to: Date }): Promise<UsageRow[]>;
}
export interface UsageServiceUser { id: string; role: string }

export function createUsageService(options: { repository: UsageServiceRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  return {
    async getUsage(user: UsageServiceUser, params: { period?: UsagePeriod; groupBy?: UsageGroupBy; from?: string; to?: string }) {
      if (user.role !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Super admin only.");
      const period: UsagePeriod = params.period ?? "day";
      const groupBy: UsageGroupBy = params.groupBy ?? "user";
      const to = params.to ? new Date(params.to) : now();
      const from = params.from ? new Date(params.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const rows = await options.repository.listRunUsage({ from, to });
      const series = bucketSeries(rows, period);
      const grouped = rollupBy(rows, groupBy);
      const totals = grouped.reduce(
        (a, r) => ({
          promptTokens: a.promptTokens + r.promptTokens, outputTokens: a.outputTokens + r.outputTokens,
          totalTokens: a.totalTokens + r.totalTokens, cachedTokens: a.cachedTokens + r.cachedTokens,
          costUsd: a.costUsd + r.costUsd, runCount: a.runCount + r.runCount
        }),
        { promptTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, costUsd: 0, runCount: 0 }
      );
      return { period, groupBy, from, to, series, rows: grouped, totals };
    }
  };
}
