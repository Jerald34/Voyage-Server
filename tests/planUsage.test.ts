import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { getPlanUsage, manilaMonthRange } from "../src/modules/dashboard/planUsageService";

describe("manilaMonthRange", () => {
  it("covers the Manila calendar month", () => {
    const { start, end } = manilaMonthRange(new Date("2026-10-12T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });

  it("rolls over at Manila midnight, not UTC midnight", () => {
    // 1 November 01:00 in Manila is still 31 October in UTC.
    const { start } = manilaMonthRange(new Date("2026-10-31T17:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
});

describe("getPlanUsage", () => {
  it("counts this month's itineraries and agent requests, and active members", async () => {
    const client: any = {
      itinerary: { count: vi.fn().mockResolvedValue(12) },
      agentRun: { count: vi.fn().mockResolvedValue(85) },
      agencyMembership: { count: vi.fn().mockResolvedValue(3) }
    };

    const usage = await getPlanUsage("agency-1", new Date("2026-10-12T00:00:00.000Z"), client);

    const createdAt = { gte: new Date("2026-09-30T16:00:00.000Z"), lt: new Date("2026-10-31T16:00:00.000Z") };
    expect(client.itinerary.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", createdAt } });
    expect(client.agentRun.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", createdAt } });
    expect(client.agencyMembership.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", status: "ACTIVE" } });
    expect(usage).toEqual({
      periodStart: "2026-09-30T16:00:00.000Z",
      periodEnd: "2026-10-31T16:00:00.000Z",
      itinerariesCreated: 12,
      agentRequests: 85,
      activeMembers: 3
    });
  });
});
