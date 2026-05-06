import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { ApiError } from "../http/errors";

function createS3Client() {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new ApiError(501, "STORAGE_NOT_CONFIGURED", "Image storage is not configured.");
  }

  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    }
  });
}

export const s3ImageStorage = {
  bucket: env.S3_BUCKET,
  async createUploadUrl(input: { objectKey: string; mimeType: string }) {
    if (!env.S3_BUCKET) {
      throw new ApiError(501, "STORAGE_NOT_CONFIGURED", "Image storage bucket is not configured.");
    }

    return getSignedUrl(
      createS3Client(),
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: input.objectKey,
        ContentType: input.mimeType
      }),
      { expiresIn: 10 * 60 }
    );
  },
  async createReadUrl(input: { objectKey: string }) {
    if (!env.S3_BUCKET) {
      throw new ApiError(501, "STORAGE_NOT_CONFIGURED", "Image storage bucket is not configured.");
    }

    return getSignedUrl(
      createS3Client(),
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: input.objectKey
      }),
      { expiresIn: 10 * 60 }
    );
  }
};
