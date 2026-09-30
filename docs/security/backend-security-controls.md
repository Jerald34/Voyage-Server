# Backend Security Controls

This document inventories the security controls implemented in the Voyage backend and deployment requirements for production environments.

## 1. Rate-Limit Policy Matrix

All rate limiters return HTTP 429 with the following response body:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later."
  }
}
```

### Policy Configuration

| Policy | Routes | Key | Window | Maximum |
|---|---|---|---|---|
| Baseline | Every request | Client IP | 15 min | 300 |
| Health | `GET /health` | Client IP | 1 min | 120 |
| Login | `POST /auth/login` | Client IP + SHA-256(normalized email) | 15 min | 10 |
| Login spraying | `POST /auth/login` | Client IP (failed attempts only) | 15 min | 30 |
| Login account | `POST /auth/login` | SHA-256(normalized email), any IP (failed attempts only) | 1 hour | 30 |
| Registration | `POST /auth/register` | Client IP | 1 hour | 5 |
| Email operations | email check, verification request/confirm, password reset request/confirm | Client IP | 1 hour | 5 request / 20 confirm |
| OAuth | Google/Apple start + callback | Client IP | 15 min | 20 |
| Invitation lookup | `GET /invitations/lookup` | Client IP | 15 min | 30 |
| Public share reads | `GET /shared/:token`, comments read | Client IP + SHA-256(token) | 1 min | 60 |
| Public share writes | comment + rating writes | Client IP + SHA-256(token) | 1 min | 10 |
| Review endpoints | review check + submit | Client IP + SHA-256(token) | 1 hour | 30 check / 10 submit |
| Photo proxy | `GET /images/place-photo` | Client IP | 1 min | 60 |

### Authenticated Quotas

Keyed on the signed-in user (or agency), not the IP, so they hold across devices and networks. Anonymous requests skip them (auth rejects those later; the IP baseline still applies). They fail **open** on a store outage: the caller is authenticated and attributable, and a Redis blip should not take chat down.

| Policy | Routes | Key | Window | Maximum |
|---|---|---|---|---|
| Agent message burst | `POST /agencies/:agencyId/agent/threads/:id/messages` | User | 1 min | `RATE_LIMIT_AGENT_MESSAGES_PER_MINUTE` (10) |
| Agent message daily | same | User (successful requests only) | 24 hours | `RATE_LIMIT_AGENT_MESSAGES_PER_DAY` (200) |
| Agency agent daily | same | Agency, members only (successful requests only) | 24 hours | `RATE_LIMIT_AGENCY_AGENT_MESSAGES_PER_DAY` (1000) |
| Chat image upload | `POST /agencies/:agencyId/agent/threads/:id/images` | User | 1 hour | 30 |
| Image upload URL | `POST /images/upload-url` | User | 1 hour | 60 |
| Team invite | `POST /agencies/:agencyId/team` | User | 1 hour | 20 |
| Support report | `POST /support/reports` | User | 1 hour | 10 |
| Agency creation | `POST /agencies` | User | 24 hours | 5 |

The agency quota is only charged to members of that agency, so nobody can exhaust another agency's quota by posting to its URL.

### Rate Limiter Implementation

The limiter factory is located at `src/http/rateLimiters.ts` and implements the following behavior:

- **Header behavior**: Uses the IETF RateLimit header fields (`standardHeaders: "draft-8"`, `legacyHeaders: false`). Every response carries `RateLimit: "<policy>"; r=<remaining>; t=<seconds>` and `RateLimit-Policy: "<policy>"; q=<limit>; w=<window>; pk=:<partition>:`, one entry per policy that applied (e.g. baseline + route). 429 responses also carry `Retry-After`. CORS exposes `Retry-After`, `RateLimit` and `RateLimit-Policy` to the app origin.
- **Request tracking**: Counts every request by default; login spraying/account policies count failures only, and daily agent quotas count successes only.
- **Key prefix strategy**: Each policy uses a distinct key prefix for rate limit counters.
- **Secret hashing**: Sensitive values (email addresses, public tokens) are hashed with SHA-256 before being used in limiter keys. Raw emails, tokens, OAuth codes, and API keys never appear in rate limit keys.
- **Redis failure handling**: On Redis errors, the limiter logs a redacted operational error and fails closed for abuse-sensitive routes to prevent bypass attacks.

## 2. Redis Requirement

### Production Configuration

Production deployments require the `RATE_LIMIT_REDIS_URL` environment variable, validated at boot in `src/config/env.ts`. The process refuses to start without this variable when `NODE_ENV=production`.

**Security note**: The Redis URL is never printed in boot error messages because it may contain credentials.

### Related Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_REDIS_URL` | *(required in production)* | Redis connection URL for distributed rate limit counters |
| `RATE_LIMIT_PREFIX` | `voyage:rate-limit:` | Namespace prefix for all rate limit keys |
| `RATE_LIMIT_BASELINE_MAX` | `300` | Maximum baseline requests per 15 minutes per IP |
| `RATE_LIMIT_AGENT_MESSAGES_PER_MINUTE` | `10` | Agent messages per user per minute |
| `RATE_LIMIT_AGENT_MESSAGES_PER_DAY` | `200` | Agent messages per user per 24 hours |
| `RATE_LIMIT_AGENCY_AGENT_MESSAGES_PER_DAY` | `1000` | Agent messages per agency per 24 hours |
| `API_PROXY_SECRET` | *(empty; set in production)* | Shared secret that lets the Next.js `/api` proxy forward the real client IP (see §3). At least 32 characters. |

### Expected Secret Format

The `RATE_LIMIT_REDIS_URL` must be a standard Redis connection URL in one of the following formats:

```
redis://[user:password@]host[:port][/db]
rediss://[user:password@]host[:port][/db]
```

The URL is supplied via the deployment secret store and never committed to version control.

### Distributed Counters

Two or more application replicas automatically share rate limit counters through the Redis store. The implementation uses standard `rate-limit-redis` and `redis` packages.

## 3. Proxy Trust Assumption

The backend assumes exactly **one trusted reverse proxy** in front of the application. The Express application is configured to trust the proxy via the `trust proxy` setting, ensuring that `request.ip` reflects the real client IP address rather than the proxy's address.

**Important**: The implementation never directly parses `X-Forwarded-For` headers. It relies on Express's built-in proxy trust logic.

### Deployment Consequences

- **Zero proxies**: `request.ip` will be the direct TCP connection IP (e.g., localhost in development).
- **More than one proxy** without adjusting trust settings: `request.ip` may reflect an intermediate proxy, breaking IP-based rate limiting.

Deployers must ensure that the trust proxy configuration matches the actual deployment topology.

### Requests Through the Next.js `/api` Proxy

The browser calls the backend through the app's own `/api/*` path (Vercel → Railway), so for those requests `request.ip` is the Vercel server's IP, identical for every user. To keep IP limits per-client, the client's `proxy.js` (and the `/api/stream` route) sends two headers:

- `x-voyage-client-ip` — the client IP from Vercel's `x-real-ip` / `x-forwarded-for`, which Vercel's edge overwrites.
- `x-voyage-proxy-secret` — the shared `API_PROXY_SECRET`.

`src/http/clientIp.ts` uses the forwarded IP only when the secret matches (constant-time comparison) and the value is a valid IP; otherwise it falls back to `request.ip`. The proxy always strips client-sent copies of both headers. Set the **same** `API_PROXY_SECRET` on the backend (Railway) and the client (Vercel, server-only — never `NEXT_PUBLIC_`). The backend logs a warning at boot in production when it is missing.

## 4. Request Validation Rules and VALIDATION_ERROR Contract

All public and authenticated routes perform strict validation of request parameters, query strings, and body content.

### Validation Schema Rules

- Schemas are defined in `src/http/requestSchemas.ts` and use Zod's `.strict()` mode to reject unknown object keys rather than silently stripping them.
- Common validation primitives include:
  - UUID parameters with strict format validation
  - Opaque tokens with length bounds (16–512 characters)
  - Bounded normalized text fields
  - Pagination with coerced numeric limits and bounds checking

### Validation Failure Response

HTTP 400 with the following contract:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "issues": [
      {
        "code": "invalid_type",
        "expected": "string",
        "received": "undefined",
        "path": ["email"],
        "message": "Required"
      }
    ]
  }
}
```

### Handler Execution Order

Handlers follow this strict sequence:

1. **Parse** `params`, `query`, and `body`
2. **Validate** schema (rejects malformed IDs before any database access)
3. **Enforce** authentication and agency authorization
4. **Call** services

This order ensures that malformed IDs never reach Prisma and that authorization checks run before business logic.

## 5. Email HTML Escaping Boundary

HTML escaping is applied exclusively at the point of HTML output generation, not in the data layer.

### User-Controlled Values

The following user-controlled fields are HTML-escaped via `src/utils/html.ts` `escapeHtmlText()` **only at the output boundary** in `src/services/email.ts`:

- `displayName` (user profile)
- `clientName` (trip client)
- `tripTitle` (trip metadata)
- `inviterName` (invitation sender)
- `agencyName` (agency profile)

### Storage and Plain-Text Bodies

- Database fields store raw, unescaped text.
- Plain-text email bodies do not include HTML escaping.
- Escaping is applied only when rendering HTML email templates.

### Email URLs

All URLs in emails are constructed from:
- Trusted configured origins (environment variable)
- Generated opaque tokens

URLs never include user input and are therefore inherently safe from HTML injection.

## 6. Secret Redaction Behavior

Operational logs and error handling use a redaction system to prevent credential leakage.

### Redaction Implementation

The `src/utils/redaction.ts` `redactSecrets(input)` function strips:

- URL query parameter values for keys: `key`, `api_key`, `apikey`, `token`, `access_token`, `id_token`, `client_secret`, `password`, `authorization`
- `Authorization` header values for `Bearer` and `Basic` schemes
- Exact values of configured secrets from `env`

### Secret Sources

All secrets come from validated configuration in `src/config/env.ts`, never from direct `process.env` reads.

### Error Logging

The unknown-error branch of `src/http/errors.ts` logs a redacted representation of errors, never the full request object or raw error details.

### Provider Error Logs

Provider error logs (Google Maps, model providers, web search) pass request bodies and URLs through `redactSecrets()` before logging.

### Email Fallback Logging

When no mail provider is configured, email delivery falls back to file-based logging. The fallback log contains:
- A provider-agnostic "delivery skipped" message
- **No** recipient address
- **No** one-time verification URLs or tokens
- **No** password reset URLs or tokens
- **No** invitation URLs or tokens
- **No** review URLs or tokens

## 7. Google Credential Lifecycle

### Credential Generation

`src/config/googleCredentials.ts` `prepareGoogleApplicationCredentials()` returns an object with the signature:

```typescript
{
  path: string;
  generated: boolean;
  cleanup(): void;
}
```

The function:
- Creates a unique temporary directory: `mkdtempSync(join(tmpdir(), "voyage-google-creds-"))`
- Writes `application-credentials.json` to this directory with restricted permissions (`0o600`)
- Sets the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the generated file path

### Cleanup Behavior

The `cleanup()` function is idempotent and:
- Removes the generated `application-credentials.json` file
- Removes the parent temporary directory
- **Never** deletes operator-provided `GOOGLE_APPLICATION_CREDENTIALS` files

### Graceful Shutdown

`src/server.ts` registers `cleanup()` callbacks on signal handlers for `exit`, `SIGINT`, and `SIGTERM`. Shutdown sequence:

1. Stop accepting new requests
2. Close the HTTP server (allowing in-flight requests to complete)
3. Clean up generated credentials
4. Exit the process

## 8. Maps and Cloudinary Photo Key Flow

### Google Maps API Key Management

The Google Maps API key is transmitted **only** in the `X-Goog-Api-Key` HTTP header and never in URL query parameters.

### Place Photo Fetching

`src/services/maps/googleMaps.ts` `fetchPlacePhoto(photoName, { width, height })`:

- **Validates** the resource name against regex: `^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$`
- **Bounds** response size to prevent memory exhaustion
- **Validates** `content-type` header begins with `image/`
- **Returns** `{ bytes, contentType }` for downstream processing

### Cloudinary Caching

`src/services/cloudinary.ts` `uploadPlacePhotoBuffer(buffer, placeId)`:

- Accepts raw image bytes from `fetchPlacePhoto`
- Uploads bytes to Cloudinary (never a Google Maps URL)
- Cloudinary receives **no** API keys or query parameters

### Public Photo Proxy

`GET /images/place-photo` streams photos from Google Maps with header-based authentication and lazily caches to Cloudinary:

- Fetches bytes from Google using header-based API key
- Streams bytes directly to the client
- Asynchronously uploads bytes to Cloudinary for caching

**Security property**: No persisted snapshot URL and no Cloudinary input contains `?key=` or any API credential.

## 9. Operational Secret Rotation Checklist

### Standard Rotation Procedure

For each secret below, follow this ordered sequence:

1. **Update** the secret in the deployment secret store
2. **Redeploy/restart** all application replicas
3. **Verify** boot-time validation passes and no startup errors appear
4. **Revoke** the old secret at the provider

### Secrets

| Secret | Provider | Notes |
|---|---|---|
| `RESEND_API_KEY` | Resend | Email service provider API key |
| SMTP credentials | SMTP provider | Mail server username and password (if using SMTP instead of Resend) |
| `GOOGLE_MAPS_API_KEY` | Google Cloud | Maps and Places API key |
| Cloudinary credentials | Cloudinary | API key and secret for image hosting |
| OAuth client secrets | Google / Apple | OAuth client ID and secret for sign-in providers |
| `PASSWORD_PEPPER` | Internal | Pepper value for password hashing |
| `TRIP_REVIEW_SECRET` | Internal | Secret key for review token generation |
| `RATE_LIMIT_REDIS_URL` | Redis | Connection URL with credentials (if applicable) |
| Google service-account JSON | Google Cloud | Service account key file (if using generated temporary credentials) |

### Special Case: PASSWORD_PEPPER Rotation

Rotating `PASSWORD_PEPPER` invalidates all existing password hashes. This operation must be coordinated with a password reset campaign or migration window and is **not** a routine rotation procedure. Plan accordingly and test in staging first.

## 10. Deployment Verification Commands

### Build Verification

Run the following commands in the deployment environment to verify successful compilation and test pass:

```powershell
npm.cmd test --
npm.cmd run build
```

### Production Smoke Checks

After deployment, verify the following:

1. **Rate Limiting**
   - Perform repeated requests to a public endpoint (e.g., `GET /health`)
   - Verify the 429 response is returned after the limit is exceeded
   - Confirm `RateLimit` / `RateLimit-Policy` headers are present, and `Retry-After` on the 429
   - Through the app origin (`https://<app>/api/health`), confirm two different networks get independent `RateLimit` remaining counts (proves `API_PROXY_SECRET` is set on both sides)

2. **Distributed Counters**
   - Deploy two or more application replicas
   - Send requests alternating between replicas
   - Verify that rate limit counters are shared (i.e., the combined request count across replicas is tracked correctly)

3. **Secret Redaction in Logs**
   - Review application logs for recent requests and errors
   - Confirm **no** raw tokens, email limiter keys, API keys, or credential JSON appear in logs
   - Confirm that sensitive values are redacted or omitted

4. **Graceful Shutdown**
   - Send `SIGTERM` to an application replica
   - Verify that the process exits cleanly after in-flight requests complete
   - Confirm that generated Google credential files are removed from the temporary directory
   - Verify no lingering credential directories remain

---

**Document Version**: 1.0  
**Last Updated**: 2026-06-10  
**Applies to**: Voyage Backend v2.0+
