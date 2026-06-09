/**
 * Security hardening regression tests — Group 1
 *
 * F1: OAuth account-takeover prevention (unverified email must not link)
 * F3: OAuth login-CSRF state parameter enforcement
 * F4: Rate-limit returns 429 after threshold on auth endpoints
 * F7: User-enumeration non-disclosure (password reset & email verification)
 *
 * Uses the full Express app via supertest with prisma mocked in-memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Store } from "express-rate-limit";

// ── In-memory data stores shared by the prisma mock ─────────────────────────

type AnyRow = Record<string, any>;
const store = {
  users: [] as AnyRow[],
  sessions: [] as AnyRow[],
  providerAccounts: [] as AnyRow[],
  verificationTokens: [] as AnyRow[],
  passwordResetTokens: [] as AnyRow[]
};

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../src/services/oauth", () => ({
  verifyGoogleAuthorizationCode: vi.fn(),
  verifyAppleIdToken: vi.fn()
}));

vi.mock("../src/services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendAgencyInvitationEmail: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../src/modules/shares/shareService", () => ({
  shareService: {
    getShareByToken: vi.fn(async (token: string) => ({
      share: { token },
      agency: { id: "agency-1" },
      itinerary: {},
      trip: null,
      creator: null
    })),
    addComment: vi.fn(async () => ({ id: "comment-1" })),
    listPublicComments: vi.fn(async () => [])
  }
}));

vi.mock("../src/modules/shares/publicShareService", () => ({
  buildShareResponse: vi.fn(() => ({ share: { token: "share-token" }, itinerary: {} }))
}));

vi.mock("../src/modules/reviews/reviewService", () => ({
  reviewService: {
    checkTripReviewToken: vi.fn(async () => ({ ok: true })),
    submitTripReview: vi.fn(async () => ({ id: "review-1" })),
    rateProposal: vi.fn(async () => ({ ok: true }))
  }
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    session: {
      findUnique: vi.fn(async ({ where }: AnyRow) => {
        const session = store.sessions.find((s) => s.tokenHash === where.tokenHash);
        if (!session) return null;
        const user = store.users.find((u) => u.id === session.userId);
        return { ...session, user: { ...user, memberships: user?.memberships ?? [] } };
      }),
      create: vi.fn(async ({ data }: AnyRow) => {
        const session = { id: `session-${store.sessions.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        store.sessions.push(session);
        return session;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    user: {
      findUnique: vi.fn(async ({ where }: AnyRow) => {
        const user = store.users.find(
          (u) =>
            (where.emailNormalized && u.emailNormalized === where.emailNormalized) ||
            (where.id && u.id === where.id)
        );
        return user ? { ...user, memberships: user.memberships ?? [] } : null;
      }),
      create: vi.fn(async ({ data }: AnyRow) => {
        const user = { id: `user-${store.users.length + 1}`, role: "USER", status: "ACTIVE", accountType: "PENDING", emailVerifiedAt: null, avatarImageId: null, memberships: [], ...data };
        store.users.push(user);
        return user;
      }),
      update: vi.fn(async ({ where, data }: AnyRow) => {
        const user = store.users.find((u) => u.id === where.id);
        if (!user) throw new Error(`Missing user ${where.id}`);
        Object.assign(user, data);
        return { ...user, memberships: user.memberships ?? [] };
      })
    },
    authProviderAccount: {
      findUnique: vi.fn(async ({ where }: AnyRow) => {
        const key = where.provider_providerAccountId;
        const account = store.providerAccounts.find(
          (a) => a.provider === key.provider && a.providerAccountId === key.providerAccountId
        );
        if (!account) return null;
        const user = store.users.find((u) => u.id === account.userId);
        return { ...account, user: { ...user, memberships: user?.memberships ?? [] } };
      }),
      create: vi.fn(async ({ data }: AnyRow) => {
        const account = { id: `provider-${store.providerAccounts.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        store.providerAccounts.push(account);
        const user = store.users.find((u) => u.id === account.userId);
        return { ...account, user: { ...user, memberships: user?.memberships ?? [] } };
      })
    },
    emailVerificationToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: AnyRow) => {
        const token = { id: `vt-${store.verificationTokens.length + 1}`, createdAt: new Date(), usedAt: null, ...data };
        store.verificationTokens.push(token);
        return token;
      }),
      findUnique: vi.fn(async ({ where }: AnyRow) => store.verificationTokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
      update: vi.fn(async ({ where, data }: AnyRow) => {
        const token = store.verificationTokens.find((t) => t.id === where.id);
        if (token) Object.assign(token, data);
        return token;
      })
    },
    passwordResetToken: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: AnyRow) => {
        const token = { id: `prt-${store.passwordResetTokens.length + 1}`, createdAt: new Date(), usedAt: null, ...data };
        store.passwordResetTokens.push(token);
        return token;
      }),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({}))
    }
  }
}));

import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { verifyGoogleAuthorizationCode } from "../src/services/oauth";

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedUser(overrides: AnyRow = {}) {
  const user = {
    id: "user-existing",
    email: "alice@example.com",
    emailNormalized: "alice@example.com",
    passwordHash: null,
    displayName: "Alice",
    role: "USER",
    status: "ACTIVE",
    accountType: "PERSONAL",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    avatarImageId: null,
    memberships: [],
    ...overrides
  };
  store.users.push(user);
  return user;
}

function extractStateCookie(setCookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
  return header.map((c) => c.split(";")[0]).find((c) => c.startsWith("voyage_oauth_state="));
}

function extractSessionCookie(setCookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
  return header.map((c) => c.split(";")[0]).find((c) => c.startsWith("voyage_session="));
}

async function getOAuthStateForTest(app: ReturnType<typeof createApp>): Promise<{ stateCookie: string; stateValue: string }> {
  const startRes = await request(app).get("/auth/google/start");
  const location = startRes.headers["location"] as string | undefined;
  const stateValue = location ? new URL(location).searchParams.get("state") ?? "" : "";
  const stateCookie = extractStateCookie(startRes.headers["set-cookie"]) ?? "";
  return { stateCookie, stateValue };
}

type RateLimitRouteCase = {
  name: string;
  method: "get" | "post";
  path: string;
  limit: number;
  body?: Record<string, unknown>;
};

const TEST_IP = "203.0.113.77";
const STORE_FAILURE_SECRET = "redis://secret-user:secret-password@cache.internal:6379";

class ThrowingStore implements Store {
  localKeys = false;
  prefix?: string;

  constructor(prefix?: string) {
    this.prefix = prefix;
  }

  async increment(_key: string): Promise<never> {
    throw new Error(STORE_FAILURE_SECRET);
  }

  async decrement(_key: string) {}

  async resetKey(_key: string) {}
}

const publicRateLimitRouteCases: RateLimitRouteCase[] = [
  { name: "health", method: "get", path: "/health", limit: 120 },
  { name: "registration", method: "post", path: "/auth/register", limit: 5, body: {} },
  { name: "login", method: "post", path: "/auth/login", limit: 10, body: {} },
  { name: "email check", method: "post", path: "/auth/email/check", limit: 5, body: {} },
  { name: "email verification request", method: "post", path: "/auth/email/verification/request", limit: 5, body: {} },
  { name: "password reset request", method: "post", path: "/auth/password/reset/request", limit: 5, body: {} },
  { name: "email verification confirm", method: "post", path: "/auth/email/verification/confirm", limit: 20, body: {} },
  { name: "password reset confirm", method: "post", path: "/auth/password/reset/confirm", limit: 20, body: {} },
  { name: "google oauth start", method: "get", path: "/auth/google/start", limit: 20 },
  { name: "google oauth callback", method: "get", path: "/auth/google/callback?code=test-code", limit: 20 },
  { name: "apple oauth start", method: "get", path: "/auth/apple/start", limit: 20 },
  { name: "apple oauth callback", method: "post", path: "/auth/apple/callback", limit: 20, body: {} },
  { name: "invitation lookup", method: "get", path: "/invitations/lookup", limit: 30 },
  { name: "public share read", method: "get", path: "/shared/share-token", limit: 60 },
  { name: "public share comments read", method: "get", path: "/shared/share-token/comments", limit: 60 },
  { name: "public share comment write", method: "post", path: "/shared/share-token/comments", limit: 10, body: {} },
  { name: "public share rating write", method: "post", path: "/shared/share-token/rate", limit: 10, body: {} },
  { name: "review check", method: "get", path: "/reviews/trip-token/check", limit: 30 },
  { name: "review submit", method: "post", path: "/reviews/trip-token/submit", limit: 10, body: {} },
  { name: "photo proxy", method: "get", path: "/images/place-photo?name=invalid-photo-name", limit: 60 }
];

async function sendRateLimitRequest(app: ReturnType<typeof createApp>, routeCase: RateLimitRouteCase) {
  if (routeCase.method === "get") {
    return request(app)
      .get(routeCase.path)
      .set("X-Forwarded-For", TEST_IP);
  }

  return request(app)
    .post(routeCase.path)
    .set("X-Forwarded-For", TEST_IP)
    .send(routeCase.body ?? {});
}

beforeEach(() => {
  store.users = [];
  store.sessions = [];
  store.providerAccounts = [];
  store.verificationTokens = [];
  store.passwordResetTokens = [];
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  // Provide Google OAuth credentials so /google/start doesn't 501.
  process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:4000/auth/google/callback";
});

afterEach(() => {
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["GOOGLE_CLIENT_SECRET"];
  delete process.env["GOOGLE_REDIRECT_URI"];
});

// ── F1 tests ─────────────────────────────────────────────────────────────────

describe("F1 — OAuth account-linking with unverified email", () => {
  it("refuses to link a Google account to an existing user when email_verified=false", async () => {
    seedUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "attacker-google-sub",
      email: "alice@example.com",
      emailVerified: false,
      displayName: "Attacker"
    });

    const app = createApp();
    const { stateCookie, stateValue } = await getOAuthStateForTest(app);

    const res = await request(app)
      .get(`/auth/google/callback?code=attacker-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("OAUTH_EMAIL_UNVERIFIED");
    // No session must have been created.
    expect(extractSessionCookie(res.headers["set-cookie"])).toBeUndefined();
    // No provider account must have been linked.
    expect(store.providerAccounts).toHaveLength(0);
    // Original user must be untouched.
    expect(store.users).toHaveLength(1);
    expect(store.users[0].id).toBe("user-existing");
  });

  it("allows linking when email_verified=true", async () => {
    seedUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "legit-google-sub",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice from Google"
    });

    const app = createApp();
    const { stateCookie, stateValue } = await getOAuthStateForTest(app);

    const res = await request(app)
      .get(`/auth/google/callback?code=legit-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    expect(res.status).toBe(302);
    expect(extractSessionCookie(res.headers["set-cookie"])).toBeDefined();
    expect(store.providerAccounts).toHaveLength(1);
  });
});

// ── F3 tests ─────────────────────────────────────────────────────────────────

describe("F3 — OAuth login-CSRF state enforcement", () => {
  it("rejects Google callback with no state cookie and no state query param", async () => {
    seedUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "any-sub",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice"
    });

    const app = createApp();
    const res = await request(app).get("/auth/google/callback?code=some-code");

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("OAUTH_STATE_MISMATCH");
    expect(extractSessionCookie(res.headers["set-cookie"])).toBeUndefined();
  });

  it("rejects Google callback when state query param doesn't match state cookie", async () => {
    seedUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "any-sub",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice"
    });

    const app = createApp();
    const { stateCookie } = await getOAuthStateForTest(app);

    const res = await request(app)
      .get("/auth/google/callback?code=some-code&state=WRONG_STATE_VALUE")
      .set("Cookie", stateCookie);

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("OAUTH_STATE_MISMATCH");
    expect(extractSessionCookie(res.headers["set-cookie"])).toBeUndefined();
  });

  it("accepts Google callback when state matches", async () => {
    seedUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "any-sub",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice"
    });

    const app = createApp();
    const { stateCookie, stateValue } = await getOAuthStateForTest(app);

    const res = await request(app)
      .get(`/auth/google/callback?code=valid-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    expect(res.status).toBe(302);
    expect(extractSessionCookie(res.headers["set-cookie"])).toBeDefined();
  });
});

// ── F4 tests ─────────────────────────────────────────────────────────────────

describe("F4 - Rate limiting on auth endpoints", () => {
  it("returns 429 after exceeding login rate limit", async () => {
    const app = createApp();
    // Login limit: 10 per 15 min per IP. Send 11 requests.
    const loginBody = { email: "brute@example.com", password: "wrong" };
    let lastStatus = 0;

    for (let i = 0; i < 11; i++) {
      const res = await request(app).post("/auth/login").send(loginBody);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("returns 429 after exceeding email verification request rate limit", async () => {
    const app = createApp();
    let lastStatus = 0;

    // Limit: 5 per hour per IP. Send 6 requests.
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/auth/email/verification/request")
        .send({ email: "target@example.com" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("returns 429 after exceeding password reset request rate limit", async () => {
    const app = createApp();
    let lastStatus = 0;

    // Limit: 5 per hour per IP. Send 6 requests.
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/auth/password/reset/request")
        .send({ email: "target@example.com" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it.each(publicRateLimitRouteCases)("returns 429 after exceeding the $name policy", async (routeCase) => {
    const app = createApp();

    for (let index = 0; index < routeCase.limit; index += 1) {
      const response = await sendRateLimitRequest(app, routeCase);
      expect(response.status).not.toBe(429);
    }

    const blockedResponse = await sendRateLimitRequest(app, routeCase);

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("counts 404 responses toward the baseline limiter", async () => {
    const app = createApp();

    for (let index = 0; index < 300; index += 1) {
      const response = await request(app)
        .get("/missing")
        .set("X-Forwarded-For", TEST_IP);

      expect(response.status).toBe(404);
    }

    const blockedResponse = await request(app)
      .get("/missing")
      .set("X-Forwarded-For", TEST_IP);

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("skips the baseline limiter for /health so the health policy remains meaningful", async () => {
    const app = createApp();

    for (let index = 0; index < 301; index += 1) {
      await request(app)
        .get("/missing")
        .set("X-Forwarded-For", TEST_IP);
    }

    const response = await request(app)
      .get("/health")
      .set("X-Forwarded-For", TEST_IP);

    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-limit"]).toBe("120");
    expect(response.headers["ratelimit-remaining"]).toBeDefined();
    expect(response.headers["ratelimit-reset"]).toBeDefined();
    expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(response.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(response.headers["x-ratelimit-reset"]).toBeUndefined();
  });

  it("shares the public-share write bucket between comments and ratings", async () => {
    const app = createApp();

    for (let index = 0; index < 5; index += 1) {
      await request(app)
        .post("/shared/share-token/comments")
        .set("X-Forwarded-For", TEST_IP)
        .send({});
    }

    for (let index = 0; index < 5; index += 1) {
      await request(app)
        .post("/shared/share-token/rate")
        .set("X-Forwarded-For", TEST_IP)
        .send({});
    }

    const blockedResponse = await request(app)
      .post("/shared/share-token/comments")
      .set("X-Forwarded-For", TEST_IP)
      .send({});

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body?.error?.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("isolates in-memory counters across fresh createApp calls when Redis is not configured", async () => {
    const firstApp = createApp();
    const secondApp = createApp();

    for (let index = 0; index < 10; index += 1) {
      await request(firstApp)
        .post("/auth/login")
        .set("X-Forwarded-For", TEST_IP)
        .send({});
    }

    const blockedResponse = await request(firstApp)
      .post("/auth/login")
      .set("X-Forwarded-For", TEST_IP)
      .send({});

    const freshResponse = await request(secondApp)
      .post("/auth/login")
      .set("X-Forwarded-For", TEST_IP)
      .send({});

    expect(blockedResponse.status).toBe(429);
    expect(freshResponse.status).not.toBe(429);
  });

  it("keeps baseline-only traffic and health available when the shared store fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({
      rateLimiterStoreFactory: (prefix) => new ThrowingStore(prefix)
    });

    const missingResponse = await request(app)
      .get("/missing")
      .set("X-Forwarded-For", TEST_IP);
    const healthResponse = await request(app)
      .get("/health")
      .set("X-Forwarded-For", TEST_IP);

    expect(missingResponse.status).toBe(404);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toEqual({ ok: true });
    expect(errorSpy.mock.calls.flatMap((arguments_) => arguments_).join("\n")).not.toContain(
      STORE_FAILURE_SECRET
    );
  });

  it("returns a controlled 503 when a sensitive limiter store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp({
      rateLimiterStoreFactory: (prefix) => new ThrowingStore(prefix)
    });

    const response = await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", TEST_IP)
      .send({ email: "user@example.com", password: "invalid" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Request protection is temporarily unavailable. Please try again later."
      }
    });
    expect(JSON.stringify(response.body)).not.toContain(STORE_FAILURE_SECRET);
    expect(JSON.stringify(response.body)).not.toContain("redis");
  });

  it("includes credentialed CORS headers on baseline 429 responses", async () => {
    const app = createApp();

    for (let index = 0; index < 300; index += 1) {
      await request(app)
        .get("/missing")
        .set("Origin", env.APP_ORIGIN)
        .set("X-Forwarded-For", TEST_IP);
    }

    const response = await request(app)
      .get("/missing")
      .set("Origin", env.APP_ORIGIN)
      .set("X-Forwarded-For", TEST_IP);

    expect(response.status).toBe(429);
    expect(response.headers["access-control-allow-origin"]).toBe(env.APP_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("handles repeated OPTIONS preflight without consuming baseline capacity", async () => {
    const app = createApp();

    for (let index = 0; index < 301; index += 1) {
      const response = await request(app)
        .options("/auth/login")
        .set("Origin", env.APP_ORIGIN)
        .set("Access-Control-Request-Method", "POST")
        .set("X-Forwarded-For", TEST_IP);

      expect(response.status).toBe(204);
    }

    const baselineResponse = await request(app)
      .get("/missing")
      .set("Origin", env.APP_ORIGIN)
      .set("X-Forwarded-For", TEST_IP);

    expect(baselineResponse.status).toBe(404);
  });
});

describe("request logging redaction", () => {
  it("redacts public bearer-token path segments and omits invitation query tokens", async () => {
    const app = createApp();
    const shareToken = "share-secret-token";
    const reviewToken = "review-secret-token";
    const invitationToken = "invitation-secret-token";

    await request(app).get(`/shared/${shareToken}/comments`);
    await request(app).get(`/reviews/${reviewToken}/check`);
    await request(app).get(`/invitations/lookup?token=${invitationToken}`);

    const logOutput = vi.mocked(console.log).mock.calls
      .flatMap((arguments_) => arguments_)
      .join("\n");

    expect(logOutput).toContain("[Request] GET /shared/[REDACTED]/comments");
    expect(logOutput).toContain("[Request] GET /reviews/[REDACTED]/check");
    expect(logOutput).toContain("[Request] GET /invitations/lookup");
    expect(logOutput).not.toContain(shareToken);
    expect(logOutput).not.toContain(reviewToken);
    expect(logOutput).not.toContain(invitationToken);
  });
});

// ── F7 tests ─────────────────────────────────────────────────────────────────

describe("F7 — User enumeration prevention", () => {
  it("password reset returns 202 for an unknown email (non-enumerating)", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/auth/password/reset/request")
      .send({ email: "nobody@example.com" });

    // Must return 202 regardless of whether the email exists.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it("password reset returns 202 for a known email (same response as unknown)", async () => {
    seedUser();
    const app = createApp();

    const res = await request(app)
      .post("/auth/password/reset/request")
      .send({ email: "alice@example.com" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it("email verification request returns 202 for an unknown email (non-enumerating)", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/auth/email/verification/request")
      .send({ email: "nobody@example.com" });

    // Must return 202 — no 404 EMAIL_NOT_FOUND.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  it("email verification request returns 202 for an already-verified email (non-enumerating)", async () => {
    seedUser({ email: "alice@example.com", emailNormalized: "alice@example.com", emailVerifiedAt: new Date() });
    const app = createApp();

    const res = await request(app)
      .post("/auth/email/verification/request")
      .send({ email: "alice@example.com" });

    // Must return 202 — no 409 EMAIL_ALREADY_VERIFIED.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });
});
