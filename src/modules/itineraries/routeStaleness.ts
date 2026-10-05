/**
 * A stop's stored route (routeFromPrevious) starts at the stop before it. After stops
 * are added, removed or moved, a stop whose previous stop changed keeps a route from
 * the wrong place. Those routes are cleared, so the map leaves the leg out instead of
 * drawing it wrong.
 */
export type DayItemOrder = Array<{ id: string; items: Array<{ id: string }> }>;

/** Each stop's previous stop in the same day; the first stop of a day has none. */
function previousStopById(days: DayItemOrder): Map<string, string | null> {
  const previous = new Map<string, string | null>();
  for (const day of days) {
    day.items.forEach((item, index) => {
      previous.set(item.id, index === 0 ? null : day.items[index - 1].id);
    });
  }
  return previous;
}

/**
 * Stops in both orders whose previous stop is different afterwards, in `after` order.
 * A stop that only appears in `after` is skipped: whoever added it set its route.
 */
export function stopsWithStaleRoutes(before: DayItemOrder, after: DayItemOrder): string[] {
  const previousBefore = previousStopById(before);
  const stale: string[] = [];
  for (const [itemId, previous] of previousStopById(after)) {
    if (previousBefore.has(itemId) && previousBefore.get(itemId) !== previous) {
      stale.push(itemId);
    }
  }
  return stale;
}
