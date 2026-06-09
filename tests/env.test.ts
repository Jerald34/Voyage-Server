import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";

describe("parseEnv", () => {
  it("applies rate limit defaults, trims values, and preserves resend config", () => {
    const parsed = parseEnv({
      RATE_LIMIT_REDIS_URL: "  redis://localhost:6379/0  ",
      RATE_LIMIT_PREFIX: "  voyage:custom-rate-limit:  ",
      RATE_LIMIT_BASELINE_MAX: "450",
      RESEND_API_KEY: "re_test_key"
    });

    expect(parsed.RATE_LIMIT_REDIS_URL).toBe("redis://localhost:6379/0");
    expect(parsed.RATE_LIMIT_PREFIX).toBe("voyage:custom-rate-limit:");
    expect(parsed.RATE_LIMIT_BASELINE_MAX).toBe(450);
    expect(parsed.RESEND_API_KEY).toBe("re_test_key");
  });

  it("uses rate limit defaults when values are omitted or blank", () => {
    const parsed = parseEnv({
      RATE_LIMIT_REDIS_URL: "   ",
      RATE_LIMIT_PREFIX: "   "
    });

    expect(parsed.RATE_LIMIT_REDIS_URL).toBe("");
    expect(parsed.RATE_LIMIT_PREFIX).toBe("voyage:rate-limit:");
    expect(parsed.RATE_LIMIT_BASELINE_MAX).toBe(300);
  });

  it("requires RATE_LIMIT_REDIS_URL in production without leaking its value", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db.example.com:5432/voyage",
        PASSWORD_PEPPER: "pepper",
        TRIP_REVIEW_SECRET: "review-secret",
        RATE_LIMIT_REDIS_URL: "   "
      })
    ).toThrowError(/RATE_LIMIT_REDIS_URL/);
  });

  it("preserves existing production secret validation", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db.example.com:5432/voyage",
        RATE_LIMIT_REDIS_URL: "redis://cache.example.com:6379/0"
      })
    ).toThrowError(/PASSWORD_PEPPER/);
  });
});
