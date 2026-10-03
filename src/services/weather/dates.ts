const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Splits YYYY-MM-DD into numbers. It does no validation: callers must check the
 * input with isIsoDate first, otherwise they get NaN parts or a date the helpers misread.
 */
function parts(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.split("-").map(Number);
  return [year, month, day];
}

/** True for a real calendar date written exactly as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The UTC calendar date of an instant, YYYY-MM-DD. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = parts(isoDate);
  return toIsoDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** The same month and day `years` later (negative: earlier). Feb 29 falls back to Feb 28. */
export function shiftYears(isoDate: string, years: number): string {
  const [year, month, day] = parts(isoDate);
  const targetYear = year + years;
  const lastDayOfMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(targetYear, month - 1, Math.min(day, lastDayOfMonth))));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
}
