import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({
  prisma: { session: { findUnique: vi.fn(), update: vi.fn() } }
}));

import { prisma } from "../src/db/prisma";
import { env } from "../src/config/env";
import { attachAuthUser } from "../src/http/authMiddleware";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-18T12:00:00.000Z").getTime();
const user = { id: "user-1", status: "ACTIVE", memberships: [] };

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    tokenHash: "hash",
    persistent: true,
    createdAt: new Date(NOW - 2 * DAY),
    expiresAt: new Date(NOW + 28 * DAY),
    updatedAt: new Date(NOW - 2 * DAY),
    user,
    ...overrides
  };
}

async function run(row: unknown) {
  vi.mocked(prisma.session.findUnique).mockResolvedValue(row as never);
  const request = { cookies: { [env.SESSION_COOKIE_NAME]: "raw-token" } } as Record<string, unknown>;
  const response = { cookie: vi.fn() };
  const next = vi.fn();
  await attachAuthUser(request as never, response as never, next);
  return { request, response, next };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(prisma.session.findUnique).mockReset();
  vi.mocked(prisma.session.update).mockReset();
  vi.mocked(prisma.session.update).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachAuthUser — sliding renewal", () => {
  it("pushes a remembered session forward and re-sends its cookie", async () => {
    const { request, response, next } = await run(sessionRow());
    const renewed = new Date(NOW + env.SESSION_TTL_DAYS * DAY);

    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { expiresAt: renewed }
    });
    expect(response.cookie).toHaveBeenCalledWith(
      env.SESSION_COOKIE_NAME,
      "raw-token",
      expect.objectContaining({ expires: renewed, httpOnly: true })
    );
    expect(request.authUser).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  it("skips the write when the session was renewed under an hour ago", async () => {
    const { request, response } = await run(
      sessionRow({ expiresAt: new Date(NOW + env.SESSION_TTL_DAYS * DAY - 30 * 60 * 1000) })
    );

    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(request.authUser).toBe(user);
  });

  it("renews a short session on the server but leaves its browser-session cookie alone", async () => {
    const { response } = await run(
      sessionRow({
        persistent: false,
        createdAt: new Date(NOW - 2 * HOUR),
        expiresAt: new Date(NOW + env.SESSION_SHORT_TTL_HOURS * HOUR - 2 * HOUR)
      })
    );

    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { expiresAt: new Date(NOW + env.SESSION_SHORT_TTL_HOURS * HOUR) }
    });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("does not sign in or renew an expired session", async () => {
    const { request } = await run(sessionRow({ expiresAt: new Date(NOW - 60 * 1000) }));

    expect(request.authUser).toBeUndefined();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("still signs the request in when the renewal write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.session.update).mockRejectedValue(new Error("db down"));

    const { request, response, next } = await run(sessionRow());

    expect(request.authUser).toBe(user);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});
