import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { ApiError } from "../src/http/errors";
import {
  createPrismaTripPreviewRepository,
  type RawTripPreview
} from "../src/modules/dashboard/tripPreviewRepository";
import { buildTripPreview, createTripPreviewService } from "../src/modules/dashboard/tripPreviewService";

const NOW = new Date("2026-10-20T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const HOUR = 60 * 60 * 1000;

const tripRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Kyoto Autumn Escape",
  status: "IN_REVIEW" as const,
  clientName: "Santos Family",
  startDate: new Date("2026-11-03T00:00:00Z"),
  endDate: new Date("2026-11-08T00:00:00Z"),
  travelerCount: 4,
  destinationSummary: "Kyoto"
};

const shareRow = (id: string, fields: Partial<RawTripPreview["shares"][number]> = {}) => ({
  id,
  itineraryId: "itinerary-1",
  clientName: null,
  viewCount: 0,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  createdAt: at(-10 * HOUR),
  ...fields
});

function raw(fields: Partial<RawTripPreview> = {}): RawTripPreview {
  return { trip: tripRow, shares: [], comments: [], itemTitles: [], ...fields };
}

describe("buildTripPreview", () => {
  it("returns the trip with ISO dates", () => {
    expect(buildTripPreview(raw()).trip).toEqual({
      ...tripRow,
      startDate: "2026-11-03T00:00:00.000Z",
      endDate: "2026-11-08T00:00:00.000Z"
    });
  });

  it("picks the newest live link over a newer revoked one, and null when never shared", () => {
    const shares = [
      shareRow("revoked-new", { revokedAt: at(-1 * HOUR), createdAt: at(-2 * HOUR) }),
      shareRow("live-old", { viewCount: 4, lastViewedAt: at(-3 * HOUR), expiresAt: at(20 * HOUR), proposalRating: 4 })
    ];
    expect(buildTripPreview(raw({ shares })).share).toEqual({
      id: "live-old",
      clientName: null,
      viewCount: 4,
      lastViewedAt: at(-3 * HOUR).toISOString(),
      expiresAt: at(20 * HOUR).toISOString(),
      revokedAt: null,
      proposalRating: 4,
      createdAt: at(-10 * HOUR).toISOString()
    });
    expect(buildTripPreview(raw({ shares: [shareRow("only", { revokedAt: at(-1 * HOUR) })] })).share?.id).toBe("only");
    expect(buildTripPreview(raw()).share).toBeNull();
  });

  it("names each comment's stop", () => {
    const comments = [
      {
        id: "c1",
        shareId: "live",
        authorName: "Maria",
        content: "Wheelchair?",
        status: "PENDING" as const,
        dayNumber: 1,
        itemId: "item-1",
        agencyReply: null,
        agencyRepliedAt: null,
        createdAt: at(-2 * HOUR)
      },
      {
        id: "c2",
        shareId: "live",
        authorName: "Maria",
        content: "Gone stop",
        status: "PENDING" as const,
        dayNumber: 2,
        itemId: "item-deleted",
        agencyReply: null,
        agencyRepliedAt: null,
        createdAt: at(-1 * HOUR)
      }
    ];
    const preview = buildTripPreview(
      raw({
        shares: [shareRow("live")],
        comments,
        itemTitles: [{ id: "item-1", title: "Ryokan check-in", itineraryId: "itinerary-1" }]
      })
    );
    expect(preview.comments.map((c) => c.itemTitle)).toEqual(["Ryokan check-in", null]);
    expect(preview.comments[0].createdAt).toBe(at(-2 * HOUR).toISOString());
  });

  it("names a stop only when it is in the itinerary the comment's own link shows", () => {
    // The trip can have several links, each on its own itinerary. A comment's
    // itemId comes from the public page unchecked, so a stop from the trip's
    // other itinerary must not be named.
    const comment = (id: string, shareId: string, itemId: string) => ({
      id,
      shareId,
      authorName: "Maria",
      content: "Question",
      status: "PENDING" as const,
      dayNumber: 1,
      itemId,
      agencyReply: null,
      agencyRepliedAt: null,
      createdAt: at(-2 * HOUR)
    });
    const preview = buildTripPreview(
      raw({
        shares: [
          shareRow("link-v2", { itineraryId: "itinerary-2" }),
          shareRow("link-v1", { itineraryId: "itinerary-1" })
        ],
        comments: [
          comment("on-v1", "link-v1", "item-v1"),
          comment("v1-points-at-v2-stop", "link-v1", "item-v2"),
          comment("on-v2", "link-v2", "item-v2")
        ],
        itemTitles: [
          { id: "item-v1", title: "Old day 1 lunch", itineraryId: "itinerary-1" },
          { id: "item-v2", title: "New day 1 lunch", itineraryId: "itinerary-2" }
        ]
      })
    );
    expect(preview.comments.map((c) => [c.id, c.itemTitle])).toEqual([
      ["on-v1", "Old day 1 lunch"],
      ["v1-points-at-v2-stop", null],
      ["on-v2", "New day 1 lunch"]
    ]);
  });

  it("sends only the panel's comment fields, never the client's email", () => {
    const comment = {
      id: "c1",
      shareId: "live",
      authorName: "Maria",
      authorEmail: "maria@example.com",
      content: "Thanks!",
      status: "ADDRESSED" as const,
      dayNumber: null,
      itemId: null,
      agencyReply: "You're welcome",
      agencyRepliedAt: at(-1 * HOUR),
      createdAt: at(-2 * HOUR)
    };
    const preview = buildTripPreview(raw({ comments: [comment] }));
    expect(preview.comments[0]).toEqual({
      id: "c1",
      shareId: "live",
      authorName: "Maria",
      content: "Thanks!",
      status: "ADDRESSED",
      dayNumber: null,
      itemId: null,
      itemTitle: null,
      agencyReply: "You're welcome",
      agencyRepliedAt: at(-1 * HOUR).toISOString(),
      createdAt: at(-2 * HOUR).toISOString()
    });
    expect(preview.comments[0]).not.toHaveProperty("authorEmail");
  });

  it("says the trip is not found when it is not the agency's", () => {
    expect(() => buildTripPreview(raw({ trip: null }))).toThrow(ApiError);
    try {
      buildTripPreview(raw({ trip: null }));
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(404);
    }
  });
});

describe("createTripPreviewService", () => {
  it("reads the trip through the repository with the agency's id", async () => {
    const fetchTripPreview = vi.fn().mockResolvedValue(raw());
    const service = createTripPreviewService({ repository: { fetchTripPreview } });
    const preview = await service.getTripPreview("agency-1", tripRow.id);
    expect(fetchTripPreview).toHaveBeenCalledWith("agency-1", tripRow.id);
    expect(preview.trip.title).toBe("Kyoto Autumn Escape");
  });
});

describe("trip preview repository", () => {
  function fakeClient() {
    return {
      clientTrip: { findFirst: vi.fn().mockResolvedValue(tripRow) },
      itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
      itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
      itineraryItem: { findMany: vi.fn().mockResolvedValue([]) }
    };
  }

  it("reads the trip only within the agency, and stops there when it is another agency's", async () => {
    const client = fakeClient();
    client.clientTrip.findFirst.mockResolvedValue(null);

    const result = await createPrismaTripPreviewRepository(client as never).fetchTripPreview("agency-1", tripRow.id);

    expect(client.clientTrip.findFirst.mock.calls[0][0].where).toEqual({ id: tripRow.id, agencyId: "agency-1" });
    expect(result).toEqual({ trip: null, shares: [], comments: [], itemTitles: [] });
    expect(client.itineraryShare.findMany).not.toHaveBeenCalled();
    expect(client.itineraryComment.findMany).not.toHaveBeenCalled();
    expect(client.itineraryItem.findMany).not.toHaveBeenCalled();
  });

  it("scopes links to the agency and trip, never selects the client's email, and names stops only from this trip", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    client.itineraryComment.findMany.mockResolvedValue([
      { id: "c1", shareId: "share-1", itemId: "item-1" },
      { id: "c2", shareId: "share-1", itemId: "item-1" },
      { id: "c3", shareId: "share-1", itemId: null }
    ]);
    client.itineraryItem.findMany.mockResolvedValue([
      { id: "item-1", title: "Ryokan check-in", itineraryDay: { itineraryId: "itinerary-1" } }
    ]);

    const result = await createPrismaTripPreviewRepository(client as never).fetchTripPreview("agency-1", tripRow.id);

    expect(client.itineraryShare.findMany.mock.calls[0][0].where).toEqual({ agencyId: "agency-1", tripId: tripRow.id });
    expect(client.itineraryComment.findMany.mock.calls[0][0].where).toEqual({ shareId: { in: ["share-1"] } });
    expect(client.itineraryComment.findMany.mock.calls[0][0].select).not.toHaveProperty("authorEmail");
    expect(client.itineraryItem.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["item-1"] },
        itineraryDay: { itinerary: { tripId: tripRow.id, agencyId: "agency-1" } }
      },
      select: { id: true, title: true, itineraryDay: { select: { itineraryId: true } } }
    });
    expect(result.itemTitles).toEqual([{ id: "item-1", title: "Ryokan check-in", itineraryId: "itinerary-1" }]);
  });

  it("reads which itinerary each link shows", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    await createPrismaTripPreviewRepository(client as never).fetchTripPreview("agency-1", tripRow.id);
    expect(client.itineraryShare.findMany.mock.calls[0][0].select).toMatchObject({ itineraryId: true });
  });
});
