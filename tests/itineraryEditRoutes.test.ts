import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const ITINERARY_ID = "22222222-2222-4222-8222-222222222222";
const DAY_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_DAY_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TRIP_ID = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  requireTripAccess: vi.fn(),
  getItineraryTripId: vi.fn(),
  getItinerary: vi.fn(),
  updateDay: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  moveItem: vi.fn(),
  replaceDraft: vi.fn(),
  approveTrip: vi.fn(),
  reopenTrip: vi.fn(),
  createPlaceSession: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: {
    requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember,
    requireTripAccess: mocks.requireTripAccess
  }
}));
vi.mock("../src/modules/itineraries/itineraryService", () => ({
  itineraryService: {
    getItineraryTripId: mocks.getItineraryTripId,
    getItinerary: mocks.getItinerary,
    updateDay: mocks.updateDay,
    addItem: mocks.addItem,
    updateItem: mocks.updateItem,
    removeItem: mocks.removeItem,
    moveItem: mocks.moveItem,
    replaceDraft: mocks.replaceDraft,
    approveTrip: mocks.approveTrip,
    reopenTrip: mocks.reopenTrip
  }
}));
vi.mock("../src/services/places/placeServices", () => ({
  createPlaceSession: mocks.createPlaceSession,
  getPlaceRefreshScheduler: vi.fn(() => "scheduler")
}));
vi.mock("../src/modules/weather/weatherService", () => ({ itineraryWeatherService: {} }));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { itineraryRoutes } from "../src/modules/itineraries/itineraryRoutes";

const staffUser = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff User",
  memberships: []
};
const itinerary = { id: ITINERARY_ID, status: "NEEDS_REVIEW", days: [] };
const base = `/agencies/${AGENCY_ID}/itineraries`;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = staffUser as any;
    next();
  });
  app.use("/agencies/:agencyId/itineraries", itineraryRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const notAssigned = () => new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.requireTripAccess.mockResolvedValue({});
  mocks.getItineraryTripId.mockResolvedValue(TRIP_ID);
  mocks.getItinerary.mockResolvedValue(itinerary);
  mocks.createPlaceSession.mockResolvedValue("session");
  for (const edit of [mocks.updateDay, mocks.addItem, mocks.updateItem, mocks.removeItem, mocks.moveItem]) {
    edit.mockResolvedValue({});
  }
});

describe("PATCH /:itineraryId/days/:dayId", () => {
  it("renames the day and answers with the itinerary as GET reads it", async () => {
    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "  Old town walk " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itinerary });
    expect(mocks.requireTripAccess).toHaveBeenCalledWith(staffUser, AGENCY_ID, TRIP_ID);
    expect(mocks.updateDay).toHaveBeenCalledWith(AGENCY_ID, { itineraryId: ITINERARY_ID, dayId: DAY_ID, title: "Old town walk" });
    expect(mocks.getItinerary).toHaveBeenCalledWith(AGENCY_ID, ITINERARY_ID, { session: "session", scheduler: "scheduler" });
  });

  it("refuses staff who aren't assigned to the trip", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "Old town" });

    expect(res.status).toBe(404);
    expect(mocks.updateDay).not.toHaveBeenCalled();
  });

  it("passes the lock through as 409 ITINERARY_LOCKED", async () => {
    mocks.updateDay.mockRejectedValue(
      new ApiError(409, "ITINERARY_LOCKED", "This itinerary is approved. Reopen it to make changes.")
    );

    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "Old town" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITINERARY_LOCKED");
  });
});

describe("POST /:itineraryId/days/:dayId/items", () => {
  it("adds a custom stop", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/days/${DAY_ID}/items`)
      .send({ type: "NOTE", title: "Coffee break", startTime: "3:00 PM" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ itinerary });
    expect(mocks.addItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      dayId: DAY_ID,
      item: { type: "NOTE", title: "Coffee break", startTime: "3:00 PM" }
    });
  });

  it("rejects place fields before checking access", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/days/${DAY_ID}/items`)
      .send({ type: "ACTIVITY", title: "Museum", placeName: "Museo" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.requireTripAccess).not.toHaveBeenCalled();
    expect(mocks.addItem).not.toHaveBeenCalled();
  });
});

describe("PATCH /:itineraryId/items/:itemId", () => {
  it("sends only the fields in the request", async () => {
    const res = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`)
      .send({ startTime: "10:00 AM", description: "" });

    expect(res.status).toBe(200);
    expect(mocks.updateItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      itemId: ITEM_ID,
      item: { startTime: "10:00 AM", description: "" }
    });
  });

  it("rejects an empty patch and a place change", async () => {
    const empty = await request(createApp()).patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`).send({});
    const place = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`)
      .send({ placeSnapshotId: ITEM_ID });

    expect(empty.status).toBe(400);
    expect(place.status).toBe(400);
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /:itineraryId/items/:itemId", () => {
  it("deletes the stop", async () => {
    const res = await request(createApp()).delete(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`);

    expect(res.status).toBe(200);
    expect(mocks.removeItem).toHaveBeenCalledWith(AGENCY_ID, { itineraryId: ITINERARY_ID, itemId: ITEM_ID });
  });
});

describe("POST /:itineraryId/items/:itemId/move", () => {
  it("moves the stop to the given day and position", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/items/${ITEM_ID}/move`)
      .send({ toDayId: OTHER_DAY_ID, toSortOrder: 1 });

    expect(res.status).toBe(200);
    expect(mocks.moveItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      itemId: ITEM_ID,
      toDayId: OTHER_DAY_ID,
      toSortOrder: 1
    });
  });
});

describe("POST /trips/:tripId/reopen", () => {
  it("checks trip access, then reopens", async () => {
    const reopened = { trip: { id: TRIP_ID, status: "IN_REVIEW" }, itinerary: { id: ITINERARY_ID, status: "NEEDS_REVIEW" } };
    mocks.reopenTrip.mockResolvedValue(reopened);

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/reopen`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(reopened);
    expect(mocks.requireTripAccess).toHaveBeenCalledWith(staffUser, AGENCY_ID, TRIP_ID);
    expect(mocks.reopenTrip).toHaveBeenCalledWith(AGENCY_ID, TRIP_ID);
  });

  it("refuses staff who aren't assigned to the trip", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/reopen`);

    expect(res.status).toBe(404);
    expect(mocks.reopenTrip).not.toHaveBeenCalled();
  });
});

describe("trip access on existing routes", () => {
  it("approve now needs trip access", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/approve`);

    expect(res.status).toBe(404);
    expect(mocks.approveTrip).not.toHaveBeenCalled();
  });

  it("the full replace now needs trip access", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}`)
      .send({ title: "Cebu", days: [{ dayNumber: 1, title: "Arrival", items: [] }] });

    expect(res.status).toBe(404);
    expect(mocks.replaceDraft).not.toHaveBeenCalled();
  });
});
