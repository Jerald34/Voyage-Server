import type { PrismaClient } from "@prisma/client";
import type { MapsProvider, ResolvedPlace } from "../../../services/maps";
import { isCloudinaryConfigured, uploadPlacePhoto } from "../../../services/cloudinary";
import { upsertPlaceSnapshot } from "./toolUtils";

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

  // Skip enrichment when the snapshot already has the critical fields populated
  // (e.g. from a prior run). Avoids redundant Place Details API calls.
  const meta = place.metadata as Record<string, unknown> | undefined;
  if (
    place.rating != null &&
    nonEmptyString(meta?.primaryPhotoUrl) &&
    place.websiteUrl !== undefined
  ) {
    return place;
  }

  let enriched = place;

  try {
    // Single getPlaceDetails call now returns both details AND photos (merged
    // field mask), eliminating the separate getPlacePhotos round-trip.
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

    // Extract photo URLs from the merged response (no second API call needed).
    if (Array.isArray(details.photos) && details.photos.length > 0) {
      const photoUrls = details.photos
        .map((photo) => photo.photoUri)
        .filter(nonEmptyString);
      if (photoUrls.length > 0) {
        let primaryPhotoUrl = photoUrls[0];

        // Cache the photo on Cloudinary so subsequent views don't bill Google.
        if (isCloudinaryConfigured()) {
          try {
            // Use a direct Google media URL (with API key) so Cloudinary can
            // fetch the image directly. The proxy URL (photoUri) points back
            // to our server which Cloudinary may not be able to reach
            // (especially in local dev or if the server is behind a firewall).
            const photoName = details.photos[0].name;
            const fetchableUrl = (photoName && maps?.getPhotoMediaUrl)
              ? maps.getPhotoMediaUrl(photoName)
              : primaryPhotoUrl;
            const uploaded = await uploadPlacePhoto(fetchableUrl, place.providerPlaceId);
            primaryPhotoUrl = uploaded.url;
          } catch (err) {
            // Cloudinary upload is best-effort; fall back to the proxy URL.
            console.error("[Enrichment] Cloudinary upload failed for", place.providerPlaceId, err);
          }
        }

        metadata.primaryPhotoUrl = primaryPhotoUrl;
        metadata.photoUrls = [primaryPhotoUrl];
      }
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

  return enriched;
}

// ---------------------------------------------------------------------------
// Post-run backfill
// ---------------------------------------------------------------------------

/**
 * Enrich PlaceSnapshots that were skipped during streaming (skipEnrichment=true).
 * Runs after the agent run completes so latency is invisible to the user.
 */
export async function backfillUnenrichedSnapshots(options: {
  itinerary: Record<string, unknown>;
  maps: MapsProvider;
  client: PrismaClient;
  concurrency?: number;
}) {
  const { maps, client, concurrency = 3 } = options;
  const days = Array.isArray(options.itinerary.days) ? options.itinerary.days : [];

  // Collect all placeSnapshotIds referenced by the itinerary.
  const snapshotIds = new Set<string>();
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const items = Array.isArray((day as any).items) ? (day as any).items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const psId = (item as any).placeSnapshotId;
      if (typeof psId === "string" && psId.length > 0) {
        snapshotIds.add(psId);
      }
      // Also check nested placeSnapshot.id
      const nested = (item as any).placeSnapshot;
      if (nested && typeof nested === "object" && typeof nested.id === "string") {
        snapshotIds.add(nested.id);
      }
    }
  }

  if (snapshotIds.size === 0) return;

  // Fetch all referenced snapshots and filter in JS for missing enrichment.
  // Prisma JSON path filtering (`metadata.path`) varies by adapter, so we
  // pull candidates by ID and check in JS for reliability.
  const candidates = await client.placeSnapshot.findMany({
    where: { id: { in: [...snapshotIds] } }
  }).catch(() => [] as any[]);

  const toEnrich = (candidates as any[]).filter((s: any) => {
    const meta = s.metadata as Record<string, unknown> | null;
    return s.rating == null || !nonEmptyString(meta?.primaryPhotoUrl);
  });

  if (toEnrich.length === 0) return;

  // Process with a simple concurrency limiter.
  let active = 0;
  const queue = [...toEnrich];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const snapshot = queue.shift()!;
      const place: ResolvedPlace = {
        provider: snapshot.provider ?? "GOOGLE_MAPS",
        providerPlaceId: snapshot.providerPlaceId,
        name: snapshot.name,
        formattedAddress: snapshot.formattedAddress ?? undefined,
        location: { latitude: snapshot.latitude, longitude: snapshot.longitude },
        rating: snapshot.rating ?? undefined,
        websiteUrl: snapshot.websiteUrl ?? undefined,
        phoneNumber: snapshot.phoneNumber ?? undefined,
        metadata: (snapshot.metadata as Record<string, unknown>) ?? {}
      };

      try {
        const enriched = await enrichResolvedPlaceForSnapshot(maps, place);
        await upsertPlaceSnapshot(client, enriched);
      } catch {
        // Best-effort; individual failures don't block others.
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, toEnrich.length) }, () => processNext());
  await Promise.all(workers);
}
