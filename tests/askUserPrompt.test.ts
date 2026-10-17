import { describe, expect, it } from "vitest";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

describe("system prompt: asking the user", () => {
  const prompt = buildVoyageSystemPrompt("ask_user, plan_itinerary");

  it("describes ask_user and shows the call format", () => {
    expect(prompt).toContain("ask_user: ask the user 1-4 multiple-choice questions");
    expect(prompt).toContain('{"tool": "ask_user", "questions": [{"header": "Transport"');
    expect(prompt).toContain("Never write questions or option lists as markdown text");
  });

  it("no longer tells the agent to format questions as markdown bullets", () => {
    expect(prompt).not.toContain("Question Formatting (MARKDOWN REQUIRED)");
    expect(prompt).not.toContain("Ask only one clarifying question at a time.");
  });

  it("asks for transport mode through ask_user before planning", () => {
    expect(prompt).toContain("If the user has not stated transport mode, call ask_user");
  });

  it("stays identical across calls so the system prompt can be cached", () => {
    expect(buildVoyageSystemPrompt("ask_user, plan_itinerary")).toBe(prompt);
  });
});
