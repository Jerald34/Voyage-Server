/**
 * backfillRunCosts.ts
 *
 * One-off repricing of historic `AgentRun` rows (CLI: scripts/backfill-agent-run-costs.ts).
 * Old runs were priced with the previous logic (wrong cached rate, thinking tokens unbilled, a
 * model missing from the price table recorded as $0, run modelName always "gpt-5-mini"). Each
 * run's `usageDetail` still holds the per-call tokens, so cost, costComplete and modelName can
 * be recomputed from the current price table.
 *
 * Dry-run is the default; nothing is written unless `apply` is set. Token columns are never
 * touched, and `updatedAt` is preserved because the run itself did not change.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { repriceUsageDetail } from "./repriceRunUsage";

export type BackfillClient = Pick<PrismaClient, "agentRun">;

export interface RunRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  modelName: string;
  costUsd: { toString(): string } | number | null;
  costComplete: boolean;
  usageDetail: unknown;
}

export interface RunPlan {
  id: string;
  createdAt: Date;
  changed: boolean;
  old: { costUsd: number | null; costComplete: boolean; modelName: string };
  next: { costUsd: number; costComplete: boolean; modelName: string };
  /** model name -> number of this run's calls that had no price. */
  unpricedCalls: Record<string, number>;
  /** Exactly what `--apply` writes for this run. */
  data: Prisma.AgentRunUpdateInput;
}

export interface BackfillSummary {
  scanned: number;
  changed: number;
  applied: number;
  skippedNoDetail: number;
  oldTotalUsd: number;
  newTotalUsd: number;
  /** model name -> runs and calls that stay unpriced after repricing. */
  unpricedModels: Record<string, { runs: number; calls: number }>;
}

export interface BackfillOptions {
  apply: boolean;
  batchSize?: number;
  log?: (line: string) => void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host only (no credentials, port or database name); "unknown" when the URL does not parse. */
export function databaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** Writes are only allowed against a local database unless the operator explicitly opts in. */
export function assertApplyAllowed(opts: { databaseUrl: string; apply: boolean; allowRemote: boolean }): void {
  if (!opts.apply || opts.allowRemote) return;
  const host = databaseHost(opts.databaseUrl);
  if (!isLocalHost(host)) {
    throw new Error(
      `Refusing --apply: DATABASE_URL points at "${host}", which is not localhost/127.0.0.1. ` +
        "Re-run with --allow-remote if you really mean to write to that database."
    );
  }
}

/** Costs are stored as Decimal(12,6). */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Reprices one run. Returns null when the run has no usable per-call detail to reprice. */
export function planRunUpdate(row: RunRow): RunPlan | null {
  const repriced = repriceUsageDetail(row.usageDetail);
  if (!repriced || repriced.detail.length === 0) return null;

  const oldCost = row.costUsd === null ? null : round6(Number(row.costUsd.toString()));
  const newCost = round6(repriced.costUsd);
  const nextModel = repriced.modelName ?? row.modelName;

  const changed =
    oldCost !== newCost ||
    row.costComplete !== repriced.costComplete ||
    row.modelName !== nextModel ||
    canonical(row.usageDetail) !== canonical(repriced.detail);

  const unpricedCalls: Record<string, number> = {};
  for (const e of repriced.detail) {
    if (e.costUsd === null) unpricedCalls[e.modelName] = (unpricedCalls[e.modelName] ?? 0) + 1;
  }

  return {
    id: row.id,
    createdAt: row.createdAt,
    changed,
    old: { costUsd: oldCost, costComplete: row.costComplete, modelName: row.modelName },
    next: { costUsd: newCost, costComplete: repriced.costComplete, modelName: nextModel },
    unpricedCalls,
    data: {
      costUsd: newCost,
      costComplete: repriced.costComplete,
      usageDetail: repriced.detail as unknown as Prisma.InputJsonValue,
      ...(repriced.modelName ? { modelName: repriced.modelName } : {}),
      // keep the run's own last-modified time; only its cost bookkeeping is corrected
      updatedAt: row.updatedAt
    }
  };
}

const usd = (n: number | null): string => (n === null ? "null" : `$${n.toFixed(6)}`);

export async function backfillRunCosts(client: BackfillClient, options: BackfillOptions): Promise<BackfillSummary> {
  const batchSize = options.batchSize ?? 200;
  const log = options.log ?? (() => {});
  const summary: BackfillSummary = {
    scanned: 0,
    changed: 0,
    applied: 0,
    skippedNoDetail: 0,
    oldTotalUsd: 0,
    newTotalUsd: 0,
    unpricedModels: {}
  };

  let cursor: string | undefined;
  for (;;) {
    const rows: RunRow[] = await client.agentRun.findMany({
      where: { usageDetail: { not: Prisma.DbNull } },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        modelName: true,
        costUsd: true,
        costComplete: true,
        usageDetail: true
      }
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const plan = planRunUpdate(row);
      if (!plan) {
        summary.skippedNoDetail += 1;
        continue;
      }
      summary.scanned += 1;
      summary.oldTotalUsd += plan.old.costUsd ?? 0;
      summary.newTotalUsd += plan.next.costUsd;
      for (const [name, calls] of Object.entries(plan.unpricedCalls)) {
        const seen = summary.unpricedModels[name] ?? { runs: 0, calls: 0 };
        summary.unpricedModels[name] = { runs: seen.runs + 1, calls: seen.calls + calls };
      }
      if (!plan.changed) continue;

      summary.changed += 1;
      log(
        `${plan.id}  ${plan.createdAt.toISOString().slice(0, 10)}  ` +
          `cost ${usd(plan.old.costUsd)} -> ${usd(plan.next.costUsd)}  ` +
          `model ${plan.old.modelName} -> ${plan.next.modelName}  ` +
          `costComplete ${plan.old.costComplete} -> ${plan.next.costComplete}`
      );
      if (options.apply) {
        await client.agentRun.update({ where: { id: plan.id }, data: plan.data });
        summary.applied += 1;
      }
    }

    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }

  summary.oldTotalUsd = round6(summary.oldTotalUsd);
  summary.newTotalUsd = round6(summary.newTotalUsd);
  return summary;
}
