import express, { type RequestHandler } from "express";
import type { Store } from "express-rate-limit";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRateLimiters, hashRateLimitKey } from "../src/http/rateLimiters";

class RecordingStore implements Store {
  localKeys = true;
  prefix?: string;

  private windowMs = 60_000;
  private counts = new Map<string, number>();
  private resetTimes = new Map<string, Date>();

  readonly incrementKeys: string[] = [];

  constructor(prefix?: string) {
    this.prefix = prefix;
  }

  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }

  async get(key: string) {
    const totalHits = this.counts.get(key);
    if (totalHits === undefined) {
      return undefined;
    }

    return {
      totalHits,
      resetTime: this.resetTimes.get(key)
    };
  }

  async increment(key: string) {
    this.incrementKeys.push(key);

    const totalHits = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, totalHits);

    if (!this.resetTimes.has(key)) {
      this.resetTimes.set(key, new Date(Date.now() + this.windowMs));
    }

    return {
      totalHits,
      resetTime: this.resetTimes.get(key)
    };
  }

  async decrement(key: string) {
    const totalHits = this.counts.get(key);
    if (totalHits === undefined) {
      return;
    }

    if (totalHits <= 1) {
      this.counts.delete(key);
      this.resetTimes.delete(key);
      return;
    }

    this.counts.set(key, totalHits - 1);
  }

  async resetKey(key: string) {
    this.counts.delete(key);
    this.resetTimes.delete(key);
  }
}

function createGetApp(path: string, limiter: RequestHandler) {
  const app = express();
  app.set("trust proxy", 1);
  app.get(path, limiter, (_request, response) => {
    response.json({ ok: true });
  });
  return app;
}

function createPostApp(path: string, limiter: RequestHandler) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post(path, limiter, (_request, response) => {
    response.json({ ok: true });
  });
  return app;
}

async function exhaustRequests(app: express.Express, path: string, count: number, body?: unknown) {
  for (let index = 0; index < count; index += 1) {
    await request(app)
      .post(path)
      .set("X-Forwarded-For", "203.0.113.10")
      .send(body ?? {});
  }
}

describe("rateLimiters", () => {
  it("returns the standard 429 payload after the policy threshold is exceeded", async () => {
    const { publicShareWrite } = createRateLimiters();
    const app = createPostApp("/shared/:token/comments", publicShareWrite);

    await exhaustRequests(app, "/shared/share-token/comments", 10, { body: "ok" });

    const response = await request(app)
      .post("/shared/share-token/comments")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ body: "ok" });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later."
      }
    });
  });

  it("hashes with deterministic SHA-256 output and never returns the raw value", () => {
    const hash = hashRateLimitKey("abc");

    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("abc");
  });

  it("normalizes login emails before hashing and excludes the raw email from the key", async () => {
    const stores = new Map<string, RecordingStore>();
    const limiters = createRateLimiters({
      storeFactory: (prefix) => {
        const store = new RecordingStore(prefix);
        stores.set(prefix, store);
        return store;
      }
    });
    const app = createPostApp("/auth/login", limiters.login);

    await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "203.0.113.20")
      .send({ email: "  USER@Example.com  " });

    await request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", "203.0.113.20")
      .send({ email: "user@example.com" });

    const loginStore = stores.get("voyage:rate-limit:login:");
    expect(loginStore).toBeDefined();
    expect(loginStore?.incrementKeys).toHaveLength(2);
    expect(loginStore?.incrementKeys[0]).toBe(loginStore?.incrementKeys[1]);
    expect(loginStore?.incrementKeys[0]).not.toContain("USER@Example.com");
    expect(loginStore?.incrementKeys[0]).not.toContain("user@example.com");
  });

  it("hashes public token values before using them as rate limit keys", async () => {
    const stores = new Map<string, RecordingStore>();
    const limiters = createRateLimiters({
      storeFactory: (prefix) => {
        const store = new RecordingStore(prefix);
        stores.set(prefix, store);
        return store;
      }
    });
    const app = createPostApp("/shared/:token/comments", limiters.publicShareWrite);

    await request(app)
      .post("/shared/raw-token-ABC/comments")
      .set("X-Forwarded-For", "203.0.113.30")
      .send({ body: "ok" });

    const store = stores.get("voyage:rate-limit:public-share-write:");
    expect(store).toBeDefined();
    expect(store?.incrementKeys).toHaveLength(1);
    expect(store?.incrementKeys[0]).not.toContain("raw-token-ABC");
  });

  it("passes unique policy prefixes into the store factory and uses the returned store", async () => {
    const prefixes: string[] = [];
    const stores = new Map<string, RecordingStore>();
    const limiters = createRateLimiters({
      storeFactory: (prefix) => {
        prefixes.push(prefix);
        const store = new RecordingStore(prefix);
        stores.set(prefix, store);
        return store;
      }
    });
    const app = createGetApp("/health", limiters.health);

    await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.40");

    expect(prefixes).toEqual([
      "voyage:rate-limit:baseline:",
      "voyage:rate-limit:health:",
      "voyage:rate-limit:login:",
      "voyage:rate-limit:registration:",
      "voyage:rate-limit:email-request:",
      "voyage:rate-limit:token-confirm:",
      "voyage:rate-limit:oauth:",
      "voyage:rate-limit:invitation-lookup:",
      "voyage:rate-limit:public-share-read:",
      "voyage:rate-limit:public-share-write:",
      "voyage:rate-limit:review-check:",
      "voyage:rate-limit:review-submit:",
      "voyage:rate-limit:photo-proxy:"
    ]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(stores.get("voyage:rate-limit:health:")?.incrementKeys).toHaveLength(1);
  });

  it("creates isolated in-memory counters for separate createRateLimiters calls", async () => {
    const firstApp = createPostApp("/reviews/:tripToken/submit", createRateLimiters().reviewSubmit);
    const secondApp = createPostApp("/reviews/:tripToken/submit", createRateLimiters().reviewSubmit);

    await exhaustRequests(firstApp, "/reviews/trip-token/submit", 10, { rating: 5 });

    const blockedResponse = await request(firstApp)
      .post("/reviews/trip-token/submit")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ rating: 5 });

    const freshResponse = await request(secondApp)
      .post("/reviews/trip-token/submit")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ rating: 5 });

    expect(blockedResponse.status).toBe(429);
    expect(freshResponse.status).toBe(200);
  });

  it("emits standard rate limit headers and omits legacy X-RateLimit headers", async () => {
    const { health } = createRateLimiters();
    const app = createGetApp("/health", health);

    const response = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.60");

    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-limit"]).toBe("120");
    expect(response.headers["ratelimit-remaining"]).toBeDefined();
    expect(response.headers["ratelimit-reset"]).toBeDefined();
    expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(response.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(response.headers["x-ratelimit-reset"]).toBeUndefined();
  });
});
