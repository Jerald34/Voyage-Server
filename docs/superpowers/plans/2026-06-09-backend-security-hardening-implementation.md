# Backend Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every public HTTP endpoint is rate-limited, every external request value is strictly validated and contextually sanitized, and API keys and service-account credentials are never exposed through clients, logs, persistent URLs, or predictable temporary files.

**Architecture:** Add a centralized rate-limiter module with a shared Redis store in production, a baseline policy for every request, and tighter policies for abuse-sensitive public routes. Keep validation at route boundaries with strict Zod schemas for `body`, `params`, and `query`; normalize ordinary text before persistence and escape values only when rendering HTML. Consolidate secret access through validated configuration, redact provider errors, replace key-bearing photo URLs with authenticated server-side byte fetches, and manage temporary Google credentials with unique paths and explicit cleanup.

**Tech Stack:** Node.js 22+, TypeScript, Express 5, `express-rate-limit`, Redis, Zod 4, Cloudinary, Google Auth Library, Vitest, Supertest.

**Source audit:** Live review performed June 9, 2026 against `Voyage-Server`.

---

## Scope And Decisions

### Included

- A baseline rate limit for every HTTP request, including authenticated routes.
- Tighter public-route policies for authentication, token checks, public shares, reviews, invitation lookup, and the photo proxy.
- A shared Redis-backed counter store in production.
- Removal of the custom in-memory public-share token bucket.
- Strict request schemas that reject unknown object keys.
- Length, format, and normalization constraints for all public inputs.
- UUID/token validation for route parameters before service or Prisma calls.
- HTML escaping for all user-controlled email-template values.
- API-key configuration validation, redaction, and server-only transport.
- Removal of one-time verification, reset, invitation, and review URLs from fallback logs.
- Unique temporary Google credential files with cleanup.
- Google photo caching without putting the Maps API key in a URL.
- Security regression tests and deployment documentation.

### Excluded

- Redesigning authentication or authorization.
- Applying HTML sanitization to plain-text database fields. Escaping belongs at the HTML output boundary.
- Replacing Redis with a custom database rate-limit table.
- Rotating production secrets. Rotation is an operational follow-up after deployment.
- Fixing the existing unrelated TypeScript errors in `src/modules/agent/agentRepository.ts:136` and `:149`. Those errors must be resolved in a separate commit before the final build gate can be considered green.

### Rejected Alternatives

1. **One in-memory global limiter only:** simple, but counters reset on restart and do not coordinate across replicas.
2. **Sanitize every string before persistence:** corrupts legitimate names and content, and does not make values safe for every output context.
3. **Allow unknown Zod fields and rely on TypeScript:** TypeScript does not validate runtime HTTP input, while Zod's default object behavior silently strips unknown keys.

---

## Rate-Limit Policy

All limits return HTTP `429` with:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later."
  }
}
```

| Policy | Routes | Key | Window | Maximum |
|---|---|---:|---:|---:|
| Baseline | Every request | Client IP | 15 minutes | 300 |
| Health | `GET /health` | Client IP | 1 minute | 120 |
| Login | `POST /auth/login` | Client IP + normalized email hash | 15 minutes | 10 |
| Registration | `POST /auth/register` | Client IP | 1 hour | 5 |
| Email operations | Email check, verification request/confirm, password reset request/confirm | Client IP | 1 hour | 5 request / 20 confirm |
| OAuth | Google/Apple start and callback | Client IP | 15 minutes | 20 |
| Invitation lookup | `GET /invitations/lookup` | Client IP | 15 minutes | 30 |
| Public share reads | `GET /shared/:token`, comments read | Client IP + token hash | 1 minute | 60 |
| Public share writes | Comment and rating writes | Client IP + token hash | 1 minute | 10 |
| Review endpoints | Review check and submit | Client IP + token hash | 1 hour | 30 check / 10 submit |
| Photo proxy | `GET /images/place-photo` | Client IP | 1 minute | 60 |

The key functions must hash emails and public tokens with SHA-256 before using them in Redis keys. Raw email addresses, invitation tokens, share tokens, review tokens, OAuth codes, and API keys must never appear in limiter keys or logs.

---

## File Structure

### New Files

- `src/http/rateLimiters.ts` - limiter factory, Redis store setup, safe key generation, and consistent 429 response.
- `src/http/requestSchemas.ts` - reusable strict schemas for UUID parameters, opaque tokens, pagination, and normalized bounded text.
- `src/utils/html.ts` - minimal HTML text/attribute escaping helpers.
- `src/utils/redaction.ts` - secret-key and credential redaction for URLs, messages, and provider errors.
- `tests/rateLimiters.test.ts` - unit tests for policies, keys, headers, and store selection.
- `tests/requestValidation.test.ts` - route-boundary validation regression tests.
- `tests/emailSecurity.test.ts` - HTML-injection regression tests.
- `tests/secretHandling.test.ts` - redaction and key-transport regression tests.
- `docs/security/backend-security-controls.md` - final control inventory and deployment requirements.

### Modified Files

- `package.json`, `package-lock.json` - add `redis` and `rate-limit-redis`.
- `src/config/env.ts` - add limiter configuration and validate production secrets consistently.
- `src/app.ts` - mount baseline and route-specific limiters in the correct order.
- `src/modules/shares/publicShareRoutes.ts` - remove the process-local token bucket and validate token params.
- `src/modules/auth/authRoutes.ts`, `src/modules/auth/authSchemas.ts` - centralize strict schemas and validate OAuth input.
- `src/modules/agencies/invitationRoutes.ts` - strict lookup/accept schemas.
- `src/modules/agencies/agencyRoutes.ts`, `src/modules/agencies/agencySchemas.ts` - strict body and UUID validation.
- `src/modules/agencies/teamRoutes.ts`, `src/modules/agencies/teamSchemas.ts` - validate ownership transfer and route params.
- `src/modules/admin/adminRoutes.ts` - validate status filters and IDs.
- `src/modules/images/imageRoutes.ts`, `src/modules/images/imageSchemas.ts` - strict photo query and image ID validation.
- `src/modules/personal/personalRoutes.ts` - bounded strict schemas and UUID params.
- `src/modules/reviews/reviewRoutes.ts`, `src/modules/reviews/reviewSchemas.ts` - strict token and body validation.
- `src/modules/shares/shareRoutes.ts`, `src/modules/shares/shareSchemas.ts` - strict IDs, queries, and bodies.
- `src/modules/agent/agentController.ts`, `src/modules/agent/agentSchemas.ts` - validate IDs, cursor, pagination, and bodies.
- `src/modules/itineraries/itineraryRoutes.ts`, `src/modules/ratedHistory/ratedHistorySchemas.ts` - strict UUID params.
- `src/modules/support/supportSchemas.ts` - strict request objects and trimmed bounded text.
- `src/services/email.ts` - use validated Resend config and escape HTML interpolations.
- `src/services/cloudinary.ts` - add buffer-based place-photo upload.
- `src/services/maps/googleMaps.ts` - expose authenticated photo-byte retrieval without key-bearing URLs.
- `src/modules/agent/tools/placeSnapshotEnrichment.ts` - cache fetched bytes rather than a secret-bearing URL.
- `src/config/googleCredentials.ts`, `src/server.ts` - unique credential directory and cleanup lifecycle.
- `src/http/errors.ts` - redact unknown errors before logging.
- Existing route/service tests - update expected validation behavior.

---

## Phase 1: Establish A Clean Security Test Harness

### Task 1: Add Security Configuration And Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/env.ts`
- Test: `tests/routes.test.ts`

- [ ] **Step 1: Write failing environment tests**

Add tests asserting:

```ts
expect(loadEnv({
  NODE_ENV: "production",
  RATE_LIMIT_REDIS_URL: ""
})).toThrow(/RATE_LIMIT_REDIS_URL/);

expect(loadEnv({
  NODE_ENV: "production",
  RESEND_API_KEY: "secret"
}).RESEND_API_KEY).toBe("secret");
```

Refactor `env.ts` only as much as necessary to export a testable `parseEnv(source)` function while preserving `export const env = parseEnv(process.env)`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- tests/routes.test.ts
```

Expected: FAIL because `RATE_LIMIT_REDIS_URL` is not defined or production validation does not reject its absence.

- [ ] **Step 3: Install the shared-store dependencies**

Run:

```powershell
npm.cmd install redis rate-limit-redis
```

- [ ] **Step 4: Add typed limiter configuration**

Add these fields to `envSchema`:

```ts
RATE_LIMIT_REDIS_URL: z.string().trim().default(""),
RATE_LIMIT_PREFIX: z.string().trim().min(1).default("voyage:rate-limit:"),
RATE_LIMIT_BASELINE_MAX: z.coerce.number().int().positive().default(300)
```

In production, require `RATE_LIMIT_REDIS_URL`. Do not print the URL in the boot error because it can contain credentials.

- [ ] **Step 5: Run the focused test**

Run:

```powershell
npm.cmd test -- tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/config/env.ts tests/routes.test.ts
git commit -m "chore(security): configure shared rate limiting"
```

---

## Phase 2: Rate-Limit Every Public Surface

### Task 2: Build The Central Rate-Limiter Factory

**Files:**
- Create: `src/http/rateLimiters.ts`
- Create: `tests/rateLimiters.test.ts`

- [ ] **Step 1: Write failing factory tests**

Cover:

```ts
it("returns the standard error body after the threshold");
it("uses hashed token material in keys");
it("never includes raw email or token values in keys");
it("uses a Redis store when RATE_LIMIT_REDIS_URL is configured");
it("creates isolated memory stores in tests");
```

Use dependency injection for the Redis client/store so unit tests do not require a running Redis instance.

- [ ] **Step 2: Run the tests and verify failure**

```powershell
npm.cmd test -- tests/rateLimiters.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement safe keys and limiter creation**

The module must expose:

```ts
export type RateLimiterSet = {
  baseline: RequestHandler;
  health: RequestHandler;
  login: RequestHandler;
  registration: RequestHandler;
  emailRequest: RequestHandler;
  tokenConfirm: RequestHandler;
  oauth: RequestHandler;
  invitationLookup: RequestHandler;
  publicShareRead: RequestHandler;
  publicShareWrite: RequestHandler;
  reviewCheck: RequestHandler;
  reviewSubmit: RequestHandler;
  photoProxy: RequestHandler;
};

export function hashRateLimitKey(value: string): string;
export function createRateLimiters(options?: {
  storeFactory?: (prefix: string) => Store | undefined;
}): RateLimiterSet;
```

Requirements:

- Use `standardHeaders: true` and `legacyHeaders: false`.
- Use `skipSuccessfulRequests: false`; attempted abuse must count even when validation fails.
- Use `request.ip` plus hashed route-specific material where defined.
- Never trust `X-Forwarded-For` directly; continue relying on Express `trust proxy`.
- Use a unique key prefix per policy.
- On Redis errors, log a redacted operational error and fail closed for abuse-sensitive routes. Do not silently disable rate limiting.

- [ ] **Step 4: Run tests**

```powershell
npm.cmd test -- tests/rateLimiters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/http/rateLimiters.ts tests/rateLimiters.test.ts
git commit -m "feat(security): centralize rate limiter policies"
```

### Task 3: Mount Baseline And Sensitive Route Limiters

**Files:**
- Modify: `src/app.ts`
- Modify: `src/modules/shares/publicShareRoutes.ts`
- Modify: `tests/securityHardening.test.ts`

- [ ] **Step 1: Expand failing integration tests**

Add table-driven tests proving `429` coverage for:

```ts
[
  ["POST", "/auth/register"],
  ["POST", "/auth/login"],
  ["POST", "/auth/email/verification/request"],
  ["POST", "/auth/password/reset/request"],
  ["GET", "/invitations/lookup?token=opaque-test-token"],
  ["GET", "/shared/opaque-test-token"],
  ["POST", "/shared/opaque-test-token/comments"],
  ["GET", "/reviews/opaque-test-token/check"],
  ["POST", "/reviews/opaque-test-token/submit"],
  ["GET", "/images/place-photo?name=places/test/photos/test"]
]
```

Also assert that:

- `/health` returns rate-limit headers.
- A fresh `createApp()` instance does not inherit counters from another test app.
- Public-share write limits apply across both comment and rating routes when the same policy key is used.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/securityHardening.test.ts
```

Expected: FAIL on previously unprotected routes.

- [ ] **Step 3: Mount limiters before route handlers**

In `createApp()`:

1. Set `trust proxy`.
2. Mount security headers and request logging.
3. Mount the baseline limiter.
4. Mount the health-specific limiter on `/health`.
5. Mount bounded `express.json({ limit: "1mb" })` and
   `express.urlencoded({ extended: false, limit: "32kb" })` parsers.
6. Mount tighter route-specific limiters. Body-dependent key functions, such
   as normalized login email hashing, must run after parsing.
7. Mount cookie parsing, authentication attachment, and routers.

Do not place a limiter after its corresponding router.

- [ ] **Step 4: Remove the custom public-share map**

Delete:

```ts
const rateBuckets = new Map<string, number[]>();
function checkRateLimit(token: string) { /* ... */ }
```

and remove its call from the rating route. All public-share limits must come from `rateLimiters.ts`.

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- tests/securityHardening.test.ts tests/rateLimiters.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app.ts src/modules/shares/publicShareRoutes.ts tests/securityHardening.test.ts
git commit -m "feat(security): rate limit all public endpoints"
```

---

## Phase 3: Strict Request Validation

### Task 4: Add Reusable Strict Request Schemas

**Files:**
- Create: `src/http/requestSchemas.ts`
- Create: `tests/requestValidation.test.ts`

- [ ] **Step 1: Write failing schema tests**

Test:

```ts
expect(uuidParamSchema.parse({ id: validUuid })).toEqual({ id: validUuid });
expect(() => uuidParamSchema.parse({ id: "not-a-uuid" })).toThrow();
expect(() => uuidParamSchema.parse({ id: validUuid, extra: true })).toThrow();
expect(() => opaqueTokenSchema.parse("x".repeat(513))).toThrow();
expect(normalizedNameSchema.parse("  Alice  ")).toBe("Alice");
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/requestValidation.test.ts
```

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement reusable primitives**

Export:

```ts
export const uuidSchema = z.string().uuid();
export const opaqueTokenSchema = z.string().trim().min(16).max(512);
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(5000);
export const paginationQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
}).strict();
```

Create a small helper for strict parameter objects:

```ts
export function idParamsSchema<const T extends string>(...names: T[]) {
  return z.object(
    Object.fromEntries(names.map((name) => [name, uuidSchema])) as Record<T, typeof uuidSchema>
  ).strict();
}
```

- [ ] **Step 4: Run tests**

```powershell
npm.cmd test -- tests/requestValidation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/http/requestSchemas.ts tests/requestValidation.test.ts
git commit -m "feat(security): add strict request schema primitives"
```

### Task 5: Make Public Authentication And Token Routes Strict

**Files:**
- Modify: `src/modules/auth/authSchemas.ts`
- Modify: `src/modules/auth/authRoutes.ts`
- Modify: `src/modules/agencies/invitationRoutes.ts`
- Modify: `src/modules/reviews/reviewSchemas.ts`
- Modify: `src/modules/reviews/reviewRoutes.ts`
- Modify: `src/modules/shares/shareSchemas.ts`
- Modify: `src/modules/shares/publicShareRoutes.ts`
- Test: `tests/securityHardening.test.ts`
- Test: `tests/routes.test.ts`

- [ ] **Step 1: Add failing public-input tests**

Each public route must reject:

- Unknown body keys.
- Empty or oversized tokens.
- Duplicate query arrays where a scalar is expected.
- Over-length names/comments.
- Whitespace-only required text.
- Invalid email addresses after trimming and lowercasing.
- OAuth callbacks with oversized `code`, `state`, or `id_token`.
- Apple `form_post` callbacks encoded as `application/x-www-form-urlencoded`.

Example:

```ts
const response = await request(app)
  .post("/auth/register")
  .send({
    email: "user@example.com",
    password: "valid-password",
    displayName: "User",
    role: "SUPER_ADMIN"
  });

expect(response.status).toBe(400);
expect(response.body.error.code).toBe("VALIDATION_ERROR");
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/securityHardening.test.ts tests/routes.test.ts
```

Expected: FAIL because unknown properties are currently stripped.

- [ ] **Step 3: Move inline schemas into module schema files**

Use `.strict()` on request object schemas:

```ts
export const verificationRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254)
}).strict();
```

Define strict schemas for:

- Google callback query.
- Apple callback form body.
- Invitation lookup query and accept body.
- Public share token params.
- Review token params.

Do not apply `.strict()` blindly to response schemas or model-provider/tool output schemas.

- [ ] **Step 4: Parse all request surfaces before service calls**

Replace raw reads such as:

```ts
const tripToken = String(request.params.tripToken);
```

with:

```ts
const { tripToken } = tripTokenParamsSchema.parse(request.params);
```

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- tests/securityHardening.test.ts tests/routes.test.ts tests/invitationService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/auth src/modules/agencies/invitationRoutes.ts src/modules/reviews src/modules/shares tests/securityHardening.test.ts tests/routes.test.ts
git commit -m "feat(security): validate public request inputs strictly"
```

### Task 6: Make Authenticated Route Boundaries Strict

**Files:**
- Modify: route/schema files listed in the File Structure section
- Test: `tests/routes.test.ts`
- Test: `tests/ratedHistoryRoutes.test.ts`
- Test: `tests/agentRoutes.test.ts`

- [ ] **Step 1: Add failing regression tests**

At minimum cover the known gaps:

```ts
it("rejects transfer ownership without a UUID targetMembershipId");
it("rejects agency deletion with unknown body keys");
it("rejects invalid admin agency/report IDs before service calls");
it("rejects invalid image IDs before storage calls");
it("rejects unbounded personal itinerary titles and summaries");
it("rejects invalid agent thread/run IDs");
it("rejects invalid share and comment IDs");
it("rejects unknown query keys on paginated endpoints");
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/routes.test.ts tests/ratedHistoryRoutes.test.ts tests/agentRoutes.test.ts
```

Expected: FAIL on raw casts and unbounded fields.

- [ ] **Step 3: Add strict route-specific schemas**

Rules:

- IDs are UUIDs unless the domain explicitly uses an opaque token.
- Required text is trimmed and bounded.
- Optional text treats `""` consistently: either reject it or preprocess it to `null`; document the choice per field.
- Dates use `z.coerce.date()` or an ISO datetime schema and enforce cross-field ordering in `.superRefine()`.
- `createShareInputSchema.expiresAt` accepts only a valid future ISO datetime;
  invalid values must return `400` before `shareRepository` calls
  `new Date(input.expiresAt)`.
- Query filters use enums, not unchecked strings.
- Every request object schema ends with `.strict()`.

Replace:

```ts
const { targetMembershipId } = request.body as { targetMembershipId: string };
```

with:

```ts
const { targetMembershipId } = transferOwnershipSchema.parse(request.body);
```

- [ ] **Step 4: Ensure validation happens before authorization-dependent repository work**

The order for route handlers is:

1. Parse `params`, `query`, and `body`.
2. Enforce authentication/agency authorization.
3. Call services.

Authentication middleware may remain router-level, but malformed IDs must not reach Prisma.

- [ ] **Step 5: Run the affected tests**

```powershell
npm.cmd test -- tests/routes.test.ts tests/ratedHistoryRoutes.test.ts tests/agentRoutes.test.ts tests/teamService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/modules tests/routes.test.ts tests/ratedHistoryRoutes.test.ts tests/agentRoutes.test.ts tests/teamService.test.ts
git commit -m "feat(security): enforce strict authenticated route validation"
```

---

## Phase 4: Context-Safe Output Sanitization

### Task 7: Escape User-Controlled Email HTML

**Files:**
- Create: `src/utils/html.ts`
- Modify: `src/services/email.ts`
- Create: `tests/emailSecurity.test.ts`

- [ ] **Step 1: Write failing injection tests**

For every email template, pass values containing:

```ts
const malicious = `<img src=x onerror="alert(1)">&"'`;
```

Assert:

```ts
expect(renderedHtml).not.toContain("<img");
expect(renderedHtml).toContain("&lt;img");
expect(renderedHtml).toContain("&amp;");
expect(renderedHtml).toContain("&quot;");
expect(renderedHtml).toContain("&#39;");
```

Cover `displayName`, `clientName`, `tripTitle`, `inviterName`, and `agencyName`.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/emailSecurity.test.ts
```

Expected: FAIL because raw values are currently interpolated.

- [ ] **Step 3: Implement output-context escaping**

Create:

```ts
export function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

URLs must be constructed from trusted configured origins plus generated opaque tokens. If a URL ever accepts user input, validate it with `new URL()` and allow only `https:` in production before applying attribute escaping.

- [ ] **Step 4: Escape every dynamic HTML value**

Keep plain-text email output unescaped. HTML escaping must happen only in HTML templates.

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- tests/emailSecurity.test.ts tests/authService.test.ts tests/invitationService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/utils/html.ts src/services/email.ts tests/emailSecurity.test.ts
git commit -m "fix(security): escape user content in email HTML"
```

---

## Phase 5: Secure API-Key And Credential Handling

### Task 8: Centralize Secret Access And Redact Errors

**Files:**
- Create: `src/utils/redaction.ts`
- Modify: `src/config/env.ts`
- Modify: `src/services/email.ts`
- Modify: `src/http/errors.ts`
- Modify: provider service error paths
- Create: `tests/secretHandling.test.ts`

- [ ] **Step 1: Write failing redaction tests**

Cover:

```ts
expect(redactSecrets(
  "https://example.com/path?key=abc123&token=def456"
)).toBe("https://example.com/path?key=[REDACTED]&token=[REDACTED]");

expect(redactSecrets(
  "Authorization: Bearer abc123"
)).not.toContain("abc123");
```

Also simulate a provider error containing each configured test secret and assert neither the API response nor captured `console.error` contains the secret.

Capture `console.info` while email delivery is unconfigured and assert that
verification, password-reset, invitation, and trip-review tokens/URLs are not
logged.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/secretHandling.test.ts
```

Expected: FAIL because redaction is not centralized.

- [ ] **Step 3: Implement redaction**

Redact case-insensitive names:

```ts
[
  "key",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "id_token",
  "client_secret",
  "password",
  "authorization"
]
```

The helper must:

- Redact URL query values.
- Redact bearer/basic authorization values.
- Redact exact configured secret values when present.
- Preserve enough provider status/code information for diagnostics.

- [ ] **Step 4: Use validated env values exclusively**

Replace:

```ts
process.env.RESEND_API_KEY
```

with:

```ts
env.RESEND_API_KEY
```

Replace fallback messages such as:

```ts
`Password reset email for ${payload.to}: ${payload.resetUrl}`
```

with metadata-only messages:

```ts
`Password reset email delivery skipped because no provider is configured.`
```

Do not log recipient email addresses or one-time URLs. In tests and local
development, retrieve tokens from the test repository or mocked mail sender
rather than console output.

Search production source for direct secret access:

```powershell
rg -n "process\.env\.(.*KEY|.*SECRET|.*PASSWORD|.*TOKEN)" src
```

Expected: only configuration/bootstrap compatibility code remains.

- [ ] **Step 5: Redact unknown errors before logging**

In `errorHandler`, preserve the generic client response and send a redacted representation to `console.error`. Do not serialize full request objects.

- [ ] **Step 6: Run tests**

```powershell
npm.cmd test -- tests/secretHandling.test.ts tests/modelProvider.test.ts tests/mapsProvider.test.ts tests/webSearchProvider.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/config/env.ts src/services src/http/errors.ts src/utils/redaction.ts tests/secretHandling.test.ts
git commit -m "fix(security): centralize and redact application secrets"
```

### Task 9: Make Google Credential Files Unique And Short-Lived

**Files:**
- Modify: `src/config/googleCredentials.ts`
- Modify: `src/server.ts`
- Modify: `tests/googleCredentials.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Test:

- Two calls without an explicit path create different directories.
- The credential file mode is owner-read/write only where supported.
- Calling the returned cleanup removes the generated file and directory.
- Existing operator-provided `GOOGLE_APPLICATION_CREDENTIALS` files are never deleted.
- Cleanup is idempotent.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/googleCredentials.test.ts
```

Expected: FAIL because the default path is deterministic and no cleanup handle exists.

- [ ] **Step 3: Return a credential lifecycle object**

Change the API to:

```ts
export type PreparedGoogleCredentials = {
  path: string;
  generated: boolean;
  cleanup(): void;
};

export function prepareGoogleApplicationCredentials(
  options?: PrepareGoogleCredentialsOptions
): PreparedGoogleCredentials | null;
```

For generated credentials:

- Use `mkdtempSync(join(tmpdir(), "voyage-google-creds-"))`.
- Write `application-credentials.json` with mode `0o600`.
- Keep the directory path private to the process.
- Remove the file and directory in `cleanup()`.

- [ ] **Step 4: Register cleanup in server bootstrap**

Register idempotent cleanup for:

```ts
process.once("exit", cleanup);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
```

The shutdown handler must stop accepting new requests, close the HTTP server, cleanup generated credentials, then exit. It must not delete an operator-provided credential file.

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- tests/googleCredentials.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/config/googleCredentials.ts src/server.ts tests/googleCredentials.test.ts
git commit -m "fix(security): clean up temporary Google credentials"
```

### Task 10: Remove Maps API Keys From Photo URLs

**Files:**
- Modify: `src/services/maps/googleMaps.ts`
- Modify: `src/services/cloudinary.ts`
- Modify: `src/modules/images/imageRoutes.ts`
- Modify: `src/modules/agent/tools/placeSnapshotEnrichment.ts`
- Test: `tests/mapsProvider.test.ts`
- Test: `tests/imageService.test.ts`
- Test: `tests/secretHandling.test.ts`

- [ ] **Step 1: Write failing key-leak tests**

Assert:

- Photo retrieval sends `X-Goog-Api-Key`.
- Cloudinary receives a `Buffer`, never a Google URL containing `?key=`.
- Persisted snapshot URLs contain only the public API proxy or Cloudinary URL.
- Captured logs and thrown errors do not contain the test Maps key.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- tests/mapsProvider.test.ts tests/imageService.test.ts tests/secretHandling.test.ts
```

Expected: FAIL because lazy Cloudinary caching currently creates a key-bearing URL.

- [ ] **Step 3: Add authenticated photo-byte fetching**

Expose a method shaped like:

```ts
async function fetchPlacePhoto(
  photoName: string,
  dimensions: { width: number; height: number }
): Promise<{ bytes: Buffer; contentType: string }>;
```

It must:

- Validate `photoName` against the existing strict resource-name pattern.
- Send the key only in `X-Goog-Api-Key`.
- Bound response size before buffering.
- Validate `content-type` begins with `image/`.
- Use a timeout/abort signal.

- [ ] **Step 4: Add buffer-based Cloudinary upload**

Implement:

```ts
export async function uploadPlacePhotoBuffer(
  buffer: Buffer,
  placeId: string
): Promise<CloudinaryUploadResult>;
```

Use `cloudinary.uploader.upload_stream` with the existing folder, public ID normalization, transformations, and `overwrite: false`.

- [ ] **Step 5: Reuse the byte-fetch path**

The public proxy may stream directly from Google, but Cloudinary caching must receive bytes already fetched by the server. Do not build any Google URL with an API key query parameter.

- [ ] **Step 6: Run tests**

```powershell
npm.cmd test -- tests/mapsProvider.test.ts tests/imageService.test.ts tests/secretHandling.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/maps/googleMaps.ts src/services/cloudinary.ts src/modules/images/imageRoutes.ts src/modules/agent/tools/placeSnapshotEnrichment.ts tests/mapsProvider.test.ts tests/imageService.test.ts tests/secretHandling.test.ts
git commit -m "fix(security): keep Maps keys out of photo URLs"
```

---

## Phase 6: Documentation And Final Verification

### Task 11: Document Controls And Deployment Requirements

**Files:**
- Create: `docs/security/backend-security-controls.md`
- Modify: deployment environment documentation if present

- [ ] **Step 1: Document the control matrix**

Include:

- Public endpoint and limiter policy table.
- Redis requirement and expected `RATE_LIMIT_REDIS_URL` secret format.
- Proxy trust assumption: exactly one trusted reverse proxy.
- Request validation rules and `VALIDATION_ERROR` response contract.
- Email HTML escaping boundary.
- Secret redaction behavior.
- Google credential lifecycle.
- Maps/Cloudinary photo key flow.
- Operational secret rotation checklist.

- [ ] **Step 2: Add deployment checks**

Document:

```powershell
npm.cmd test --
npm.cmd run build
```

Production smoke checks:

- Repeated public requests return `429` and standard headers.
- Two application replicas share counters.
- Logs contain no raw token, email limiter key, API key, or credential JSON.
- A graceful shutdown removes generated Google credential files.

- [ ] **Step 3: Commit**

```powershell
git add docs/security/backend-security-controls.md
git commit -m "docs(security): document backend hardening controls"
```

### Task 12: Run The Full Security Gate

**Files:**
- No planned production changes

- [ ] **Step 1: Check formatting and merge artifacts**

```powershell
git diff --check
rg -n "^(<<<<<<<|=======|>>>>>>>)" src tests docs package.json package-lock.json
```

Expected: no output.

- [ ] **Step 2: Run focused security tests**

```powershell
npm.cmd test -- tests/rateLimiters.test.ts tests/requestValidation.test.ts tests/emailSecurity.test.ts tests/secretHandling.test.ts tests/securityHardening.test.ts tests/googleCredentials.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run the full suite**

```powershell
npm.cmd test --
```

Expected: all test files pass.

- [ ] **Step 4: Run the TypeScript build**

```powershell
npm.cmd run build
```

Expected: exit code `0`.

If the known nullable `tripId` errors at `src/modules/agent/agentRepository.ts:136` and `:149` still exist, stop and report the build as blocked by pre-existing debt. Do not hide or fold that unrelated fix into a security commit without explicit scope approval.

- [ ] **Step 5: Inspect the final diff**

```powershell
git status --short
git diff --stat
git diff -- src tests docs package.json package-lock.json
```

Confirm:

- No API key values or credentials were added.
- No public route lacks baseline rate limiting.
- No request schema silently strips unknown fields.
- No email template interpolates unescaped user content.
- No Google photo URL contains a key query parameter.

- [ ] **Step 6: Final verification commit if needed**

Only create a final commit when verification required documentation or test-only adjustments:

```powershell
git add tests docs
git commit -m "test(security): complete backend hardening regression coverage"
```

---

## Execution Order And Parallelization

The critical path is:

1. Task 1.
2. Tasks 2 and 4 in parallel.
3. Task 3 after Task 2.
4. Tasks 5 and 6 after Task 4.
5. Tasks 7, 8, and 9 in parallel after request validation stabilizes.
6. Task 10 after Task 8.
7. Tasks 11 and 12 sequentially.

Recommended model assignment:

| Work | Model | Reason |
|---|---|---|
| Route inventory, repetitive strict schema conversion, documentation | `gpt-5.4-mini` | Bounded and mechanical with explicit tests |
| Limiter architecture, Redis failure behavior, provider secret redaction | `gpt-5.4` | Cross-cutting runtime and security reasoning |
| Final security review or unexpected integration failures | `gpt-5.5` | Highest-risk cross-module reasoning |

Each worker must receive a disjoint write scope and must not revert the existing uncommitted migration:

```text
prisma/migrations/20260602144023_admin_dashboard_usage_and_reports/migration.sql
```

---

## Definition Of Done

- Every HTTP request receives a rate-limit policy, with tighter public-route policies where documented.
- Production rate limits use shared Redis counters.
- Raw tokens, emails, API keys, and credentials never appear in rate-limit keys or logs.
- Public and authenticated route boundaries validate `params`, `query`, and `body`.
- Unknown request object fields return `400 VALIDATION_ERROR`.
- User-controlled values are escaped before HTML email rendering.
- Provider keys come from validated configuration and are redacted from errors.
- Generated Google service-account files are unique, permission-restricted, and removed on shutdown.
- Google Maps keys never enter photo URLs passed to Cloudinary or persisted in application data.
- Focused security tests and the full suite pass.
- `npm.cmd run build` exits successfully, or the known unrelated build blocker is reported separately without a false completion claim.
