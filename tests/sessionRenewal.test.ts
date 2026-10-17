import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({
  prisma: { session: { findUnique: vi.fn(), updateMany: vi.fn() } }
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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(prisma.session.findUnique).mockReset();
  vi.mocked(prisma.session.updateMany).mockReset();
  vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 } as never);
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("attachAuthUser — sliding renewal", () => {
  it("pushes a remembered session forward and re-sends its cookie", async () => {
    const { request, response, next } = await run(sessionRow());
    const renewed = new Date(NOW + env.SESSION_TTL_DAYS * DAY);

    // Compare-and-set: only the request that still sees the expiry it read may write.
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", expiresAt: new Date(NOW + 28 * DAY) },
      data: { expiresAt: renewed }
    });
    expect(response.cookie).toHaveBeenCalledWith(
      env.SESSION_COOKIE_NAME,
      "raw-token",
      expect.objectContaining({
        maxAge: env.SESSION_TTL_DAYS * DAY,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/"
      })
    );
    expect(request.authUser).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  it("skips the write when the session was renewed under an hour ago", async () => {
    const { request, response } = await run(
      sessionRow({ expiresAt: new Date(NOW + env.SESSION_TTL_DAYS * DAY - 30 * 60 * 1000) })
    );

    expect(prisma.session.updateMany).not.toHaveBeenCalled();
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

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", expiresAt: new Date(NOW + env.SESSION_SHORT_TTL_HOURS * HOUR - 2 * HOUR) },
      data: { expiresAt: new Date(NOW + env.SESSION_SHORT_TTL_HOURS * HOUR) }
    });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("does not sign in or renew an expired session", async () => {
    const { request } = await run(sessionRow({ expiresAt: new Date(NOW - 60 * 1000) }));

    expect(request.authUser).toBeUndefined();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it("does not sign in or renew a suspended user's session", async () => {
    const { request, response, next } = await run(
      sessionRow({ user: { ...user, status: "SUSPENDED" } })
    );

    expect(request.authUser).toBeUndefined();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("still signs the request in when the renewal write fails", async () => {
    vi.mocked(prisma.session.updateMany).mockRejectedValue(new Error("db down"));

    const { request, response, next } = await run(sessionRow());

    expect(request.authUser).toBe(user);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("still signs the request in when the renewal itself throws", async () => {
    // A row without createdAt makes the expiry maths throw before any write.
    const { request, response, next } = await run(sessionRow({ createdAt: undefined }));

    expect(request.authUser).toBe(user);
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("[auth] Session renewal skipped:", expect.any(Error));
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("sends no cookie when another request already renewed or deleted the session", async () => {
    vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 0 } as never);

    const { request, response, next } = await run(sessionRow());

    expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(request.authUser).toBe(user);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
