import { describe, expect, it } from "vitest";
import { createUsageService, type UsageServiceRepository } from "../src/modules/admin/usageService";

const NOW = new Date("2026-06-10T00:00:00Z");
const repo: UsageServiceRepository = {
  async listRunUsage() {
    return [{
      usageUserId: "u1", userLabel: "Ana", agencyId: "ag1", agencyLabel: "Alpha",
      createdAt: new Date("2026-06-01T10:00:00Z"),
      promptTokens: 100, outputTokens: 40, totalTokens: 140, cachedTokens: 20, costUsd: 0.003
    }];
  }
};

describe("usageService.getUsage", () => {
  it("rejects non-super-admins", async () => {
    const svc = createUsageService({ repository: repo, now: () => NOW });
    await expect(svc.getUsage({ id: "x", role: "USER" }, {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns series, rows and totals for a super admin", async () => {
    const svc = createUsageService({ repository: repo, now: () => NOW });
    const res = await svc.getUsage({ id: "x", role: "SUPER_ADMIN" }, { period: "day", groupBy: "user" });
    expect(res.series[0].totalTokens).toBe(140);
    expect(res.rows[0].label).toBe("Ana");
    expect(res.totals.totalTokens).toBe(140);
  });
});
