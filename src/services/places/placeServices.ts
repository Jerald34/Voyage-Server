import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createGoogleMapsProvider } from "../maps";
import type { MapsProvider } from "../maps";
import { createPlaceGate } from "./placeGate";
import { createPlaceRefreshScheduler, type PlaceRefreshScheduler, type RefreshBudget } from "./placeRefreshScheduler";
import { createPlaceSelectionService, type PlaceSelectionService } from "./placeSelectionService";
import { createPlaceSnapshotRepository, type PlaceSnapshotRepository } from "./placeSnapshotRepository";
import type { PlaceSelectionSession } from "./placeTypes";

/**
 * Production composition for the places services.
 *
 * Everything is built lazily: constructing a Google provider at import time would
 * throw wherever no key is configured, and would make importing any consumer
 * depend on maps being available. This module may import config, the database and
 * the maps provider, but deliberately imports no itinerary or agent factory —
 * those import places, and the cycle would be an import-time trap.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

let repository: PlaceSnapshotRepository | null = null;
let scheduler: PlaceRefreshScheduler | null = null;
let maps: MapsProvider | null | undefined;

export function getPlaceSnapshotRepository(): PlaceSnapshotRepository {
  repository ??= createPlaceSnapshotRepository(prisma);
  return repository;
}

/**
 * The Google provider, or null when it is not configured. Resolved once and
 * cached, including the null result, so a missing key does not retry per call.
 */
function getMapsProvider(): MapsProvider | null {
  if (maps !== undefined) return maps;
  try {
    maps = env.GOOGLE_MAPS_API_KEY ? createGoogleMapsProvider() : null;
  } catch {
    maps = null;
  }
  return maps;
}

export function getPlaceRefreshScheduler(): PlaceRefreshScheduler {
  if (scheduler) return scheduler;

  const snapshots = getPlaceSnapshotRepository();

  scheduler = createPlaceRefreshScheduler({
    now: () => new Date(),
    ttlMs: env.PLACE_SNAPSHOT_TTL_DAYS * DAY_MS,
    concurrency: env.PLACE_STATUS_REFRESH_CONCURRENCY,
    perRead: env.PLACE_STATUS_MAX_REFRESHES_PER_READ,
    perHour: env.PLACE_STATUS_MAX_REFRESHES_PER_HOUR,
    cooldownMs: env.PLACE_STATUS_RETRY_COOLDOWN_MS,
    async getPlaceStatus(placeId) {
      const provider = getMapsProvider();
      if (!provider?.getPlaceStatus) {
        // No provider, or one that cannot answer a status-only question.
        return {};
      }
      return provider.getPlaceStatus(placeId);
    },
    observeStatus: (provider, providerPlaceId, observation) =>
      snapshots.observeStatus(provider, providerPlaceId, observation)
  });

  return scheduler;
}

/** A fresh per-run refresh budget. Zero disables extra refreshes for that run. */
export function createRunRefreshBudget(): RefreshBudget {
  return { remaining: env.PLACE_STATUS_MAX_REFRESHES_PER_RUN };
}

/**
 * A selection service bound to one run or request. The budget is per-service so
 * an agent run cannot spend another run's allowance.
 */
export function createPlaceSelectionServiceForRun(
  runBudget: RefreshBudget = createRunRefreshBudget()
): PlaceSelectionService {
  return createPlaceSelectionService({
    repository: getPlaceSnapshotRepository(),
    maps: getMapsProvider(),
    scheduler: getPlaceRefreshScheduler(),
    createGate: (agencyId) => createPlaceGate(prisma as any, agencyId),
    ttlMs: env.PLACE_SNAPSHOT_TTL_DAYS * DAY_MS,
    now: () => new Date(),
    runBudget
  });
}

/**
 * The production `createPlaceSession` dependency. Each call gets its own budget,
 * so nothing agency-scoped is ever shared through a singleton.
 */
export function createPlaceSession(agencyId: string | null): Promise<PlaceSelectionSession> {
  return createPlaceSelectionServiceForRun().createSession(agencyId);
}

/** Test-only: drops cached instances so env changes take effect. */
export function resetPlaceServicesForTests() {
  repository = null;
  scheduler = null;
  maps = undefined;
}
