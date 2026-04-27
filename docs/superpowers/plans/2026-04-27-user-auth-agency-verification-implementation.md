# User Auth, Agency Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for PostgreSQL + Prisma users, email verification, Google/Apple identity links, admin agency verification, and private image storage metadata.

**Architecture:** Express owns HTTP routing and middleware. Prisma owns persistence. Small service modules own auth, email verification, agencies, admin review, and image permissions so route handlers remain thin and testable.

**Tech Stack:** Node, TypeScript, Express, Prisma, PostgreSQL, Zod, secure HTTP-only cookies, bcryptjs, jose, AWS S3-compatible presigned URLs, Vitest, Supertest.

---

## File Structure

- Create `tsconfig.json`: TypeScript compiler settings for server source and tests.
- Modify `package.json`: replace Mongoose direction with Prisma scripts and add test/build scripts.
- Create `.env.example`: required Railway/Postgres/storage/OAuth/email environment variables.
- Create `prisma/schema.prisma`: PostgreSQL schema for users, provider accounts, sessions, agencies, memberships, image assets, admin audits, and verification tokens.
- Create `prisma/seed.ts`: admin bootstrap from `ADMIN_EMAILS`.
- Create `src/config/env.ts`: parse environment config.
- Create `src/db/prisma.ts`: singleton Prisma client.
- Create `src/http/errors.ts`: API error class and error middleware.
- Create `src/http/cookies.ts`: auth cookie helpers.
- Create `src/http/authMiddleware.ts`: session authentication and admin guard.
- Create `src/app.ts`: Express app composition.
- Create `src/server.ts`: Railway-friendly server entrypoint.
- Create `src/modules/auth/authSchemas.ts`: auth request validation.
- Create `src/modules/auth/authService.ts`: registration, login, session, email verification, OAuth upsert/linking.
- Create `src/modules/auth/authRoutes.ts`: auth endpoints.
- Create `src/modules/agencies/agencySchemas.ts`: agency request validation.
- Create `src/modules/agencies/agencyService.ts`: agency application and membership gates.
- Create `src/modules/agencies/agencyRoutes.ts`: user agency endpoints.
- Create `src/modules/admin/adminRoutes.ts`: admin agency review endpoints.
- Create `src/modules/images/imageSchemas.ts`: image upload/read validation.
- Create `src/modules/images/imageService.ts`: image permission checks and presigned URL coordination.
- Create `src/modules/images/imageRoutes.ts`: image endpoints.
- Create `src/services/password.ts`: password hashing and verification.
- Create `src/services/tokens.ts`: random token creation and hashing.
- Create `src/services/email.ts`: verification email sender abstraction with Resend-ready implementation.
- Create `src/services/oauth.ts`: Google/Apple callback verification interfaces.
- Create `src/services/storage.ts`: S3-compatible presigned URL helper.
- Create `src/services/capabilities.ts`: current-user capability calculation.
- Create `tests/authService.test.ts`: email normalization, duplicate email, login, verification token behavior.
- Create `tests/agencyService.test.ts`: unverified agency block, pending agency creation, admin review.
- Create `tests/imageService.test.ts`: MIME/size rules and image-purpose permission gates.
- Create `tests/routes.test.ts`: basic Express endpoint coverage with mocked services.

## Task 1: Project Tooling and Prisma Schema

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Install dependencies**

Run:

```powershell
npm install @prisma/client bcryptjs cookie-parser jose @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D prisma vitest supertest tsx @types/bcryptjs @types/cookie-parser @types/supertest
```

Expected: dependencies install without audit-blocking errors.

- [ ] **Step 2: Update scripts**

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc --noEmit",
    "start": "node dist/server.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 3: Add TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "prisma/**/*.ts"]
}
```

- [ ] **Step 4: Add environment template**

Create `.env.example` with:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/voyage
APP_ORIGIN=http://localhost:3000
SESSION_COOKIE_NAME=voyage_session
SESSION_TTL_DAYS=30
PASSWORD_PEPPER=
ADMIN_EMAILS=admin@example.com
RESEND_API_KEY=
EMAIL_FROM=Voyage <no-reply@example.com>
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
APPLE_REDIRECT_URI=http://localhost:4000/auth/apple/callback
```

- [ ] **Step 5: Add Prisma schema**

Create `prisma/schema.prisma` containing enums and models from the approved design: `User`, `Session`, `AuthProviderAccount`, `EmailVerificationToken`, `Agency`, `AgencyMembership`, `ImageAsset`, and `AdminAuditEvent`.

- [ ] **Step 6: Generate Prisma client**

Run:

```powershell
npm run prisma:generate
```

Expected: Prisma client generated successfully.

- [ ] **Step 7: Verify tooling**

Run:

```powershell
npm run build
```

Expected: TypeScript reports only missing source errors until Task 2 creates source files.

- [ ] **Step 8: Commit**

Run:

```powershell
git add package.json package-lock.json tsconfig.json .env.example prisma/schema.prisma
git commit -m "chore: add prisma backend foundation"
```

## Task 2: Core App, Errors, Config, and Sessions

**Files:**
- Create: `src/config/env.ts`
- Create: `src/db/prisma.ts`
- Create: `src/http/errors.ts`
- Create: `src/http/cookies.ts`
- Create: `src/http/authMiddleware.ts`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/services/capabilities.ts`

- [ ] **Step 1: Write route smoke test**

Create `tests/routes.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("app routes", () => {
  it("returns health status", async () => {
    const app = createApp();

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test -- tests/routes.test.ts
```

Expected: FAIL because `src/app` does not exist.

- [ ] **Step 3: Implement Express foundation**

Create app/config/db/error/session middleware files so `/health` passes, auth cookies are secure by environment, and `requireAuth` loads active sessions from Prisma.

- [ ] **Step 4: Run route test**

Run:

```powershell
npm test -- tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src tests/routes.test.ts
git commit -m "feat: add express server foundation"
```

## Task 3: Auth Service and Email Verification

**Files:**
- Create: `src/modules/auth/authSchemas.ts`
- Create: `src/modules/auth/authService.ts`
- Create: `src/modules/auth/authRoutes.ts`
- Create: `src/services/password.ts`
- Create: `src/services/tokens.ts`
- Create: `src/services/email.ts`
- Modify: `src/app.ts`
- Create: `tests/authService.test.ts`

- [ ] **Step 1: Write auth service tests**

Tests must cover:

- `normalizeEmail(" Test@Example.COM ")` returns `test@example.com`.
- registering an existing normalized email throws `EMAIL_ALREADY_USED`.
- login works before `emailVerifiedAt` is set.
- verification request stores a hashed token.
- confirming a verification token sets `emailVerifiedAt`.
- confirming a used token throws `INVALID_OR_EXPIRED_TOKEN`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/authService.test.ts
```

Expected: FAIL because auth service modules do not exist.

- [ ] **Step 3: Implement auth service**

Implement registration, login, session creation, current user serialization, email availability check, verification token request, and verification confirmation.

- [ ] **Step 4: Add auth routes**

Add:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/email/check`
- `POST /auth/email/verification/request`
- `POST /auth/email/verification/confirm`

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/authService.test.ts tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src tests/authService.test.ts tests/routes.test.ts
git commit -m "feat: add email auth and verification"
```

## Task 4: OAuth Identity Link Foundation

**Files:**
- Create: `src/services/oauth.ts`
- Modify: `src/modules/auth/authService.ts`
- Modify: `src/modules/auth/authRoutes.ts`
- Modify: `tests/authService.test.ts`

- [ ] **Step 1: Add OAuth service tests**

Tests must cover:

- Google verified email creates a verified user.
- Apple verified email creates a verified user.
- Provider account links to an existing normalized email.
- Existing `(provider, providerAccountId)` signs in the same user.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/authService.test.ts
```

Expected: FAIL because OAuth upsert/linking is not implemented.

- [ ] **Step 3: Implement OAuth service boundary**

Implement provider claim verification interfaces and auth-service upsert/linking logic. Keep external provider token exchange isolated in `src/services/oauth.ts` so tests can use verified mock claims without calling Google or Apple.

- [ ] **Step 4: Add OAuth routes**

Add:

- `GET /auth/google/start`
- `GET /auth/google/callback`
- `GET /auth/apple/start`
- `POST /auth/apple/callback`

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/authService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src tests/authService.test.ts
git commit -m "feat: add oauth identity linking"
```

## Task 5: Agency Registration and Admin Verification

**Files:**
- Create: `src/modules/agencies/agencySchemas.ts`
- Create: `src/modules/agencies/agencyService.ts`
- Create: `src/modules/agencies/agencyRoutes.ts`
- Create: `src/modules/admin/adminRoutes.ts`
- Modify: `src/app.ts`
- Create: `tests/agencyService.test.ts`

- [ ] **Step 1: Write agency service tests**

Tests must cover:

- unverified user cannot create an agency and receives `EMAIL_VERIFICATION_REQUIRED`.
- verified user creates `PENDING_REVIEW` agency and `OWNER` membership.
- non-admin cannot list pending agencies.
- admin can approve an agency and audit the decision.
- admin can reject an agency with a reason.
- admin can suspend an agency with a reason.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/agencyService.test.ts
```

Expected: FAIL because agency service modules do not exist.

- [ ] **Step 3: Implement agency service**

Implement agency creation, membership creation, pending agency listing, approval, rejection, suspension, and audit event writes.

- [ ] **Step 4: Add routes**

Add:

- `POST /agencies`
- `GET /agencies/me`
- `GET /admin/agencies/pending`
- `POST /admin/agencies/:agencyId/approve`
- `POST /admin/agencies/:agencyId/reject`
- `POST /admin/agencies/:agencyId/suspend`

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/agencyService.test.ts tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src tests/agencyService.test.ts tests/routes.test.ts
git commit -m "feat: add agency verification workflow"
```

## Task 6: Image Metadata and Presigned URL Services

**Files:**
- Create: `src/modules/images/imageSchemas.ts`
- Create: `src/modules/images/imageService.ts`
- Create: `src/modules/images/imageRoutes.ts`
- Create: `src/services/storage.ts`
- Modify: `src/app.ts`
- Create: `tests/imageService.test.ts`

- [ ] **Step 1: Write image service tests**

Tests must cover:

- SVG upload request is rejected.
- profile avatar over 2 MB is rejected.
- agency logo over 2 MB is rejected.
- trip itinerary image over 8 MB is rejected.
- signed-in user can request self avatar upload.
- unverified agency cannot request agency logo upload.
- verified agency owner/admin can request agency logo upload.
- verified agency member can request trip image upload when trip access check passes.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- tests/imageService.test.ts
```

Expected: FAIL because image modules do not exist.

- [ ] **Step 3: Implement image and storage service**

Implement MIME/size policy, object key generation, `ImageAsset` creation with `PENDING_UPLOAD`, upload URL generation, completion marking, and read URL generation after permission checks.

- [ ] **Step 4: Add image routes**

Add:

- `POST /images/upload-url`
- `POST /images/:imageId/complete`
- `GET /images/:imageId/url`

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/imageService.test.ts tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src tests/imageService.test.ts tests/routes.test.ts
git commit -m "feat: add private image upload workflow"
```

## Task 7: Admin Seed and Final Verification

**Files:**
- Create: `prisma/seed.ts`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write seed behavior**

Create `prisma/seed.ts` that reads `ADMIN_EMAILS`, normalizes each email, promotes matching users to `ADMIN`, and records `AdminAuditEvent` with action `USER_PROMOTED_TO_ADMIN`.

- [ ] **Step 2: Update README**

Document local setup:

- copy `.env.example` to `.env`,
- set `DATABASE_URL`,
- run `npm install`,
- run `npm run prisma:generate`,
- run `npm run prisma:migrate`,
- run `npm run prisma:seed`,
- run `npm run dev`.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run build
npm test
```

Expected: build and tests pass.

- [ ] **Step 4: Commit**

Run:

```powershell
git add prisma/seed.ts README.md package.json
git commit -m "chore: document backend setup"
```

## Self-Review

Spec coverage:

- PostgreSQL + Prisma is covered by Task 1.
- Email/password registration, duplicate checks, login before verification, and verification after sign-in are covered by Task 3.
- Google and Apple identity linking are covered by Task 4.
- Admin agency verification is covered by Task 5.
- Railway Bucket/S3-compatible image metadata and presigned URLs are covered by Task 6.
- Admin bootstrap is covered by Task 7.

The plan intentionally implements the auth/agency/image foundation only. It does not build agency portfolio trips or approval dashboards because those are separate specs already present in the repo.
