import { Readable } from "node:stream";
import { Router } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../http/errors";
import { requireAuth } from "../../http/authMiddleware";
import { imageIdParamsSchema, requestUploadSchema } from "./imageSchemas";
import { imageService } from "./imageService";
import { isCloudinaryConfigured, uploadPlacePhoto } from "../../services/cloudinary";
import { prisma } from "../../db/prisma";

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
 * Extract the Google place ID from a photo resource name.
 * e.g. "places/ChIJ123abc/photos/AUc7..." → "ChIJ123abc"
 */
function extractPlaceIdFromPhotoName(name: string): string | null {
  const match = name.match(/^places\/([A-Za-z0-9_-]+)\/photos\//);
  return match?.[1] ?? null;
}

/**
 * Fire-and-forget: upload the Google photo to Cloudinary and update PlaceSnapshots
 * that still reference the proxy URL. Next request for the same photo will get a
 * 301 redirect to Cloudinary instead of proxying through Google again.
 */
function lazyCacheToCloudinary(upstreamUrl: string, placeId: string) {
  (async () => {
    try {
      // Upload to Cloudinary using the direct upstream URL (with key as query param)
      // so Cloudinary's fetch can reach it without needing a header-based auth.
      const apiKey = env.GOOGLE_MAPS_API_KEY.trim();
      const fetchableUrl = `${upstreamUrl}&key=${apiKey}`;
      const uploaded = await uploadPlacePhoto(fetchableUrl, placeId);
      // Update all PlaceSnapshots whose metadata.primaryPhotoUrl is the old proxy URL
      // so subsequent views go straight to Cloudinary.
      await prisma.$executeRawUnsafe(
        `UPDATE "PlaceSnapshot"
         SET metadata = jsonb_set(
           jsonb_set(metadata, '{primaryPhotoUrl}', $1::jsonb),
           '{photoUrls}', jsonb_build_array($1::text)
         ),
         "fetchedAt" = NOW()
         WHERE "providerPlaceId" = $2
           AND metadata->>'primaryPhotoUrl' LIKE '%/images/place-photo%'`,
        JSON.stringify(uploaded.url),
        placeId
      );
    } catch (err) {
      // Best-effort: if Cloudinary upload or DB update fails, the proxy still works.
      console.error("[lazyCacheToCloudinary] Failed for place", placeId, err);
    }
  })();
}

/**
 * Server-side proxy for Google Places photos. The MapsProvider stores `photoUri` URLs
 * pointing here so the Google API key never reaches clients (web, public share pages,
 * persisted snapshots). We validate `name` against a strict pattern to ensure the only
 * thing this endpoint can fetch is Google's `places/.../photos/...` media URL.
 *
 * When Cloudinary is configured, this endpoint lazily uploads photos on first access
 * and updates the DB. Subsequent requests for the same place are redirected to the
 * Cloudinary URL, eliminating ongoing Google billing.
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

    // Check if this photo has already been cached to Cloudinary. If so, redirect
    // instead of proxying through Google (saves API cost + latency).
    const placeId = extractPlaceIdFromPhotoName(rawName);
    if (placeId && isCloudinaryConfigured()) {
      try {
        const snapshot = await prisma.placeSnapshot.findFirst({
          where: { providerPlaceId: placeId },
          select: { metadata: true }
        });
        const meta = snapshot?.metadata as Record<string, unknown> | null;
        const cachedUrl = typeof meta?.primaryPhotoUrl === "string" ? meta.primaryPhotoUrl : "";
        if (cachedUrl && !cachedUrl.includes("/images/place-photo")) {
          // Already cached on Cloudinary (or another CDN) — redirect.
          response.setHeader("Cache-Control", "public, max-age=86400, immutable");
          response.redirect(301, cachedUrl);
          return;
        }
      } catch {
        // DB lookup failed; fall through to proxy.
      }
    }

    // Build the upstream URL using URL components so the API key only ever lives in
    // memory here — never logged into the request URL.
    const upstreamUrl = `https://places.googleapis.com/v1/${rawName}/media?maxHeightPx=${height}&maxWidthPx=${width}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { "X-Goog-Api-Key": apiKey }
    });

    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, "PHOTO_UPSTREAM_FAILED", `Upstream photo fetch failed (${upstream.status}).`);
    }

    // Fire-and-forget: upload to Cloudinary so subsequent requests get redirected.
    if (placeId && isCloudinaryConfigured()) {
      lazyCacheToCloudinary(upstreamUrl, placeId);
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
    const { imageId } = imageIdParamsSchema.parse(request.params);
    const image = await imageService.completeUpload(request.authUser!, imageId);
    response.json({ image });
  } catch (error) {
    next(error);
  }
});

imageRoutes.get("/:imageId/url", requireAuth, async (request, response, next) => {
  try {
    const { imageId } = imageIdParamsSchema.parse(request.params);
    const result = await imageService.createReadUrl(request.authUser!, imageId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
