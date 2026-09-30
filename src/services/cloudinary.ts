import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET
  });
  configured = true;
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  );
}

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  width: number;
  height: number;
};

/**
 * Upload a place photo from a raw Buffer to Cloudinary.
 * The Google API key is never included in any URL — bytes were fetched
 * server-side using header-based authentication.
 */
export async function uploadPlacePhotoBuffer(
  buffer: Buffer,
  placeId: string
): Promise<CloudinaryUploadResult> {
  ensureConfigured();

  const folder = "voyage/place-photos";

  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: placeId.replace(/[^a-zA-Z0-9_-]/g, "_"),
        resource_type: "image",
        overwrite: false,
        transformation: [
          { width: 400, crop: "limit" },
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload returned no result."));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height
        });
      }
    );

    stream.end(buffer);
  });
}

export async function uploadChatImage(
  buffer: Buffer,
  mimeType: string,
  agencyId: string
): Promise<CloudinaryUploadResult> {
  ensureConfigured();

  const folder = `voyage/chat-images/${agencyId}`;

  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: 1600, crop: "limit" },
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload returned no result."));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height
        });
      }
    );

    stream.end(buffer);
  });
}
