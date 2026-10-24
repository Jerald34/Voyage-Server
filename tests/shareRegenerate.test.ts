import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaShareRepository } from "../src/modules/shares/shareRepository";
import { createShareService } from "../src/modules/shares/shareService";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const liveShare = {
  id: "share-1",
  token: "old-token-123",
  itineraryId: "it-1",
  tripId: "trip-1",
  agencyId: AGENCY_ID,
  clientName: "Reyes",
  clientEmail: "reyes@example.com",
  expiresAt: at(5 * DAY),
  revokedAt: null
};

function serviceWith(share: Record<string, unknown> | null, replaced: Record<string, unknown> | null = { id: "share-2" }) {
  const repository = {
    findShareForAgency: vi.fn().mockResolvedValue(share),
    replaceShare: vi.fn().mockResolvedValue(replaced)
  };
  return { repository, service: createShareService({ repository: repository as never }) };
}

describe("shareService.regenerateShare", () => {
  it("swaps the agency's live link for a new token", async () => {
    const { repository, service } = serviceWith(liveShare, { id: "share-2", token: "new" });

    await expect(service.regenerateShare(AGENCY_ID, "share-1", NOW)).resolves.toEqual({ id: "share-2", token: "new" });
    expect(repository.findShareForAgency).toHaveBeenCalledWith(AGENCY_ID, "share-1");
    expect(repository.replaceShare).toHaveBeenCalledWith(AGENCY_ID, "share-1", expect.stringMatching(/^[\w-]{12}$/));
  });

  it("works for a link that never expires", async () => {
    const { repository, service } = serviceWith({ ...liveShare, expiresAt: null });
    await service.regenerateShare(AGENCY_ID, "share-1", NOW);
    expect(repository.replaceShare).toHaveBeenCalled();
  });

  it("says not found for another agency's link", async () => {
    const { repository, service } = serviceWith(null);
    await expect(service.regenerateShare(AGENCY_ID, "share-1", NOW)).rejects.toMatchObject({ statusCode: 404, code: "SHARE_NOT_FOUND" });
    expect(repository.replaceShare).not.toHaveBeenCalled();
  });

  it("refuses a link that was turned off", async () => {
    const { repository, service } = serviceWith({ ...liveShare, revokedAt: at(-DAY) });
    await expect(service.regenerateShare(AGENCY_ID, "share-1", NOW)).rejects.toMatchObject({ statusCode: 409, code: "SHARE_REVOKED" });
    expect(repository.replaceShare).not.toHaveBeenCalled();
  });

  it("refuses an expired link, which would only copy a dead expiry", async () => {
    const { repository, service } = serviceWith({ ...liveShare, expiresAt: at(-DAY) });
    await expect(service.regenerateShare(AGENCY_ID, "share-1", NOW)).rejects.toMatchObject({ statusCode: 409, code: "SHARE_EXPIRED" });
    expect(repository.replaceShare).not.toHaveBeenCalled();
  });

  it("refuses when the link was turned off between the read and the swap", async () => {
    const { service } = serviceWith(liveShare, null);
    await expect(service.regenerateShare(AGENCY_ID, "share-1", NOW)).rejects.toMatchObject({ statusCode: 409, code: "SHARE_REVOKED" });
  });
});

function fakeClient(oldRow: Record<string, unknown> | null, revokedCount = 1) {
  const tx = {
    itineraryShare: {
      updateMany: vi.fn().mockResolvedValue({ count: revokedCount }),
      findFirst: vi.fn().mockResolvedValue(oldRow),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "share-2", ...data }))
    }
  };
  const client = { $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)) };
  return { tx, client };
}

describe("shareRepository.replaceShare", () => {
  it("turns the old link off and creates the new one with its client, email, expiry and itinerary, in one transaction", async () => {
    const { tx, client } = fakeClient({ ...liveShare, revokedAt: NOW });
    const repository = createPrismaShareRepository(client as never);

    const created = await repository.replaceShare(AGENCY_ID, "share-1", "new-token-12");

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.itineraryShare.updateMany).toHaveBeenCalledWith({
      where: { id: "share-1", agencyId: AGENCY_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(tx.itineraryShare.create).toHaveBeenCalledWith({
      data: {
        token: "new-token-12",
        itineraryId: "it-1",
        tripId: "trip-1",
        agencyId: AGENCY_ID,
        clientName: "Reyes",
        clientEmail: "reyes@example.com",
        expiresAt: liveShare.expiresAt
      }
    });
    expect(created).toMatchObject({ id: "share-2", token: "new-token-12", clientEmail: "reyes@example.com" });
  });

  it("creates nothing when the old link was already off", async () => {
    const { tx, client } = fakeClient(null, 0);
    const repository = createPrismaShareRepository(client as never);

    await expect(repository.replaceShare(AGENCY_ID, "share-1", "new-token-12")).resolves.toBeNull();
    expect(tx.itineraryShare.create).not.toHaveBeenCalled();
  });
});
