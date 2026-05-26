import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { attachAuthUser } from "./http/authMiddleware";
import { errorHandler, notFoundHandler } from "./http/errors";
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

export function createApp() {
  const app = express();

  app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
  });

  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachAuthUser);

  app.get("/health", (_request, response) => {
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
