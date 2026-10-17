# Remember Me + Sliding Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Keep me signed in" checkbox to the login form (web + PWA) and make sessions renew themselves while the app is in use, instead of ending a fixed 30 days after sign-in.

**Architecture:** A new `persistent` flag on the `Session` row records the user's choice. Checked → a cookie with an `Expires` date that matches the server session (30-day idle window). Unchecked → a browser-session cookie (no expiry, dropped when the browser closes) plus a 12-hour idle window on the server. `attachAuthUser` (which already runs on every request) slides `expiresAt` forward at most once an hour and re-sends the cookie for persistent sessions. A 90-day hard cap from sign-in limits how long one stolen token can live. Google sign-in carries the choice through the provider round-trip in a short `voyage_oauth_remember` cookie.

**Tech Stack:** Express + Prisma + Zod + Vitest/supertest (Voyage-Server); Next.js + React + Vitest/Testing Library (Voyage-Client).

---

## Current state (checked 2026-10-18)

- No remember-me anywhere. `setSessionCookie` (`Voyage-Server/src/http/cookies.ts`) always sets `maxAge = SESSION_TTL_DAYS` (default 30).
- `authService.createSession` stores `expiresAt = now + 30 days`. `attachAuthUser` (`Voyage-Server/src/http/authMiddleware.ts`) only checks `expiresAt <= now` and never extends it, so everyone is signed out 30 days after sign-in however active they are.
- The client keeps a cached user in `localStorage["voyage-user"]`, but the cookie is the real auth: `app/page.jsx` re-checks `/auth/me` and clears the cache on failure. The PWA uses the same cookie through the same-origin `/api` proxy, so one server change covers web and PWA.

## Behaviour after this plan

| | Keep me signed in (default) | Unchecked |
|---|---|---|
| Cookie | `Expires` = server `expiresAt` | Browser-session cookie (no `Expires`/`Max-Age`) |
| Server idle window | 30 days (`SESSION_TTL_DAYS`) | 12 hours (`SESSION_SHORT_TTL_HOURS`) |
| Renewal | Slides on use, at most once an hour, cookie re-sent | Slides on use, at most once an hour (server only) |
| Hard cap | 90 days after sign-in (`SESSION_MAX_AGE_DAYS`) | Same |

Default is **checked** because the PWA is the main surface and people expect an installed app to stay signed in. Existing session rows get `persistent = true` from the migration default, so nobody is signed out by the deploy.

Notes:
- The cap is enforced by clamping every `expiresAt` write, so `attachAuthUser` keeps its single `expiresAt <= now` check.
- An iOS home-screen app may drop browser-session cookies when it is closed from the app switcher, so unchecked PWA users will sign in again on each launch. That's expected.
- The hourly throttle keeps the cost at roughly one `UPDATE` per active user per hour. `useAgencyStatusPolling` already calls `/auth/me`, so an open app keeps renewing.

## File map

**Voyage-Server**
- Create `src/modules/auth/sessionLifetime.ts`: pure expiry maths (initial expiry, renewed expiry, config from env).
- Modify `src/config/env.ts`: add `SESSION_SHORT_TTL_HOURS`, `SESSION_MAX_AGE_DAYS`.
- Modify `.env.example`: document the two new vars.
- Modify `prisma/schema.prisma` and create `prisma/migrations/20261018000000_session_persistent/migration.sql`: add `Session.persistent`.
- Modify `src/modules/auth/authTypes.ts`: `persistent` on `SessionRecord` + `createSession` data; `sessionLifetime` option.
- Modify `src/modules/auth/authService.ts`: `createSession(userId, persistent)`, `loginWithEmail({ rememberMe })`, `signInWithVerifiedOAuth(claims, { persistent })`.
- Modify `src/modules/auth/authSchemas.ts`: `rememberMe` on `loginSchema`.
- Modify `src/http/cookies.ts`: `setSessionCookie(response, token, { persistent, expiresAt })`.
- Modify `src/modules/auth/authRoutes.ts`: pass the session to `setSessionCookie`, and add the OAuth remember cookie.
- Modify `src/http/authMiddleware.ts`: sliding renewal.
- Tests: create `tests/sessionLifetime.test.ts`, `tests/sessionRenewal.test.ts`, `tests/rememberMeRoutes.test.ts`; modify `tests/authService.test.ts`.

**Voyage-Client**
- Modify `app/hooks/useAuth.js`: `login({ rememberMe })`, exported `oauthStartUrl`, `startOAuth(provider, { rememberMe })`.
- Modify `app/components/auth/LoginForm.jsx`: the checkbox.
- Tests: create `tests/use-auth-remember.test.jsx`; modify `tests/login-page.test.jsx`.

Work on whatever branch is checked out (both repos were on `staging` when this was written). Do not create or switch branches. Commit after each task, never push, and leave out any `Co-Authored-By` line.

---

### Task 0: Baseline

- [ ] **Step 1: Record the current server test result**

Run (in `Voyage-Server`): `npm test 2>&1 | tail -15`
Write down the failing file names, if any. Later tasks compare against this list instead of expecting zero failures.

- [ ] **Step 2: Record the current client test result**

Run (in `Voyage-Client`): `npm test 2>&1 | tail -15`
Write down the failing file names, if any.

---

### Task 1: Session lifetime maths (server)

**Files:**
- Create: `Voyage-Server/src/modules/auth/sessionLifetime.ts`
- Modify: `Voyage-Server/src/config/env.ts` (after the `SESSION_TTL_DAYS` line, ~line 30)
- Modify: `Voyage-Server/.env.example` (after `SESSION_TTL_DAYS=30`)
- Test: `Voyage-Server/tests/sessionLifetime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Server/tests/sessionLifetime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  initialSessionExpiry,
  renewedSessionExpiry,
  type SessionLifetimeConfig
} from "../src/modules/auth/sessionLifetime";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T = new Date("2026-10-01T00:00:00.000Z").getTime();

const config: SessionLifetimeConfig = {
  persistentTtlMs: 30 * DAY,
  shortTtlMs: 12 * HOUR,
  maxAgeMs: 90 * DAY,
  renewIntervalMs: HOUR
};

describe("initialSessionExpiry", () => {
  it("gives remembered sessions the long idle window", () => {
    expect(initialSessionExpiry(new Date(T), true, config)).toEqual(new Date(T + 30 * DAY));
  });

  it("gives other sessions the short idle window", () => {
    expect(initialSessionExpiry(new Date(T), false, config)).toEqual(new Date(T + 12 * HOUR));
  });
});

describe("renewedSessionExpiry", () => {
  it("slides a remembered session forward from now", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 2 * HOUR), config)).toEqual(
      new Date(T + 2 * HOUR + 30 * DAY)
    );
  });

  it("slides a short session forward by the short window", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 12 * HOUR), persistent: false };
    expect(renewedSessionExpiry(session, new Date(T + 3 * HOUR), config)).toEqual(
      new Date(T + 15 * HOUR)
    );
  });

  it("returns null when the session was renewed less than an hour ago", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 30 * 60 * 1000), config)).toBeNull();
  });

  it("never pushes past the hard cap from sign-in", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 80 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 85 * DAY), config)).toEqual(new Date(T + 90 * DAY));
  });

  it("returns null once the session already sits at the cap", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 90 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 89 * DAY), config)).toBeNull();
  });

  it("never shortens a session", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: false };
    expect(renewedSessionExpiry(session, new Date(T + HOUR * 2), config)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/sessionLifetime.test.ts`
Expected: FAIL, cannot resolve `../src/modules/auth/sessionLifetime`.

- [ ] **Step 3: Add the env vars**

In `Voyage-Server/src/config/env.ts`, directly under `SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),` add:

```ts
  // Idle window for sessions where the user unticked "Keep me signed in".
  SESSION_SHORT_TTL_HOURS: z.coerce.number().int().positive().default(12),
  // Hard limit from sign-in; sliding renewal never pushes a session past it.
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),
```

In `Voyage-Server/.env.example`, directly under `SESSION_TTL_DAYS=30` add:

```
SESSION_SHORT_TTL_HOURS=12
SESSION_MAX_AGE_DAYS=90
```

- [ ] **Step 4: Write the module**

Create `Voyage-Server/src/modules/auth/sessionLifetime.ts`:

```ts
import { env } from "../../config/env";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Renew a session at most once an hour, so normal use doesn't write on every request. */
export const SESSION_RENEW_INTERVAL_MS = HOUR_MS;

export type SessionLifetimeConfig = {
  /** Idle window for "Keep me signed in" sessions. */
  persistentTtlMs: number;
  /** Idle window for sessions whose cookie ends when the browser closes. */
  shortTtlMs: number;
  /** Hard limit from sign-in, however active the user is. */
  maxAgeMs: number;
  renewIntervalMs: number;
};

export function sessionLifetimeConfig(overrides: { sessionTtlDays?: number } = {}): SessionLifetimeConfig {
  return {
    persistentTtlMs: (overrides.sessionTtlDays ?? env.SESSION_TTL_DAYS) * DAY_MS,
    shortTtlMs: env.SESSION_SHORT_TTL_HOURS * HOUR_MS,
    maxAgeMs: env.SESSION_MAX_AGE_DAYS * DAY_MS,
    renewIntervalMs: SESSION_RENEW_INTERVAL_MS
  };
}

function idleWindowMs(persistent: boolean, config: SessionLifetimeConfig) {
  return persistent ? config.persistentTtlMs : config.shortTtlMs;
}

export function initialSessionExpiry(now: Date, persistent: boolean, config: SessionLifetimeConfig): Date {
  return new Date(now.getTime() + Math.min(idleWindowMs(persistent, config), config.maxAgeMs));
}

/**
 * The new expiry for a session that was just used, or null when it doesn't need
 * a write yet (renewed under an hour ago, or already at the hard cap).
 */
export function renewedSessionExpiry(
  session: { expiresAt: Date; createdAt: Date; persistent: boolean },
  now: Date,
  config: SessionLifetimeConfig
): Date | null {
  const target = Math.min(
    now.getTime() + idleWindowMs(session.persistent, config),
    session.createdAt.getTime() + config.maxAgeMs
  );
  if (target - session.expiresAt.getTime() < config.renewIntervalMs) {
    return null;
  }
  return new Date(target);
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run tests/sessionLifetime.test.ts tests/env.test.ts`
Expected: PASS (all 8 new tests, and env tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/sessionLifetime.ts src/config/env.ts .env.example tests/sessionLifetime.test.ts
git commit -m "feat(auth): add session lifetime maths for remember-me and sliding renewal"
```

---

### Task 2: `Session.persistent` column (server)

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma` (`model Session`, ~line 190)
- Create: `Voyage-Server/prisma/migrations/20261018000000_session_persistent/migration.sql`
- Modify: `Voyage-Server/src/modules/auth/authTypes.ts` (`SessionRecord` ~line 25, `createSession` ~line 73, `AuthServiceOptions` ~line 100)

- [ ] **Step 1: Add the column to the schema**

In `model Session`, under `expiresAt DateTime`, add:

```prisma
  /// true = "Keep me signed in": the cookie outlives the browser.
  persistent Boolean  @default(true)
```

- [ ] **Step 2: Write the migration**

Create `Voyage-Server/prisma/migrations/20261018000000_session_persistent/migration.sql`:

```sql
-- "Keep me signed in" choice per session. Existing rows count as remembered,
-- so nobody is signed out by the deploy.
ALTER TABLE "Session" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Apply it locally and regenerate the client**

Make sure the db container is up, then run: `npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration found ... applied` and `Generated Prisma Client`.

- [ ] **Step 4: Update the auth types**

In `Voyage-Server/src/modules/auth/authTypes.ts`:

`SessionRecord` becomes:

```ts
export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  persistent: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

The `createSession` line in `AuthRepository` becomes:

```ts
  createSession(data: { userId: string; tokenHash: string; persistent: boolean; expiresAt: Date }): Promise<SessionRecord>;
```

Add the import at the top of the file:

```ts
import type { SessionLifetimeConfig } from "./sessionLifetime";
```

And add to `AuthServiceOptions`, under `sessionTtlDays?: number;`:

```ts
  sessionLifetime?: SessionLifetimeConfig;
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: one error in `src/modules/auth/authService.ts` (`createSession` call is missing `persistent`). Task 3 fixes it. Any other error means a step above is wrong.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261018000000_session_persistent src/modules/auth/authTypes.ts
git commit -m "feat(auth): store the keep-me-signed-in choice on Session"
```

---

### Task 3: Auth service takes the choice (server)

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authService.ts` (lines 26-48, `loginWithEmail` ~151, `signInWithVerifiedOAuth` ~290)
- Test: `Voyage-Server/tests/authService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `Voyage-Server/tests/authService.test.ts`, add these imports at the top:

```ts
import { env } from "../src/config/env";
import { hashPassword } from "../src/services/password";
```

Then add this block at the end of the file:

```ts
describe("auth service — keep me signed in", () => {
  const NOW = new Date("2026-04-27T12:00:00.000Z").getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  async function seedVerifiedUser(repository: ReturnType<typeof createService>["repository"]) {
    await repository.createUser({
      email: "keep@example.com",
      emailNormalized: "keep@example.com",
      passwordHash: await hashPassword("password123", "pepper"),
      displayName: "Keep Me",
      emailVerifiedAt: new Date(NOW)
    });
  }

  it("creates a remembered 30-day session by default", { timeout: 15000 }, async () => {
    const { service, repository } = createService();
    await seedVerifiedUser(repository);

    const result = await service.loginWithEmail({ email: "keep@example.com", password: "password123" });

    expect(result.session.persistent).toBe(true);
    expect(result.session.expiresAt).toEqual(new Date(NOW + 30 * DAY));
  });

  it("creates a short session when rememberMe is false", { timeout: 15000 }, async () => {
    const { service, repository } = createService();
    await seedVerifiedUser(repository);

    const result = await service.loginWithEmail({
      email: "keep@example.com",
      password: "password123",
      rememberMe: false
    });

    expect(result.session.persistent).toBe(false);
    expect(result.session.expiresAt).toEqual(new Date(NOW + env.SESSION_SHORT_TTL_HOURS * HOUR));
  });

  it("passes the choice through OAuth sign-in", async () => {
    const { service } = createService();

    const result = await service.signInWithVerifiedOAuth(
      {
        provider: "GOOGLE",
        providerAccountId: "google-keep",
        email: "oauth-keep@example.com",
        emailVerified: true,
        displayName: "OAuth Keep"
      },
      { persistent: false }
    );

    expect(result.session.persistent).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/authService.test.ts`
Expected: the 3 new tests FAIL (`persistent` is undefined / `rememberMe` not accepted). Existing tests pass.

- [ ] **Step 3: Update `createSession`**

In `Voyage-Server/src/modules/auth/authService.ts`:

Add to the imports:

```ts
import { initialSessionExpiry, sessionLifetimeConfig } from "./sessionLifetime";
```

Delete the `addDays` helper (lines 26-28; `createSession` is its only caller).

Replace

```ts
  const sessionTtlDays = options.sessionTtlDays ?? env.SESSION_TTL_DAYS;
```

with

```ts
  const sessionLifetime =
    options.sessionLifetime ?? sessionLifetimeConfig({ sessionTtlDays: options.sessionTtlDays });
```

Replace `createSession` with:

```ts
  async function createSession(userId: string, persistent = true) {
    const sessionToken = createRandomToken();
    const session = await options.repository.createSession({
      userId,
      tokenHash: hashToken(sessionToken),
      persistent,
      expiresAt: initialSessionExpiry(now(), persistent, sessionLifetime)
    });

    return { session, sessionToken };
  }
```

- [ ] **Step 4: Pass the choice from both sign-in paths**

`loginWithEmail` signature becomes:

```ts
    async loginWithEmail(input: { email: string; password: string; rememberMe?: boolean }) {
```

and its `createSession` call becomes:

```ts
      const { sessionToken, session } = await createSession(user.id, input.rememberMe ?? true);
```

`signInWithVerifiedOAuth` gets a second parameter:

```ts
    async signInWithVerifiedOAuth(
      input: {
        provider: "GOOGLE" | "APPLE";
        providerAccountId: string;
        email: string;
        emailVerified: boolean;
        displayName: string;
      },
      sessionOptions: { persistent?: boolean } = {}
    ) {
      const persistent = sessionOptions.persistent ?? true;
```

and both of its `createSession(...)` calls (the existing-provider-account branch and the one at the end) pass it:

```ts
        const { sessionToken, session } = await createSession(existingProviderAccount.user.id, persistent);
```

```ts
      const { sessionToken, session } = await createSession(user.id, persistent);
```

Keep the `env` import: `appOrigin` and `passwordPepper` still read it.

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run tests/authService.test.ts tests/oauthLinkSession.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/authService.ts tests/authService.test.ts
git commit -m "feat(auth): create remembered or short sessions from the sign-in choice"
```

---

### Task 4: Cookie + login route (server)

**Files:**
- Modify: `Voyage-Server/src/http/cookies.ts:24-29`
- Modify: `Voyage-Server/src/modules/auth/authSchemas.ts:57-60`
- Modify: `Voyage-Server/src/modules/auth/authRoutes.ts` (login ~114, Google callback ~248, Apple callback ~292)
- Test: `Voyage-Server/tests/rememberMeRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Server/tests/rememberMeRoutes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/rememberMeRoutes.test.ts`
Expected: FAIL. The first two get 400 (`rememberMe` is an unrecognised key on the strict schema); the third passes already.

- [ ] **Step 3: Accept `rememberMe` in the schema**

In `Voyage-Server/src/modules/auth/authSchemas.ts`:

```ts
export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: loginPasswordSchema,
  rememberMe: z.boolean().optional()
}).strict();
```

- [ ] **Step 4: Make the cookie follow the session**

In `Voyage-Server/src/http/cookies.ts`, replace `setSessionCookie` with:

```ts
export type SessionCookieTiming = { persistent: boolean; expiresAt: Date };

export function setSessionCookie(response: Response, token: string, timing: SessionCookieTiming) {
  response.cookie(env.SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_ATTRS,
    // "Keep me signed in" → the cookie ends when the server session does.
    // Otherwise no expiry at all: a browser-session cookie, dropped on close.
    ...(timing.persistent ? { expires: timing.expiresAt } : {})
  });
}
```

- [ ] **Step 5: Pass the session from every sign-in route**

In `Voyage-Server/src/modules/auth/authRoutes.ts`, change all three calls (login, Google callback, Apple callback) from

```ts
    setSessionCookie(response, result.sessionToken);
```

to

```ts
    setSessionCookie(response, result.sessionToken, result.session);
```

- [ ] **Step 6: Run the tests and type-check**

Run: `npx vitest run tests/rememberMeRoutes.test.ts tests/routes.test.ts tests/securityHardening.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/http/cookies.ts src/modules/auth/authSchemas.ts src/modules/auth/authRoutes.ts tests/rememberMeRoutes.test.ts
git commit -m "feat(auth): accept rememberMe on login and match the cookie to the session"
```

---

### Task 5: Carry the choice through Google sign-in (server)

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authRoutes.ts` (OAuth cookie helpers ~line 28-75, `/google/start`, `/google/callback`, `/apple/start`, `/apple/callback`)
- Test: `Voyage-Server/tests/rememberMeRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `Voyage-Server/tests/rememberMeRoutes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/rememberMeRoutes.test.ts`
Expected: the 3 new tests FAIL (service called with one argument; no `voyage_oauth_remember` cookie).

- [ ] **Step 3: Add the remember cookie helpers**

In `Voyage-Server/src/modules/auth/authRoutes.ts`, under `const OAUTH_NONCE_COOKIE = "voyage_oauth_nonce";` add:

```ts
const OAUTH_REMEMBER_COOKIE = "voyage_oauth_remember";
```

Replace `clearOAuthStateCookies` with:

```ts
const OAUTH_CLEAR_OPTS = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" };

function clearOAuthStateCookies(response: import("express").Response) {
  response.clearCookie(OAUTH_STATE_COOKIE, OAUTH_CLEAR_OPTS);
  response.clearCookie(OAUTH_NONCE_COOKIE, OAUTH_CLEAR_OPTS);
  response.clearCookie(OAUTH_REMEMBER_COOKIE, OAUTH_CLEAR_OPTS);
}

// "Keep me signed in" can't ride the provider round-trip, so the start route
// parks an opt-out (?remember=0) in a short cookie and the callback reads it back.
function rememberOAuthChoice(request: import("express").Request, response: import("express").Response) {
  if (request.query.remember === "0") {
    response.cookie(OAUTH_REMEMBER_COOKIE, "0", OAUTH_COOKIE_OPTS);
  } else {
    response.clearCookie(OAUTH_REMEMBER_COOKIE, OAUTH_CLEAR_OPTS);
  }
}

function readOAuthRemember(request: import("express").Request) {
  return request.cookies?.[OAUTH_REMEMBER_COOKIE] !== "0";
}
```

- [ ] **Step 4: Use them in the start and callback routes**

In both `authRoutes.get("/google/start", ...)` and `authRoutes.get("/apple/start", ...)`, rename `_request` to `request` and add this line right after the `generateOAuthCsrfTokens(response)` call:

```ts
  rememberOAuthChoice(request, response);
```

In both `/google/callback` and `/apple/callback`, add as the first line inside `try {` (before `consumeExpectedOAuthState`, which clears the cookie on the response but leaves `request.cookies` readable):

```ts
    const persistent = readOAuthRemember(request);
```

and change

```ts
    const result = await authService.signInWithVerifiedOAuth(claims);
```

to

```ts
    const result = await authService.signInWithVerifiedOAuth(claims, { persistent });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/rememberMeRoutes.test.ts tests/securityHardening.test.ts tests/oauthLinkSession.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/authRoutes.ts tests/rememberMeRoutes.test.ts
git commit -m "feat(auth): carry the keep-me-signed-in choice through OAuth sign-in"
```

---

### Task 6: Sliding renewal in the auth middleware (server)

**Files:**
- Modify: `Voyage-Server/src/http/authMiddleware.ts:1-6` (imports) and `:29-70` (`attachAuthUser`)
- Test: `Voyage-Server/tests/sessionRenewal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Server/tests/sessionRenewal.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/sessionRenewal.test.ts`
Expected: the "pushes forward", "short session" tests FAIL (`update` never called); the others pass already.

- [ ] **Step 3: Implement the renewal**

In `Voyage-Server/src/http/authMiddleware.ts`, add to the imports:

```ts
import { setSessionCookie } from "./cookies";
import { renewedSessionExpiry, sessionLifetimeConfig } from "../modules/auth/sessionLifetime";
```

Under the imports/type declarations (before `attachAuthUser`), add:

```ts
const sessionLifetime = sessionLifetimeConfig();

// Sliding expiry: each request from a signed-in user pushes the session's end
// forward (at most once an hour), so people who keep using the app stay signed in.
// A failed write only skips this renewal; it never blocks the request.
async function renewSession(
  response: Response,
  token: string,
  session: { id: string; expiresAt: Date; createdAt: Date; persistent: boolean },
  now: Date
) {
  const expiresAt = renewedSessionExpiry(session, now, sessionLifetime);
  if (!expiresAt) return;
  try {
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt } });
  } catch (error) {
    console.error("[auth] Failed to renew session:", error);
    return;
  }
  if (session.persistent) {
    setSessionCookie(response, token, { persistent: true, expiresAt });
  }
}
```

Then in `attachAuthUser`, rename the `_response` parameter to `response` and replace the block from the expiry check to the end of the function with:

```ts
  const now = new Date();
  if (!session || session.expiresAt <= now || session.user.status !== "ACTIVE") {
    return next();
  }

  request.authUser = session.user;
  request.sessionId = session.id;
  await renewSession(response, token, session, now);
  return next();
}
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run tests/sessionRenewal.test.ts tests/securityHardening.test.ts && npx tsc --noEmit`
Expected: all PASS, no type errors. (`securityHardening`'s seeded session was created 2026-06-01, so it is already past the 90-day cap and never triggers a renewal write; its prisma mock needs no `update`.)

- [ ] **Step 5: Commit**

```bash
git add src/http/authMiddleware.ts tests/sessionRenewal.test.ts
git commit -m "feat(auth): renew sessions while the app is in use"
```

---

### Task 7: Server full check

- [ ] **Step 1: Run the whole suite**

Run (in `Voyage-Server`): `npm test 2>&1 | tail -20`
Expected: the same failing files as the Task 0 baseline and no new ones.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0.

---

### Task 8: `useAuth` sends the choice (client)

**Files:**
- Modify: `Voyage-Client/app/hooks/useAuth.js` (`login` ~108, `startOAuth` ~148, new export near `API_URL` ~24)
- Test: `Voyage-Client/tests/use-auth-remember.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `Voyage-Client/tests/use-auth-remember.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../app/lib/api/index.js", () => ({
  fetchApi,
  setAccountType: vi.fn(),
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
  acceptInvitation: vi.fn(),
}));

import { oauthStartUrl, useAuth } from "../app/hooks/useAuth";

beforeEach(() => {
  fetchApi.mockReset();
  window.localStorage.clear();
});

describe("useAuth — keep me signed in", () => {
  it("sends rememberMe with the login request", async () => {
    fetchApi.mockResolvedValueOnce({ user: { id: "user-1" } });
    const { result } = renderHook(() => useAuth());

    await act(() => result.current.login({ email: "a@example.com", password: "password123", rememberMe: false }));

    expect(fetchApi).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.com", password: "password123", rememberMe: false }),
    });
  });

  it("defaults rememberMe to true", async () => {
    fetchApi.mockResolvedValueOnce({ user: { id: "user-1" } });
    const { result } = renderHook(() => useAuth());

    await act(() => result.current.login({ email: "a@example.com", password: "password123" }));

    expect(JSON.parse(fetchApi.mock.calls[0][1].body).rememberMe).toBe(true);
  });
});

describe("oauthStartUrl", () => {
  it("adds remember=0 only when the user opted out", () => {
    expect(oauthStartUrl("google", { rememberMe: false })).toMatch(/\/auth\/google\/start\?remember=0$/);
    expect(oauthStartUrl("google", { rememberMe: true })).toMatch(/\/auth\/google\/start$/);
    expect(oauthStartUrl("google")).toMatch(/\/auth\/google\/start$/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run (in `Voyage-Client`): `npx vitest run --pool=threads tests/use-auth-remember.test.jsx`
Expected: FAIL (`oauthStartUrl` is not exported; body has no `rememberMe`).

- [ ] **Step 3: Implement**

In `Voyage-Client/app/hooks/useAuth.js`, under `const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";` add:

```js
// The server parks ?remember=0 in a short cookie and reads it back on the
// provider callback, so OAuth sign-ins honour "Keep me signed in" too.
export function oauthStartUrl(provider, { rememberMe = true } = {}) {
  const url = `${API_URL}/auth/${provider}/start`;
  return rememberMe ? url : `${url}?remember=0`;
}
```

Change the start of `login` from

```js
  const login = async ({ email, password }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
```

to

```js
  const login = async ({ email, password, rememberMe = true }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, rememberMe }),
      });
```

Replace `startOAuth` with:

```js
  const startOAuth = (provider, options) => {
    window.location.href = oauthStartUrl(provider, options);
  };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/use-auth-remember.test.jsx tests/login-auth-routing.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useAuth.js tests/use-auth-remember.test.jsx
git commit -m "feat(auth): send the keep-me-signed-in choice from useAuth"
```

---

### Task 9: "Keep me signed in" checkbox (client)

**Files:**
- Modify: `Voyage-Client/app/components/auth/LoginForm.jsx`
- Test: `Voyage-Client/tests/login-page.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `Voyage-Client/tests/login-page.test.jsx`:

```jsx
describe("login page — keep me signed in", () => {
  function fillCredentials() {
    fireEvent.change(screen.getByPlaceholderText("voyager@example.com"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "password123" } });
  }

  it("is ticked by default and sends rememberMe: true", () => {
    render(<LoginPage />);

    expect(screen.getByRole("checkbox", { name: /keep me signed in/i })).toBeChecked();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Voyage" }));

    expect(useAuthState.login).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password123",
      rememberMe: true,
    });
  });

  it("sends rememberMe: false once unticked", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /keep me signed in/i }));
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Voyage" }));

    expect(useAuthState.login).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "password123",
      rememberMe: false,
    });
  });

  it("passes the choice to Google sign-in", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /keep me signed in/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(useAuthState.startOAuth).toHaveBeenCalledWith("google", { rememberMe: false });
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run --pool=threads tests/login-page.test.jsx`
Expected: the 3 new tests FAIL (no checkbox). Existing tests pass.

- [ ] **Step 3: Add the state and pass it on**

In `Voyage-Client/app/components/auth/LoginForm.jsx`, under `const [showPassword, setShowPassword] = useState(false);` add:

```jsx
  const [rememberMe, setRememberMe] = useState(true);
```

Change `handleLoginSubmit` to:

```jsx
  const handleLoginSubmit = (e) => {
    e.preventDefault();
    auth.login({ email, password, rememberMe });
  };
```

Change the OAuth buttons line to:

```jsx
      <OAuthButtons onSelect={(id) => auth.startOAuth(id, { rememberMe })} />
```

- [ ] **Step 4: Render the checkbox**

Directly after the closing `</FormField>` of the password field (and before `{notice && (`), add. It reuses the terms checkbox styling from `RegisterWizard.jsx`:

```jsx
        <label className="flex items-start gap-3 cursor-pointer py-0.5" htmlFor="auth-remember">
          <input
            type="checkbox"
            id="auth-remember"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            aria-describedby="auth-remember-hint"
            className="mt-0.5 w-4.5 h-4.5 rounded border-border text-secondary focus:ring-secondary cursor-pointer"
          />
          <span className="leading-tight">
            <span className="block text-[0.92rem] text-text-primary font-semibold">Keep me signed in</span>
            <span id="auth-remember-hint" className="block text-[0.8rem] text-text-muted mt-0.5">
              Untick on a shared device. You'll be signed out when the browser closes.
            </span>
          </span>
        </label>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --pool=threads tests/login-page.test.jsx tests/login-auth-routing.test.jsx`
Expected: PASS. (`reachAgencyStep` uses `getByRole("checkbox")` in register mode, where `LoginForm` isn't mounted, so it still finds just the terms box.)

- [ ] **Step 6: Commit**

```bash
git add app/components/auth/LoginForm.jsx tests/login-page.test.jsx
git commit -m "feat(auth): add Keep me signed in checkbox to the login form"
```

---

### Task 10: Client full check + hands-on QA

- [ ] **Step 1: Run the whole suite and build**

Run (in `Voyage-Client`): `npm test 2>&1 | tail -20 && npm run build`
Expected: the same failing files as the Task 0 baseline, no new ones; build exits 0.

- [ ] **Step 2: Restart the backend**

OneDrive breaks `tsx watch`, so stop and restart the server dev process instead of relying on reload.

- [ ] **Step 3: Browser QA (localhost)**

1. Open `/login`. Check the box is ticked, the hint reads well in light and dark themes, and the layout holds at 375px wide.
2. Ticked: sign in. In DevTools → Application → Cookies, `voyage_session` has an expiry ~30 days out. Close every browser window, reopen `/`: still signed in.
3. Unticked: sign out, sign in again. `voyage_session` shows "Session" as its expiry. Close every window, reopen: back on the login page.
4. Renewal: in the db, run `UPDATE "Session" SET "expiresAt" = now() + interval '1 day' WHERE id = '<your session id>';`, reload the app, and confirm the row's `expiresAt` jumped to ~30 days out and the response to `/api/auth/me` carried a fresh `Set-Cookie`.
5. Google sign-in with the box unticked: after the redirect, `voyage_session` is a session cookie and `voyage_oauth_remember` is gone.

- [ ] **Step 4: PWA QA (installed app)**

1. Ticked: sign in inside the installed PWA, fully close it, reopen: still signed in.
2. Unticked: sign in, fully close, reopen: login page. (On iOS this depends on WebKit dropping session cookies when the app is killed; if it keeps them, the 12-hour server window still signs the user out.)

- [ ] **Step 5: Deploy note**

Production needs the `20261018000000_session_persistent` migration applied before the new server code runs. `SESSION_SHORT_TTL_HOURS` and `SESSION_MAX_AGE_DAYS` are optional (defaults 12 and 90).
