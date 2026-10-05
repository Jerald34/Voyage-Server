import { describe, expect, it } from "vitest";
import {
  ITINERARY_LOCKED_MESSAGE,
  assertItineraryEditable,
  isItineraryEditable
} from "../src/modules/itineraries/itineraryLock";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("itinerary lock rule", () => {
  it("allows drafts and itineraries in review", () => {
    expect(isItineraryEditable("DRAFT")).toBe(true);
    expect(isItineraryEditable("NEEDS_REVIEW")).toBe(true);
  });

  it("locks approved itineraries and anything it doesn't recognise", () => {
    expect(isItineraryEditable("APPROVED_INTERNAL")).toBe(false);
    expect(isItineraryEditable(undefined)).toBe(false);
  });

  it("throws 409 ITINERARY_LOCKED for a locked itinerary", () => {
    expect(thrownBy(() => assertItineraryEditable("APPROVED_INTERNAL"))).toMatchObject({
      statusCode: 409,
      code: "ITINERARY_LOCKED",
      message: ITINERARY_LOCKED_MESSAGE
    });
    expect(thrownBy(() => assertItineraryEditable("NEEDS_REVIEW"))).toBeUndefined();
  });
});
