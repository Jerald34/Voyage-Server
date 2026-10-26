export type UsageRange = "this_month" | "last_month" | "7d" | "30d";

export interface ResolvedUsageRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  /** The comparison window: same length, just before (or the same stretch of last month). */
  previousFrom: Date;
  previousTo: Date;
  /** Only "this month" gets a month-end projection. */
  projectMonth: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1));

// All boundaries are UTC days, matching how the series is bucketed.
export function resolveUsageRange(range: UsageRange, now: Date): ResolvedUsageRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startOfToday = Date.UTC(y, m, now.getUTCDate());

  if (range === "this_month") {
    const from = monthStart(y, m);
    const previousFrom = monthStart(y, m - 1);
    const elapsed = now.getTime() - from.getTime();
    const previousTo = new Date(Math.min(previousFrom.getTime() + elapsed, from.getTime()));
    return { from, to: now, previousFrom, previousTo, projectMonth: true };
  }

  if (range === "last_month") {
    return {
      from: monthStart(y, m - 1),
      to: monthStart(y, m),
      previousFrom: monthStart(y, m - 2),
      previousTo: monthStart(y, m - 1),
      projectMonth: false
    };
  }

  const days = range === "7d" ? 7 : 30;
  const from = new Date(startOfToday - (days - 1) * DAY_MS);
  return {
    from,
    to: now,
    // Same length as the current window (which ends mid-day at `now`), so the
    // comparison isn't biased toward looking like a drop.
    previousFrom: new Date(from.getTime() - days * DAY_MS),
    previousTo: new Date(now.getTime() - days * DAY_MS),
    projectMonth: false
  };
}

/** Spend so far scaled to the whole month. Less than a day elapsed counts as one day. */
export function projectMonthEnd(costSoFar: number, monthFrom: Date, now: Date): number {
  const elapsedDays = Math.max((now.getTime() - monthFrom.getTime()) / DAY_MS, 1);
  const daysInMonth = new Date(Date.UTC(monthFrom.getUTCFullYear(), monthFrom.getUTCMonth() + 1, 0)).getUTCDate();
  return (costSoFar / elapsedDays) * daysInMonth;
}
