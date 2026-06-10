/**
 * secretHandling.test.ts
 *
 * TDD: Task 8 – secret redaction and email fallback log safety.
 *
 * Tests are written BEFORE the implementation so they must fail first.
 * Run: npm.cmd test -- tests/secretHandling.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. redactSecrets unit tests
// ---------------------------------------------------------------------------

// We import redactSecrets lazily so missing-module failures are localised.
async function importRedaction() {
  const mod = await import("../src/utils/redaction");
  return mod.redactSecrets;
}

describe("redactSecrets – URL query parameters", () => {
  it("redacts query values for key and token in a URL", async () => {
    const redactSecrets = await importRedaction();
    expect(redactSecrets("https://example.com/path?key=abc123&token=def456")).toBe(
      "https://example.com/path?key=[REDACTED]&token=[REDACTED]"
    );
  });

  it("redacts api_key param case-insensitively", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("https://maps.api.com/geocode?API_KEY=supersecret&lang=en");
    expect(result).not.toContain("supersecret");
    expect(result).toContain("[REDACTED]");
    // non-secret params are preserved
    expect(result).toContain("lang=en");
  });

  it("redacts apikey, access_token, id_token, client_secret, password, authorization params", async () => {
    const redactSecrets = await importRedaction();
    const cases: [string, string][] = [
      ["https://a.com?apikey=s3cr3t", "apikey=[REDACTED]"],
      ["https://a.com?access_token=tok123", "access_token=[REDACTED]"],
      ["https://a.com?id_token=idtok", "id_token=[REDACTED]"],
      ["https://a.com?client_secret=cliSec", "client_secret=[REDACTED]"],
      ["https://a.com?password=p@ss", "password=[REDACTED]"],
      ["https://a.com?authorization=authval", "authorization=[REDACTED]"]
    ];
    for (const [input, expected] of cases) {
      expect(redactSecrets(input)).toContain(expected);
    }
  });

  it("preserves non-secret query params and path", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("https://example.com/maps/geocode?q=Cebu&lang=en&limit=10");
    expect(result).toBe("https://example.com/maps/geocode?q=Cebu&lang=en&limit=10");
  });
});

describe("redactSecrets – Authorization header values", () => {
  it("redacts Bearer token from Authorization header string", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("Authorization: Bearer abc123");
    expect(result).not.toContain("abc123");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts Basic credential from Authorization header string", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("Authorization: Basic dXNlcjpwYXNz");
    expect(result).not.toContain("dXNlcjpwYXNz");
    expect(result).toContain("[REDACTED]");
  });

  it("is case-insensitive for the Authorization prefix", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("authorization: Bearer MyToken999");
    expect(result).not.toContain("MyToken999");
    expect(result).toContain("[REDACTED]");
  });
});

describe("redactSecrets – configured secret values", () => {
  it("redacts an exact configured secret value found in arbitrary text", async () => {
    const redactSecrets = await importRedaction();
    // Plant a recognisable value in process.env — the implementation reads
    // process.env at call time, so no module reset is needed.
    const originalKey = process.env.SERPER_API_KEY;
    process.env.SERPER_API_KEY = "my-secret-serper-key-xyz";

    const result = redactSecrets(
      `Serper returned 401. Config key: my-secret-serper-key-xyz used in header`
    );
    expect(result).not.toContain("my-secret-serper-key-xyz");
    expect(result).toContain("[REDACTED]");

    // restore
    if (originalKey === undefined) {
      delete process.env.SERPER_API_KEY;
    } else {
      process.env.SERPER_API_KEY = originalKey;
    }
  });
});

describe("redactSecrets – preserves diagnostic information", () => {
  it("preserves numeric HTTP status codes", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("Provider error (503): Service Unavailable");
    expect(result).toContain("503");
  });

  it("preserves non-secret text around redacted values", async () => {
    const redactSecrets = await importRedaction();
    const result = redactSecrets("GET https://api.example.com?key=abc123 returned 403 Forbidden");
    expect(result).toContain("GET");
    expect(result).toContain("403 Forbidden");
    expect(result).not.toContain("abc123");
  });

  it("passes through plain text with no secrets unchanged", async () => {
    const redactSecrets = await importRedaction();
    const plain = "Model provider returned an empty response";
    expect(redactSecrets(plain)).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// 2. Email fallback log tests
// ---------------------------------------------------------------------------
// The goal: when neither SMTP nor Resend is configured, sendMail falls through
// to console.info(mail.logMessage). The logMessage must NOT contain the
// recipient email address OR any one-time URL/token.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Email fallback path: mock the env module to force "no provider configured"
// so that sendMail falls through to console.info(mail.logMessage).
// This avoids fighting dotenv which re-loads .env on each module reset.
// ---------------------------------------------------------------------------

const envMocks = vi.hoisted(() => ({
  SMTP_HOST: "",
  RESEND_API_KEY: "",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  EMAIL_FROM: "Voyage <no-reply@example.com>",
  APP_ORIGIN: "http://localhost:3000",
  NODE_ENV: "test" as const
}));

vi.mock("../src/config/env", () => ({
  env: envMocks,
  isProduction: () => false,
  publicApiOrigin: "http://localhost:4000"
}));

// Nodemailer mock (should not be called in the unconfigured path)
const mailMocks = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mailMocks.createTransport
  }
}));

async function loadEmailServiceUnconfigured() {
  // Reset module cache each time so smtpTransporter module-level state is cleared.
  vi.resetModules();
  const mod = await import("../src/services/email");
  return mod;
}

describe("email fallback log – no PII or secrets in log output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the env mock in "no provider" state.
    envMocks.SMTP_HOST = "";
    envMocks.RESEND_API_KEY = "";
  });

  it("sendVerificationEmail does NOT log recipient email or verification URL", async () => {
    const { sendVerificationEmail } = await loadEmailServiceUnconfigured();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendVerificationEmail({
      to: "alice@example.com",
      displayName: "Alice",
      verificationUrl: "https://app.voyage.com/verify?token=secret-verify-token-abc"
    });

    // Should have logged something (the skip message).
    expect(consoleSpy).toHaveBeenCalled();

    const loggedArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain("alice@example.com");
    expect(loggedArgs).not.toContain("secret-verify-token-abc");
    expect(loggedArgs).not.toContain("https://app.voyage.com/verify");

    consoleSpy.mockRestore();
  });

  it("sendPasswordResetEmail does NOT log recipient email or reset URL", async () => {
    const { sendPasswordResetEmail } = await loadEmailServiceUnconfigured();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendPasswordResetEmail({
      to: "bob@example.com",
      displayName: "Bob",
      resetUrl: "https://app.voyage.com/reset?token=secret-reset-token-xyz"
    });

    expect(consoleSpy).toHaveBeenCalled();

    const loggedArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain("bob@example.com");
    expect(loggedArgs).not.toContain("secret-reset-token-xyz");
    expect(loggedArgs).not.toContain("https://app.voyage.com/reset");

    consoleSpy.mockRestore();
  });

  it("sendTripReviewEmail does NOT log recipient email or review URL", async () => {
    const { sendTripReviewEmail } = await loadEmailServiceUnconfigured();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendTripReviewEmail({
      to: "carol@example.com",
      tripTitle: "Cebu Adventure",
      tripToken: "secret-trip-token-123",
      clientName: "Carol"
    });

    expect(consoleSpy).toHaveBeenCalled();

    const loggedArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain("carol@example.com");
    expect(loggedArgs).not.toContain("secret-trip-token-123");
    // The review URL would contain the tripToken
    expect(loggedArgs).not.toContain("/reviews/");

    consoleSpy.mockRestore();
  });

  it("sendAgencyInvitationEmail does NOT log recipient email or accept URL", async () => {
    const { sendAgencyInvitationEmail } = await loadEmailServiceUnconfigured();
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendAgencyInvitationEmail({
      to: "dave@example.com",
      inviterName: "Eve",
      agencyName: "Adventure Co",
      role: "STAFF",
      acceptUrl: "https://app.voyage.com/invite?token=secret-invite-token-999"
    });

    expect(consoleSpy).toHaveBeenCalled();

    const loggedArgs = consoleSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).not.toContain("dave@example.com");
    expect(loggedArgs).not.toContain("secret-invite-token-999");
    expect(loggedArgs).not.toContain("https://app.voyage.com/invite");

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. fetchPlacePhoto – Maps key must not appear in errors or console.error
// ---------------------------------------------------------------------------

describe("fetchPlacePhoto – Maps key never leaks into error messages or logs", () => {
  it("does not put the configured Maps key into thrown error messages on fetch failure", async () => {
    const FAKE_MAPS_KEY = "super-secret-maps-key-do-not-log";

    // Use a fetchImpl that throws a network error.
    const { createGoogleMapsProvider } = await import("../src/services/maps");

    const provider = createGoogleMapsProvider({
      apiKey: FAKE_MAPS_KEY,
      fetchImpl: async () => {
        throw new Error("Network failure");
      }
    });

    let thrownMessage = "";
    try {
      await provider.fetchPlacePhoto("places/ChIJabc123/photos/AUc7tXkDEF456", {
        width: 400,
        height: 400
      });
    } catch (err: unknown) {
      thrownMessage = err instanceof Error ? err.message : String(err);
    }

    expect(thrownMessage).not.toContain(FAKE_MAPS_KEY);
  });

  it("does not put the configured Maps key into console.error output on non-OK response", async () => {
    const FAKE_MAPS_KEY = "another-secret-key-must-not-appear";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { createGoogleMapsProvider } = await import("../src/services/maps");

    const provider = createGoogleMapsProvider({
      apiKey: FAKE_MAPS_KEY,
      fetchImpl: async () =>
        new Response("Forbidden", {
          status: 403,
          headers: { "content-type": "text/plain" }
        })
    });

    try {
      await provider.fetchPlacePhoto("places/ChIJabc123/photos/AUc7tXkDEF456", {
        width: 400,
        height: 400
      });
    } catch {
      // expected
    }

    const loggedOutput = errorSpy.mock.calls.flat().join(" ");
    expect(loggedOutput).not.toContain(FAKE_MAPS_KEY);

    errorSpy.mockRestore();
  });
});
