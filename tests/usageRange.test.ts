import { describe, expect, it } from "vitest";
import { projectMonthEnd, resolveUsageRange } from "../src/modules/admin/usageRange";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const iso = (d: Date) => d.toISOString();

describe("resolveUsageRange", () => {
  it("this month: from the 1st to now, compared with the same stretch of last month", () => {
    const r = resolveUsageRange("this_month", NOW);
    expect(iso(r.from)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(r.to)).toBe(iso(NOW));
    expect(iso(r.previousFrom)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-09-25T12:00:00.000Z");
    expect(r.projectMonth).toBe(true);
  });

  it("this month never compares past the end of last month", () => {
    const r = resolveUsageRange("this_month", new Date("2026-03-31T12:00:00.000Z"));
    expect(iso(r.previousTo)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("last month: the whole calendar month, compared with the month before", () => {
    const r = resolveUsageRange("last_month", NOW);
    expect(iso(r.from)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(r.previousFrom)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-09-01T00:00:00.000Z");
    expect(r.projectMonth).toBe(false);
  });

  it("7 days: today plus the 6 days before, compared with the 7 days before that", () => {
    const r = resolveUsageRange("7d", NOW);
    expect(iso(r.from)).toBe("2026-10-19T00:00:00.000Z");
    expect(iso(r.to)).toBe(iso(NOW));
    expect(iso(r.previousFrom)).toBe("2026-10-12T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-10-19T00:00:00.000Z");
  });

  it("30 days", () => {
    const r = resolveUsageRange("30d", NOW);
    expect(iso(r.from)).toBe("2026-09-26T00:00:00.000Z");
    expect(iso(r.previousFrom)).toBe("2026-08-27T00:00:00.000Z");
  });
});

describe("projectMonthEnd", () => {
  it("extrapolates spend so far to the whole month", () => {
    // 24.5 days into a 31-day month
    expect(projectMonthEnd(4.9, new Date("2026-10-01T00:00:00.000Z"), NOW)).toBeCloseTo((4.9 / 24.5) * 31, 6);
  });

  it("treats less than a day as one day so the first hours don't explode", () => {
    expect(projectMonthEnd(1, new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-01T02:00:00.000Z"))).toBeCloseTo(31, 6);
  });
});
