export type UsageGroupBy = "user" | "agency" | "chat";
export type RoleTag = "OWNER" | "ADMIN" | "STAFF" | "PERSONAL";

/** One metered agent run, already joined with the user, agency and chat it belongs to. */
export interface UsageRunRow {
  runId: string;
  status: "COMPLETED" | "FAILED";
  createdAt: Date;
  usageUserId: string | null;
  userLabel: string | null;
  accountType: string | null;
  /** The user's role in this run's agency, or PERSONAL; null if they have since left. */
  roleTag: RoleTag | null;
  agencyId: string | null;
  agencyLabel: string | null;
  threadId: string;
  threadTitle: string | null;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  costComplete: boolean;
  modelNames: string[];
  unpricedModelNames: string[];
  callCount: number;
}

export interface UsageTotals {
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  totalTokens: number;
  runCount: number;
  failedRunCount: number;
  avgCostPerRun: number;
  avgTokensPerRun: number;
  /** Share of prompt tokens served from cache. */
  cacheHitRate: number;
}

export interface SeriesBucket {
  bucket: string;
  costUsd: number;
  totalTokens: number;
  runCount: number;
  failedRunCount: number;
}

export interface RollupRow {
  id: string;
  label: string;
  /** false for the "no user" / "no agency" groups, which have no id to look up. */
  drillable: boolean;
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  runCount: number;
  failedRunCount: number;
  roleTag?: RoleTag | null;
  accountType?: string | null;
  agencyName?: string | null;
}

/** Id used for rows with no user / no agency. */
export const NO_GROUP_ID = "none";
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function sumTotals(rows: UsageRunRow[]): UsageTotals {
  const t = rows.reduce(
    (a, r) => ({
      costUsd: a.costUsd + r.costUsd,
      promptTokens: a.promptTokens + r.promptTokens,
      outputTokens: a.outputTokens + r.outputTokens,
      thoughtsTokens: a.thoughtsTokens + r.thoughtsTokens,
      cachedTokens: a.cachedTokens + r.cachedTokens,
      totalTokens: a.totalTokens + r.totalTokens,
      runCount: a.runCount + 1,
      failedRunCount: a.failedRunCount + (r.status === "FAILED" ? 1 : 0)
    }),
    { costUsd: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 }
  );
  return {
    ...t,
    avgCostPerRun: t.runCount ? t.costUsd / t.runCount : 0,
    avgTokensPerRun: t.runCount ? t.totalTokens / t.runCount : 0,
    cacheHitRate: t.promptTokens ? t.cachedTokens / t.promptTokens : 0
  };
}

/** One bucket per UTC day from `from` up to (not including) `to`, with empty days as zeros. */
export function dailySeries(rows: UsageRunRow[], from: Date, to: Date): SeriesBucket[] {
  const buckets = new Map<string, SeriesBucket>();
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let day = first; day < to.getTime(); day += DAY_MS) {
    const key = isoDay(day);
    buckets.set(key, { bucket: key, costUsd: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(isoDay(r.createdAt.getTime()));
    if (!b) continue;
    b.costUsd += r.costUsd;
    b.totalTokens += r.totalTokens;
    b.runCount += 1;
    if (r.status === "FAILED") b.failedRunCount += 1;
  }
  return [...buckets.values()];
}

function groupKey(r: UsageRunRow, groupBy: UsageGroupBy): { id: string; label: string } {
  if (groupBy === "user") {
    return r.usageUserId ? { id: r.usageUserId, label: r.userLabel ?? "Unknown user" } : { id: NO_GROUP_ID, label: "Unknown user" };
  }
  if (groupBy === "agency") {
    return r.agencyId ? { id: r.agencyId, label: r.agencyLabel ?? "Unknown agency" } : { id: NO_GROUP_ID, label: "Personal / no agency" };
  }
  return { id: r.threadId, label: r.threadTitle ?? "Untitled chat" };
}

export function rollup(rows: UsageRunRow[], groupBy: UsageGroupBy): RollupRow[] {
  const groups = new Map<string, { row: RollupRow; spendByAgency: Map<string, { cost: number; roleTag: RoleTag | null; agencyName: string | null }> }>();

  for (const r of rows) {
    const { id, label } = groupKey(r, groupBy);
    let g = groups.get(id);
    if (!g) {
      g = {
        row: {
          id,
          label,
          drillable: id !== NO_GROUP_ID,
          costUsd: 0,
          totalTokens: 0,
          promptTokens: 0,
          outputTokens: 0,
          runCount: 0,
          failedRunCount: 0,
          ...(groupBy === "user" ? { accountType: r.accountType } : {}),
          ...(groupBy === "chat" ? { agencyName: r.agencyLabel } : {})
        },
        spendByAgency: new Map()
      };
      groups.set(id, g);
    }
    g.row.costUsd += r.costUsd;
    g.row.totalTokens += r.totalTokens;
    g.row.promptTokens += r.promptTokens;
    g.row.outputTokens += r.outputTokens;
    g.row.runCount += 1;
    if (r.status === "FAILED") g.row.failedRunCount += 1;

    if (groupBy === "user") {
      const key = r.agencyId ?? NO_GROUP_ID;
      const spend = g.spendByAgency.get(key) ?? { cost: 0, roleTag: r.roleTag, agencyName: r.agencyLabel };
      spend.cost += r.costUsd;
      g.spendByAgency.set(key, spend);
    }
  }

  return [...groups.values()]
    .map(({ row, spendByAgency }) => {
      if (row.accountType === undefined) return row;
      // A person in several agencies is tagged by the one they spent most in.
      const top = [...spendByAgency.values()].sort((a, b) => b.cost - a.cost)[0];
      return { ...row, roleTag: top?.roleTag ?? null, agencyName: top?.agencyName ?? null };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

export function unpricedModels(rows: UsageRunRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.unpricedModelNames))].sort();
}
