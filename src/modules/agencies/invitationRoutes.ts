import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { invitationService } from "./teamRoutes";

export const invitationRoutes = Router();

const lookupSchema = z.object({ token: z.string().min(1) });
const acceptSchema = z.object({ token: z.string().min(1) });

invitationRoutes.get("/lookup", async (request, response, next) => {
  try {
    const { token } = lookupSchema.parse({ token: request.query.token });
    const result = await invitationService.lookup(token);
    response.json({ invitation: result });
  } catch (error) {
    next(error);
  }
});

invitationRoutes.post("/accept", requireAuth, async (request, response, next) => {
  try {
    const { token } = acceptSchema.parse(request.body);
    const user = request.authUser!;
    if (!user.emailVerifiedAt) {
      throw new ApiError(
        403,
        "EMAIL_NOT_VERIFIED",
        "Verify your email before accepting an agency invitation."
      );
    }
    const result = await invitationService.accept({
      rawToken: token,
      user: {
        id: user.id,
        emailNormalized: user.emailNormalized,
        accountType: user.accountType
      }
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});
