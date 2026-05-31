import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { getUserCapabilities } from "../../services/capabilities";
import { clearSessionCookie, setSessionCookie } from "../../http/cookies";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { env } from "../../config/env";
import { verifyAppleIdToken, verifyGoogleAuthorizationCode } from "../../services/oauth";
import { z } from "zod";
import {
  emailCheckSchema,
  loginSchema,
  registerSchema,
  setAccountTypeSchema,
  updateProfileSchema
} from "./authSchemas";
import { authService } from "./authService";

// ---------------------------------------------------------------------------
// F3 — OAuth login-CSRF: state + nonce cookie helpers
// ---------------------------------------------------------------------------

const OAUTH_STATE_COOKIE = "voyage_oauth_state";
const OAUTH_NONCE_COOKIE = "voyage_oauth_nonce";
/** 10 minutes — enough time for the user to complete the OAuth flow. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const OAUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  path: "/",
  maxAge: OAUTH_STATE_TTL_MS
};

function generateOAuthCsrfTokens(response: import("express").Response) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomUUID();
  response.cookie(OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_OPTS);
  response.cookie(OAUTH_NONCE_COOKIE, nonce, OAUTH_COOKIE_OPTS);
  return { state, nonce };
}

function verifyOAuthState(
  request: import("express").Request,
  response: import("express").Response
) {
  const expected = request.cookies?.[OAUTH_STATE_COOKIE];
  const received =
    typeof request.query.state === "string"
      ? request.query.state
      : typeof request.body?.state === "string"
        ? request.body.state
        : undefined;

  // Always clear the cookies regardless of success/failure (one-use).
  response.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
  response.clearCookie(OAUTH_NONCE_COOKIE, { httpOnly: true, secure: true, sameSite: "none", path: "/" });

  if (!expected || !received || expected !== received) {
    throw new ApiError(400, "OAUTH_STATE_MISMATCH", "OAuth state parameter is missing or invalid. Please try signing in again.");
  }
}

const verificationRequestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const verificationConfirmSchema = z.object({ token: z.string().min(1) });
const passwordResetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const passwordResetConfirmSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });

export const authRoutes = Router();

export function serializeUser(user: NonNullable<Express.Request["authUser"]>) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    accountType: user.accountType,
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
    response.status(201).json({
      user: serializeUser(result.user as NonNullable<Express.Request["authUser"]>),
      emailVerificationRequired: true
    });
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

authRoutes.post("/me/account-type", requireAuth, async (request, response, next) => {
  try {
    const input = setAccountTypeSchema.parse(request.body);
    const user = await authService.setAccountType(request.authUser!.id, input.accountType);
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

authRoutes.post("/email/verification/request", async (request, response, next) => {
  try {
    const input = verificationRequestSchema.parse(request.body);
    await authService.requestEmailVerificationByEmail(input.email);
    response.status(202).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/email/verification/confirm", async (request, response, next) => {
  try {
    const input = verificationConfirmSchema.parse(request.body);
    await authService.confirmEmailVerification(input.token);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/password/reset/request", async (request, response, next) => {
  try {
    const input = passwordResetRequestSchema.parse(request.body);
    await authService.requestPasswordReset({ email: input.email });
    response.status(202).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/password/reset/confirm", async (request, response, next) => {
  try {
    const input = passwordResetConfirmSchema.parse(request.body);
    await authService.confirmPasswordReset(input);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRoutes.get("/google/start", (_request, response, next) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    return next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured."));
  }

  // F3: Generate state (CSRF protection) and nonce, bind to session via httpOnly cookies.
  const { state, nonce } = generateOAuthCsrfTokens(response);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  response.redirect(url.toString());
});

authRoutes.get("/google/callback", async (request, response, next) => {
  try {
    // F3: Verify state cookie before processing the authorization code.
    verifyOAuthState(request, response);

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

  // F3: Generate state (CSRF protection) and nonce, bind to session via httpOnly cookies.
  // Apple uses response_mode=form_post, so state is round-tripped through the POST body.
  const { state, nonce } = generateOAuthCsrfTokens(response);

  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", env.APPLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.APPLE_REDIRECT_URI);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("scope", "email name");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  response.redirect(url.toString());
});

authRoutes.post("/apple/callback", async (request, response, next) => {
  try {
    // F3: Verify state (round-tripped via form_post body for Apple).
    verifyOAuthState(request, response);

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
