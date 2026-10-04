import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaDashboardRepository } from "../src/modules/dashboard/dashboardRepository";

function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itinerary: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
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
});
