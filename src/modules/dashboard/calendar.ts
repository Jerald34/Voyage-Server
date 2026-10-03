import { ApiError } from "../../http/errors";
import { daysBetween } from "../../services/weather/dates";
import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarPayload,
  CalendarTrip,
  DashboardRole
} from "./dashboardTypes";

/**
 * Pure composition for the dashboard calendar: the request window and the
 * payload builder. No DB access, so every rule is unit-testable; the rows
 * come from `calendarRepository.ts`.
 */

/** The month grid shows six weeks; one request never covers more. */
export const CALENDAR_MAX_DAYS = 42;

const HOUR_MS = 60 * 60 * 1000;
/**
 * Clients place events on their *local* day, and UTC offsets run from −12h to
 * +14h, so the instant window is padded by 14h on both sides. The client drops
 * whatever lands outside its grid.
 */
const TIMEZONE_SLACK_MS = 14 * HOUR_MS;
/** Longest comment or review excerpt the calendar shows. */
const EXCERPT_LENGTH = 80;

export type CalendarWindow = {
  /** First requested local date, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last requested local date, inclusive (YYYY-MM-DD). */
  to: string;
  /** `from` at 00:00Z, for comparing date-only trip fields. */
  fromDayStart: Date;
  /** `to` at 00:00Z. */
  toDayStart: Date;
  /** The day after `to` at 00:00Z (exclusive): a date-only trip field on `to` is below it at any time of day. */
  toDayEnd: Date;
  /** Earliest instant that falls on `from` in any timezone. */
  fromInstant: Date;
  /** Latest instant that falls on `to` in any timezone. */
  toInstant: Date;
};

/** The trip fields every calendar row needs: its label, and who it belongs to. */
export type CalendarTripRef = {
  id: string;
  title: string;
  clientName: string | null;
  createdByUserId: string;
  assignedOrganizerUserId: string | null;
};

type TripStatus = "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";

export type RawCalendarData = {
  /** Trips whose dates can overlap the window. */
  trips: Array<
    CalendarTripRef & {
      destinationSummary: string | null;
      startDate: Date | null;
      endDate: Date | null;
      status: TripStatus;
      travelerCount: number | null;
    }
  >;
  /** Non-archived trips with no start date, for the "no travel dates" note. */
  undatedTrips: Array<Pick<CalendarTripRef, "createdByUserId" | "assignedOrganizerUserId">>;
  /** Shares with any of their timestamps inside the window. */
  shares: Array<{
    id: string;
    clientName: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastViewedAt: Date | null;
    viewCount: number;
    proposalRating: number | null;
    proposalRatedAt: Date | null;
    trip: CalendarTripRef | null;
  }>;
  /** Client comments created inside the window. */
  comments: Array<{
    id: string;
    content: string;
    authorName: string;
    createdAt: Date;
    share: { clientName: string | null; trip: CalendarTripRef | null };
  }>;
  /** Trip reviews submitted inside the window. */
  reviews: Array<{
    id: string;
    rating: number;
    reviewText: string | null;
    respondentName: string | null;
    submittedAt: Date;
    trip: CalendarTripRef;
  }>;
};

export type BuildCalendarOptions = {
  role: DashboardRole;
  userId: string;
  window: CalendarWindow;
  now: Date;
};

/**
 * The window for local dates `from`…`to` (inclusive, YYYY-MM-DD, already
 * validated by `calendarQuerySchema`). Throws 400 CALENDAR_RANGE_INVALID when
 * `to` is before `from` or the range is longer than the grid.
 */
export function calendarWindow(from: string, to: string): CalendarWindow {
  const span = daysBetween(from, to);
  if (span < 0 || span > CALENDAR_MAX_DAYS - 1) {
    throw new ApiError(
      400,
      "CALENDAR_RANGE_INVALID",
      `Ask for 1 to ${CALENDAR_MAX_DAYS} days, with from on or before to.`
    );
  }
  const fromDayStart = new Date(`${from}T00:00:00.000Z`);
  const toDayStart = new Date(`${to}T00:00:00.000Z`);
  return {
    from,
    to,
    fromDayStart,
    toDayStart,
    toDayEnd: new Date(toDayStart.getTime() + 24 * HOUR_MS),
    fromInstant: new Date(fromDayStart.getTime() - TIMEZONE_SLACK_MS),
    toInstant: new Date(toDayStart.getTime() + 24 * HOUR_MS + TIMEZONE_SLACK_MS - 1)
  };
}

/** Trip dates are stored at UTC midnight, so their UTC date is the calendar date. */
function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** One line of text, cut to EXCERPT_LENGTH with an ellipsis. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

/**
 * Builds the calendar payload. STAFF see only trips they created or organize
 * (the staff worklist's rule); OWNER and ADMIN see the whole agency.
 */
export function buildCalendar(raw: RawCalendarData, opts: BuildCalendarOptions): CalendarPayload {
  const { role, userId, window } = opts;
  const inScope = (trip: Pick<CalendarTripRef, "createdByUserId" | "assignedOrganizerUserId">): boolean =>
    role !== "STAFF" || trip.createdByUserId === userId || trip.assignedOrganizerUserId === userId;
  const inWindow = (at: Date | null): at is Date =>
    at !== null && at >= window.fromInstant && at <= window.toInstant;

  const trips: CalendarTrip[] = [];
  for (const trip of raw.trips) {
    if (trip.status === "ARCHIVED" || trip.startDate === null || !inScope(trip)) continue;
    const startDate = toDateKey(trip.startDate);
    // A missing end date, or one before the start, shows as a one-day trip.
    const endDate =
      trip.endDate !== null && trip.endDate >= trip.startDate ? toDateKey(trip.endDate) : startDate;
    if (startDate > window.to || endDate < window.from) continue;
    trips.push({
      tripId: trip.id,
      tripTitle: trip.title,
      clientName: trip.clientName,
      placeLabel: trip.destinationSummary?.trim() || trip.title,
      startDate,
      endDate,
      status: trip.status,
      travelerCount: trip.travelerCount
    });
  }
  trips.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.tripTitle.localeCompare(b.tripTitle));

  const events: CalendarEvent[] = [];
  const addEvent = (
    kind: CalendarEventKind,
    sourceId: string,
    trip: CalendarTripRef,
    clientName: string | null,
    occurredAt: Date,
    detail: CalendarEvent["detail"] = {}
  ) => {
    events.push({
      id: `${kind}:${sourceId}`,
      kind,
      tripId: trip.id,
      tripTitle: trip.title,
      clientName,
      occurredAt: occurredAt.toISOString(),
      detail
    });
  };

  for (const share of raw.shares) {
    const trip = share.trip;
    if (trip === null || !inScope(trip)) continue;
    const clientName = share.clientName ?? trip.clientName;
    if (inWindow(share.createdAt)) {
      addEvent("share_sent", share.id, trip, clientName, share.createdAt);
    }
    if (share.revokedAt === null && inWindow(share.expiresAt)) {
      addEvent("share_expires", share.id, trip, clientName, share.expiresAt);
    }
    if (inWindow(share.lastViewedAt)) {
      addEvent("client_viewed", share.id, trip, clientName, share.lastViewedAt, { viewCount: share.viewCount });
    }
    if (share.proposalRating !== null && inWindow(share.proposalRatedAt)) {
      addEvent("proposal_rated", share.id, trip, clientName, share.proposalRatedAt, {
        rating: share.proposalRating
      });
    }
  }

  for (const comment of raw.comments) {
    const trip = comment.share.trip;
    if (trip === null || !inScope(trip) || !inWindow(comment.createdAt)) continue;
    const clientName = comment.share.clientName ?? trip.clientName ?? comment.authorName;
    addEvent("client_commented", comment.id, trip, clientName, comment.createdAt, {
      excerpt: excerpt(comment.content)
    });
  }

  for (const review of raw.reviews) {
    if (!inScope(review.trip) || !inWindow(review.submittedAt)) continue;
    addEvent(
      "review_submitted",
      review.id,
      review.trip,
      review.trip.clientName ?? review.respondentName,
      review.submittedAt,
      {
        rating: review.rating,
        ...(review.reviewText ? { excerpt: excerpt(review.reviewText) } : {})
      }
    );
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  return {
    from: window.from,
    to: window.to,
    generatedAt: opts.now.toISOString(),
    tripsWithoutDates: raw.undatedTrips.filter(inScope).length,
    trips,
    events
  };
}
