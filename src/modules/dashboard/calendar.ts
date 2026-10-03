import { ApiError } from "../../http/errors";
import { daysBetween } from "../../services/weather/dates";

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

export type CalendarWindow = {
  /** First requested local date, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last requested local date, inclusive (YYYY-MM-DD). */
  to: string;
  /** `from` at 00:00Z, for comparing date-only trip fields. */
  fromDayStart: Date;
  /** `to` at 00:00Z. */
  toDayStart: Date;
  /** Earliest instant that falls on `from` in any timezone. */
  fromInstant: Date;
  /** Latest instant that falls on `to` in any timezone. */
  toInstant: Date;
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
    fromInstant: new Date(fromDayStart.getTime() - TIMEZONE_SLACK_MS),
    toInstant: new Date(toDayStart.getTime() + 24 * HOUR_MS + TIMEZONE_SLACK_MS - 1)
  };
}
