import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePersonalAccount } from "../../http/authMiddleware";
import {
  idParamsSchema,
  nullableTextSchema,
  optionalTextSchema,
  requiredTextSchema,
  uuidSchema
} from "../../http/requestSchemas";
import { createPersonalService } from "./personalService";
import { createPrismaPersonalRepository } from "./personalRepository";

const service = createPersonalService({ repository: createPrismaPersonalRepository() });
const itineraryIdParamsSchema = idParamsSchema("itineraryId");

const createItinerarySchema = z
  .object({
    title: requiredTextSchema(200),
    summary: optionalTextSchema(3000)
  })
  .strict();

const updateItinerarySchema = z
  .object({
    title: optionalTextSchema(200),
    summary: nullableTextSchema(3000)
  })
  .strict();

const createThreadSchema = z
  .object({
    title: optionalTextSchema(200)
  })
  .strict();

const createShareBodySchema = z
  .object({
    recipientName: optionalTextSchema(200),
    recipientEmail: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim().toLowerCase();
      return trimmed === "" ? undefined : trimmed;
    }, z.string().email().max(254).optional())
  })
  .strict();

export const personalRoutes = Router();
personalRoutes.use(requireAuth, requirePersonalAccount);

personalRoutes.get("/itineraries", async (req, res, next) => {
  try { res.json({ itineraries: await service.listItineraries(req.authUser!.id) }); } catch (e) { next(e); }
});

personalRoutes.post("/itineraries", async (req, res, next) => {
  try {
    const input = createItinerarySchema.parse(req.body);
    const itinerary = await service.createItinerary(req.authUser!.id, input);
    res.status(201).json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.get("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const { itineraryId } = itineraryIdParamsSchema.parse(req.params);
    const itinerary = await service.getItinerary(req.authUser!.id, itineraryId);
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.patch("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const { itineraryId } = itineraryIdParamsSchema.parse(req.params);
    const input = updateItinerarySchema.parse(req.body);
    const itinerary = await service.updateItinerary(req.authUser!.id, itineraryId, input);
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.delete("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const { itineraryId } = itineraryIdParamsSchema.parse(req.params);
    const result = await service.deleteItinerary(req.authUser!.id, itineraryId);
    res.json(result);
  } catch (e) { next(e); }
});

personalRoutes.get("/agent/threads", async (req, res, next) => {
  try { res.json({ threads: await service.listThreads(req.authUser!.id) }); } catch (e) { next(e); }
});

personalRoutes.post("/agent/threads", async (req, res, next) => {
  try {
    const input = createThreadSchema.parse(req.body);
    const thread = await service.createThread(req.authUser!.id, input.title);
    res.status(201).json({ thread });
  } catch (e) { next(e); }
});

personalRoutes.post("/itineraries/:itineraryId/shares", async (req, res, next) => {
  try {
    const { itineraryId } = itineraryIdParamsSchema.parse(req.params);
    const input = createShareBodySchema.parse(req.body);
    const share = await service.createShare(req.authUser!.id, {
      itineraryId,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail
    });
    res.status(201).json({ share });
  } catch (e) { next(e); }
});
