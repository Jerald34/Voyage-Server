import { describe, expect, it } from "vitest";
import { createMemoryRepository } from "./agentService.test";
import { createAgentService } from "../src/modules/agent/agentService";

describe("agent task repository", () => {
  it("allocates sortOrder per threadId across different runs", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });

    // Create a thread
    const thread = await service.createThread("agency-1", "user-1", { title: "Test" });

    // Create two separate runs in the same thread
    const { run: run1 } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "First");
    const { run: run2 } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Second");

    await service.startRun(run1.id);
    await service.startRun(run2.id);

    // Create a task in run1
    const task1 = await service.recordTask(run1, {
      label: "Research hotels",
      status: "RUNNING"
    });

    // Create a task in run2
    const task2 = await service.recordTask(run2, {
      label: "Book transfers",
      status: "PENDING"
    });

    // Both tasks should have sortOrders 1 and 2 (thread-scoped, not run-scoped)
    expect(task1.sortOrder).toBe(1);
    expect(task2.sortOrder).toBe(2);
  });

  it("emits task.updated event payload containing id", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    await service.startRun(run.id);

    const created = await service.recordTask(run, {
      label: "Plan itinerary",
      status: "RUNNING"
    });

    // Find the task.updated event
    const event = repository.events.find(e => e.type === "task.updated");
    expect(event).toBeTruthy();
    expect(event?.payload).toHaveProperty("id", created.id);
    expect(event?.payload).toHaveProperty("label");
    expect(event?.payload).toHaveProperty("status");
    expect(event?.payload).toHaveProperty("sortOrder");
  });

  it("listForThread with openOnly=true returns only PENDING and RUNNING", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    await service.startRun(run.id);

    // Create tasks with different statuses
    const pending = await service.recordTask(run, {
      label: "Task 1",
      status: "PENDING"
    });

    const running = await service.recordTask(run, {
      label: "Task 2",
      status: "RUNNING"
    });

    const completed = await service.recordTask(run, {
      label: "Task 3",
      status: "COMPLETED"
    });

    const failed = await service.recordTask(run, {
      label: "Task 4",
      status: "FAILED"
    });

    const open = await service.listOpenTasksForThread(thread.id);

    expect(open).toHaveLength(2);
    expect(open.map(t => t.id)).toEqual([pending.id, running.id]);
  });

  it("listForThread with openOnly=false returns all tasks", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    await service.startRun(run.id);

    // Create tasks with different statuses
    const pending = await service.recordTask(run, {
      label: "Task 1",
      status: "PENDING"
    });

    const running = await service.recordTask(run, {
      label: "Task 2",
      status: "RUNNING"
    });

    const completed = await service.recordTask(run, {
      label: "Task 3",
      status: "COMPLETED"
    });

    const failed = await service.recordTask(run, {
      label: "Task 4",
      status: "FAILED"
    });

    const all = await repository.listForThread(thread.id, { openOnly: false });

    expect(all).toHaveLength(4);
    expect(all.map(t => t.id)).toEqual([pending.id, running.id, completed.id, failed.id]);
  });

  it("updateTaskAndEvent updates fields and emits event with id", async () => {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Test" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Start");
    await service.startRun(run.id);

    // Create a task
    const created = await service.recordTask(run, {
      label: "Research",
      status: "PENDING"
    });

    // Update it
    const updated = await service.updateTask(run, {
      id: created.id,
      label: "Research attractions",
      status: "COMPLETED"
    });

    expect(updated).toMatchObject({
      id: created.id,
      label: "Research attractions",
      status: "COMPLETED"
    });

    // Verify event was emitted with id
    const events = repository.events.filter(e => e.type === "task.updated");
    const lastEvent = events[events.length - 1];
    expect(lastEvent?.payload).toHaveProperty("id", created.id);
    expect(lastEvent?.payload).toHaveProperty("label", "Research attractions");
    expect(lastEvent?.payload).toHaveProperty("status", "COMPLETED");
  });
});
