import type { RequestHandler, Request } from "express";
import rateLimit, { MemoryStore, ipKeyGenerator, type Store } from "express-rate-limit";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { env } from "../config/env";
import { ApiError } from "./errors";

const moduleRequire = createRequire(__filename);

export type RateLimiterSet = {
  baseline: RequestHandler;
  health: RequestHandler;
  login: RequestHandler;
  registration: RequestHandler;
  emailRequest: RequestHandler;
  tokenConfirm: RequestHandler;
  oauth: RequestHandler;
  invitationLookup: RequestHandler;
  publicShareRead: RequestHandler;
  publicShareWrite: RequestHandler;
  reviewCheck: RequestHandler;
  reviewSubmit: RequestHandler;
  photoProxy: RequestHandler;
};

const RATE_LIMIT_EXCEEDED_RESPONSE = {
  error: {
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please try again later."
  }
} as const;
const INVALID_IP_BUCKET = "invalid-ip";

type RateLimiterName = keyof RateLimiterSet;
type RateLimiterConfig = {
  name: RateLimiterName;
  policyId: string;
  windowMs: number;
  limit: number;
  passOnStoreError?: boolean;
  secondaryKey?: (request: Request) => string;
};
export type RateLimiterStoreFactory = (prefix: string) => Store | undefined;

type RedisStoreOptions = {
  prefix: string;
  sendCommand: (...args: string[]) => Promise<unknown>;
};

export type RateLimiterRedisClient = {
  connect(): Promise<void>;
  sendCommand(args: string[]): Promise<unknown>;
  quit?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  on?: (event: string, listener: (error: Error) => void) => unknown;
  isOpen?: boolean;
};

export type RateLimiterRedisStoreConstructor = new (options: RedisStoreOptions) => Store;

export type RateLimiterStoreLifecycle = {
  close(): Promise<void>;
  storeFactory?: RateLimiterStoreFactory;
  usingRedis: boolean;
};

type RedisDependencyBundle = {
  createRedisClient: (url: string) => RateLimiterRedisClient;
  RedisStore: RateLimiterRedisStoreConstructor;
};

type InitializeRateLimiterStoreLifecycleOptions = {
  redisUrl?: string;
  createRedisClient?: (url: string) => RateLimiterRedisClient;
  createRedisStore?: RateLimiterRedisStoreConstructor;
  onRedisError?: (error: Error) => void;
};

export function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLoginEmail(request: Request): string {
  const email = request.body && typeof request.body === "object" ? (request.body as { email?: unknown }).email : undefined;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function readTokenFromParams(request: Request): string {
  const token = request.params.token ?? request.params.tripToken;
  return typeof token === "string" ? token : "";
}

function resolveIpBucket(request: Request): string {
  const requestIp = typeof request.ip === "string" ? request.ip : "";
  return isIP(requestIp) === 0 ? INVALID_IP_BUCKET : ipKeyGenerator(requestIp);
}

function buildRateLimitKey(policyId: string, request: Request, secondaryKey?: string): string {
  const keyParts = [`policy=${policyId}`, `ip=${resolveIpBucket(request)}`];
  if (secondaryKey !== undefined) {
    keyParts.push(`subject=${hashRateLimitKey(secondaryKey)}`);
  }
  return keyParts.join("|");
}

function createMemoryStore(prefix: string): Store {
  const memoryStore = new MemoryStore();

  return {
    prefix,
    localKeys: memoryStore.localKeys,
    init: memoryStore.init.bind(memoryStore),
    get: memoryStore.get.bind(memoryStore),
    increment: memoryStore.increment.bind(memoryStore),
    decrement: memoryStore.decrement.bind(memoryStore),
    resetKey: memoryStore.resetKey.bind(memoryStore),
    resetAll: memoryStore.resetAll.bind(memoryStore),
    shutdown: memoryStore.shutdown?.bind(memoryStore)
  };
}

function createSensitiveStoreAdapter(store: Store): Store {
  return {
    prefix: store.prefix,
    localKeys: store.localKeys,
    init: store.init?.bind(store),
    get: store.get?.bind(store),
    increment: async (key) => {
      try {
        return await store.increment(key);
      } catch {
        throw new ApiError(
          503,
          "RATE_LIMIT_UNAVAILABLE",
          "Request protection is temporarily unavailable. Please try again later."
        );
      }
    },
    decrement: store.decrement.bind(store),
    resetKey: store.resetKey.bind(store),
    resetAll: store.resetAll?.bind(store),
    shutdown: store.shutdown?.bind(store)
  };
}

function createLimiter(config: RateLimiterConfig, storeFactory?: RateLimiterStoreFactory): RequestHandler {
  const prefix = `${env.RATE_LIMIT_PREFIX}${config.policyId}:`;
  const sourceStore = storeFactory?.(prefix) ?? createMemoryStore(prefix);
  const store = config.passOnStoreError ? sourceStore : createSensitiveStoreAdapter(sourceStore);

  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: config.passOnStoreError ?? false,
    logger: {
      error: (_error, message) => {
        console.error(message ?? "express-rate-limit error");
      },
      warn: (_error, message) => {
        console.warn(message ?? "express-rate-limit warning");
      }
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (request) => buildRateLimitKey(config.policyId, request, config.secondaryKey?.(request)),
    handler: (_request, response) => {
      response.status(429).json(RATE_LIMIT_EXCEEDED_RESPONSE);
    }
  });
}

function loadRedisDependencies(): RedisDependencyBundle {
  const redisModule = moduleRequire("redis") as {
    createClient?: (options: { url: string }) => RateLimiterRedisClient;
  };
  const rateLimitRedisModule = moduleRequire("rate-limit-redis") as {
    RedisStore?: RateLimiterRedisStoreConstructor;
    default?: RateLimiterRedisStoreConstructor;
  };

  if (typeof redisModule.createClient !== "function") {
    throw new Error("The installed redis package does not expose createClient().");
  }

  const RedisStore = rateLimitRedisModule.RedisStore ?? rateLimitRedisModule.default;
  if (typeof RedisStore !== "function") {
    throw new Error("The installed rate-limit-redis package does not expose a RedisStore constructor.");
  }

  return {
    createRedisClient: (url) => redisModule.createClient!({ url }),
    RedisStore
  };
}

async function disconnectRedisClient(client: RateLimiterRedisClient): Promise<void> {
  if (client.isOpen === false) {
    return;
  }

  if (typeof client.quit === "function") {
    try {
      await client.quit();
      return;
    } catch (error) {
      if (typeof client.disconnect !== "function") {
        throw error;
      }
    }
  }

  if (typeof client.disconnect === "function") {
    await client.disconnect();
  }
}

export async function initializeRateLimiterStoreLifecycle(
  options: InitializeRateLimiterStoreLifecycleOptions = {}
): Promise<RateLimiterStoreLifecycle> {
  const redisUrl = (options.redisUrl ?? env.RATE_LIMIT_REDIS_URL).trim();
  if (!redisUrl) {
    return {
      usingRedis: false,
      close: async () => {}
    };
  }

  const dependencies = options.createRedisClient === undefined || options.createRedisStore === undefined
    ? loadRedisDependencies()
    : undefined;
  const createRedisClient = options.createRedisClient ?? dependencies!.createRedisClient;
  const RedisStore = options.createRedisStore ?? dependencies!.RedisStore;
  const redisClient = createRedisClient(redisUrl);
  const onRedisError = options.onRedisError ?? ((error: Error) => {
    console.error("[rate-limit] Redis client error", error);
  });

  redisClient.on?.("error", onRedisError);

  try {
    await redisClient.connect();
  } catch (error) {
    await disconnectRedisClient(redisClient);
    throw error;
  }

  let closed = false;

  return {
    usingRedis: true,
    storeFactory: (prefix) =>
      new RedisStore({
        prefix,
        sendCommand: (...args: string[]) => redisClient.sendCommand(args)
      }),
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await disconnectRedisClient(redisClient);
    }
  };
}

export function createRateLimiters(options?: { storeFactory?: RateLimiterStoreFactory }): RateLimiterSet {
  const storeFactory = options?.storeFactory;

  return {
    baseline: createLimiter(
      {
        name: "baseline",
        policyId: "baseline",
        windowMs: 15 * 60 * 1000,
        limit: env.RATE_LIMIT_BASELINE_MAX,
        passOnStoreError: true
      },
      storeFactory
    ),
    health: createLimiter(
      { name: "health", policyId: "health", windowMs: 60 * 1000, limit: 120, passOnStoreError: true },
      storeFactory
    ),
    login: createLimiter(
      { name: "login", policyId: "login", windowMs: 15 * 60 * 1000, limit: 10, secondaryKey: normalizeLoginEmail },
      storeFactory
    ),
    registration: createLimiter({ name: "registration", policyId: "registration", windowMs: 60 * 60 * 1000, limit: 5 }, storeFactory),
    emailRequest: createLimiter({ name: "emailRequest", policyId: "email-request", windowMs: 60 * 60 * 1000, limit: 5 }, storeFactory),
    tokenConfirm: createLimiter({ name: "tokenConfirm", policyId: "token-confirm", windowMs: 60 * 60 * 1000, limit: 20 }, storeFactory),
    oauth: createLimiter({ name: "oauth", policyId: "oauth", windowMs: 15 * 60 * 1000, limit: 20 }, storeFactory),
    invitationLookup: createLimiter({ name: "invitationLookup", policyId: "invitation-lookup", windowMs: 15 * 60 * 1000, limit: 30 }, storeFactory),
    publicShareRead: createLimiter(
      { name: "publicShareRead", policyId: "public-share-read", windowMs: 60 * 1000, limit: 60, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    publicShareWrite: createLimiter(
      { name: "publicShareWrite", policyId: "public-share-write", windowMs: 60 * 1000, limit: 10, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    reviewCheck: createLimiter(
      { name: "reviewCheck", policyId: "review-check", windowMs: 60 * 60 * 1000, limit: 30, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    reviewSubmit: createLimiter(
      { name: "reviewSubmit", policyId: "review-submit", windowMs: 60 * 60 * 1000, limit: 10, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    photoProxy: createLimiter({ name: "photoProxy", policyId: "photo-proxy", windowMs: 60 * 1000, limit: 60 }, storeFactory)
  };
}
