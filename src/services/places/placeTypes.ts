import type { AgencyPlaceNoteStatus, PlaceBusinessStatus, PlaceProvider } from "@prisma/client";

export type { AgencyPlaceNoteStatus, PlaceBusinessStatus, PlaceProvider };

/**
 * The normalized shape every place candidate is reduced to before it is checked.
 * Provider results, cache hits and supplied snapshot IDs all normalize into this.
 */
export type GateInput = {
  provider?: PlaceProvider;
  providerPlaceId?: string;
  name: string;
  cityContext?: string | null;
  businessStatus?: PlaceBusinessStatus | null;
};

export type BlockReason = "CLOSED_PERMANENTLY" | "AGENCY_AVOID" | "AGENCY_CLOSED";

export type PlaceVerdict =
  | { allowed: true; advisory?: string }
  | { allowed: false; reason: BlockReason; detail: string };

/** The note fields safe to surface in staff/agent context: no IDs, no authorship. */
export type NoteView = {
  status: AgencyPlaceNoteStatus;
  placeName: string;
  cityContext: string | null;
  note: string | null;
};

export type PlaceNote = NoteView & {
  provider: PlaceProvider | null;
  providerPlaceId: string | null;
};

export type PlaceAdvisory = {
  reason: BlockReason | "CLOSED_TEMPORARILY" | "STATUS_UNVERIFIED" | "NOTES_UNAVAILABLE";
  label: string;
};

export type PlaceGate = {
  /** False when the agency's notes could not be loaded; provider filtering still applies. */
  notesAvailable: boolean;
  check(place: GateInput): PlaceVerdict;
  partition<T extends GateInput>(places: T[]): {
    allowed: T[];
    blocked: Array<{ result: T; verdict: Extract<PlaceVerdict, { allowed: false }> }>;
  };
  notesFor(cityContext?: string | null): NoteView[];
};

export type StatusObservation = {
  businessStatus: PlaceBusinessStatus;
  // Time immediately before the successful provider request was issued.
  businessStatusCheckedAt: Date;
};

/** The place-bearing fields of an itinerary item, as supplied by a caller. */
export type PlaceItemInput = {
  placeSnapshotId?: string | null;
  placeName?: string;
  cityContext?: string | null;
};

export type PreparedPlace = {
  placeSnapshotId?: string;
  point: { latitude: number; longitude: number } | null;
  candidate: GateInput | null;
};

export type BlockExplanation = {
  name: string;
  reason: string;
  detail: string;
};

/**
 * One agency-scoped selection session. Created per request or per agent run and
 * passed explicitly; never stored on a singleton, so two agencies can never see
 * each other's notes.
 */
export type PlaceSelectionSession = {
  agencyId: string | null;
  gate: PlaceGate;
  /** Resolve an item's place, checking eligibility. Throws PLACE_BLOCKED. */
  prepare(item: PlaceItemInput, cityContextFallback?: string): Promise<PreparedPlace>;
  /** Pure check against the loaded gate; no I/O. */
  evaluate(candidate: GateInput): PlaceVerdict;
  /** Async counterpart for raw provider output: persists, merges, then checks. */
  consider<T extends GateInput & { businessStatusCheckedAt?: Date }>(
    candidate: T
  ): Promise<{ candidate: T; verdict: PlaceVerdict }>;
  explanations(): BlockExplanation[];
  notesUnavailable: boolean;
};
