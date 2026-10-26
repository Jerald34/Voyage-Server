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

const isEntryObject = (e: unknown): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e);

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

  const entries = detail.filter(isEntryObject).map(normalizeEntry);

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

/** Numeric fields `normalizeEntry` rewrites when their value is not a usable count. */
const COUNT_FIELDS = ["promptTokens", "outputTokens", "cachedTokens", "thoughtsTokens", "totalTokens"] as const;

/**
 * What `repriceUsageDetail` would silently destroy in a stored detail: entries it drops (not
 * objects) and numeric fields it rewrites (present but not a non-negative finite number, or a
 * call index that is not a non-negative integer). A field that is simply absent or null is not a
 * problem: old rows legitimately lack some of them and read as 0.
 */
export function detailProblems(detail: unknown): { dropped: number; coerced: number } {
  if (!Array.isArray(detail)) return { dropped: 0, coerced: 0 };

  let dropped = 0;
  let coerced = 0;
  for (const raw of detail) {
    if (!isEntryObject(raw)) {
      dropped += 1;
      continue;
    }
    for (const field of COUNT_FIELDS) {
      const value = raw[field];
      if (value !== undefined && value !== null && count(value) !== value) coerced += 1;
    }
    const index = raw.callIndex;
    if (index !== undefined && index !== null && !(typeof index === "number" && Number.isInteger(index) && index >= 0)) coerced += 1;
  }
  return { dropped, coerced };
}
