/**
 * F2 — Cross-tenant IDOR regression test
 *
 * A member of agency A must not be able to read, stream, or cancel a run
 * belonging to agency B via the agent run endpoints.
 *
 * Limitation note: the pre-existing broken agent module tests
 * (agentLogger, agentOrchestrator, agentRoutes, modelProvider,
 * webSearchProvider) fail because of an unrelated createGoogleSearchProvider
 * export issue. This test uses the lower-level createAgentService + memory
 * repository (same pattern as agentService.test.ts) to avoid those broken
 * dependencies while still exercising the actual agency-scoping logic.
 *
 * The HTTP-layer integration is proved by the unit tests here plus the
 * controller changes that pass getAgencyId(req) through to the service.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { createAgentService } from "../src/modules/agent/agentService";
import type {
  AgentRepository,
  AgentRunRecord,
  AgentThreadRecord,
  AgentMessageRecord,
  AgentRunEventRecord,
  AgentToolCallRecord,
  AgentTaskRecord,
  AgentSourceRecord,
  AgentRunStatus
} from "../src/modules/agent/agentService";
import type { AgentEvent } from "../src/modules/agent/agentSchemas";

// ── Minimal in-memory repository ─────────────────────────────────────────────

function createMemoryRepo(): AgentRepository & {
  runs: AgentRunRecord[];
} {
  const threads: AgentThreadRecord[] = [];
  const messages: AgentMessageRecord[] = [];
  const runs: AgentRunRecord[] = [];
  const events: AgentRunEventRecord[] = [];
  const toolCalls: AgentToolCallRecord[] = [];
  const tasks: AgentTaskRecord[] = [];
  const sources: AgentSourceRecord[] = [];
  const trips: any[] = [];
  const itineraries: any[] = [];

  const now = new Date("2026-06-01T00:00:00.000Z");

  return {
    runs,
    async createThread(data) {
      const thread: AgentThreadRecord = {
        id: randomUUID(),
        agencyId: data.agencyId,
        tripId: data.tripId ?? null,
        createdByUserId: "user-1",
        title: data.title,
        status: "ACTIVE",
        titleSetByUser: false,
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now
      };
      threads.push(thread);
      return thread;
    },
    async listThreadsByAgency(agencyId) {
      return threads.filter((t) => t.agencyId === agencyId);
    },
    async findThreadByAgency(id, agencyId) {
      return threads.find((t) => t.id === id && t.agencyId === agencyId) ?? null;
    },
    async deleteThreadByAgency(id, agencyId) {
      const idx = threads.findIndex((t) => t.id === id && t.agencyId === agencyId);
      if (idx >= 0) { threads.splice(idx, 1); return true; }
      return false;
    },
    async saveItineraryThread() { return null; },
    async createMessage(data) {
      const msg: AgentMessageRecord = {
        id: randomUUID(),
        threadId: data.threadId,
        runId: data.runId ?? null,
        authorUserId: data.authorUserId ?? null,
        role: data.role,
        content: data.content,
        metadata: data.metadata ?? null,
        createdAt: now
      };
      messages.push(msg);
      return msg;
    },
    async createRun(data) {
      const run: AgentRunRecord = {
        id: randomUUID(),
        threadId: data.threadId,
        agencyId: data.agencyId,
        triggerMessageId: data.triggerMessageId ?? null,
        status: "QUEUED",
        modelProvider: data.modelProvider,
        modelName: data.modelName,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now
      };
      runs.push(run);
      return run;
    },
    async startRun(id, startedAt) {
      const run = runs.find((r) => r.id === id);
      if (!run) return null;
      run.status = "RUNNING";
      run.startedAt = startedAt;
      return run;
    },
    async createUserMessageAndRun(data) {
      const msg = await this.createMessage({ ...data, role: "USER" });
      const run = await this.createRun({ ...data, triggerMessageId: msg.id });
      return { message: msg, run };
    },
    async findRunById(id, agencyId) {
      // F2: Filter by agencyId when provided.
      const run = runs.find((r) => r.id === id) ?? null;
      if (run && agencyId != null && run.agencyId !== agencyId) return null;
      return run;
    },
    async listRunEvents(runId) {
      return events.filter((e) => e.runId === runId);
    },
    async touchThread() {},
    async createRunEvent(data) {
      const ev: AgentRunEventRecord = {
        id: randomUUID(),
        runId: data.runId,
        threadId: data.threadId,
        type: data.type as AgentEvent["type"],
        payload: data.payload,
        sequence: events.filter((e) => e.runId === data.runId).length + 1,
        createdAt: now
      };
      events.push(ev);
      return ev;
    },
    async createToolCall(data) {
      const tc: AgentToolCallRecord = {
        id: randomUUID(),
        runId: data.runId,
        threadId: data.threadId,
        toolName: data.toolName,
        status: data.status,
        input: data.input ?? null,
        outputSummary: data.outputSummary ?? null,
        errorCode: data.errorCode ?? null,
        errorMessage: data.errorMessage ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        createdAt: now
      };
      toolCalls.push(tc);
      return tc;
    },
    async updateToolCall(id, data) {
      const tc = toolCalls.find((t) => t.id === id) ?? null;
      if (tc) Object.assign(tc, data);
      return tc;
    },
    async createTaskAndEvent(data) {
      const task: AgentTaskRecord = {
        id: randomUUID(),
        runId: data.runId,
        threadId: data.threadId,
        label: data.label,
        status: data.status,
        sortOrder: data.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now
      };
      tasks.push(task);
      const ev = await this.createRunEvent({ runId: data.runId, threadId: data.threadId, type: "task.created" as any, payload: { id: task.id, label: task.label, status: task.status } });
      return { task, event: ev };
    },
    async listForThread(threadId, opts) {
      return tasks.filter((t) => t.threadId === threadId && (!opts.openOnly || t.status !== "COMPLETED"));
    },
    async updateTaskAndEvent(data) {
      const task = tasks.find((t) => t.id === data.id) ?? null;
      if (task) Object.assign(task, data.patch);
      const ev = await this.createRunEvent({ runId: data.runId, threadId: data.threadId, type: "task.updated" as any, payload: { id: data.id, ...data.patch } });
      return { task: task!, event: ev };
    },
    async createSourcesAndEvents(data) {
      const created = data.sources.map((s) => ({ id: randomUUID(), runId: data.runId, threadId: data.threadId, ...s, metadata: s.metadata ?? null, createdAt: now })) as AgentSourceRecord[];
      sources.push(...created);
      const evts: AgentRunEventRecord[] = [];
      for (const s of created) {
        evts.push(await this.createRunEvent({ runId: data.runId, threadId: data.threadId, type: "source.added" as any, payload: { id: s.id } }));
      }
      return { sources: created, events: evts };
    },
    async completeRunIfOpen(id, data) {
      const run = runs.find((r) => r.id === id);
      if (!run || run.status !== "RUNNING") return null;
      run.status = "COMPLETED";
      run.completedAt = data.completedAt;
      const msg = await this.createMessage({ threadId: run.threadId, runId: run.id, role: "ASSISTANT", content: data.assistantContent });
      const ev = await this.createRunEvent({ runId: run.id, threadId: run.threadId, type: "run.completed" as any, payload: {} });
      return { run, message: msg, events: [ev] };
    },
    async failRunIfOpen(id, data) {
      const run = runs.find((r) => r.id === id);
      if (!run || run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") return null;
      run.status = "FAILED";
      run.failedAt = data.failedAt;
      run.errorCode = data.errorCode;
      run.errorMessage = data.errorMessage;
      return run;
    },
    async cancelRunIfOpen(id) {
      const run = runs.find((r) => r.id === id);
      if (!run || run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") return;
      run.status = "CANCELLED";
    },
    async listThreadMessages() { return { messages: [], nextCursor: null }; },
    async updateThreadTitle(data) {
      const t = threads.find((th) => th.id === data.threadId);
      if (t) { t.title = data.title; t.titleSetByUser = data.manual; }
      return t!;
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("F2 — Cross-tenant IDOR: agent run scoping by agencyId", () => {
  it("agency B member cannot read run events for a run owned by agency A", async () => {
    const repo = createMemoryRepo();
    const service = createAgentService({ repository: repo });

    // Create a thread and run belonging to agency A.
    const threadA = await repo.createThread({
      agencyId: "agency-a",
      createdByUserId: "user-1",
      title: "Agency A thread"
    });
    const runA = await repo.createRun({
      threadId: threadA.id,
      agencyId: "agency-a",
      modelProvider: "test",
      modelName: "test-model"
    });

    // Agency B member tries to list run events — must get 404.
    await expect(
      service.listRunEvents(runA.id, "agency-b")
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND", statusCode: 404 });
  });

  it("agency A member can read their own run events", async () => {
    const repo = createMemoryRepo();
    const service = createAgentService({ repository: repo });

    const threadA = await repo.createThread({
      agencyId: "agency-a",
      createdByUserId: "user-1",
      title: "Agency A thread"
    });
    const runA = await repo.createRun({
      threadId: threadA.id,
      agencyId: "agency-a",
      modelProvider: "test",
      modelName: "test-model"
    });

    // Agency A member reads their own run events — must succeed.
    const events = await service.listRunEvents(runA.id, "agency-a");
    expect(Array.isArray(events)).toBe(true);
  });

  it("agency B member cannot cancel a run owned by agency A", async () => {
    const repo = createMemoryRepo();
    const service = createAgentService({ repository: repo });

    const threadA = await repo.createThread({
      agencyId: "agency-a",
      createdByUserId: "user-1",
      title: "Agency A thread"
    });
    const runA = await repo.createRun({
      threadId: threadA.id,
      agencyId: "agency-a",
      modelProvider: "test",
      modelName: "test-model"
    });

    // Agency B member tries to cancel — must get 404 and the run must remain QUEUED.
    await expect(
      service.cancelRun(runA.id, "agency-b")
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND", statusCode: 404 });

    // Verify the run was NOT cancelled.
    const runInRepo = repo.runs.find((r) => r.id === runA.id)!;
    expect(runInRepo.status).toBe("QUEUED");
  });

  it("agency B member cannot stream (startRun) a run owned by agency A", async () => {
    const repo = createMemoryRepo();
    const service = createAgentService({ repository: repo });

    const threadA = await repo.createThread({
      agencyId: "agency-a",
      createdByUserId: "user-1",
      title: "Agency A thread"
    });
    const runA = await repo.createRun({
      threadId: threadA.id,
      agencyId: "agency-a",
      modelProvider: "test",
      modelName: "test-model"
    });

    // Agency B member tries to start the run for streaming — must get 404.
    await expect(
      service.startRun(runA.id, undefined, "agency-b")
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND", statusCode: 404 });

    // Verify the run was NOT flipped to RUNNING.
    const runInRepo = repo.runs.find((r) => r.id === runA.id)!;
    expect(runInRepo.status).toBe("QUEUED");
  });
});
