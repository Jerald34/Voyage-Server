import { describe, expect, it, vi } from "vitest";
import {
  createPlaceRefreshScheduler,
  type RefreshSnapshot
} from "../src/services/places/placeRefreshScheduler";

const DAY_MS = 24 * 60 * 60 * 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(overrides: Partial<RefreshSnapshot> = {}): RefreshSnapshot {
  return {
    id: "snap-1",
    provider: "GOOGLE_MAPS",
    providerPlaceId: "g-1",
    businessStatusCheckedAt: null,
    ...overrides
  };
}

/** Controllable clock so no test depends on real timers. */
function clock(start = new Date("2026-09-06T12:00:00.000Z")) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    }
  };
}

function build(overrides: Partial<Parameters<typeof createPlaceRefreshScheduler>[0]> = {}) {
  const time = clock();
  const observed: Array<{ providerPlaceId: string; businessStatus: string }> = [];
  const getPlaceStatus = vi.fn(async (_placeId: string) => ({
    businessStatus: "OPERATIONAL" as const,
    businessStatusCheckedAt: time.now()
  }));
  const observeStatus = vi.fn(async (_provider: any, providerPlaceId: string, observation: any) => {
    observed.push({ providerPlaceId, businessStatus: observation.businessStatus });
    return null;
  });

  const scheduler = createPlaceRefreshScheduler({
    now: time.now,
    ttlMs: 30 * DAY_MS,
    concurrency: 3,
    perRead: 10,
    perHour: 120,
    cooldownMs: 300_000,
    getPlaceStatus,
    observeStatus,
    ...overrides
  } as any);

  return { scheduler, time, getPlaceStatus, observeStatus, observed };
}

describe("refresh eligibility", () => {
  it("skips a snapshot whose status was checked inside the TTL", async () => {
    const { scheduler, time, getPlaceStatus } = build();
    const fresh = snapshot({ businessStatusCheckedAt: new Date(time.now().getTime() - DAY_MS) });

    const result = await scheduler.refresh(fresh, { remaining: 5 });

    expect(result.kind).toBe("fresh");
    expect(getPlaceStatus).not.toHaveBeenCalled();
  });

  it("skips Nominatim snapshots, including historically mislabelled rows", async () => {
    const { scheduler, getPlaceStatus } = build();

    expect((await scheduler.refresh(snapshot({ provider: "NOMINATIM" }), { remaining: 5 })).kind).toBe(
      "unsupported"
    );
    expect(
      (
        await scheduler.refresh(
          snapshot({ provider: "GOOGLE_MAPS", metadata: { osmType: "node" } }),
          { remaining: 5 }
        )
      ).kind
    ).toBe("unsupported");
    expect(getPlaceStatus).not.toHaveBeenCalled();
  });

  it("refreshes a stale snapshot and persists the observation", async () => {
    const { scheduler, getPlaceStatus, observed } = build();
    const budget = { remaining: 5 };

    const result = await scheduler.refresh(snapshot(), budget);

    expect(result.kind).toBe("updated");
    expect(getPlaceStatus).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([{ providerPlaceId: "g-1", businessStatus: "OPERATIONAL" }]);
    expect(budget.remaining).toBe(4);
  });

  it("refuses to spend an exhausted budget", async () => {
    const { scheduler, getPlaceStatus } = build();

    const result = await scheduler.refresh(snapshot(), { remaining: 0 });

    expect(result.kind).toBe("budget");
    expect(getPlaceStatus).not.toHaveBeenCalled();
  });
});

describe("failure handling and cooldown", () => {
  it("applies a cooldown after a failure and never advances status time", async () => {
    const getPlaceStatus = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const { scheduler, time, observeStatus } = build({ getPlaceStatus } as any);

    const first = await scheduler.refresh(snapshot(), { remaining: 5 });
    expect(first.kind).toBe("failed");
    expect(observeStatus).not.toHaveBeenCalled();

    const second = await scheduler.refresh(snapshot(), { remaining: 5 });
    expect(second.kind).toBe("cooldown");
    expect(getPlaceStatus).toHaveBeenCalledTimes(1);

    time.advance(300_000);
    const third = await scheduler.refresh(snapshot(), { remaining: 5 });
    expect(third.kind).toBe("failed");
    expect(getPlaceStatus).toHaveBeenCalledTimes(2);
  });

  it("treats an absent or unrecognized status as a cooldown-worthy miss", async () => {
    const getPlaceStatus = vi.fn(async () => ({}) as any);
    const { scheduler, observeStatus } = build({ getPlaceStatus } as any);

    expect((await scheduler.refresh(snapshot(), { remaining: 5 })).kind).toBe("failed");
    expect(observeStatus).not.toHaveBeenCalled();
    expect((await scheduler.refresh(snapshot(), { remaining: 5 })).kind).toBe("cooldown");
  });

  it("does not charge the budget for a cooldown skip", async () => {
    const getPlaceStatus = vi.fn(async () => {
      throw new Error("nope");
    });
    const { scheduler } = build({ getPlaceStatus } as any);
    const budget = { remaining: 5 };

    await scheduler.refresh(snapshot(), budget);
    expect(budget.remaining).toBe(4);

    await scheduler.refresh(snapshot(), budget);
    expect(budget.remaining).toBe(4);
  });
});

describe("deduplication and concurrency", () => {
  it("coalesces simultaneous callers onto one provider call and charges one budget", async () => {
    const gate = deferred<{ businessStatus: "OPERATIONAL"; businessStatusCheckedAt: Date }>();
    const getPlaceStatus = vi.fn(() => gate.promise);
    const { scheduler, time } = build({ getPlaceStatus } as any);

    const budgetA = { remaining: 5 };
    const budgetB = { remaining: 5 };
    const first = scheduler.refresh(snapshot(), budgetA);
    const second = scheduler.refresh(snapshot(), budgetB);

    gate.resolve({ businessStatus: "OPERATIONAL", businessStatusCheckedAt: time.now() });
    const [a, b] = await Promise.all([first, second]);

    expect(getPlaceStatus).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe("updated");
    expect(b.kind).toBe("updated");
    // Only the caller that actually started the request pays for it.
    expect(budgetA.remaining + budgetB.remaining).toBe(9);
  });

  it("never runs more than `concurrency` provider calls at once", async () => {
    let active = 0;
    let maxActive = 0;
    // Each call parks on a real async boundary, so every worker the scheduler
    // starts is genuinely in flight at the same time and the ceiling is observable.
    const getPlaceStatus = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        return { businessStatus: "OPERATIONAL" as const, businessStatusCheckedAt: new Date() };
      } finally {
        active -= 1;
      }
    });
    const { scheduler } = build({ getPlaceStatus, concurrency: 3 } as any);

    const snapshots = Array.from({ length: 8 }, (_, index) =>
      snapshot({ id: `snap-${index}`, providerPlaceId: `g-${index}` })
    );
    scheduler.scheduleRead(snapshots);
    await scheduler.drain();

    expect(maxActive).toBe(3);
    expect(getPlaceStatus).toHaveBeenCalledTimes(8);
  });

  it("lets two reads share one in-flight fetch for the same place", async () => {
    const gate = deferred<any>();
    const getPlaceStatus = vi.fn(() => gate.promise);
    const { scheduler, time } = build({ getPlaceStatus } as any);

    scheduler.scheduleRead([snapshot()]);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.scheduleRead([snapshot()]);

    gate.resolve({ businessStatus: "OPERATIONAL", businessStatusCheckedAt: time.now() });
    await scheduler.drain();

    expect(getPlaceStatus).toHaveBeenCalledTimes(1);
  });
});

describe("read scheduling", () => {
  it("caps one read at ten refreshes, oldest-checked first", async () => {
    const { scheduler, time, getPlaceStatus } = build();
    const base = time.now().getTime() - 90 * DAY_MS;

    const snapshots = Array.from({ length: 15 }, (_, index) =>
      snapshot({
        id: `snap-${index}`,
        providerPlaceId: `g-${index}`,
        // Descending age: index 14 is the oldest check, index 0 the newest.
        businessStatusCheckedAt: new Date(base - index * DAY_MS)
      })
    );
    // One never-checked snapshot must sort ahead of every dated one.
    snapshots.push(snapshot({ id: "snap-null", providerPlaceId: "g-null", businessStatusCheckedAt: null }));

    scheduler.scheduleRead(snapshots);
    await scheduler.drain();

    expect(getPlaceStatus).toHaveBeenCalledTimes(10);
    const requested = getPlaceStatus.mock.calls.map((call) => call[0]);
    expect(requested[0]).toBe("g-null");
    expect(requested).toContain("g-14");
    expect(requested).not.toContain("g-0");
  });

  it("deduplicates repeated IDs inside one read", async () => {
    const { scheduler, getPlaceStatus } = build();

    scheduler.scheduleRead([
      snapshot({ id: "a", providerPlaceId: "g-1" }),
      snapshot({ id: "b", providerPlaceId: "g-1" }),
      snapshot({ id: "c", providerPlaceId: "g-2" })
    ]);
    await scheduler.drain();

    expect(getPlaceStatus).toHaveBeenCalledTimes(2);
  });

  it("does not let a repeatedly failing item starve later items", async () => {
    const getPlaceStatus = vi.fn(async (placeId: string) => {
      if (placeId === "g-bad") throw new Error("always fails");
      return { businessStatus: "OPERATIONAL" as const, businessStatusCheckedAt: new Date() };
    });
    const { scheduler } = build({ getPlaceStatus, perRead: 2 } as any);

    const bad = snapshot({ id: "bad", providerPlaceId: "g-bad" });
    scheduler.scheduleRead([bad]);
    await scheduler.drain();
    expect(getPlaceStatus).toHaveBeenCalledWith("g-bad");

    // The failing item is now in cooldown; it must be filtered out BEFORE the
    // two-request allowance is spent, so both good items still get a turn.
    getPlaceStatus.mockClear();
    scheduler.scheduleRead([
      bad,
      snapshot({ id: "ok1", providerPlaceId: "g-ok1" }),
      snapshot({ id: "ok2", providerPlaceId: "g-ok2" })
    ]);
    await scheduler.drain();

    expect(getPlaceStatus.mock.calls.map((call) => call[0]).sort()).toEqual(["g-ok1", "g-ok2"]);
  });

  it("is synchronous and swallows background drain rejections", async () => {
    const getPlaceStatus = vi.fn(async () => {
      throw new Error("boom");
    });
    const { scheduler } = build({ getPlaceStatus } as any);

    expect(scheduler.scheduleRead([snapshot()])).toBeUndefined();
    await expect(scheduler.drain()).resolves.toBeUndefined();
  });
});

describe("process budgets", () => {
  it("enforces a rolling hourly cap and releases it after the window", async () => {
    const { scheduler, time, getPlaceStatus } = build({ perHour: 3 } as any);

    for (let index = 0; index < 5; index += 1) {
      await scheduler.refresh(
        snapshot({ id: `s${index}`, providerPlaceId: `g-${index}` }),
        { remaining: 100 }
      );
    }
    expect(getPlaceStatus).toHaveBeenCalledTimes(3);

    const blocked = await scheduler.refresh(
      snapshot({ id: "s9", providerPlaceId: "g-9" }),
      { remaining: 100 }
    );
    expect(blocked.kind).toBe("budget");

    time.advance(60 * 60 * 1000 + 1);
    const allowed = await scheduler.refresh(
      snapshot({ id: "s10", providerPlaceId: "g-10" }),
      { remaining: 100 }
    );
    expect(allowed.kind).toBe("updated");
    expect(getPlaceStatus).toHaveBeenCalledTimes(4);
  });

  it("counts a per-run budget in actual additional calls", async () => {
    const { scheduler, getPlaceStatus } = build();
    const runBudget = { remaining: 20 };

    for (let index = 0; index < 4; index += 1) {
      await scheduler.refresh(
        snapshot({ id: `s${index}`, providerPlaceId: `g-${index}` }),
        runBudget
      );
    }

    expect(getPlaceStatus).toHaveBeenCalledTimes(4);
    expect(runBudget.remaining).toBe(16);
  });

  it("treats a zero budget as disabling extra refreshes without erroring", async () => {
    const { scheduler, getPlaceStatus } = build({ perRead: 0, perHour: 0 } as any);

    scheduler.scheduleRead([snapshot()]);
    await scheduler.drain();

    expect(getPlaceStatus).not.toHaveBeenCalled();
  });
});

describe("bookkeeping hygiene", () => {
  it("releases in-flight entries so a later refresh can run again", async () => {
    const { scheduler, time, getPlaceStatus } = build();

    await scheduler.refresh(snapshot(), { remaining: 5 });
    expect(getPlaceStatus).toHaveBeenCalledTimes(1);

    // Same place, now genuinely stale again: the in-flight entry must be gone.
    time.advance(60 * DAY_MS);
    await scheduler.refresh(snapshot(), { remaining: 5 });
    expect(getPlaceStatus).toHaveBeenCalledTimes(2);
  });

  it("expires cooldown and hourly bookkeeping instead of growing forever", async () => {
    const getPlaceStatus = vi.fn(async () => {
      throw new Error("fail");
    });
    const { scheduler, time } = build({ getPlaceStatus } as any);

    for (let index = 0; index < 5; index += 1) {
      await scheduler.refresh(
        snapshot({ id: `s${index}`, providerPlaceId: `g-${index}` }),
        { remaining: 100 }
      );
    }
    expect(scheduler.stats().cooldownEntries).toBe(5);

    time.advance(300_000 + 1);
    await scheduler.refresh(snapshot({ id: "s0", providerPlaceId: "g-0" }), { remaining: 100 });

    expect(scheduler.stats().cooldownEntries).toBeLessThanOrEqual(5);
    expect(scheduler.stats().hourlyEntries).toBeLessThanOrEqual(6);
  });

  it("reports redacted counters without note text or credentials", async () => {
    const { scheduler } = build();

    await scheduler.refresh(snapshot(), { remaining: 5 });
    await scheduler.refresh(snapshot({ provider: "NOMINATIM" }), { remaining: 5 });
    await scheduler.refresh(snapshot({ id: "x", providerPlaceId: "g-2" }), { remaining: 0 });

    const stats = scheduler.stats();
    expect(stats.attempted).toBe(1);
    expect(stats.succeeded).toBe(1);
    expect(stats.unsupported).toBe(1);
    expect(stats.budgetSkipped).toBe(1);
    expect(JSON.stringify(stats)).not.toMatch(/http|key|password|@/i);
  });
});
