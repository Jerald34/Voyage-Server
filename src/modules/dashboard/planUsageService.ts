import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Manila has no daylight saving, so a fixed +8 hours finds its month boundaries.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Manila calendar month containing `now`, as UTC instants: [start, end). */
export function manilaMonthRange(now: Date) {
  const local = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - MANILA_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - MANILA_OFFSET_MS)
  };
}

export type PlanUsage = {
  periodStart: string;
  // Exclusive: the start of the next Manila month.
  periodEnd: string;
  itinerariesCreated: number;
  agentRequests: number;
  activeMembers: number;
};

/**
 * This month's usage for the owner's "Plan and usage" card. Read-only counts: Voyage
 * stores no plan and enforces no limit (the prices are display only).
 */
export async function getPlanUsage(
  agencyId: string,
  now: Date = new Date(),
  client: PrismaClient = prisma
): Promise<PlanUsage> {
  const { start, end } = manilaMonthRange(now);
  const createdAt = { gte: start, lt: end };
  const [itinerariesCreated, agentRequests, activeMembers] = await Promise.all([
    client.itinerary.count({ where: { agencyId, createdAt } }),
    client.agentRun.count({ where: { agencyId, createdAt } }),
    client.agencyMembership.count({ where: { agencyId, status: "ACTIVE" } })
  ]);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    itinerariesCreated,
    agentRequests,
    activeMembers
  };
}
