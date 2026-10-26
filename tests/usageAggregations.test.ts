import { describe, expect, it } from "vitest";
import { dailySeries, rollup, sumTotals, unpricedModels, type UsageRunRow } from "../src/modules/admin/usageAggregations";

const row = (over: Partial<UsageRunRow> = {}): UsageRunRow => ({
  runId: "r1",
  status: "COMPLETED",
  createdAt: new Date("2026-10-02T10:00:00Z"),
  usageUserId: "u1",
  userLabel: "Ana",
  accountType: "AGENCY_USER",
  roleTag: "STAFF",
  agencyId: "ag1",
  agencyLabel: "Alpha",
  threadId: "t1",
  threadTitle: "Baguio 3D",
  promptTokens: 100,
  outputTokens: 40,
  thoughtsTokens: 10,
  totalTokens: 150,
  cachedTokens: 50,
  costUsd: 0.01,
  costComplete: true,
  modelNames: ["gemini-3.5-flash-lite"],
  unpricedModelNames: [],
  callCount: 2,
  userAgentPause: null,
  userIsSuperAdmin: false,
  ...over
});

describe("sumTotals", () => {
  it("adds up cost, tokens and runs, and derives the health numbers", () => {
    const t = sumTotals([row(), row({ runId: "r2", status: "FAILED", costUsd: 0.03, totalTokens: 250, promptTokens: 300, cachedTokens: 0 })]);
    expect(t).toMatchObject({ totalTokens: 400, promptTokens: 400, cachedTokens: 50, runCount: 2, failedRunCount: 1 });
    expect(t.costUsd).toBeCloseTo(0.04, 9);
    expect(t.avgCostPerRun).toBeCloseTo(0.02, 9);
    expect(t.avgTokensPerRun).toBe(200);
    expect(t.cacheHitRate).toBeCloseTo(50 / 400, 9);
  });

  it("is all zero for no runs (no division by zero)", () => {
    expect(sumTotals([])).toMatchObject({ runCount: 0, avgCostPerRun: 0, avgTokensPerRun: 0, cacheHitRate: 0 });
  });
});

describe("dailySeries", () => {
  it("has one bucket per UTC day in range, zero-filled", () => {
    const s = dailySeries(
      [row(), row({ runId: "r2", status: "FAILED", createdAt: new Date("2026-10-04T23:59:00Z") })],
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-04T12:00:00Z")
    );
    expect(s.map((b) => b.bucket)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(s[0]).toEqual({ bucket: "2026-10-01", costUsd: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 });
    expect(s[1]).toMatchObject({ costUsd: 0.01, runCount: 1, failedRunCount: 0 });
    expect(s[3]).toMatchObject({ runCount: 1, failedRunCount: 1 });
  });

  it("does not add a bucket for an exclusive end at midnight", () => {
    const s = dailySeries([], new Date("2026-09-01T00:00:00Z"), new Date("2026-09-03T00:00:00Z"));
    expect(s.map((b) => b.bucket)).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

describe("rollup", () => {
  it("by user: tags each person with their role in the agency they spent most in", () => {
    const rows = rollup(
      [
        row({ costUsd: 0.01, agencyId: "ag1", agencyLabel: "Alpha", roleTag: "STAFF" }),
        row({ runId: "r2", costUsd: 0.05, agencyId: "ag2", agencyLabel: "Beta", roleTag: "OWNER" }),
        row({ runId: "r3", usageUserId: "u2", userLabel: "Ben", accountType: "PERSONAL", roleTag: "PERSONAL", agencyId: null, agencyLabel: null, costUsd: 0.02 })
      ],
      "user"
    );
    expect(rows[0]).toMatchObject({ id: "u1", label: "Ana", runCount: 2, roleTag: "OWNER", agencyName: "Beta", drillable: true });
    expect(rows[0].costUsd).toBeCloseTo(0.06, 9);
    expect(rows[1]).toMatchObject({ id: "u2", label: "Ben", roleTag: "PERSONAL", agencyName: null });
  });

  it("by agency: runs without an agency group as personal and can't be drilled into", () => {
    const rows = rollup([row(), row({ runId: "r2", agencyId: null, agencyLabel: null, costUsd: 0.5 })], "agency");
    expect(rows[0]).toMatchObject({ id: "none", label: "Personal / no agency", drillable: false });
    expect(rows[1]).toMatchObject({ id: "ag1", label: "Alpha", drillable: true });
  });

  it("by chat: groups by thread with its title and agency", () => {
    const rows = rollup([row(), row({ runId: "r2" }), row({ runId: "r3", threadId: "t2", threadTitle: null })], "chat");
    expect(rows.find((r) => r.id === "t1")).toMatchObject({ label: "Baguio 3D", agencyName: "Alpha", runCount: 2 });
    expect(rows.find((r) => r.id === "t2")).toMatchObject({ label: "Untitled chat" });
  });

  it("counts failed runs per row and sorts by cost, highest first", () => {
    const rows = rollup([row({ costUsd: 0.01 }), row({ runId: "r2", usageUserId: "u2", userLabel: "Ben", costUsd: 0.2, status: "FAILED" })], "user");
    expect(rows.map((r) => r.id)).toEqual(["u2", "u1"]);
    expect(rows[0].failedRunCount).toBe(1);
  });

  it("labels runs with no user as unknown and not drillable", () => {
    const rows = rollup([row({ usageUserId: null, userLabel: null })], "user");
    expect(rows[0]).toMatchObject({ id: "none", label: "Unknown user", drillable: false });
  });
});

describe("rollup agentPause", () => {
  it("carries the user's active pause onto their row", () => {
    const pause = { pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "x" };
    const rows = rollup([row({ userAgentPause: pause })], "user");
    expect(rows[0].agentPause).toEqual(pause);
  });

  it("is null for a user who is not paused, and absent from agency and chat rows", () => {
    expect(rollup([row()], "user")[0].agentPause).toBeNull();
    const pause = { pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "x" };
    expect(rollup([row({ userAgentPause: pause })], "agency")[0]).not.toHaveProperty("agentPause");
    expect(rollup([row({ userAgentPause: pause })], "chat")[0]).not.toHaveProperty("agentPause");
  });
});

describe("rollup isSuperAdmin", () => {
  it("flags a super admin's user row, and is absent from agency and chat rows", () => {
    expect(rollup([row({ userIsSuperAdmin: true })], "user")[0].isSuperAdmin).toBe(true);
    expect(rollup([row()], "user")[0].isSuperAdmin).toBe(false);
    expect(rollup([row({ userIsSuperAdmin: true })], "agency")[0]).not.toHaveProperty("isSuperAdmin");
    expect(rollup([row({ userIsSuperAdmin: true })], "chat")[0]).not.toHaveProperty("isSuperAdmin");
  });
});

describe("unpricedModels", () => {
  it("lists each unpriced model once", () => {
    expect(
      unpricedModels([row({ unpricedModelNames: ["x-model"] }), row({ runId: "r2", unpricedModelNames: ["x-model", "y-model"] })])
    ).toEqual(["x-model", "y-model"]);
  });
});
