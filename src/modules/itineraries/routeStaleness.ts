import { Prisma } from "@prisma/client";

/**
 * A stop's stored route (routeFromPrevious) runs from the nearest earlier stop in the
 * same day that is on the map (a place with coordinates) to this stop; custom stops
 * have no place and are skipped, as the agent does when it builds a route. After stops
 * are added, removed or moved, a stop whose route start changed keeps a route from the
 * wrong place. Those routes are cleared, so the map leaves the leg out instead of
 * drawing it wrong.
 */
export type DayItemOrder = Array<{ id: string; items: Array<{ id: string; mapped: boolean }> }>;

/** For each stop on the map, the stop its route starts from; null for the day's first. */
function routeStartById(days: DayItemOrder): Map<string, string | null> {
  const start = new Map<string, string | null>();
  for (const day of days) {
    let previousMapped: string | null = null;
    for (const item of day.items) {
      if (!item.mapped) continue;
      start.set(item.id, previousMapped);
      previousMapped = item.id;
    }
  }
  return start;
}

/**
 * Stops on the map in both orders whose route starts somewhere else afterwards, in
 * `after` order. A stop that only appears in `after` is skipped: whoever added it set
 * its route. A custom stop is never flagged: it has no route.
 */
export function stopsWithStaleRoutes(before: DayItemOrder, after: DayItemOrder): string[] {
  const startBefore = routeStartById(before);
  const stale: string[] = [];
  for (const [itemId, start] of routeStartById(after)) {
    if (startBefore.has(itemId) && startBefore.get(itemId) !== start) {
      stale.push(itemId);
    }
  }
  return stale;
}

type RouteTx = Pick<Prisma.TransactionClient, "itineraryDay" | "itineraryItem">;

const isCoordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** The stop order of the given days, for working out which routes a change made stale. */
export async function readDayOrders(tx: RouteTx, dayIds: string[]): Promise<DayItemOrder> {
  const days = await tx.itineraryDay.findMany({
    where: { id: { in: [...new Set(dayIds)] } },
    select: {
      id: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, placeSnapshot: { select: { latitude: true, longitude: true } } }
      }
    }
  });
  return days.map((day) => ({
    id: day.id,
    items: day.items.map((item) => ({
      id: item.id,
      mapped: isCoordinate(item.placeSnapshot?.latitude) && isCoordinate(item.placeSnapshot?.longitude)
    }))
  }));
}

/** Clears the stored route of every stop whose route start changed since `before`. */
export async function clearStaleRoutes(tx: RouteTx, dayIds: string[], before: DayItemOrder) {
  const stale = stopsWithStaleRoutes(before, await readDayOrders(tx, dayIds));
  if (stale.length === 0) return;
  await tx.itineraryItem.updateMany({
    where: { id: { in: stale } },
    data: { routeFromPrevious: Prisma.DbNull }
  });
}
