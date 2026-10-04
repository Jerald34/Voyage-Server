/**
 * Simple in-memory TTL cache with lazy expiry on get and a size cap.
 *
 * No background reaper. An entry past its TTL is dropped when it is read, or
 * when a new key is added while the cache is full. Some keys come straight
 * from requests (the calendar key includes the requested date range), so the
 * key space is not bounded by agencies and views alone: `maxEntries` keeps the
 * store from growing without limit. When a new key arrives at the cap, expired
 * entries go first, then the oldest by insertion order. Setting an existing
 * key refreshes it and moves it to the newest position.
 *
 * A fill that started before an invalidation must not undo it. Read
 * `generation` before the slow fetch and write with `setIfCurrent`: if
 * `invalidate`, `invalidatePrefix` or `clear` ran in between, the write is
 * skipped instead of caching the stale result. The counter is global, not per
 * key or prefix, so an invalidation for one agency also makes another agency's
 * in-flight fill skip caching once. That costs one extra fetch and keeps this
 * simple.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  private currentGeneration = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000
  ) {}

  get(key: string): V | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) {
      // Delete first so the re-set key moves to the newest position.
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      this.makeRoom();
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Bumped by every invalidation; read it before a slow fetch, pass it to `setIfCurrent`. */
  get generation(): number {
    return this.currentGeneration;
  }

  /** Like `set`, but does nothing if the cache was invalidated since `generation` was read. */
  setIfCurrent(key: string, value: V, generation: number): void {
    if (generation !== this.currentGeneration) return;
    this.set(key, value);
  }

  invalidate(key: string): void {
    this.currentGeneration += 1;
    this.store.delete(key);
  }

  /** Drops every entry whose key starts with `prefix`, e.g. all of one agency's keys. */
  invalidatePrefix(prefix: string): void {
    this.currentGeneration += 1;
    // Deleting while iterating a Map is safe: removed keys are simply not visited.
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.currentGeneration += 1;
    this.store.clear();
  }

  /** Frees space for one new entry: expired entries first, then the oldest. */
  private makeRoom(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
    // Map iteration order is insertion order, so the first key is the oldest.
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }
}
