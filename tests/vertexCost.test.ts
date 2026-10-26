import { describe, expect, it } from "vitest";
import { estimateVertexCost } from "../src/services/modelProvider/vertex";

describe("estimateVertexCost", () => {
  it("prices uncached input, cached input at the cached rate, and output + thinking at the output rate", () => {
    const cost = estimateVertexCost("gemini-3.5-flash-lite", {
      promptTokenCount: 1_000_000,
      cachedContentTokenCount: 500_000,
      candidatesTokenCount: 100_000,
      thoughtsTokenCount: 100_000
    });
    // input: 0.5M × $0.30 + 0.5M × $0.03 = 0.15 + 0.015; output: 0.2M × $2.50 = 0.5
    expect(cost!.promptCost).toBeCloseTo(0.165, 9);
    expect(cost!.outputCost).toBeCloseTo(0.5, 9);
    expect(cost!.totalCost).toBeCloseTo(0.665, 9);
  });

  it("treats missing cached and thinking counts as zero", () => {
    const cost = estimateVertexCost("gemini-3-flash-preview", { promptTokenCount: 2_000_000, candidatesTokenCount: 1_000_000 });
    expect(cost!.totalCost).toBeCloseTo(1 + 3, 9);
  });

  it("returns undefined for a model with no price, so callers can flag it", () => {
    expect(estimateVertexCost("gemini-9-ultra", { promptTokenCount: 10, candidatesTokenCount: 10 })).toBeUndefined();
  });

  it("returns undefined without usage counts", () => {
    expect(estimateVertexCost("gemini-3.5-flash-lite", undefined)).toBeUndefined();
    expect(estimateVertexCost("gemini-3.5-flash-lite", { promptTokenCount: 10 })).toBeUndefined();
  });
  it("prices gemini-2.5-flash, which older runs used", () => {
    const cost = estimateVertexCost("gemini-2.5-flash", {
      promptTokenCount: 1_000_000,
      cachedContentTokenCount: 500_000,
      candidatesTokenCount: 100_000,
      thoughtsTokenCount: 100_000
    });
    // input: 0.5M × $0.30 + 0.5M × $0.03; output: 0.2M × $2.50
    expect(cost!.totalCost).toBeCloseTo(0.665, 9);
  });
});
