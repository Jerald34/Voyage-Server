import { z } from "zod";
import { ApiError } from "../../http/errors";
import { dailySeries, rollup, sumTotals, unpricedModels, type UsageGroupBy, type UsageRunRow } from "./usageAggregations";
import { projectMonthEnd, resolveUsageRange, type UsageRange } from "./usageRange";
import type { UsageCall, UsageRunFilter } from "./usageRepository";

const rangeSchema = z.enum(["this_month", "last_month", "7d", "30d"]);

export const usageQuerySchema = z
  .object({
    range: rangeSchema.optional(),
    groupBy: z.enum(["user", "agency", "chat"]).optional()
  })
  .strict();

export const usageRunsQuerySchema = z
  .object({
    range: rangeSchema.optional(),
    userId: z.string().uuid().optional(),
    agencyId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional()
  })
  .strict()
  .refine((q) => [q.userId, q.agencyId, q.threadId].filter(Boolean).length === 1, {
    message: "Pass exactly one of userId, agencyId or threadId."
  });

export interface UsageServiceRepository {
  listRunUsage(range: { from: Date; to: Date }, options?: { filter?: UsageRunFilter; take?: number }): Promise<UsageRunRow[]>;
  findRunUsage(runId: string): Promise<{ row: UsageRunRow; calls: UsageCall[] } | null>;
  firstMeteredAt(): Promise<Date | null>;
}
export interface UsageServiceUser {
  id: string;
  role: string;
}

const DRILL_IN_LIMIT = 50;

function assertSuperAdmin(user: UsageServiceUser) {
  if (user.role !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Super admin only.");
}

function toRunSummary(r: UsageRunRow) {
  return {
    id: r.runId,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    threadTitle: r.threadTitle,
    userLabel: r.userLabel,
    agencyName: r.agencyLabel,
    modelNames: r.modelNames,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd,
    costComplete: r.costComplete,
    callCount: r.callCount
  };
}

export function createUsageService(options: { repository: UsageServiceRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const { repository } = options;

  return {
    async getUsage(user: UsageServiceUser, params: { range?: UsageRange; groupBy?: UsageGroupBy }) {
      assertSuperAdmin(user);
      const range: UsageRange = params.range ?? "this_month";
      const groupBy: UsageGroupBy = params.groupBy ?? "user";
      const r = resolveUsageRange(range, now());

      const [rows, previousRows, meteredSince] = await Promise.all([
        repository.listRunUsage({ from: r.from, to: r.to }),
        repository.listRunUsage({ from: r.previousFrom, to: r.previousTo }),
        repository.firstMeteredAt()
      ]);
      const totals = sumTotals(rows);
      const previous = sumTotals(previousRows);

      return {
        range,
        groupBy,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        totals,
        previous: { costUsd: previous.costUsd, runCount: previous.runCount, totalTokens: previous.totalTokens },
        projectedMonthEndCostUsd: r.projectMonth ? projectMonthEnd(totals.costUsd, r.from, r.to) : null,
        series: dailySeries(rows, r.from, r.to),
        rows: rollup(rows, groupBy),
        unpricedModels: unpricedModels(rows),
        meteredSince: meteredSince ? meteredSince.toISOString() : null
      };
    },

    async getRuns(user: UsageServiceUser, params: { range?: UsageRange } & UsageRunFilter) {
      assertSuperAdmin(user);
      const r = resolveUsageRange(params.range ?? "this_month", now());
      const filter: UsageRunFilter = params.userId
        ? { userId: params.userId }
        : params.agencyId
          ? { agencyId: params.agencyId }
          : { threadId: params.threadId };
      const rows = await repository.listRunUsage({ from: r.from, to: r.to }, { filter, take: DRILL_IN_LIMIT });
      return { runs: rows.map(toRunSummary) };
    },

    async getRun(user: UsageServiceUser, runId: string) {
      assertSuperAdmin(user);
      const found = await repository.findRunUsage(runId);
      if (!found) throw new ApiError(404, "RUN_NOT_FOUND", "Run not found.");
      return { run: toRunSummary(found.row), calls: found.calls };
    }
  };
}
