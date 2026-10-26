import { estimateVertexCost } from "../../services/modelProvider/vertex";
import { summarizeUsage, type UsageEntry, type UsagePhase } from "./agentRunUsage";

export interface RepricedUsage {
  /** Every call with its cost recomputed from the current price table (null when the model is unpriced). */
  detail: UsageEntry[];
  /** Sum of the calls that have a price. */
  costUsd: number;
  /** false when at least one call's model has no price, so costUsd under-counts. */
  costComplete: boolean;
  /** The model the run's calls used (most common, latest on a tie); null when no call names one. */
  modelName: string | null;
  /** Distinct model names that had no price, in first-seen order. */
  unpricedModels: string[];
}

const UNKNOWN_MODEL = "unknown";

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function normalizeEntry(raw: Record<string, unknown>, index: number): UsageEntry {
  const promptTokens = count(raw.promptTokens);
  const outputTokens = count(raw.outputTokens);
  const cachedTokens = count(raw.cachedTokens);
  const thoughtsTokens = count(raw.thoughtsTokens);
  const modelName = typeof raw.modelName === "string" && raw.modelName.trim() ? raw.modelName : UNKNOWN_MODEL;
  const phase: UsagePhase = raw.phase === "synthesis" ? "synthesis" : "loop";
  const callIndex = typeof raw.callIndex === "number" && Number.isInteger(raw.callIndex) && raw.callIndex >= 0 ? raw.callIndex : index;

  // outputTokens is the candidates count and excludes thinking, so thoughtsTokens is billed
  // exactly once (estimateVertexCost adds it to the output side). totalTokens is never used.
  const cost = estimateVertexCost(modelName, {
    promptTokenCount: promptTokens,
    candidatesTokenCount: outputTokens,
    cachedContentTokenCount: Math.min(cachedTokens, promptTokens),
    thoughtsTokenCount: thoughtsTokens
  });

  return {
    ...raw,
    callIndex,
    phase,
    modelName,
    promptTokens,
    outputTokens,
    totalTokens: count(raw.totalTokens),
    cachedTokens,
    thoughtsTokens,
    costUsd: cost && Number.isFinite(cost.totalCost) ? cost.totalCost : null
  };
}

function dominantModel(entries: UsageEntry[]): string | null {
  const tally = new Map<string, { calls: number; last: number }>();
  entries.forEach((e, i) => {
    if (e.modelName === UNKNOWN_MODEL) return;
    const seen = tally.get(e.modelName);
    tally.set(e.modelName, { calls: (seen?.calls ?? 0) + 1, last: i });
  });
  let best: string | null = null;
  let bestStats = { calls: 0, last: -1 };
  for (const [name, stats] of tally) {
    if (stats.calls > bestStats.calls || (stats.calls === bestStats.calls && stats.last > bestStats.last)) {
      best = name;
      bestStats = stats;
    }
  }
  return best;
}

/**
 * Recomputes the cost of a run's per-call usage detail from the current price table.
 * Missing or invalid numbers count as 0 and non-object entries are dropped. Returns null when
 * `detail` is not an array (nothing to reprice). Pure and idempotent: repricing its own output
 * returns the same result.
 */
export function repriceUsageDetail(detail: unknown[]): RepricedUsage;
export function repriceUsageDetail(detail: unknown): RepricedUsage | null;
export function repriceUsageDetail(detail: unknown): RepricedUsage | null {
  if (!Array.isArray(detail)) return null;

  const entries = detail
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
    .map(normalizeEntry);

  const summary = summarizeUsage(entries);
  const unpricedModels = [...new Set(entries.filter((e) => e.costUsd === null).map((e) => e.modelName))];

  return {
    detail: entries,
    costUsd: summary.costUsd,
    costComplete: summary.costComplete,
    modelName: dominantModel(entries),
    unpricedModels
  };
}
