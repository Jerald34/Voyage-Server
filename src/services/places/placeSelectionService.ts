import { ApiError } from "../../http/errors";
import type { MapsProvider, ResolvedPlace } from "../maps/types";
import { statusIsFresh } from "./placeFreshness";
import type { PlaceRefreshScheduler, RefreshBudget } from "./placeRefreshScheduler";
import type { PlaceSnapshotRepository, PlaceSnapshotRow } from "./placeSnapshotRepository";
import type {
  BlockExplanation,
  GateInput,
  PlaceGate,
  PlaceItemInput,
  PlaceSelectionSession,
  PlaceVerdict,
  PreparedPlace
} from "./placeTypes";

/**
 * The single place where "may this place be attached or offered?" is decided.
 *
 * Cache hits, supplied snapshot IDs, freshly resolved names and raw provider tool
 * output all funnel through here, so none of those paths can bypass eligibility.
 * A session owns one agency's gate plus per-session memoization of raw lookups —
 * deliberately not of verdicts, so a closure another tool learns mid-run cannot be
 * bypassed by an earlier cached "allowed".
 */

export type PlaceSelectionServiceOptions = {
  repository: PlaceSnapshotRepository;
  maps: MapsProvider | null;
  scheduler: PlaceRefreshScheduler;
  createGate(agencyId: string | null): Promise<PlaceGate>;
  ttlMs: number;
  now(): Date;
  runBudget: RefreshBudget;
};

function pointOf(row: { latitude: number | null; longitude: number | null } | null | undefined) {
  if (!row) return null;
  const { latitude, longitude } = row;
  return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null;
}

function blockedError(name: string, verdict: Extract<PlaceVerdict, { allowed: false }>) {
  return new ApiError(409, "PLACE_BLOCKED", `${name} cannot be used: ${verdict.detail}`);
}

export function createPlaceSelectionService(options: PlaceSelectionServiceOptions) {
  const { repository, maps, scheduler, createGate, ttlMs, now, runBudget } = options;

  async function createSession(agencyId: string | null): Promise<PlaceSelectionSession> {
    const gate = await createGate(agencyId);
    const explanations: BlockExplanation[] = [];
    // Raw provider lookups only. Verdicts are never memoized.
    const resolveMemo = new Map<string, Promise<ResolvedPlace | null>>();

    function record(name: string, verdict: Extract<PlaceVerdict, { allowed: false }>) {
      explanations.push({ name, reason: verdict.reason, detail: verdict.detail });
    }

    /**
     * Refresh a snapshot's status when it is eligible, then read back what was
     * actually persisted. Budget exhaustion or provider failure simply leaves the
     * stored value in place.
     */
    async function refreshed(row: PlaceSnapshotRow): Promise<PlaceSnapshotRow> {
      if (statusIsFresh(row.businessStatusCheckedAt, now(), ttlMs)) {
        return row;
      }
      try {
        await scheduler.refresh(
          {
            id: row.id,
            provider: row.provider,
            providerPlaceId: row.providerPlaceId,
            businessStatusCheckedAt: row.businessStatusCheckedAt,
            metadata: row.metadata
          },
          runBudget
        );
      } catch {
        // A refresh failure is never allowed to fail the caller's operation.
        return row;
      }
      return (await repository.findByProviderId(row.provider, row.providerPlaceId)) ?? row;
    }

    function candidateFrom(row: PlaceSnapshotRow, cityContext?: string | null): GateInput {
      return {
        provider: row.provider,
        providerPlaceId: row.providerPlaceId,
        name: row.name,
        cityContext: cityContext ?? null,
        businessStatus: row.businessStatus
      };
    }

    /** Check a candidate, recording and throwing on a block. */
    function enforce(candidate: GateInput): void {
      const verdict = gate.check(candidate);
      if (!verdict.allowed) {
        record(candidate.name, verdict);
        throw blockedError(candidate.name, verdict);
      }
    }

    async function prepareBySnapshotId(
      placeSnapshotId: string,
      cityContext?: string | null
    ): Promise<PreparedPlace> {
      const stored = await repository.findById(placeSnapshotId);
      if (!stored) {
        throw new ApiError(
          404,
          "PLACE_SNAPSHOT_NOT_FOUND",
          `No stored place matches ${placeSnapshotId}. Resolve the place by name instead of reusing an unknown ID.`
        );
      }

      const current = await refreshed(stored);
      const candidate = candidateFrom(current, cityContext);
      enforce(candidate);

      return { placeSnapshotId: current.id, point: pointOf(current), candidate };
    }

    async function prepareByName(
      placeName: string,
      cityContext: string | null
    ): Promise<PreparedPlace> {
      // Agency name/city notes apply before any paid provider call.
      enforce({ name: placeName, cityContext });

      const cached = await repository.findCachedByName(placeName, cityContext).catch(() => null);
      // `fetchedAt` governs general data freshness; the status clock is separate
      // and handled by `refreshed` below.
      if (cached && statusIsFresh(cached.fetchedAt, now(), ttlMs)) {
        // Generally fresh cache hit: still subject to a status refresh and check.
        const current = await refreshed(cached);
        const candidate = candidateFrom(current, cityContext);
        enforce(candidate);
        return { placeSnapshotId: current.id, point: pointOf(current), candidate };
      }

      if (!maps) {
        // Nothing to resolve with. Nothing blocked it, so keep the existing
        // best-effort unresolved-item behavior.
        return { placeSnapshotId: undefined, point: null, candidate: null };
      }

      const key = `${placeName.trim().toLowerCase()}|${(cityContext ?? "").trim().toLowerCase()}`;
      if (!resolveMemo.has(key)) {
        resolveMemo.set(
          key,
          (async () => {
            try {
              return await maps.resolvePlace({
                placeName,
                cityContext: cityContext ?? undefined
              });
            } catch (error) {
              console.error(`[Places] Failed to resolve place: "${placeName}"`);
              return null;
            }
          })()
        );
      }

      const resolved = await resolveMemo.get(key)!;
      if (!resolved) {
        // Resolution failed and nothing blocked the name: preserve the previous
        // best-effort behavior of keeping the item without a snapshot.
        return { placeSnapshotId: undefined, point: null, candidate: null };
      }

      const observation =
        resolved.businessStatus && resolved.businessStatusCheckedAt
          ? {
              businessStatus: resolved.businessStatus,
              businessStatusCheckedAt: resolved.businessStatusCheckedAt
            }
          : null;

      let stored: PlaceSnapshotRow | null = null;
      try {
        stored = await repository.saveProviderCandidate({
          provider: resolved.provider,
          providerPlaceId: resolved.providerPlaceId,
          name: resolved.name,
          location: resolved.location ?? null,
          formattedAddress: resolved.formattedAddress ?? null,
          observation
        });
      } catch {
        // Persistence failed. The raw provider response is still evidence, so the
        // check below runs against it rather than silently allowing the place.
        stored = null;
      }

      const current = stored ? await refreshed(stored) : null;

      // Merge the stored observation over this response: a row may already carry a
      // newer closure that this particular response omitted.
      const candidate: GateInput = {
        provider: resolved.provider,
        providerPlaceId: resolved.providerPlaceId,
        name: resolved.name,
        cityContext,
        businessStatus: current?.businessStatus ?? resolved.businessStatus ?? null
      };
      enforce(candidate);

      return {
        placeSnapshotId: current?.id,
        point: pointOf(current) ?? resolved.location ?? null,
        candidate
      };
    }

    const session: PlaceSelectionSession = {
      agencyId,
      gate,
      notesUnavailable: !gate.notesAvailable,

      async prepare(item: PlaceItemInput, cityContextFallback?: string) {
        const cityContext = item.cityContext ?? cityContextFallback ?? null;

        if (item.placeSnapshotId) {
          return prepareBySnapshotId(item.placeSnapshotId, cityContext);
        }
        if (!item.placeName) {
          // A text-only entry carries no place identity; it stays valid and is
          // never advertised as a verified place.
          return { placeSnapshotId: undefined, point: null, candidate: null };
        }
        return prepareByName(item.placeName, cityContext);
      },

      evaluate(candidate: GateInput) {
        return gate.check(candidate);
      },

      async consider<T extends GateInput & { businessStatusCheckedAt?: Date }>(candidate: T) {
        let stored: PlaceSnapshotRow | null = null;

        if (candidate.provider && candidate.providerPlaceId) {
          const observation =
            candidate.businessStatus && candidate.businessStatusCheckedAt
              ? {
                  businessStatus: candidate.businessStatus,
                  businessStatusCheckedAt: candidate.businessStatusCheckedAt
                }
              : null;
          try {
            stored = observation
              ? await repository.saveProviderCandidate({
                  provider: candidate.provider,
                  providerPlaceId: candidate.providerPlaceId,
                  name: candidate.name,
                  observation
                })
              : await repository.findByProviderId(candidate.provider, candidate.providerPlaceId);
          } catch {
            stored = null;
          }
        }

        // A stored closure the caller's response omitted must still win.
        const merged: GateInput = {
          ...candidate,
          businessStatus: stored?.businessStatus ?? candidate.businessStatus ?? null
        };

        const verdict = gate.check(merged);
        if (!verdict.allowed) {
          record(candidate.name, verdict);
        }

        // Every caller payload field survives; only the status is reconciled.
        return { candidate: { ...candidate, businessStatus: merged.businessStatus } as T, verdict };
      },

      explanations() {
        return [...explanations];
      }
    };

    return session;
  }

  return { createSession };
}

export type PlaceSelectionService = ReturnType<typeof createPlaceSelectionService>;
