import { ApiError } from "../../http/errors";
import { TtlCache } from "./cache";
import {
  computeFunnelStages,
  computeMedianResponseTime,
  computeWinRatePct,
  periodWindow,
  priorPeriodWindow,
  selectOwnerWorklistRows,
  selectRecentViews,
  selectStaffWorklistRows,
  type DashboardPeriod
} from "./aggregations";
import type {
  DashboardPayload,
  DashboardRole,
  DashboardView,
  OwnerDashboardPayload,
  StaffDashboardPayload
} from "./dashboardTypes";
import { dashboardRepository, type DashboardRepository, type RawDashboardData } from "./dashboardRepository";

/**
 * Composition layer for the dashboard read endpoint.
 *
 * Responsibilities:
 *  - Resolve `view` against the caller's role (STAFF cannot ask for owner).
 *  - Apply the 60s in-memory cache keyed by (agencyId, view, period, userKey).
 *  - Fan out to the repository, then drive the pure aggregation helpers in
 *    `aggregations.ts` to assemble the role-specific payload.
 *  - Log per-fetch durations + cacheHit per spec §10.
 *
 * No DB calls happen here directly; all reads go through `DashboardRepository`.
 */

const CACHE_TTL_MS = 60_000;
const dashboardCache = new TtlCache<DashboardPayload>(CACHE_TTL_MS);

export type ResolveDashboardOptions = {
  agencyId: string;
  userId: string;
  role: DashboardRole;
  view?: DashboardView;
  period?: DashboardPeriod;
  now?: Date;
};

export function selectViewForRole(role: DashboardRole, requested?: DashboardView): DashboardView {
  if (requested === "owner") {
    if (role === "STAFF") {
      throw new ApiError(403, "DASHBOARD_VIEW_FORBIDDEN", "Owner dashboard is restricted to OWNER/ADMIN.");
    }
    return "owner";
  }
  if (requested === "staff") {
    // any active membership may request the staff view
    return "staff";
  }
  // Default by role
  return role === "STAFF" ? "staff" : "owner";
}

function buildCacheKey(agencyId: string, view: DashboardView, period: DashboardPeriod, userId: string): string {
  // Owner view is shared per (agency, period); staff view is per-user.
  return view === "owner" ? `${agencyId}:owner:${period}` : `${agencyId}:staff:${period}:${userId}`;
}

export function createDashboardService(deps: {
  repository: DashboardRepository;
  cache: TtlCache<DashboardPayload>;
}) {
  async function getDashboard(opts: ResolveDashboardOptions): Promise<DashboardPayload> {
    const startedAt = Date.now();
    const view = selectViewForRole(opts.role, opts.view);
    const period: DashboardPeriod = opts.period ?? "30d";
    const now = opts.now ?? new Date();

    const cacheKey = buildCacheKey(opts.agencyId, view, period, opts.userId);
    const cached = deps.cache.get(cacheKey);
    if (cached) {
      logFetch({ agencyId: opts.agencyId, view, period, durationMs: Date.now() - startedAt, cacheHit: true });
      return cached;
    }

    // Read before the await: an invalidate() while we fetch must stop us caching stale rows.
    const generation = deps.cache.generation;
    const raw = await deps.repository.fetchAgencyDashboardData(opts.agencyId);
    const payload =
      view === "owner"
        ? composeOwnerPayload({ raw, period, now })
        : composeStaffPayload({ raw, period, now, userId: opts.userId });

    deps.cache.setIfCurrent(cacheKey, payload, generation);
    logFetch({ agencyId: opts.agencyId, view, period, durationMs: Date.now() - startedAt, cacheHit: false });
    return payload;
  }

  /**
   * Forgets every cached payload for the agency: the owner entries and each
   * staff member's (`${agencyId}:staff:${period}:${userId}`). Agency ids are
   * UUIDs followed by ":", so the prefix can't match another agency.
   */
  function invalidate(agencyId: string) {
    deps.cache.invalidatePrefix(`${agencyId}:`);
  }

  return { getDashboard, invalidate };
}

// ---------- Payload composition ----------

function composeOwnerPayload(args: {
  raw: RawDashboardData;
  period: DashboardPeriod;
  now: Date;
}): OwnerDashboardPayload {
  const { raw, period, now } = args;
  const window = periodWindow(period, now);
  const prior = priorPeriodWindow(period, now);

  const tripsInWindow = raw.trips.filter((t) => t.createdAt >= window.start && t.createdAt <= window.end);
  const tripsInPrior = raw.trips.filter((t) => t.createdAt >= prior.start && t.createdAt < prior.end);

  // KPI values are null when the window has no signal, so the client can show
  // "no data" instead of a real-looking 0 (and a bogus delta against it).

  // ---- KPI: win rate (percent) ----
  const winRate = computeWinRatePct(tripsInWindow);
  const winRatePrior = computeWinRatePct(tripsInPrior);

  // ---- KPI: time-to-first-share (avg days) ----
  const timeToFirstShareDays = computeAvgTimeToFirstShareDays(raw, tripsInWindow);
  const timeToFirstShareDaysPrior = computeAvgTimeToFirstShareDays(raw, tripsInPrior);

  // ---- KPI: median comment response time (hours) ----
  const commentsInWindow = raw.comments.filter((c) => c.createdAt >= window.start && c.createdAt <= window.end);
  const commentsInPrior = raw.comments.filter((c) => c.createdAt >= prior.start && c.createdAt < prior.end);
  const medianResponse = computeMedianResponseTime(commentsInWindow);
  const medianResponsePrior = computeMedianResponseTime(commentsInPrior);

  // ---- KPI: avg proposal rating + response rate ----
  const sharesInWindow = raw.shares.filter((s) => s.createdAt >= window.start && s.createdAt <= window.end);
  const ratedSharesInWindow = sharesInWindow.filter((s) => s.proposalRating !== null);
  const avgRating =
    ratedSharesInWindow.length > 0
      ? ratedSharesInWindow.reduce((sum, s) => sum + (s.proposalRating ?? 0), 0) / ratedSharesInWindow.length
      : null;
  const ratedSharesPrior = raw.shares.filter(
    (s) =>
      s.createdAt >= prior.start &&
      s.createdAt < prior.end &&
      s.proposalRating !== null
  );
  const avgRatingPrior =
    ratedSharesPrior.length > 0
      ? ratedSharesPrior.reduce((sum, s) => sum + (s.proposalRating ?? 0), 0) / ratedSharesPrior.length
      : null;

  // ---- Funnel ----
  const funnelStages = computeFunnelStages({
    created: tripsInWindow.length,
    drafted: raw.itineraries.filter((i) => {
      const trip = raw.trips.find((t) => t.id === i.tripId);
      return trip && trip.createdAt >= window.start && trip.createdAt <= window.end;
    }).length,
    sent: sharesInWindow.length,
    viewed: sharesInWindow.filter((s) => s.viewCount > 0).length,
    approved: tripsInWindow.filter((t) => t.status === "APPROVED_INTERNAL").length
  });

  // ---- Worklist ----
  const worklist = selectOwnerWorklistRows({
    trips: raw.trips,
    shares: raw.shares,
    comments: raw.comments,
    now
  });

  // ---- Recent reviews ----
  const recentReviews = raw.reviews.slice(0, 5).map((r) => {
    const trip = raw.trips.find((t) => t.id === r.tripId);
    return {
      id: r.id,
      rating: r.rating,
      reviewText: r.reviewText,
      respondentName: r.respondentName,
      tripTitle: trip?.title ?? "(untitled)",
      consentToTestimonial: r.consentToTestimonial,
      submittedAt: r.submittedAt.toISOString()
    };
  });

  // ---- Activity ribbon ----
  const activityRibbon = buildActivityRibbon(raw, window);

  return {
    view: "owner",
    period,
    generatedAt: now.toISOString(),
    worklist,
    kpis: {
      winRate: { value: winRate, deltaVsPrior: deltaOrNull(winRate, winRatePrior), sparkline: buildSparkline(tripsInWindow.map((t) => t.createdAt), window) },
      timeToFirstShareDays: {
        value: timeToFirstShareDays,
        deltaVsPrior: deltaOrNull(timeToFirstShareDays, timeToFirstShareDaysPrior),
        sparkline: []
      },
      medianCommentResponseHours: {
        value: medianResponse,
        deltaVsPrior: deltaOrNull(medianResponse, medianResponsePrior),
        sparkline: []
      },
      avgProposalRating: {
        value: avgRating,
        deltaVsPrior: deltaOrNull(avgRating, avgRatingPrior),
        sparkline: [],
        responseRate: {
          rated: ratedSharesInWindow.length,
          total: sharesInWindow.length,
          pct: sharesInWindow.length > 0 ? (ratedSharesInWindow.length / sharesInWindow.length) * 100 : 0
        }
      }
    },
    funnel: { stages: funnelStages },
    recentReviews,
    recentViews: selectRecentViews({ trips: raw.trips, shares: raw.shares, now }),
    activityRibbon
  };
}

function composeStaffPayload(args: {
  raw: RawDashboardData;
  period: DashboardPeriod;
  now: Date;
  userId: string;
}): StaffDashboardPayload {
  const { raw, period, now, userId } = args;

  const myTrips = raw.trips.filter(
    (t) => t.assignedOrganizerUserId === userId || t.createdByUserId === userId
  );

  // Hero = most-recently-updated of my trips
  const sortedByUpdated = [...myTrips].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const heroTrip = sortedByUpdated[0];

  const hero = heroTrip
    ? {
        tripId: heroTrip.id,
        tripTitle: heroTrip.title,
        clientName: heroTrip.clientName,
        statusChip: heroTrip.status,
        lastActivityPreview: null,
        updatedAt: heroTrip.updatedAt.toISOString()
      }
    : null;

  const secondaryRecent = sortedByUpdated.slice(1, 4).map((t) => ({
    tripId: t.id,
    tripTitle: t.title,
    clientName: t.clientName,
    statusChip: t.status,
    updatedAt: t.updatedAt.toISOString()
  }));

  const worklist = selectStaffWorklistRows({
    trips: raw.trips,
    shares: raw.shares,
    comments: raw.comments,
    now,
    userId
  });

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const pipeline = {
    drafts: myTrips.filter((t) => t.status === "DRAFT").length,
    inReview: myTrips.filter((t) => t.status === "IN_REVIEW").length,
    approvedThisMonth: myTrips.filter((t) => t.status === "APPROVED_INTERNAL" && t.updatedAt >= monthStart).length,
    activeNow: myTrips.filter(
      (t) =>
        t.startDate !== null &&
        t.endDate !== null &&
        t.startDate <= now &&
        t.endDate >= now
    ).length
  };

  const fiveDaysOut = 5 * 24 * 60 * 60 * 1000;
  const upcomingWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const startingSoon = myTrips
    .filter((t) => t.startDate !== null && t.startDate > now && t.startDate <= upcomingWindow)
    .sort((a, b) => (a.startDate!.getTime() - b.startDate!.getTime()))
    .slice(0, 6)
    .map((t) => ({
      tripId: t.id,
      tripTitle: t.title,
      clientName: t.clientName,
      startDate: t.startDate!.toISOString(),
      daysToStart: Math.max(0, Math.ceil((t.startDate!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))),
      travelerCount: t.travelerCount
    }));

  // Silence "unused" lint on the soft cutoff constant — kept for future "starting in <5d highlight" UX
  void fiveDaysOut;

  return {
    view: "staff",
    period,
    generatedAt: now.toISOString(),
    hero,
    secondaryRecent,
    worklist,
    pipeline,
    startingSoon,
    recentViews: selectRecentViews({ trips: raw.trips, shares: raw.shares, now, userId })
  };
}

// ---------- Small helpers ----------

/** A KPI delta only means something when both periods have signal. */
function deltaOrNull(current: number | null, prior: number | null): number | null {
  return current === null || prior === null ? null : current - prior;
}

function computeAvgTimeToFirstShareDays(raw: RawDashboardData, trips: RawDashboardData["trips"]): number | null {
  const firstShareByTrip = new Map<string, Date>();
  for (const s of raw.shares) {
    if (s.tripId === null) continue;
    const prev = firstShareByTrip.get(s.tripId);
    if (!prev || s.createdAt < prev) firstShareByTrip.set(s.tripId, s.createdAt);
  }
  const deltas: number[] = [];
  for (const t of trips) {
    const first = firstShareByTrip.get(t.id);
    if (!first) continue;
    const ms = first.getTime() - t.createdAt.getTime();
    if (ms < 0) continue;
    deltas.push(ms / (24 * 60 * 60 * 1000));
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((s, x) => s + x, 0) / deltas.length;
}

function buildSparkline(timestamps: Date[], window: { start: Date; end: Date }): number[] {
  // 7-bucket sparkline — even buckets across window. Keep cheap; full chart logic lives client-side.
  const buckets = 7;
  const out = new Array<number>(buckets).fill(0);
  const span = window.end.getTime() - window.start.getTime();
  if (span <= 0) return out;
  for (const t of timestamps) {
    const idx = Math.min(buckets - 1, Math.floor(((t.getTime() - window.start.getTime()) / span) * buckets));
    if (idx >= 0) out[idx] += 1;
  }
  return out;
}

function buildActivityRibbon(
  raw: RawDashboardData,
  window: { start: Date; end: Date }
): OwnerDashboardPayload["activityRibbon"] {
  const events: OwnerDashboardPayload["activityRibbon"] = [];
  // share_sent
  for (const s of raw.shares) {
    if (s.tripId === null) continue;
    if (s.createdAt < window.start || s.createdAt > window.end) continue;
    const trip = raw.trips.find((t) => t.id === s.tripId);
    if (!trip) continue;
    events.push({ kind: "share_sent", tripId: trip.id, tripTitle: trip.title, occurredAt: s.createdAt.toISOString() });
  }
  // itinerary_approved (trips moved to APPROVED_INTERNAL)
  for (const t of raw.trips) {
    if (t.status !== "APPROVED_INTERNAL") continue;
    if (t.updatedAt < window.start || t.updatedAt > window.end) continue;
    events.push({ kind: "itinerary_approved", tripId: t.id, tripTitle: t.title, occurredAt: t.updatedAt.toISOString() });
  }
  // trip_status_changed (trips updated within window but not approved)
  // omit — would need history table; skip in v1.
  return events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, 6);
}

// ---------- Logging ----------

function logFetch(info: {
  agencyId: string;
  view: DashboardView;
  period: DashboardPeriod;
  durationMs: number;
  cacheHit: boolean;
}) {
  console.log(`[dashboard] fetch agencyId=${info.agencyId} view=${info.view} period=${info.period} durationMs=${info.durationMs} cacheHit=${info.cacheHit}`);
}

// ---------- Default singleton ----------

export const dashboardService = createDashboardService({
  repository: dashboardRepository,
  cache: dashboardCache
});
