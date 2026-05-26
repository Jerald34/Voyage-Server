/**
 * Pure aggregation helpers for the agency dashboard.
 *
 * No DB access, no `prisma`, no clock side effects beyond what is passed in.
 * Each function takes plain values and returns plain values so they can be
 * unit-tested against fixtures without a database.
 *
 * See `docs/superpowers/specs/2026-05-26-agency-dashboard-design.md` §3 and §4
 * for the contracts these helpers serve.
 */

import type { FunnelStage, FunnelStageKey } from "./dashboardTypes";

// ---------- Win rate ----------

export type TripStatusOnly = { status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED" };

/**
 * Approved / (Approved + Archived). Returns 0 when there are no closed trips
 * (denominator zero), which matches the "no signal yet" empty state in the spec.
 */
export function computeWinRate(trips: TripStatusOnly[]): number {
  let approved = 0;
  let archived = 0;
  for (const t of trips) {
    if (t.status === "APPROVED_INTERNAL") approved += 1;
    else if (t.status === "ARCHIVED") archived += 1;
  }
  const denom = approved + archived;
  if (denom === 0) return 0;
  return approved / denom;
}

// ---------- Median comment response time ----------

export type CommentForResponseTime = { createdAt: Date; agencyRepliedAt: Date | null };

/**
 * Median *hours* between a comment's createdAt and the agency's first reply.
 * Returns null when no comments have been replied to (no signal).
 */
export function computeMedianResponseTime(comments: CommentForResponseTime[]): number | null {
  const durations: number[] = [];
  for (const c of comments) {
    if (c.agencyRepliedAt === null) continue;
    const ms = c.agencyRepliedAt.getTime() - c.createdAt.getTime();
    if (ms < 0) continue;
    durations.push(ms / (1000 * 60 * 60));
  }
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  if (durations.length % 2 === 0) {
    return (durations[mid - 1] + durations[mid]) / 2;
  }
  return durations[mid];
}

// ---------- Funnel stages ----------

export type FunnelCounts = {
  created: number;
  drafted: number;
  sent: number;
  viewed: number;
  approved: number;
};

/**
 * Convert raw stage counts into the funnel array with drop-off percentages
 * between consecutive stages. The first stage always has `dropOffPct: null`
 * (no prior stage to compare to). If a prior stage is zero, the drop-off for
 * the following stage is `null` rather than NaN/Infinity.
 */
export function computeFunnelStages(counts: FunnelCounts): FunnelStage[] {
  const order: FunnelStageKey[] = ["created", "drafted", "sent", "viewed", "approved"];
  const stages: FunnelStage[] = [];
  let prior: number | null = null;
  for (const key of order) {
    const count = counts[key];
    let dropOffPct: number | null = null;
    if (prior !== null) {
      if (prior === 0) {
        dropOffPct = null;
      } else {
        const lost = prior - count;
        dropOffPct = (lost / prior) * 100;
      }
    }
    stages.push({ key, count, dropOffPct });
    prior = count;
  }
  return stages;
}

// ---------- Worklist row selectors ----------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type WorklistInputs = {
  // Inputs shared by both views
  trips: Array<{
    id: string;
    title: string;
    status: TripStatusOnly["status"];
    updatedAt: Date;
    createdByUserId: string;
    assignedOrganizerUserId: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    clientName: string | null;
  }>;
  shares: Array<{
    id: string;
    tripId: string | null;
    viewCount: number;
    lastViewedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    proposalRating: number | null;
    proposalRatedAt: Date | null;
    createdAt: Date;
  }>;
  comments: Array<{
    id: string;
    shareId: string;
    content: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    agencyRepliedAt: Date | null;
    createdAt: Date;
  }>;
  now: Date;
};

export type OwnerWorklistResult = {
  unreadComments: Array<{ id: string; tripId: string; tripTitle: string; commentExcerpt: string; createdAt: string }>;
  viewedNotReplied: Array<{ shareId: string; tripId: string; tripTitle: string; viewCount: number; lastViewedAt: string }>;
  draftsStuck: Array<{ tripId: string; tripTitle: string; updatedAt: string }>;
  sharesExpiring: Array<{ shareId: string; tripId: string; tripTitle: string; expiresAt: string }>;
  lowRated: Array<{ shareId: string; tripId: string; tripTitle: string; rating: number; ratedAt: string }>;
};

export type StaffWorklistResult = {
  unreadComments: OwnerWorklistResult["unreadComments"];
  myDraftsStuck: Array<{ tripId: string; tripTitle: string; updatedAt: string }>;
  mySharesExpiring: Array<{ shareId: string; tripId: string; tripTitle: string; expiresAt: string }>;
  startingSoon: Array<{ tripId: string; tripTitle: string; startDate: string; daysToStart: number }>;
};

function shareToTripId(shares: WorklistInputs["shares"]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of shares) {
    if (s.tripId) m.set(s.id, s.tripId);
  }
  return m;
}

function tripById(trips: WorklistInputs["trips"]) {
  const m = new Map<string, WorklistInputs["trips"][number]>();
  for (const t of trips) m.set(t.id, t);
  return m;
}

/**
 * Owner worklist selector. Implements spec §3.1 ordering and thresholds.
 * Trips owned by the agency are already filtered upstream.
 */
export function selectOwnerWorklistRows(inputs: WorklistInputs): OwnerWorklistResult {
  const { trips, shares, comments, now } = inputs;
  const tripIndex = tripById(trips);
  const shareTripMap = shareToTripId(shares);

  // Unread client comments — oldest first
  const unreadComments = comments
    .filter((c) => c.status === "PENDING" && c.agencyRepliedAt === null)
    .filter((c) => shareTripMap.has(c.shareId))
    .map((c) => {
      const tripId = shareTripMap.get(c.shareId)!;
      const trip = tripIndex.get(tripId);
      return {
        id: c.id,
        tripId,
        tripTitle: trip?.title ?? "(untitled)",
        commentExcerpt: c.content.slice(0, 140),
        createdAt: c.createdAt.toISOString()
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // Viewed, not replied: shares with views > 0, trip still IN_REVIEW, no recent reply
  const viewedNotReplied = shares
    .filter((s) => s.viewCount > 0 && s.revokedAt === null && s.tripId !== null)
    .filter((s) => {
      const trip = tripIndex.get(s.tripId!);
      if (!trip) return false;
      if (trip.status !== "IN_REVIEW") return false;
      // No agency comment reply on this share after the last view
      const shareComments = comments.filter((c) => c.shareId === s.id);
      const repliedAfterLastView = shareComments.some(
        (c) =>
          c.agencyRepliedAt !== null &&
          s.lastViewedAt !== null &&
          c.agencyRepliedAt.getTime() > s.lastViewedAt.getTime()
      );
      return !repliedAfterLastView;
    })
    .map((s) => {
      const trip = tripIndex.get(s.tripId!)!;
      return {
        shareId: s.id,
        tripId: trip.id,
        tripTitle: trip.title,
        viewCount: s.viewCount,
        lastViewedAt: (s.lastViewedAt ?? s.createdAt).toISOString()
      };
    })
    .sort((a, b) => (a.lastViewedAt < b.lastViewedAt ? 1 : -1));

  // Drafts stuck > 7 days (owner threshold per spec §3.1)
  const owner7DayCutoff = new Date(now.getTime() - 7 * MS_PER_DAY);
  const draftsStuck = trips
    .filter((t) => t.status === "DRAFT" && t.updatedAt < owner7DayCutoff)
    .map((t) => ({
      tripId: t.id,
      tripTitle: t.title,
      updatedAt: t.updatedAt.toISOString()
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));

  // Shares expiring < 48h (and not yet expired/revoked)
  const expiringCutoff = new Date(now.getTime() + 48 * MS_PER_HOUR);
  const sharesExpiring = shares
    .filter(
      (s) =>
        s.revokedAt === null &&
        s.expiresAt !== null &&
        s.expiresAt > now &&
        s.expiresAt < expiringCutoff &&
        s.tripId !== null
    )
    .map((s) => {
      const trip = tripIndex.get(s.tripId!)!;
      return {
        shareId: s.id,
        tripId: trip.id,
        tripTitle: trip.title,
        expiresAt: s.expiresAt!.toISOString()
      };
    })
    .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));

  // Low-rated proposals: rating <= 3 in last 14d, no agency comment reply after the rating
  const lowRatedWindow = new Date(now.getTime() - 14 * MS_PER_DAY);
  const lowRated = shares
    .filter(
      (s) =>
        s.proposalRating !== null &&
        s.proposalRating <= 3 &&
        s.proposalRatedAt !== null &&
        s.proposalRatedAt >= lowRatedWindow &&
        s.tripId !== null
    )
    .filter((s) => {
      const followUp = comments.some(
        (c) =>
          c.shareId === s.id &&
          c.agencyRepliedAt !== null &&
          s.proposalRatedAt !== null &&
          c.agencyRepliedAt.getTime() > s.proposalRatedAt.getTime()
      );
      return !followUp;
    })
    .map((s) => {
      const trip = tripIndex.get(s.tripId!)!;
      return {
        shareId: s.id,
        tripId: trip.id,
        tripTitle: trip.title,
        rating: s.proposalRating!,
        ratedAt: s.proposalRatedAt!.toISOString()
      };
    })
    .sort((a, b) => (a.ratedAt < b.ratedAt ? -1 : 1));

  return { unreadComments, viewedNotReplied, draftsStuck, sharesExpiring, lowRated };
}

/**
 * Staff worklist selector. Filtered to `me` trips per spec §4.2 with 3-day
 * (tighter) draft-stuck threshold.
 */
export function selectStaffWorklistRows(
  inputs: WorklistInputs & { userId: string }
): StaffWorklistResult {
  const { trips, shares, comments, now, userId } = inputs;

  const myTripIds = new Set(
    trips
      .filter((t) => t.assignedOrganizerUserId === userId || t.createdByUserId === userId)
      .map((t) => t.id)
  );
  const myTrips = trips.filter((t) => myTripIds.has(t.id));
  const myShares = shares.filter((s) => s.tripId !== null && myTripIds.has(s.tripId));
  const myCommentSet = new Set(myShares.map((s) => s.id));
  const myComments = comments.filter((c) => myCommentSet.has(c.shareId));

  const baseOwnerView = selectOwnerWorklistRows({
    ...inputs,
    trips: myTrips,
    shares: myShares,
    comments: myComments
  });

  // Override draft-stuck with 3-day threshold
  const staff3DayCutoff = new Date(now.getTime() - 3 * MS_PER_DAY);
  const myDraftsStuck = myTrips
    .filter((t) => t.status === "DRAFT" && t.updatedAt < staff3DayCutoff)
    .map((t) => ({ tripId: t.id, tripTitle: t.title, updatedAt: t.updatedAt.toISOString() }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));

  // Trips starting in 7 days (incl. APPROVED_INTERNAL for pre-trip touches per §4.2)
  const sevenDaysOut = new Date(now.getTime() + 7 * MS_PER_DAY);
  const startingSoon = myTrips
    .filter(
      (t) =>
        (t.status === "IN_REVIEW" || t.status === "APPROVED_INTERNAL") &&
        t.startDate !== null &&
        t.startDate > now &&
        t.startDate <= sevenDaysOut
    )
    .map((t) => ({
      tripId: t.id,
      tripTitle: t.title,
      startDate: t.startDate!.toISOString(),
      daysToStart: Math.max(0, Math.ceil((t.startDate!.getTime() - now.getTime()) / MS_PER_DAY))
    }))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

  return {
    unreadComments: baseOwnerView.unreadComments,
    myDraftsStuck,
    mySharesExpiring: baseOwnerView.sharesExpiring,
    startingSoon
  };
}

// ---------- Period helpers ----------

export type DashboardPeriod = "7d" | "30d" | "90d";

export function periodToDays(period: DashboardPeriod): number {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
  }
}

export function periodWindow(period: DashboardPeriod, now: Date): { start: Date; end: Date } {
  const days = periodToDays(period);
  return { start: new Date(now.getTime() - days * MS_PER_DAY), end: now };
}

export function priorPeriodWindow(period: DashboardPeriod, now: Date): { start: Date; end: Date } {
  const days = periodToDays(period);
  const end = new Date(now.getTime() - days * MS_PER_DAY);
  const start = new Date(end.getTime() - days * MS_PER_DAY);
  return { start, end };
}
