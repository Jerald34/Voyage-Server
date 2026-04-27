import { Router } from "express";
import { getUserCapabilities } from "../../services/capabilities";
import { clearSessionCookie, setSessionCookie } from "../../http/cookies";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { env } from "../../config/env";
import {
  confirmVerificationSchema,
  emailCheckSchema,
  loginSchema,
  registerSchema
} from "./authSchemas";
import { authService } from "./authService";

export const authRoutes = Router();

function serializeUser(user: NonNullable<Express.Request["authUser"]>) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    capabilities: getUserCapabilities(user)
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

authRoutes.post("/email/check", async (request, response, next) => {
  try {
    const input = emailCheckSchema.parse(request.body);
    response.json(await authService.checkEmail(input.email));
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/email/verification/request", requireAuth, async (request, response, next) => {
  try {
    await authService.requestEmailVerification(request.authUser!.id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRoutes.post("/email/verification/confirm", async (request, response, next) => {
  try {
    const input = confirmVerificationSchema.parse(request.body);
    const user = await authService.confirmEmailVerification(input.token);
    response.json({ user: serializeUser(user as NonNullable<Express.Request["authUser"]>) });
  } catch (error) {
    next(error);
  }
});

authRoutes.get("/google/start", (_request, _response, next) => {
  next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured yet."));
});

authRoutes.get("/google/callback", (_request, _response, next) => {
  next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Google sign-in is not configured yet."));
});

authRoutes.get("/apple/start", (_request, _response, next) => {
  next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Apple sign-in is not configured yet."));
});

authRoutes.post("/apple/callback", (_request, _response, next) => {
  next(new ApiError(501, "OAUTH_NOT_CONFIGURED", "Apple sign-in is not configured yet."));
});
