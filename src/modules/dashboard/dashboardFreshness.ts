import { calendarService } from "./calendarService";
import { dashboardService } from "./dashboardService";

/**
 * Forgets one agency's cached dashboard and calendar payloads, so the next
 * read rebuilds them. Call it after a change to what "needs you" shows, such
 * as an agency reply to a client comment.
 */
export function invalidateAgencyDashboards(agencyId: string): void {
  dashboardService.invalidate(agencyId);
  calendarService.invalidate(agencyId);
}
