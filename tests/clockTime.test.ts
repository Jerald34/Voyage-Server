import { describe, expect, it } from "vitest";
import { normalizeClockTime, parseClockTimeToMinutes } from "../src/utils/clockTime";

describe("normalizeClockTime", () => {
  it("adds missing minutes and upper-cases the meridiem", () => {
    expect(normalizeClockTime("9")).toBe("9:00");
    expect(normalizeClockTime(" 9:30 pm ")).toBe("9:30 PM");
  });

  it("returns anything else trimmed and unchanged", () => {
    expect(normalizeClockTime(" lunch ")).toBe("lunch");
  });
});

describe("parseClockTimeToMinutes", () => {
  it("reads 24-hour and 12-hour clock times", () => {
    expect(parseClockTimeToMinutes("09:30")).toBe(570);
    expect(parseClockTimeToMinutes("14")).toBe(840);
    expect(parseClockTimeToMinutes("9:30 PM")).toBe(1290);
    expect(parseClockTimeToMinutes("12:00 AM")).toBe(0);
    expect(parseClockTimeToMinutes("12:15 PM")).toBe(735);
  });

  it("returns null for text that is not a clock time", () => {
    expect(parseClockTimeToMinutes("noon")).toBeNull();
  });
});
