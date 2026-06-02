export type UsagePeriod = "day" | "week" | "month";
export type UsageGroupBy = "user" | "agency";

export interface UsageRow {
  usageUserId: string | null;
  userLabel: string | null;
  agencyId: string | null;
  agencyLabel: string | null;
  createdAt: Date;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
}

export interface SeriesBucket {
  bucket: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  runCount: number;
}

export interface RollupRow {
  id: string;
  label: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  runCount: number;
}

export function truncateToPeriod(date: Date, period: UsagePeriod): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === "day") return d;
  if (period === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function bucketSeries(rows: UsageRow[], period: UsagePeriod): SeriesBucket[] {
  const map = new Map<string, SeriesBucket>();
  for (const r of rows) {
    const key = isoDay(truncateToPeriod(r.createdAt, period));
    const b = map.get(key) ?? {
      bucket: key,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      runCount: 0,
    };
    b.promptTokens += r.promptTokens;
    b.outputTokens += r.outputTokens;
    b.totalTokens += r.totalTokens;
    b.cachedTokens += r.cachedTokens;
    b.costUsd += r.costUsd;
    b.runCount += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function rollupBy(rows: UsageRow[], groupBy: UsageGroupBy): RollupRow[] {
  const map = new Map<string, RollupRow>();
  for (const r of rows) {
    const id =
      groupBy === "user"
        ? (r.usageUserId ?? "__unknown__")
        : (r.agencyId ?? "__personal__");
    const label =
      groupBy === "user"
        ? (r.userLabel ?? "Unknown user")
        : (r.agencyLabel ?? "Personal / no agency");
    const cur = map.get(id) ?? {
      id,
      label,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      runCount: 0,
    };
    cur.promptTokens += r.promptTokens;
    cur.outputTokens += r.outputTokens;
    cur.totalTokens += r.totalTokens;
    cur.cachedTokens += r.cachedTokens;
    cur.costUsd += r.costUsd;
    cur.runCount += 1;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}
