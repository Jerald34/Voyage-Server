import { describe, expect, it } from "vitest";
import { usageEntryFromModel, summarizeUsage } from "../src/modules/agent/agentRunUsage";

const model = (over = {}) => ({
  model: "gemini-3-flash-preview",
  promptTokenCount: 100,
  candidatesTokenCount: 40,
  totalTokenCount: 140,
  cachedContentTokenCount: 20,
  thoughtsTokenCount: 5,
  estimatedCostUsd: { prompt: 0.001, output: 0.002, total: 0.003 },
  ...over
});

describe("usageEntryFromModel", () => {
  it("maps a ModelUsage into a normalized entry, coalescing missing fields to 0", () => {
    const e = usageEntryFromModel(2, "synthesis", model({ thoughtsTokenCount: undefined }));
    expect(e).toMatchObject({
      callIndex: 2, phase: "synthesis", modelName: "gemini-3-flash-preview",
      promptTokens: 100, outputTokens: 40, totalTokens: 140, cachedTokens: 20,
      thoughtsTokens: 0, costUsd: 0.003
    });
  });
});

describe("summarizeUsage", () => {
  it("returns all-zero totals and empty detail for no entries", () => {
    expect(summarizeUsage([])).toMatchObject({
      promptTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0,
      thoughtsTokens: 0, costUsd: 0, calls: 0, detail: []
    });
  });

  it("sums tokens and cost across calls", () => {
    const entries = [
      usageEntryFromModel(0, "loop", model()),
      usageEntryFromModel(1, "synthesis", model({ promptTokenCount: 50, totalTokenCount: 90, candidatesTokenCount: 40, estimatedCostUsd: { prompt: 0, output: 0, total: 0.001 } }))
    ];
    const s = summarizeUsage(entries);
    expect(s.promptTokens).toBe(150);
    expect(s.outputTokens).toBe(80);
    expect(s.totalTokens).toBe(230);
    expect(s.cachedTokens).toBe(40);
    expect(s.costUsd).toBeCloseTo(0.004, 6);
    expect(s.calls).toBe(2);
    expect(s.detail).toHaveLength(2);
  });
});
