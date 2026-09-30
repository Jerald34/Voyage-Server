import express, { type Request, type RequestHandler } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROXY_CLIENT_IP_HEADER, PROXY_SECRET_HEADER, resolveClientIp } from "../src/http/clientIp";
import { createRateLimiters } from "../src/http/rateLimiters";

const PROXY_SECRET = "p".repeat(48);

type FakeUser = { id: string; agencyIds?: string[] };

// Test-only: lets a request pick its signed-in user and response status via headers.
const fakeSession: RequestHandler = (req, _res, next) => {
  const userId = req.get("x-test-user");
  if (userId) {
    const agencyIds = (req.get("x-test-agencies") ?? "").split(",").filter(Boolean);
    req.authUser = {
      id: userId,
      memberships: agencyIds.map((agencyId) => ({ agencyId }))
    } as unknown as Request["authUser"];
  }
  next();
};

function createApp(method: "get" | "post", path: string, limiters: RequestHandler[]) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(fakeSession);
  app[method](path, ...limiters, (req, res) => {
    const status = Number(req.get("x-test-status") ?? 200);
    res.status(status).json({ ok: status < 400 });
  });
  return app;
}

function asUser(test: request.Test, user: FakeUser, ip = "203.0.113.5") {
  return test
    .set("X-Forwarded-For", ip)
    .set("x-test-user", user.id)
    .set("x-test-agencies", (user.agencyIds ?? []).join(","));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("resolveClientIp", () => {
  function fakeRequest(headers: Record<string, string>, ip = "198.51.100.1") {
    const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return { ip, get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
  }

  it("uses the proxy-forwarded IP only when the proxy secret matches", () => {
    const headers = { [PROXY_SECRET_HEADER]: PROXY_SECRET, [PROXY_CLIENT_IP_HEADER]: "203.0.113.9" };
    expect(resolveClientIp(fakeRequest(headers), PROXY_SECRET)).toBe("203.0.113.9");
  });

  it("ignores a forwarded IP with a wrong or missing secret", () => {
    expect(
      resolveClientIp(
        fakeRequest({ [PROXY_SECRET_HEADER]: "x".repeat(48), [PROXY_CLIENT_IP_HEADER]: "203.0.113.9" }),
        PROXY_SECRET
      )
    ).toBe("198.51.100.1");
    expect(resolveClientIp(fakeRequest({ [PROXY_CLIENT_IP_HEADER]: "203.0.113.9" }), PROXY_SECRET)).toBe("198.51.100.1");
  });

  it("ignores forwarded headers when no proxy secret is configured", () => {
    const headers = { [PROXY_SECRET_HEADER]: PROXY_SECRET, [PROXY_CLIENT_IP_HEADER]: "203.0.113.9" };
    expect(resolveClientIp(fakeRequest(headers), "")).toBe("198.51.100.1");
  });

  it("ignores a forwarded value that is not an IP address", () => {
    const headers = { [PROXY_SECRET_HEADER]: PROXY_SECRET, [PROXY_CLIENT_IP_HEADER]: "not-an-ip" };
    expect(resolveClientIp(fakeRequest(headers), PROXY_SECRET)).toBe("198.51.100.1");
  });
});

describe("rate limiting behind the Next.js proxy", () => {
  it("gives each proxied client its own bucket when the proxy secret is configured", async () => {
    vi.stubEnv("API_PROXY_SECRET", PROXY_SECRET);
    vi.resetModules();
    const { createRateLimiters: createWithSecret } = await import("../src/http/rateLimiters");
    const app = createApp("post", "/shared/:token/comments", [createWithSecret().publicShareWrite]);
    const viaProxy = (clientIp: string) =>
      request(app)
        .post("/shared/share-token/comments")
        .set("X-Forwarded-For", "192.0.2.200") // the proxy's own IP, identical for everyone
        .set(PROXY_SECRET_HEADER, PROXY_SECRET)
        .set(PROXY_CLIENT_IP_HEADER, clientIp)
        .send({});

    for (let index = 0; index < 10; index += 1) {
      expect((await viaProxy("203.0.113.1")).status).toBe(200);
    }

    expect((await viaProxy("203.0.113.1")).status).toBe(429);
    expect((await viaProxy("203.0.113.2")).status).toBe(200);
  });

  it("does not let a client pick its own bucket with a spoofed client-IP header", async () => {
    const app = createApp("post", "/shared/:token/comments", [createRateLimiters().publicShareWrite]);
    const spoofed = (clientIp: string) =>
      request(app)
        .post("/shared/share-token/comments")
        .set("X-Forwarded-For", "203.0.113.50")
        .set(PROXY_CLIENT_IP_HEADER, clientIp)
        .send({});

    for (let index = 0; index < 10; index += 1) {
      await spoofed(`198.51.100.${index + 1}`);
    }

    expect((await spoofed("198.51.100.99")).status).toBe(429);
  });
});

describe("login protection", () => {
  function loginApp() {
    const { login, loginIp, loginAccount } = createRateLimiters();
    return createApp("post", "/auth/login", [login, loginIp, loginAccount]);
  }

  it("blocks one IP spraying failed logins across many accounts", async () => {
    const app = loginApp();

    for (let index = 0; index < 30; index += 1) {
      const response = await request(app)
        .post("/auth/login")
        .set("X-Forwarded-For", "203.0.113.70")
        .set("x-test-status", "401")
        .send({ email: `victim${index}@example.com`, password: "guess" });
      expect(response.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "203.0.113.70")
      .send({ email: "another@example.com", password: "guess" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("does not count successful logins from a shared IP against the spraying limit", async () => {
    const app = loginApp();

    for (let index = 0; index < 40; index += 1) {
      const response = await request(app)
        .post("/auth/login")
        .set("X-Forwarded-For", "203.0.113.71")
        .send({ email: `agent${index}@example.com`, password: "correct" });
      expect(response.status).toBe(200);
    }
  });

  it("blocks many IPs guessing one account's password", async () => {
    const app = loginApp();

    for (let index = 0; index < 30; index += 1) {
      await request(app)
        .post("/auth/login")
        .set("X-Forwarded-For", `198.51.100.${index + 1}`)
        .set("x-test-status", "401")
        .send({ email: "Target@Example.com ", password: "guess" });
    }

    const blocked = await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "198.51.100.200")
      .send({ email: "target@example.com", password: "guess" });

    expect(blocked.status).toBe(429);
  });
});

describe("per-user agent quotas", () => {
  const path = "/agencies/:agencyId/agent/threads/:id/messages";
  const url = "/agencies/agency-1/agent/threads/thread-1/messages";

  function agentApp() {
    const { agentMessageBurst, agentMessageDaily, agencyAgentMessageDaily } = createRateLimiters();
    return createApp("post", path, [agentMessageBurst, agentMessageDaily, agencyAgentMessageDaily]);
  }

  it("limits a user's message burst regardless of which IP they use", async () => {
    const app = agentApp();
    const alice = { id: "alice", agencyIds: ["agency-1"] };

    for (let index = 0; index < 10; index += 1) {
      expect((await asUser(request(app).post(url), alice, `203.0.113.${index + 1}`).send({})).status).toBe(200);
    }

    const blocked = await asUser(request(app).post(url), alice, "203.0.113.250").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.headers["ratelimit-policy"]).toContain('"agent-message-burst"');

    const bob = { id: "bob", agencyIds: ["agency-1"] };
    expect((await asUser(request(app).post(url), bob).send({})).status).toBe(200);
  });

  it("skips user quotas for anonymous requests (auth rejects them later)", async () => {
    const app = agentApp();

    for (let index = 0; index < 15; index += 1) {
      const response = await request(app).post(url).set("X-Forwarded-For", "203.0.113.9").send({});
      expect(response.status).toBe(200);
      expect(response.headers["ratelimit-policy"] ?? "").not.toContain("agent-message");
    }
  });

  it("only charges agency quota to members, and only for requests that succeed", async () => {
    vi.stubEnv("RATE_LIMIT_AGENCY_AGENT_MESSAGES_PER_DAY", "3");
    vi.resetModules();
    const { createRateLimiters: createWithEnv } = await import("../src/http/rateLimiters");
    const { agentMessageBurst, agencyAgentMessageDaily } = createWithEnv();
    const app = createApp("post", path, [agentMessageBurst, agencyAgentMessageDaily]);
    const outsider = { id: "mallory", agencyIds: ["other-agency"] };
    const member = (id: string) => ({ id, agencyIds: ["agency-1"] });

    // A non-member cannot burn the agency's quota.
    for (let index = 0; index < 5; index += 1) {
      await asUser(request(app).post(url), outsider).send({});
    }
    // Failed requests (e.g. a run that could not start) are refunded.
    await asUser(request(app).post(url), member("m0")).set("x-test-status", "409").send({});

    for (let index = 1; index <= 3; index += 1) {
      expect((await asUser(request(app).post(url), member(`m${index}`)).send({})).status).toBe(200);
    }

    const blocked = await asUser(request(app).post(url), member("m4")).send({});
    expect(blocked.status).toBe(429);
  });
});

describe("per-user write limits", () => {
  it("caps team invitations per signed-in user", async () => {
    const app = createApp("post", "/agencies/:agencyId/team", [createRateLimiters().teamInvite]);
    const owner = { id: "owner", agencyIds: ["agency-1"] };

    for (let index = 0; index < 20; index += 1) {
      await asUser(request(app).post("/agencies/agency-1/team"), owner).send({});
    }

    expect((await asUser(request(app).post("/agencies/agency-1/team"), owner).send({})).status).toBe(429);
  });
});
