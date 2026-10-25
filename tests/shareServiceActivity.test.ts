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

  it("counts a view only when the page records one, then reports it", async () => {
    const { service, repository, onAgencyActivity } = setup("agency-1");
    await service.getShareByToken("token-123456789");
    await flush();
    expect(repository.incrementViewCount).not.toHaveBeenCalled();
    expect(onAgencyActivity).not.toHaveBeenCalled();

    await service.recordView("token-123456789");
    expect(repository.incrementViewCount).toHaveBeenCalledWith("share-1");
    expect(onAgencyActivity).toHaveBeenCalledWith("agency-1");
  });

  it("stays quiet for a personal link with no agency", async () => {
    const { service, onAgencyActivity } = setup(null);
    await service.addComment("token-123456789", { authorName: "Maria", content: "Hi" });
    await service.recordView("token-123456789");
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });

  it("does not report a view whose count failed to save", async () => {
    const { service, repository, onAgencyActivity } = setup("agency-1");
    repository.incrementViewCount.mockRejectedValue(new Error("database down"));
    await expect(service.recordView("token-123456789")).rejects.toThrow("database down");
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });

  it("does not count a view of a link that was turned off or ran out", async () => {
    const { service, repository } = setup("agency-1");
    repository.findShareByToken.mockResolvedValue({ share: { id: "share-1", agencyId: "agency-1", revokedAt: new Date(), expiresAt: null } });
    await expect(service.recordView("token-123456789")).rejects.toMatchObject({ statusCode: 410 });
    repository.findShareByToken.mockResolvedValue({ share: { id: "share-1", agencyId: "agency-1", revokedAt: null, expiresAt: new Date("2020-01-01") } });
    await expect(service.recordView("token-123456789")).rejects.toMatchObject({ statusCode: 410 });
    expect(repository.incrementViewCount).not.toHaveBeenCalled();
  });

  it("still saves the comment and the view when the hook throws", async () => {
    const { service, repository, onAgencyActivity } = setup("agency-1");
    onAgencyActivity.mockImplementation(() => {
      throw new Error("cache broke");
    });
    await expect(service.addComment("token-123456789", { authorName: "Maria", content: "Hi" })).resolves.toEqual({ id: "c1" });
    await expect(service.recordView("token-123456789")).resolves.toBeUndefined();
    expect(repository.incrementViewCount).toHaveBeenCalled();
    expect(onAgencyActivity).toHaveBeenCalledTimes(2);
  });
});
