import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createShareService } from "../src/modules/shares/shareService";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(agencyId: string | null) {
  const share = { id: "share-1", agencyId, revokedAt: null, expiresAt: null };
  const repository = {
    findShareByToken: vi.fn().mockResolvedValue({ share }),
    incrementViewCount: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue({ id: "c1" })
  };
  const onAgencyActivity = vi.fn();
  const service = createShareService({ repository: repository as never, onAgencyActivity });
  return { repository, onAgencyActivity, service };
}

describe("shareService agency activity", () => {
  it("reports a new client comment for the link's agency", async () => {
    const { service, onAgencyActivity } = setup("agency-1");
    await service.addComment("token-123456789", { authorName: "Maria", content: "Hi" });
    expect(onAgencyActivity).toHaveBeenCalledWith("agency-1");
  });

  it("reports a view once the count is saved", async () => {
    const { service, onAgencyActivity } = setup("agency-1");
    await service.getShareByToken("token-123456789");
    await flush();
    expect(onAgencyActivity).toHaveBeenCalledWith("agency-1");
  });

  it("stays quiet for a personal link with no agency", async () => {
    const { service, onAgencyActivity } = setup(null);
    await service.addComment("token-123456789", { authorName: "Maria", content: "Hi" });
    await service.getShareByToken("token-123456789");
    await flush();
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });

  it("does not report a view whose count failed to save", async () => {
    const { service, repository, onAgencyActivity } = setup("agency-1");
    repository.incrementViewCount.mockRejectedValue(new Error("database down"));
    await service.getShareByToken("token-123456789");
    await flush();
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });

  it("still returns the saved comment and the share when the hook throws", async () => {
    const { service, onAgencyActivity } = setup("agency-1");
    onAgencyActivity.mockImplementation(() => {
      throw new Error("cache broke");
    });
    await expect(service.addComment("token-123456789", { authorName: "Maria", content: "Hi" })).resolves.toEqual({ id: "c1" });
    await expect(service.getShareByToken("token-123456789")).resolves.toMatchObject({ share: { id: "share-1" } });
    await flush();
    expect(onAgencyActivity).toHaveBeenCalledTimes(2);
  });
});
