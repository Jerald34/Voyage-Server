/**
 * redaction.ts
 *
 * Utility for sanitising strings before they are written to logs.
 * All secret access goes through `env` (src/config/env.ts); this module
 * reads known secret values from `env` at call time and replaces any literal
 * occurrence with "[REDACTED]".
 *
 * Three layers of redaction are applied in order:
 *   1. URL query-string parameters whose key name suggests a secret.
 *   2. Authorization header values (Bearer / Basic).
 *   3. Exact configured secret values pulled from `env`.
 *
 * Dependency-free (no third-party packages).
 */

// ---------------------------------------------------------------------------
// Layer 1 — Sensitive query-parameter key names (case-insensitive match)
// ---------------------------------------------------------------------------
// Any URL query param whose key matches one of these is assumed to carry a
// secret.  The value is replaced; the key and surrounding `?`/`&`/`=`
// punctuation are preserved so the URL structure remains readable.
// ---------------------------------------------------------------------------
const SENSITIVE_QUERY_KEYS = new Set([
  "key",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "id_token",
  "client_secret",
  "password",
  "authorization"
]);

/**
 * Regex that matches a single query-string key=value pair.
 * Separators (?/&), key ([^=&#\s]+), value ([^&#\s]*).
 * Whitespace terminates the value so that trailing text (e.g. " returned 403")
 * is not consumed by the value group.
 *
 * We apply this globally and only replace the value when the key is sensitive.
 */
const QUERY_PARAM_RE = /([?&])([^=&#\s]+)=([^&#\s]*)/g;

function redactQueryParams(input: string): string {
  return input.replace(QUERY_PARAM_RE, (match, separator: string, key: string, value: string) => {
    if (!value) return match; // empty value — nothing to redact
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      return `${separator}${key}=[REDACTED]`;
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// Layer 2 — Authorization header values
// ---------------------------------------------------------------------------
// Matches strings of the form:
//   Authorization: Bearer <token>
//   Authorization: Basic <credentials>
// (case-insensitive on the keyword)
// ---------------------------------------------------------------------------
const AUTH_HEADER_RE = /\b(authorization\s*[:=]\s*(?:bearer|basic)\s+)(\S+)/gi;

function redactAuthHeaders(input: string): string {
  return input.replace(AUTH_HEADER_RE, (_match, prefix: string) => `${prefix}[REDACTED]`);
}

// ---------------------------------------------------------------------------
// Layer 3 — Exact configured secret values
// ---------------------------------------------------------------------------
// We read from `env` at call time (not module load time) so that:
//   • Tests that mutate process.env before vi.resetModules() pick up the
//     freshest values.
//   • The list stays in sync with env.ts without a separate maintenance step.
//
// Empty-string guard: never redact `""` (would corrupt every log line).
// ---------------------------------------------------------------------------

/**
 * Secret env-variable names to check at call time.
 * We read from `process.env` directly (not the cached `env` singleton) so
 * that tests that mutate `process.env` see the updated values without having
 * to reset the module cache.  In production `process.env` is stable so the
 * behaviour is identical to reading from `env`.
 */
const SECRET_ENV_KEYS = [
  "RESEND_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "OPENROUTER_API_KEY",
  "SERPER_API_KEY",
  "CLOUDINARY_API_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_PRIVATE_KEY",
  "PASSWORD_PEPPER",
  "TRIP_REVIEW_SECRET",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_CLOUD_API_KEY",
  "SMTP_PASSWORD",
  "S3_SECRET_ACCESS_KEY"
] as const;

/** Returns a fresh snapshot of all non-empty configured secret values. */
function getConfiguredSecrets(): string[] {
  return SECRET_ENV_KEYS
    .map((k) => (process.env[k] ?? "").trim())
    .filter((v) => v.length > 0);
}

function redactConfiguredSecrets(input: string): string {
  let result = input;
  for (const secret of getConfiguredSecrets()) {
    // Escape any regex metacharacters inside the secret value.
    const escaped = secret.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redacts secrets and PII from a string before it is written to a log.
 *
 * @param input - The raw string that may contain secrets.
 * @returns A sanitised copy of `input` with sensitive values replaced by
 *          `[REDACTED]`.  Non-secret content (status codes, provider messages,
 *          etc.) is preserved.
 */
export function redactSecrets(input: string): string {
  let result = input;
  result = redactQueryParams(result);
  result = redactAuthHeaders(result);
  result = redactConfiguredSecrets(result);
  return result;
}
