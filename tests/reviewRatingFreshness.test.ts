import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: { itineraryShare: { findUnique: mocks.findUnique, update: mocks.update } }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { createReviewService } from "../src/modules/reviews/reviewService";

const AGENCY_SHARE = { id: "share-1", agencyId: "agency-1", revokedAt: null, expiresAt: null, proposalRating: null, proposalRatedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ proposalRating: 4, proposalRatingComment: null, proposalRatedAt: new Date() });
});

describe("proposal rating", () => {
  it("clears the agency's cached dashboards once the rating is saved", async () => {
    mocks.findUnique.mockResolvedValue(AGENCY_SHARE);
    await createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 });
    expect(mocks.findUnique.mock.calls[0][0].select).toMatchObject({ agencyId: true });
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith("agency-1");
  });

  it("does nothing for a personal link", async () => {
    mocks.findUnique.mockResolvedValue({ ...AGENCY_SHARE, agencyId: null });
    await createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 });
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });

  it("leaves the caches alone when saving the rating fails", async () => {
    mocks.findUnique.mockResolvedValue(AGENCY_SHARE);
    mocks.update.mockRejectedValue(new Error("database down"));
    await expect(
      createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 })
    ).rejects.toThrow("database down");
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });

  it("still returns the saved rating when clearing the caches throws", async () => {
    mocks.findUnique.mockResolvedValue(AGENCY_SHARE);
    mocks.invalidateAgencyDashboards.mockImplementation(() => {
      throw new Error("cache broke");
    });
    await expect(
      createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 })
    ).resolves.toMatchObject({ rating: 4 });
  });
});
