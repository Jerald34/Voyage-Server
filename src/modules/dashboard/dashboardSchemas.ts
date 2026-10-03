import { z } from "zod";
import { isIsoDate } from "../../services/weather/dates";

export const dashboardViewSchema = z.enum(["owner", "staff"]);
export const dashboardPeriodSchema = z.enum(["7d", "30d", "90d"]);

export const dashboardQuerySchema = z.object({
  view: dashboardViewSchema.optional(),
  period: dashboardPeriodSchema.optional()
});

const kpiTileSchema = z.object({
  value: z.number().nullable(),
  deltaVsPrior: z.number().nullable(),
  sparkline: z.array(z.number())
});

const avgProposalRatingKpiSchema = kpiTileSchema.extend({
  responseRate: z.object({
    rated: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    pct: z.number()
  })
});

const funnelStageSchema = z.object({
  key: z.enum(["created", "drafted", "sent", "viewed", "approved"]),
  count: z.number().int().nonnegative(),
  dropOffPct: z.number().nullable()
});

const ownerWorklistSchema = z.object({
  unreadComments: z.array(
    z.object({
      id: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      commentExcerpt: z.string(),
      createdAt: z.string()
    })
  ),
  viewedNotReplied: z.array(
    z.object({
      shareId: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      viewCount: z.number().int().nonnegative(),
      lastViewedAt: z.string()
    })
  ),
  draftsStuck: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      updatedAt: z.string()
    })
  ),
  sharesExpiring: z.array(
    z.object({
      shareId: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      expiresAt: z.string()
    })
  ),
  lowRated: z.array(
    z.object({
      shareId: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      rating: z.number().int(),
      ratedAt: z.string()
    })
  )
});

export const ownerDashboardPayloadSchema = z.object({
  view: z.literal("owner"),
  period: dashboardPeriodSchema,
  generatedAt: z.string(),
  worklist: ownerWorklistSchema,
  kpis: z.object({
    winRate: kpiTileSchema,
    timeToFirstShareDays: kpiTileSchema,
    medianCommentResponseHours: kpiTileSchema,
    avgProposalRating: avgProposalRatingKpiSchema
  }),
  funnel: z.object({ stages: z.array(funnelStageSchema) }),
  recentReviews: z.array(
    z.object({
      id: z.string(),
      rating: z.number().int(),
      reviewText: z.string().nullable(),
      respondentName: z.string().nullable(),
      tripTitle: z.string(),
      consentToTestimonial: z.boolean(),
      submittedAt: z.string()
    })
  ),
  activityRibbon: z.array(
    z.object({
      kind: z.enum(["share_sent", "trip_status_changed", "itinerary_approved"]),
      tripId: z.string(),
      tripTitle: z.string(),
      occurredAt: z.string()
    })
  )
});

const staffWorklistSchema = z.object({
  unreadComments: z.array(
    z.object({
      id: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      commentExcerpt: z.string(),
      createdAt: z.string()
    })
  ),
  myDraftsStuck: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      updatedAt: z.string()
    })
  ),
  mySharesExpiring: z.array(
    z.object({
      shareId: z.string(),
      tripId: z.string(),
      tripTitle: z.string(),
      expiresAt: z.string()
    })
  ),
  startingSoon: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      startDate: z.string(),
      daysToStart: z.number().int()
    })
  )
});

export const staffDashboardPayloadSchema = z.object({
  view: z.literal("staff"),
  period: dashboardPeriodSchema,
  generatedAt: z.string(),
  hero: z
    .object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      statusChip: z.string(),
      lastActivityPreview: z.string().nullable(),
      updatedAt: z.string()
    })
    .nullable(),
  secondaryRecent: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      statusChip: z.string(),
      updatedAt: z.string()
    })
  ),
  worklist: staffWorklistSchema,
  pipeline: z.object({
    drafts: z.number().int().nonnegative(),
    inReview: z.number().int().nonnegative(),
    approvedThisMonth: z.number().int().nonnegative(),
    activeNow: z.number().int().nonnegative()
  }),
  startingSoon: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      startDate: z.string(),
      daysToStart: z.number().int(),
      travelerCount: z.number().int().nullable()
    })
  )
});

export const dashboardPayloadSchema = z.union([
  ownerDashboardPayloadSchema,
  staffDashboardPayloadSchema
]);

// ---------- Calendar ----------

const isoDateSchema = z.string().refine(isIsoDate, "Use a real date in YYYY-MM-DD format.");

export const calendarQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema
});

export const calendarEventKindSchema = z.enum([
  "share_sent",
  "share_expires",
  "client_viewed",
  "client_commented",
  "proposal_rated",
  "review_submitted"
]);

export const calendarPayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
  generatedAt: z.string(),
  tripsWithoutDates: z.number().int().nonnegative(),
  trips: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      placeLabel: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED_INTERNAL"]),
      travelerCount: z.number().int().nullable()
    })
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: calendarEventKindSchema,
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      occurredAt: z.string(),
      detail: z.object({
        viewCount: z.number().int().nonnegative().optional(),
        rating: z.number().int().optional(),
        excerpt: z.string().optional()
      })
    })
  )
});
