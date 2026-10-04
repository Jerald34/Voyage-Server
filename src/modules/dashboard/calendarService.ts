import { TtlCache } from "./cache";
import { buildCalendar, calendarWindow } from "./calendar";
import { calendarRepository, type CalendarRepository } from "./calendarRepository";
import type { CalendarPayload, DashboardRole } from "./dashboardTypes";

/**
 * Serves the dashboard calendar: validates the range, then returns a cached
 * payload or builds one from the repository's rows. Owners and admins share
 * one cache entry per agency and range; staff get their own (scoped) entry.
 */

const CACHE_TTL_MS = 60_000;

export type GetCalendarOptions = {
  agencyId: string;
  userId: string;
  role: DashboardRole;
  from: string;
  to: string;
  now?: Date;
};

export function createCalendarService(deps: {
  repository: CalendarRepository;
  cache: TtlCache<CalendarPayload>;
}) {
  async function getCalendar(opts: GetCalendarOptions): Promise<CalendarPayload> {
    const window = calendarWindow(opts.from, opts.to);
    const scope = opts.role === "STAFF" ? `staff:${opts.userId}` : "all";
    const cacheKey = `${opts.agencyId}:${scope}:${opts.from}:${opts.to}`;

    const cached = deps.cache.get(cacheKey);
    if (cached) return cached;

    const raw = await deps.repository.fetchCalendarWindow(opts.agencyId, window);
    const payload = buildCalendar(raw, {
      role: opts.role,
      userId: opts.userId,
      window,
      now: opts.now ?? new Date()
    });
    deps.cache.set(cacheKey, payload);
    return payload;
  }

  /** Forgets every cached range for the agency, owner and staff alike. */
  function invalidate(agencyId: string) {
    deps.cache.invalidatePrefix(`${agencyId}:`);
  }

  return { getCalendar, invalidate };
}

export const calendarService = createCalendarService({
  repository: calendarRepository,
  cache: new TtlCache<CalendarPayload>(CACHE_TTL_MS)
});
