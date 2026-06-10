import { describe, expect, it, vi } from "vitest";
import {
  createImageService,
  type ImageRepository,
  type ImageStorage,
  type ImageUser
} from "../src/modules/images/imageService";

// ---------------------------------------------------------------------------
// uploadPlacePhotoBuffer – Cloudinary buffer upload tests (Task 10)
// ---------------------------------------------------------------------------

// Cloudinary mock must be hoisted so vi.mock factory runs before imports.
const cloudinaryMocks = vi.hoisted(() => {
  const upload_stream = vi.fn();
  return { upload_stream };
});

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: cloudinaryMocks.upload_stream,
      upload: vi.fn()
    }
  }
}));

describe("uploadPlacePhotoBuffer", () => {
  it("passes a Buffer to cloudinary.uploader.upload_stream and never a Google URL with ?key=", async () => {
    const fakeResult = {
      secure_url: "https://res.cloudinary.com/demo/image/upload/v1/voyage/place-photos/ChIJabc",
      public_id: "voyage/place-photos/ChIJabc",
      width: 400,
      height: 300
    };

    // upload_stream receives options + callback; call the callback synchronously.
    cloudinaryMocks.upload_stream.mockImplementationOnce((_opts: unknown, cb: (err: null, result: typeof fakeResult) => void) => {
      const writable = {
        end: (buf: Buffer) => {
          // Capture and immediately invoke callback.
          cb(null, fakeResult);
        }
      };
      return writable;
    });

    const { uploadPlacePhotoBuffer } = await import("../src/services/cloudinary");

    const testBuffer = Buffer.from("fake-image-data");
    const result = await uploadPlacePhotoBuffer(testBuffer, "ChIJabc");

    expect(result.url).toBe(fakeResult.secure_url);
    expect(result.publicId).toBe(fakeResult.public_id);

    // The upload_stream call must NOT have received a Google URL with a key
    const callArgs = cloudinaryMocks.upload_stream.mock.calls[0];
    const optionsArg = callArgs[0] as Record<string, unknown>;
    // options should not contain any URL
    const optionsStr = JSON.stringify(optionsArg);
    expect(optionsStr).not.toContain("?key=");
    expect(optionsStr).not.toContain("googleapis.com");
    // folder and public_id should be set
    expect(optionsArg.folder).toBe("voyage/place-photos");
    expect(typeof optionsArg.public_id).toBe("string");
  });
});

function createUser(overrides: Partial<ImageUser> = {}): ImageUser {
  return {
    id: "user-1",
    status: "ACTIVE",
    ...overrides
  };
}

function createMemoryImageRepository(): ImageRepository & {
  images: Awaited<ReturnType<ImageRepository["createImageAsset"]>>[];
  agencies: Map<string, { id: string; status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED" }>;
  memberships: Map<string, { userId: string; agencyId: string; role: "OWNER" | "ADMIN" | "STAFF"; status: "ACTIVE" | "DISABLED" }>;
  tripAccess: boolean;
} {
  const images: Awaited<ReturnType<ImageRepository["createImageAsset"]>>[] = [];
  const agencies = new Map<string, { id: string; status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED" }>();
  const memberships = new Map<string, { userId: string; agencyId: string; role: "OWNER" | "ADMIN" | "STAFF"; status: "ACTIVE" | "DISABLED" }>();
  const repository = {
    images,
    agencies,
    memberships,
    tripAccess: false,
    async findAgencyAccess(userId, agencyId) {
      const agency = agencies.get(agencyId) ?? null;
      const membership = memberships.get(`${agencyId}:${userId}`) ?? null;
      return agency ? { agency, membership } : null;
    },
    async userHasTripAccess(this: { tripAccess: boolean }, _userId, _agencyId, _tripId) {
      return this.tripAccess;
    },
    async createImageAsset(data) {
      const image = {
        id: `image-${images.length + 1}`,
        status: "PENDING_UPLOAD" as const,
        width: null,
        height: null,
        checksum: null,
        createdAt: new Date("2026-04-27T12:00:00.000Z"),
        updatedAt: new Date("2026-04-27T12:00:00.000Z"),
        ...data
      };
      images.push(image);
      return image;
    },
    async findImageAsset(id) {
      return images.find((image) => image.id === id) ?? null;
    },
    async updateImageAsset(id, data) {
      const image = images.find((candidate) => candidate.id === id);
      if (!image) {
        throw new Error(`Missing image ${id}`);
      }
      Object.assign(image, data);
      return image;
    }
  } satisfies ImageRepository & {
    images: typeof images;
    agencies: typeof agencies;
    memberships: typeof memberships;
    tripAccess: boolean;
  };

  return repository;
}

function createService() {
  const repository = createMemoryImageRepository();
  const storage: ImageStorage = {
    bucket: "voyage-test",
    createUploadUrl: async ({ objectKey }) => `https://storage.example/upload/${objectKey}`,
    createReadUrl: async ({ objectKey }) => `https://storage.example/read/${objectKey}`
  };
  const service = createImageService({
    repository,
    storage,
    now: () => new Date("2026-04-27T12:00:00.000Z"),
    createObjectKey: ({ purpose }) => `images/${purpose.toLowerCase()}/fixed-key`
  });
  return { service, repository };
}

describe("image service", () => {
  it("rejects SVG uploads", async () => {
    const { service } = createService();

    await expect(
      service.requestUpload(createUser(), {
        purpose: "PROFILE_AVATAR",
        mimeType: "image/svg+xml",
        sizeBytes: 1000
      })
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_TYPE",
      statusCode: 400
    });
  });

  it("enforces purpose-specific image size limits", async () => {
    const { service } = createService();

    await expect(
      service.requestUpload(createUser(), {
        purpose: "PROFILE_AVATAR",
        mimeType: "image/png",
        sizeBytes: 2 * 1024 * 1024 + 1
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });

    await expect(
      service.requestUpload(createUser(), {
        purpose: "AGENCY_LOGO",
        agencyId: "agency-1",
        mimeType: "image/png",
        sizeBytes: 2 * 1024 * 1024 + 1
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });

    await expect(
      service.requestUpload(createUser(), {
        purpose: "TRIP_ITINERARY_IMAGE",
        agencyId: "agency-1",
        tripId: "trip-1",
        mimeType: "image/jpeg",
        sizeBytes: 8 * 1024 * 1024 + 1
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("allows a signed-in user to request a profile avatar upload", async () => {
    const { service, repository } = createService();

    const result = await service.requestUpload(createUser({ id: "user-avatar" }), {
      purpose: "PROFILE_AVATAR",
      mimeType: "image/webp",
      sizeBytes: 1000
    });

    expect(result.uploadUrl).toBe("https://storage.example/upload/images/profile_avatar/fixed-key");
    expect(repository.images[0]).toMatchObject({
      ownerUserId: "user-avatar",
      purpose: "PROFILE_AVATAR",
      mimeType: "image/webp",
      status: "PENDING_UPLOAD"
    });
  });

  it("blocks agency logo upload for unverified agencies", async () => {
    const { service, repository } = createService();
    repository.agencies.set("agency-1", { id: "agency-1", status: "PENDING_REVIEW" });
    repository.memberships.set("agency-1:user-1", {
      agencyId: "agency-1",
      userId: "user-1",
      role: "OWNER",
      status: "ACTIVE"
    });

    await expect(
      service.requestUpload(createUser(), {
        purpose: "AGENCY_LOGO",
        agencyId: "agency-1",
        mimeType: "image/png",
        sizeBytes: 1000
      })
    ).rejects.toMatchObject({
      code: "AGENCY_NOT_VERIFIED",
      statusCode: 403
    });
  });

  it("allows verified agency owner or admin to request logo upload", async () => {
    const { service, repository } = createService();
    repository.agencies.set("agency-1", { id: "agency-1", status: "VERIFIED" });
    repository.memberships.set("agency-1:user-1", {
      agencyId: "agency-1",
      userId: "user-1",
      role: "ADMIN",
      status: "ACTIVE"
    });

    const result = await service.requestUpload(createUser(), {
      purpose: "AGENCY_LOGO",
      agencyId: "agency-1",
      mimeType: "image/png",
      sizeBytes: 1000
    });

    expect(result.image.purpose).toBe("AGENCY_LOGO");
    expect(result.image.agencyId).toBe("agency-1");
  });

  it("allows verified agency member with trip access to request trip image upload", async () => {
    const { service, repository } = createService();
    repository.tripAccess = true;
    repository.agencies.set("agency-1", { id: "agency-1", status: "VERIFIED" });
    repository.memberships.set("agency-1:user-1", {
      agencyId: "agency-1",
      userId: "user-1",
      role: "STAFF",
      status: "ACTIVE"
    });

    const result = await service.requestUpload(createUser(), {
      purpose: "CLIENT_ITINERARY_IMAGE",
      agencyId: "agency-1",
      tripId: "trip-1",
      mimeType: "image/jpeg",
      sizeBytes: 1000
    });

    expect(result.image).toMatchObject({
      agencyId: "agency-1",
      tripId: "trip-1",
      purpose: "CLIENT_ITINERARY_IMAGE"
    });
  });
});
