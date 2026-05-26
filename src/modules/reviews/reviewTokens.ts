/**
 * One-shot signed token for post-trip review links.
 *
 * Format: base64url(JSON payload) . base64url(HMAC-SHA256 signature)
 *
 * The token is tied to a specific tripId and issuedAt timestamp.
 * Verification returns null on bad signature or malformed token — never throws.
 */

import { createHmac } from "node:crypto";
import { env } from "../../config/env";

export type TripReviewTokenPayload = {
  tripId: string;
  issuedAt: string; // ISO-8601
};

function getSecret(): string {
  // Prefer the dedicated secret; fall back to JWT_SECRET if not configured.
  // JWT_SECRET is not in the env schema, but PASSWORD_PEPPER is always present.
  // We use the value of TRIP_REVIEW_SECRET when set, otherwise fall back to
  // PASSWORD_PEPPER (always non-empty in prod) or a hard-coded dev sentinel.
  const secret = (process.env["TRIP_REVIEW_SECRET"] ?? "").trim();
  if (secret) return secret;
  // Fall back to PASSWORD_PEPPER which is always present in the schema
  return env.PASSWORD_PEPPER || "dev-trip-review-secret";
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

    return parsed as TripReviewTokenPayload;
  } catch {
    return null;
  }
}
