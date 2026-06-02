/**
 * Regression test for the "email/password user signs in with Google → stranded
 * on the landing page" bug.
 *
 * Root cause was on the client (page.jsx swallowed a failed /auth/me), but the
 * server contract it depends on was previously untested: after an existing
 * email/password user authenticates via Google with the SAME email, the OAuth
 * callback must (1) LINK the Google provider to the existing user, (2) set a
 * session cookie, and (3) have that exact cookie authenticate a follow-up
 * /auth/me request. If any of those break, the client has no way to recover.
 *
 * Approach mirrors ratedHistoryRoutes.test.ts: drive the real Express app via
 * supertest with two seams mocked —
 *   1. ../src/services/oauth          — stub Google token verification
 *   2. ../src/db/prisma               — in-memory stores keyed on the REAL
 *                                       hashToken(), so the session token written
 *                                       by setSessionCookie is looked up by
 *                                       attachAuthUser through the same hashing
 *                                       path (write/read identity is exercised,
 *                                       not short-circuited).
 * No Postgres connection is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── In-memory data stores shared by the prisma mock ──────────────────────────

type AnyRow = Record<string, any>;
const store = {
  users: [] as AnyRow[],
  sessions: [] as AnyRow[],
  providerAccounts: [] as AnyRow[]
};

// ── Module mocks (hoisted before imports resolve) ────────────────────────────

vi.mock("../src/services/oauth", () => ({
  verifyGoogleAuthorizationCode: vi.fn(),
  verifyAppleIdToken: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: {
    session: {
      // Used by attachAuthUser — keyed on tokenHash, includes the user + memberships.
      findUnique: vi.fn(async ({ where }: AnyRow) => {
        const session = store.sessions.find((s) => s.tokenHash === where.tokenHash);
        if (!session) return null;
        const user = store.users.find((u) => u.id === session.userId);
        return { ...session, user: { ...user, memberships: user?.memberships ?? [] } };
      }),
      // Used by createSession in the auth repository.
      create: vi.fn(async ({ data }: AnyRow) => {
        const session = {
          id: `session-${store.sessions.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
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
        const user = {
          id: `user-${store.users.length + 1}`,
          role: "USER",
          status: "ACTIVE",
          accountType: "PENDING",
          emailVerifiedAt: null,
          avatarImageId: null,
          memberships: [],
          ...data
        };
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
        const account = {
          id: `provider-${store.providerAccounts.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        store.providerAccounts.push(account);
        const user = store.users.find((u) => u.id === account.userId);
        return { ...account, user: { ...user, memberships: user?.memberships ?? [] } };
      })
    }
  }
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { createApp } from "../src/app";
import { verifyGoogleAuthorizationCode } from "../src/services/oauth";

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXISTING_EMAIL = "owner@example.com";

/** Seed an already-registered, email-verified email/password user. */
function seedEmailPasswordUser(overrides: AnyRow = {}) {
  const user = {
    id: "user-existing",
    email: EXISTING_EMAIL,
    emailNormalized: EXISTING_EMAIL,
    passwordHash: "argon2-hash-placeholder",
    displayName: "Existing Owner",
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

/** Pull the `voyage_session=...` pair out of a Set-Cookie header the way a browser/agent would replay it. */
function extractSessionCookie(setCookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
  return header.map((c) => c.split(";")[0]).find((c) => c.startsWith("voyage_session="));
}

/** Return the FULL Set-Cookie line (with attributes) for the session cookie. */
function rawSessionSetCookie(setCookie: string | string[] | undefined): string | undefined {
  const header = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean) as string[];
  return header.find((c) => c.startsWith("voyage_session="));
}

/**
 * F3: Simulate the real browser OAuth flow for tests.
 * 1. GET /auth/google/start → receives state + nonce cookies.
 * 2. Extract the state value from the redirect URL.
 * 3. Replay the state cookie + state query param to /auth/google/callback.
 *
 * This mirrors what a browser does: it stores the state cookie during the
 * redirect, then the provider bounces the user back with ?state= in the URL.
 */
async function getOAuthStateCookie(app: ReturnType<typeof createApp>): Promise<{ stateCookie: string; stateValue: string }> {
  // We need Google client ID to be non-empty for /start to work.
  // Set it temporarily — the test doesn't verify the redirect URL details.
  const startRes = await request(app)
    .get("/auth/google/start")
    // Provide fake credentials so /start doesn't 501.
    // These don't reach any real Google API since we're getting the redirect URL only.
    .set("Host", "localhost");

  // Extract state from the redirect URL
  const location = startRes.headers["location"] as string | undefined;
  const stateValue = location ? new URL(location).searchParams.get("state") ?? "" : "";

  // Extract the state cookie set by /start
  const setCookieHeaders = startRes.headers["set-cookie"] as string | string[] | undefined;
  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean) as string[];
  const stateRaw = cookies.find((c) => c.startsWith("voyage_oauth_state="));
  const stateCookiePair = stateRaw?.split(";")[0] ?? "";

  return { stateCookie: stateCookiePair, stateValue };
}

beforeEach(() => {
  store.users = [];
  store.sessions = [];
  store.providerAccounts = [];
  vi.clearAllMocks();
  vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
    provider: "GOOGLE",
    providerAccountId: "google-sub-123",
    email: EXISTING_EMAIL,
    emailVerified: true,
    displayName: "Owner From Google"
  });
  // Provide Google OAuth credentials so /google/start doesn't 501.
  process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:4000/auth/google/callback";
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Google OAuth sign-in for an existing email/password user", () => {
  it("links the Google provider to the existing user, sets a session cookie, and authenticates /auth/me with it", async () => {
    const existing = seedEmailPasswordUser();
    const app = createApp();

    // F3: Get CSRF state by first calling /start, then replay it to the callback.
    const { stateCookie, stateValue } = await getOAuthStateCookie(app);
    expect(stateValue, "start must generate a state parameter").toBeTruthy();

    // 1. Google callback — verifyGoogleAuthorizationCode is stubbed to the existing email.
    const callback = await request(app)
      .get(`/auth/google/callback?code=fake-auth-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    // It redirects back into the app (not an error page).
    expect(callback.status).toBe(302);
    expect(callback.headers["location"]).toBe("http://localhost:3000/?authenticated=1");

    // A session cookie is set.
    const sessionCookie = extractSessionCookie(callback.headers["set-cookie"]);
    expect(sessionCookie, "callback must emit a voyage_session cookie").toBeDefined();

    // The provider was LINKED to the EXISTING user — no second user created.
    expect(store.users).toHaveLength(1);
    expect(store.providerAccounts).toHaveLength(1);
    expect(store.providerAccounts[0]).toMatchObject({
      provider: "GOOGLE",
      providerAccountId: "google-sub-123",
      userId: existing.id
    });

    // 2. Follow-up /auth/me with the SAME cookie must authenticate (this is the
    //    request page.jsx makes after the OAuth redirect; if it 401s the user is
    //    stranded on the landing page).
    const me = await request(app).get("/auth/me").set("Cookie", sessionCookie!);

    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({
      id: existing.id,
      email: EXISTING_EMAIL,
      accountType: "PERSONAL"
    });

    // Authenticated, per-user responses must be `no-store` so the browser/SW HTTP
    // cache can't replay one account's identity for the next account on the same
    // device (the cross-user data-leak after switching accounts).
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("emits the session cookie as first-party SameSite=Lax; Secure (the app reaches this API through a same-origin /api proxy)", async () => {
    // The SPA now talks to this API through a SAME-ORIGIN reverse proxy (the
    // client's Next `rewrites` forward /api/* here), so the post-redirect
    // fetch("/auth/me") is same-site and a Lax cookie reaches it. Lax is in fact
    // REQUIRED for iOS standalone PWAs: WebKit's ITP blocks cross-site
    // SameSite=None cookies, which made sign-in appear to work while every data
    // fetch came back unauthenticated (empty threads/itineraries). supertest
    // replays cookies regardless of SameSite, so asserting the emitted attributes
    // is the only way to catch a regression at this layer.
    seedEmailPasswordUser();
    const app = createApp();

    // F3: Obtain and replay CSRF state.
    const { stateCookie, stateValue } = await getOAuthStateCookie(app);
    const callback = await request(app)
      .get(`/auth/google/callback?code=fake-auth-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    const rawCookie = rawSessionSetCookie(callback.headers["set-cookie"]);

    expect(rawCookie, "callback must emit a voyage_session cookie").toBeDefined();
    // First-party Lax (not None) now that delivery is same-site...
    expect(rawCookie!).toMatch(/;\s*SameSite=Lax/i);
    // ...and Secure stays on (HTTPS in prod; accepted on localhost in dev).
    expect(rawCookie!).toMatch(/;\s*Secure/i);
  });

  it("authenticates a follow-up /auth/me only with a cookie that matches the stored session hash", async () => {
    seedEmailPasswordUser();
    const app = createApp();

    // F3: Obtain and replay CSRF state.
    const { stateCookie, stateValue } = await getOAuthStateCookie(app);
    const callback = await request(app)
      .get(`/auth/google/callback?code=fake-auth-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    const sessionCookie = extractSessionCookie(callback.headers["set-cookie"]);
    expect(sessionCookie).toBeDefined();

    // Sanity: a tampered/wrong token must NOT authenticate — proves /auth/me is
    // genuinely gated on the session hash, so the success case above is meaningful.
    const wrong = await request(app)
      .get("/auth/me")
      .set("Cookie", "voyage_session=not-the-real-token");
    expect(wrong.status).toBe(401);

    // The real cookie authenticates.
    const ok = await request(app).get("/auth/me").set("Cookie", sessionCookie!);
    expect(ok.status).toBe(200);
  });

  // ── F3 regression tests ──────────────────────────────────────────────────

  it("F3: rejects callback with missing state (no cookie, no query param)", async () => {
    seedEmailPasswordUser();
    const app = createApp();

    const res = await request(app).get("/auth/google/callback?code=fake-auth-code");
    // Missing state → 400 OAUTH_STATE_MISMATCH
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("OAUTH_STATE_MISMATCH");
  });

  it("F3: rejects callback with mismatched state (cookie doesn't match query param)", async () => {
    seedEmailPasswordUser();
    const app = createApp();

    // Set a valid state cookie, but send a different value in the query param.
    const { stateCookie } = await getOAuthStateCookie(app);
    const res = await request(app)
      .get("/auth/google/callback?code=fake-auth-code&state=totally-wrong-state")
      .set("Cookie", stateCookie);

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("OAUTH_STATE_MISMATCH");
  });

  // ── F1 regression test ───────────────────────────────────────────────────

  it("F1: rejects OAuth linking when provider email is unverified (existing user)", async () => {
    // An existing Voyage account owner@example.com tries to be taken over via
    // an unverified Google Workspace account with the same email.
    seedEmailPasswordUser();
    vi.mocked(verifyGoogleAuthorizationCode).mockResolvedValue({
      provider: "GOOGLE",
      providerAccountId: "attacker-sub",
      email: EXISTING_EMAIL,
      emailVerified: false, // <-- attacker's Google account has unverified email
      displayName: "Attacker"
    });

    const app = createApp();
    const { stateCookie, stateValue } = await getOAuthStateCookie(app);
    const res = await request(app)
      .get(`/auth/google/callback?code=attacker-code&state=${stateValue}`)
      .set("Cookie", stateCookie);

    // Must NOT redirect to the app as authenticated — must fail.
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("OAUTH_EMAIL_UNVERIFIED");
    // Must NOT have created a session cookie.
    const sessionCookie = extractSessionCookie(res.headers["set-cookie"]);
    expect(sessionCookie).toBeUndefined();
    // Must NOT have linked a provider account.
    expect(store.providerAccounts).toHaveLength(0);
  });
});
