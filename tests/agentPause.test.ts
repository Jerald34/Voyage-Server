import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorHandler } from "../src/http/errors";
import { getActiveAgentPause, pauseUntil, requireAgentNotPaused } from "../src/modules/agentPause/agentPause";
import { authRoutes, serializeUser } from "../src/modules/auth/authRoutes";

const NOW = new Date("2026-10-25T08:00:00.000Z");
const paused = (until: Date | null) => ({
  agentPausedAt: new Date("2026-10-25T07:00:00.000Z"),
  agentPausedUntil: until,
  agentPauseReason: "Unusually high usage"
});

describe("getActiveAgentPause", () => {
  it("is null when never paused", () => {
    expect(getActiveAgentPause({ agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null }, NOW)).toBeNull();
    expect(getActiveAgentPause(undefined, NOW)).toBeNull();
  });

  it("is active before its end and gives ISO dates and the reason", () => {
    expect(getActiveAgentPause(paused(new Date("2026-10-26T07:00:00.000Z")), NOW)).toEqual({
      pausedAt: "2026-10-25T07:00:00.000Z",
      until: "2026-10-26T07:00:00.000Z",
      reason: "Unusually high usage"
    });
  });

  it("ends by itself once the end time passes", () => {
    expect(getActiveAgentPause(paused(new Date("2026-10-25T08:00:00.000Z")), NOW)).toBeNull();
  });

  it("stays active with no end until lifted", () => {
    expect(getActiveAgentPause(paused(null), NOW)?.until).toBeNull();
  });
});

describe("pauseUntil", () => {
  it("adds the chosen duration, or null for until lifted", () => {
    expect(pauseUntil("1h", NOW)?.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(pauseUntil("24h", NOW)?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(pauseUntil("7d", NOW)?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(pauseUntil("indefinite", NOW)).toBeNull();
  });
});

describe("requireAgentNotPaused", () => {
  function app(authUser: unknown, limiter = vi.fn((_q, _s, next) => next())) {
    const a = express();
    a.use((req, _res, next) => {
      req.authUser = authUser as any;
      next();
    });
    a.post("/send", requireAgentNotPaused, limiter, (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return { a, limiter };
  }

  it("blocks a paused user with the end time and reason, before the quota limiter counts", async () => {
    const { a, limiter } = app(paused(null));
    const res = await request(a).post("/send");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "AGENT_PAUSED", until: null, reason: "Unusually high usage" });
    expect(limiter).not.toHaveBeenCalled();
  });

  it("lets everyone else through (including signed-out requests, which requireAuth handles)", async () => {
    expect((await request(app({ agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null }).a).post("/send")).status).toBe(200);
    expect((await request(app(undefined).a).post("/send")).status).toBe(200);
  });

  it("is mounted before the agent quota limiters in app.ts", () => {
    const source = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
    const messages = source.indexOf('"/agencies/:agencyId/agent/threads/:id/messages"');
    const images = source.indexOf('"/agencies/:agencyId/agent/threads/:id/images"');
    expect(source.indexOf("requireAgentNotPaused", messages)).toBeLessThan(source.indexOf("rateLimiters.agentMessageBurst", messages));
    expect(source.indexOf("requireAgentNotPaused", images)).toBeLessThan(source.indexOf("rateLimiters.agentImageUpload", images));
  });
});

describe("serializeUser", () => {
  const baseUser = {
    id: "u1", email: "a@b.com", displayName: "A", role: "USER", accountType: "AGENCY_USER", status: "ACTIVE",
    emailVerifiedAt: null, memberships: []
  };

  it("includes the active agent pause so the client knows before the first send", () => {
    const user = { ...baseUser, agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "Abuse" };
    expect(serializeUser(user as any).agentPause).toEqual({ pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "Abuse" });
  });

  it("is null when the pause has ended or there never was one", () => {
    const expired = {
      ...baseUser,
      agentPausedAt: new Date("2020-01-01T00:00:00.000Z"),
      agentPausedUntil: new Date("2020-01-02T00:00:00.000Z"),
      agentPauseReason: "Old"
    };
    expect(serializeUser(expired as any).agentPause).toBeNull();
    expect(serializeUser({ ...baseUser, agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null } as any).agentPause).toBeNull();
    // A user record that predates the columns (or a partial select) reads as not paused.
    expect(serializeUser(baseUser as any).agentPause).toBeNull();
  });

  it("never leaks the raw pause columns or who paused the user", () => {
    const user = {
      ...baseUser,
      agentPausedAt: new Date("2026-10-25T07:00:00.000Z"),
      agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"),
      agentPauseReason: "Abuse",
      agentPausedByUserId: "admin-secret-id"
    };
    const serialized = serializeUser(user as any);
    expect(serialized).not.toHaveProperty("agentPausedAt");
    expect(serialized).not.toHaveProperty("agentPausedUntil");
    expect(serialized).not.toHaveProperty("agentPauseReason");
    expect(serialized).not.toHaveProperty("agentPausedByUserId");
    expect(JSON.stringify(serialized)).not.toContain("admin-secret-id");
  });
});

describe("GET /auth/me", () => {
  it("answers with the signed-in user's own pause and no raw columns", async () => {
    const a = express();
    a.use((req, _res, next) => {
      req.authUser = {
        id: "u1", email: "a@b.com", displayName: "A", role: "USER", accountType: "AGENCY_USER", status: "ACTIVE",
        emailVerifiedAt: null, memberships: [],
        agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"),
        agentPauseReason: "High usage", agentPausedByUserId: "admin-secret-id"
      } as any;
      next();
    });
    a.use("/auth", authRoutes);
    a.use(errorHandler);

    const res = await request(a).get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.user.agentPause).toEqual({ pausedAt: "2026-10-25T07:00:00.000Z", until: "2999-01-01T00:00:00.000Z", reason: "High usage" });
    expect(JSON.stringify(res.body)).not.toContain("admin-secret-id");
    expect(res.body.user).not.toHaveProperty("agentPausedAt");
  });
});
