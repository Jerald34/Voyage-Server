import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ listRunUsage: vi.fn(), findRunUsage: vi.fn(), firstMeteredAt: vi.fn() }));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/agencyService", () => ({ agencyService: {} }));
vi.mock("../src/modules/support/supportService", () => ({ supportService: {} }));
vi.mock("../src/modules/admin/usageRepository", () => ({
  usageRepository: { listRunUsage: m.listRunUsage, findRunUsage: m.findRunUsage, firstMeteredAt: m.firstMeteredAt }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { adminRoutes } from "../src/modules/admin/adminRoutes";

const admin = { id: "admin-1", role: "SUPER_ADMIN", status: "ACTIVE", memberships: [] };
const THREAD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "11111111-1111-4111-8111-111111111111";

function createApp(authUser: Record<string, unknown> = admin) {
  const app = express();
  app.use((req, _res, next) => {
    req.authUser = authUser as any;
    next();
  });
  app.use("/admin", adminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listRunUsage.mockResolvedValue([]);
  m.firstMeteredAt.mockResolvedValue(null);
});

describe("GET /admin/usage", () => {
  it("accepts a range and group", async () => {
    const res = await request(createApp()).get("/admin/usage?range=7d&groupBy=chat");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ range: "7d", groupBy: "chat", rows: [] });
  });

  it("rejects the old period parameter", async () => {
    const res = await request(createApp()).get("/admin/usage?period=day");
    expect(res.status).toBe(400);
  });

  it("is super-admin only", async () => {
    const res = await request(createApp({ id: "u", role: "USER", status: "ACTIVE", memberships: [] })).get("/admin/usage");
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/usage/runs", () => {
  it("needs exactly one of userId, agencyId, threadId", async () => {
    expect((await request(createApp()).get("/admin/usage/runs")).status).toBe(400);
    expect((await request(createApp()).get(`/admin/usage/runs?userId=${USER}&threadId=${THREAD}`)).status).toBe(400);
    expect((await request(createApp()).get(`/admin/usage/runs?threadId=${THREAD}`)).status).toBe(200);
  });
});

describe("GET /admin/usage/runs/:runId", () => {
  it("404s an unknown run and 400s a bad id", async () => {
    m.findRunUsage.mockResolvedValue(null);
    expect((await request(createApp()).get(`/admin/usage/runs/${THREAD}`)).status).toBe(404);
    expect((await request(createApp()).get("/admin/usage/runs/nope")).status).toBe(400);
  });
});
