import type { MapsProvider, ResolvedPlace } from "../../../services/maps";

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function enrichResolvedPlaceForSnapshot(
  maps: MapsProvider | null | undefined,
  place: ResolvedPlace
): Promise<ResolvedPlace> {
  if (!maps || !place.providerPlaceId) {
    return place;
  }

  let enriched = place;

  try {
    const details = await maps.getPlaceDetails(place.providerPlaceId);
    const metadata: Record<string, unknown> = {
      ...(enriched.metadata ?? {})
    };

    if (Array.isArray(details.types) && details.types.length > 0) {
      metadata.googleTypes = details.types;
    }
    if (typeof details.userRatingCount === "number") {
      metadata.userRatingCount = details.userRatingCount;
    }
    if (nonEmptyString(details.websiteUri)) {
      metadata.websiteUri = details.websiteUri;
    }
    if (nonEmptyString(details.phoneNumber)) {
      metadata.phoneNumber = details.phoneNumber;
    }

    enriched = {
      ...enriched,
      name: nonEmptyString(details.name) ? details.name : enriched.name,
      formattedAddress: nonEmptyString(details.address) ? details.address : enriched.formattedAddress,
      location: details.location ?? enriched.location,
      rating: typeof details.rating === "number" ? details.rating : enriched.rating,
      websiteUrl: nonEmptyString(details.websiteUri) ? details.websiteUri : enriched.websiteUrl,
      phoneNumber: nonEmptyString(details.phoneNumber) ? details.phoneNumber : enriched.phoneNumber,
      metadata
    };
  } catch {
    // Some providers or deployments cannot return details; keep the resolved place usable.
  }

  try {
    const photos = await maps.getPlacePhotos(place.providerPlaceId, 3);
    const photoUrls = photos
      .map((photo) => photo.photoUri)
      .filter(nonEmptyString);

    if (photoUrls.length > 0) {
      enriched = {
        ...enriched,
        metadata: {
          ...(enriched.metadata ?? {}),
          primaryPhotoUrl: photoUrls[0],
          photoUrls
        }
      };
    }
  } catch {
    // Snapshot enrichment is best-effort and must not block itinerary creation.
  }

  return enriched;
}
