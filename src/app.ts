import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { attachAuthUser } from "./http/authMiddleware";
import { errorHandler, notFoundHandler } from "./http/errors";
import { createRateLimiters, type RateLimiterStoreFactory } from "./http/rateLimiters";
import { adminRoutes } from "./modules/admin/adminRoutes";
import { agencyRoutes } from "./modules/agencies/agencyRoutes";
import { agentRoutes } from "./modules/agent/agentRoutes";
import { authRoutes } from "./modules/auth/authRoutes";
import { dashboardRoutes } from "./modules/dashboard/dashboardRoutes";
import { imageRoutes } from "./modules/images/imageRoutes";
import { itineraryRoutes } from "./modules/itineraries/itineraryRoutes";
import { reviewRoutes } from "./modules/reviews/reviewRoutes";
import { shareRoutes } from "./modules/shares/shareRoutes";
import { publicShareRoutes } from "./modules/shares/publicShareRoutes";
import { teamRoutes } from "./modules/agencies/teamRoutes";
import { invitationRoutes } from "./modules/agencies/invitationRoutes";
import { workspaceRoutes } from "./modules/workspace/workspaceRoutes";
import { personalRoutes } from "./modules/personal/personalRoutes";
import { ratedHistoryListRoutes, ratedHistoryInsertRoutes } from "./modules/ratedHistory/ratedHistoryRoutes";
import { supportRoutes } from "./modules/support/supportRoutes";

type CreateAppOptions = {
  rateLimiterStoreFactory?: RateLimiterStoreFactory;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const rateLimiters = createRateLimiters({ storeFactory: options.rateLimiterStoreFactory });
  const baselineLimiter: RequestHandler = (request, response, next) => {
    if (request.path === "/health") {
      next();
      return;
    }

    rateLimiters.baseline(request, response, next);
  };

  // F4: Trust the first proxy so rate-limiters and secure cookies see the real client IP.
  app.set("trust proxy", 1);

  // F8: Security headers — early, before routes.
  // Configured for a JSON API served from a different origin than the SPA.
  app.use(helmet({
    // CSP is not set here because this is a JSON API (no HTML responses).
    contentSecurityPolicy: false,
    // Prevent content-type sniffing on all responses (including the photo proxy).
    noSniff: true,
    // Deny framing (defence-in-depth; no HTML pages served here).
    frameguard: { action: "deny" },
    // Downgrade referrer to origin-only.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS: 1 year in production; not useful over HTTP but harmless.
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true
    }
  }));

  // F9: Log only method + path — never query strings (which may contain OAuth
  // codes, share tokens, or review tokens).
  app.use((req, _res, next) => {
    console.log(`[Request] ${req.method} ${req.path}`);
    next();
  });

  app.use(baselineLimiter);
  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  app.post("/auth/register", rateLimiters.registration);
  app.post("/auth/login", rateLimiters.login);
  app.post("/auth/email/check", rateLimiters.emailRequest);
  app.post("/auth/email/verification/request", rateLimiters.emailRequest);
  app.post("/auth/password/reset/request", rateLimiters.emailRequest);
  app.post("/auth/email/verification/confirm", rateLimiters.tokenConfirm);
  app.post("/auth/password/reset/confirm", rateLimiters.tokenConfirm);
  app.get("/auth/google/start", rateLimiters.oauth);
  app.get("/auth/google/callback", rateLimiters.oauth);
  app.get("/auth/apple/start", rateLimiters.oauth);
  app.post("/auth/apple/callback", rateLimiters.oauth);
  app.get("/invitations/lookup", rateLimiters.invitationLookup);
  app.get("/shared/:token", rateLimiters.publicShareRead);
  app.get("/shared/:token/comments", rateLimiters.publicShareRead);
  app.post("/shared/:token/comments", rateLimiters.publicShareWrite);
  app.post("/shared/:token/rate", rateLimiters.publicShareWrite);
  app.get("/reviews/:tripToken/check", rateLimiters.reviewCheck);
  app.post("/reviews/:tripToken/submit", rateLimiters.reviewSubmit);
  app.get("/images/place-photo", rateLimiters.photoProxy);

  app.use(cookieParser());
  app.use(attachAuthUser);

  // Default every API response to `no-store`. Almost everything this API returns is
  // per-user and authenticated (account details, threads, itineraries), and without
  // an explicit directive the browser's HTTP cache — and any service worker — may
  // reuse one user's response for the next account on the same device. That is the
  // cross-user data-leak where a previous account's threads/details show up after
  // switching accounts. Routes that serve genuinely cacheable, non-user content
  // (e.g. the immutable photo proxy in imageRoutes) set their own Cache-Control in
  // the handler, which runs later and overrides this default.
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/health", rateLimiters.health, (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/auth", authRoutes);
  app.use("/agencies", agencyRoutes);
  app.use("/invitations", invitationRoutes);
  app.use("/agencies/:agencyId/team", teamRoutes);
  app.use("/agencies/:agencyId/agent", agentRoutes);
  app.use("/agencies/:agencyId/itineraries", itineraryRoutes);
  app.use("/agencies/:agencyId/workspace", workspaceRoutes);
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use("/shared", publicShareRoutes);
  app.use("/reviews", reviewRoutes);
  app.use("/admin", adminRoutes);
  app.use("/images", imageRoutes);
  app.use("/me", personalRoutes);
  app.use("/support", supportRoutes);
  app.use("/agencies/:agencyId/rated-history", ratedHistoryListRoutes);
  app.use("/trips/:tripId/itinerary", ratedHistoryInsertRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
