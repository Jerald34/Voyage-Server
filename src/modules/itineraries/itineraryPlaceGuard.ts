import { ApiError } from "../../http/errors";
import type { PlaceSelectionSession } from "../../services/places/placeTypes";

/**
 * The single owner of "is this a new selection or a preserved stop?".
 *
 * Saved work survives: non-place edits, moves and full-replacement preservation
 * keep an existing stop even when it is closed. Anything that changes a stop's
 * place identity — a different snapshot ID, or a name that disagrees with the
 * stored one — is a new selection and must pass the gate.
 *
 * Every exemption here is computed from the authorized stored itinerary. No
 * request body can claim preservation.
 */

type PlaceBearingItem = {
  placeSnapshotId?: string | null;
  placeName?: string | null;
  cityContext?: string | null;
  [key: string]: unknown;
};

type StoredItem = {
  id?: unknown;
  placeSnapshotId?: unknown;
  placeSnapshot?: { id?: unknown; name?: unknown; latitude?: unknown; longitude?: unknown } | null;
};

type StoredItinerary = { days?: unknown } | null | undefined;

export type PreparedItem<T> = {
  item: T;
  point: { latitude: number; longitude: number } | null;
  placeSnapshotId: string | null;
};

const normalize = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

function storedItems(itinerary: StoredItinerary): StoredItem[] {
  const days = itinerary && typeof itinerary === "object" ? (itinerary as { days?: unknown }).days : null;
  if (!Array.isArray(days)) return [];

  const items: StoredItem[] = [];
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const dayItems = (day as { items?: unknown }).items;
    if (!Array.isArray(dayItems)) continue;
    for (const entry of dayItems) {
      if (entry && typeof entry === "object") items.push(entry as StoredItem);
    }
  }
  return items;
}

function snapshotIdOf(item: StoredItem): string | null {
  const direct = item.placeSnapshotId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const nested = item.placeSnapshot?.id;
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

function pointOf(item: StoredItem) {
  const latitude = item.placeSnapshot?.latitude;
  const longitude = item.placeSnapshot?.longitude;
  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : null;
}

/**
 * Decrement one preserved occurrence of `snapshotId`, returning whether the
 * replacement may keep it. Count-based because full replacement's schema has no
 * item IDs: preserving at most the stored count of each ID is the conservative
 * reading of "the same stops, rearranged".
 */
export function consumePreservedId(
  remaining: Map<string, number>,
  snapshotId: string | null | undefined
) {
  if (!snapshotId) return false;
  const count = remaining.get(snapshotId) ?? 0;
  if (count <= 0) return false;
  remaining.set(snapshotId, count - 1);
  return true;
}

/** How many times each snapshot ID legitimately appears in the stored itinerary. */
export function buildPreservationMap(itinerary: StoredItinerary): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of storedItems(itinerary)) {
    const id = snapshotIdOf(item);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Canonical stored name per snapshot ID, used to detect a conflicting rename. */
function buildCanonicalNames(itinerary: StoredItinerary): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of storedItems(itinerary)) {
    const id = snapshotIdOf(item);
    const name = item.placeSnapshot?.name;
    if (id && typeof name === "string" && !names.has(id)) names.set(id, name);
  }
  return names;
}

function assertSessionAgency(
  session: Pick<PlaceSelectionSession, "agencyId">,
  expectedAgencyId: string | null
) {
  if (session.agencyId !== expectedAgencyId) {
    throw new ApiError(
      500,
      "PLACE_SESSION_MISMATCH",
      "The place selection session does not match the authorized agency."
    );
  }
}

function maybeAssertAgency(
  options: { session: Pick<PlaceSelectionSession, "agencyId">; expectedAgencyId?: string | null },
  hasExpectation: boolean
) {
  if (hasExpectation) assertSessionAgency(options.session, options.expectedAgencyId ?? null);
}

/**
 * Prepare every place-bearing item of a create/add. Each supplied place is a new
 * selection, cached or not. A block rejects the whole batch before any mutation.
 */
export async function prepareItineraryItems<T extends PlaceBearingItem>(options: {
  session: Pick<PlaceSelectionSession, "agencyId" | "prepare">;
  items: T[];
  cityContextFallback?: string;
  expectedAgencyId?: string | null;
}): Promise<Array<PreparedItem<T>>> {
  maybeAssertAgency(options, "expectedAgencyId" in options);

  const prepared: Array<PreparedItem<T>> = [];
  for (const item of options.items) {
    const result = await options.session.prepare(
      {
        placeSnapshotId: item.placeSnapshotId ?? undefined,
        placeName: item.placeName ?? undefined,
        cityContext: item.cityContext ?? undefined
      },
      options.cityContextFallback
    );
    prepared.push({
      item: result.placeSnapshotId ? ({ ...item, placeSnapshotId: result.placeSnapshotId } as T) : item,
      point: result.point,
      placeSnapshotId: result.placeSnapshotId ?? null
    });
  }
  return prepared;
}

/**
 * Prepare a single-item patch. Only an identity change is a new selection; a
 * title, time or note edit keeps the existing stop and its route data untouched.
 */
export async function prepareUpdatedItem<T extends PlaceBearingItem>(options: {
  session: Pick<PlaceSelectionSession, "agencyId" | "prepare">;
  existingItinerary: StoredItinerary;
  itemId: string;
  patch: T;
  cityContextFallback?: string;
  expectedAgencyId?: string | null;
}): Promise<T> {
  maybeAssertAgency(options, "expectedAgencyId" in options);

  const { patch } = options;
  const suppliesId = typeof patch.placeSnapshotId === "string" && patch.placeSnapshotId.length > 0;
  const suppliesName = typeof patch.placeName === "string" && patch.placeName.trim().length > 0;

  if (!suppliesId && !suppliesName) {
    // Nothing about the place identity is being touched.
    return patch;
  }

  const existing = storedItems(options.existingItinerary).find((item) => item.id === options.itemId);
  if (!existing) {
    throw new ApiError(
      404,
      "ITINERARY_ITEM_NOT_FOUND",
      "The item does not belong to this itinerary."
    );
  }

  const storedId = snapshotIdOf(existing);
  const storedName = existing.placeSnapshot?.name;

  const idUnchanged = !suppliesId || patch.placeSnapshotId === storedId;
  // A conflicting name must be checked, not hidden behind an unchanged old ID.
  const nameUnchanged = !suppliesName || normalize(patch.placeName) === normalize(storedName);

  if (idUnchanged && nameUnchanged && storedId) {
    return patch;
  }

  // When the supplied name disagrees with the stored one, the old ID is stale:
  // resolve and check the name rather than letting the ID hide the change.
  const resolveByNameOnly = suppliesName && !nameUnchanged;

  const result = await options.session.prepare(
    {
      placeSnapshotId: !resolveByNameOnly && suppliesId ? patch.placeSnapshotId : undefined,
      placeName: suppliesName ? patch.placeName ?? undefined : undefined,
      cityContext: patch.cityContext ?? undefined
    },
    options.cityContextFallback
  );

  return result.placeSnapshotId ? ({ ...patch, placeSnapshotId: result.placeSnapshotId } as T) : patch;
}

/**
 * Prepare a full draft replacement. Each unchanged occurrence of a stored
 * snapshot ID is preserved, up to the count actually stored; added occurrences
 * and changed identities are new selections that must pass the gate.
 */
export async function prepareReplacementItems<
  D extends { items?: PlaceBearingItem[] | undefined }
>(options: {
  session: Pick<PlaceSelectionSession, "agencyId" | "prepare">;
  existingItinerary: StoredItinerary;
  days: D[];
  cityContextFallback?: string;
  expectedAgencyId?: string | null;
  /** Optional side output: coordinates of freshly prepared stops, for routing. */
  pointSink?: Map<string, { latitude: number; longitude: number }>;
}): Promise<D[]> {
  maybeAssertAgency(options, "expectedAgencyId" in options);

  const remaining = buildPreservationMap(options.existingItinerary);
  const canonicalNames = buildCanonicalNames(options.existingItinerary);

  const days: D[] = [];
  for (const day of options.days) {
    const items = Array.isArray(day.items) ? day.items : [];
    const nextItems: PlaceBearingItem[] = [];

    for (const item of items) {
      const suppliedId = typeof item.placeSnapshotId === "string" ? item.placeSnapshotId : null;
      const suppliesName = typeof item.placeName === "string" && item.placeName.trim().length > 0;
      const nameMatchesStored =
        !suppliesName || normalize(item.placeName) === normalize(canonicalNames.get(suppliedId ?? ""));

      // Only an unchanged identity is eligible to consume a preserved slot.
      if (suppliedId && nameMatchesStored && consumePreservedId(remaining, suppliedId)) {
        nextItems.push(item);
        continue;
      }

      // A supplied name that disagrees with the stored canonical name makes the
      // supplied ID stale; resolve by name so the new place is actually checked.
      const resolveByNameOnly = suppliesName && !nameMatchesStored;

      const result = await options.session.prepare(
        {
          placeSnapshotId: resolveByNameOnly ? undefined : suppliedId ?? undefined,
          placeName: item.placeName ?? undefined,
          cityContext: item.cityContext ?? undefined
        },
        options.cityContextFallback
      );
      if (result.placeSnapshotId && result.point) {
        options.pointSink?.set(result.placeSnapshotId, result.point);
      }
      nextItems.push(
        result.placeSnapshotId ? { ...item, placeSnapshotId: result.placeSnapshotId } : item
      );
    }

    days.push({ ...day, items: nextItems } as D);
  }

  return days;
}

/**
 * Trusted stored points for preserved stops, so routing keeps working without
 * re-resolving a place the caller is allowed to keep.
 */
export function storedPointsBySnapshotId(itinerary: StoredItinerary) {
  const points = new Map<string, { latitude: number; longitude: number }>();
  for (const item of storedItems(itinerary)) {
    const id = snapshotIdOf(item);
    const point = pointOf(item);
    if (id && point && !points.has(id)) points.set(id, point);
  }
  return points;
}
