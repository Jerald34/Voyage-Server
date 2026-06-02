import { prisma } from "../../db/prisma";
import type { UsageRow } from "./usageAggregations";

export const usageRepository = {
  async listRunUsage({ from, to }: { from: Date; to: Date }): Promise<UsageRow[]> {
    const runs = await prisma.agentRun.findMany({
      where: { status: "COMPLETED", createdAt: { gte: from, lte: to }, totalTokens: { not: null } },
      select: {
        usageUserId: true, agencyId: true, createdAt: true,
        promptTokens: true, outputTokens: true, totalTokens: true, cachedTokens: true, costUsd: true,
        agency: { select: { name: true } }
      }
    });
    const userIds = [...new Set(runs.map((r) => r.usageUserId).filter(Boolean))] as string[];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    return runs.map((r) => ({
      usageUserId: r.usageUserId,
      userLabel: r.usageUserId ? (nameById.get(r.usageUserId) ?? null) : null,
      agencyId: r.agencyId,
      agencyLabel: r.agency?.name ?? null,
      createdAt: r.createdAt,
      promptTokens: r.promptTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      totalTokens: r.totalTokens ?? 0,
      cachedTokens: r.cachedTokens ?? 0,
      costUsd: Number(r.costUsd ?? 0)
    }));
  }
};
