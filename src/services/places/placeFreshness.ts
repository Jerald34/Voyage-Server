/**
 * Freshness helpers for the provider business-status clock.
 *
 * `businessStatusCheckedAt` is deliberately separate from `fetchedAt`: general
 * snapshot data can be refreshed by enrichment without that constituting a status
 * check, and a recently enriched row with a null status time is still eligible for
 * a status refresh.
 */

/**
 * True when a status observation is still inside the TTL. The boundary is
 * inclusive, so a check made exactly `ttlMs` ago still counts as fresh. A null,
 * undefined or invalid time is stale — unknown means unverified, never open.
 */
export function statusIsFresh(checkedAt: Date | null | undefined, now: Date, ttlMs: number) {
  return checkedAt instanceof Date &&
    Number.isFinite(checkedAt.getTime()) &&
    checkedAt.getTime() >= now.getTime() - ttlMs;
}

/**
 * True for snapshots that came from Nominatim, including rows written before the
 * provider label was fixed. Their IDs are OSM identifiers, so they must never be
 * sent to Google's Place Details endpoint as if they were Google place IDs.
 */
export function isLegacyNominatim(snapshot: {
  provider: string; metadata?: unknown;
}) {
  if (snapshot.provider === "NOMINATIM") return true;
  const metadata = snapshot.metadata;
  return Boolean(metadata && typeof metadata === "object" &&
    "osmType" in metadata && (metadata as { osmType?: unknown }).osmType);
}
