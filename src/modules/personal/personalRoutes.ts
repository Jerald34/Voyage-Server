import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePersonalAccount } from "../../http/authMiddleware";
import { createPersonalService } from "./personalService";
import { createPrismaPersonalRepository } from "./personalRepository";

const service = createPersonalService({ repository: createPrismaPersonalRepository() });

const createItinerarySchema = z.object({
  title: z.string(),
  summary: z.string().optional()
});

const updateItinerarySchema = z.object({
  title: z.string().optional(),
  summary: z.string().nullable().optional()
});

const createThreadSchema = z.object({
  title: z.string().optional()
});

const createShareSchema = z.object({
  itineraryId: z.string().uuid(),
  recipientName: z.string().optional(),
  recipientEmail: z.string().email().optional()
});

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
    const itinerary = await service.getItinerary(req.authUser!.id, String(req.params.itineraryId));
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.patch("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const input = updateItinerarySchema.parse(req.body);
    const itinerary = await service.updateItinerary(req.authUser!.id, String(req.params.itineraryId), input);
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.delete("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const result = await service.deleteItinerary(req.authUser!.id, String(req.params.itineraryId));
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
    const input = createShareSchema.parse({ ...req.body, itineraryId: req.params.itineraryId });
    const share = await service.createShare(req.authUser!.id, input);
    res.status(201).json({ share });
  } catch (e) { next(e); }
});
