import { describe, expect, it } from "vitest";
import { signTripReviewToken, verifyTripReviewToken } from "../src/modules/reviews/reviewTokens";

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
    const token = signTripReviewToken({ tripId: "abc", issuedAt: "2026-01-01T00:00:00.000Z" });
    const [, sig] = token.split(".");
    const otherPayload = Buffer.from(JSON.stringify({ tripId: "evil", issuedAt: "2026-01-01T00:00:00.000Z" })).toString(
      "base64url"
    );
    expect(verifyTripReviewToken(`${otherPayload}.${sig}`)).toBeNull();
  });

  it("returns null on a malformed token", () => {
    expect(verifyTripReviewToken("not-a-token")).toBeNull();
    expect(verifyTripReviewToken("")).toBeNull();
    expect(verifyTripReviewToken(".")).toBeNull();
  });
});
