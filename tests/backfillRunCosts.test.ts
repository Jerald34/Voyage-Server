import { describe, expect, it, vi } from "vitest";
import {
  assertApplyAllowed,
  backfillRunCosts,
  databaseHost,
  isLocalHost,
  planRunUpdate,
  type BackfillClient,
  type RunRow
} from "../src/modules/agent/backfillRunCosts";
import { repriceUsageDetail } from "../src/modules/agent/repriceRunUsage";

const call = (over: Record<string, unknown> = {}) => ({
  callIndex: 0,
  phase: "loop",
  modelName: "gemini-3-flash-preview",
  promptTokens: 1000,
  outputTokens: 100,
  totalTokens: 1150,
  cachedTokens: 600,
  thoughtsTokens: 50,
  costUsd: 0,
  ...over
});

const row = (id: string, over: Partial<RunRow> = {}): RunRow => ({
  id,
  createdAt: new Date("2026-10-05T00:00:00Z"),
  updatedAt: new Date("2026-10-06T00:00:00Z"),
  modelName: "gpt-5-mini",
  costUsd: "0.000000",
  costComplete: true,
  usageDetail: [call()],
  ...over
});

/** In-memory stand-in for prisma.agentRun with id-cursor paging. */
function fakeClient(rows: RunRow[]) {
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const target = rows.find((r) => r.id === where.id)!;
    Object.assign(target, data);
    return target;
  });
  const findMany = vi.fn(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
    const sorted = rows.filter((r) => r.usageDetail !== null).sort((a, b) => a.id.localeCompare(b.id));
    const start = args.cursor ? sorted.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0) : 0;
    return sorted.slice(start, start + args.take);
  });
  return { client: { agentRun: { findMany, update } } as unknown as BackfillClient, update, findMany };
}

describe("databaseHost / isLocalHost", () => {
  it("returns the host only, never credentials, port or database", () => {
    expect(databaseHost("postgresql://postgres:s3cret@db.example.com:5432/voyage")).toBe("db.example.com");
    expect(databaseHost("postgresql://postgres:s3cret@localhost:5432/voyage")).toBe("localhost");
    expect(databaseHost("postgresql://u:p@[::1]:5432/voyage")).toBe("[::1]");
    expect(databaseHost("not a url")).toBe("unknown");
  });

  it("treats only loopback names as local", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]"]) expect(isLocalHost(h)).toBe(true);
    for (const h of ["db.example.com", "localhost.evil.com", "10.0.0.5", "unknown"]) expect(isLocalHost(h)).toBe(false);
  });
});

describe("assertApplyAllowed", () => {
  const local = "postgresql://postgres:pw@localhost:5432/voyage";
  const remote = "postgresql://u:pw@db.railway.internal:5432/railway";

  it("never blocks a dry run", () => {
    expect(() => assertApplyAllowed({ databaseUrl: remote, apply: false, allowRemote: false })).not.toThrow();
  });

  it("allows --apply against a local database", () => {
    expect(() => assertApplyAllowed({ databaseUrl: local, apply: true, allowRemote: false })).not.toThrow();
  });

  it("refuses --apply against a remote or unparseable database without --allow-remote, and never leaks the password", () => {
    expect(() => assertApplyAllowed({ databaseUrl: remote, apply: true, allowRemote: false })).toThrow(/db\.railway\.internal/);
    expect(() => assertApplyAllowed({ databaseUrl: remote, apply: true, allowRemote: false })).toThrow(/--allow-remote/);
    expect(() => assertApplyAllowed({ databaseUrl: "garbage", apply: true, allowRemote: false })).toThrow();
    try {
      assertApplyAllowed({ databaseUrl: remote, apply: true, allowRemote: false });
    } catch (e) {
      expect(String(e)).not.toContain("pw");
    }
  });

  it("allows --apply against a remote database with --allow-remote", () => {
    expect(() => assertApplyAllowed({ databaseUrl: remote, apply: true, allowRemote: true })).not.toThrow();
  });
});

describe("planRunUpdate", () => {
  it("reprices a stale zero-cost run and names the real model", () => {
    const plan = planRunUpdate(row("a"))!;
    const expected = repriceUsageDetail([call()]).costUsd;
    expect(plan.changed).toBe(true);
    expect(plan.old).toEqual({ costUsd: 0, costComplete: true, modelName: "gpt-5-mini" });
    expect(plan.next.costUsd).toBeCloseTo(expected, 6);
    expect(plan.next.modelName).toBe("gemini-3-flash-preview");
    expect(plan.data).toMatchObject({ costComplete: true, modelName: "gemini-3-flash-preview" });
  });

  it("only writes cost bookkeeping: no token columns, updatedAt preserved", () => {
    const r = row("a");
    const keys = Object.keys(planRunUpdate(r)!.data).sort();
    expect(keys).toEqual(["costComplete", "costUsd", "modelName", "updatedAt", "usageDetail"]);
    expect(planRunUpdate(r)!.data.updatedAt).toBe(r.updatedAt);
  });

  it("flags an unpriced model as incomplete and lists it", () => {
    const plan = planRunUpdate(row("a", { usageDetail: [call({ modelName: "gemini-9-ultra" }), call({ callIndex: 1, modelName: "gemini-9-ultra" })] }))!;
    expect(plan.next.costComplete).toBe(false);
    expect(plan.next.costUsd).toBe(0);
    expect(plan.unpricedCalls).toEqual({ "gemini-9-ultra": 2 });
  });

  it("reports no change for a run that is already correct", () => {
    const fixed = repriceUsageDetail([call()]);
    const r = row("a", {
      modelName: "gemini-3-flash-preview",
      costUsd: fixed.costUsd.toFixed(6),
      costComplete: true,
      usageDetail: fixed.detail
    });
    expect(planRunUpdate(r)!.changed).toBe(false);
  });

  it("skips runs with no usable detail and keeps the stored model when the detail names none", () => {
    expect(planRunUpdate(row("a", { usageDetail: null }))).toBeNull();
    expect(planRunUpdate(row("a", { usageDetail: [] }))).toBeNull();
    expect(planRunUpdate(row("a", { usageDetail: { not: "an array" } }))).toBeNull();
    expect(planRunUpdate(row("a", { usageDetail: [null, 3] }))).toBeNull();
    const plan = planRunUpdate(row("a", { usageDetail: [{ promptTokens: 5 }] }))!;
    expect(plan.next.modelName).toBe("gpt-5-mini");
    expect(plan.data).not.toHaveProperty("modelName");
  });

  it("accepts a numeric costUsd as well as a Decimal-like one", () => {
    expect(planRunUpdate(row("a", { costUsd: 0 }))!.old.costUsd).toBe(0);
    expect(planRunUpdate(row("a", { costUsd: null }))!.old.costUsd).toBeNull();
  });
});

describe("backfillRunCosts", () => {
  const rows = () => [
    row("r1"),
    row("r2", { usageDetail: [call({ modelName: "gemini-9-ultra" })] }),
    row("r3", { usageDetail: null }),
    row("r4", { usageDetail: [] }),
    row("r5", { usageDetail: [call({ modelName: "gemini-3.5-flash-lite" }), call({ callIndex: 1, phase: "synthesis", modelName: "gemini-3.5-flash-lite" })] })
  ];

  it("dry-run reports the changes and writes nothing", async () => {
    const { client, update } = fakeClient(rows());
    const log = vi.fn();
    const s = await backfillRunCosts(client, { apply: false, log });
    expect(update).not.toHaveBeenCalled();
    expect(s).toMatchObject({ scanned: 3, changed: 3, applied: 0, skippedNoDetail: 1 });
    expect(s.newTotalUsd).toBeGreaterThan(s.oldTotalUsd);
    expect(s.unpricedModels).toEqual({ "gemini-9-ultra": { runs: 1, calls: 1 } });
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0][0]).toContain("r1");
    expect(log.mock.calls[0][0]).toContain("gpt-5-mini -> gemini-3-flash-preview");
  });

  it("--apply writes each changed run once, and a second pass changes nothing", async () => {
    const { client, update } = fakeClient(rows());
    const first = await backfillRunCosts(client, { apply: true });
    expect(first).toMatchObject({ scanned: 3, changed: 3, applied: 3 });
    expect(update).toHaveBeenCalledTimes(3);
    for (const [arg] of update.mock.calls) {
      expect(Object.keys(arg.data)).not.toEqual(expect.arrayContaining(["promptTokens"]));
    }

    update.mockClear();
    const second = await backfillRunCosts(client, { apply: true });
    expect(second).toMatchObject({ scanned: 3, changed: 0, applied: 0 });
    expect(second.oldTotalUsd).toBe(first.newTotalUsd);
    expect(update).not.toHaveBeenCalled();
  });

  it("pages through every run with the id cursor", async () => {
    const many = Array.from({ length: 5 }, (_, i) => row(`r${i}`));
    const { client, findMany } = fakeClient(many);
    const s = await backfillRunCosts(client, { apply: false, batchSize: 2 });
    expect(s.scanned).toBe(5);
    expect(findMany.mock.calls.length).toBe(3);
  });
});
