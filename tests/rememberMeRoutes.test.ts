import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/services/oauth", () => ({
  verifyGoogleAuthorizationCode: vi.fn(),
  verifyAppleIdToken: vi.fn()
}));

vi.mock("../src/modules/auth/authService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/auth/authService")>();
  return {
    ...actual,
    authService: { ...actual.authService, loginWithEmail: vi.fn(), signInWithVerifiedOAuth: vi.fn() }
  };
});

import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { authService } from "../src/modules/auth/authService";
import { verifyGoogleAuthorizationCode } from "../src/services/oauth";

const EXPIRES_AT = new Date("2026-11-17T12:00:00.000Z");

const user = {
  id: "user-1",
  email: "keep@example.com",
  displayName: "Keep Me",
  role: "USER",
  accountType: "AGENCY_USER",
  status: "ACTIVE",
  emailVerifiedAt: new Date("2026-10-01T00:00:00.000Z"),
  memberships: []
};

function signInResult(persistent: boolean) {
  return {
    user,
    sessionToken: "raw-session-token",
    session: {
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      persistent,
      expiresAt: EXPIRES_AT,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  } as never;
}

function setCookies(res: request.Response): string[] {
  const header = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return Array.isArray(header) ? header : header ? [header] : [];
}

function sessionCookie(res: request.Response) {
  return setCookies(res).find((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
}

beforeEach(() => {
  vi.mocked(authService.loginWithEmail).mockReset();
  vi.mocked(authService.signInWithVerifiedOAuth).mockReset();
});

describe("POST /auth/login — keep me signed in", () => {
  it("sends rememberMe to the service and sets a cookie that outlives the browser", async () => {
    vi.mocked(authService.loginWithEmail).mockResolvedValue(signInResult(true));

    const res = await request(createApp())
      .post("/auth/login")
      .send({ email: "keep@example.com", password: "password123", rememberMe: true });

    expect(res.status).toBe(200);
    expect(authService.loginWithEmail).toHaveBeenCalledWith(expect.objectContaining({ rememberMe: true }));
    expect(sessionCookie(res)).toContain(`Expires=${EXPIRES_AT.toUTCString()}`);
  });

  it("sets a browser-session cookie when rememberMe is false", async () => {
    vi.mocked(authService.loginWithEmail).mockResolvedValue(signInResult(false));

    const res = await request(createApp())
      .post("/auth/login")
      .send({ email: "keep@example.com", password: "password123", rememberMe: false });

    expect(res.status).toBe(200);
    const cookie = sessionCookie(res) ?? "";
    expect(cookie).toContain(`${env.SESSION_COOKIE_NAME}=raw-session-token`);
    expect(cookie).not.toContain("Expires=");
    expect(cookie).not.toContain("Max-Age=");
  });

  it("rejects a non-boolean rememberMe", async () => {
    const res = await request(createApp())
      .post("/auth/login")
      .send({ email: "keep@example.com", password: "password123", rememberMe: "yes" });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("VALIDATION_ERROR");
  });
});
