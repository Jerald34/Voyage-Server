/**
 * One-shot signed token for post-trip review links.
 *
 * Format: base64url(JSON payload) . base64url(HMAC-SHA256 signature)
 *
 * The token is tied to a specific tripId and issuedAt timestamp.
 * Verification returns null on bad signature or malformed token — never throws.
 *
 * Security: requires the TRIP_REVIEW_SECRET environment variable to be set
 * (non-empty). In production this is enforced at boot via env.ts (F6). In
 * development the server will still start if the variable is absent, but tokens
 * cannot be signed — callers will receive an error at runtime. The old fallback
 * to PASSWORD_PEPPER or the literal "dev-trip-review-secret" has been removed
 * (F5) to prevent token forgery when neither secret is configured.
 */

import { createHmac } from "node:crypto";

export type TripReviewTokenPayload = {
  tripId: string;
  issuedAt: string; // ISO-8601
};

/** Maximum token age in milliseconds (30 days). Tokens older than this are rejected. */
const TRIP_REVIEW_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  // F5: Read directly from process.env (not the cached env object) so that
  // the secret can be overridden in tests without restarting the module.
  // Use only the dedicated TRIP_REVIEW_SECRET — never fall back to
  // PASSWORD_PEPPER (avoids coupling two unrelated trust domains) and never
  // fall back to a hard-coded literal (which is publicly readable in source).
  const secret = (process.env["TRIP_REVIEW_SECRET"] ?? "").trim();
  if (!secret) {
    throw new Error(
      "[reviewTokens] TRIP_REVIEW_SECRET is not configured. " +
        "Set this environment variable to a non-empty random secret before signing review tokens."
    );
  }
  return secret;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64urlDecode(data: string): string | null {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Issue a signed trip-review token.
 * The scheduler calls this when sending the post-trip email.
 */
export function signTripReviewToken(payload: TripReviewTokenPayload): string {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const sig = sign(encodedPayload, getSecret());
  return `${encodedPayload}.${sig}`;
}

/**
 * Verify a trip-review token.
 * Returns the parsed payload or null on bad signature / malformed token.
 */
export function verifyTripReviewToken(token: string): TripReviewTokenPayload | null {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const encodedPayload = token.slice(0, dotIndex);
    const providedSig = token.slice(dotIndex + 1);

    if (!encodedPayload || !providedSig) return null;

    const expectedSig = sign(encodedPayload, getSecret());

    // Constant-time comparison to prevent timing attacks
    if (providedSig.length !== expectedSig.length) return null;

    let mismatch = 0;
    for (let i = 0; i < expectedSig.length; i++) {
      mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    if (mismatch !== 0) return null;

    const jsonStr = base64urlDecode(encodedPayload);
    if (jsonStr === null) return null;

    const parsed: unknown = JSON.parse(jsonStr);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["tripId"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["issuedAt"] !== "string"
    ) {
      return null;
    }

    const payload = parsed as TripReviewTokenPayload;

    // F5: Enforce token TTL — reject tokens older than TRIP_REVIEW_TOKEN_MAX_AGE_MS.
    // The original code carried issuedAt but never checked it, meaning a leaked or
    // forged token would remain valid forever.
    const issuedAtMs = Date.parse(payload.issuedAt);
    if (isNaN(issuedAtMs) || Date.now() - issuedAtMs > TRIP_REVIEW_TOKEN_MAX_AGE_MS) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
