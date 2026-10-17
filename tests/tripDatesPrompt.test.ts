import { describe, expect, it } from "vitest";
import { buildVoyageSystemPrompt } from "../src/modules/agent/agentPrompts";

describe("system prompt: trip dates on drafts", () => {
  const prompt = buildVoyageSystemPrompt("plan_itinerary, update_itinerary_day, weather_forecast");

  it("tells the agent to store known travel dates on the new draft", () => {
    expect(prompt).toContain("set trip.startDate and trip.endDate, and give each day its date");
  });

  it("sets day dates with update_itinerary_day when they arrive after the draft exists", () => {
    expect(prompt).toContain("set each day's date with update_itinerary_day");
  });

  it("never lets the agent guess dates", () => {
    expect(prompt).toContain("Never guess dates: leave them out when the user has not given any.");
  });
});
