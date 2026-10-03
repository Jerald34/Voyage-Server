import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { CALENDAR_MAX_DAYS, calendarWindow } from "../src/modules/dashboard/calendar";

describe("calendarWindow", () => {
  it("pads the requested local dates to cover every timezone", () => {
    const window = calendarWindow("2026-09-27", "2026-11-07");
    expect(window.from).toBe("2026-09-27");
    expect(window.to).toBe("2026-11-07");
    expect(window.fromDayStart.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(window.toDayStart.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.fromInstant.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(window.toInstant.toISOString()).toBe("2026-11-08T13:59:59.999Z");
  });

  it("allows a single day", () => {
    expect(() => calendarWindow("2026-10-03", "2026-10-03")).not.toThrow();
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => calendarWindow("2026-10-08", "2026-10-01")).toThrow(ApiError);
  });

  it(`allows ${CALENDAR_MAX_DAYS} days and rejects more`, () => {
    expect(() => calendarWindow("2026-09-27", "2026-11-07")).not.toThrow();
    try {
      calendarWindow("2026-09-27", "2026-11-08");
      expect.unreachable("a 43-day range should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(400);
      expect((error as ApiError).code).toBe("CALENDAR_RANGE_INVALID");
    }
  });
});
