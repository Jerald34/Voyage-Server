import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getUserCapabilities } from "../../services/capabilities";
import { clearSessionCookie, setSessionCookie } from "../../http/cookies";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { env } from "../../config/env";
import { verifyAppleIdToken, verifyGoogleAuthorizationCode } from "../../services/oauth";
import {
  emailCheckSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema
} from "./authSchemas";
import { authService } from "./authService";

export const authRoutes = Router();

export function serializeUser(user: NonNullable<Express.Request["authUser"]>) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    capabilities: getUserCapabilities(user),
    memberships: user.memberships.map(m => ({
      agencyId: m.agencyId,
      role: m.role,
      status: m.status,
      agency: m.agency
    }))
  };
}

authRoutes.post("/register", async (request, response, next) => {
  try {
    const input = registerSchema.parse(request.body);
    const result = await authService.registerWithEmail(input);
    setSessionCookie(response, result.sessionToken);
    response.status(201).json({ user: serializeUser(result.user as NonNullable<Express.Request["authUser"]>) });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/login", async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const result = await authService.loginWithEmail(input);
    setSessionCookie(response, result.sessionToken);
    response.json({ user: serializeUser(result.user as NonNullable<Express.Request["authUser"]>) });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/logout", async (request, response, next) => {
  try {
    const token = request.cookies?.[env.SESSION_COOKIE_NAME];
    if (token && typeof token === "string") {
      await authService.logout(token);
    }
    clearSessionCookie(response);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRoutes.get("/me", requireAuth, (request, response) => {
  response.json({ user: serializeUser(request.authUser!) });
});

authRoutes.patch("/me", requireAuth, async (request, response, next) => {
  try {
    const input = updateProfileSchema.parse(request.body);
    const user = await authService.updateProfile(request.authUser!, input);
    response.json({ user: serializeUser(user as NonNullable<Express.Request["authUser"]>) });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/email/check", async (request, response, next) => {
  try {
    const input = emailCheckSchema.parse(request.body);
    response.json(await authService.checkEmail(input.email));
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/email/verification/request", (_request, _response, next) => {
  next(new ApiError(501, "EMAIL_VERIFICATION_UNAVAILABLE", "Email verification is not available in this deployment."));
});

authRoutes.post("/password/reset/request", (_request, _response, next) => {
  next(new ApiError(501, "PASSWORD_RESET_UNAVAILABLE", "Password reset is not available in this deployment."));
});

authRoutes.post("/password/reset/confirm", (_request, _response, next) => {
  next(new ApiError(501, "PASSWORD_RESET_UNAVAILABLE", "Password reset is not available in this deployment."));
});

authRoutes.post("/email/verification/confirm", (_request, _response, next) => {
  next(new ApiError(501, "EMAIL_VERIFICATION_UNAVAILABLE", "Email verification is not available in this deployment."));
});

authRoutes.get("/google/start", (_request, response, next) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured."));
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("nonce", randomUUID());
  response.redirect(url.toString());
});

authRoutes.get("/google/callback", async (request, response, next) => {
  try {
    const authCode = typeof request.query.code === "string" ? request.query.code : "";
    if (!authCode) {
      throw new ApiError(400, "OAUTH_TOKEN_REQUIRED", "Google authorization code is required.");
    }
    const claims = await verifyGoogleAuthorizationCode(authCode);
    const result = await authService.signInWithVerifiedOAuth(claims);
    setSessionCookie(response, result.sessionToken);
    response.redirect(`${env.APP_ORIGIN}/?authenticated=1`);
  } catch (error) {
    next(error);
  }
});

authRoutes.get("/apple/start", (_request, response, next) => {
  if (!env.APPLE_CLIENT_ID || !env.APPLE_REDIRECT_URI) {
    return next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Apple sign-in is not configured."));
  }

  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", env.APPLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.APPLE_REDIRECT_URI);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("scope", "email name");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("nonce", randomUUID());
  response.redirect(url.toString());
});

authRoutes.post("/apple/callback", async (request, response, next) => {
  try {
    const idToken = typeof request.body?.id_token === "string" ? request.body.id_token : "";
    if (!idToken) {
      throw new ApiError(400, "OAUTH_TOKEN_REQUIRED", "Apple id_token is required.");
    }
    const claims = await verifyAppleIdToken(idToken);
    const result = await authService.signInWithVerifiedOAuth(claims);
    setSessionCookie(response, result.sessionToken);
    response.redirect(`${env.APP_ORIGIN}/?authenticated=1`);
  } catch (error) {
    next(error);
  }
});
