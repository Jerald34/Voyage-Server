import { describe, expect, it, vi } from "vitest";
import { agentLogger } from "../src/modules/agent/agentLogger";

describe("agentLogger", () => {
  it("prints model usage next to the model output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    agentLogger.modelOutput("run-123", "Working on that now.", {
      model: "gemini-3-flash-preview",
      promptTokenCount: 1000,
      candidatesTokenCount: 500,
      totalTokenCount: 1500,
      cachedContentTokenCount: 20,
      toolUsePromptTokenCount: 15,
      thoughtsTokenCount: 40,
      trafficType: "ON_DEMAND",
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 980 }],
      cacheTokensDetails: [{ modality: "TEXT", tokenCount: 20 }],
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 500 }],
      estimatedCostUsd: {
        prompt: 0.0005,
        output: 0.0015,
        total: 0.002
      }
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = String(logSpy.mock.calls[0][0]);
    expect(logged).toContain("[Model Output]");
    expect(logged).toContain("--- USAGE START ---");
    expect(logged).toContain('"model": "gemini-3-flash-preview"');
    expect(logged).toContain('"prompt": "$0.000500"');
    expect(logged).toContain('"cachedContentTokenCount": 20');
    expect(logged).toContain('"toolUsePromptTokenCount": 15');
    expect(logged).toContain('"trafficType": "ON_DEMAND"');
    expect(logged).toContain('"total": "$0.002000"');

    logSpy.mockRestore();
  });
});
