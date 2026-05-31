import { describe, expect, it } from "vitest";
import {
  deriveTitleFromMessage,
  deriveTitleFromItineraryPayload
} from "../src/modules/agent/agentThreadTitler";

describe("deriveTitleFromMessage", () => {
  it("returns null for empty / whitespace", () => {
    expect(deriveTitleFromMessage("")).toBeNull();
    expect(deriveTitleFromMessage("   \n  ")).toBeNull();
  });

  it("returns first 6 words capped at 48 chars", () => {
    expect(deriveTitleFromMessage("Plan a five day trip to Tokyo next month"))
      .toBe("Plan a five day trip to");
  });

  it("strips trailing punctuation", () => {
    expect(deriveTitleFromMessage("Help me!! Plan: Tokyo, please?"))
      .toBe("Help me Plan Tokyo please");
  });

  it("hard-caps at 48 chars on a single long word", () => {
    const long = "Supercalifragilisticexpialidociousandthensome";
    expect(deriveTitleFromMessage(long)?.length).toBeLessThanOrEqual(48);
  });
});

describe("deriveTitleFromItineraryPayload", () => {
  it("prefers destination", () => {
    expect(deriveTitleFromItineraryPayload({
      itineraryId: "i1",
      destination: "Kyoto, Japan",
      title: "5-day plan"
    })).toBe("Kyoto, Japan");
  });

  it("falls back to title", () => {
    expect(deriveTitleFromItineraryPayload({
      itineraryId: "i1",
      title: "Coastal Portugal"
    })).toBe("Coastal Portugal");
  });

  it("returns null when neither is present", () => {
    expect(deriveTitleFromItineraryPayload({ itineraryId: "i1" })).toBeNull();
    expect(deriveTitleFromItineraryPayload(null)).toBeNull();
    expect(deriveTitleFromItineraryPayload("not an object")).toBeNull();
  });
});
