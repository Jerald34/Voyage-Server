import { describe, expect, it } from "vitest";
import { repriceUsageDetail } from "../src/modules/agent/repriceRunUsage";
import type { UsageEntry } from "../src/modules/agent/agentRunUsage";

const entry = (over: Partial<UsageEntry> = {}): UsageEntry => ({
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

describe("repriceUsageDetail", () => {
  it("prices a call with the current table: uncached input, cached input at its own rate, output plus thinking", () => {
    const r = repriceUsageDetail([entry()]);
    // 400 uncached * $0.50/M + 600 cached * $0.05/M + (100 + 50) output * $3/M
    expect(r.detail[0].costUsd).toBeCloseTo(0.0002 + 0.00003 + 0.00045, 10);
    expect(r.costUsd).toBeCloseTo(0.00068, 10);
    expect(r.costComplete).toBe(true);
    expect(r.modelName).toBe("gemini-3-flash-preview");
    expect(r.unpricedModels).toEqual([]);
  });

  it("bills thinking tokens exactly once (outputTokens already excludes them, totalTokens is ignored)", () => {
    const withThinking = repriceUsageDetail([entry({ cachedTokens: 0, thoughtsTokens: 1_000_000, outputTokens: 0, promptTokens: 0 })]);
    expect(withThinking.costUsd).toBeCloseTo(3, 10);
    const noThinking = repriceUsageDetail([entry({ cachedTokens: 0, thoughtsTokens: 0, outputTokens: 1_000_000, promptTokens: 0 })]);
    expect(noThinking.costUsd).toBeCloseTo(3, 10);
    // a wildly wrong totalTokens must not change the price
    const bogusTotal = repriceUsageDetail([entry({ totalTokens: 99_999_999 })]);
    expect(bogusTotal.costUsd).toBeCloseTo(repriceUsageDetail([entry()]).costUsd, 12);
  });

  it("replaces a stale zero cost on a priced model and sums across calls", () => {
    const r = repriceUsageDetail([
      entry({ callIndex: 0, costUsd: 0 }),
      entry({ callIndex: 1, phase: "synthesis", costUsd: 0.5 })
    ]);
    expect(r.detail.map((e) => e.costUsd)).toEqual([r.detail[0].costUsd, r.detail[0].costUsd]);
    expect(r.detail[0].costUsd).toBeGreaterThan(0);
    expect(r.costUsd).toBeCloseTo(2 * (r.detail[0].costUsd as number), 12);
    expect(r.detail.map((e) => e.phase)).toEqual(["loop", "synthesis"]);
  });

  it("records an unpriced model as null and marks the run incomplete", () => {
    const r = repriceUsageDetail([entry({ modelName: "gemini-2.5-flash", costUsd: 0 })]);
    expect(r.detail[0].costUsd).toBeNull();
    expect(r.costUsd).toBe(0);
    expect(r.costComplete).toBe(false);
    expect(r.modelName).toBe("gemini-2.5-flash");
    expect(r.unpricedModels).toEqual(["gemini-2.5-flash"]);
  });

  it("sums only the priced calls of a mixed run and reports the unpriced model once", () => {
    const r = repriceUsageDetail([
      entry({ callIndex: 0 }),
      entry({ callIndex: 1, modelName: "mystery-model" }),
      entry({ callIndex: 2, modelName: "mystery-model" })
    ]);
    expect(r.detail.map((e) => e.costUsd === null)).toEqual([false, true, true]);
    expect(r.costUsd).toBeCloseTo(r.detail[0].costUsd as number, 12);
    expect(r.costComplete).toBe(false);
    expect(r.unpricedModels).toEqual(["mystery-model"]);
    // most calls were on the unpriced model
    expect(r.modelName).toBe("mystery-model");
  });

  it("picks the most common model for the run, the latest one on a tie", () => {
    const flash = (i: number) => entry({ callIndex: i, modelName: "gemini-3-flash-preview" });
    const lite = (i: number) => entry({ callIndex: i, modelName: "gemini-3.5-flash-lite" });
    expect(repriceUsageDetail([flash(0), flash(1), lite(2)]).modelName).toBe("gemini-3-flash-preview");
    expect(repriceUsageDetail([flash(0), lite(1)]).modelName).toBe("gemini-3.5-flash-lite");
    expect(repriceUsageDetail([lite(0), flash(1)]).modelName).toBe("gemini-3-flash-preview");
  });

  it("returns a complete zero result and no model for an empty detail", () => {
    expect(repriceUsageDetail([])).toEqual({ detail: [], costUsd: 0, costComplete: true, modelName: null, unpricedModels: [] });
  });

  it("treats missing or invalid numbers as 0 and keeps unknown fields", () => {
    const malformed = { modelName: "gemini-3-flash-preview", promptTokens: "lots", outputTokens: null, extra: "keep-me" };
    const r = repriceUsageDetail([malformed]);
    expect(r.detail[0]).toMatchObject({
      callIndex: 0,
      phase: "loop",
      modelName: "gemini-3-flash-preview",
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      costUsd: 0,
      extra: "keep-me"
    });
    expect(r.costComplete).toBe(true);
  });

  it("never lets cached tokens exceed the prompt (no negative uncached cost)", () => {
    const r = repriceUsageDetail([entry({ promptTokens: 100, cachedTokens: 5000, outputTokens: 0, thoughtsTokens: 0 })]);
    // all 100 prompt tokens priced as cached: 100 * $0.05/M
    expect(r.detail[0].costUsd).toBeCloseTo((100 / 1_000_000) * 0.05, 12);
  });

  it("gives an entry without a model name a null cost and does not name the run after it", () => {
    const r = repriceUsageDetail([{ promptTokens: 10, outputTokens: 1 }, entry({ callIndex: 1 })]);
    expect(r.detail[0].costUsd).toBeNull();
    expect(r.detail[0].modelName).toBe("unknown");
    expect(r.costComplete).toBe(false);
    expect(r.modelName).toBe("gemini-3-flash-preview");
    expect(r.unpricedModels).toEqual(["unknown"]);
  });

  it("drops non-object entries and treats a non-array detail as nothing to reprice", () => {
    expect(repriceUsageDetail([null, 7, "x", entry()]).detail).toHaveLength(1);
    expect(repriceUsageDetail(null)).toBeNull();
    expect(repriceUsageDetail({ not: "an array" })).toBeNull();
    expect(repriceUsageDetail("[]")).toBeNull();
  });

  it("is idempotent: repricing its own output changes nothing", () => {
    const once = repriceUsageDetail([entry(), entry({ callIndex: 1, modelName: "gemini-2.5-flash" })]);
    const twice = repriceUsageDetail(once.detail);
    expect(twice).toEqual(once);
  });
});
