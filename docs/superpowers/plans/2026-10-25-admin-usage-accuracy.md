# Admin Usage Accuracy + Rebuild Implementation Plan (Part 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recorded agent usage accurate (failed runs, thinking tokens, real prices, real model names, unpriced models flagged) and rebuild the admin Usage tab as layout A: range presets, spend/health cards, zero-filled chart, a Users / Agencies / Chats table, and a drill-in to runs and per-call detail.

**Architecture:** Server fixes land in the agent pipeline (`vertex.ts` pricing, `agentRunUsage.ts`, `agentService.failRun`, run creation). The admin usage module is rewritten as four small units — `usageRange.ts` (date maths), `usageAggregations.ts` (pure totals/series/rollups), `usageRepository.ts` (Prisma reads), `usageService.ts` (orchestration + role check) — behind `GET /admin/usage`, `GET /admin/usage/runs`, `GET /admin/usage/runs/:runId`. Still live queries, no rollup table. The client's `admin/usage/*` components are rewritten around the new response.

**Tech Stack:** Express + Zod + Prisma 7 + Vitest/supertest; Next.js/React + Tailwind + Vitest/Testing Library.

**Spec:** `Voyage-Server/docs/superpowers/specs/2026-10-25-admin-account-actions-usage-agent-pause-design.md` (Part 2).
**Independent of Part 1**, except Task 15 (account panel link), which edits `AccountDetail.jsx` and `accountService.ts` as Part 1 left them. If Part 1 is not merged, skip Task 15 and do it after.

---

## Ground rules

Same as Part 1 (`2026-10-25-admin-account-actions.md`): no branch changes without asking; no `Co-Authored-By`; server tests `npx vitest run tests/<file>`; client tests `npx vitest run --pool=threads tests/<file>`; mock `app/components/icons/index.js` in client tests that render icons; restart the backend after server edits (OneDrive).

**Prices used (Google, Standard tier, checked 2026-10-25 at https://ai.google.dev/gemini-api/docs/pricing):** per 1M tokens — Gemini 3 Flash Preview: input $0.50, cached input $0.05, output $3.00 · Gemini 3.1 Pro Preview (≤200k): $2.00 / $0.20 / $12.00 · Gemini 3.5 Flash-Lite: $0.30 / $0.03 / $2.50. Output prices include thinking tokens.

## File map

**Server (`Voyage-Server/`)**
- Modify `src/services/modelProvider/vertex.ts` — price table with cached rate; thinking tokens billed as output; export `estimateVertexCost`.
- Modify `src/modules/agent/agentRunUsage.ts`, `agentTypes.ts`, `agentRepository.ts`, `agentService.ts`, `agentOrchestrator.ts` — nullable per-call cost, `costComplete`, usage on failed runs, real model name.
- Modify `prisma/schema.prisma` — `AgentRun.costComplete`, index `[status, createdAt]`.
- Create `src/modules/admin/usageRange.ts`.
- Rewrite `src/modules/admin/usageAggregations.ts`, `usageRepository.ts`, `usageService.ts`; modify `adminRoutes.ts`.
- Modify `src/modules/admin/accountService.ts`, `accountRepository.ts` — `usageThisMonth` (Task 15).
- Tests: `tests/vertexCost.test.ts`, `tests/usageRange.test.ts`, `tests/usageRepository.test.ts`, `tests/adminUsageRoutes.test.ts`; rewrite `tests/usageAggregations.test.ts`, `tests/usageService.test.ts`; extend `tests/agentRunUsage.test.ts`, `tests/agentService.test.ts`.

**Client (`Voyage-Client/`)**
- Modify `app/lib/api/admin.js`, `app/lib/api/index.js` — `fetchUsage` (new params), `fetchUsageRuns`, `fetchUsageRun`.
- Create `app/components/admin/usage/usageFormat.js` — shared formatters and labels.
- Rewrite `UsageStatCards.jsx`, `UsageBarChart.jsx`, `UsageTable.jsx`, `UsageSection.jsx`; create `UsageDrillIn.jsx`.
- Modify `app/components/admin/AdminPage.jsx`, `AdminAccountsPage.jsx`, `AccountDetail.jsx` (Task 15).
- Tests: `tests/usage-format.test.js`, `tests/usage-drill-in.test.jsx`; rewrite `tests/usage-stat-cards.test.jsx`, `tests/usage-bar-chart.test.jsx`, `tests/usage-table.test.jsx`, `tests/usage-section.test.jsx`.

---

### Task 0: Baseline

- [ ] Run `npm test` in both repos and `npx tsc --noEmit` in `Voyage-Server`; note pre-existing failures. Later tasks must not add to them.

---

### Task 1: Correct prices, cached rate and thinking tokens

**Files:**
- Modify: `Voyage-Server/src/services/modelProvider/vertex.ts` (price table ~line 22, `estimateVertexCost` ~line 432)
- Test: `Voyage-Server/tests/vertexCost.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/vertexCost.test.ts
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
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/vertexCost.test.ts`
Expected: FAIL — `estimateVertexCost` is not exported.

- [ ] **Step 3: Implement** — replace the price table and `estimateVertexCost`

```ts
// USD per 1M tokens, Standard tier, from https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-25).
// Output prices include thinking tokens. Cached input is the context-caching read rate.
// A model missing here is recorded with a null cost and shown as "unpriced" on the admin Usage tab.
const GOOGLE_VERTEX_MODEL_PRICING: Record<
  string,
  {
    inputPerMillionTokens: number;
    cachedInputPerMillionTokens: number;
    outputPerMillionTokens: number;
  }
> = {
  "gemini-3-flash-preview": { inputPerMillionTokens: 0.5, cachedInputPerMillionTokens: 0.05, outputPerMillionTokens: 3 },
  "gemini-3-pro-preview": { inputPerMillionTokens: 2, cachedInputPerMillionTokens: 0.2, outputPerMillionTokens: 12 },
  "gemini-3.1-pro-preview": { inputPerMillionTokens: 2, cachedInputPerMillionTokens: 0.2, outputPerMillionTokens: 12 },
  "gemini-3.5-flash-lite": { inputPerMillionTokens: 0.3, cachedInputPerMillionTokens: 0.03, outputPerMillionTokens: 2.5 }
};
```

```ts
export function estimateVertexCost(
  model: string,
  usage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      }
    | undefined
) {
  if (!usage) {
    return undefined;
  }

  const pricing = GOOGLE_VERTEX_MODEL_PRICING[model];
  if (!pricing || typeof usage.promptTokenCount !== "number" || typeof usage.candidatesTokenCount !== "number") {
    return undefined;
  }

  // promptTokenCount already includes the cached tokens; price each part at its own rate.
  const cachedTokens = usage.cachedContentTokenCount ?? 0;
  const uncachedPromptTokens = usage.promptTokenCount - cachedTokens;
  const promptCost =
    (uncachedPromptTokens / 1_000_000) * pricing.inputPerMillionTokens +
    (cachedTokens / 1_000_000) * pricing.cachedInputPerMillionTokens;
  // Thinking tokens are billed as output.
  const outputTokens = usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0);
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillionTokens;

  return {
    promptCost,
    outputCost,
    totalCost: promptCost + outputCost
  };
}
```

`toModelUsage` calls `estimateVertexCost(model, usage)` already; the structural parameter type accepts `extractVertexUsage`'s return value.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/vertexCost.test.ts tests/vertexPromptCacheProject.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/modelProvider/vertex.ts tests/vertexCost.test.ts
git commit -m "fix(usage): current Gemini prices, 90% cache discount, bill thinking tokens"
```

---

### Task 2: Unpriced calls are null, runs know if their cost is complete

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma`, `src/modules/agent/agentRunUsage.ts`, `src/modules/agent/agentTypes.ts`, `src/modules/agent/agentRepository.ts`
- Test: `Voyage-Server/tests/agentRunUsage.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/agentRunUsage.test.ts`)

```ts
describe("unpriced calls", () => {
  it("records a call without a price as null cost", () => {
    const e = usageEntryFromModel(0, "loop", model({ model: "mystery-model", estimatedCostUsd: undefined }));
    expect(e.costUsd).toBeNull();
  });

  it("sums known costs and marks the summary incomplete when any call is unpriced", () => {
    const s = summarizeUsage([
      usageEntryFromModel(0, "loop", model()),
      usageEntryFromModel(1, "loop", model({ model: "mystery-model", estimatedCostUsd: undefined }))
    ]);
    expect(s.costUsd).toBeCloseTo(0.003, 9);
    expect(s.costComplete).toBe(false);
  });

  it("is complete when every call is priced, and for no calls", () => {
    expect(summarizeUsage([usageEntryFromModel(0, "loop", model())]).costComplete).toBe(true);
    expect(summarizeUsage([]).costComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/agentRunUsage.test.ts`
Expected: FAIL — `costUsd` is `0`, `costComplete` undefined.

- [ ] **Step 3: Implement `agentRunUsage.ts`**

```ts
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
```

In `usageEntryFromModel` change the last field:

```ts
    costUsd: usage.estimatedCostUsd ? n(usage.estimatedCostUsd.total) : null
```

`summarizeUsage`:

```ts
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
```

- [ ] **Step 4: Schema + migration**

In `model AgentRun`, after `costUsd`:

```prisma
  /// false when some model call in the run had no price, so costUsd under-counts.
  costComplete   Boolean  @default(true)
```

and add to its indexes:

```prisma
  @@index([status, createdAt])
```

Run: `npx prisma migrate dev --name agent_run_cost_complete`
Expected: migration created and applied.

- [ ] **Step 5: Carry `costComplete` to the database**

`agentTypes.ts` — `CompleteRunUsage` gains the flag:

```ts
export interface CompleteRunUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  costUsd: number;
  costComplete: boolean;
  detail: UsageSummary["detail"];
}
```

`agentRepository.ts` — above `createPrismaAgentRepository` (or wherever `toJsonInput` is in scope), add:

```ts
/** The AgentRun usage columns, shared by completed and failed runs. */
function usageColumns(usage: CompleteRunUsage | undefined) {
  if (!usage) return {};
  return {
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    thoughtsTokens: usage.thoughtsTokens,
    costUsd: usage.costUsd,
    costComplete: usage.costComplete,
    usageDetail: toJsonInput(usage.detail)
  };
}
```

and in `completeRunIfOpen` replace the `...(data.usage ? { ... } : {})` block with `...usageColumns(data.usage)`. Import `CompleteRunUsage` from `./agentTypes` if it isn't already.

- [ ] **Step 6: Run tests and types**

Run: `npx vitest run tests/agentRunUsage.test.ts tests/agentService.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` flags a fake repository or fixture building `CompleteRunUsage` without `costComplete`, add `costComplete: true` there.

- [ ] **Step 7: Commit**

```bash
git add prisma src/modules/agent tests/agentRunUsage.test.ts
git commit -m "fix(usage): unpriced calls cost null; runs record whether cost is complete"
```

---

### Task 3: Failed runs record the usage they spent

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentTypes.ts`, `agentRepository.ts`, `agentService.ts`, `agentOrchestrator.ts`
- Test: `Voyage-Server/tests/agentService.test.ts`

- [ ] **Step 1: Write the failing test** (inside `describe("agent service")`)

```ts
  it("stores the usage spent before a run failed", async () => {
    const repository = createMemoryRepository();
    const seen: unknown[] = [];
    const original = repository.failRunIfOpen.bind(repository);
    repository.failRunIfOpen = async (id, data) => {
      seen.push(data.usage);
      return original(id, data);
    };
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    const usage = {
      promptTokens: 900, outputTokens: 40, totalTokens: 940, cachedTokens: 0, thoughtsTokens: 12,
      costUsd: 0.0004, costComplete: true, detail: []
    };

    await service.failRun(run.id, "MODEL_ERROR", "Model request failed.", usage);

    expect(seen).toEqual([usage]);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/agentService.test.ts -t "usage spent before a run failed"`
Expected: FAIL — `seen` is `[undefined]` (and a type error on the 4th argument).

- [ ] **Step 3: Implement**

`agentTypes.ts` — the `failRunIfOpen` data type (~line 333) gains `usage?: CompleteRunUsage;`.

`agentService.ts`:

```ts
    async failRun(runId: string, code: string, message: string, usage?: CompleteRunUsage) {
      const run = await getRun(runId);
      assertRunOpen(run);
      const failedAt = now();
      const failedRun = await options.repository.failRunIfOpen(runId, {
        failedAt,
        errorCode: code,
        errorMessage: message,
        usage
      });
```

(the rest of the method is unchanged; import `CompleteRunUsage` from `./agentTypes` if needed).

`agentRepository.ts` — `failRunIfOpen` writes the same columns:

```ts
        data: {
          status: "FAILED",
          failedAt: data.failedAt,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          ...usageColumns(data.usage)
        }
```

`agentOrchestrator.ts` — the inner helper takes the summary:

```ts
  async function failRun(input: AgentOrchestratorRunInput, error: unknown, usage?: UsageSummary) {
    const details = errorDetails(error);
    agentLogger.error("Agent Run Failed", input.runId, { code: details.code, message: details.message, error });
    await options.agentService.failRun(input.runId, details.code, details.message, usage);
  }
```

Import `type UsageSummary` from `./agentRunUsage`. Then at each of the five `await failRun(input, error);` calls inside `run()` (around lines 472, 511, 746, 937, 1083 — find them with `grep -n "await failRun(input, error)" src/modules/agent/agentOrchestrator.ts`), pass the run's accumulator:

```ts
          await failRun(input, error, usage.summary());
```

`usage` is the `createUsageAccumulator()` created at the top of `run()`; every call site is inside `run()` after it.

- [ ] **Step 4: Run tests and types**

Run: `npx vitest run tests/agentService.test.ts tests/agentOrchestrator && npx tsc --noEmit` (the second argument is a name filter that matches every `agentOrchestrator*` test file)
Expected: PASS (compare against the Task 0 baseline for orchestrator tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent tests/agentService.test.ts
git commit -m "fix(usage): failed runs keep the tokens and cost they spent"
```

---

### Task 4: Runs record the model actually used

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentService.ts`
- Test: `Voyage-Server/tests/agentService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it("records the selected model on new runs when modelInfo is given", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({
      repository,
      modelInfo: () => ({ provider: "vertex", model: "gemini-3.5-flash-lite" })
    });
    const thread = await service.createThread("agency-1", "user-1", { title: "Cebu planning" });

    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

    expect(run).toMatchObject({ modelProvider: "vertex", modelName: "gemini-3.5-flash-lite" });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/agentService.test.ts -t "selected model"`
Expected: FAIL — `modelName` is `gpt-5-mini`.

- [ ] **Step 3: Implement**

In `createAgentService`'s options add:

```ts
  /** Read per run so the stored model matches the provider selection in use. */
  modelInfo?: () => { provider: string; model: string };
```

In `appendUserMessageAndCreateRun`, before `createUserMessageAndRun`:

```ts
      const selected = options.modelInfo?.() ?? { provider: modelProvider, model: modelName };
```

and pass `modelProvider: selected.provider, modelName: selected.model` instead of the two constants.

At the bottom of the file:

```ts
import { getModelProviderInfo } from "../../services/modelProvider";
// ...
export const agentService = createAgentService({
  repository: createPrismaAgentRepository(),
  modelInfo: getModelProviderInfo
});
```

(put the import with the other imports at the top).

- [ ] **Step 4: Run tests and types**

Run: `npx vitest run tests/agentService.test.ts && npx tsc --noEmit`
Expected: PASS. The existing "appends a user message" test still expects `gpt-test` because it passes `modelName` and no `modelInfo`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/agentService.ts tests/agentService.test.ts
git commit -m "fix(usage): store the real model and provider on each run"
```

---

### Task 5: Usage ranges

**Files:**
- Create: `Voyage-Server/src/modules/admin/usageRange.ts`
- Test: `Voyage-Server/tests/usageRange.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/usageRange.test.ts
import { describe, expect, it } from "vitest";
import { projectMonthEnd, resolveUsageRange } from "../src/modules/admin/usageRange";

const NOW = new Date("2026-10-25T12:00:00.000Z");
const iso = (d: Date) => d.toISOString();

describe("resolveUsageRange", () => {
  it("this month: from the 1st to now, compared with the same stretch of last month", () => {
    const r = resolveUsageRange("this_month", NOW);
    expect(iso(r.from)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(r.to)).toBe(iso(NOW));
    expect(iso(r.previousFrom)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-09-25T12:00:00.000Z");
    expect(r.projectMonth).toBe(true);
  });

  it("this month never compares past the end of last month", () => {
    const r = resolveUsageRange("this_month", new Date("2026-03-31T12:00:00.000Z"));
    expect(iso(r.previousTo)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("last month: the whole calendar month, compared with the month before", () => {
    const r = resolveUsageRange("last_month", NOW);
    expect(iso(r.from)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(r.previousFrom)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-09-01T00:00:00.000Z");
    expect(r.projectMonth).toBe(false);
  });

  it("7 days: today plus the 6 days before, compared with the 7 days before that", () => {
    const r = resolveUsageRange("7d", NOW);
    expect(iso(r.from)).toBe("2026-10-19T00:00:00.000Z");
    expect(iso(r.to)).toBe(iso(NOW));
    expect(iso(r.previousFrom)).toBe("2026-10-12T00:00:00.000Z");
    expect(iso(r.previousTo)).toBe("2026-10-19T00:00:00.000Z");
  });

  it("30 days", () => {
    const r = resolveUsageRange("30d", NOW);
    expect(iso(r.from)).toBe("2026-09-26T00:00:00.000Z");
    expect(iso(r.previousFrom)).toBe("2026-08-27T00:00:00.000Z");
  });
});

describe("projectMonthEnd", () => {
  it("extrapolates spend so far to the whole month", () => {
    // 24.5 days into a 31-day month
    expect(projectMonthEnd(4.9, new Date("2026-10-01T00:00:00.000Z"), NOW)).toBeCloseTo((4.9 / 24.5) * 31, 6);
  });

  it("treats less than a day as one day so the first hours don't explode", () => {
    expect(projectMonthEnd(1, new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-01T02:00:00.000Z"))).toBeCloseTo(31, 6);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/usageRange.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/modules/admin/usageRange.ts
export type UsageRange = "this_month" | "last_month" | "7d" | "30d";

export interface ResolvedUsageRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  /** The comparison window: same length, just before (or the same stretch of last month). */
  previousFrom: Date;
  previousTo: Date;
  /** Only "this month" gets a month-end projection. */
  projectMonth: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1));

// All boundaries are UTC days, matching how the series is bucketed.
export function resolveUsageRange(range: UsageRange, now: Date): ResolvedUsageRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startOfToday = Date.UTC(y, m, now.getUTCDate());

  if (range === "this_month") {
    const from = monthStart(y, m);
    const previousFrom = monthStart(y, m - 1);
    const elapsed = now.getTime() - from.getTime();
    const previousTo = new Date(Math.min(previousFrom.getTime() + elapsed, from.getTime()));
    return { from, to: now, previousFrom, previousTo, projectMonth: true };
  }

  if (range === "last_month") {
    return {
      from: monthStart(y, m - 1),
      to: monthStart(y, m),
      previousFrom: monthStart(y, m - 2),
      previousTo: monthStart(y, m - 1),
      projectMonth: false
    };
  }

  const days = range === "7d" ? 7 : 30;
  const from = new Date(startOfToday - (days - 1) * DAY_MS);
  return {
    from,
    to: now,
    previousFrom: new Date(from.getTime() - days * DAY_MS),
    previousTo: from,
    projectMonth: false
  };
}

/** Spend so far scaled to the whole month. Less than a day elapsed counts as one day. */
export function projectMonthEnd(costSoFar: number, monthFrom: Date, now: Date): number {
  const elapsedDays = Math.max((now.getTime() - monthFrom.getTime()) / DAY_MS, 1);
  const daysInMonth = new Date(Date.UTC(monthFrom.getUTCFullYear(), monthFrom.getUTCMonth() + 1, 0)).getUTCDate();
  return (costSoFar / elapsedDays) * daysInMonth;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/usageRange.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/usageRange.ts tests/usageRange.test.ts
git commit -m "feat(usage): range presets with comparison window and month-end projection"
```

---

### Task 6: Aggregations — totals, zero-filled series, rollups

**Files:**
- Rewrite: `Voyage-Server/src/modules/admin/usageAggregations.ts`
- Rewrite: `Voyage-Server/tests/usageAggregations.test.ts`

- [ ] **Step 1: Replace the test file**

```ts
// tests/usageAggregations.test.ts
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

describe("unpricedModels", () => {
  it("lists each unpriced model once", () => {
    expect(
      unpricedModels([row({ unpricedModelNames: ["x-model"] }), row({ runId: "r2", unpricedModelNames: ["x-model", "y-model"] })])
    ).toEqual(["x-model", "y-model"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/usageAggregations.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Replace `usageAggregations.ts`**

```ts
// src/modules/admin/usageAggregations.ts
export type UsageGroupBy = "user" | "agency" | "chat";
export type RoleTag = "OWNER" | "ADMIN" | "STAFF" | "PERSONAL";

/** One metered agent run, already joined with the user, agency and chat it belongs to. */
export interface UsageRunRow {
  runId: string;
  status: "COMPLETED" | "FAILED";
  createdAt: Date;
  usageUserId: string | null;
  userLabel: string | null;
  accountType: string | null;
  /** The user's role in this run's agency, or PERSONAL; null if they have since left. */
  roleTag: RoleTag | null;
  agencyId: string | null;
  agencyLabel: string | null;
  threadId: string;
  threadTitle: string | null;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  cachedTokens: number;
  costUsd: number;
  costComplete: boolean;
  modelNames: string[];
  unpricedModelNames: string[];
  callCount: number;
}

export interface UsageTotals {
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  totalTokens: number;
  runCount: number;
  failedRunCount: number;
  avgCostPerRun: number;
  avgTokensPerRun: number;
  /** Share of prompt tokens served from cache. */
  cacheHitRate: number;
}

export interface SeriesBucket {
  bucket: string;
  costUsd: number;
  totalTokens: number;
  runCount: number;
  failedRunCount: number;
}

export interface RollupRow {
  id: string;
  label: string;
  /** false for the "no user" / "no agency" groups, which have no id to look up. */
  drillable: boolean;
  costUsd: number;
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  runCount: number;
  failedRunCount: number;
  roleTag?: RoleTag | null;
  accountType?: string | null;
  agencyName?: string | null;
}

/** Id used for rows with no user / no agency. */
export const NO_GROUP_ID = "none";
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function sumTotals(rows: UsageRunRow[]): UsageTotals {
  const t = rows.reduce(
    (a, r) => ({
      costUsd: a.costUsd + r.costUsd,
      promptTokens: a.promptTokens + r.promptTokens,
      outputTokens: a.outputTokens + r.outputTokens,
      thoughtsTokens: a.thoughtsTokens + r.thoughtsTokens,
      cachedTokens: a.cachedTokens + r.cachedTokens,
      totalTokens: a.totalTokens + r.totalTokens,
      runCount: a.runCount + 1,
      failedRunCount: a.failedRunCount + (r.status === "FAILED" ? 1 : 0)
    }),
    { costUsd: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 }
  );
  return {
    ...t,
    avgCostPerRun: t.runCount ? t.costUsd / t.runCount : 0,
    avgTokensPerRun: t.runCount ? t.totalTokens / t.runCount : 0,
    cacheHitRate: t.promptTokens ? t.cachedTokens / t.promptTokens : 0
  };
}

/** One bucket per UTC day from `from` up to (not including) `to`, with empty days as zeros. */
export function dailySeries(rows: UsageRunRow[], from: Date, to: Date): SeriesBucket[] {
  const buckets = new Map<string, SeriesBucket>();
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let day = first; day < to.getTime(); day += DAY_MS) {
    const key = isoDay(day);
    buckets.set(key, { bucket: key, costUsd: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(isoDay(r.createdAt.getTime()));
    if (!b) continue;
    b.costUsd += r.costUsd;
    b.totalTokens += r.totalTokens;
    b.runCount += 1;
    if (r.status === "FAILED") b.failedRunCount += 1;
  }
  return [...buckets.values()];
}

function groupKey(r: UsageRunRow, groupBy: UsageGroupBy): { id: string; label: string } {
  if (groupBy === "user") {
    return r.usageUserId ? { id: r.usageUserId, label: r.userLabel ?? "Unknown user" } : { id: NO_GROUP_ID, label: "Unknown user" };
  }
  if (groupBy === "agency") {
    return r.agencyId ? { id: r.agencyId, label: r.agencyLabel ?? "Unknown agency" } : { id: NO_GROUP_ID, label: "Personal / no agency" };
  }
  return { id: r.threadId, label: r.threadTitle ?? "Untitled chat" };
}

export function rollup(rows: UsageRunRow[], groupBy: UsageGroupBy): RollupRow[] {
  const groups = new Map<string, { row: RollupRow; spendByAgency: Map<string, { cost: number; roleTag: RoleTag | null; agencyName: string | null }> }>();

  for (const r of rows) {
    const { id, label } = groupKey(r, groupBy);
    let g = groups.get(id);
    if (!g) {
      g = {
        row: {
          id,
          label,
          drillable: id !== NO_GROUP_ID,
          costUsd: 0,
          totalTokens: 0,
          promptTokens: 0,
          outputTokens: 0,
          runCount: 0,
          failedRunCount: 0,
          ...(groupBy === "user" ? { accountType: r.accountType } : {}),
          ...(groupBy === "chat" ? { agencyName: r.agencyLabel } : {})
        },
        spendByAgency: new Map()
      };
      groups.set(id, g);
    }
    g.row.costUsd += r.costUsd;
    g.row.totalTokens += r.totalTokens;
    g.row.promptTokens += r.promptTokens;
    g.row.outputTokens += r.outputTokens;
    g.row.runCount += 1;
    if (r.status === "FAILED") g.row.failedRunCount += 1;

    if (groupBy === "user") {
      const key = r.agencyId ?? NO_GROUP_ID;
      const spend = g.spendByAgency.get(key) ?? { cost: 0, roleTag: r.roleTag, agencyName: r.agencyLabel };
      spend.cost += r.costUsd;
      g.spendByAgency.set(key, spend);
    }
  }

  return [...groups.values()]
    .map(({ row, spendByAgency }) => {
      if (row.accountType === undefined) return row;
      // A person in several agencies is tagged by the one they spent most in.
      const top = [...spendByAgency.values()].sort((a, b) => b.cost - a.cost)[0];
      return { ...row, roleTag: top?.roleTag ?? null, agencyName: top?.agencyName ?? null };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

export function unpricedModels(rows: UsageRunRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.unpricedModelNames))].sort();
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/usageAggregations.test.ts`
Expected: PASS (11 tests). `usageService.ts`/`usageRepository.ts` won't compile yet — that's Tasks 7–8; don't run `tsc` until then.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/usageAggregations.ts tests/usageAggregations.test.ts
git commit -m "feat(usage): totals, zero-filled daily series and user/agency/chat rollups"
```

---

### Task 7: Repository — joined run rows, drill-in, single run

**Files:**
- Rewrite: `Voyage-Server/src/modules/admin/usageRepository.ts`
- Test: `Voyage-Server/tests/usageRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/usageRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  threadFindMany: vi.fn(),
  userFindMany: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    agentRun: { findMany: m.runFindMany, findUnique: m.runFindUnique, findFirst: m.runFindFirst },
    agentThread: { findMany: m.threadFindMany },
    user: { findMany: m.userFindMany }
  }
}));

import { usageRepository } from "../src/modules/admin/usageRepository";

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-25T12:00:00Z");

const run = (over = {}) => ({
  id: "r1",
  status: "FAILED",
  createdAt: new Date("2026-10-02T10:00:00Z"),
  usageUserId: "u1",
  agencyId: "ag1",
  threadId: "t1",
  promptTokens: 100,
  outputTokens: 40,
  thoughtsTokens: 10,
  totalTokens: 150,
  cachedTokens: 50,
  costUsd: { toString: () => "0.0125" },
  costComplete: false,
  usageDetail: [
    { modelName: "gemini-3.5-flash-lite", costUsd: 0.0125 },
    { modelName: "mystery", costUsd: null }
  ],
  agency: { name: "Alpha" },
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  m.runFindMany.mockResolvedValue([run()]);
  m.threadFindMany.mockResolvedValue([{ id: "t1", title: "Baguio 3D" }]);
  m.userFindMany.mockResolvedValue([
    { id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [{ agencyId: "ag1", role: "OWNER" }] }
  ]);
});

describe("usageRepository.listRunUsage", () => {
  it("reads completed and failed metered runs in range and joins user, role, agency and chat", async () => {
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });

    expect(m.runFindMany.mock.calls[0][0].where).toEqual({
      status: { in: ["COMPLETED", "FAILED"] },
      createdAt: { gte: FROM, lt: TO },
      totalTokens: { not: null }
    });
    expect(rows).toEqual([
      expect.objectContaining({
        runId: "r1",
        status: "FAILED",
        userLabel: "Ana",
        accountType: "AGENCY_USER",
        roleTag: "OWNER",
        agencyLabel: "Alpha",
        threadTitle: "Baguio 3D",
        costUsd: 0.0125,
        costComplete: false,
        modelNames: ["gemini-3.5-flash-lite", "mystery"],
        unpricedModelNames: ["mystery"],
        callCount: 2
      })
    ]);
  });

  it("tags personal accounts PERSONAL and people who left the agency as null", async () => {
    m.runFindMany.mockResolvedValue([run(), run({ id: "r2", usageUserId: "u2", agencyId: null, agency: null })]);
    m.userFindMany.mockResolvedValue([
      { id: "u1", displayName: "Ana", accountType: "AGENCY_USER", memberships: [] },
      { id: "u2", displayName: "Ben", accountType: "PERSONAL", memberships: [] }
    ]);
    const rows = await usageRepository.listRunUsage({ from: FROM, to: TO });
    expect(rows.map((r) => r.roleTag)).toEqual([null, "PERSONAL"]);
  });

  it("filters and limits for a drill-in, newest first", async () => {
    await usageRepository.listRunUsage({ from: FROM, to: TO }, { filter: { threadId: "t1" }, take: 50 });
    const args = m.runFindMany.mock.calls[0][0];
    expect(args.where.threadId).toBe("t1");
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(50);
  });

  it("maps a userId filter onto usageUserId", async () => {
    await usageRepository.listRunUsage({ from: FROM, to: TO }, { filter: { userId: "u1" }, take: 50 });
    expect(m.runFindMany.mock.calls[0][0].where.usageUserId).toBe("u1");
  });
});

describe("usageRepository.findRunUsage", () => {
  it("returns the run row and its per-call detail", async () => {
    m.runFindUnique.mockResolvedValue(
      run({
        usageDetail: [
          { callIndex: 0, phase: "loop", modelName: "gemini-3.5-flash-lite", promptTokens: 10, cachedTokens: 0, outputTokens: 5, thoughtsTokens: 1, totalTokens: 16, costUsd: 0.001 }
        ]
      })
    );
    const result = await usageRepository.findRunUsage("r1");
    expect(result?.row.runId).toBe("r1");
    expect(result?.calls).toEqual([
      { callIndex: 0, phase: "loop", modelName: "gemini-3.5-flash-lite", promptTokens: 10, cachedTokens: 0, outputTokens: 5, thoughtsTokens: 1, totalTokens: 16, costUsd: 0.001 }
    ]);
  });

  it("returns null for an unknown or unmetered run", async () => {
    m.runFindUnique.mockResolvedValue(null);
    expect(await usageRepository.findRunUsage("nope")).toBeNull();
  });
});

describe("usageRepository.firstMeteredAt", () => {
  it("returns the oldest metered run's date", async () => {
    m.runFindFirst.mockResolvedValue({ createdAt: new Date("2026-06-02T00:00:00Z") });
    expect(await usageRepository.firstMeteredAt()).toEqual(new Date("2026-06-02T00:00:00Z"));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/usageRepository.test.ts`
Expected: FAIL — `listRunUsage` signature/shape and the other methods don't exist.

- [ ] **Step 3: Replace `usageRepository.ts`**

```ts
// src/modules/admin/usageRepository.ts
import { prisma } from "../../db/prisma";
import type { RoleTag, UsageRunRow } from "./usageAggregations";

export interface UsageRunFilter {
  userId?: string;
  agencyId?: string;
  threadId?: string;
}

export interface UsageCall {
  callIndex: number;
  phase: string;
  modelName: string;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

const runSelect = {
  id: true,
  status: true,
  createdAt: true,
  usageUserId: true,
  agencyId: true,
  threadId: true,
  promptTokens: true,
  outputTokens: true,
  thoughtsTokens: true,
  totalTokens: true,
  cachedTokens: true,
  costUsd: true,
  costComplete: true,
  usageDetail: true,
  agency: { select: { name: true } }
} as const;

type RunRecord = {
  id: string;
  status: string;
  createdAt: Date;
  usageUserId: string | null;
  agencyId: string | null;
  threadId: string;
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  costUsd: unknown;
  costComplete: boolean;
  usageDetail: unknown;
  agency: { name: string } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const detailEntries = (detail: unknown): Record<string, unknown>[] =>
  Array.isArray(detail) ? detail.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];

/** Joins runs with their chat titles, users and the user's role in the run's agency. */
async function hydrate(runs: RunRecord[]): Promise<UsageRunRow[]> {
  const threadIds = [...new Set(runs.map((r) => r.threadId))];
  const userIds = [...new Set(runs.map((r) => r.usageUserId).filter((id): id is string => !!id))];
  const [threads, users] = await Promise.all([
    threadIds.length ? prisma.agentThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, title: true } }) : [],
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, accountType: true, memberships: { select: { agencyId: true, role: true } } }
        })
      : []
  ]);
  const titleById = new Map(threads.map((t) => [t.id, t.title]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return runs.map((r) => {
    const user = r.usageUserId ? userById.get(r.usageUserId) : undefined;
    let roleTag: RoleTag | null = null;
    if (user?.accountType === "PERSONAL") roleTag = "PERSONAL";
    else if (user && r.agencyId) roleTag = (user.memberships.find((m) => m.agencyId === r.agencyId)?.role as RoleTag | undefined) ?? null;

    const calls = detailEntries(r.usageDetail);
    const modelNames = [...new Set(calls.map((c) => c.modelName).filter((n): n is string => typeof n === "string"))];
    const unpricedModelNames = [
      ...new Set(calls.filter((c) => c.costUsd === null).map((c) => c.modelName).filter((n): n is string => typeof n === "string"))
    ];

    return {
      runId: r.id,
      status: r.status === "FAILED" ? "FAILED" : "COMPLETED",
      createdAt: r.createdAt,
      usageUserId: r.usageUserId,
      userLabel: user?.displayName ?? null,
      accountType: user?.accountType ?? null,
      roleTag,
      agencyId: r.agencyId,
      agencyLabel: r.agency?.name ?? null,
      threadId: r.threadId,
      threadTitle: titleById.get(r.threadId) ?? null,
      promptTokens: r.promptTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      thoughtsTokens: r.thoughtsTokens ?? 0,
      totalTokens: r.totalTokens ?? 0,
      cachedTokens: r.cachedTokens ?? 0,
      costUsd: Number(r.costUsd ?? 0),
      costComplete: r.costComplete,
      modelNames,
      unpricedModelNames,
      callCount: calls.length
    };
  });
}

export const usageRepository = {
  /** Metered runs (completed or failed) created in [from, to). With options: filtered, newest first, limited. */
  async listRunUsage(
    { from, to }: { from: Date; to: Date },
    options: { filter?: UsageRunFilter; take?: number } = {}
  ): Promise<UsageRunRow[]> {
    const { filter = {}, take } = options;
    const runs = await prisma.agentRun.findMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        createdAt: { gte: from, lt: to },
        totalTokens: { not: null },
        ...(filter.userId ? { usageUserId: filter.userId } : {}),
        ...(filter.agencyId ? { agencyId: filter.agencyId } : {}),
        ...(filter.threadId ? { threadId: filter.threadId } : {})
      },
      select: runSelect,
      ...(take ? { orderBy: { createdAt: "desc" as const }, take } : {})
    });
    return hydrate(runs as RunRecord[]);
  },

  async findRunUsage(runId: string): Promise<{ row: UsageRunRow; calls: UsageCall[] } | null> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: runSelect });
    if (!run || run.totalTokens === null) return null;
    const [row] = await hydrate([run as RunRecord]);
    const calls = detailEntries(run.usageDetail).map((c, index) => ({
      callIndex: typeof c.callIndex === "number" ? c.callIndex : index,
      phase: typeof c.phase === "string" ? c.phase : "loop",
      modelName: typeof c.modelName === "string" ? c.modelName : "unknown",
      promptTokens: num(c.promptTokens),
      cachedTokens: num(c.cachedTokens),
      outputTokens: num(c.outputTokens),
      thoughtsTokens: num(c.thoughtsTokens),
      totalTokens: num(c.totalTokens),
      costUsd: c.costUsd === null ? null : num(c.costUsd)
    }));
    return { row: row!, calls };
  },

  /** When usage metering started (the oldest run with token counts). */
  async firstMeteredAt(): Promise<Date | null> {
    const first = await prisma.agentRun.findFirst({
      where: { totalTokens: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    });
    return first?.createdAt ?? null;
  }
};

export type UsageRepository = typeof usageRepository;
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/usageRepository.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/usageRepository.ts tests/usageRepository.test.ts
git commit -m "feat(usage): repository joins runs with users, roles, agencies and chats"
```

---

### Task 8: Service and routes

**Files:**
- Rewrite: `Voyage-Server/src/modules/admin/usageService.ts`
- Modify: `Voyage-Server/src/modules/admin/adminRoutes.ts`
- Rewrite: `Voyage-Server/tests/usageService.test.ts`
- Create: `Voyage-Server/tests/adminUsageRoutes.test.ts`

- [ ] **Step 1: Replace the service test**

```ts
// tests/usageService.test.ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/usageService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace `usageService.ts`**

```ts
// src/modules/admin/usageService.ts
import { z } from "zod";
import { ApiError } from "../../http/errors";
import { dailySeries, rollup, sumTotals, unpricedModels, type UsageGroupBy, type UsageRunRow } from "./usageAggregations";
import { projectMonthEnd, resolveUsageRange, type UsageRange } from "./usageRange";
import type { UsageCall, UsageRunFilter } from "./usageRepository";

const rangeSchema = z.enum(["this_month", "last_month", "7d", "30d"]);

export const usageQuerySchema = z
  .object({
    range: rangeSchema.optional(),
    groupBy: z.enum(["user", "agency", "chat"]).optional()
  })
  .strict();

export const usageRunsQuerySchema = z
  .object({
    range: rangeSchema.optional(),
    userId: z.string().uuid().optional(),
    agencyId: z.string().uuid().optional(),
    threadId: z.string().uuid().optional()
  })
  .strict()
  .refine((q) => [q.userId, q.agencyId, q.threadId].filter(Boolean).length === 1, {
    message: "Pass exactly one of userId, agencyId or threadId."
  });

export interface UsageServiceRepository {
  listRunUsage(range: { from: Date; to: Date }, options?: { filter?: UsageRunFilter; take?: number }): Promise<UsageRunRow[]>;
  findRunUsage(runId: string): Promise<{ row: UsageRunRow; calls: UsageCall[] } | null>;
  firstMeteredAt(): Promise<Date | null>;
}
export interface UsageServiceUser {
  id: string;
  role: string;
}

const DRILL_IN_LIMIT = 50;

function assertSuperAdmin(user: UsageServiceUser) {
  if (user.role !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Super admin only.");
}

function toRunSummary(r: UsageRunRow) {
  return {
    id: r.runId,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    threadTitle: r.threadTitle,
    userLabel: r.userLabel,
    agencyName: r.agencyLabel,
    modelNames: r.modelNames,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd,
    costComplete: r.costComplete,
    callCount: r.callCount
  };
}

export function createUsageService(options: { repository: UsageServiceRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const { repository } = options;

  return {
    async getUsage(user: UsageServiceUser, params: { range?: UsageRange; groupBy?: UsageGroupBy }) {
      assertSuperAdmin(user);
      const range: UsageRange = params.range ?? "this_month";
      const groupBy: UsageGroupBy = params.groupBy ?? "user";
      const r = resolveUsageRange(range, now());

      const [rows, previousRows, meteredSince] = await Promise.all([
        repository.listRunUsage({ from: r.from, to: r.to }),
        repository.listRunUsage({ from: r.previousFrom, to: r.previousTo }),
        repository.firstMeteredAt()
      ]);
      const totals = sumTotals(rows);
      const previous = sumTotals(previousRows);

      return {
        range,
        groupBy,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        totals,
        previous: { costUsd: previous.costUsd, runCount: previous.runCount, totalTokens: previous.totalTokens },
        projectedMonthEndCostUsd: r.projectMonth ? projectMonthEnd(totals.costUsd, r.from, r.to) : null,
        series: dailySeries(rows, r.from, r.to),
        rows: rollup(rows, groupBy),
        unpricedModels: unpricedModels(rows),
        meteredSince: meteredSince ? meteredSince.toISOString() : null
      };
    },

    async getRuns(user: UsageServiceUser, params: { range?: UsageRange } & UsageRunFilter) {
      assertSuperAdmin(user);
      const r = resolveUsageRange(params.range ?? "this_month", now());
      const filter: UsageRunFilter = params.userId
        ? { userId: params.userId }
        : params.agencyId
          ? { agencyId: params.agencyId }
          : { threadId: params.threadId };
      const rows = await repository.listRunUsage({ from: r.from, to: r.to }, { filter, take: DRILL_IN_LIMIT });
      return { runs: rows.map(toRunSummary) };
    },

    async getRun(user: UsageServiceUser, runId: string) {
      assertSuperAdmin(user);
      const found = await repository.findRunUsage(runId);
      if (!found) throw new ApiError(404, "RUN_NOT_FOUND", "Run not found.");
      return { run: toRunSummary(found.row), calls: found.calls };
    }
  };
}
```

- [ ] **Step 4: Routes** — in `adminRoutes.ts` replace the existing `/usage` route and add two more (literal paths, so keep them in the top section)

```ts
import { createUsageService, usageQuerySchema, usageRunsQuerySchema } from "./usageService";

const runIdParamsSchema = idParamsSchema("runId");
```

```ts
adminRoutes.get("/usage", requireSuperAdmin, async (request, response, next) => {
  try {
    const query = usageQuerySchema.parse(request.query);
    response.json(await usageService.getUsage(request.authUser!, query));
  } catch (error) { next(error); }
});

adminRoutes.get("/usage/runs", requireSuperAdmin, async (request, response, next) => {
  try {
    const query = usageRunsQuerySchema.parse(request.query);
    response.json(await usageService.getRuns(request.authUser!, query));
  } catch (error) { next(error); }
});

adminRoutes.get("/usage/runs/:runId", requireSuperAdmin, async (request, response, next) => {
  try {
    const { runId } = runIdParamsSchema.parse(request.params);
    response.json(await usageService.getRun(request.authUser!, runId));
  } catch (error) { next(error); }
});
```

- [ ] **Step 5: Route test**

```ts
// tests/adminUsageRoutes.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ listRunUsage: vi.fn(), findRunUsage: vi.fn(), firstMeteredAt: vi.fn() }));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/agencyService", () => ({ agencyService: {} }));
vi.mock("../src/modules/support/supportService", () => ({ supportService: {} }));
vi.mock("../src/modules/admin/usageRepository", () => ({
  usageRepository: { listRunUsage: m.listRunUsage, findRunUsage: m.findRunUsage, firstMeteredAt: m.firstMeteredAt }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { adminRoutes } from "../src/modules/admin/adminRoutes";

const admin = { id: "admin-1", role: "SUPER_ADMIN", status: "ACTIVE", memberships: [] };
const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "11111111-1111-4111-8111-111111111111";

function createApp(authUser: Record<string, unknown> = admin) {
  const app = express();
  app.use((req, _res, next) => {
    req.authUser = authUser as any;
    next();
  });
  app.use("/admin", adminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listRunUsage.mockResolvedValue([]);
  m.firstMeteredAt.mockResolvedValue(null);
});

describe("GET /admin/usage", () => {
  it("accepts a range and group", async () => {
    const res = await request(createApp()).get("/admin/usage?range=7d&groupBy=chat");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ range: "7d", groupBy: "chat", rows: [] });
  });

  it("rejects the old period parameter", async () => {
    const res = await request(createApp()).get("/admin/usage?period=day");
    expect(res.status).toBe(400);
  });

  it("is super-admin only", async () => {
    const res = await request(createApp({ id: "u", role: "USER", status: "ACTIVE", memberships: [] })).get("/admin/usage");
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/usage/runs", () => {
  it("needs exactly one of userId, agencyId, threadId", async () => {
    expect((await request(createApp()).get("/admin/usage/runs")).status).toBe(400);
    expect((await request(createApp()).get(`/admin/usage/runs?userId=${USER}&threadId=${THREAD}`)).status).toBe(400);
    expect((await request(createApp()).get(`/admin/usage/runs?threadId=${THREAD}`)).status).toBe(200);
  });
});

describe("GET /admin/usage/runs/:runId", () => {
  it("404s an unknown run and 400s a bad id", async () => {
    m.findRunUsage.mockResolvedValue(null);
    expect((await request(createApp()).get(`/admin/usage/runs/${THREAD}`)).status).toBe(404);
    expect((await request(createApp()).get("/admin/usage/runs/nope")).status).toBe(400);
  });
});
```

- [ ] **Step 6: Run everything touched + types**

Run: `npx vitest run tests/usageService.test.ts tests/adminUsageRoutes.test.ts tests/authenticatedValidation.test.ts tests/usageAggregations.test.ts tests/usageRepository.test.ts && npx tsc --noEmit`
Expected: PASS (the `?period=century` validation test still gets its 400), no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/usageService.ts src/modules/admin/adminRoutes.ts tests/usageService.test.ts tests/adminUsageRoutes.test.ts
git commit -m "feat(usage): range-based usage API with drill-in to runs and calls"
```

---

### Task 9: Client API and formatters

**Files:**
- Modify: `Voyage-Client/app/lib/api/admin.js`, `Voyage-Client/app/lib/api/index.js`
- Create: `Voyage-Client/app/components/admin/usage/usageFormat.js`
- Test: `Voyage-Client/tests/usage-format.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/usage-format.test.js
import { describe, expect, it } from "vitest";
import { deltaPct, fmtInt, fmtPct, fmtShortDate, fmtUsd, roleTagLine } from "../app/components/admin/usage/usageFormat.js";

describe("usage formatters", () => {
  it("formats money by size so small costs stay readable", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(0.00042)).toBe("$0.0004");
    expect(fmtUsd(0.023)).toBe("$0.023");
    expect(fmtUsd(4.8231)).toBe("$4.82");
  });

  it("formats counts, percents and dates", () => {
    expect(fmtInt(1313790.4)).toBe("1,313,790");
    expect(fmtPct(0.4467)).toBe("45%");
    expect(fmtShortDate("2026-10-03")).toBe("Oct 3");
  });

  it("gives a change ratio, or null when there was nothing before", () => {
    expect(deltaPct(1.38, 1)).toBeCloseTo(0.38, 9);
    expect(deltaPct(5, 0)).toBeNull();
  });

  it("builds the user tag line", () => {
    expect(roleTagLine({ roleTag: "OWNER", agencyName: "Hops Travel" })).toBe("Owner · Hops Travel");
    expect(roleTagLine({ roleTag: "PERSONAL", agencyName: null })).toBe("Personal");
    expect(roleTagLine({ roleTag: null, agencyName: "Hops Travel" })).toBe("Hops Travel");
    expect(roleTagLine({ roleTag: null, agencyName: null })).toBe("");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/usage-format.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// app/components/admin/usage/usageFormat.js
/** Shared number, date and label formatting for the admin Usage tab. */

export const fmtInt = (n) => Math.round(n ?? 0).toLocaleString("en-US");

/** Small costs keep enough digits to be told apart; whole dollars use cents. */
export function fmtUsd(n) {
  const v = n ?? 0;
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  if (Math.abs(v) < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export const fmtPct = (ratio) => `${Math.round((ratio ?? 0) * 100)}%`;

/** Change vs the previous period as a ratio (0.38 = +38%), or null if there was no previous spend. */
export function deltaPct(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

/** "2026-10-03" -> "Oct 3" (buckets are UTC days). */
export function fmtShortDate(isoDay) {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const ROLE_TAG_LABELS = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff", PERSONAL: "Personal" };

/** "Owner · Hops Travel", "Personal", or just the agency when the role is unknown. */
export function roleTagLine({ roleTag, agencyName }) {
  const role = roleTag ? ROLE_TAG_LABELS[roleTag] || roleTag : null;
  if (roleTag === "PERSONAL") return role;
  return [role, agencyName].filter(Boolean).join(" · ");
}

export const RANGE_OPTIONS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export const GROUP_OPTIONS = [
  { value: "user", label: "Users" },
  { value: "agency", label: "Agencies" },
  { value: "chat", label: "Chats" },
];

/** Which drill-in query parameter each table grouping uses. */
export const GROUP_FILTER_KEY = { user: "userId", agency: "agencyId", chat: "threadId" };
```

`admin.js` — replace `fetchUsage` and add two calls:

```js
export async function fetchUsage({ range = "this_month", groupBy = "user" } = {}) {
  const qs = new URLSearchParams({ range, groupBy });
  return fetchApi(`/admin/usage?${qs.toString()}`);
}

/** Runs behind one table row: pass exactly one of userId, agencyId, threadId. */
export async function fetchUsageRuns({ range = "this_month", userId, agencyId, threadId }) {
  const qs = new URLSearchParams({
    range,
    ...(userId ? { userId } : {}),
    ...(agencyId ? { agencyId } : {}),
    ...(threadId ? { threadId } : {}),
  });
  return fetchApi(`/admin/usage/runs?${qs.toString()}`);
}

export async function fetchUsageRun(runId) {
  return fetchApi(`/admin/usage/runs/${runId}`);
}
```

`index.js` — add `fetchUsageRuns, fetchUsageRun,` after `fetchUsage,`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/usage-format.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/api/admin.js app/lib/api/index.js app/components/admin/usage/usageFormat.js tests/usage-format.test.js
git commit -m "feat(usage): client usage calls and shared formatters"
```

---

### Task 10: Stat cards — spend, runs, average, cache

**Files:**
- Rewrite: `Voyage-Client/app/components/admin/usage/UsageStatCards.jsx`
- Rewrite: `Voyage-Client/tests/usage-stat-cards.test.jsx`

- [ ] **Step 1: Replace the test**

```jsx
// tests/usage-stat-cards.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UsageStatCards from "../app/components/admin/usage/UsageStatCards.jsx";

const totals = { costUsd: 4.82, runCount: 213, failedRunCount: 9, avgCostPerRun: 0.0226, avgTokensPerRun: 18400, cacheHitRate: 0.45 };

describe("UsageStatCards", () => {
  it("shows spend with change and projection, runs with failure share, average and cache hit", () => {
    render(<UsageStatCards totals={totals} previous={{ costUsd: 3.49 }} projectedMonthEndCostUsd={7.1} series={[]} />);

    expect(screen.getByText("$4.82")).toBeInTheDocument();
    expect(screen.getByText("Up 38% vs previous period")).toBeInTheDocument();
    expect(screen.getByText("About $7.10 by month end")).toBeInTheDocument();
    expect(screen.getByText("213")).toBeInTheDocument();
    expect(screen.getByText("4% failed")).toBeInTheDocument();
    expect(screen.getByText("$0.023")).toBeInTheDocument();
    expect(screen.getByText("18,400 tokens")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("says when there's nothing to compare with and hides the projection", () => {
    render(<UsageStatCards totals={{ ...totals, failedRunCount: 0 }} previous={{ costUsd: 0 }} projectedMonthEndCostUsd={null} series={[]} />);
    expect(screen.getByText("No spend in the previous period")).toBeInTheDocument();
    expect(screen.queryByText(/by month end/)).not.toBeInTheDocument();
    expect(screen.getByText("No failed runs")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/usage-stat-cards.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Replace the component**

```jsx
// app/components/admin/usage/UsageStatCards.jsx
"use client";

import Sparkline from "./Sparkline.jsx";
import { deltaPct, fmtInt, fmtPct, fmtUsd } from "./usageFormat.js";

function Card({ label, value, children }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/12 bg-surface-elevated p-4 shadow-soft">
      <p className="dashboard-eyebrow">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {children}
    </div>
  );
}

const Sub = ({ className = "text-text-muted", children }) => <p className={`text-xs tabular-nums ${className}`}>{children}</p>;

function changeLine(current, previous) {
  const d = deltaPct(current, previous);
  if (d === null) return "No spend in the previous period";
  const pct = Math.round(Math.abs(d) * 100);
  if (pct === 0) return "Same as previous period";
  return `${d > 0 ? "Up" : "Down"} ${pct}% vs previous period`;
}

export default function UsageStatCards({ totals, previous, projectedMonthEndCostUsd, series }) {
  const t = totals || {};
  const failedShare = t.runCount ? t.failedRunCount / t.runCount : 0;
  const costSeries = Array.isArray(series) ? series.map((d) => d.costUsd || 0) : [];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card label="Spend" value={fmtUsd(t.costUsd)}>
        <Sub>{changeLine(t.costUsd ?? 0, previous?.costUsd ?? 0)}</Sub>
        {projectedMonthEndCostUsd != null && <Sub>About {fmtUsd(projectedMonthEndCostUsd)} by month end</Sub>}
        <div className="text-primary/60">
          <Sparkline values={costSeries} testId="usage-sparkline" />
        </div>
      </Card>
      <Card label="Runs" value={fmtInt(t.runCount)}>
        <Sub className={t.failedRunCount ? "text-status-danger" : "text-text-muted"}>
          {t.failedRunCount ? `${fmtPct(failedShare)} failed` : "No failed runs"}
        </Sub>
      </Card>
      <Card label="Avg per run" value={fmtUsd(t.avgCostPerRun)}>
        <Sub>{fmtInt(t.avgTokensPerRun)} tokens</Sub>
      </Card>
      <Card label="Cache hit" value={fmtPct(t.cacheHitRate)}>
        <Sub>of prompt tokens</Sub>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --pool=threads tests/usage-stat-cards.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/usage/UsageStatCards.jsx tests/usage-stat-cards.test.jsx
git commit -m "feat(usage): spend, runs, average and cache-hit cards"
```

---

### Task 11: Chart — metric toggle, dates, failed runs

**Files:**
- Rewrite: `Voyage-Client/app/components/admin/usage/UsageBarChart.jsx`
- Rewrite: `Voyage-Client/tests/usage-bar-chart.test.jsx`

- [ ] **Step 1: Replace the test**

```jsx
// tests/usage-bar-chart.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UsageBarChart from "../app/components/admin/usage/UsageBarChart.jsx";

const series = [
  { bucket: "2026-10-01", costUsd: 0, totalTokens: 0, runCount: 0, failedRunCount: 0 },
  { bucket: "2026-10-02", costUsd: 0.5, totalTokens: 1000, runCount: 4, failedRunCount: 1 },
  { bucket: "2026-10-03", costUsd: 0.25, totalTokens: 500, runCount: 2, failedRunCount: 0 },
];

describe("UsageBarChart", () => {
  it("draws one labelled bar per day, including empty days", () => {
    render(<UsageBarChart series={series} metric="costUsd" />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByRole("img", { name: "Oct 1: $0.00" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Oct 2: $0.500" })).toBeInTheDocument();
  });

  it("labels first, middle and last dates", () => {
    render(<UsageBarChart series={series} metric="totalTokens" />);
    expect(screen.getByText("Oct 1")).toBeInTheDocument();
    expect(screen.getByText("Oct 2")).toBeInTheDocument();
    expect(screen.getByText("Oct 3")).toBeInTheDocument();
  });

  it("names failed runs in the Runs view", () => {
    render(<UsageBarChart series={series} metric="runCount" />);
    expect(screen.getByRole("img", { name: "Oct 2: 4 runs, 1 failed" })).toBeInTheDocument();
  });

  it("explains an empty range", () => {
    render(<UsageBarChart series={[]} metric="costUsd" />);
    expect(screen.getByText("No usage in this range.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/usage-bar-chart.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Replace the component**

```jsx
// app/components/admin/usage/UsageBarChart.jsx
"use client";

import { useState } from "react";
import { fmtInt, fmtShortDate, fmtUsd } from "./usageFormat.js";

const FORMAT = { costUsd: fmtUsd, totalTokens: fmtInt, runCount: fmtInt };

function describe(d, metric) {
  const date = fmtShortDate(d.bucket);
  if (metric === "runCount") {
    return `${date}: ${fmtInt(d.runCount)} run${d.runCount === 1 ? "" : "s"}${d.failedRunCount ? `, ${d.failedRunCount} failed` : ""}`;
  }
  return `${date}: ${FORMAT[metric](d[metric] || 0)}`;
}

export default function UsageBarChart({ series, metric = "costUsd", height = 160 }) {
  const [active, setActive] = useState(null);

  if (!series?.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-border/12 bg-surface-elevated text-sm text-text-muted">
        No usage in this range.
      </div>
    );
  }

  const fmt = FORMAT[metric];
  const max = Math.max(...series.map((d) => d[metric] || 0), metric === "costUsd" ? 0.0001 : 1);
  const barW = 100 / series.length;
  const mid = Math.floor((series.length - 1) / 2);
  const activeDatum = active != null ? series[active] : null;

  return (
    <div className="rounded-md border border-border/12 bg-surface-elevated p-4 shadow-soft">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-text-soft">
        <span className="tabular-nums">Peak {fmt(max)}</span>
        {activeDatum && <span className="font-semibold tabular-nums text-text-primary">{describe(activeDatum, metric)}</span>}
      </div>

      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1="0" x2="100" y1={height - g * height} y2={height - g * height} stroke="currentColor" className="text-border/20" strokeWidth="0.3" />
        ))}
        {series.map((d, i) => {
          const value = d[metric] || 0;
          const h = (value / max) * (height - 8);
          const failedH = metric === "runCount" && d.runCount ? (d.failedRunCount / d.runCount) * h : 0;
          const x = i * barW + barW * 0.15;
          const w = barW * 0.7;
          return (
            <g
              key={d.bucket}
              role="img"
              aria-label={describe(d, metric)}
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <title>{describe(d, metric)}</title>
              {/* An invisible full-height hit area keeps empty days hoverable. */}
              <rect x={i * barW} y={0} width={barW} height={height} fill="transparent" />
              <rect
                x={x}
                y={height - h}
                width={w}
                height={h}
                rx="0.6"
                className={`transition-[height,y] duration-300 [transition-timing-function:var(--ease-out)] motion-reduce:transition-none ${
                  active === i ? "fill-primary" : "fill-primary/80"
                }`}
              />
              {failedH > 0 && <rect x={x} y={height - failedH} width={w} height={failedH} rx="0.6" className="fill-status-danger/80" />}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-text-soft">
        <span>{fmtShortDate(series[0].bucket)}</span>
        {series.length > 2 && <span>{fmtShortDate(series[mid].bucket)}</span>}
        {series.length > 1 && <span>{fmtShortDate(series[series.length - 1].bucket)}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --pool=threads tests/usage-bar-chart.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/usage/UsageBarChart.jsx tests/usage-bar-chart.test.jsx
git commit -m "feat(usage): chart with cost/tokens/runs, dates and failed runs"
```

---

### Task 12: Table — users, agencies, chats with tags; rows open the drill-in

**Files:**
- Rewrite: `Voyage-Client/app/components/admin/usage/UsageTable.jsx`
- Rewrite: `Voyage-Client/tests/usage-table.test.jsx`

- [ ] **Step 1: Replace the test**

```jsx
// tests/usage-table.test.jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UsageTable from "../app/components/admin/usage/UsageTable.jsx";

const rows = [
  { id: "u1", label: "Jerald", drillable: true, roleTag: "OWNER", agencyName: "Hops Travel", runCount: 120, failedRunCount: 3, totalTokens: 900000, costUsd: 2.91 },
  { id: "u2", label: "Ana", drillable: true, roleTag: "PERSONAL", agencyName: null, runCount: 22, failedRunCount: 0, totalTokens: 100000, costUsd: 0.51 },
  { id: "none", label: "Unknown user", drillable: false, roleTag: null, agencyName: null, runCount: 1, failedRunCount: 0, totalTokens: 10, costUsd: 0 },
];

describe("UsageTable", () => {
  it("shows each user's tag and sorts by cost", () => {
    render(<UsageTable rows={rows} groupBy="user" onSelect={vi.fn()} />);
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getByText("Jerald")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("Owner · Hops Travel")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("Personal")).toBeInTheDocument();
  });

  it("opens a drillable row and leaves the others plain", () => {
    const onSelect = vi.fn();
    render(<UsageTable rows={rows} groupBy="user" onSelect={onSelect} />);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: /Jerald/ }));
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
    expect(within(screen.getByRole("table")).queryByRole("button", { name: /Unknown user/ })).not.toBeInTheDocument();
  });

  it("re-sorts when a column header is clicked", () => {
    render(<UsageTable rows={rows} groupBy="user" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("columnheader", { name: /^name/i }));
    const first = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(first).getByText("Ana")).toBeInTheDocument();
  });

  it("explains an empty table", () => {
    render(<UsageTable rows={[]} groupBy="chat" onSelect={vi.fn()} />);
    expect(screen.getByText("No usage to show for this range.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/usage-table.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Replace the component**

```jsx
// app/components/admin/usage/UsageTable.jsx
"use client";

import { useState } from "react";
import { fmtInt, fmtUsd, roleTagLine } from "./usageFormat.js";

const COLUMNS = [
  { key: "label", label: "Name", numeric: false },
  { key: "runCount", label: "Runs", numeric: true, fmt: fmtInt },
  { key: "failedRunCount", label: "Failed", numeric: true, fmt: fmtInt },
  { key: "totalTokens", label: "Tokens", numeric: true, fmt: fmtInt },
  { key: "costUsd", label: "Cost", numeric: true, fmt: fmtUsd },
];

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

function subLine(row, groupBy) {
  if (groupBy === "user") return roleTagLine(row);
  if (groupBy === "chat") return row.agencyName || "";
  return "";
}

function NameCell({ row, groupBy, onSelect, selected }) {
  const sub = subLine(row, groupBy);
  const text = (
    <>
      <span className="block truncate font-semibold text-text-primary">{row.label}</span>
      {sub && <span className="block truncate text-xs text-text-muted">{sub}</span>}
    </>
  );
  if (!row.drillable) return <div className="min-w-0">{text}</div>;
  return (
    <button type="button" aria-current={selected ? "true" : undefined} onClick={() => onSelect(row)} className={`block w-full min-w-0 rounded-sm text-left ${FOCUS_RING}`}>
      {text}
    </button>
  );
}

export default function UsageTable({ rows = [], groupBy, onSelect, selectedId }) {
  const [sortKey, setSortKey] = useState("costUsd");
  const [dir, setDir] = useState("desc");

  if (!rows.length) {
    return (
      <div className="rounded-md border border-border/12 bg-surface-elevated p-8 text-center text-sm text-text-muted">
        No usage to show for this range.
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : (av ?? 0) - (bv ?? 0);
    return dir === "asc" ? cmp : -cmp;
  });

  const onSort = (key) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "label" ? "asc" : "desc");
    }
  };

  const maxCost = Math.max(...rows.map((r) => r.costUsd || 0), 0.0001);

  return (
    <>
      <div className="hidden overflow-hidden rounded-md border border-border/12 shadow-soft sm:block">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-surface-elevated">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  onClick={() => onSort(c.key)}
                  className={`cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-soft hover:text-text-primary ${
                    c.numeric ? "w-28 text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/8 bg-surface-elevated">
            {sorted.map((r) => {
              const selected = selectedId === r.id;
              return (
                <tr key={r.id} className={`border-l-2 transition-colors ${selected ? "border-primary bg-primary/8" : "border-transparent"} ${r.drillable ? "hover:bg-primary/5" : ""}`}>
                  <td className="px-4 py-3">
                    <NameCell row={r} groupBy={groupBy} onSelect={onSelect} selected={selected} />
                  </td>
                  {COLUMNS.slice(1).map((c) =>
                    c.key === "costUsd" ? (
                      <td key={c.key} className="relative px-4 py-3 text-right tabular-nums text-text-primary">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-1 right-2 rounded-sm bg-primary/8"
                          style={{ width: `${Math.round(((r.costUsd || 0) / maxCost) * 100)}%`, maxWidth: "calc(100% - 1rem)" }}
                        />
                        <span className="relative">{c.fmt(r[c.key])}</span>
                      </td>
                    ) : (
                      <td key={c.key} className={`px-4 py-3 text-right tabular-nums ${c.key === "failedRunCount" && r.failedRunCount ? "text-status-danger" : "text-text-muted"}`}>
                        {c.fmt(r[c.key])}
                      </td>
                    )
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:hidden">
        {sorted.map((r) => (
          <div key={r.id} className="rounded-md border border-border/12 bg-surface-elevated p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <NameCell row={r} groupBy={groupBy} onSelect={onSelect} selected={selectedId === r.id} />
              <span className="flex-none text-sm tabular-nums text-text-primary">{fmtUsd(r.costUsd)}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums text-text-soft">
              <span>{fmtInt(r.runCount)} runs</span>
              <span className={r.failedRunCount ? "text-status-danger" : ""}>{fmtInt(r.failedRunCount)} failed</span>
              <span>{fmtInt(r.totalTokens)} tokens</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --pool=threads tests/usage-table.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/usage/UsageTable.jsx tests/usage-table.test.jsx
git commit -m "feat(usage): users/agencies/chats table with tags and drillable rows"
```

---

### Task 13: Drill-in — runs, then per-call detail

**Files:**
- Create: `Voyage-Client/app/components/admin/usage/UsageDrillIn.jsx`
- Test: `Voyage-Client/tests/usage-drill-in.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/usage-drill-in.test.jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/admin.js", () => ({ fetchUsageRuns: vi.fn(), fetchUsageRun: vi.fn() }));

import { fetchUsageRun, fetchUsageRuns } from "../app/lib/api/admin.js";
import UsageDrillIn from "../app/components/admin/usage/UsageDrillIn.jsx";

const row = { id: "u1", label: "Jerald", drillable: true, roleTag: "OWNER", agencyName: "Hops Travel", runCount: 2, failedRunCount: 1, totalTokens: 3000, costUsd: 0.04 };
const runs = [
  { id: "r2", createdAt: "2026-10-22T09:00:00.000Z", status: "FAILED", threadTitle: "Zambales 2-day", userLabel: "Jerald", agencyName: "Hops Travel", modelNames: ["gemini-3.5-flash-lite"], totalTokens: 2000, costUsd: 0.03, costComplete: false, callCount: 4 },
  { id: "r1", createdAt: "2026-10-21T09:00:00.000Z", status: "COMPLETED", threadTitle: "Baguio", userLabel: "Jerald", agencyName: "Hops Travel", modelNames: ["gemini-3.5-flash-lite"], totalTokens: 1000, costUsd: 0.01, costComplete: true, callCount: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchUsageRuns.mockResolvedValue({ runs });
  fetchUsageRun.mockResolvedValue({
    run: runs[0],
    calls: [{ callIndex: 0, phase: "loop", modelName: "gemini-3.5-flash-lite", promptTokens: 900, cachedTokens: 400, outputTokens: 50, thoughtsTokens: 20, totalTokens: 970, costUsd: 0.0005 }],
  });
});

describe("UsageDrillIn", () => {
  it("loads the row's runs for the range using the right filter", async () => {
    render(<UsageDrillIn row={row} groupBy="user" range="7d" />);
    expect(await screen.findByText("Zambales 2-day")).toBeInTheDocument();
    expect(fetchUsageRuns).toHaveBeenCalledWith({ range: "7d", userId: "u1" });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Cost incomplete")).toBeInTheDocument();
  });

  it("expands a run into its model calls", async () => {
    render(<UsageDrillIn row={row} groupBy="user" range="this_month" />);
    fireEvent.click(await screen.findByRole("button", { name: /Zambales 2-day/ }));
    expect(await screen.findByText("970")).toBeInTheDocument();
    expect(fetchUsageRun).toHaveBeenCalledWith("r2");
  });

  it("uses threadId for a chat row", async () => {
    render(<UsageDrillIn row={{ ...row, id: "t1" }} groupBy="chat" range="30d" />);
    await screen.findByText("Baguio");
    expect(fetchUsageRuns).toHaveBeenCalledWith({ range: "30d", threadId: "t1" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/usage-drill-in.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// app/components/admin/usage/UsageDrillIn.jsx
"use client";

import { useEffect, useState } from "react";
import { fetchUsageRun, fetchUsageRuns } from "../../../lib/api/admin.js";
import { GROUP_FILTER_KEY, fmtInt, fmtUsd, roleTagLine } from "./usageFormat.js";

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function CallTable({ runId }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchUsageRun(runId)
      .then((data) => !cancelled && setCalls(data?.calls || []))
      .catch((e) => !cancelled && setError(e?.message || "Couldn't load this run."));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="px-3 pb-3 text-xs text-status-danger">{error}</p>;
  if (!calls) return <p className="px-3 pb-3 text-xs text-text-muted">Loading calls…</p>;
  if (!calls.length) return <p className="px-3 pb-3 text-xs text-text-muted">No per-call detail was recorded for this run.</p>;

  return (
    <div className="overflow-x-auto px-3 pb-3">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-text-soft">
          <tr>
            <th className="py-1 text-left font-semibold">#</th>
            <th className="py-1 text-left font-semibold">Step</th>
            <th className="py-1 text-right font-semibold">Prompt</th>
            <th className="py-1 text-right font-semibold">Cached</th>
            <th className="py-1 text-right font-semibold">Output</th>
            <th className="py-1 text-right font-semibold">Thinking</th>
            <th className="py-1 text-right font-semibold">Total</th>
            <th className="py-1 text-right font-semibold">Cost</th>
          </tr>
        </thead>
        <tbody className="text-text-muted">
          {calls.map((c) => (
            <tr key={c.callIndex} className="border-t border-border/8" title={c.modelName}>
              <td className="py-1">{c.callIndex + 1}</td>
              <td className="py-1">{c.phase === "synthesis" ? "Final answer" : "Tool step"}</td>
              <td className="py-1 text-right">{fmtInt(c.promptTokens)}</td>
              <td className="py-1 text-right">{fmtInt(c.cachedTokens)}</td>
              <td className="py-1 text-right">{fmtInt(c.outputTokens)}</td>
              <td className="py-1 text-right">{fmtInt(c.thoughtsTokens)}</td>
              <td className="py-1 text-right text-text-primary">{fmtInt(c.totalTokens)}</td>
              <td className="py-1 text-right">{c.costUsd === null ? "Unpriced" : fmtUsd(c.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Side-panel body for one usage table row. `actions` is a slot for row-level buttons (Part 3 adds Pause agent). */
export default function UsageDrillIn({ row, groupBy, range, actions = null }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [openRunId, setOpenRunId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setError(null);
    setOpenRunId(null);
    fetchUsageRuns({ range, [GROUP_FILTER_KEY[groupBy]]: row.id })
      .then((data) => !cancelled && setRuns(data?.runs || []))
      .catch((e) => !cancelled && setError(e?.message || "Couldn't load runs."));
    return () => {
      cancelled = true;
    };
  }, [row.id, groupBy, range]);

  const sub = groupBy === "user" ? roleTagLine(row) : groupBy === "chat" ? row.agencyName : "";

  return (
    <div className="flex flex-col gap-4">
      {sub && <p className="-mt-2 text-sm text-text-muted">{sub}</p>}
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Cost", fmtUsd(row.costUsd)],
          ["Runs", `${fmtInt(row.runCount)}${row.failedRunCount ? ` · ${row.failedRunCount} failed` : ""}`],
          ["Tokens", fmtInt(row.totalTokens)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-sm border border-border/10 bg-surface p-3">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="m-0 mt-1 text-sm font-semibold tabular-nums text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {actions}

      <section>
        <h3 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wider text-text-muted">Runs (newest first, up to 50)</h3>
        {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
        {!runs && !error && <p className="text-sm text-text-muted">Loading runs…</p>}
        {runs && runs.length === 0 && <p className="text-sm text-text-muted">No runs in this range.</p>}
        {runs && runs.length > 0 && (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => {
              const open = openRunId === run.id;
              return (
                <li key={run.id} className="rounded-sm border border-border/10 bg-surface">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenRunId(open ? null : run.id)}
                    className="flex w-full items-start justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-text-primary">{run.threadTitle || "Untitled chat"}</span>
                      <span className="block text-xs text-text-muted">
                        {fmtWhen(run.createdAt)} · {run.callCount} call{run.callCount === 1 ? "" : "s"}
                        {groupBy !== "user" && run.userLabel ? ` · ${run.userLabel}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end gap-1 text-xs tabular-nums">
                      <span className="text-sm text-text-primary">{fmtUsd(run.costUsd)}</span>
                      <span className="text-text-muted">{fmtInt(run.totalTokens)} tokens</span>
                      {run.status === "FAILED" && <span className="font-semibold text-status-danger">Failed</span>}
                      {!run.costComplete && <span className="text-status-warning">Cost incomplete</span>}
                    </span>
                  </button>
                  {open && <CallTable runId={run.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/usage-drill-in.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/usage/UsageDrillIn.jsx tests/usage-drill-in.test.jsx
git commit -m "feat(usage): drill-in panel with runs and per-call breakdown"
```

---

### Task 14: Usage tab — put it together

**Files:**
- Rewrite: `Voyage-Client/app/components/admin/usage/UsageSection.jsx`
- Rewrite: `Voyage-Client/tests/usage-section.test.jsx`

- [ ] **Step 1: Replace the test**

```jsx
// tests/usage-section.test.jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => ({ CloseIcon: () => null }));
vi.mock("../app/lib/api/admin.js", () => ({
  fetchUsage: vi.fn(),
  fetchUsageRuns: vi.fn().mockResolvedValue({ runs: [] }),
  fetchUsageRun: vi.fn(),
}));

import { fetchUsage, fetchUsageRuns } from "../app/lib/api/admin.js";
import UsageSection from "../app/components/admin/usage/UsageSection.jsx";

const response = (over = {}) => ({
  range: "this_month",
  groupBy: "user",
  totals: { costUsd: 0.75, runCount: 2, failedRunCount: 1, avgCostPerRun: 0.375, avgTokensPerRun: 140, cacheHitRate: 0.2, totalTokens: 280 },
  previous: { costUsd: 0.5, runCount: 1, totalTokens: 140 },
  projectedMonthEndCostUsd: 0.95,
  series: [{ bucket: "2026-10-01", costUsd: 0.75, totalTokens: 280, runCount: 2, failedRunCount: 1 }],
  rows: [{ id: "11111111-1111-4111-8111-111111111111", label: "Ana", drillable: true, roleTag: "STAFF", agencyName: "Alpha", runCount: 2, failedRunCount: 1, totalTokens: 280, costUsd: 0.75 }],
  unpricedModels: [],
  meteredSince: "2026-06-02T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchUsage.mockResolvedValue(response());
});

describe("UsageSection", () => {
  it("loads this month by user and shows cards, chart and table", async () => {
    render(<UsageSection />);
    // Table and phone cards both render under jsdom, so look inside the table.
    expect(within(await screen.findByRole("table")).getByText("Staff · Alpha")).toBeInTheDocument();
    expect(fetchUsage).toHaveBeenCalledWith({ range: "this_month", groupBy: "user" });
    expect(screen.getByText("Spend")).toBeInTheDocument();
  });

  it("refetches when the range or grouping changes", async () => {
    render(<UsageSection />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    await waitFor(() => expect(fetchUsage).toHaveBeenLastCalledWith({ range: "7d", groupBy: "user" }));
    fireEvent.click(screen.getByRole("radio", { name: "Chats" }));
    await waitFor(() => expect(fetchUsage).toHaveBeenLastCalledWith({ range: "7d", groupBy: "chat" }));
  });

  it("warns when some runs used unpriced models", async () => {
    fetchUsage.mockResolvedValue(response({ unpricedModels: ["gemini-x"] }));
    render(<UsageSection />);
    expect(await screen.findByText(/Cost is incomplete/)).toHaveTextContent("gemini-x");
  });

  it("opens the drill-in for a clicked row", async () => {
    render(<UsageSection />);
    fireEvent.click(within(await screen.findByRole("table")).getByRole("button", { name: /Ana/ }));
    await waitFor(() => expect(fetchUsageRuns).toHaveBeenCalledWith({ range: "this_month", userId: "11111111-1111-4111-8111-111111111111" }));
    expect(screen.getByRole("dialog", { name: "Ana" })).toBeInTheDocument();
  });

  it("opens straight to a user when asked to (from the account panel)", async () => {
    render(<UsageSection initialSelection={{ id: "11111111-1111-4111-8111-111111111111", label: "Ana" }} />);
    await waitFor(() => expect(fetchUsageRuns).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Ana" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/usage-section.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Replace the component**

```jsx
// app/components/admin/usage/UsageSection.jsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUsage } from "../../../lib/api/admin.js";
import SegmentedControl from "../SegmentedControl.jsx";
import DetailPane from "../DetailPane.jsx";
import UsageStatCards from "./UsageStatCards.jsx";
import UsageBarChart from "./UsageBarChart.jsx";
import UsageTable from "./UsageTable.jsx";
import UsageDrillIn from "./UsageDrillIn.jsx";
import { GROUP_OPTIONS, RANGE_OPTIONS } from "./usageFormat.js";

const METRIC_OPTIONS = [
  { value: "costUsd", label: "Cost" },
  { value: "totalTokens", label: "Tokens" },
  { value: "runCount", label: "Runs" },
];

const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * @param {{ id: string, label: string } | null} [initialSelection] open a user's drill-in on arrival
 * @param {(row, groupBy) => React.ReactNode} [renderRowActions] extra buttons in the drill-in (Part 3)
 */
export default function UsageSection({ initialSelection = null, renderRowActions }) {
  const [range, setRange] = useState("this_month");
  const [groupBy, setGroupBy] = useState("user");
  const [metric, setMetric] = useState("costUsd");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(initialSelection ? { drillable: true, runCount: 0, failedRunCount: 0, totalTokens: 0, costUsd: 0, ...initialSelection } : null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchUsage({ range, groupBy }));
    } catch (e) {
      setError(e?.message || "Couldn't load usage.");
    } finally {
      setLoading(false);
    }
  }, [range, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the open row's numbers in step with the latest load (e.g. arriving from the account panel).
  useEffect(() => {
    if (!selected || !data) return;
    const fresh = data.rows.find((r) => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeGroup = (next) => {
    setSelected(null);
    setGroupBy(next);
  };

  const startsBeforeMetering = data?.meteredSince && new Date(data.from) < new Date(data.meteredSince);

  return (
    <div className="flex min-h-0 flex-1 gap-4 lg:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl as="radio" size="sm" ariaLabel="Date range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <SegmentedControl as="radio" size="sm" ariaLabel="Chart shows" value={metric} onChange={setMetric} options={METRIC_OPTIONS} />
        </div>

        {loading && !data && <div className="py-16 text-center text-sm text-text-muted">Loading usage…</div>}
        {error && (
          <div role="alert" className="rounded-sm bg-status-danger/8 p-4 text-center text-sm text-status-danger">
            {error}
          </div>
        )}

        {data && !error && (
          <>
            {data.unpricedModels.length > 0 && (
              <p role="status" className="rounded-sm border border-status-warning/25 bg-status-warning/8 p-3 text-sm text-text-primary">
                Cost is incomplete: some runs used models with no price ({data.unpricedModels.join(", ")}). Add them to the price list in vertex.ts.
              </p>
            )}
            {startsBeforeMetering && <p className="text-xs text-text-muted">Usage is recorded from {fmtDay(data.meteredSince)}. Earlier runs have no token data.</p>}

            <UsageStatCards totals={data.totals} previous={data.previous} projectedMonthEndCostUsd={data.projectedMonthEndCostUsd} series={data.series} />
            <UsageBarChart series={data.series} metric={metric} />

            <div className="flex items-center justify-between gap-3">
              <h3 className="font-sans text-xs font-semibold uppercase tracking-wider text-text-muted">Breakdown</h3>
              <SegmentedControl as="radio" size="sm" ariaLabel="Group by" value={groupBy} onChange={changeGroup} options={GROUP_OPTIONS} />
            </div>
            <UsageTable rows={data.rows} groupBy={groupBy} onSelect={setSelected} selectedId={selected?.id} />
          </>
        )}
      </div>

      {selected && (
        <DetailPane open onClose={() => setSelected(null)} title={selected.label} ariaLabel={selected.label}>
          <UsageDrillIn row={selected} groupBy={groupBy} range={range} actions={renderRowActions?.(selected, groupBy, load) ?? null} />
        </DetailPane>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the usage tests**

Run: `npx vitest run --pool=threads tests/usage-section.test.jsx tests/usage-table.test.jsx tests/usage-drill-in.test.jsx tests/usage-bar-chart.test.jsx tests/usage-stat-cards.test.jsx tests/admin-page.test.jsx`
Expected: PASS. If `admin-page.test.jsx` mocks `fetchUsage` with the old response shape, update that mock to the `response()` shape above.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/usage/UsageSection.jsx tests/usage-section.test.jsx tests/admin-page.test.jsx
git commit -m "feat(usage): rebuilt Usage tab (ranges, cards, chart, breakdown, drill-in)"
```

---

### Task 15: Account panel — "Usage this month" with a link (needs Part 1)

**Files:**
- Modify: `Voyage-Server/src/modules/admin/accountService.ts`, `accountRepository.ts`, `tests/adminAccountService.test.ts`, `tests/authenticatedValidation.test.ts`, `tests/adminAccountActionRoutes.test.ts`
- Modify: `Voyage-Client/app/components/admin/AccountDetail.jsx`, `AdminAccountsPage.jsx`, `AdminPage.jsx`, `tests/account-detail.test.jsx`

- [ ] **Step 1: Server failing test** (append to `tests/adminAccountService.test.ts`; add `usageSince: vi.fn(async () => options.usage ?? { costUsd: 0, runCount: 0 })` to `makeRepository` and `usage?: { costUsd: number; runCount: number }` to its options)

```ts
describe("getAccount usage this month", () => {
  it("adds this calendar month's (UTC) spend and runs", async () => {
    const repository = makeRepository({ detail: makeDetailRow(), usage: { costUsd: 1.4, runCount: 71 } });
    const service = createAdminAccountService({ repository, now: () => new Date("2026-10-25T12:00:00.000Z") });

    const account = await service.getAccount(admin, USER_ID);

    expect(repository.usageSince).toHaveBeenCalledWith(USER_ID, new Date("2026-10-01T00:00:00.000Z"));
    expect(account.usageThisMonth).toEqual({ costUsd: 1.4, runCount: 71 });
  });
});
```

Run: `npx vitest run tests/adminAccountService.test.ts` — Expected: FAIL.

- [ ] **Step 2: Server implementation**

`accountService.ts`: repository interface gains

```ts
  /** Spend and run count for metered runs this user triggered since `from`. */
  usageSince(userId: string, from: Date): Promise<{ costUsd: number; runCount: number }>;
```

`createAdminAccountService(options: { repository: AdminAccountRepository; now?: () => Date })`, with `const now = options.now ?? (() => new Date());`. `AdminAccountDetailResponse` gains `usageThisMonth: { costUsd: number; runCount: number };`. In `getAccount`:

```ts
      const current = now();
      const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
      const [audit, ownedAgencies, usageThisMonth] = await Promise.all([
        options.repository.listAuditEvents(userId),
        options.repository.listOwnedAgencies(userId),
        options.repository.usageSince(userId, monthStart)
      ]);
```

and add `usageThisMonth` to the returned object.

`accountRepository.ts`:

```ts
  async usageSince(userId: string, from: Date) {
    const result = await prisma.agentRun.aggregate({
      where: { usageUserId: userId, createdAt: { gte: from }, status: { in: ["COMPLETED", "FAILED"] }, totalTokens: { not: null } },
      _sum: { costUsd: true },
      _count: { _all: true }
    });
    return { costUsd: Number(result._sum.costUsd ?? 0), runCount: result._count._all };
  }
```

Add `usageSince: vi.fn(async () => ({ costUsd: 0, runCount: 0 }))` to the `adminAccountRepository` mocks in `tests/authenticatedValidation.test.ts` and `tests/adminAccountActionRoutes.test.ts`, and `usageThisMonth: { costUsd: 0, runCount: 0 }` to the exact expected body in the `GET /admin/users/:userId` test.

Run: `npx vitest run tests/adminAccountService.test.ts tests/authenticatedValidation.test.ts tests/adminAccountActionRoutes.test.ts && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 3: Client failing test** (append to `tests/account-detail.test.jsx`)

```jsx
describe("usage this month", () => {
  it("shows the month's spend and opens the Usage tab for this person", async () => {
    const onOpenUsage = vi.fn();
    fetchAccountDetail.mockResolvedValue({ user: detail({ usageThisMonth: { costUsd: 1.4, runCount: 71 } }) });
    render(<AccountDetail userId="u2" onOpenUsage={onOpenUsage} />);

    expect(await screen.findByText("$1.40 · 71 runs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View in Usage" }));
    expect(onOpenUsage).toHaveBeenCalledWith({ id: "u2", label: "Ana Reyes" });
  });
});
```

Run: `npx vitest run --pool=threads tests/account-detail.test.jsx` — Expected: FAIL.

- [ ] **Step 4: Client implementation**

`AccountDetail.jsx` — accept `onOpenUsage` in props; import `fmtUsd` from `./usage/usageFormat.js` and `displayName` from `./accountLabels.js`. After the `<dl>` of fields, add:

```jsx
      {account.usageThisMonth && (
        <Section title="Agent usage this month">
          <div className="flex items-center justify-between gap-3 rounded-sm border border-border/10 bg-surface p-3">
            <span className="text-sm tabular-nums text-text-primary">
              {fmtUsd(account.usageThisMonth.costUsd)} · {account.usageThisMonth.runCount} runs
            </span>
            {onOpenUsage && (
              <button type="button" className={SECONDARY_ACTION} onClick={() => onOpenUsage({ id: account.id, label: displayName(account) })}>
                View in Usage
              </button>
            )}
          </div>
        </Section>
      )}
```

`AdminAccountsPage.jsx` — accept `onOpenUsage` and pass it to `<AccountDetail ... onOpenUsage={onOpenUsage} />`.

`AdminPage.jsx`:

```jsx
  const [usageFocus, setUsageFocus] = useState(null);

  const openUsageFor = (selection) => {
    setUsageFocus(selection);
    setSection("usage");
  };
```

```jsx
        {section === "accounts" && <AdminAccountsPage onOpenUsage={openUsageFor} />}
        {section === "usage" && <UsageSection key={usageFocus?.id ?? "all"} initialSelection={usageFocus} />}
```

and clear the focus when the admin switches tabs by hand: in the `SegmentedControl` `onChange`, use `(next) => { setUsageFocus(null); setSection(next); }`.

Run: `npx vitest run --pool=threads tests/account-detail.test.jsx tests/admin-page.test.jsx tests/admin-accounts-page.test.jsx` — Expected: PASS.

- [ ] **Step 5: Commit (once per repo)**

```bash
cd Voyage-Server && git add src/modules/admin tests && git commit -m "feat(admin): account detail includes this month's agent usage"
cd ../Voyage-Client && git add app/components/admin tests && git commit -m "feat(admin): account panel links to that person's usage"
```

---

### Task 16: Verify end to end

- [ ] **Step 1:** `cd Voyage-Server && npm test && npx tsc --noEmit`; `cd ../Voyage-Client && npm test`. Only Task 0 baseline failures may remain.
- [ ] **Step 2:** Restart the backend. Send two or three agent messages locally (one that fails, e.g. by stopping the network mid-run if practical, or skip and note it), then open Admin › Usage:
  1. This month shows non-zero spend (not `$0.000`) for runs made after Task 1; earlier runs keep their old cost.
  2. Range presets change the cards, chart and table; empty days show as gaps with dates under the chart.
  3. Users / Agencies / Chats each list rows with the right tags; clicking opens the drill-in; a run expands into its calls.
  4. From Accounts, "View in Usage" lands on that person's drill-in.
  5. In the DB, a new run's `modelName` is the Gemini model, not `gpt-5-mini`: `select "modelName", "costComplete" from agent_runs order by "createdAt" desc limit 3;` (check the table name in `schema.prisma` `@@map` if this errors).
- [ ] **Step 3:** Screenshot the Usage tab and a drill-in; report what passed and anything skipped.
