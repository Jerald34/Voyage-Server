/**
 * ratedHistoryRepository — Prisma access layer.
 *
 * Stage 1: all functions throw "not implemented".
 * Stage 2B fills in the real Prisma queries.
 *
 * Function signatures are fully typed so Stage 3 has typed targets to fill in.
 */

import { Prisma, type ItineraryItemType as PrismaItineraryItemType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { RatedTripSummary, RatedItinerary } from "./ratedHistoryTypes.js";
import { StaleVersionError, SourceNotFoundError } from "./ratedHistoryErrors.js";
import { startDateToSeason } from "./seasonHelper.js";

// ── listRatedTrips ───────────────────────────────────────────────────────────

export type ListRatedTripsParams = {
  agencyId: string;
  destination?: string;
  durationDays?: number;
  /** Pre-computed season string; repository applies the filter when provided */
  season?: "spring" | "summer" | "fall" | "winter";
  page: number;
  pageSize: number;
};

export type ListRatedTripsResult = {
  trips: RatedTripSummary[];
  hasMore: boolean;
  nextPage: number | null;
};

/** Canonical shape for a single entry in the merged pool before pagination. */
type MergedEntry = {
  tripId: string;
  title: string;
  destinationSummary: string | null;
  startDate: Date | null;
  endDate: Date | null;
  itineraryId: string | undefined;
  dayCount: number;
  rating: number;
  ratedAt: Date;
};

/**
 * Returns paginated rated trip summaries for an agency.
 * Filters: TripReview.rating ≥ 4 OR ItineraryShare.proposalRating ≥ 4;
 * optional destination/durationDays/season filters.
 * Excludes trips with zero itineraries.
 * Ordered by ratedAt DESC (most recent of submittedAt / proposalRatedAt).
 */
export async function listRatedTrips(
  params: ListRatedTripsParams
): Promise<ListRatedTripsResult> {
  const { agencyId, destination, durationDays, season, page, pageSize } = params;

  // Build the where clause for the destination filter on ClientTrip.
  const tripWhere: Prisma.ClientTripWhereInput = {
    agencyId,
    ...(destination
      ? {
          destinationSummary: {
            contains: destination,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  // ── Source A: TripReview rows ────────────────────────────────────────────────
  // We over-fetch here to support in-JS filtering for durationDays and season,
  // then paginate the filtered result set.
  // TODO: optimize with raw SQL DATE_PART if N grows large enough that the full
  // fetch becomes a bottleneck.
  const reviews = await prisma.tripReview.findMany({
    where: {
      agencyId,
      rating: { gte: 4 },
      trip: tripWhere,
    },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      rating: true,
      submittedAt: true,
      trip: {
        select: {
          id: true,
          title: true,
          destinationSummary: true,
          startDate: true,
          endDate: true,
          itineraries: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              _count: {
                select: { days: true },
              },
            },
          },
        },
      },
    },
  });

  // ── Source B: ItineraryShare rows ────────────────────────────────────────────
  const shares = await prisma.itineraryShare.findMany({
    where: {
      agencyId,
      proposalRating: { gte: 4 },
      tripId: { not: null },
      trip: tripWhere,
    },
    orderBy: { proposalRatedAt: "desc" },
    select: {
      proposalRating: true,
      proposalRatedAt: true,
      trip: {
        select: {
          id: true,
          title: true,
          destinationSummary: true,
          startDate: true,
          endDate: true,
          itineraries: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              _count: {
                select: { days: true },
              },
            },
          },
        },
      },
    },
  });

  // ── Merge both sources by tripId ─────────────────────────────────────────────
  // Build a map keyed by tripId; each entry tracks the best rating and most
  // recent ratedAt from either source.
  const byTripId = new Map<string, MergedEntry>();

  for (const r of reviews) {
    const existing = byTripId.get(r.trip.id);
    const itin = r.trip.itineraries[0];
    if (!existing) {
      byTripId.set(r.trip.id, {
        tripId: r.trip.id,
        title: r.trip.title,
        destinationSummary: r.trip.destinationSummary ?? null,
        startDate: r.trip.startDate,
        endDate: r.trip.endDate,
        itineraryId: itin?.id,
        dayCount: itin?._count.days ?? 0,
        rating: r.rating,
        ratedAt: r.submittedAt,
      });
    } else {
      // Keep higher rating; use more recent timestamp.
      if (r.rating > existing.rating) existing.rating = r.rating;
      if (r.submittedAt > existing.ratedAt) existing.ratedAt = r.submittedAt;
    }
  }

  for (const s of shares) {
    // proposalRating is guaranteed >= 4 by the query filter; proposalRatedAt
    // may be null despite the filter (Prisma nullable). Skip if so.
    if (!s.trip || s.proposalRating === null || s.proposalRatedAt === null) continue;
    const existing = byTripId.get(s.trip.id);
    const itin = s.trip.itineraries[0];
    if (!existing) {
      byTripId.set(s.trip.id, {
        tripId: s.trip.id,
        title: s.trip.title,
        destinationSummary: s.trip.destinationSummary ?? null,
        startDate: s.trip.startDate,
        endDate: s.trip.endDate,
        itineraryId: itin?.id,
        dayCount: itin?._count.days ?? 0,
        rating: s.proposalRating,
        ratedAt: s.proposalRatedAt,
      });
    } else {
      if (s.proposalRating > existing.rating) existing.rating = s.proposalRating;
      if (s.proposalRatedAt > existing.ratedAt) existing.ratedAt = s.proposalRatedAt;
    }
  }

  // ── Exclude trips with no itinerary or zero days ─────────────────────────────
  const withDays = [...byTripId.values()].filter(
    (e) => e.itineraryId !== undefined && e.dayCount > 0
  );

  // ── Sort by ratedAt DESC ──────────────────────────────────────────────────────
  withDays.sort((a, b) => b.ratedAt.getTime() - a.ratedAt.getTime());

  // NOTE: The old code built `deduped` from the sorted reviews array; we now
  // use `withDays` (already deduped by the Map). The downstream filter
  // variable is renamed accordingly.

  // Apply in-JS filters (durationDays, season).
  // These are post-fetch because Prisma cannot express DATE_PART arithmetic
  // or enum-derived computed fields in a where clause without raw SQL.
  let filtered = withDays;

  if (durationDays !== undefined) {
    // TODO: optimize with raw SQL DATE_PART if N grows
    filtered = filtered.filter((e) => {
      const { startDate, endDate } = e;
      if (!startDate || !endDate) return false;
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
      return diffDays === durationDays;
    });
  }

  if (season !== undefined) {
    filtered = filtered.filter((e) => {
      const computed = startDateToSeason(e.startDate);
      return computed === season;
    });
  }

  const total = filtered.length;
  const skip = (page - 1) * pageSize;
  const page_rows = filtered.slice(skip, skip + pageSize);

  const trips: RatedTripSummary[] = page_rows.map((e) => ({
    tripId: e.tripId,
    title: e.title,
    destinationSummary: e.destinationSummary,
    dayCount: e.dayCount,
    startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
    endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
    rating: e.rating,
    ratedAt: e.ratedAt.toISOString(),
  }));

  const hasMore = skip + pageSize < total;
  return {
    trips,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

// ── getSourceItinerary ───────────────────────────────────────────────────────

/**
 * Item shape used internally by the source view. Extends the public
 * RatedItineraryItem with `placeSnapshotId` so the insert path can preserve
 * the FK when copying. Strip this field before serializing to the public API.
 */
export type SourceItineraryItem = RatedItinerary["days"][number]["items"][number] & {
  placeSnapshotId: string | null;
};

export type SourceItineraryDay = Omit<RatedItinerary["days"][number], "items"> & {
  items: SourceItineraryItem[];
};

export type SourceItinerary = Omit<RatedItinerary, "days"> & {
  days: SourceItineraryDay[];
  /** Raw DB status for service-layer decision making */
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED_INTERNAL";
  /** updatedAt exposed so callers can log/debug the selection */
  updatedAt: Date;
};

/** Tight select for placeSnapshot fields (PII-safe subset) */
const placeSnapshotSelect = {
  name: true,
  formattedAddress: true,
  latitude: true,
  longitude: true,
} as const;

/** Nested include for days → items → placeSnapshot */
const itineraryDaysInclude = {
  days: {
    orderBy: { dayNumber: "asc" as const },
    include: {
      items: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          placeSnapshot: {
            select: placeSnapshotSelect,
          },
        },
      },
    },
  },
} as const;

/**
 * Selects the best itinerary for the given source trip using the spec §6.1 rule:
 *   ORDER BY (status = 'APPROVED_INTERNAL') DESC, updatedAt DESC LIMIT 1
 *
 * Implemented as two queries (option b from the brief): first try APPROVED_INTERNAL,
 * fall back to most-recent of any status. Two queries are clearer and almost always
 * cheaper than fetching all itineraries (typical trip has 1–3).
 *
 * Includes days → items → placeSnapshot.
 * Returns null if no itinerary exists for the trip.
 */
export async function getSourceItinerary(
  tripId: string
): Promise<SourceItinerary | null> {
  // First preference: most-recently-updated APPROVED_INTERNAL itinerary.
  let row = await prisma.itinerary.findFirst({
    where: { tripId, status: "APPROVED_INTERNAL" },
    orderBy: { updatedAt: "desc" },
    include: itineraryDaysInclude,
  });

  // Fallback: most-recently-updated itinerary of any status.
  if (!row) {
    row = await prisma.itinerary.findFirst({
      where: { tripId },
      orderBy: { updatedAt: "desc" },
      include: itineraryDaysInclude,
    });
  }

  if (!row) return null;

  const result: SourceItinerary = {
    itineraryId: row.id,
    title: row.title,
    summary: row.summary ?? null,
    status: row.status as "DRAFT" | "NEEDS_REVIEW" | "APPROVED_INTERNAL",
    updatedAt: row.updatedAt,
    days: row.days.map((day) => ({
      dayId: day.id,
      dayNumber: day.dayNumber,
      date: day.date ? day.date.toISOString().slice(0, 10) : null,
      title: day.title,
      summary: day.summary ?? null,
      items: day.items.map((item) => ({
        itemId: item.id,
        sortOrder: item.sortOrder,
        type: item.type as import("./ratedHistoryTypes.js").ItineraryItemType,
        title: item.title,
        description: item.description ?? null,
        startTime: item.startTime ?? null,
        endTime: item.endTime ?? null,
        place: item.placeSnapshot
          ? {
              name: item.placeSnapshot.name,
              formattedAddress: item.placeSnapshot.formattedAddress ?? null,
              latitude: item.placeSnapshot.latitude ?? null,
              longitude: item.placeSnapshot.longitude ?? null,
            }
          : null,
        // placeSnapshotId is exposed for the copy/insert path (FK preservation).
        // Not part of the public RatedItineraryItem DTO — service strips it
        // before serializing detail responses if needed.
        placeSnapshotId: item.placeSnapshotId ?? null,
        staffNotes: item.staffNotes ?? null,
        // clientNotes intentionally omitted (PII — never crosses this boundary)
      })),
    })),
  };

  return result;
}

// ── insertItemsTransactional ─────────────────────────────────────────────────

export type PreparedDay = {
  /** New UUID for the copied day */
  id: string;
  dayNumber: number;
  date: Date | null;
  title: string;
  summary: string | null;
  items: PreparedItem[];
};

export type PreparedItem = {
  /** New UUID for the copied item */
  id: string;
  sortOrder: number;
  type: string;
  title: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  placeSnapshotId: string | null;
  staffNotes: string | null;
  // clientNotes always null (PII-stripped by service before handing to repository)
  // routeFromPrevious always null (geometry no longer valid for new position)
};

export type InsertItemsTransactionalParams = {
  targetItineraryId: string;
  ifMatchVersion: number;
  /**
   * Days to insert (kind=day / kind=segment) or items to insert into an
   * existing day (kind=item). The service prepares this payload; the
   * repository simply persists it and renumbers downstream records.
   */
  insertions:
    | { mode: "days"; days: PreparedDay[]; atDayIndex: number }
    | { mode: "items"; targetDayId: string; items: PreparedItem[]; atPosition?: number };
};

/**
 * Opens a Prisma $transaction, checks ifMatchVersion (throws StaleVersionError
 * on mismatch), persists the prepared insertions, increments Itinerary.version,
 * renumbers downstream dayNumbers / sortOrders, and returns { itineraryId, newVersion }.
 *
 * @throws {StaleVersionError} when ifMatchVersion !== current Itinerary.version
 * @throws {SourceNotFoundError} (reason='deleted') when a FK violation indicates
 *   the source was concurrently deleted
 */
export async function insertItemsTransactional(
  params: InsertItemsTransactionalParams
): Promise<{ itineraryId: string; newVersion: number }> {
  const { targetItineraryId, ifMatchVersion, insertions } = params;

  try {
    return await prisma.$transaction(async (tx) => {
      // Step 1: Re-fetch and check version for optimistic concurrency.
      const current = await tx.itinerary.findUnique({
        where: { id: targetItineraryId },
        select: { id: true, version: true },
      });

      if (!current) {
        throw new SourceNotFoundError("missing");
      }

      if (current.version !== ifMatchVersion) {
        throw new StaleVersionError(ifMatchVersion, current.version);
      }

      if (insertions.mode === "days") {
        // ── Insert new days ────────────────────────────────────────────────

        const { days, atDayIndex } = insertions;
        // atDayIndex is 0-based; dayNumber is 1-based.
        // Days inserted starting at dayNumber = atDayIndex + 1.
        // Existing days with dayNumber >= that slot must shift up by the
        // number of inserted days.

        const insertedCount = days.length;
        const insertAtDayNumber = atDayIndex + 1;

        // Fetch existing days that need shifting (dayNumber >= insertAtDayNumber).
        const toShift = await tx.itineraryDay.findMany({
          where: {
            itineraryId: targetItineraryId,
            dayNumber: { gte: insertAtDayNumber },
          },
          orderBy: { dayNumber: "desc" }, // descending to avoid unique constraint collisions
          select: { id: true, dayNumber: true },
        });

        // Two-pass shift: park in negative space, then set final positive values,
        // to avoid the (itineraryId, dayNumber) unique constraint during intermediate states.
        for (const [i, day] of toShift.entries()) {
          await tx.itineraryDay.update({
            where: { id: day.id },
            data: { dayNumber: -(i + 1) },
          });
        }
        for (const day of toShift) {
          await tx.itineraryDay.update({
            where: { id: day.id },
            data: { dayNumber: day.dayNumber + insertedCount },
          });
        }

        // Create each new day with its nested items.
        for (const day of days) {
          await tx.itineraryDay.create({
            data: {
              id: day.id,
              itineraryId: targetItineraryId,
              dayNumber: day.dayNumber,
              date: day.date,
              title: day.title,
              summary: day.summary,
              items: {
                create: day.items.map((item) => ({
                  id: item.id,
                  sortOrder: item.sortOrder,
                  type: item.type as PrismaItineraryItemType,
                  title: item.title,
                  description: item.description,
                  startTime: item.startTime,
                  endTime: item.endTime,
                  placeSnapshotId: item.placeSnapshotId,
                  staffNotes: item.staffNotes,
                  clientNotes: null,
                  routeFromPrevious: Prisma.JsonNull,
                })),
              },
            },
          });
        }
      } else {
        // ── Insert items into an existing day ──────────────────────────────

        const { targetDayId, items, atPosition } = insertions;
        const insertedCount = items.length;

        if (atPosition !== undefined) {
          // Shift existing items at or after atPosition to make room.
          await tx.itineraryItem.updateMany({
            where: {
              itineraryDayId: targetDayId,
              sortOrder: { gte: atPosition },
            },
            data: { sortOrder: { increment: insertedCount } },
          });
        }

        // Create the new items.
        for (const item of items) {
          await tx.itineraryItem.create({
            data: {
              id: item.id,
              itineraryDayId: targetDayId,
              sortOrder: item.sortOrder,
              type: item.type as PrismaItineraryItemType,
              title: item.title,
              description: item.description,
              startTime: item.startTime,
              endTime: item.endTime,
              placeSnapshotId: item.placeSnapshotId,
              staffNotes: item.staffNotes,
              clientNotes: null,
              routeFromPrevious: Prisma.JsonNull,
            },
          });
        }
      }

      // Step 6: Increment Itinerary.version.
      const updated = await tx.itinerary.update({
        where: { id: targetItineraryId },
        data: {
          version: { increment: 1 },
          updatedAt: new Date(),
        },
        select: { id: true, version: true },
      });

      return { itineraryId: updated.id, newVersion: updated.version };
    });
  } catch (err) {
    // Map Prisma FK violations (e.g., concurrent placeSnapshot deletion) to
    // SourceNotFoundError so the service layer can return 410.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      throw new SourceNotFoundError("deleted");
    }
    // Re-throw StaleVersionError, SourceNotFoundError, and any other errors as-is.
    throw err;
  }
}
