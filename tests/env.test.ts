import { describe, expect, it, vi } from "vitest";

type EnvSource = Record<string, string | undefined>;

const productionImportEnv: EnvSource = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://db.example.com:5432/voyage",
  PASSWORD_PEPPER: "pepper",
  TRIP_REVIEW_SECRET: "review-secret",
  RATE_LIMIT_REDIS_URL: "redis://cache.example.test:6379/0"
};

async function loadEnvModule(ambientEnv: EnvSource = { NODE_ENV: "test" }) {
  const originalEnv = process.env;
  process.env = { NODE_ENV: "test", ...ambientEnv };

  try {
    vi.resetModules();
    return await import("../src/config/env");
  } finally {
    process.env = originalEnv;
    vi.resetModules();
  }
}

describe("parseEnv", () => {
  it("stays import-safe under ambient production env and preserves rate-limit parsing", async () => {
    const { env, parseEnv } = await loadEnvModule(productionImportEnv);

    expect(env.NODE_ENV).toBe("production");
    expect(env.RATE_LIMIT_REDIS_URL).toBe("redis://cache.example.test:6379/0");

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

  it("uses rate limit defaults when values are omitted or blank", async () => {
    const { parseEnv } = await loadEnvModule();
    const parsed = parseEnv({
      RATE_LIMIT_REDIS_URL: "   ",
      RATE_LIMIT_PREFIX: "   "
    });

    expect(parsed.RATE_LIMIT_REDIS_URL).toBe("");
    expect(parsed.RATE_LIMIT_PREFIX).toBe("voyage:rate-limit:");
    expect(parsed.RATE_LIMIT_BASELINE_MAX).toBe(300);
  });

  it("requires RATE_LIMIT_REDIS_URL in production", async () => {
    const { parseEnv } = await loadEnvModule();

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

  it("does not echo redis credentials when another production secret is missing", async () => {
    const { parseEnv } = await loadEnvModule();
    const redisUrl = "redis://user:super-secret@example.test:6379";

    try {
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db.example.com:5432/voyage",
        TRIP_REVIEW_SECRET: "review-secret",
        RATE_LIMIT_REDIS_URL: redisUrl
      });
      throw new Error("Expected parseEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);

      const message = (error as Error).message;
      expect(message).toContain("PASSWORD_PEPPER");
      expect(message).not.toContain("super-secret");
      expect(message).not.toContain(redisUrl);
    }
  });
});
