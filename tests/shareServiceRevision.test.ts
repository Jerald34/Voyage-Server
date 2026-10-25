import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createShareService } from "../src/modules/shares/shareService";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(shareOverrides: Record<string, unknown> = {}, found = true) {
  const data = {
    share: { id: "share-1", agencyId: "agency-1", revokedAt: null, expiresAt: null, viewCount: 0, ...shareOverrides },
    agency: { id: "agency-1", name: "Wanderlust", logoImage: null },
    creator: { id: "u-1", displayName: "Alice" },
    trip: null,
    itinerary: { id: "it-1", title: "Baguio", summary: null, version: 1, days: [] }
  };
  const repository = {
    findShareByToken: vi.fn().mockResolvedValue(found ? data : null),
    incrementViewCount: vi.fn().mockResolvedValue(undefined)
  };
  const onAgencyActivity = vi.fn();
  const service = createShareService({ repository: repository as never, onAgencyActivity });
  return { repository, onAgencyActivity, service };
}

describe("shareService.getShareRevision", () => {
  it("returns the fingerprint of the itinerary content", async () => {
    const { service } = setup();
    await expect(service.getShareRevision("token-123456789")).resolves.toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not count a view or report agency activity", async () => {
    const { service, repository, onAgencyActivity } = setup();
    await service.getShareRevision("token-123456789");
    await flush();
    expect(repository.incrementViewCount).not.toHaveBeenCalled();
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });

  it("throws 404 for an unknown token", async () => {
    const { service } = setup({}, false);
    await expect(service.getShareRevision("token-123456789")).rejects.toMatchObject({ statusCode: 404, code: "SHARE_NOT_FOUND" });
  });

  it("throws 410 for a revoked link", async () => {
    const { service } = setup({ revokedAt: new Date() });
    await expect(service.getShareRevision("token-123456789")).rejects.toMatchObject({ statusCode: 410, code: "SHARE_REVOKED" });
  });

  it("throws 410 for an expired link", async () => {
    const { service } = setup({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(service.getShareRevision("token-123456789")).rejects.toMatchObject({ statusCode: 410, code: "SHARE_EXPIRED" });
  });
});
