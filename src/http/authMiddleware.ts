import type { NextFunction, Request, Response } from "express";
import type { Agency, AgencyMembership, User } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { ApiError } from "./errors";
import { hashToken } from "../services/tokens";
import { setSessionCookie } from "./cookies";
import { renewedSessionExpiry, sessionLifetimeConfig } from "../modules/auth/sessionLifetime";

type MembershipWithAgency = AgencyMembership & {
  agency: Pick<
    Agency,
    "id" | "status" | "name" | "businessPhone" | "businessEmail" | "city" | "country" | "rejectionReason" | "suspensionReason"
  >;
};

export type AuthUser = User & {
  memberships: MembershipWithAgency[];
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionId?: string;
      resolvedAgencyId?: string;
    }
  }
}

// Read once at startup; the env doesn't change while the process runs.
const sessionLifetime = sessionLifetimeConfig();

// Sliding expiry: each request from a signed-in user pushes the session's end
// forward (at most once an hour), so people who keep using the app stay signed in.
// This can throw (database errors, malformed rows); attachAuthUser treats renewal
// as best-effort and never lets a failure here block the request.
async function renewSession(
  response: Response,
  token: string,
  session: { id: string; expiresAt: Date; createdAt: Date; persistent: boolean },
  now: Date
) {
  const expiresAt = renewedSessionExpiry(session, now, sessionLifetime);
  if (!expiresAt) return;
  // Compare-and-set on the expiry we read: a parallel request that already renewed
  // the session, or a logout/password reset that deleted it, matches no row.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, expiresAt: session.expiresAt },
    data: { expiresAt }
  });
  if (count === 0) return; // deleted (logout/reset) or renewed by a parallel request
  if (session.persistent) {
    setSessionCookie(response, token, { persistent: true, expiresAt });
  }
}

export async function attachAuthUser(request: Request, response: Response, next: NextFunction) {
  const token = request.cookies?.[env.SESSION_COOKIE_NAME];

  if (!token || typeof token !== "string") {
    return next();
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              agency: {
                select: {
                  id: true,
                  status: true,
                  name: true,
                  businessPhone: true,
                  businessEmail: true,
                  city: true,
                  country: true,
                  rejectionReason: true,
                  suspensionReason: true
                }
              }
            }
          }
        }
      }
    }
  });

  const now = new Date();
  if (!session || session.expiresAt <= now || session.user.status !== "ACTIVE") {
    return next();
  }

  request.authUser = session.user;
  request.sessionId = session.id;
  // Logout clears the cookie itself; renewing here would also queue a stale Set-Cookie.
  const isLogout = request.method === "POST" && request.path === "/auth/logout";
  if (!isLogout) {
    try {
      await renewSession(response, token, session, now);
    } catch (error) {
      console.error("[auth] Session renewal skipped:", error);
    }
  }
  return next();
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }

  return next();
}

export function requireSuperAdmin(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }

  if (request.authUser.role !== "SUPER_ADMIN") {
    return next(new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required."));
  }

  return next();
}

export function requirePersonalAccount(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }
  if (request.authUser.accountType === "PENDING") {
    return next(new ApiError(403, "ACCOUNT_TYPE_PENDING", "Pick a personal or agency account to continue."));
  }
  if (request.authUser.accountType !== "PERSONAL") {
    return next(new ApiError(403, "ACCOUNT_TYPE_FORBIDS_PERSONAL", "This action is for personal accounts."));
  }
  return next();
}
