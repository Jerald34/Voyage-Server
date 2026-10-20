const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The day counts the dashboard offers for extending a link. */
export const EXTEND_DAY_OPTIONS = [7, 30] as const;
export type ExtendDays = (typeof EXTEND_DAY_OPTIONS)[number];

/**
 * A link's new expiry: `extendDays` after its current expiry, or after now
 * when it has already expired, so an extension never lands in the past.
 */
export function computeExtendedExpiry(current: Date, extendDays: number, now: Date): Date {
  const base = current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + extendDays * MS_PER_DAY);
}
