import { describe, expect, it, vi } from "vitest";
import { createUsageService, type UsageServiceRepository } from "../src/modules/admin/usageService";
import type { UsageRunRow } from "../src/modules/admin/usageAggregations";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const ADMIN = { id: "a", role: "SUPER_ADMIN" };

const row = (over: Partial<UsageRunRow> = {}): UsageRunRow => ({
  runId: "r1", status: "COMPLETED", createdAt: new Date("2026-10-02T10:00:00Z"),
  usageUserId: "u1", userLabel: "Ana", accountType: "AGENCY_USER", roleTag: "STAFF",
  agencyId: "ag1", agencyLabel: "Alpha", threadId: "t1", threadTitle: "Baguio",
  promptTokens: 100, outputTokens: 40, thoughtsTokens: 0, totalTokens: 140, cachedTokens: 20,
  costUsd: 0.5, costComplete: true, modelNames: ["m"], unpricedModelNames: [], callCount: 3,
  userAgentPause: null,
  ...over
});

function makeRepo(current: UsageRunRow[], previous: UsageRunRow[] = []) {
  return {
    listRunUsage: vi.fn(async ({ from }: { from: Date }) => (from.getUTCMonth() === 9 ? current : previous)),
    findRunUsage: vi.fn(async () => null),
    firstMeteredAt: vi.fn(async () => new Date("2026-06-02T00:00:00Z"))
  } satisfies UsageServiceRepository;
}

describe("usageService.getUsage", () => {
  it("rejects non-super-admins", async () => {
    const svc = createUsageService({ repository: makeRepo([]), now: () => NOW });
    await expect(svc.getUsage({ id: "x", role: "USER" }, {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it("defaults to this month by user, with comparison, projection, series, rows and metered-since", async () => {
    const repo = makeRepo([row(), row({ runId: "r2", status: "FAILED", costUsd: 0.25, unpricedModelNames: ["x"] })], [row({ costUsd: 1 })]);
    const svc = createUsageService({ repository: repo, now: () => NOW });

    const res = await svc.getUsage(ADMIN, {});

    expect(res).toMatchObject({ range: "this_month", groupBy: "user", from: "2026-10-01T00:00:00.000Z", to: NOW.toISOString() });
    expect(res.totals).toMatchObject({ costUsd: 0.75, runCount: 2, failedRunCount: 1 });
    expect(res.previous).toEqual({ costUsd: 1, runCount: 1, totalTokens: 140 });
    expect(res.projectedMonthEndCostUsd).toBeCloseTo((0.75 / 24.5) * 31, 6);
    expect(res.series).toHaveLength(25);
    expect(res.rows[0]).toMatchObject({ id: "u1", runCount: 2 });
    expect(res.unpricedModels).toEqual(["x"]);
    expect(res.meteredSince).toBe("2026-06-02T00:00:00.000Z");
  });

  it("has no projection outside this month", async () => {
    const svc = createUsageService({ repository: makeRepo([]), now: () => NOW });
    expect((await svc.getUsage(ADMIN, { range: "7d" })).projectedMonthEndCostUsd).toBeNull();
  });
});

describe("usageService.getRuns / getRun", () => {
  it("lists a drill-in's runs newest first, at most 50", async () => {
    const repo = makeRepo([row()]);
    const svc = createUsageService({ repository: repo, now: () => NOW });

    const res = await svc.getRuns(ADMIN, { range: "this_month", threadId: "t1" });

    expect(repo.listRunUsage).toHaveBeenCalledWith(expect.anything(), { filter: { threadId: "t1" }, take: 50 });
    expect(res.runs[0]).toEqual({
      id: "r1", createdAt: "2026-10-02T10:00:00.000Z", status: "COMPLETED", threadTitle: "Baguio", userLabel: "Ana",
      agencyName: "Alpha", modelNames: ["m"], totalTokens: 140, costUsd: 0.5, costComplete: true, callCount: 3
    });
  });

  it("404s an unknown run", async () => {
    const svc = createUsageService({ repository: makeRepo([]), now: () => NOW });
    await expect(svc.getRun(ADMIN, "r9")).rejects.toMatchObject({ statusCode: 404, code: "RUN_NOT_FOUND" });
  });
});
