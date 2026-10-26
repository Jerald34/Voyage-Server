import type { ModelUsage } from "../../services/modelProvider";

export type UsagePhase = "loop" | "synthesis";

export interface UsageEntry {
  callIndex: number;
  phase: UsagePhase;
  modelName: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  /** null when the model has no price entry. */
  costUsd: number | null;
}

export interface UsageSummary {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  /** Sum of the calls that have a price. */
  costUsd: number;
  /** false when at least one call had no price, so costUsd is an under-count. */
  costComplete: boolean;
  calls: number;
  detail: UsageEntry[];
}

const n = (v: number | undefined | null): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function usageEntryFromModel(callIndex: number, phase: UsagePhase, usage: ModelUsage): UsageEntry {
  return {
    callIndex,
    phase,
    modelName: usage.model,
    promptTokens: n(usage.promptTokenCount),
    outputTokens: n(usage.candidatesTokenCount),
    totalTokens: n(usage.totalTokenCount),
    cachedTokens: n(usage.cachedContentTokenCount),
    thoughtsTokens: n(usage.thoughtsTokenCount),
    costUsd: usage.estimatedCostUsd ? n(usage.estimatedCostUsd.total) : null
  };
}

export function summarizeUsage(detail: UsageEntry[]): UsageSummary {
  return detail.reduce<UsageSummary>(
    (acc, e) => ({
      promptTokens: acc.promptTokens + e.promptTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      totalTokens: acc.totalTokens + e.totalTokens,
      cachedTokens: acc.cachedTokens + e.cachedTokens,
      thoughtsTokens: acc.thoughtsTokens + e.thoughtsTokens,
      costUsd: acc.costUsd + (e.costUsd ?? 0),
      costComplete: acc.costComplete && e.costUsd !== null,
      calls: acc.calls + 1,
      detail: acc.detail
    }),
    { promptTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, thoughtsTokens: 0, costUsd: 0, costComplete: true, calls: 0, detail }
  );
}

/** Mutable accumulator used by the orchestrator across a run's model calls. */
export function createUsageAccumulator() {
  const detail: UsageEntry[] = [];
  return {
    add(phase: UsagePhase, usage: ModelUsage | undefined) {
      if (!usage) return;
      detail.push(usageEntryFromModel(detail.length, phase, usage));
    },
    summary(): UsageSummary {
      return summarizeUsage(detail);
    }
  };
}
