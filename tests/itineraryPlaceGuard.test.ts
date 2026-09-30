import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  buildPreservationMap,
  consumePreservedId,
  prepareItineraryItems,
  prepareReplacementItems,
  prepareUpdatedItem
} from "../src/modules/itineraries/itineraryPlaceGuard";

/** A session fake that blocks any place whose name or snapshot ID is listed. */
function fakeSession(options: { blocked?: string[]; agencyId?: string | null } = {}) {
  const blocked = new Set(options.blocked ?? []);
  const prepare = vi.fn(async (item: any, fallback?: string) => {
    const key = item.placeSnapshotId ?? item.placeName;
    if (key && blocked.has(key)) {
      throw new ApiError(409, "PLACE_BLOCKED", `${key} cannot be used: blocked.`);
    }
    if (item.placeSnapshotId) {
      return {
        placeSnapshotId: item.placeSnapshotId,
        point: { latitude: 1, longitude: 2 },
        candidate: { name: key }
      };
    }
    if (!item.placeName) {
      return { placeSnapshotId: undefined, point: null, candidate: null };
    }
    return {
      placeSnapshotId: `resolved-${item.placeName}`,
      point: { latitude: 3, longitude: 4 },
      candidate: { name: item.placeName, cityContext: item.cityContext ?? fallback ?? null }
    };
  });

  return {
    // `??` would collapse a deliberate null (the personal case) into the default.
    agencyId: "agencyId" in options ? options.agencyId : "agency-1",
    prepare,
    evaluate: vi.fn(() => ({ allowed: true })),
    consider: vi.fn(),
    explanations: () => [],
    notesUnavailable: false,
    gate: {} as any
  } as any;
}

function item(overrides: Record<string, unknown> = {}) {
  return { type: "ACTIVITY", title: "Stop", ...overrides };
}

function storedItinerary(items: Array<{ id: string; placeSnapshotId: string | null; name?: string }>) {
  return {
    id: "itin-1",
    days: [
      {
        id: "day-1",
        items: items.map((entry, index) => ({
          id: entry.id,
          sortOrder: index,
          title: "Existing",
          placeSnapshotId: entry.placeSnapshotId,
          placeSnapshot: entry.placeSnapshotId
            ? {
                id: entry.placeSnapshotId,
                name: entry.name ?? "Existing Place",
                latitude: 10,
                longitude: 20
              }
            : null
        }))
      }
    ]
  } as any;
}

describe("consumePreservedId", () => {
  it("consumes at most the stored count of each ID", () => {
    const remaining = new Map([["snap-1", 2]]);

    expect(consumePreservedId(remaining, "snap-1")).toBe(true);
    expect(consumePreservedId(remaining, "snap-1")).toBe(true);
    expect(consumePreservedId(remaining, "snap-1")).toBe(false);
  });

  it("never preserves an absent or empty ID", () => {
    const remaining = new Map([["snap-1", 1]]);

    expect(consumePreservedId(remaining, null)).toBe(false);
    expect(consumePreservedId(remaining, undefined)).toBe(false);
    expect(consumePreservedId(remaining, "")).toBe(false);
    expect(consumePreservedId(remaining, "other")).toBe(false);
  });
});

describe("buildPreservationMap", () => {
  it("counts each stored occurrence of a snapshot ID", () => {
    const map = buildPreservationMap(
      storedItinerary([
        { id: "a", placeSnapshotId: "snap-1" },
        { id: "b", placeSnapshotId: "snap-1" },
        { id: "c", placeSnapshotId: "snap-2" },
        { id: "d", placeSnapshotId: null }
      ])
    );

    expect(map.get("snap-1")).toBe(2);
    expect(map.get("snap-2")).toBe(1);
    expect(map.size).toBe(2);
  });
});

describe("prepareItineraryItems (create and add)", () => {
  it("prepares every place-bearing item", async () => {
    const session = fakeSession();

    const prepared = await prepareItineraryItems({
      session,
      items: [item({ placeName: "Alpha" }), item({ placeSnapshotId: "snap-1" }), item({ title: "Just a note" })],
      cityContextFallback: "Cebu"
    });

    expect(session.prepare).toHaveBeenCalledTimes(3);
    expect(prepared[0].item.placeSnapshotId).toBe("resolved-Alpha");
    expect(prepared[1].item.placeSnapshotId).toBe("snap-1");
    expect(prepared[2].item.placeSnapshotId).toBeUndefined();
  });

  it("rejects the whole batch when one supplied ID is closed", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });

    const error = await prepareItineraryItems({
      session,
      items: [item({ placeName: "Alpha" }), item({ placeSnapshotId: "snap-closed" })]
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PLACE_BLOCKED");
  });

  it("treats every supplied place as new, even a cached one", async () => {
    const session = fakeSession({ blocked: ["Cached Closure"] });

    await expect(
      prepareItineraryItems({ session, items: [item({ placeName: "Cached Closure" })] })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });
});

describe("prepareUpdatedItem", () => {
  const stored = storedItinerary([{ id: "item-1", placeSnapshotId: "snap-closed", name: "Closed Stop" }]);

  it("lets a title-only patch of a closed stop through without preparing it", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });

    const patch = await prepareUpdatedItem({
      session,
      existingItinerary: stored,
      itemId: "item-1",
      patch: { title: "New title" }
    });

    expect(patch).toEqual({ title: "New title" });
    expect(session.prepare).not.toHaveBeenCalled();
  });

  it("lets a time-only patch through and retains the snapshot", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });

    const patch = await prepareUpdatedItem({
      session,
      existingItinerary: stored,
      itemId: "item-1",
      patch: { startTime: "09:00" }
    });

    expect(patch).toEqual({ startTime: "09:00" });
    expect(session.prepare).not.toHaveBeenCalled();
  });

  it("rejects a patch that changes identity to a blocked place", async () => {
    const session = fakeSession({ blocked: ["Blocked Bistro"] });

    await expect(
      prepareUpdatedItem({
        session,
        existingItinerary: stored,
        itemId: "item-1",
        patch: { placeName: "Blocked Bistro" }
      })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });

  it("checks a conflicting placeName even when the old snapshot ID is supplied", async () => {
    const session = fakeSession({ blocked: ["Different Place"] });

    await expect(
      prepareUpdatedItem({
        session,
        existingItinerary: stored,
        itemId: "item-1",
        patch: { placeSnapshotId: "snap-closed", placeName: "Different Place" }
      })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });

  it("preserves the stop when the supplied name matches its stored canonical name", async () => {
    const session = fakeSession({ blocked: ["snap-closed", "Closed Stop"] });

    const patch = await prepareUpdatedItem({
      session,
      existingItinerary: stored,
      itemId: "item-1",
      patch: { placeSnapshotId: "snap-closed", placeName: "Closed Stop", title: "Renamed" }
    });

    expect(patch.title).toBe("Renamed");
    expect(session.prepare).not.toHaveBeenCalled();
  });

  it("prepares a genuinely new snapshot ID", async () => {
    const session = fakeSession();

    const patch = await prepareUpdatedItem({
      session,
      existingItinerary: stored,
      itemId: "item-1",
      patch: { placeSnapshotId: "snap-new" }
    });

    expect(session.prepare).toHaveBeenCalledTimes(1);
    expect(patch.placeSnapshotId).toBe("snap-new");
  });

  it("fails when the item does not belong to the authorized itinerary", async () => {
    const session = fakeSession();

    await expect(
      prepareUpdatedItem({
        session,
        existingItinerary: stored,
        itemId: "not-here",
        patch: { placeName: "Anything" }
      })
    ).rejects.toMatchObject({ code: "ITINERARY_ITEM_NOT_FOUND" });
  });
});

describe("prepareReplacementItems (full draft replacement)", () => {
  it("preserves an existing closed occurrence but rejects a new duplicate", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });
    const stored = storedItinerary([{ id: "item-1", placeSnapshotId: "snap-closed" }]);

    const preserved = await prepareReplacementItems({
      session,
      existingItinerary: stored,
      days: [{ items: [item({ placeSnapshotId: "snap-closed" })] }]
    });
    expect(preserved[0].items[0].placeSnapshotId).toBe("snap-closed");
    expect(session.prepare).not.toHaveBeenCalled();

    await expect(
      prepareReplacementItems({
        session,
        existingItinerary: stored,
        days: [
          {
            items: [item({ placeSnapshotId: "snap-closed" }), item({ placeSnapshotId: "snap-closed" })]
          }
        ]
      })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });

  it("does not exempt every occurrence just because the ID appears once", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });
    const stored = storedItinerary([
      { id: "item-1", placeSnapshotId: "snap-closed" },
      { id: "item-2", placeSnapshotId: "snap-closed" }
    ]);

    // Two stored occurrences: two are preserved, a third is a new selection.
    await expect(
      prepareReplacementItems({
        session,
        existingItinerary: stored,
        days: [
          {
            items: [
              item({ placeSnapshotId: "snap-closed" }),
              item({ placeSnapshotId: "snap-closed" }),
              item({ placeSnapshotId: "snap-closed" })
            ]
          }
        ]
      })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });

  it("allows moving a preserved stop to another day", async () => {
    const session = fakeSession({ blocked: ["snap-closed"] });
    const stored = storedItinerary([{ id: "item-1", placeSnapshotId: "snap-closed" }]);

    const days = await prepareReplacementItems({
      session,
      existingItinerary: stored,
      days: [{ items: [] }, { items: [item({ placeSnapshotId: "snap-closed" })] }]
    });

    expect(days[1].items[0].placeSnapshotId).toBe("snap-closed");
  });

  it("prepares new items alongside preserved ones", async () => {
    const session = fakeSession();
    const stored = storedItinerary([{ id: "item-1", placeSnapshotId: "snap-1" }]);

    const days = await prepareReplacementItems({
      session,
      existingItinerary: stored,
      days: [{ items: [item({ placeSnapshotId: "snap-1" }), item({ placeName: "Brand New" })] }]
    });

    expect(session.prepare).toHaveBeenCalledTimes(1);
    expect(days[0].items[1].placeSnapshotId).toBe("resolved-Brand New");
  });

  it("checks a supplied name that conflicts with the preserved snapshot's stored name", async () => {
    const session = fakeSession({ blocked: ["Somewhere Else"] });
    const stored = storedItinerary([
      { id: "item-1", placeSnapshotId: "snap-1", name: "Original Name" }
    ]);

    await expect(
      prepareReplacementItems({
        session,
        existingItinerary: stored,
        days: [{ items: [item({ placeSnapshotId: "snap-1", placeName: "Somewhere Else" })] }]
      })
    ).rejects.toMatchObject({ code: "PLACE_BLOCKED" });
  });
});

describe("session/agency agreement", () => {
  it("refuses a session scoped to a different agency", async () => {
    const session = fakeSession({ agencyId: "agency-2" });

    await expect(
      prepareItineraryItems({
        session,
        items: [item({ placeName: "Alpha" })],
        expectedAgencyId: "agency-1"
      })
    ).rejects.toMatchObject({ code: "PLACE_SESSION_MISMATCH" });
  });

  it("accepts a matching agency, including the null personal case", async () => {
    const personal = fakeSession({ agencyId: null });

    await expect(
      prepareItineraryItems({
        session: personal,
        items: [item({ placeName: "Alpha" })],
        expectedAgencyId: null
      })
    ).resolves.toHaveLength(1);
  });
});
