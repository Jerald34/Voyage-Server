import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";
import { s3ImageStorage } from "../../services/storage";

export type ImageUser = {
  id: string;
  status: "ACTIVE" | "DISABLED";
};

export type ImagePurpose =
  | "PROFILE_AVATAR"
  | "AGENCY_LOGO"
  | "TRIP_ITINERARY_IMAGE"
  | "CLIENT_ITINERARY_IMAGE";

export type ImageRecord = {
  id: string;
  ownerUserId: string | null;
  agencyId: string | null;
  tripId: string | null;
  purpose: ImagePurpose;
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
  status: "PENDING_UPLOAD" | "READY" | "DELETED" | "REPLACED";
  createdAt: Date;
  updatedAt: Date;
};

type AgencyAccess = {
  agency: {
    id: string;
    status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  };
  membership: {
    userId: string;
    agencyId: string;
    role: "OWNER" | "ADMIN" | "STAFF";
    status: "ACTIVE" | "DISABLED";
  } | null;
};

export type ImageRepository = {
  findAgencyAccess(userId: string, agencyId: string): Promise<AgencyAccess | null>;
  userHasTripAccess(userId: string, agencyId: string, tripId: string): Promise<boolean>;
  createImageAsset(data: Omit<ImageRecord, "id" | "status" | "width" | "height" | "checksum" | "createdAt" | "updatedAt">): Promise<ImageRecord>;
  findImageAsset(id: string): Promise<ImageRecord | null>;
  updateImageAsset(id: string, data: Partial<ImageRecord>): Promise<ImageRecord>;
};

export type ImageStorage = {
  bucket: string;
  createUploadUrl(input: { objectKey: string; mimeType: string }): Promise<string>;
  createReadUrl(input: { objectKey: string }): Promise<string>;
};

type RequestUploadInput = {
  purpose: ImagePurpose;
  mimeType: string;
  sizeBytes: number;
  agencyId?: string;
  tripId?: string;
};

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const maxBytesByPurpose: Record<ImagePurpose, number> = {
  PROFILE_AVATAR: 2 * 1024 * 1024,
  AGENCY_LOGO: 2 * 1024 * 1024,
  TRIP_ITINERARY_IMAGE: 8 * 1024 * 1024,
  CLIENT_ITINERARY_IMAGE: 8 * 1024 * 1024
};

function assertActiveUser(user: ImageUser) {
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
  }
}

function assertImagePolicy(input: RequestUploadInput) {
  if (!allowedMimeTypes.has(input.mimeType)) {
    throw new ApiError(400, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG, PNG, and WEBP images are supported.");
  }

  if (input.sizeBytes > maxBytesByPurpose[input.purpose]) {
    throw new ApiError(400, "IMAGE_TOO_LARGE", "Image exceeds the maximum size for this purpose.");
  }
}

async function requireVerifiedAgencyAccess(
  repository: ImageRepository,
  user: ImageUser,
  agencyId: string,
  allowedRoles: Array<"OWNER" | "ADMIN" | "STAFF">
) {
  const access = await repository.findAgencyAccess(user.id, agencyId);

  if (!access?.agency) {
    throw new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found.");
  }

  if (access.agency.status !== "VERIFIED") {
    throw new ApiError(403, "AGENCY_NOT_VERIFIED", "Agency must be verified before uploading agency media.");
  }

  if (!access.membership || access.membership.status !== "ACTIVE" || !allowedRoles.includes(access.membership.role)) {
    throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to upload this agency media.");
  }

  return access;
}

export function createImageService(options: {
  repository: ImageRepository;
  storage: ImageStorage;
  now?: () => Date;
  createObjectKey?: (input: { userId: string; purpose: ImagePurpose; agencyId?: string; tripId?: string }) => string;
}) {
  const createObjectKey =
    options.createObjectKey ??
    ((input) => {
      const ownerSegment = input.agencyId ?? input.userId;
      return `images/${ownerSegment}/${input.purpose.toLowerCase()}/${randomUUID()}`;
    });

  return {
    async requestUpload(user: ImageUser, input: RequestUploadInput) {
      assertActiveUser(user);
      assertImagePolicy(input);

      let ownerUserId: string | null = user.id;
      let agencyId: string | null = null;
      let tripId: string | null = null;

      if (input.purpose === "AGENCY_LOGO") {
        if (!input.agencyId) {
          throw new ApiError(400, "AGENCY_ID_REQUIRED", "Agency ID is required for agency logo uploads.");
        }
        await requireVerifiedAgencyAccess(options.repository, user, input.agencyId, ["OWNER", "ADMIN"]);
        agencyId = input.agencyId;
      }

      if (input.purpose === "TRIP_ITINERARY_IMAGE" || input.purpose === "CLIENT_ITINERARY_IMAGE") {
        if (!input.agencyId || !input.tripId) {
          throw new ApiError(400, "TRIP_IMAGE_CONTEXT_REQUIRED", "Agency ID and trip ID are required for trip image uploads.");
        }
        await requireVerifiedAgencyAccess(options.repository, user, input.agencyId, ["OWNER", "ADMIN", "STAFF"]);
        const hasTripAccess = await options.repository.userHasTripAccess(user.id, input.agencyId, input.tripId);
        if (!hasTripAccess) {
          throw new ApiError(403, "TRIP_ACCESS_REQUIRED", "You do not have access to upload images for this trip.");
        }
        agencyId = input.agencyId;
        tripId = input.tripId;
      }

      const objectKey = createObjectKey({
        userId: user.id,
        purpose: input.purpose,
        agencyId: agencyId ?? undefined,
        tripId: tripId ?? undefined
      });
      const image = await options.repository.createImageAsset({
        ownerUserId,
        agencyId,
        tripId,
        purpose: input.purpose,
        bucket: options.storage.bucket,
        objectKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes
      });
      const uploadUrl = await options.storage.createUploadUrl({ objectKey, mimeType: input.mimeType });

      return { image, uploadUrl };
    },

    async completeUpload(user: ImageUser, imageId: string) {
      assertActiveUser(user);
      const image = await options.repository.findImageAsset(imageId);
      if (!image) {
        throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");
      }
      if (image.ownerUserId !== user.id) {
        throw new ApiError(403, "IMAGE_ACCESS_REQUIRED", "You do not have access to complete this image upload.");
      }
      return options.repository.updateImageAsset(image.id, { status: "READY" });
    },

    async createReadUrl(user: ImageUser, imageId: string) {
      assertActiveUser(user);
      const image = await options.repository.findImageAsset(imageId);
      if (!image || image.status !== "READY") {
        throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");
      }
      if (image.ownerUserId !== user.id) {
        throw new ApiError(403, "IMAGE_ACCESS_REQUIRED", "You do not have access to read this image.");
      }
      return {
        image,
        readUrl: await options.storage.createReadUrl({ objectKey: image.objectKey })
      };
    }
  };
}

export function createPrismaImageRepository(client: PrismaClient = prisma): ImageRepository {
  return {
    async findAgencyAccess(userId, agencyId) {
      const agency = await client.agency.findUnique({
        where: { id: agencyId },
        include: {
          memberships: {
            where: { userId },
            take: 1
          }
        }
      });

      if (!agency) {
        return null;
      }

      return {
        agency,
        membership: agency.memberships[0] ?? null
      } as AgencyAccess;
    },
    async userHasTripAccess(userId, agencyId) {
      const access = await this.findAgencyAccess(userId, agencyId);
      return Boolean(access?.membership && access.agency.status === "VERIFIED" && access.membership.status === "ACTIVE");
    },
    async createImageAsset(data) {
      return client.imageAsset.create({ data }) as Promise<ImageRecord>;
    },
    async findImageAsset(id) {
      return client.imageAsset.findUnique({ where: { id } }) as Promise<ImageRecord | null>;
    },
    async updateImageAsset(id, data) {
      return client.imageAsset.update({
        where: { id },
        data
      }) as Promise<ImageRecord>;
    }
  };
}

export const imageService = createImageService({
  repository: createPrismaImageRepository(),
  storage: s3ImageStorage
});
