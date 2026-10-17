import { env } from "../../config/env";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Renew a session at most once an hour, so normal use doesn't write on every request. */
export const SESSION_RENEW_INTERVAL_MS = HOUR_MS;

export type SessionLifetimeConfig = {
  /** Idle window for "Keep me signed in" sessions. */
  persistentTtlMs: number;
  /** Idle window for sessions whose cookie ends when the browser closes. */
  shortTtlMs: number;
  /** Hard limit from sign-in, however active the user is. */
  maxAgeMs: number;
  renewIntervalMs: number;
};

/** Env-derived defaults; any field can be overridden (tests, alternative deployments). */
export function sessionLifetimeConfig(overrides: Partial<SessionLifetimeConfig> = {}): SessionLifetimeConfig {
  return {
    persistentTtlMs: env.SESSION_TTL_DAYS * DAY_MS,
    shortTtlMs: env.SESSION_SHORT_TTL_HOURS * HOUR_MS,
    maxAgeMs: env.SESSION_MAX_AGE_DAYS * DAY_MS,
    renewIntervalMs: SESSION_RENEW_INTERVAL_MS,
    ...overrides
  };
}

function idleWindowMs(persistent: boolean, config: SessionLifetimeConfig) {
  return persistent ? config.persistentTtlMs : config.shortTtlMs;
}

export function initialSessionExpiry(now: Date, persistent: boolean, config: SessionLifetimeConfig): Date {
  return new Date(now.getTime() + Math.min(idleWindowMs(persistent, config), config.maxAgeMs));
}

/**
 * The new expiry for a session that was just used, or null when it doesn't need
 * a write yet (renewed under an hour ago, or already at the hard cap).
 */
export function renewedSessionExpiry(
  session: { expiresAt: Date; createdAt: Date; persistent: boolean },
  now: Date,
  config: SessionLifetimeConfig
): Date | null {
  // An expired token must never be brought back to life by a renewal.
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  const target = Math.min(
    now.getTime() + idleWindowMs(session.persistent, config),
    session.createdAt.getTime() + config.maxAgeMs
  );
  if (target - session.expiresAt.getTime() < config.renewIntervalMs) {
    return null;
  }
  return new Date(target);
}
