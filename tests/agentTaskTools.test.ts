import { describe, expect, it } from "vitest";
import { createMemoryRepository } from "./agentService.test";
import type { AgentToolService } from "../src/modules/agent/agentTools";
import {
  createAddAgentTaskTool,
  createUpdateAgentTaskTool,
  createListAgentTasksTool,
  createRecordAgentTaskTool
} from "../src/modules/agent/tools/taskTools";
import { createAgentService } from "../src/modules/agent/agentService";

describe("agent task tools", () => {
  function createContext(run: { id: string; threadId: string }) {
    return {
      runId: run.id,
      threadId: run.threadId,
      userId: "user-1",
      agencyId: "agency-1"
    };
  }

  describe("add_agent_task", () => {
    it("returns { id, label, status, sortOrder } with valid input", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      const tool = createAddAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {
        label: "Research hotels",
        status: "RUNNING"
      });

      expect(result).toMatchObject({
        id: expect.any(String),
        label: "Research hotels",
        status: "RUNNING",
        sortOrder: expect.any(Number)
      });

      // Verify id is a UUID-like format (from memory repo, it's "task-1", etc.)
      expect(result.id).toBeTruthy();
    });

    it("normalizes legacy shorthand task input with task key", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      const tool = createAddAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {
        task: "Book transfers"
      });

      expect(result).toMatchObject({
        id: expect.any(String),
        label: "Book transfers",
        status: "PENDING", // default status
        sortOrder: expect.any(Number)
      });
    });
  });

  describe("update_agent_task", () => {
    it("updates task with valid UUID and COMPLETED, emits event payload with id", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      // Create a task first
      const created = await service.recordTask(run, {
        label: "Research hotels",
        status: "RUNNING"
      });

      const tool = createUpdateAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {
        id: created.id,
        status: "COMPLETED"
      });

      expect(result).toMatchObject({
        id: created.id,
        label: "Research hotels",
        status: "COMPLETED",
        sortOrder: expect.any(Number)
      });

      // Verify event payload contains id
      const events = repository.events.filter(e => e.type === "task.updated");
      const lastEvent = events[events.length - 1];
      expect(lastEvent).toBeTruthy();
      expect(lastEvent?.payload).toHaveProperty("id");
    });

    it("throws when updating unknown UUID", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      const tool = createUpdateAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);

      await expect(
        tool.execute(context, {
          id: "00000000-0000-0000-0000-000000000000",
          status: "COMPLETED"
        })
      ).rejects.toThrow();
    });
  });

  describe("list_agent_tasks", () => {
    it("returns empty array when no open tasks", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");

      const tool = createListAgentTasksTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {});

      expect(result).toEqual({ tasks: [] });
    });

    it("returns one PENDING task", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      await service.recordTask(run, {
        label: "Research attractions",
        status: "PENDING"
      });

      const tool = createListAgentTasksTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {});

      expect(result).toMatchObject({
        tasks: [
          {
            id: expect.any(String),
            label: "Research attractions",
            status: "PENDING",
            sortOrder: expect.any(Number)
          }
        ]
      });
    });

    it("returns empty when task is COMPLETED (openOnly filter)", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      const created = await service.recordTask(run, {
        label: "Research attractions",
        status: "RUNNING"
      });

      // Complete the task
      await service.updateTask(run, {
        id: created.id,
        status: "COMPLETED"
      });

      const tool = createListAgentTasksTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);
      const result = await tool.execute(context, {});

      // Completed tasks should be filtered out (openOnly = true)
      expect(result).toEqual({ tasks: [] });
    });
  });

  describe("record_agent_task alias", () => {
    it("has identical behavior to add_agent_task", async () => {
      const repository = createMemoryRepository();
      const service = createAgentService({ repository });
      const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
      const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
      await service.startRun(run.id);

      const aliasTool = createRecordAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const addTool = createAddAgentTaskTool({ agentService: service as unknown as AgentToolService });
      const context = createContext(run);

      const input = {
        label: "Plan itinerary",
        status: "RUNNING"
      };

      // Call both tools with identical input
      const aliasResult = await aliasTool.execute(context, input);
      const addResult = await addTool.execute(context, input);

      // Both should have the same structure
      expect(aliasResult).toMatchObject({
        id: expect.any(String),
        label: "Plan itinerary",
        status: "RUNNING",
        sortOrder: expect.any(Number)
      });
      expect(addResult).toMatchObject({
        id: expect.any(String),
        label: "Plan itinerary",
        status: "RUNNING",
        sortOrder: expect.any(Number)
      });

      // Both should produce separate tasks (different ids)
      expect(aliasResult.id).not.toBe(addResult.id);
      expect(aliasResult.sortOrder).toBe(1);
      expect(addResult.sortOrder).toBe(2);
    });
  });
});
