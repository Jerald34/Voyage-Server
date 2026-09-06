import type { PrismaClient } from "@prisma/client";
import type { GeoPoint, ResolvedPlace } from "../maps/types";
import type { PlaceBusinessStatus, PlaceProvider, StatusObservation } from "./placeTypes";

/**
 * Owns every PlaceSnapshot write so the places services never have to import
 * agent tool modules. Two write paths are kept deliberately separate:
 *
 *  - General data writes (`upsertPlaceSnapshot`, `saveProviderCandidate`) move
 *    `fetchedAt` and never touch the status columns except when a create carries
 *    a recognized observation.
 *  - Status observations (`observeStatus`) move only the status columns, and only
 *    forward in time.
 */

export type PlaceSnapshotRow = {
  id: string;
  provider: PlaceProvider;
  providerPlaceId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  businessStatus: PlaceBusinessStatus | null;
  businessStatusCheckedAt: Date | null;
  metadata?: unknown;
};

export type SaveProviderCandidateInput = {
  provider: PlaceProvider;
  providerPlaceId: string;
  name: string;
  /** Search and status responses may legitimately carry no coordinates. */
  location?: GeoPoint | null;
  formattedAddress?: string | null;
  observation?: StatusObservation | null;
};

/** The stored provider label. NOMINATIM is a real value in the enum — keep it. */
export function toPlaceSnapshotProvider(provider: ResolvedPlace["provider"]): PlaceProvider {
  return provider;
}

export function createPlaceSnapshotRepository(client: PrismaClient) {
  const snapshots = client.placeSnapshot as any;

  async function readRow(provider: PlaceProvider, providerPlaceId: string): Promise<PlaceSnapshotRow | null> {
    return (await snapshots.findUnique({
      where: { provider_providerPlaceId: { provider, providerPlaceId } }
    })) as PlaceSnapshotRow | null;
  }

  return {
    /**
     * General data upsert for a fully resolved place. Deliberately writes no
     * status fields: a data refresh is not a status check, and a reconstructed
     * cached object must never be able to stamp the status clock.
     */
    async upsertPlaceSnapshot(place: ResolvedPlace) {
      const data = {
        name: place.name,
        formattedAddress: place.formattedAddress,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        rating: place.rating,
        websiteUrl: place.websiteUrl,
        phoneNumber: place.phoneNumber,
        metadata: place.metadata as any,
        fetchedAt: new Date()
      };

      return snapshots.upsert({
        where: {
          provider_providerPlaceId: {
            provider: toPlaceSnapshotProvider(place.provider),
            providerPlaceId: place.providerPlaceId
          }
        },
        create: {
          provider: toPlaceSnapshotProvider(place.provider),
          providerPlaceId: place.providerPlaceId,
          ...data
        },
        update: data
      });
    },

    /**
     * Persist a provider candidate that may lack coordinates (a text search hit,
     * for instance). A recognized observation is written atomically with a new
     * row; for an existing row the conditional `observeStatus` path applies so an
     * older response cannot overwrite a newer one.
     */
    async saveProviderCandidate(input: SaveProviderCandidateInput): Promise<PlaceSnapshotRow | null> {
      const now = new Date();
      const base = {
        name: input.name,
        formattedAddress: input.formattedAddress ?? undefined,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        fetchedAt: now
      };

      const row = (await snapshots.upsert({
        where: {
          provider_providerPlaceId: {
            provider: input.provider,
            providerPlaceId: input.providerPlaceId
          }
        },
        create: {
          provider: input.provider,
          providerPlaceId: input.providerPlaceId,
          ...base,
          ...(input.observation
            ? {
                businessStatus: input.observation.businessStatus,
                businessStatusCheckedAt: input.observation.businessStatusCheckedAt
              }
            : {})
        },
        update: base
      })) as PlaceSnapshotRow;

      if (!input.observation) {
        return row;
      }

      // The create path already stamped the observation; the update path did not,
      // so apply the conditional write and re-read the persisted truth.
      return this.observeStatus(input.provider, input.providerPlaceId, input.observation);
    },

    /**
     * Record a status observation against an existing snapshot. The update is
     * conditional so a slower, older response can never overwrite a newer one; a
     * tie does not replace what is stored. Returns the persisted row so callers
     * decide on stored status rather than on their own possibly-stale response.
     */
    async observeStatus(
      provider: PlaceProvider,
      providerPlaceId: string,
      observation: StatusObservation
    ): Promise<PlaceSnapshotRow | null> {
      const existing = await readRow(provider, providerPlaceId);
      if (!existing) {
        // A status-only response must not conjure a snapshot: we have no name or
        // coordinates for it, and the row would be unusable.
        return null;
      }

      await snapshots.updateMany({
        where: {
          provider,
          providerPlaceId,
          OR: [
            { businessStatusCheckedAt: null },
            { businessStatusCheckedAt: { lt: observation.businessStatusCheckedAt } }
          ]
        },
        data: {
          businessStatus: observation.businessStatus,
          businessStatusCheckedAt: observation.businessStatusCheckedAt
        }
      });

      return readRow(provider, providerPlaceId);
    },

    findByProviderId(provider: PlaceProvider, providerPlaceId: string) {
      return readRow(provider, providerPlaceId);
    },

    findById(id: string): Promise<PlaceSnapshotRow | null> {
      return snapshots.findUnique({ where: { id } }) as Promise<PlaceSnapshotRow | null>;
    },

    /** Name/city cache lookup used before any paid provider call. */
    findCachedByName(name: string, cityContext?: string | null): Promise<PlaceSnapshotRow | null> {
      return snapshots.findFirst({
        where: {
          name: { equals: name, mode: "insensitive" },
          ...(cityContext ? { formattedAddress: { contains: cityContext, mode: "insensitive" } } : {})
        }
      }) as Promise<PlaceSnapshotRow | null>;
    }
  };
}

export type PlaceSnapshotRepository = ReturnType<typeof createPlaceSnapshotRepository>;
