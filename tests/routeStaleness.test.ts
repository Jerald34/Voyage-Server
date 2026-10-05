import { describe, expect, it } from "vitest";
import { stopsWithStaleRoutes, type DayItemOrder } from "../src/modules/itineraries/routeStaleness";

const day = (id: string, ...itemIds: string[]) => ({ id, items: itemIds.map((itemId) => ({ id: itemId })) });

describe("stopsWithStaleRoutes", () => {
  it("flags the stop after a removed stop", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b", "c")], [day("d1", "a", "c")])).toEqual(["c"]);
  });

  it("flags every stop whose previous stop changed in a reorder", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b", "c")], [day("d1", "b", "a", "c")])).toEqual(["b", "a", "c"]);
  });

  it("flags a stop moved to another day and the stop it left behind", () => {
    const before: DayItemOrder = [day("d1", "a", "b", "c"), day("d2", "d")];
    const after: DayItemOrder = [day("d1", "a", "c"), day("d2", "d", "b")];
    expect(stopsWithStaleRoutes(before, after)).toEqual(["c", "b"]);
  });

  it("skips a new stop but flags the stop it was inserted before", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b")], [day("d1", "a", "new", "b")])).toEqual(["b"]);
  });

  it("flags nothing when a stop is added at the end", () => {
    expect(stopsWithStaleRoutes([day("d1", "a")], [day("d1", "a", "new")])).toEqual([]);
  });
});
