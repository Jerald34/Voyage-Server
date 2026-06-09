import { describe, expect, it } from "vitest";
import { truncateToPeriod, bucketSeries, rollupBy, type UsageRow } from "../src/modules/admin/usageAggregations";

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  usageUserId: "u1", userLabel: "Ana", agencyId: "ag1", agencyLabel: "Alpha",
  createdAt: new Date("2026-06-01T10:00:00Z"),
  promptTokens: 100, outputTokens: 40, totalTokens: 140, cachedTokens: 20, costUsd: 0.003,
  ...over
});

describe("truncateToPeriod", () => {
  it("truncates to UTC day/week(Mon)/month", () => {
    const d = new Date("2026-06-03T15:30:00Z"); // Wednesday
    expect(truncateToPeriod(d, "day").toISOString()).toBe("2026-06-03T00:00:00.000Z");
    expect(truncateToPeriod(d, "week").toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(truncateToPeriod(d, "month").toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("bucketSeries", () => {
  it("groups rows into period buckets with summed metrics, sorted ascending", () => {
    const series = bucketSeries(
      [row(), row({ createdAt: new Date("2026-06-02T01:00:00Z"), totalTokens: 10, costUsd: 0.001 })],
      "day"
    );
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ bucket: "2026-06-01", totalTokens: 140 });
    expect(series[1]).toMatchObject({ bucket: "2026-06-02", totalTokens: 10 });
  });
});

describe("rollupBy", () => {
  it("rolls up per user with totals and run counts", () => {
    const rows = rollupBy([row(), row({ totalTokens: 60, costUsd: 0.002 })], "user");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "u1", label: "Ana", totalTokens: 200, runCount: 2 });
    expect(rows[0].costUsd).toBeCloseTo(0.005, 6);
  });

  it("buckets null agency under a 'Personal' rollup key", () => {
    const rows = rollupBy([row({ agencyId: null, agencyLabel: null })], "agency");
    expect(rows[0].id).toBe("__personal__");
    expect(rows[0].label).toMatch(/personal/i);
  });
});
