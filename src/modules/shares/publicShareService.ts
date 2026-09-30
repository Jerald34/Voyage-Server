// Public share branding helper — pure function, easily testable without DB.
// Called by the public share route after fetching share + itinerary + optional agency + creator.

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
