import type { RequestHandler, Request } from "express";
import rateLimit, { MemoryStore, ipKeyGenerator, type Store } from "express-rate-limit";
import { createHash } from "node:crypto";
import { env } from "../config/env";

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

type RateLimiterName = keyof RateLimiterSet;
type RateLimiterConfig = {
  name: RateLimiterName;
  windowMs: number;
  limit: number;
  secondaryKey?: (request: Request) => string;
};
type StoreFactory = (prefix: string) => Store | undefined;

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

function buildRateLimitKey(request: Request, secondaryKey?: string): string {
  const keyParts = [ipKeyGenerator(request.ip)];
  if (secondaryKey !== undefined) {
    keyParts.push(hashRateLimitKey(secondaryKey));
  }
  return keyParts.join(":");
}

function createMemoryStore(prefix: string): Store {
  const store = new MemoryStore();
  store.prefix = prefix;
  return store;
}

function createLimiter(config: RateLimiterConfig, storeFactory?: StoreFactory): RequestHandler {
  const prefix = `${env.RATE_LIMIT_PREFIX}${config.name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:`;
  const store = storeFactory?.(prefix) ?? createMemoryStore(prefix);

  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: (request) => buildRateLimitKey(request, config.secondaryKey?.(request)),
    handler: (_request, response) => {
      response.status(429).json(RATE_LIMIT_EXCEEDED_RESPONSE);
    }
  });
}

export function createRateLimiters(options?: { storeFactory?: (prefix: string) => Store | undefined }): RateLimiterSet {
  const storeFactory = options?.storeFactory;

  return {
    baseline: createLimiter({ name: "baseline", windowMs: 15 * 60 * 1000, limit: env.RATE_LIMIT_BASELINE_MAX }, storeFactory),
    health: createLimiter({ name: "health", windowMs: 60 * 1000, limit: 120 }, storeFactory),
    login: createLimiter(
      { name: "login", windowMs: 15 * 60 * 1000, limit: 10, secondaryKey: normalizeLoginEmail },
      storeFactory
    ),
    registration: createLimiter({ name: "registration", windowMs: 60 * 60 * 1000, limit: 5 }, storeFactory),
    emailRequest: createLimiter({ name: "emailRequest", windowMs: 60 * 60 * 1000, limit: 5 }, storeFactory),
    tokenConfirm: createLimiter({ name: "tokenConfirm", windowMs: 60 * 60 * 1000, limit: 20 }, storeFactory),
    oauth: createLimiter({ name: "oauth", windowMs: 15 * 60 * 1000, limit: 20 }, storeFactory),
    invitationLookup: createLimiter({ name: "invitationLookup", windowMs: 15 * 60 * 1000, limit: 30 }, storeFactory),
    publicShareRead: createLimiter(
      { name: "publicShareRead", windowMs: 60 * 1000, limit: 60, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    publicShareWrite: createLimiter(
      { name: "publicShareWrite", windowMs: 60 * 1000, limit: 10, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    reviewCheck: createLimiter(
      { name: "reviewCheck", windowMs: 60 * 60 * 1000, limit: 30, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    reviewSubmit: createLimiter(
      { name: "reviewSubmit", windowMs: 60 * 60 * 1000, limit: 10, secondaryKey: readTokenFromParams },
      storeFactory
    ),
    photoProxy: createLimiter({ name: "photoProxy", windowMs: 60 * 1000, limit: 60 }, storeFactory)
  };
}
