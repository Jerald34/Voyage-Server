// src/modules/agentPause/agentPause.ts
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../http/errors";

export type AgentPauseDuration = "1h" | "24h" | "7d" | "indefinite";

export interface AgentPauseFields {
  agentPausedAt: Date | null;
  agentPausedUntil: Date | null;
  agentPauseReason: string | null;
}

/** What clients see. `until: null` means "until an administrator lifts it". */
export interface ActiveAgentPause {
  pausedAt: string;
  until: string | null;
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DURATION_MS: Record<Exclude<AgentPauseDuration, "indefinite">, number> = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS
};

/** The single rule for "is this user's agent paused right now?". Expiry is checked here, so no job is needed. */
export function getActiveAgentPause(user: AgentPauseFields | null | undefined, now: Date = new Date()): ActiveAgentPause | null {
  if (!user?.agentPausedAt) return null;
  if (user.agentPausedUntil && user.agentPausedUntil.getTime() <= now.getTime()) return null;
  return {
    pausedAt: user.agentPausedAt.toISOString(),
    until: user.agentPausedUntil ? user.agentPausedUntil.toISOString() : null,
    reason: user.agentPauseReason ?? ""
  };
}

export function pauseUntil(duration: AgentPauseDuration, from: Date): Date | null {
  return duration === "indefinite" ? null : new Date(from.getTime() + DURATION_MS[duration]);
}

/**
 * Mounted before the agent quota limiters, so a paused user's attempt never uses up their
 * daily allowance. Signed-out requests pass through; the agent router's requireAuth answers them.
 */
export function requireAgentNotPaused(request: Request, _response: Response, next: NextFunction) {
  const pause = getActiveAgentPause(request.authUser);
  if (pause) {
    return next(new ApiError(403, "AGENT_PAUSED", "The agent is paused for your account.", { ...pause }));
  }
  return next();
}
