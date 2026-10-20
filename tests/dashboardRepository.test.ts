import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaDashboardRepository } from "../src/modules/dashboard/dashboardRepository";

function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itinerary: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryItem: { findMany: vi.fn().mockResolvedValue([]) },
    tripReview: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

describe("dashboard repository", () => {
  it("reads each share link's client name, views and last view, for Recently viewed", async () => {
    const client = fakeClient();
    await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryShare.findMany.mock.calls[0][0].select).toMatchObject({
      clientName: true,
      viewCount: true,
      lastViewedAt: true
    });
  });

  it("reads each comment's author, reply and stop, and looks up the stop titles once", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    client.itineraryComment.findMany.mockResolvedValue([
      { id: "c1", shareId: "share-1", itemId: "item-1" },
      { id: "c2", shareId: "share-1", itemId: "item-1" },
      { id: "c3", shareId: "share-1", itemId: null }
    ]);
    client.itineraryItem.findMany.mockResolvedValue([{ id: "item-1", title: "Ryokan check-in" }]);

    const raw = await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryComment.findMany.mock.calls[0][0].select).toMatchObject({
      authorName: true,
      agencyReply: true,
      dayNumber: true,
      itemId: true
    });
    expect(client.itineraryItem.findMany).toHaveBeenCalledWith({
      // Scoped to this agency: a comment's itemId comes from the public page.
      where: { id: { in: ["item-1"] }, itineraryDay: { itinerary: { agencyId: "agency-1" } } },
      select: { id: true, title: true }
    });
    expect(raw.itemTitles).toEqual([{ id: "item-1", title: "Ryokan check-in" }]);
  });

  it("skips the stop lookup when no comment points at a stop", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    client.itineraryComment.findMany.mockResolvedValue([{ id: "c1", shareId: "share-1", itemId: null }]);

    const raw = await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryItem.findMany).not.toHaveBeenCalled();
    expect(raw.itemTitles).toEqual([]);
  });
});
