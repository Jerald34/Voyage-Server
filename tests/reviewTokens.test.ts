import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { signTripReviewToken, verifyTripReviewToken } from "../src/modules/reviews/reviewTokens";

// F5: TRIP_REVIEW_SECRET is now required — set it for all tests in this file.
beforeEach(() => {
  process.env["TRIP_REVIEW_SECRET"] = "test-review-secret-for-unit-tests";
});

afterEach(() => {
  delete process.env["TRIP_REVIEW_SECRET"];
});

describe("trip review tokens", () => {
  it("round-trips a payload through sign + verify", () => {
    const payload = { tripId: "11111111-1111-1111-1111-111111111111", issuedAt: new Date().toISOString() };
    const token = signTripReviewToken(payload);
    expect(token).toMatch(/\./);
    const parsed = verifyTripReviewToken(token);
    expect(parsed).toEqual(payload);
  });

  it("returns null on a tampered signature", () => {
    const payload = { tripId: "abc", issuedAt: new Date().toISOString() };
    const token = signTripReviewToken(payload);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyTripReviewToken(tampered)).toBeNull();
  });

  it("returns null on a tampered payload", () => {
    const token = signTripReviewToken({ tripId: "abc", issuedAt: new Date().toISOString() });
    const [, sig] = token.split(".");
    const otherPayload = Buffer.from(JSON.stringify({ tripId: "evil", issuedAt: new Date().toISOString() })).toString(
      "base64url"
    );
    expect(verifyTripReviewToken(`${otherPayload}.${sig}`)).toBeNull();
  });

  it("returns null on a malformed token", () => {
    expect(verifyTripReviewToken("not-a-token")).toBeNull();
    expect(verifyTripReviewToken("")).toBeNull();
    expect(verifyTripReviewToken(".")).toBeNull();
  });

  // F5: TTL enforcement
  it("returns null for a token older than 30 days", () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const token = signTripReviewToken({ tripId: "old-trip", issuedAt: oldDate });
    expect(verifyTripReviewToken(token)).toBeNull();
  });

  it("accepts a token issued today (within TTL)", () => {
    const payload = { tripId: "fresh-trip", issuedAt: new Date().toISOString() };
    const token = signTripReviewToken(payload);
    expect(verifyTripReviewToken(token)).toEqual(payload);
  });

  // F5: Secret isolation
  it("throws when TRIP_REVIEW_SECRET is not configured", () => {
    delete process.env["TRIP_REVIEW_SECRET"];
    expect(() =>
      signTripReviewToken({ tripId: "test", issuedAt: new Date().toISOString() })
    ).toThrow("TRIP_REVIEW_SECRET is not configured");
  });
});
