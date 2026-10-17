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

describe("Google sign-in — keep me signed in", () => {
  beforeAll(() => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || "test-google-client",
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || "test-google-secret",
      GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI || "http://localhost:4000/auth/google/callback"
    });
  });

  beforeEach(() => {
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "google-keep",
      email: "keep@example.com",
      emailVerified: true,
      displayName: "Keep Me"
    });
  });

  async function signInWithGoogle(startPath: string, persistentResult: boolean) {
    vi.mocked(authService.signInWithVerifiedOAuth).mockResolvedValue(signInResult(persistentResult));
    const app = createApp();
    const start = await request(app).get(startPath);
    const state = new URL(start.headers["location"] as string).searchParams.get("state") ?? "";
    const oauthCookies = setCookies(start)
      .map((c) => c.split(";")[0])
      .filter((c) => c.startsWith("voyage_oauth_") && !c.endsWith("="))
      .join("; ");
    const callback = await request(app)
      .get(`/auth/google/callback?code=google-code-123456&state=${state}`)
      .set("Cookie", oauthCookies);
    return { start, callback };
  }

  it("remembers by default", async () => {
    const { callback } = await signInWithGoogle("/auth/google/start", true);

    expect(callback.status).toBe(302);
    expect(authService.signInWithVerifiedOAuth).toHaveBeenCalledWith(expect.any(Object), { persistent: true });
  });

  it("uses a short session when started with remember=0", async () => {
    const { start, callback } = await signInWithGoogle("/auth/google/start?remember=0", false);

    expect(setCookies(start).some((c) => c.startsWith("voyage_oauth_remember=0"))).toBe(true);
    expect(callback.status).toBe(302);
    expect(authService.signInWithVerifiedOAuth).toHaveBeenCalledWith(expect.any(Object), { persistent: false });
    expect(sessionCookie(callback)).not.toContain("Expires=");
  });

  it("clears the remember cookie on the callback", async () => {
    const { callback } = await signInWithGoogle("/auth/google/start?remember=0", false);

    expect(setCookies(callback).some((c) => c.startsWith("voyage_oauth_remember=;"))).toBe(true);
  });
});
