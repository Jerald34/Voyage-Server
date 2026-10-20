import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const DAY = 24 * 60 * 60 * 1000;

vi.mock("../src/db/prisma", () => ({
  prisma: { session: { findUnique: vi.fn(), updateMany: vi.fn() } }
}));

vi.mock("../src/modules/auth/authService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/auth/authService")>();
  return { ...actual, authService: { ...actual.authService, logout: vi.fn() } };
});

import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { env } from "../src/config/env";
import { authService } from "../src/modules/auth/authService";

// A remembered session whose last renewal was well over an hour ago, so the
// middleware would renew it (and re-send the cookie) on any other request.
function dueForRenewalSession() {
  const now = Date.now();
  return {
    id: "session-1",
    userId: "user-1",
    tokenHash: "hash",
    persistent: true,
    createdAt: new Date(now - 2 * DAY),
    expiresAt: new Date(now + 28 * DAY),
    updatedAt: new Date(now - 2 * DAY),
    user: {
      id: "user-1",
      email: "keep@example.com",
      displayName: "Keep Me",
      role: "USER",
      accountType: "AGENCY_USER",
      status: "ACTIVE",
      emailVerifiedAt: new Date("2026-10-01T00:00:00.000Z"),
      memberships: []
    }
  };
}

function sessionSetCookies(res: request.Response): string[] {
  const header = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  const all = Array.isArray(header) ? header : header ? [header] : [];
  return all.filter((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
}

beforeEach(() => {
  vi.mocked(prisma.session.findUnique).mockReset();
  vi.mocked(prisma.session.updateMany).mockReset();
  vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(authService.logout).mockReset();
  vi.mocked(authService.logout).mockResolvedValue(undefined as never);
});

describe("POST /auth/logout — session cookie", () => {
  it("sends only the clearing Set-Cookie, never a renewal, for a session that is due one", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue(dueForRenewalSession() as never);

    const res = await request(createApp())
      .post("/auth/logout")
      .set("Cookie", `${env.SESSION_COOKIE_NAME}=stale-raw-token`);

    expect(res.status).toBe(204);
    expect(authService.logout).toHaveBeenCalledWith("stale-raw-token");
    expect(prisma.session.updateMany).not.toHaveBeenCalled();

    const cookies = sessionSetCookies(res);
    expect(cookies).toHaveLength(1);
    const last = cookies[cookies.length - 1];
    expect(last).toMatch(new RegExp(`^${env.SESSION_COOKIE_NAME}=;`));
    expect(last).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("still renews the same session on other requests", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue(dueForRenewalSession() as never);

    const res = await request(createApp())
      .get("/auth/me")
      .set("Cookie", `${env.SESSION_COOKIE_NAME}=stale-raw-token`);

    expect(res.status).toBe(200);
    expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
    expect(sessionSetCookies(res)).toHaveLength(1);
    expect(sessionSetCookies(res)[0]).toContain("Max-Age=");
  });
});
