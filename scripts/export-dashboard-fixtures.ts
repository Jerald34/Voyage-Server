/**
 * export-dashboard-fixtures.ts
 *
 * Prints the dashboard payloads this server actually produces for a small,
 * fixed agency dataset. Voyage-Client's contract test renders these exact
 * payloads, so the client is checked against real server output rather than
 * hand-written shapes. Regenerate the client fixture whenever the dashboard
 * payload changes:
 *
 *   npx tsx scripts/export-dashboard-fixtures.ts > ../Voyage-Client/tests/fixtures/dashboard-payloads.json
 *
 * Uses an in-memory repository — no database access.
 */
import { TtlCache } from "../src/modules/dashboard/cache";
import type { RawDashboardData } from "../src/modules/dashboard/dashboardRepository";
import { createDashboardService } from "../src/modules/dashboard/dashboardService";
import type { DashboardPayload, DashboardPeriod } from "../src/modules/dashboard/dashboardTypes";

const NOW = new Date("2026-09-27T04:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const after = (date: Date, offsetMs: number) => new Date(date.getTime() + offsetMs);

const OWNER = "user-owner";
const STAFF = "user-staff";

type Trip = RawDashboardData["trips"][number];
type Share = RawDashboardData["shares"][number];
type Comment = RawDashboardData["comments"][number];

function trip(id: string, fields: Partial<Trip> & Pick<Trip, "title" | "status" | "createdAt">): Trip {
  return {
    id,
    updatedAt: fields.createdAt,
    startDate: null,
    endDate: null,
    travelerCount: null,
    clientName: null,
    createdByUserId: STAFF,
    assignedOrganizerUserId: null,
    ...fields
  };
}

function share(id: string, tripId: string, fields: Partial<Share> & Pick<Share, "createdAt">): Share {
  return {
    id,
    tripId,
    clientName: null,
    viewCount: 0,
    lastViewedAt: null,
    expiresAt: null,
    revokedAt: null,
    proposalRating: null,
    proposalRatedAt: null,
    ...fields
  };
}

function repliedComment(id: string, shareId: string, createdAt: Date, replyAfterMs: number): Comment {
  return { id, shareId, content: "Client question", status: "ADDRESSED", agencyRepliedAt: after(createdAt, replyAfterMs), createdAt };
}

// ---- Current 30d window: 2 approved + 1 archived closed trips ----
const kyoto = trip("trip-kyoto", {
  title: "Kyoto Autumn Escape",
  clientName: "Santos Family",
  status: "IN_REVIEW",
  createdAt: at(-12 * DAY),
  updatedAt: at(-2 * HOUR),
  startDate: at(20 * DAY),
  endDate: at(25 * DAY),
  travelerCount: 4
});
const bali = trip("trip-bali", {
  title: "Bali Honeymoon",
  clientName: "Reyes & Cruz",
  status: "DRAFT",
  createdAt: at(-9 * DAY),
  updatedAt: at(-4 * DAY)
});
const palawan = trip("trip-palawan", {
  title: "Palawan Family Trip",
  clientName: "Lim Family",
  status: "APPROVED_INTERNAL",
  createdAt: at(-20 * DAY),
  updatedAt: at(-3 * DAY),
  startDate: at(3 * DAY),
  endDate: at(8 * DAY),
  travelerCount: 5
});
const seoul = trip("trip-seoul", {
  title: "Seoul Food Tour",
  clientName: "Tan Group",
  status: "ARCHIVED",
  createdAt: at(-15 * DAY),
  updatedAt: at(-6 * DAY)
});
const cebu = trip("trip-cebu", {
  title: "Cebu Island Hop",
  clientName: "Garcia Family",
  status: "APPROVED_INTERNAL",
  createdAt: at(-25 * DAY),
  updatedAt: at(-10 * DAY),
  createdByUserId: OWNER
});
// Untouched for 9 days: lands on the owner's stuck-drafts list.
const batanes = trip("trip-batanes", {
  title: "Batanes Road Trip",
  clientName: "Villanueva Family",
  status: "DRAFT",
  createdAt: at(-14 * DAY),
  updatedAt: at(-9 * DAY),
  createdByUserId: OWNER
});

// ---- Prior 30d window: 1 approved + 1 archived ----
const siargao = trip("trip-siargao", {
  title: "Siargao Surf Week",
  status: "APPROVED_INTERNAL",
  createdAt: at(-45 * DAY),
  updatedAt: at(-35 * DAY),
  createdByUserId: OWNER
});
const vigan = trip("trip-vigan", {
  title: "Vigan Heritage Walk",
  status: "ARCHIVED",
  createdAt: at(-50 * DAY),
  updatedAt: at(-40 * DAY),
  createdByUserId: OWNER
});
// Still in review; the client rated its proposal 2★ last week, which puts it
// on the owner's low-rating list.
const boracay = trip("trip-boracay", {
  title: "Boracay Barkada Weekend",
  clientName: "Dela Cruz Barkada",
  status: "IN_REVIEW",
  createdAt: at(-40 * DAY),
  updatedAt: at(-6 * DAY),
  createdByUserId: OWNER
});

const trips = [kyoto, bali, palawan, seoul, cebu, batanes, siargao, vigan, boracay];

// Current shares are unrated, so the rating KPI has no signal this period.
// Shared with one family member by name: Recently viewed shows the link's name, not the trip's.
const kyotoShare = share("share-kyoto", kyoto.id, {
  clientName: "Maria Santos",
  createdAt: after(kyoto.createdAt, DAY + 7 * HOUR + 13 * MINUTE),
  viewCount: 4,
  lastViewedAt: at(-5 * HOUR),
  expiresAt: at(20 * HOUR)
});
const palawanShare = share("share-palawan", palawan.id, {
  createdAt: after(palawan.createdAt, 2 * DAY + 5 * HOUR + 50 * MINUTE),
  viewCount: 2,
  lastViewedAt: at(-4 * DAY)
});
const cebuShare = share("share-cebu", cebu.id, {
  createdAt: after(cebu.createdAt, DAY + 11 * HOUR),
  viewCount: 1,
  lastViewedAt: at(-12 * DAY)
});
const siargaoShare = share("share-siargao", siargao.id, {
  createdAt: after(siargao.createdAt, DAY),
  viewCount: 3,
  proposalRating: 5,
  proposalRatedAt: at(-38 * DAY)
});
const viganShare = share("share-vigan", vigan.id, {
  createdAt: after(vigan.createdAt, 12 * HOUR),
  viewCount: 1,
  proposalRating: 4,
  proposalRatedAt: at(-44 * DAY)
});
const boracayShare = share("share-boracay", boracay.id, {
  createdAt: after(boracay.createdAt, DAY),
  viewCount: 2,
  lastViewedAt: at(-6 * DAY),
  proposalRating: 2,
  proposalRatedAt: at(-6 * DAY)
});

const comments: Comment[] = [
  repliedComment("comment-kyoto", kyotoShare.id, at(-26 * HOUR), 2 * HOUR + 32 * MINUTE),
  repliedComment("comment-palawan", palawanShare.id, at(-3 * DAY), HOUR + 30 * MINUTE),
  repliedComment("comment-cebu", cebuShare.id, at(-11 * DAY), 4 * HOUR),
  repliedComment("comment-siargao", siargaoShare.id, at(-37 * DAY), HOUR + 20 * MINUTE),
  {
    id: "comment-kyoto-unread",
    shareId: kyotoShare.id,
    content: "Can we swap the day 2 lunch spot?",
    status: "PENDING",
    agencyRepliedAt: null,
    createdAt: at(-6 * HOUR)
  },
  // A second open question on the same trip: each comment is its own row.
  {
    id: "comment-kyoto-unread-access",
    shareId: kyotoShare.id,
    content: "Is the ryokan wheelchair accessible? My father uses one.",
    status: "PENDING",
    agencyRepliedAt: null,
    createdAt: at(-30 * HOUR)
  }
];

const busyAgency: RawDashboardData = {
  trips,
  itineraries: trips.map((t) => ({ id: `itinerary-${t.id}`, tripId: t.id, createdAt: after(t.createdAt, HOUR) })),
  shares: [kyotoShare, palawanShare, cebuShare, siargaoShare, viganShare, boracayShare],
  comments,
  reviews: [
    {
      id: "review-cebu",
      rating: 5,
      reviewText: "Everything ran on time.",
      respondentName: "Ana G.",
      consentToTestimonial: true,
      submittedAt: at(-3 * DAY),
      tripId: cebu.id
    }
  ]
};

const emptyAgency: RawDashboardData = { trips: [], itineraries: [], shares: [], comments: [], reviews: [] };

async function payloadFor(
  data: RawDashboardData,
  userId: string,
  role: "OWNER" | "STAFF",
  view: "owner" | "staff",
  period: DashboardPeriod = "30d"
): Promise<DashboardPayload> {
  const service = createDashboardService({
    repository: { fetchAgencyDashboardData: async () => data },
    cache: new TtlCache<DashboardPayload>(60_000)
  });
  return service.getDashboard({ agencyId: "agency-fixture", userId, role, view, period, now: NOW });
}

async function main() {
  // getDashboard logs one line per fetch; keep stdout pure JSON.
  const log = console.log;
  console.log = () => {};
  const fixtures = {
    _about: "Generated by Voyage-Server/scripts/export-dashboard-fixtures.ts from real dashboardService output. Do not edit by hand.",
    ownerBusy: await payloadFor(busyAgency, OWNER, "OWNER", "owner"),
    ownerBusyWeek: await payloadFor(busyAgency, OWNER, "OWNER", "owner", "7d"),
    ownerEmpty: await payloadFor(emptyAgency, OWNER, "OWNER", "owner"),
    staff: await payloadFor(busyAgency, STAFF, "STAFF", "staff")
  };
  console.log = log;
  process.stdout.write(`${JSON.stringify(fixtures, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
