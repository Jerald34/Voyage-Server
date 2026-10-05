import { describe, expect, it } from "vitest";
import {
  manualDayRenameSchema,
  manualStopCreateSchema,
  manualStopMoveSchema,
  manualStopPatchSchema
} from "../src/modules/itineraries/itinerarySchemas";

describe("hand-edit schemas", () => {
  it("accepts a custom stop with just a type and a trimmed title", () => {
    expect(manualStopCreateSchema.parse({ type: "NOTE", title: "  Coffee break " })).toEqual({
      type: "NOTE",
      title: "Coffee break"
    });
  });

  it("rejects place fields, so a hand edit can't change which place a stop points to", () => {
    expect(manualStopCreateSchema.safeParse({ type: "ACTIVITY", title: "Museum", placeName: "Museo" }).success).toBe(false);
    expect(
      manualStopPatchSchema.safeParse({ placeSnapshotId: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(false);
  });

  it("accepts a patch that clears a field, and refuses an empty patch or a blank title", () => {
    expect(manualStopPatchSchema.parse({ description: "" })).toEqual({ description: "" });
    expect(manualStopPatchSchema.safeParse({}).success).toBe(false);
    expect(manualStopPatchSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("needs a real day id to move a stop", () => {
    expect(manualStopMoveSchema.safeParse({ toDayId: "day-2" }).success).toBe(false);
    expect(
      manualStopMoveSchema.parse({ toDayId: "22222222-2222-4222-8222-222222222222", toSortOrder: 1 })
    ).toEqual({ toDayId: "22222222-2222-4222-8222-222222222222", toSortOrder: 1 });
  });

  it("trims a day title and refuses a blank one", () => {
    expect(manualDayRenameSchema.parse({ title: " Old town " })).toEqual({ title: "Old town" });
    expect(manualDayRenameSchema.safeParse({ title: " " }).success).toBe(false);
  });
});
