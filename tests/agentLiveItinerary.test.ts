import { describe, expect, it } from "vitest";
import { ITINERARY_LOCKED_NOTICE, withLiveItinerary } from "../src/modules/agent/agentContextBuilder";

const snapshot = {
  prompt: "Active itinerary draft context",
  itinerary: { id: "itin-1", days: [{ id: "day-1", items: [{ id: "s1", title: "Old title" }] }] }
};

describe("withLiveItinerary", () => {
  it("leaves a run with no active itinerary alone", () => {
    expect(withLiveItinerary(null, { id: "itin-1", days: [] })).toBeNull();
  });

  it("keeps the thread's snapshot when the live itinerary can't be read", () => {
    expect(withLiveItinerary(snapshot, null)).toBe(snapshot);
  });

  it("swaps in the live itinerary for one in review", () => {
    const live = { id: "itin-1", status: "NEEDS_REVIEW", days: [{ id: "day-1", items: [{ id: "s1", title: "Edited by hand" }] }] };

    expect(withLiveItinerary(snapshot, live)).toEqual({ prompt: snapshot.prompt, itinerary: live });
  });

  it("tells the agent an approved itinerary is locked", () => {
    const live = { id: "itin-1", status: "APPROVED_INTERNAL", days: [] };

    const result = withLiveItinerary(snapshot, live);

    expect(result?.itinerary).toBe(live);
    expect(result?.prompt).toContain(ITINERARY_LOCKED_NOTICE);
    expect(ITINERARY_LOCKED_NOTICE).toContain("Reopen for edits");
  });
});
