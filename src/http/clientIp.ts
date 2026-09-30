import type { Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { env } from "../config/env";

// Headers set by the Next.js `/api` proxy (Voyage-Client/proxy.js). The proxy runs
// on the app origin, so without them every proxied request reaches this server
// from the proxy's own IP. The secret proves the header came from our proxy and
// not from a client trying to pick its own rate-limit bucket.
export const PROXY_CLIENT_IP_HEADER = "x-voyage-client-ip";
export const PROXY_SECRET_HEADER = "x-voyage-proxy-secret";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function secretsMatch(presented: string, expected: string): boolean {
  // Compare fixed-length digests so neither the length nor the content of the
  // secret leaks through timing.
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * The originating client IP for this request: the proxy-forwarded IP when the
 * request carries a valid proxy secret, otherwise Express's `request.ip`
 * (which honours `trust proxy`).
 */
export function resolveClientIp(request: Request, proxySecret: string = env.API_PROXY_SECRET): string | undefined {
  if (proxySecret) {
    const presentedSecret = request.get(PROXY_SECRET_HEADER);
    const forwardedIp = request.get(PROXY_CLIENT_IP_HEADER)?.trim();

    if (presentedSecret && forwardedIp && isIP(forwardedIp) !== 0 && secretsMatch(presentedSecret, proxySecret)) {
      return forwardedIp;
    }
  }

  return typeof request.ip === "string" ? request.ip : undefined;
}
