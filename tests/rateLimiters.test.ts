import express, { type RequestHandler } from "express";
import type { Store } from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createRateLimiters,
  hashRateLimitKey,
  initializeRateLimiterStoreLifecycle,
  type RateLimiterRedisClient,
  type RateLimiterRedisStoreConstructor
} from "../src/http/rateLimiters";

type RecordingBackend = {
  counts: Map<string, number>;
  resetTimes: Map<string, Date>;
};

function createRecordingBackend(): RecordingBackend {
  return {
    counts: new Map<string, number>(),
    resetTimes: new Map<string, Date>()
  };
}

class RecordingStore implements Store {
  localKeys = true;
  prefix?: string;

  private windowMs = 60_000;
  private backend: RecordingBackend;

  readonly incrementKeys: string[] = [];

  constructor(prefix?: string, backend: RecordingBackend = createRecordingBackend()) {
    this.prefix = prefix;
    this.backend = backend;
  }

  init(options: { windowMs: number }) {
    this.windowMs = options.windowMs;
  }

  async get(key: string) {
    const totalHits = this.backend.counts.get(key);
    if (totalHits === undefined) {
      return undefined;
    }

    return {
      totalHits,
      resetTime: this.backend.resetTimes.get(key)
    };
  }

  async increment(key: string) {
    this.incrementKeys.push(key);

    const totalHits = (this.backend.counts.get(key) ?? 0) + 1;
    this.backend.counts.set(key, totalHits);

    if (!this.backend.resetTimes.has(key)) {
      this.backend.resetTimes.set(key, new Date(Date.now() + this.windowMs));
    }

    return {
      totalHits,
      resetTime: this.backend.resetTimes.get(key)
    };
  }

  async decrement(key: string) {
    const totalHits = this.backend.counts.get(key);
    if (totalHits === undefined) {
      return;
    }

    if (totalHits <= 1) {
      this.backend.counts.delete(key);
      this.backend.resetTimes.delete(key);
      return;
    }

    this.backend.counts.set(key, totalHits - 1);
  }

  async resetKey(key: string) {
    this.backend.counts.delete(key);
    this.backend.resetTimes.delete(key);
  }
}

class CapturingRedisStore extends RecordingStore {
  readonly sendCommand: (...args: string[]) => Promise<unknown>;

  constructor(
    options: { prefix: string; sendCommand: (...args: string[]) => Promise<unknown> },
    backend: RecordingBackend = createRecordingBackend()
  ) {
    super(options.prefix, backend);
    this.sendCommand = options.sendCommand;
  }
}

function createRequestIpOverrideMiddleware(): RequestHandler {
  return (request, _response, next) => {
    const override = request.headers["x-test-ip-override"];
    if (override !== undefined) {
      const value = Array.isArray(override) ? override[0] : override;

      Object.defineProperty(request, "ip", {
        configurable: true,
        value: value === "__undefined__" ? undefined : value
      });
    }

    next();
  };
}

function createGetApp(path: string, limiter: RequestHandler, beforeLimiter?: RequestHandler) {
  const app = express();
  app.set("trust proxy", 1);
  app.get(path, beforeLimiter ?? ((_request, _response, next) => next()), limiter, (_request, response) => {
    response.json({ ok: true });
  });
  return app;
}

function createPostApp(path: string, limiter: RequestHandler, beforeLimiter?: RequestHandler) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post(path, beforeLimiter ?? ((_request, _response, next) => next()), limiter, (_request, response) => {
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

  it("uses one stable fallback bucket when request.ip is missing or malformed", async () => {
    const stores = new Map<string, RecordingStore>();
    const limiters = createRateLimiters({
      storeFactory: (prefix) => {
        const store = new RecordingStore(prefix);
        stores.set(prefix, store);
        return store;
      }
    });
    const app = createGetApp("/health", limiters.health, createRequestIpOverrideMiddleware());

    const missingResponse = await request(app)
      .get("/health")
      .set("X-Test-Ip-Override", "__undefined__");
    const malformedResponse = await request(app)
      .get("/health")
      .set("X-Test-Ip-Override", "not-an-ip");
    const malformedIpv6Response = await request(app)
      .get("/health")
      .set("X-Test-Ip-Override", ":::bad::ip:::");

    expect(missingResponse.status).toBe(200);
    expect(malformedResponse.status).toBe(200);
    expect(malformedIpv6Response.status).toBe(200);

    const healthStore = stores.get("voyage:rate-limit:health:");
    expect(healthStore?.incrementKeys).toHaveLength(3);
    expect(healthStore?.incrementKeys[0]).toBe(healthStore?.incrementKeys[1]);
    expect(healthStore?.incrementKeys[1]).toBe(healthStore?.incrementKeys[2]);
    expect(healthStore?.incrementKeys[0]).not.toBe("");
    expect(healthStore?.incrementKeys[1]).not.toContain("not-an-ip");
    expect(healthStore?.incrementKeys[2]).not.toContain(":::bad::ip:::");
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

  it("embeds policy identity in the key so shared stores cannot collide across policies", async () => {
    const backend = createRecordingBackend();
    const stores = new Map<string, RecordingStore>();
    const limiters = createRateLimiters({
      storeFactory: (prefix) => {
        const store = new RecordingStore(prefix, backend);
        stores.set(prefix, store);
        return store;
      }
    });
    const publicShareWriteApp = createPostApp("/shared/:token/comments", limiters.publicShareWrite);
    const reviewSubmitApp = createPostApp("/reviews/:tripToken/submit", limiters.reviewSubmit);

    await exhaustRequests(publicShareWriteApp, "/shared/shared-token/comments", 10, { body: "ok" });

    const reviewSubmitResponse = await request(reviewSubmitApp)
      .post("/reviews/shared-token/submit")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ rating: 5 });

    expect(reviewSubmitResponse.status).toBe(200);
    expect(stores.get("voyage:rate-limit:public-share-write:")?.incrementKeys[0]).not.toBe(
      stores.get("voyage:rate-limit:review-submit:")?.incrementKeys[0]
    );
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

  it("connects one Redis client, builds distinct prefixed Redis stores, and closes idempotently", async () => {
    const createdStores: CapturingRedisStore[] = [];
    const redisClient: RateLimiterRedisClient = {
      isOpen: true,
      connect: vi.fn(async () => {}),
      sendCommand: vi.fn(async () => "OK"),
      quit: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      on: vi.fn()
    };
    const lifecycle = await initializeRateLimiterStoreLifecycle({
      redisUrl: "redis://cache.example.test:6379/0",
      createRedisClient: () => redisClient,
      createRedisStore: class implements Store {
        localKeys = false;
        prefix?: string;

        private inner: CapturingRedisStore;

        constructor(options: { prefix: string; sendCommand: (...args: string[]) => Promise<unknown> }) {
          this.inner = new CapturingRedisStore(options);
          this.prefix = options.prefix;
          createdStores.push(this.inner);
        }

        init(options: { windowMs: number }) {
          this.inner.init(options);
        }

        get(key: string) {
          return this.inner.get(key);
        }

        increment(key: string) {
          return this.inner.increment(key);
        }

        decrement(key: string) {
          return this.inner.decrement(key);
        }

        resetKey(key: string) {
          return this.inner.resetKey(key);
        }
      } satisfies RateLimiterRedisStoreConstructor
    });

    const app = createGetApp(
      "/health",
      createRateLimiters({ storeFactory: lifecycle.storeFactory }).health
    );

    const response = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.90");

    expect(response.status).toBe(200);
    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(createdStores.map((store) => store.prefix)).toEqual([
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
    expect(new Set(createdStores.map((store) => store.prefix)).size).toBe(createdStores.length);

    await lifecycle.close();
    await lifecycle.close();

    expect(redisClient.quit).toHaveBeenCalledTimes(1);
    expect(redisClient.disconnect).not.toHaveBeenCalled();
  });

  it("fails initialization when the Redis client cannot connect", async () => {
    const redisClient: RateLimiterRedisClient = {
      connect: vi.fn(async () => {
        throw new Error("redis connect failed");
      }),
      sendCommand: vi.fn(async () => "OK"),
      disconnect: vi.fn(async () => {}),
      on: vi.fn()
    };

    await expect(
      initializeRateLimiterStoreLifecycle({
        redisUrl: "redis://cache.example.test:6379/0",
        createRedisClient: () => redisClient,
        createRedisStore: CapturingRedisStore as unknown as RateLimiterRedisStoreConstructor
      })
    ).rejects.toThrow("redis connect failed");
    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(redisClient.disconnect).toHaveBeenCalledTimes(1);
  });
});
