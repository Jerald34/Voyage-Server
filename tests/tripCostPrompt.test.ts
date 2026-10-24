import { describe, expect, it } from "vitest";
import { buildVoyageSynthesisPrompt, buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

describe("system prompt: trip cost estimates", () => {
  const prompt = buildVoyageSystemPrompt("plan_itinerary, add_itinerary_item, web_search");

  it("lets the agent give a rough estimate instead of refusing", () => {
    expect(prompt).toContain("give a rough estimate from your general knowledge in plain text");
    expect(prompt).toContain("Rough cost estimates clearly labelled as estimates are allowed");
  });

  it("asks for per-person ranges in local currency with day and trip totals", () => {
    expect(prompt).toContain("Use the destination's local currency, such as PHP (₱) for the Philippines.");
    expect(prompt).toContain("with a subtotal per day and a trip total");
  });

  it("requires a label and a verify line on every estimate", () => {
    expect(prompt).toContain("label the figures as rough estimates from general knowledge, not live prices");
    expect(prompt).toContain("verify current rates before quoting them to a client");
  });

  it("uses web_search only for current prices and never invents uncertain ones", () => {
    expect(prompt).toContain("If the user asks for current or verified prices, call web_search first");
    expect(prompt).toContain("'price varies - check locally'");
  });
});

describe("synthesis prompt: trip cost estimates", () => {
  it("allows labelled estimates in the final reply", () => {
    expect(buildVoyageSynthesisPrompt()).toContain("If the user asked for a trip cost estimate");
  });
});
