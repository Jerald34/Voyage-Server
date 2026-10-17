import { describe, expect, it } from "vitest";
import { ITINERARY_LOCKED_NOTICE, buildTripItineraryContext } from "../src/modules/agent/agentContextBuilder";

describe("buildTripItineraryContext", () => {
  it("makes the trip's live itinerary the one the agent edits", () => {
    const live = { id: "itin-2", status: "NEEDS_REVIEW", days: [{ id: "d1", items: [] }] };
    const context = buildTripItineraryContext(live);

    expect(context?.itinerary).toBe(live);
    expect(context?.prompt).toContain("Active itinerary draft context");
    expect(context?.prompt).not.toContain(ITINERARY_LOCKED_NOTICE);
  });

  it("tells the agent an approved itinerary is locked", () => {
    const context = buildTripItineraryContext({ id: "itin-2", status: "APPROVED_INTERNAL", days: [] });
    expect(context?.prompt).toContain(ITINERARY_LOCKED_NOTICE);
  });

  it("returns nothing when there is no readable itinerary", () => {
    expect(buildTripItineraryContext(null)).toBeNull();
    expect(buildTripItineraryContext({ id: "itin-2" })).toBeNull();
  });
});
