import { describe, expect, it } from "vitest";
import { stopsWithStaleRoutes, type DayItemOrder } from "../src/modules/itineraries/routeStaleness";

// A route starts at the nearest earlier stop with a place on the map, so stops are
// either places (on the map) or custom stops (no place, never a route's start).
const custom = (id: string) => ({ id, mapped: false });
const day = (id: string, ...items: Array<string | { id: string; mapped: boolean }>) => ({
  id,
  items: items.map((item) => (typeof item === "string" ? { id: item, mapped: true } : item))
});

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

  it("keeps a route when a custom stop is added before it", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b")], [day("d1", "a", custom("note"), "b")])).toEqual([]);
  });

  it("keeps a route when a custom stop before it is removed or moved away", () => {
    const before: DayItemOrder = [day("d1", "a", custom("note"), "b")];
    expect(stopsWithStaleRoutes(before, [day("d1", "a", "b")])).toEqual([]);
    expect(stopsWithStaleRoutes(before, [day("d1", "a", "b", custom("note"))])).toEqual([]);
  });

  it("flags a route that started at a stop moved away from behind a custom stop", () => {
    const before: DayItemOrder = [day("d1", "a", custom("note"), "b"), day("d2", "d")];
    const after: DayItemOrder = [day("d1", custom("note"), "b"), day("d2", "d", "a")];
    expect(stopsWithStaleRoutes(before, after)).toEqual(["b", "a"]);
  });

  it("never flags a custom stop, which has no route", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b", custom("note"))], [day("d1", "b", custom("note"), "a")])).toEqual([
      "b",
      "a"
    ]);
  });

  it("keeps the route of a day's first stop on the map when a custom stop moves ahead of it", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", custom("note"))], [day("d1", custom("note"), "a")])).toEqual([]);
  });
});
