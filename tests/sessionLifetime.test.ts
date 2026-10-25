import { describe, expect, it } from "vitest";
import { env } from "../src/config/env";
import {
  initialSessionExpiry,
  renewedSessionExpiry,
  sessionLifetimeConfig,
  SESSION_RENEW_INTERVAL_MS,
  type SessionLifetimeConfig
} from "../src/modules/auth/sessionLifetime";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T = new Date("2026-10-01T00:00:00.000Z").getTime();

const config: SessionLifetimeConfig = {
  persistentTtlMs: 30 * DAY,
  shortTtlMs: 12 * HOUR,
  maxAgeMs: 90 * DAY,
  renewIntervalMs: HOUR
};

describe("sessionLifetimeConfig", () => {
  it("derives its defaults from the environment", () => {
    expect(sessionLifetimeConfig()).toEqual({
      persistentTtlMs: env.SESSION_TTL_DAYS * DAY,
      shortTtlMs: env.SESSION_SHORT_TTL_HOURS * HOUR,
      maxAgeMs: env.SESSION_MAX_AGE_DAYS * DAY,
      renewIntervalMs: SESSION_RENEW_INTERVAL_MS
    });
  });

  it("lets a single field be overridden and keeps the env defaults for the rest", () => {
    const overridden = sessionLifetimeConfig({ shortTtlMs: 5 });

    expect(overridden.shortTtlMs).toBe(5);
    expect(overridden.persistentTtlMs).toBe(env.SESSION_TTL_DAYS * DAY);
    expect(overridden.maxAgeMs).toBe(env.SESSION_MAX_AGE_DAYS * DAY);
    expect(overridden.renewIntervalMs).toBe(SESSION_RENEW_INTERVAL_MS);
  });
});

describe("initialSessionExpiry", () => {
  it("gives remembered sessions the long idle window", () => {
    expect(initialSessionExpiry(new Date(T), true, config)).toEqual(new Date(T + 30 * DAY));
  });

  it("gives other sessions the short idle window", () => {
    expect(initialSessionExpiry(new Date(T), false, config)).toEqual(new Date(T + 12 * HOUR));
  });
});

describe("renewedSessionExpiry", () => {
  it("slides a remembered session forward from now", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 2 * HOUR), config)).toEqual(
      new Date(T + 2 * HOUR + 30 * DAY)
    );
  });

  it("slides a short session forward by the short window", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 12 * HOUR), persistent: false };
    expect(renewedSessionExpiry(session, new Date(T + 3 * HOUR), config)).toEqual(
      new Date(T + 15 * HOUR)
    );
  });

  it("returns null when the session was renewed less than an hour ago", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 30 * 60 * 1000), config)).toBeNull();
  });

  it("never pushes past the hard cap from sign-in", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 86 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 85 * DAY), config)).toEqual(new Date(T + 90 * DAY));
  });

  it("returns null once the session already sits at the cap", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 90 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 89 * DAY), config)).toBeNull();
  });

  it("never resurrects a session that has already expired", () => {
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: true };
    expect(renewedSessionExpiry(session, new Date(T + 31 * DAY), config)).toBeNull();
  });

  it("never shortens a session", () => {
    // e.g. after the short window was lowered
    const session = { createdAt: new Date(T), expiresAt: new Date(T + 30 * DAY), persistent: false };
    expect(renewedSessionExpiry(session, new Date(T + HOUR * 2), config)).toBeNull();
  });
});
