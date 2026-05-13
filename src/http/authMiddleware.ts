import type { NextFunction, Request, Response } from "express";
import type { Agency, AgencyMembership, User } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { ApiError } from "./errors";
import { hashToken } from "../services/tokens";

type MembershipWithAgency = AgencyMembership & {
  agency: Pick<Agency, "id" | "status" | "name" | "city" | "country" | "rejectionReason" | "suspensionReason">;
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

export async function attachAuthUser(request: Request, _response: Response, next: NextFunction) {
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

  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    return next();
  }

  request.authUser = session.user;
  request.sessionId = session.id;
  return next();
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }

  return next();
}

export function requireAdmin(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }

  if (request.authUser.role !== "ADMIN") {
    return next(new ApiError(403, "ADMIN_REQUIRED", "Admin access is required."));
  }

  return next();
}
