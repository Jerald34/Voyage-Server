// Public share branding helper — pure function, easily testable without DB.
// Called by the public share route after fetching share + itinerary + optional agency + creator.

import { createHash } from "node:crypto";
import type { PublicShareData } from "./shareTypes";

export type ShareBrandInput = {
  share: {
    agencyId: string | null;
    [key: string]: unknown;
  };
  agency: {
    id: string;
    name: string;
    logoImage: { bucket: string; objectKey: string; [key: string]: unknown } | null;
    [key: string]: unknown;
  } | null;
  itinerary: Record<string, unknown>;
  trip: Record<string, unknown> | null;
  creator: {
    id: string;
    displayName: string;
    [key: string]: unknown;
  };
};

export type ShareBrand =
  | { type: "agency"; name: string; logoUrl: string | null }
  | { type: "personal"; displayName: string };

export type ShareResponseWithBrand = {
  share: ShareBrandInput["share"];
  agency: ShareBrandInput["agency"];
  itinerary: ShareBrandInput["itinerary"];
  trip: ShareBrandInput["trip"];
  creator: ShareBrandInput["creator"];
  brand: ShareBrand;
};

function buildLogoUrl(
  logoImage: { bucket: string; objectKey: string; [key: string]: unknown } | null
): string | null {
  if (!logoImage) return null;
  // Build a public URL from bucket + objectKey if available.
  // The server currently stores images in GCS; the public URL pattern is:
  //   https://storage.googleapis.com/<bucket>/<objectKey>
  // If the objectKey already is a full URL, return as-is.
  const key = String(logoImage.objectKey ?? "");
  if (key.startsWith("https://") || key.startsWith("http://")) {
    return key;
  }
  const bucket = String(logoImage.bucket ?? "");
  if (!bucket || !key) return null;
  return `https://storage.googleapis.com/${bucket}/${key}`;
}

/**
 * Pure function: given the raw share row, optional agency, itinerary, and creator,
 * returns the full public share response payload including a `brand` discriminated union.
 */
export function buildShareResponse(input: ShareBrandInput): ShareResponseWithBrand & { brand: ShareBrand } {
  const { share, agency, itinerary, trip, creator } = input;

  let brand: ShareBrand;
  if (share.agencyId !== null && agency !== null) {
    brand = {
      type: "agency",
      name: agency.name,
      logoUrl: buildLogoUrl(agency.logoImage)
    };
  } else {
    brand = {
      type: "personal",
      displayName: creator.displayName
    };
  }

  return {
    share,
    agency,
    itinerary,
    trip,
    creator,
    brand
  };
}

/**
 * Builds the public share response from what the repository returned. The main
 * share route and the revision check both go through this, so the fingerprint
 * the check reports is computed from exactly what the page was given.
 */
export function buildShareResponseFromData(data: PublicShareData): ShareResponseWithBrand {
  return buildShareResponse({
    share: data.share,
    agency: data.agency,
    itinerary: data.itinerary as Record<string, unknown>,
    trip: data.trip as Record<string, unknown> | null,
    creator: data.creator
  });
}

// ---------- Revision fingerprint ----------

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The saved-place fields a background refresh rewrites on its own clock. The
 * agency did not edit them, so they must not read as an itinerary change. The
 * place's identity and its `businessStatus` (closed warnings) stay in.
 */
const REFRESHED_PLACE_FIELDS = ["rating", "metadata", "businessStatusCheckedAt"] as const;

function withoutKeys(record: PlainRecord, keys: readonly string[]): PlainRecord {
  const copy: PlainRecord = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

function visibleItem(item: unknown): unknown {
  if (!isPlainRecord(item) || !isPlainRecord(item.placeSnapshot)) return item;
  return { ...item, placeSnapshot: withoutKeys(item.placeSnapshot, REFRESHED_PLACE_FIELDS) };
}

function visibleDay(day: unknown): unknown {
  if (!isPlainRecord(day) || !Array.isArray(day.items)) return day;
  return { ...day, items: day.items.map(visibleItem) };
}

/**
 * The itinerary as the client reads it. `version` is a concurrency counter the
 * server bumps on structural edits; the page never shows it and it can move
 * without any visible change, so it is not part of the fingerprint.
 */
function visibleItinerary(itinerary: unknown): unknown {
  if (!isPlainRecord(itinerary)) return itinerary;
  const rest = withoutKeys(itinerary, ["version"]);
  return Array.isArray(rest.days) ? { ...rest, days: rest.days.map(visibleDay) } : rest;
}

/**
 * Plain JSON with object keys sorted, so the same content always serializes to
 * the same text. Dates and other `toJSON` values serialize as they do in the
 * HTTP response, which makes a Date and its ISO string hash alike.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;

  const withToJson = value as { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === "function") {
    return canonicalize(withToJson.toJSON());
  }
  if (Array.isArray(value)) return value.map(canonicalize);

  const sorted: PlainRecord = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as PlainRecord)[key];
    if (child !== undefined) sorted[key] = canonicalize(child);
  }
  return sorted;
}

/**
 * A short, stable fingerprint of the itinerary and trip a share page shows
 * (days, stops, times, notes, places, dates). Anything about the link itself
 * (views, expiry, revoke state, rating) and the agency or creator branding is
 * left out, so a page view or an Extend never looks like an edit.
 */
export function computeShareRevision(response: { itinerary: unknown; trip: unknown }): string {
  const canonical = canonicalize({
    itinerary: visibleItinerary(response.itinerary),
    trip: response.trip
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}
