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
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

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

  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Drops every entry whose key starts with `prefix`, e.g. all of one agency's keys. */
  invalidatePrefix(prefix: string): void {
    // Deleting while iterating a Map is safe: removed keys are simply not visited.
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
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
