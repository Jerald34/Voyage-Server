import { describe, expect, it } from "vitest";
import { buildVoyageSynthesisPrompt, buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

describe("system prompt: scope", () => {
  const prompt = buildVoyageSystemPrompt("ask_user, plan_itinerary, web_search");

  it("limits the agent to agency travel work and lists what is out of scope", () => {
    expect(prompt).toContain("You only help with agency travel work.");
    expect(prompt).toContain("writing or fixing code, math or homework, essays");
  });

  it("does not let a travel word smuggle in an unrelated task", () => {
    expect(prompt).toContain("A travel word does not make a task travel work.");
  });

  it("declines without answering or calling a tool", () => {
    expect(prompt).toContain("do not answer it, not even partly");
    expect(prompt).toContain("do not call any tool for it, including web_search");
    expect(prompt).toContain("Out of scope: decline as described in Scope, with no tool call.");
  });

  it("only does the travel part of a mixed request", () => {
    expect(prompt).toContain("do only the travel part");
  });

  it("no longer invites general-knowledge answers", () => {
    expect(prompt).not.toContain("simple general knowledge");
    expect(prompt).toContain("simple travel or geography knowledge");
  });

  it("puts the scope rules before the operating instructions", () => {
    expect(prompt.indexOf("Scope")).toBeLessThan(prompt.indexOf("Core Operating Principle"));
  });
});

describe("synthesis prompt: scope", () => {
  it("skips unrelated parts of the request in the final reply", () => {
    expect(buildVoyageSynthesisPrompt()).toContain("Only cover agency travel work.");
  });
});
