/**
 * ratedHistoryService — query + insertion logic.
 *
 * Implements the read APIs (list + detail) and the insertion API per spec
 * sections 5, 6.1, 6.2, 6.3, and 8. Selection validation (§5.3) and date
 * re-anchoring (§6.3) live here; the repository is purely persistence.
 *
 * The repository is parameterised so unit tests can swap in a fake.
 * `ratedHistoryService` (the default export) is wired to the real Prisma
 * repository for production use.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import {
  listRatedTrips as defaultListRatedTrips,
  getSourceItinerary as defaultGetSourceItinerary,
  insertItemsTransactional as defaultInsertItemsTransactional,
  type ListRatedTripsParams,
  type ListRatedTripsResult,
  type SourceItinerary,
  type InsertItemsTransactionalParams,
  type PreparedDay,
  type PreparedItem
} from "./ratedHistoryRepository.js";
import {
  MalformedSelectionError,
  SameAgencyViolationError,
  SourceNotFoundError
} from "./ratedHistoryErrors.js";
import type {
  RatedHistoryListResponse,
  RatedItineraryDetail,
  RatedItinerary,
  RatedTripSummary,
  InsertRequest,
  InsertResponse,
  ItineraryItemType
} from "./ratedHistoryTypes.js";

// ── Dependency surface (lets tests inject a fake repository / prisma) ────────

export type RatedHistoryDeps = {
  listRatedTrips: (params: ListRatedTripsParams) => Promise<ListRatedTripsResult>;
  getSourceItinerary: (tripId: string) => Promise<SourceItinerary | null>;
  insertItemsTransactional: (
    params: InsertItemsTransactionalParams
  ) => Promise<{ itineraryId: string; newVersion: number }>;
  /** Subset of Prisma calls the service needs directly (trip + review lookups) */
  db: {
    clientTrip: {
      findUnique: (args: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => Promise<TripLookupRow | null>;
    };
    tripReview: {
      findFirst: (args: {
        where: { tripId: string; rating: { gte: number } };
        orderBy: { submittedAt: "desc" };
        select: Record<string, unknown>;
      }) => Promise<{ rating: number; submittedAt: Date } | null>;
    };
    itinerary: {
      findUnique: (args: {
        where: { id: string };
        select: Record<string, unknown>;
      }) => Promise<TargetItineraryRow | null>;
    };
    itineraryItem: {
      findFirst: (args: {
        where: { itineraryDayId: string };
        orderBy: { sortOrder: "desc" };
        select: { sortOrder: true };
      }) => Promise<{ sortOrder: number } | null>;
    };
  };
};

type TripLookupRow = {
  id: string;
  agencyId: string;
  title: string;
  destinationSummary: string | null;
  startDate: Date | null;
  endDate: Date | null;
  createdByUserId: string;
  assignedOrganizerUserId: string | null;
};

type TargetItineraryRow = {
  id: string;
  tripId: string | null;
  version: number;
  trip: { startDate: Date | null } | null;
  days: Array<{ id: string; dayNumber: number }>;
};

// ── listRatedHistory ─────────────────────────────────────────────────────────

export type ListRatedHistoryParams = {
  callerAgencyId: string;
  filters: {
    destination?: string;
    durationDays?: number;
    season?: "spring" | "summer" | "fall" | "winter";
  };
  page?: number;
  pageSize?: number;
};

// ── getRatedItinerary ────────────────────────────────────────────────────────

export type GetRatedItineraryParams = {
  callerAgencyId: string;
  tripId: string;
};

// ── insertFromRated ──────────────────────────────────────────────────────────

export type InsertFromRatedParams = InsertRequest & {
  callerAgencyId: string;
  targetTripId: string;
  callerUserId: string;
  callerRole: "OWNER" | "ADMIN" | "STAFF";
};

// ── Factory: builds a service object using injected dependencies ─────────────

export function createRatedHistoryService(deps: RatedHistoryDeps) {
  /**
   * Returns paginated rated trip summaries for an agency.
   * Delegates to repository; defaults page=1, pageSize=20.
   */
  async function listRatedHistory(
    params: ListRatedHistoryParams
  ): Promise<RatedHistoryListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const result = await deps.listRatedTrips({
      agencyId: params.callerAgencyId,
      destination: params.filters.destination,
      durationDays: params.filters.durationDays,
      season: params.filters.season,
      page,
      pageSize
    });
    return result;
  }

  /**
   * Returns the full itinerary structure for a rated trip.
   *
   * - Validates that the trip belongs to callerAgencyId.
   * - Throws SourceNotFoundError(reason='missing') if trip has no itinerary.
   * - Strips status/updatedAt (internal) from the returned itinerary.
   */
  async function getRatedItinerary(
    params: GetRatedItineraryParams
  ): Promise<RatedItineraryDetail> {
    const { callerAgencyId, tripId } = params;

    const trip = (await deps.db.clientTrip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        agencyId: true,
        title: true,
        destinationSummary: true,
        startDate: true,
        endDate: true,
        createdByUserId: true,
        assignedOrganizerUserId: true
      }
    })) as TripLookupRow | null;

    if (!trip) {
      throw new SourceNotFoundError("missing");
    }
    if (trip.agencyId !== callerAgencyId) {
      throw new SameAgencyViolationError(
        "Source trip does not belong to the caller's agency."
      );
    }

    const source = await deps.getSourceItinerary(tripId);
    if (!source) {
      throw new SourceNotFoundError("missing");
    }

    const review = await deps.db.tripReview.findFirst({
      where: { tripId, rating: { gte: 4 } },
      orderBy: { submittedAt: "desc" },
      select: { rating: true, submittedAt: true }
    });

    const itinerary: RatedItinerary = stripInternalFields(source);

    const tripSummary: Omit<RatedTripSummary, "ratedAt"> = {
      tripId: trip.id,
      title: trip.title,
      destinationSummary: trip.destinationSummary ?? null,
      dayCount: source.days.length,
      startDate: trip.startDate ? toIsoDate(trip.startDate) : null,
      endDate: trip.endDate ? toIsoDate(trip.endDate) : null,
      rating: review?.rating ?? 0
    };

    return {
      // The detail-response trip omits ratedAt (spec §5.2 — ratedAt is a list-row field)
      trip: tripSummary as RatedTripSummary,
      itinerary
    };
  }

  /**
   * Copy-insert from a rated source trip into the target trip's itinerary.
   * See spec §5.3, §6.2, §6.3, §8 for the validation + copy semantics.
   */
  async function insertFromRated(
    params: InsertFromRatedParams
  ): Promise<InsertResponse> {
    const {
      callerAgencyId,
      callerUserId,
      callerRole,
      targetTripId,
      sourceTripId,
      selection,
      target,
      ifMatchVersion
    } = params;

    // ── 3a. Validate trip ownership + write access ────────────────────────────
    const tripSelect = {
      id: true,
      agencyId: true,
      title: true,
      destinationSummary: true,
      startDate: true,
      endDate: true,
      createdByUserId: true,
      assignedOrganizerUserId: true
    };

    const [targetTrip, sourceTrip] = await Promise.all([
      deps.db.clientTrip.findUnique({
        where: { id: targetTripId },
        select: tripSelect
      }) as Promise<TripLookupRow | null>,
      deps.db.clientTrip.findUnique({
        where: { id: sourceTripId },
        select: tripSelect
      }) as Promise<TripLookupRow | null>
    ]);

    if (!targetTrip || targetTrip.agencyId !== callerAgencyId) {
      throw new SameAgencyViolationError(
        "Target trip does not belong to the caller's agency."
      );
    }
    if (!sourceTrip || sourceTrip.agencyId !== callerAgencyId) {
      throw new SameAgencyViolationError(
        "Source trip does not belong to the caller's agency."
      );
    }

    // Write access on target: OWNER/ADMIN, or assignedOrganizer, or createdBy.
    // (Mirrors the gating pattern used in other modules; no central helper exists.)
    const isOwnerOrAdmin = callerRole === "OWNER" || callerRole === "ADMIN";
    const isOrganizer = targetTrip.assignedOrganizerUserId === callerUserId;
    const isCreator = targetTrip.createdByUserId === callerUserId;
    if (!isOwnerOrAdmin && !isOrganizer && !isCreator) {
      throw new SameAgencyViolationError(
        "Caller does not have write access on the target trip."
      );
    }

    // ── 3b. Load source itinerary ────────────────────────────────────────────
    const source = await deps.getSourceItinerary(sourceTripId);
    if (!source) {
      throw new SourceNotFoundError("missing");
    }

    // ── 3c. Validate selection (§5.3) ────────────────────────────────────────
    validateSelection(selection, source);

    // ── 3d. Load target itinerary ────────────────────────────────────────────
    const targetItinerary = (await deps.db.itinerary.findUnique({
      where: { id: target.itineraryId },
      select: {
        id: true,
        tripId: true,
        version: true,
        trip: { select: { startDate: true } },
        days: {
          select: { id: true, dayNumber: true },
          orderBy: { dayNumber: "asc" }
        }
      }
    })) as TargetItineraryRow | null;

    if (!targetItinerary) {
      throw new SourceNotFoundError("missing");
    }
    if (targetItinerary.tripId !== targetTripId) {
      throw new MalformedSelectionError(
        "target itinerary does not belong to target trip"
      );
    }

    // ── 3e. Build prepared payload + delegate to repo ────────────────────────
    const targetStartDate = targetItinerary.trip?.startDate ?? targetTrip.startDate ?? null;
    const missingStartDate = targetStartDate === null;

    let insertions: InsertItemsTransactionalParams["insertions"];

    if (selection.kind === "item") {
      // Find the source day containing all selected items.
      const sourceDay = findDayContainingItems(source, selection.itemIds);
      // (validateSelection already verified the items live in the same day;
      // sourceDay is guaranteed non-null here.)

      // Resolve target day id.
      if (target.dayIndex < 0 || target.dayIndex >= targetItinerary.days.length) {
        throw new MalformedSelectionError("target dayIndex out of range");
      }
      const targetDay = targetItinerary.days[target.dayIndex];

      // Resolve position: explicit value, else append after the last existing item.
      let atPosition = target.position;
      if (atPosition === undefined) {
        const last = await deps.db.itineraryItem.findFirst({
          where: { itineraryDayId: targetDay.id },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true }
        });
        atPosition = last ? last.sortOrder + 1 : 0;
      }

      const items: PreparedItem[] = sourceDay.items
        .filter((item) => selection.itemIds.includes(item.itemId))
        .map((item, idx) => buildPreparedItem(item, atPosition! + idx, source));

      insertions = {
        mode: "items",
        targetDayId: targetDay.id,
        items,
        atPosition
      };
    } else {
      // kind === "day" | "segment"
      const dayIds =
        selection.kind === "segment"
          ? sortDayIdsByDayNumber(selection.dayIds, source)
          : selection.dayIds;

      if (target.dayIndex < 0 || target.dayIndex > targetItinerary.days.length) {
        throw new MalformedSelectionError("target dayIndex out of range");
      }

      const days: PreparedDay[] = dayIds.map((dayId, idx) => {
        const sourceDay = source.days.find((d) => d.dayId === dayId)!;
        const newDayNumber = target.dayIndex + 1 + idx;
        const newDate = computeAnchoredDate(targetStartDate, newDayNumber);

        const items: PreparedItem[] = sourceDay.items.map((item, itemIdx) =>
          buildPreparedItem(item, itemIdx, source, /*sortFromZero*/ true)
        );

        return {
          id: randomUUID(),
          dayNumber: newDayNumber,
          date: newDate,
          title: sourceDay.title,
          summary: sourceDay.summary,
          items
        };
      });

      insertions = {
        mode: "days",
        days,
        atDayIndex: target.dayIndex
      };
    }

    await deps.insertItemsTransactional({
      targetItineraryId: target.itineraryId,
      ifMatchVersion,
      insertions
    });

    // ── 3f. Re-fetch updated itinerary to return ─────────────────────────────
    const updated = await deps.getSourceItinerary(targetTripId);
    if (!updated) {
      // Shouldn't happen — we just inserted into it.
      throw new SourceNotFoundError("missing");
    }

    const response: InsertResponse = {
      itinerary: stripInternalFields(updated)
    };
    if (missingStartDate) {
      response.missingStartDateAdvisory = true;
    }
    return response;
  }

  return { listRatedHistory, getRatedItinerary, insertFromRated };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripInternalFields(source: SourceItinerary): RatedItinerary {
  const { status: _s, updatedAt: _u, days, ...rest } = source;
  return {
    ...rest,
    days: days.map((day) => ({
      dayId: day.dayId,
      dayNumber: day.dayNumber,
      date: day.date,
      title: day.title,
      summary: day.summary,
      items: day.items.map(({ placeSnapshotId: _p, ...item }) => item)
    }))
  };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validateSelection(
  selection: InsertRequest["selection"],
  source: SourceItinerary
): void {
  if (selection.kind === "item") {
    // All itemIds must exist and belong to the same source day.
    let foundDay: SourceItinerary["days"][number] | null = null;
    for (const id of selection.itemIds) {
      const day = source.days.find((d) => d.items.some((it) => it.itemId === id));
      if (!day) {
        throw new MalformedSelectionError("item id not found in source");
      }
      if (foundDay && foundDay.dayId !== day.dayId) {
        throw new MalformedSelectionError("items span multiple days");
      }
      foundDay = day;
    }
    return;
  }

  if (selection.kind === "day") {
    for (const id of selection.dayIds) {
      if (!source.days.some((d) => d.dayId === id)) {
        throw new MalformedSelectionError("day id not found in source");
      }
    }
    return;
  }

  // kind === "segment"
  const dayNumbers: number[] = [];
  for (const id of selection.dayIds) {
    const day = source.days.find((d) => d.dayId === id);
    if (!day) {
      throw new MalformedSelectionError("day id not found in source");
    }
    dayNumbers.push(day.dayNumber);
  }
  dayNumbers.sort((a, b) => a - b);
  for (let i = 1; i < dayNumbers.length; i += 1) {
    if (dayNumbers[i] !== dayNumbers[i - 1] + 1) {
      throw new MalformedSelectionError("segment days not consecutive");
    }
  }
}

function findDayContainingItems(
  source: SourceItinerary,
  itemIds: string[]
): SourceItinerary["days"][number] {
  for (const day of source.days) {
    if (itemIds.every((id) => day.items.some((it) => it.itemId === id))) {
      return day;
    }
  }
  // validateSelection should already have thrown — this is defence in depth.
  throw new MalformedSelectionError("items span multiple days");
}

function sortDayIdsByDayNumber(dayIds: string[], source: SourceItinerary): string[] {
  return [...dayIds].sort((a, b) => {
    const da = source.days.find((d) => d.dayId === a)?.dayNumber ?? 0;
    const db = source.days.find((d) => d.dayId === b)?.dayNumber ?? 0;
    return da - db;
  });
}

function buildPreparedItem(
  item: SourceItinerary["days"][number]["items"][number],
  newSortOrder: number,
  _source: SourceItinerary,
  _sortFromZero = false
): PreparedItem {
  // clientNotes and routeFromPrevious are persisted as null by the repository
  // (PII strip + invalid geometry). The repository drops both unconditionally,
  // so PreparedItem omits them from its surface.
  return {
    id: randomUUID(),
    sortOrder: newSortOrder,
    type: item.type as string,
    title: item.title,
    description: item.description,
    startTime: item.startTime,
    endTime: item.endTime,
    placeSnapshotId: item.placeSnapshotId,
    staffNotes: item.staffNotes
  };
}

function computeAnchoredDate(
  startDate: Date | null,
  newDayNumber: number
): Date | null {
  if (!startDate) return null;
  const ms = startDate.getTime() + (newDayNumber - 1) * 86_400_000;
  return new Date(ms);
}

// ── Default-wired service (production) ───────────────────────────────────────

export const ratedHistoryService = createRatedHistoryService({
  listRatedTrips: defaultListRatedTrips,
  getSourceItinerary: defaultGetSourceItinerary,
  insertItemsTransactional: defaultInsertItemsTransactional,
  db: {
    clientTrip: {
      findUnique: (args) => prisma.clientTrip.findUnique(args as never) as never
    },
    tripReview: {
      findFirst: (args) => prisma.tripReview.findFirst(args as never) as never
    },
    itinerary: {
      findUnique: (args) => prisma.itinerary.findUnique(args as never) as never
    },
    itineraryItem: {
      findFirst: (args) => prisma.itineraryItem.findFirst(args as never) as never
    }
  }
});

// Re-export type aliases that route handlers / tests need.
export type { ItineraryItemType };
