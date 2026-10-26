import { prisma } from "../../db/prisma";
import { getActiveAgentPause } from "../agentPause/agentPause";
import type { RoleTag, UsageRunRow } from "./usageAggregations";

export interface UsageRunFilter {
  userId?: string;
  agencyId?: string;
  threadId?: string;
}

export interface UsageCall {
  callIndex: number;
  phase: string;
  modelName: string;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

const runSelect = {
  id: true,
  status: true,
  createdAt: true,
  usageUserId: true,
  agencyId: true,
  threadId: true,
  promptTokens: true,
  outputTokens: true,
  thoughtsTokens: true,
  totalTokens: true,
  cachedTokens: true,
  costUsd: true,
  costComplete: true,
  usageDetail: true,
  agency: { select: { name: true } }
} as const;

type RunRecord = {
  id: string;
  status: string;
  createdAt: Date;
  usageUserId: string | null;
  agencyId: string | null;
  threadId: string;
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  costUsd: unknown;
  costComplete: boolean;
  usageDetail: unknown;
  agency: { name: string } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const detailEntries = (detail: unknown): Record<string, unknown>[] =>
  Array.isArray(detail) ? detail.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];

/**
 * Joins runs with their chat titles, users and the user's role in the run's agency.
 * Thread titles are fetched separately: AgentRun.thread is a composite relation on (threadId, agencyId).
 */
async function hydrate(runs: RunRecord[]): Promise<UsageRunRow[]> {
  const threadIds = [...new Set(runs.map((r) => r.threadId))];
  const userIds = [...new Set(runs.map((r) => r.usageUserId).filter((id): id is string => !!id))];
  const [threads, users] = await Promise.all([
    threadIds.length ? prisma.agentThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, title: true } }) : [],
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            displayName: true,
            accountType: true,
            memberships: { select: { agencyId: true, role: true } },
            agentPausedAt: true,
            agentPausedUntil: true,
            agentPauseReason: true
          }
        })
      : []
  ]);
  const titleById = new Map(threads.map((t) => [t.id, t.title]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return runs.map((r) => {
    const user = r.usageUserId ? userById.get(r.usageUserId) : undefined;
    let roleTag: RoleTag | null = null;
    if (user?.accountType === "PERSONAL") roleTag = "PERSONAL";
    else if (user && r.agencyId) roleTag = (user.memberships.find((m) => m.agencyId === r.agencyId)?.role as RoleTag | undefined) ?? null;

    const calls = detailEntries(r.usageDetail);
    const modelNames = [...new Set(calls.map((c) => c.modelName).filter((n): n is string => typeof n === "string"))];
    const unpricedModelNames = [
      ...new Set(calls.filter((c) => c.costUsd === null).map((c) => c.modelName).filter((n): n is string => typeof n === "string"))
    ];

    return {
      runId: r.id,
      status: r.status === "FAILED" ? "FAILED" : "COMPLETED",
      createdAt: r.createdAt,
      usageUserId: r.usageUserId,
      userLabel: user?.displayName ?? null,
      accountType: user?.accountType ?? null,
      userAgentPause: user ? getActiveAgentPause(user) : null,
      roleTag,
      agencyId: r.agencyId,
      agencyLabel: r.agency?.name ?? null,
      threadId: r.threadId,
      threadTitle: titleById.get(r.threadId) ?? null,
      promptTokens: r.promptTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      thoughtsTokens: r.thoughtsTokens ?? 0,
      totalTokens: r.totalTokens ?? 0,
      cachedTokens: r.cachedTokens ?? 0,
      costUsd: Number(r.costUsd ?? 0),
      costComplete: r.costComplete,
      modelNames,
      unpricedModelNames,
      callCount: calls.length
    };
  });
}

export const usageRepository = {
  /** Metered runs (completed or failed) created in [from, to). With options: filtered, newest first, limited. */
  async listRunUsage(
    { from, to }: { from: Date; to: Date },
    options: { filter?: UsageRunFilter; take?: number } = {}
  ): Promise<UsageRunRow[]> {
    const { filter = {}, take } = options;
    const runs = await prisma.agentRun.findMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        createdAt: { gte: from, lt: to },
        totalTokens: { not: null },
        ...(filter.userId ? { usageUserId: filter.userId } : {}),
        ...(filter.agencyId ? { agencyId: filter.agencyId } : {}),
        ...(filter.threadId ? { threadId: filter.threadId } : {})
      },
      select: runSelect,
      ...(take ? { orderBy: { createdAt: "desc" as const }, take } : {})
    });
    return hydrate(runs as RunRecord[]);
  },

  async findRunUsage(runId: string): Promise<{ row: UsageRunRow; calls: UsageCall[] } | null> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: runSelect });
    if (!run || run.totalTokens === null) return null;
    const [row] = await hydrate([run as RunRecord]);
    const calls = detailEntries(run.usageDetail).map((c, index) => ({
      callIndex: typeof c.callIndex === "number" ? c.callIndex : index,
      phase: typeof c.phase === "string" ? c.phase : "loop",
      modelName: typeof c.modelName === "string" ? c.modelName : "unknown",
      promptTokens: num(c.promptTokens),
      cachedTokens: num(c.cachedTokens),
      outputTokens: num(c.outputTokens),
      thoughtsTokens: num(c.thoughtsTokens),
      totalTokens: num(c.totalTokens),
      costUsd: c.costUsd === null ? null : num(c.costUsd)
    }));
    return { row: row!, calls };
  },

  /** When usage metering started (the oldest run with token counts). */
  async firstMeteredAt(): Promise<Date | null> {
    const first = await prisma.agentRun.findFirst({
      where: { totalTokens: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    });
    return first?.createdAt ?? null;
  }
};

export type UsageRepository = typeof usageRepository;
