import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/modules/dashboard/cache";

/** Counts the live entries by probing each key; `get` also drops expired ones. */
function liveKeys(cache: TtlCache<number>, keys: string[]): string[] {
  return keys.filter((key) => cache.get(key) !== null);
}

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a stored value until its TTL passes", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);

    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(1);

    vi.advanceTimersByTime(1);
    expect(cache.get("a")).toBeNull();
  });

  it("invalidates one key and clears them all", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.invalidate("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe(2);

    cache.clear();
    expect(cache.get("b")).toBeNull();
  });

  it("invalidates every key that starts with a prefix, and only those", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("agency-1:owner:30d", 1);
    cache.set("agency-1:staff:30d:user-a", 2);
    cache.set("agency-10:owner:30d", 3);
    cache.set("agency-2:owner:30d", 4);

    cache.invalidatePrefix("agency-1:");

    expect(cache.get("agency-1:owner:30d")).toBeNull();
    expect(cache.get("agency-1:staff:30d:user-a")).toBeNull();
    expect(cache.get("agency-10:owner:30d")).toBe(3);
    expect(cache.get("agency-2:owner:30d")).toBe(4);
  });

  it("never holds more than the cap, however many keys are set", () => {
    const cache = new TtlCache<number>(60_000, 3);
    const keys = Array.from({ length: 50 }, (_, index) => `key-${index}`);
    for (const [index, key] of keys.entries()) {
      cache.set(key, index);
      expect(liveKeys(cache, keys).length).toBeLessThanOrEqual(3);
    }
    expect(liveKeys(cache, keys)).toEqual(["key-47", "key-48", "key-49"]);
  });

  it("drops expired entries before evicting live ones", () => {
    const cache = new TtlCache<number>(1000, 3);
    cache.set("old-1", 1);
    cache.set("old-2", 2);
    vi.advanceTimersByTime(600);
    cache.set("fresh", 3);
    vi.advanceTimersByTime(500); // old-1 and old-2 are now expired; fresh is not

    cache.set("new", 4); // at the cap: the two expired entries go, "fresh" stays

    expect(liveKeys(cache, ["old-1", "old-2", "fresh", "new"])).toEqual(["fresh", "new"]);
  });

  it("evicts the oldest entry when every entry is still live", () => {
    const cache = new TtlCache<number>(60_000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    cache.set("d", 4);

    expect(liveKeys(cache, ["a", "b", "c", "d"])).toEqual(["b", "c", "d"]);
  });

  it("refreshes a re-set key so it counts as the newest", () => {
    const cache = new TtlCache<number>(60_000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    cache.set("a", 10); // existing key: no eviction, and "a" moves to newest
    expect(liveKeys(cache, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(cache.get("a")).toBe(10);

    cache.set("d", 4); // now "b" is the oldest
    expect(liveKeys(cache, ["a", "b", "c", "d"])).toEqual(["a", "c", "d"]);
  });

  it("restarts the TTL when a key is set again", () => {
    const cache = new TtlCache<number>(1000, 3);
    cache.set("a", 1);
    vi.advanceTimersByTime(800);
    cache.set("a", 2);
    vi.advanceTimersByTime(800);
    expect(cache.get("a")).toBe(2);
  });

  it("defaults to a cap of 1000 entries", () => {
    const cache = new TtlCache<number>(60_000);
    for (let index = 0; index < 1005; index += 1) {
      cache.set(`key-${index}`, index);
    }
    expect(cache.get("key-4")).toBeNull();
    expect(cache.get("key-5")).toBe(5);
    expect(cache.get("key-1004")).toBe(1004);
  });
});
