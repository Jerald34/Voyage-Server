/**
 * Public types for the dashboard read-side composition module.
 *
 * Keep concrete validation in `dashboardSchemas.ts` (Zod) — these are the
 * narrower TypeScript shapes that the rest of the codebase consumes.
 */

export type DashboardView = "owner" | "staff";
export type DashboardPeriod = "7d" | "30d" | "90d";

export type DashboardRole = "OWNER" | "ADMIN" | "STAFF";

// ---------- Owner ----------

export type OwnerWorklistUnreadComment = {
  id: string;
  tripId: string;
  tripTitle: string;
  authorName: string;
  commentExcerpt: string;
  createdAt: string;
};

export type OwnerWorklistViewedNotReplied = {
  shareId: string;
  tripId: string;
  tripTitle: string;
  viewCount: number;
  lastViewedAt: string;
};

export type OwnerWorklistDraftStuck = {
  tripId: string;
  tripTitle: string;
  updatedAt: string;
};

export type OwnerWorklistShareExpiring = {
  shareId: string;
  tripId: string;
  tripTitle: string;
  expiresAt: string;
};

export type OwnerWorklistLowRated = {
  shareId: string;
  tripId: string;
  tripTitle: string;
  rating: number;
  ratedAt: string;
};

export type OwnerWorklist = {
  unreadComments: OwnerWorklistUnreadComment[];
  viewedNotReplied: OwnerWorklistViewedNotReplied[];
  draftsStuck: OwnerWorklistDraftStuck[];
  sharesExpiring: OwnerWorklistShareExpiring[];
  lowRated: OwnerWorklistLowRated[];
};

/** One client comment on the dashboard's "Client comments" card. */
export type ClientCommentRow = {
  id: string;
  shareId: string;
  tripId: string;
  tripTitle: string;
  /** Who the link was shared with, else the trip's client. */
  clientName: string | null;
  authorName: string;
  excerpt: string;
  dayNumber: number | null;
  /** The stop's title; null for a day-level comment or a deleted stop. */
  itemTitle: string | null;
  createdAt: string;
  agencyReply: string | null;
  agencyRepliedAt: string | null;
};

export type ClientComments = {
  /** No reply yet, oldest first. */
  waiting: ClientCommentRow[];
  /** Replied in the last 30 days, newest reply first. */
  answered: ClientCommentRow[];
};

/**
 * `value` is null when the period has no signal (e.g. no closed trips, no
 * replied comments); `deltaVsPrior` is null unless both periods have signal.
 * Win rate is a percentage (0–100) and its delta is in percentage points.
 */
export type KpiTile = {
  value: number | null;
  deltaVsPrior: number | null;
  sparkline: number[];
};

export type AvgProposalRatingKpi = KpiTile & {
  responseRate: { rated: number; total: number; pct: number };
};

export type OwnerKpis = {
  winRate: KpiTile;
  timeToFirstShareDays: KpiTile;
  medianCommentResponseHours: KpiTile;
  avgProposalRating: AvgProposalRatingKpi;
};

export type FunnelStageKey = "created" | "drafted" | "sent" | "viewed" | "approved";

export type FunnelStage = {
  key: FunnelStageKey;
  count: number;
  dropOffPct: number | null;
};

export type TripStatus = "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";

/** One trip in a dashboard trip list (a funnel stage, a staff counter). */
export type TripListRow = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  status: TripStatus;
};

/** A funnel stage with the trips behind its count (at most 50; `count` stays exact). */
export type FunnelStageWithTrips = FunnelStage & { trips: TripListRow[] };

export type OwnerFunnel = {
  stages: FunnelStageWithTrips[];
};

export type OwnerRecentReview = {
  id: string;
  rating: number;
  reviewText: string | null;
  respondentName: string | null;
  tripTitle: string;
  consentToTestimonial: boolean;
  submittedAt: string;
};

/** A trip clients opened recently, for the Recently viewed card. */
export type RecentView = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** All-time views, summed over the trip's share links. */
  viewCount: number;
  /** The latest view over those links (ISO). */
  lastViewedAt: string;
};

export type ActivityRibbonItem = {
  kind: "share_sent" | "trip_status_changed" | "itinerary_approved";
  tripId: string;
  tripTitle: string;
  occurredAt: string;
};

export type OwnerDashboardPayload = {
  view: "owner";
  period: DashboardPeriod;
  generatedAt: string;
  worklist: OwnerWorklist;
  clientComments: ClientComments;
  kpis: OwnerKpis;
  funnel: OwnerFunnel;
  recentReviews: OwnerRecentReview[];
  recentViews: RecentView[];
  activityRibbon: ActivityRibbonItem[];
};

// ---------- Staff ----------

export type StaffHero = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  statusChip: string;
  lastActivityPreview: string | null;
  updatedAt: string;
};

export type StaffSecondaryRecent = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  statusChip: string;
  updatedAt: string;
};

export type StaffWorklistUnreadComment = OwnerWorklistUnreadComment;

export type StaffWorklistMyDraftStuck = {
  tripId: string;
  tripTitle: string;
  updatedAt: string;
};

export type StaffWorklistMyShareExpiring = {
  shareId: string;
  tripId: string;
  tripTitle: string;
  expiresAt: string;
};

export type StaffWorklistStartingSoon = {
  tripId: string;
  tripTitle: string;
  startDate: string;
  daysToStart: number;
};

export type StaffWorklist = {
  unreadComments: StaffWorklistUnreadComment[];
  myDraftsStuck: StaffWorklistMyDraftStuck[];
  mySharesExpiring: StaffWorklistMyShareExpiring[];
  startingSoon: StaffWorklistStartingSoon[];
};

export type StaffPipeline = {
  drafts: number;
  inReview: number;
  approvedThisMonth: number;
  activeNow: number;
};

/** The trips behind each staff counter, at most 50 each, most recently updated first. */
export type StaffPipelineTrips = {
  drafts: TripListRow[];
  inReview: TripListRow[];
  approvedThisMonth: TripListRow[];
  activeNow: TripListRow[];
};

export type StaffStartingSoonCard = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  startDate: string;
  daysToStart: number;
  travelerCount: number | null;
};

export type StaffDashboardPayload = {
  view: "staff";
  period: DashboardPeriod;
  generatedAt: string;
  hero: StaffHero | null;
  secondaryRecent: StaffSecondaryRecent[];
  worklist: StaffWorklist;
  clientComments: ClientComments;
  pipeline: StaffPipeline;
  pipelineTrips: StaffPipelineTrips;
  startingSoon: StaffStartingSoonCard[];
  recentViews: RecentView[];
};

export type DashboardPayload = OwnerDashboardPayload | StaffDashboardPayload;

// ---------- Calendar ----------

export type CalendarEventKind =
  | "share_sent"
  | "share_expires"
  | "client_viewed"
  | "client_commented"
  | "proposal_rated"
  | "review_submitted";

export type CalendarTrip = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** destinationSummary, or the title when there is none; shown on the calendar tile. */
  placeLabel: string;
  /** Calendar date, YYYY-MM-DD. */
  startDate: string;
  /** Calendar date, YYYY-MM-DD; equals startDate for one-day or undated-end trips. */
  endDate: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL";
  travelerCount: number | null;
};

export type CalendarEvent = {
  /** "{kind}:{source row id}" — unique within a payload. */
  id: string;
  kind: CalendarEventKind;
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** ISO instant; the client places it on the viewer's local day. */
  occurredAt: string;
  /** `needsReply` is set on client_commented events only. */
  detail: { viewCount?: number; rating?: number; excerpt?: string; needsReply?: boolean };
};

export type CalendarPayload = {
  from: string;
  to: string;
  generatedAt: string;
  /** In-scope, non-archived trips with no start date. */
  tripsWithoutDates: number;
  trips: CalendarTrip[];
  events: CalendarEvent[];
};
