import { describe, expect, it } from "vitest";
import { createSupportService, type SupportRepository } from "../src/modules/support/supportService";

function memoryRepo(): SupportRepository & { items: any[] } {
  const items: any[] = [];
  return {
    items,
    async createReport(data) { const r = { id: `r${items.length + 1}`, status: "NEW", createdAt: new Date(), resolvedAt: null, resolvedByAdminUserId: null, adminNotes: null, githubIssueUrl: null, githubIssueNumber: null, ...data }; items.push(r); return r; },
    async listReports(filter) { return items.filter((i) => !filter.status || i.status === filter.status); },
    async findReportById(id) { return items.find((i) => i.id === id) ?? null; },
    async updateReport(id, patch) { const i = items.find((x) => x.id === id); Object.assign(i, patch); return i; }
  };
}

describe("supportService", () => {
  it("lets any authenticated user create a report", async () => {
    const svc = createSupportService({ repository: memoryRepo() });
    const r = await svc.createReport({ id: "u1", role: "USER" }, { category: "BUG", subject: "X", message: "Y" }, { agencyId: "ag1", userAgent: "UA" });
    expect(r.id).toBeTruthy();
    expect(r.reporterUserId).toBe("u1");
  });

  it("blocks non-super-admins from listing", async () => {
    const svc = createSupportService({ repository: memoryRepo() });
    await expect(svc.listReports({ id: "u1", role: "USER" }, {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it("sets resolvedAt + resolver when status moves to RESOLVED", async () => {
    const repo = memoryRepo();
    const svc = createSupportService({ repository: repo, now: () => new Date("2026-06-10T00:00:00Z") });
    const created = await svc.createReport({ id: "u1", role: "USER" }, { category: "BUG", subject: "X", message: "Y" }, {});
    const updated = await svc.updateReport({ id: "admin", role: "SUPER_ADMIN" }, created.id, { status: "RESOLVED" });
    expect(updated.resolvedByAdminUserId).toBe("admin");
    expect(updated.resolvedAt).toEqual(new Date("2026-06-10T00:00:00Z"));
  });
});
