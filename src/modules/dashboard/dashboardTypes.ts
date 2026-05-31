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

export type KpiTile = {
  value: number;
  deltaVsPrior: number;
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

export type OwnerFunnel = {
  stages: FunnelStage[];
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
  kpis: OwnerKpis;
  funnel: OwnerFunnel;
  recentReviews: OwnerRecentReview[];
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
  pipeline: StaffPipeline;
  startingSoon: StaffStartingSoonCard[];
};

export type DashboardPayload = OwnerDashboardPayload | StaffDashboardPayload;
