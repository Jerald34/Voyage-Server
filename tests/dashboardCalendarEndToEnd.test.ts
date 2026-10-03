import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /agencies/:agencyId/dashboard/calendar through the real route, real
 * calendarService and real buildCalendar. Only the database edge is faked:
 * `calendarRepository.fetchCalendarWindow` returns fixed rows.
 *
 * The real service keeps a module-level cache for the whole file, so each test
 * uses its own agency id to avoid reading another test's cache entry.
 */

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  fetchCalendarWindow: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({
  dashboardService: { getDashboard: vi.fn() }
}));
vi.mock("../src/modules/dashboard/calendarRepository", () => ({
  calendarRepository: { fetchCalendarWindow: mocks.fetchCalendarWindow }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import type { RawCalendarData } from "../src/modules/dashboard/calendar";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";
import { calendarPayloadSchema } from "../src/modules/dashboard/dashboardSchemas";

const STAFF_ID = "user-staff";
const OWNER_ID = "user-owner";
const OTHER_ID = "user-other";

const staffUser = {
  id: STAFF_ID,
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff Member",
  memberships: []
};

const ownerUser = { ...staffUser, id: OWNER_ID, displayName: "Agency Owner" };

function tripRef(id: string, createdByUserId: string, assignedOrganizerUserId: string | null = null) {
  return { id, title: `Trip ${id}`, clientName: `Client ${id}`, createdByUserId, assignedOrganizerUserId };
}

function datedTrip(
  ref: ReturnType<typeof tripRef>,
  startDate: string,
  endDate: string
): RawCalendarData["trips"][number] {
  return {
    ...ref,
    destinationSummary: null,
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    status: "IN_REVIEW",
    travelerCount: 2
  };
}

const created = tripRef("created", STAFF_ID);
const assigned = tripRef("assigned", OTHER_ID, STAFF_ID);
const foreign = tripRef("foreign", OTHER_ID);

/** Trips created by staff, organized by staff, and owned by another user, with activity on all three. */
function rawData(): RawCalendarData {
  return {
    trips: [
      datedTrip(created, "2026-10-08", "2026-10-14"),
      datedTrip(assigned, "2026-10-20", "2026-10-25"),
      datedTrip(foreign, "2026-10-10", "2026-10-12")
    ],
    undatedTrips: [
      { createdByUserId: STAFF_ID, assignedOrganizerUserId: null },
      { createdByUserId: OTHER_ID, assignedOrganizerUserId: null },
      { createdByUserId: OTHER_ID, assignedOrganizerUserId: null }
    ],
    shares: [
      {
        id: "share-created",
        clientName: null,
        createdAt: new Date("2026-10-01T09:00:00.000Z"),
        expiresAt: null,
        revokedAt: null,
        lastViewedAt: new Date("2026-10-02T09:00:00.000Z"),
        viewCount: 3,
        proposalRating: null,
        proposalRatedAt: null,
        trip: created
      },
      {
        id: "share-foreign",
        clientName: null,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        expiresAt: null,
        revokedAt: null,
        lastViewedAt: null,
        viewCount: 0,
        proposalRating: null,
        proposalRatedAt: null,
        trip: foreign
      }
    ],
    comments: [
      {
        id: "comment-assigned",
        content: "Can we move the transfer earlier?",
        authorName: "Ken",
        createdAt: new Date("2026-10-02T12:00:00.000Z"),
        share: { clientName: null, trip: assigned }
      },
      {
        id: "comment-foreign",
        content: "Looks lovely",
        authorName: "Mia",
        createdAt: new Date("2026-10-02T13:00:00.000Z"),
        share: { clientName: null, trip: foreign }
      }
    ],
    reviews: [
      {
        id: "review-foreign",
        rating: 5,
        reviewText: "Wonderful",
        respondentName: "Mia",
        submittedAt: new Date("2026-10-02T14:00:00.000Z"),
        trip: foreign
      }
    ]
  };
}

function createApp(authUser: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = authUser as any;
    next();
  });
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function signedInAs(agencyId: string, role: "OWNER" | "ADMIN" | "STAFF") {
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: agencyId, status: "VERIFIED" },
    membership: { role, status: "ACTIVE" }
  });
}

const path = (agencyId: string, query: string) => `/agencies/${agencyId}/dashboard/calendar?${query}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchCalendarWindow.mockResolvedValue(rawData());
});

describe("GET /agencies/:agencyId/dashboard/calendar (real service)", () => {
  it("gives STAFF only the trips they created or organize, in a payload that matches the schema", async () => {
    const agencyId = "aaaaaaaa-0000-4000-8000-000000000001";
    signedInAs(agencyId, "STAFF");

    const response = await request(createApp(staffUser)).get(path(agencyId, "from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(200);
    expect(calendarPayloadSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ from: "2026-09-27", to: "2026-11-07", tripsWithoutDates: 1 });
    expect(response.body.trips.map((trip: { tripId: string }) => trip.tripId)).toEqual(["created", "assigned"]);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([
      "share_sent:share-created",
      "client_viewed:share-created",
      "client_commented:comment-assigned"
    ]);

    expect(mocks.fetchCalendarWindow).toHaveBeenCalledTimes(1);
    const [calledAgencyId, window] = mocks.fetchCalendarWindow.mock.calls[0];
    expect(calledAgencyId).toBe(agencyId);
    expect(window).toMatchObject({ from: "2026-09-27", to: "2026-11-07" });
  });

  it("gives the owner the whole agency from the same rows", async () => {
    const agencyId = "aaaaaaaa-0000-4000-8000-000000000002";
    signedInAs(agencyId, "OWNER");

    const response = await request(createApp(ownerUser)).get(path(agencyId, "from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(200);
    expect(calendarPayloadSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.tripsWithoutDates).toBe(3);
    expect(response.body.trips.map((trip: { tripId: string }) => trip.tripId)).toEqual([
      "created",
      "foreign",
      "assigned"
    ]);
    expect(response.body.events).toHaveLength(6);
  });

  it("refuses a 43-day range without touching the repository", async () => {
    const agencyId = "aaaaaaaa-0000-4000-8000-000000000003";
    signedInAs(agencyId, "STAFF");

    const response = await request(createApp(staffUser)).get(path(agencyId, "from=2026-09-27&to=2026-11-08"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CALENDAR_RANGE_INVALID");
    expect(mocks.fetchCalendarWindow).not.toHaveBeenCalled();
  });

  it("refuses a range that ends before it starts without touching the repository", async () => {
    const agencyId = "aaaaaaaa-0000-4000-8000-000000000004";
    signedInAs(agencyId, "STAFF");

    const response = await request(createApp(staffUser)).get(path(agencyId, "from=2026-10-08&to=2026-10-01"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CALENDAR_RANGE_INVALID");
    expect(mocks.fetchCalendarWindow).not.toHaveBeenCalled();
  });
});
