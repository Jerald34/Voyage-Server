import type { PlaceRefreshScheduler, RefreshSnapshot } from "../../services/places/placeRefreshScheduler";
import type { PlaceAdvisory, PlaceGate } from "../../services/places/placeTypes";

/**
 * Read-side overlays for saved itineraries.
 *
 * Nothing here is persisted: an advisory is a per-request, per-agency view over a
 * shared snapshot. Provider status lives on the snapshot and is global; agency
 * labels are scoped to the reading agency and must never reach a public share.
 */

const AGENCY_CLOSED_LABEL = "Agency marked closed";
const AGENCY_AVOID_LABEL = "Agency recommends avoiding";
const PERMANENTLY_CLOSED_LABEL = "Permanently closed";
const TEMPORARILY_CLOSED_LABEL = "Temporarily closed";

export const NOTES_UNAVAILABLE_ADVISORY: PlaceAdvisory = {
  reason: "NOTES_UNAVAILABLE",
  label: "Agency restrictions could not be checked. Review these places before confirming the trip."
};

type SnapshotLike = {
  id?: unknown;
  provider?: unknown;
  providerPlaceId?: unknown;
  name?: unknown;
  businessStatus?: unknown;
  businessStatusCheckedAt?: unknown;
  metadata?: unknown;
} | null;

type ItemLike = {
  placeSnapshot?: SnapshotLike;
  [key: string]: unknown;
};

/**
 * The advisory for one saved item, or null when there is nothing to say. An
 * agency verdict wins over the provider's, because it is the reading agency's own
 * decision; the provider's permanent closure is the next strongest signal.
 */
export function advisoryForItem(
  item: ItemLike,
  gate: Pick<PlaceGate, "check">,
  cityContext?: string | null
): PlaceAdvisory | null {
  const snapshot = item.placeSnapshot;
  if (!snapshot) return null;

  const name = typeof snapshot.name === "string" ? snapshot.name : "";
  const businessStatus =
    snapshot.businessStatus === "OPERATIONAL" ||
    snapshot.businessStatus === "CLOSED_TEMPORARILY" ||
    snapshot.businessStatus === "CLOSED_PERMANENTLY"
      ? snapshot.businessStatus
      : null;

  const verdict = gate.check({
    provider: snapshot.provider as never,
    providerPlaceId: typeof snapshot.providerPlaceId === "string" ? snapshot.providerPlaceId : undefined,
    name,
    cityContext: cityContext ?? null,
    businessStatus
  });

  if (!verdict.allowed) {
    if (verdict.reason === "AGENCY_CLOSED") return { reason: "AGENCY_CLOSED", label: AGENCY_CLOSED_LABEL };
    if (verdict.reason === "AGENCY_AVOID") return { reason: "AGENCY_AVOID", label: AGENCY_AVOID_LABEL };
    return { reason: "CLOSED_PERMANENTLY", label: PERMANENTLY_CLOSED_LABEL };
  }

  if (businessStatus === "CLOSED_TEMPORARILY") {
    return { reason: "CLOSED_TEMPORARILY", label: TEMPORARILY_CLOSED_LABEL };
  }

  return null;
}

/**
 * Attach `placeAdvisory` to each item and `placeAdvisories` to the itinerary.
 * Returns a new object; the stored record is never mutated and nothing is written.
 */
export function overlayPlaceAdvisories<T extends { days?: unknown }>(
  itinerary: T,
  gate: Pick<PlaceGate, "check" | "notesAvailable">
): T {
  const days = Array.isArray((itinerary as { days?: unknown }).days)
    ? ((itinerary as { days: unknown[] }).days as Array<Record<string, unknown>>)
    : [];

  const overlaidDays = days.map((day) => {
    const items = Array.isArray(day.items) ? (day.items as ItemLike[]) : [];
    return {
      ...day,
      items: items.map((item) => {
        const advisory = advisoryForItem(item, gate);
        return advisory ? { ...item, placeAdvisory: advisory } : item;
      })
    };
  });

  // A request-level warning, not a global provider status: it says this read
  // could not confirm the agency's own restrictions.
  const placeAdvisories = gate.notesAvailable ? [] : [NOTES_UNAVAILABLE_ADVISORY];

  return { ...itinerary, days: overlaidDays, placeAdvisories } as T;
}

/** Distinct snapshots of a loaded itinerary, shaped for the refresh scheduler. */
export function refreshableSnapshots(itinerary: { days?: unknown } | null | undefined): RefreshSnapshot[] {
  const days = Array.isArray(itinerary?.days) ? (itinerary!.days as Array<Record<string, unknown>>) : [];
  const seen = new Set<string>();
  const snapshots: RefreshSnapshot[] = [];

  for (const day of days) {
    const items = Array.isArray(day.items) ? (day.items as ItemLike[]) : [];
    for (const item of items) {
      const snapshot = item.placeSnapshot;
      if (!snapshot) continue;

      const provider = snapshot.provider;
      const providerPlaceId = snapshot.providerPlaceId;
      const id = snapshot.id;
      if (
        typeof id !== "string" ||
        typeof providerPlaceId !== "string" ||
        (provider !== "GOOGLE_MAPS" && provider !== "NOMINATIM")
      ) {
        continue;
      }

      const key = `${provider} ${providerPlaceId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const checkedAt = snapshot.businessStatusCheckedAt;
      snapshots.push({
        id,
        provider,
        providerPlaceId,
        businessStatusCheckedAt: checkedAt instanceof Date ? checkedAt : null,
        metadata: snapshot.metadata
      });
    }
  }

  return snapshots;
}

/**
 * Kick off the bounded background refresh for an authorized read. Synchronous and
 * best-effort: the read returns immediately with the data it already has, and a
 * scheduling failure never fails that read.
 */
export function scheduleSavedRead(
  scheduler: Pick<PlaceRefreshScheduler, "scheduleRead">,
  itinerary: { days?: unknown } | null | undefined
) {
  try {
    const snapshots = refreshableSnapshots(itinerary);
    if (snapshots.length > 0) scheduler.scheduleRead(snapshots);
  } catch (error) {
    console.error("[Places] Failed to schedule a saved-read status refresh.", error);
  }
}
