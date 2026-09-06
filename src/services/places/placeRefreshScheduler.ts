import { isLegacyNominatim, statusIsFresh } from "./placeFreshness";
import type { PlaceBusinessStatus, PlaceProvider, StatusObservation } from "./placeTypes";

/**
 * Bounded, deduplicating status-only refresher.
 *
 * Every extra provider request in this feature goes through here so the caps in
 * design §5.1 are real: at most `perRead` requests started by one authorized
 * read, at most `concurrency` in flight process-wide, at most `perHour` per
 * process per rolling hour, and a `cooldownMs` retry pause after a failure.
 *
 * These are per-process limits, not a cluster-wide or monetary cap: a restart
 * resets them, and multi-instance budgeting is out of scope for this release.
 */

export type RefreshBudget = { remaining: number };

export type RefreshResult =
  | { kind: "updated" }
  | { kind: "fresh" | "unsupported" | "cooldown" | "budget" | "failed" };

export type RefreshSnapshot = {
  id: string;
  provider: PlaceProvider;
  providerPlaceId: string;
  businessStatusCheckedAt: Date | null;
  metadata?: unknown;
};

export type PlaceRefreshScheduler = {
  refresh(snapshot: RefreshSnapshot, budget: RefreshBudget): Promise<RefreshResult>;
  scheduleRead(snapshots: RefreshSnapshot[]): void;
  /** Test-only: resolves when the shared queue has drained. */
  drain(): Promise<void>;
  stats(): RefreshStats;
};

export type RefreshStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  unsupported: number;
  deduplicated: number;
  budgetSkipped: number;
  cooldownSkipped: number;
  freshSkipped: number;
  cooldownEntries: number;
  hourlyEntries: number;
};

export type PlaceRefreshSchedulerOptions = {
  now: () => Date;
  ttlMs: number;
  concurrency: number;
  perRead: number;
  perHour: number;
  cooldownMs: number;
  getPlaceStatus(placeId: string): Promise<{
    businessStatus?: PlaceBusinessStatus;
    businessStatusCheckedAt?: Date;
  }>;
  observeStatus(
    provider: PlaceProvider,
    providerPlaceId: string,
    observation: StatusObservation
  ): Promise<unknown>;
  logger?: Pick<Console, "error">;
};

const HOUR_MS = 60 * 60 * 1000;

function keyFor(snapshot: Pick<RefreshSnapshot, "provider" | "providerPlaceId">) {
  return `${snapshot.provider} ${snapshot.providerPlaceId}`;
}

export function createPlaceRefreshScheduler(
  options: PlaceRefreshSchedulerOptions
): PlaceRefreshScheduler {
  const logger = options.logger ?? console;

  /** In-flight work, shared so two callers for the same place await one request. */
  const inFlight = new Map<string, Promise<RefreshResult>>();
  /** Key -> time the cooldown expires. */
  const cooldownUntil = new Map<string, number>();
  /** Timestamps of requests actually issued, for the rolling hourly cap. */
  const hourlyRequests: number[] = [];

  const queue: RefreshSnapshot[] = [];
  let activeWorkers = 0;
  let drained: Promise<void> = Promise.resolve();

  const stats: RefreshStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    unsupported: 0,
    deduplicated: 0,
    budgetSkipped: 0,
    cooldownSkipped: 0,
    freshSkipped: 0,
    cooldownEntries: 0,
    hourlyEntries: 0
  };

  function expireBookkeeping(nowMs: number) {
    while (hourlyRequests.length > 0 && hourlyRequests[0] <= nowMs - HOUR_MS) {
      hourlyRequests.shift();
    }
    for (const [key, until] of cooldownUntil) {
      if (until <= nowMs) cooldownUntil.delete(key);
    }
  }

  /** True when the snapshot could never yield a Google status lookup. */
  function isUnsupported(snapshot: RefreshSnapshot) {
    return isLegacyNominatim(snapshot) || !snapshot.providerPlaceId;
  }

  function isSkippable(snapshot: RefreshSnapshot, nowMs: number) {
    if (isUnsupported(snapshot)) return "unsupported" as const;
    if (statusIsFresh(snapshot.businessStatusCheckedAt, new Date(nowMs), options.ttlMs)) {
      return "fresh" as const;
    }
    if ((cooldownUntil.get(keyFor(snapshot)) ?? 0) > nowMs) return "cooldown" as const;
    return null;
  }

  async function performRefresh(snapshot: RefreshSnapshot): Promise<RefreshResult> {
    const key = keyFor(snapshot);
    stats.attempted += 1;
    hourlyRequests.push(options.now().getTime());

    try {
      const response = await options.getPlaceStatus(snapshot.providerPlaceId);

      if (!response?.businessStatus) {
        // Absent or unrecognized status is a miss, not a reopening: cool down and
        // leave the stored status and its checked-at time untouched.
        stats.failed += 1;
        cooldownUntil.set(key, options.now().getTime() + options.cooldownMs);
        return { kind: "failed" };
      }

      await options.observeStatus(snapshot.provider, snapshot.providerPlaceId, {
        businessStatus: response.businessStatus,
        businessStatusCheckedAt: response.businessStatusCheckedAt ?? options.now()
      });
      stats.succeeded += 1;
      return { kind: "updated" };
    } catch (error) {
      stats.failed += 1;
      cooldownUntil.set(key, options.now().getTime() + options.cooldownMs);
      logger.error(
        `[Places] Status refresh failed for a ${snapshot.provider} place; applying cooldown.`,
        error instanceof Error ? error.name : "unknown error"
      );
      return { kind: "failed" };
    } finally {
      // Always release, even on throw, or the place would be permanently stuck.
      inFlight.delete(key);
      stats.cooldownEntries = cooldownUntil.size;
      stats.hourlyEntries = hourlyRequests.length;
    }
  }

  async function refresh(snapshot: RefreshSnapshot, budget: RefreshBudget): Promise<RefreshResult> {
    const nowMs = options.now().getTime();
    expireBookkeeping(nowMs);

    const skip = isSkippable(snapshot, nowMs);
    if (skip === "unsupported") {
      stats.unsupported += 1;
      return { kind: "unsupported" };
    }
    if (skip === "fresh") {
      stats.freshSkipped += 1;
      return { kind: "fresh" };
    }
    if (skip === "cooldown") {
      stats.cooldownSkipped += 1;
      return { kind: "cooldown" };
    }

    // Join existing work BEFORE charging a budget: a coalesced waiter costs
    // nothing extra, so it must not consume a token.
    const key = keyFor(snapshot);
    const existing = inFlight.get(key);
    if (existing) {
      stats.deduplicated += 1;
      return existing;
    }

    // Reserve run and hourly tokens only once we know we will issue a request.
    if (budget.remaining <= 0 || hourlyRequests.length >= options.perHour) {
      stats.budgetSkipped += 1;
      return { kind: "budget" };
    }
    budget.remaining -= 1;

    const work = performRefresh(snapshot);
    inFlight.set(key, work);
    return work;
  }

  function scheduleRead(snapshots: RefreshSnapshot[]) {
    const nowMs = options.now().getTime();
    expireBookkeeping(nowMs);

    // Filter unsupported/fresh/in-flight/cooldown entries BEFORE spending the
    // per-read allowance, so a repeatedly failing first item cannot starve the
    // rest of the itinerary read after read.
    const seen = new Set<string>();
    const eligible: RefreshSnapshot[] = [];

    for (const snapshot of snapshots) {
      const key = keyFor(snapshot);
      if (seen.has(key)) continue;
      seen.add(key);
      if (isSkippable(snapshot, nowMs)) continue;
      if (inFlight.has(key)) continue;
      eligible.push(snapshot);
    }

    // Never-checked first, then oldest check first.
    eligible.sort((a, b) => {
      const left = a.businessStatusCheckedAt?.getTime() ?? -Infinity;
      const right = b.businessStatusCheckedAt?.getTime() ?? -Infinity;
      return left - right;
    });

    const selected = eligible.slice(0, options.perRead);
    if (selected.length === 0) return;

    queue.push(...selected);
    // Background work: attach a catch so an unhandled rejection can never take
    // down the authorized read that scheduled it.
    drained = drain().catch(() => {});
  }

  async function drain(): Promise<void> {
    const readBudget: RefreshBudget = { remaining: Number.POSITIVE_INFINITY };

    async function worker() {
      while (queue.length > 0) {
        const snapshot = queue.shift()!;
        await refresh(snapshot, readBudget).catch(() => undefined);
      }
    }

    const capacity = Math.max(0, options.concurrency - activeWorkers);
    const workerCount = Math.min(capacity, queue.length);
    if (workerCount === 0) return drained;

    activeWorkers += workerCount;
    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      activeWorkers -= workerCount;
    }
  }

  return {
    refresh,
    scheduleRead,
    async drain() {
      // Keep draining while background work is still queued or in flight.
      while (queue.length > 0 || activeWorkers > 0 || inFlight.size > 0) {
        await drained.catch(() => {});
        await drain().catch(() => {});
        if (queue.length === 0 && activeWorkers === 0 && inFlight.size > 0) {
          await Promise.allSettled([...inFlight.values()]);
        }
      }
    },
    stats() {
      return {
        ...stats,
        cooldownEntries: cooldownUntil.size,
        hourlyEntries: hourlyRequests.length
      };
    }
  };
}
