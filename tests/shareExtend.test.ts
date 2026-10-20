import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { computeExtendedExpiry } from "../src/modules/shares/shareExpiry";
import { createPrismaShareRepository } from "../src/modules/shares/shareRepository";
import { createShareService } from "../src/modules/shares/shareService";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("computeExtendedExpiry", () => {
  it("adds the days to an expiry still ahead", () => {
    expect(computeExtendedExpiry(at(2 * DAY), 7, NOW)).toEqual(at(9 * DAY));
  });
  it("counts from now for a link that already expired", () => {
    expect(computeExtendedExpiry(at(-3 * DAY), 30, NOW)).toEqual(at(30 * DAY));
  });
});

function serviceWith(share: Record<string, unknown> | null) {
  const repository = {
    findShareForAgency: vi.fn().mockResolvedValue(share),
    updateShareExpiry: vi.fn(async (_id: string, expiresAt: Date) => ({ ...share, expiresAt }))
  };
  return { repository, service: createShareService({ repository: repository as never }) };
}

describe("shareService.extendShare", () => {
  it("saves the extended expiry for the agency's live link", async () => {
    const { repository, service } = serviceWith({ id: "share-1", expiresAt: at(1 * DAY), revokedAt: null });
    const share = await service.extendShare(AGENCY_ID, "share-1", 7, NOW);
    expect(repository.findShareForAgency).toHaveBeenCalledWith(AGENCY_ID, "share-1");
    expect(repository.updateShareExpiry).toHaveBeenCalledWith("share-1", at(8 * DAY));
    expect(share.expiresAt).toEqual(at(8 * DAY));
  });

  it("says not found for another agency's link", async () => {
    const { repository, service } = serviceWith(null);
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" });
    expect(repository.updateShareExpiry).not.toHaveBeenCalled();
  });

  it("refuses a revoked link", async () => {
    const { repository, service } = serviceWith({ id: "share-1", expiresAt: at(1 * DAY), revokedAt: at(-1 * DAY) });
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_REVOKED" });
    expect(repository.updateShareExpiry).not.toHaveBeenCalled();
  });

  it("refuses a link that never expires", async () => {
    const { repository, service } = serviceWith({ id: "share-1", expiresAt: null, revokedAt: null });
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_NEVER_EXPIRES" });
    expect(repository.updateShareExpiry).not.toHaveBeenCalled();
  });
});

describe("share repository: finding a link to extend", () => {
  it("looks the link up by id and agency, so another agency's link is never found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = createPrismaShareRepository({ itineraryShare: { findFirst } } as never);
    await expect(repository.findShareForAgency(AGENCY_ID, "share-1")).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "share-1", agencyId: AGENCY_ID } });
  });
});
