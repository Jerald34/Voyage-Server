import { Readable } from "node:stream";
import { Router } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../http/errors";
import { requireAuth } from "../../http/authMiddleware";
import { requestUploadSchema } from "./imageSchemas";
import { imageService } from "./imageService";

export const imageRoutes = Router();

// Maps Google's allowed photo dimensions. The upstream API caps at 4800; we cap lower
// because we never request anything larger from the maps provider, and tighter bounds
// limit budget abuse if someone hits the proxy directly with arbitrary query strings.
const PHOTO_DIMENSION_MIN = 16;
const PHOTO_DIMENSION_MAX = 2000;
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

function clampDimension(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(PHOTO_DIMENSION_MIN, Math.min(PHOTO_DIMENSION_MAX, parsed));
}

/**
 * Server-side proxy for Google Places photos. The MapsProvider stores `photoUri` URLs
 * pointing here so the Google API key never reaches clients (web, public share pages,
 * persisted snapshots). We validate `name` against a strict pattern to ensure the only
 * thing this endpoint can fetch is Google's `places/.../photos/...` media URL.
 *
 * Intentionally public: the same URLs are embedded in public share-page itineraries.
 */
imageRoutes.get("/place-photo", async (request, response, next) => {
  try {
    const apiKey = env.GOOGLE_MAPS_API_KEY.trim();
    if (!apiKey) {
      throw new ApiError(503, "MAPS_PROVIDER_UNAVAILABLE", "Photo proxy is not configured.");
    }

    const rawName = typeof request.query.name === "string" ? request.query.name : "";
    if (!PHOTO_NAME_PATTERN.test(rawName)) {
      throw new ApiError(400, "INVALID_PHOTO_NAME", "Photo name is invalid.");
    }

    const width = clampDimension(request.query.w, 1000);
    const height = clampDimension(request.query.h, 1000);

    // Build the upstream URL using URL components so the API key only ever lives in
    // memory here — never logged into the request URL.
    const upstreamUrl = `https://places.googleapis.com/v1/${rawName}/media?maxHeightPx=${height}&maxWidthPx=${width}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { "X-Goog-Api-Key": apiKey }
    });

    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, "PHOTO_UPSTREAM_FAILED", `Upstream photo fetch failed (${upstream.status}).`);
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    response.setHeader("Content-Type", contentType);
    // Cache aggressively at edges/browsers; photo names are opaque & immutable, so a stale
    // cache cannot ever serve the wrong image for a given name.
    response.setHeader("Cache-Control", "public, max-age=86400, immutable");

    // Stream rather than buffer so large images don't sit in memory.
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(response);
  } catch (error) {
    next(error);
  }
});

imageRoutes.post("/upload-url", requireAuth, async (request, response, next) => {
  try {
    const input = requestUploadSchema.parse(request.body);
    const result = await imageService.requestUpload(request.authUser!, input);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

imageRoutes.post("/:imageId/complete", requireAuth, async (request, response, next) => {
  try {
    const image = await imageService.completeUpload(request.authUser!, String(request.params.imageId));
    response.json({ image });
  } catch (error) {
    next(error);
  }
});

imageRoutes.get("/:imageId/url", requireAuth, async (request, response, next) => {
  try {
    const result = await imageService.createReadUrl(request.authUser!, String(request.params.imageId));
    response.json(result);
  } catch (error) {
    next(error);
  }
});
