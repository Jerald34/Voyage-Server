import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  itinerary: { findUnique: vi.fn(), update: vi.fn() },
  itineraryDay: { findMany: vi.fn() },
  itineraryItem: { updateMany: vi.fn(), create: vi.fn() }
}));
vi.mock("../src/db/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
}));

import { insertItemsTransactional } from "../src/modules/ratedHistory/ratedHistoryRepository";
import { ItineraryLockedError } from "../src/modules/ratedHistory/ratedHistoryErrors";

beforeEach(() => {
  vi.clearAllMocks();
  tx.itinerary.update.mockResolvedValue({ id: "itin-1", version: 4 });
});

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

describe("insertItemsTransactional stale routes", () => {
  const onMap = { latitude: 1, longitude: 1 };
  const copied = {
    id: "x",
    sortOrder: 2,
    type: "ACTIVITY",
    title: "Museum",
    description: null,
    startTime: null,
    endTime: null,
    placeSnapshotId: "snap-x",
    staffNotes: null
  };

  beforeEach(() => {
    tx.itinerary.findUnique.mockResolvedValue({ id: "itin-1", version: 3, status: "NEEDS_REVIEW" });
  });

  it("clears the route of the stop that now follows the copied stops", async () => {
    tx.itineraryDay.findMany
      .mockResolvedValueOnce([{ id: "day-1", items: [{ id: "a", placeSnapshot: onMap }, { id: "b", placeSnapshot: onMap }] }])
      .mockResolvedValueOnce([
        { id: "day-1", items: [{ id: "a", placeSnapshot: onMap }, { id: "x", placeSnapshot: onMap }, { id: "b", placeSnapshot: onMap }] }
      ]);

    await insertItemsTransactional({
      targetItineraryId: "itin-1",
      ifMatchVersion: 3,
      insertions: { mode: "items", targetDayId: "day-1", items: [copied], atPosition: 2 }
    });

    expect(tx.itineraryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b"] } },
      data: { routeFromPrevious: Prisma.DbNull }
    });
  });

  it("clears nothing when the copies go at the end of the day", async () => {
    tx.itineraryDay.findMany
      .mockResolvedValueOnce([{ id: "day-1", items: [{ id: "a", placeSnapshot: onMap }] }])
      .mockResolvedValueOnce([{ id: "day-1", items: [{ id: "a", placeSnapshot: onMap }, { id: "x", placeSnapshot: onMap }] }]);

    await insertItemsTransactional({
      targetItineraryId: "itin-1",
      ifMatchVersion: 3,
      insertions: { mode: "items", targetDayId: "day-1", items: [copied] }
    });

    expect(tx.itineraryItem.updateMany).not.toHaveBeenCalled();
  });
});
