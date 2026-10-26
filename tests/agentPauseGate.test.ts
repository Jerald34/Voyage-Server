// tests/agentPauseGate.test.ts
// End to end through the real createApp(): a paused user is stopped at the gate in app.ts
// before the quota limiters and before the agent router; everyone else is not.
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGES_PATH = `/agencies/${AGENCY_ID}/agent/threads/${THREAD_ID}/messages`;
const IMAGES_PATH = `/agencies/${AGENCY_ID}/agent/threads/${THREAD_ID}/images`;
const THREADS_PATH = `/agencies/${AGENCY_ID}/agent/threads`;

const mocks = vi.hoisted(() => {
  const handler = () => vi.fn((_request: unknown, response: any) => response.status(202).json({ reached: true }));
  return {
    users: {} as Record<string, Record<string, unknown>>,
    requireVerifiedAgencyMember: vi.fn(),
    controller: {
      listThreads: handler(),
      createThread: handler(),
      getThread: handler(),
      listThreadMessages: handler(),
      deleteThread: handler(),
      updateThreadTitle: handler(),
      saveItineraryThread: handler(),
      createMessage: handler(),
      uploadChatImages: handler(),
      runStream: handler(),
      cancelRun: handler(),
      listRunEvents: handler()
    }
  };
});

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

// Stands in for the session lookup: the x-test-user header picks which signed-in user the request belongs to.
vi.mock("../src/http/authMiddleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/http/authMiddleware")>()),
  attachAuthUser: (request: any, _response: unknown, next: () => void) => {
    const key = request.get("x-test-user");
    if (key && mocks.users[key]) request.authUser = mocks.users[key];
    next();
  }
}));

vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/agent/agentController", () => mocks.controller);

import { createApp } from "../src/app";
import { env } from "../src/config/env";

const HOUR_MS = 60 * 60 * 1000;
const notPaused = { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null };
const baseUser = { role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", memberships: [] };

function signedIn(id: string, pause: Record<string, unknown> = notPaused) {
  mocks.users[id] = { id, email: `${id}@hops.travel`, ...baseUser, ...pause };
  return id;
}

function post(path: string, userKey: string) {
  return request(createApp()).post(path).set("x-test-user", userKey).send({});
}

describe("agent pause gate (real app)", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.users)) delete mocks.users[key];
    for (const handler of Object.values(mocks.controller)) handler.mockClear();
    mocks.requireVerifiedAgencyMember.mockReset();
    mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID } });
  });

  it("answers a paused user's message with 403 AGENT_PAUSED, the end time and the reason, and never reaches the agent", async () => {
    const until = new Date(Date.now() + 2 * HOUR_MS);
    const user = signedIn("paused-timed", { agentPausedAt: new Date(Date.now() - HOUR_MS), agentPausedUntil: until, agentPauseReason: "Unusually high usage" });

    const res = await post(MESSAGES_PATH, user);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "AGENT_PAUSED", until: until.toISOString(), reason: "Unusually high usage" });
    expect(mocks.controller.createMessage).not.toHaveBeenCalled();
    expect(mocks.requireVerifiedAgencyMember).not.toHaveBeenCalled();
  });

  it("reports until: null for a pause with no end", async () => {
    const user = signedIn("paused-open", { agentPausedAt: new Date(Date.now() - HOUR_MS), agentPausedUntil: null, agentPauseReason: "Abuse" });

    const res = await post(MESSAGES_PATH, user);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "AGENT_PAUSED", until: null, reason: "Abuse" });
    expect(mocks.controller.createMessage).not.toHaveBeenCalled();
  });

  it("also blocks chat image uploads", async () => {
    const user = signedIn("paused-images", { agentPausedAt: new Date(Date.now() - HOUR_MS), agentPausedUntil: null, agentPauseReason: "Abuse" });

    const res = await post(IMAGES_PATH, user);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AGENT_PAUSED");
    expect(mocks.controller.uploadChatImages).not.toHaveBeenCalled();
  });

  it("lets a paused user keep reading their threads; only sending is gated", async () => {
    const user = signedIn("paused-reader", { agentPausedAt: new Date(Date.now() - HOUR_MS), agentPausedUntil: null, agentPauseReason: "Abuse" });

    const res = await request(createApp()).get(THREADS_PATH).set("x-test-user", user);

    expect(res.status).toBe(202);
    expect(mocks.controller.listThreads).toHaveBeenCalledTimes(1);
  });

  it("does not block a user who was never paused", async () => {
    const user = signedIn("active");

    const res = await post(MESSAGES_PATH, user);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ reached: true });
    expect(mocks.controller.createMessage).toHaveBeenCalledTimes(1);
  });

  it("does not block a user whose pause has already ended", async () => {
    const user = signedIn("expired", { agentPausedAt: new Date(Date.now() - 3 * HOUR_MS), agentPausedUntil: new Date(Date.now() - HOUR_MS), agentPauseReason: "Old" });

    const res = await post(MESSAGES_PATH, user);

    expect(res.status).toBe(202);
    expect(mocks.controller.createMessage).toHaveBeenCalledTimes(1);
  });

  it("leaves signed-out requests to the agent router's auth check (401, not a pause)", async () => {
    const res = await request(createApp()).post(MESSAGES_PATH).send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe("AGENT_PAUSED");
    expect(mocks.controller.createMessage).not.toHaveBeenCalled();
  });

  it("stops a paused user before the quota limiters, so blocked attempts use up none of their allowance", async () => {
    const app = createApp();
    const pausedAt = new Date(Date.now() - HOUR_MS);
    const user = signedIn("quota-check", { agentPausedAt: pausedAt, agentPausedUntil: null, agentPauseReason: "Abuse" });
    const attempts = env.RATE_LIMIT_AGENT_MESSAGES_PER_MINUTE + 3;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await request(app).post(MESSAGES_PATH).set("x-test-user", user).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AGENT_PAUSED");
    }

    // Lifted: the same user, same app, same limiter stores. Had the blocked attempts counted, this would be 429.
    mocks.users[user] = { id: user, email: `${user}@hops.travel`, ...baseUser, ...notPaused };
    const res = await request(app).post(MESSAGES_PATH).set("x-test-user", user).send({});
    expect(res.status).toBe(202);
    expect(mocks.controller.createMessage).toHaveBeenCalledTimes(1);
  });

  it("does the same for image uploads: blocked attempts use up none of the hourly upload allowance", async () => {
    const app = createApp();
    const user = signedIn("image-quota-check", { agentPausedAt: new Date(Date.now() - HOUR_MS), agentPausedUntil: null, agentPauseReason: "Abuse" });

    // The upload limiter allows 30 an hour; go well past it while paused.
    for (let attempt = 0; attempt < 33; attempt += 1) {
      const res = await request(app).post(IMAGES_PATH).set("x-test-user", user).send({});
      expect(res.status).toBe(403);
    }

    mocks.users[user] = { id: user, email: `${user}@hops.travel`, ...baseUser, ...notPaused };
    const res = await request(app).post(IMAGES_PATH).set("x-test-user", user).send({});
    expect(res.status).toBe(202);
    expect(mocks.controller.uploadChatImages).toHaveBeenCalledTimes(1);
  });
});
