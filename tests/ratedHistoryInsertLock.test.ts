import { describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({ itinerary: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("../src/db/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
}));

import { insertItemsTransactional } from "../src/modules/ratedHistory/ratedHistoryRepository";
import { ItineraryLockedError } from "../src/modules/ratedHistory/ratedHistoryErrors";

describe("insertItemsTransactional", () => {
  it("refuses an itinerary that was approved before the write", async () => {
    tx.itinerary.findUnique.mockResolvedValue({ id: "itin-1", version: 3, status: "APPROVED_INTERNAL" });

    await expect(
      insertItemsTransactional({
        targetItineraryId: "itin-1",
        ifMatchVersion: 3,
        insertions: { mode: "items", targetDayId: "day-1", items: [] }
      })
    ).rejects.toBeInstanceOf(ItineraryLockedError);
    expect(tx.itinerary.update).not.toHaveBeenCalled();
  });
});
