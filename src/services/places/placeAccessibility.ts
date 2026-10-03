import type { PlaceAccessibilityOptions } from "../maps/types";

/**
 * Stored under PlaceSnapshot.metadata.accessibility. Public provider data only:
 * snapshots are shared across agencies and published on share links.
 */
export type PlaceAccessibilityMetadata = PlaceAccessibilityOptions & {
  source: "GOOGLE_PLACES";
  checkedAt: string;
};

export function buildAccessibilityMetadata(
  options: PlaceAccessibilityOptions | undefined,
  checkedAt: Date
): PlaceAccessibilityMetadata {
  return { ...(options ?? {}), source: "GOOGLE_PLACES", checkedAt: checkedAt.toISOString() };
}

/** True once a details call has looked, even when Google had no accessibility data. */
export function hasAccessibilityCheck(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  const accessibility = (metadata as Record<string, unknown>).accessibility;
  return typeof accessibility === "object" && accessibility !== null;
}
