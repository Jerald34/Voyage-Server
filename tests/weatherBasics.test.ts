import { describe, expect, it } from "vitest";
import { conditionFromWmoCode, isWetCondition } from "../src/services/weather/weatherCodes";
import { addDays, daysBetween, isIsoDate, shiftYears, toIsoDate } from "../src/services/weather/dates";

describe("conditionFromWmoCode", () => {
  it.each([
    [0, "CLEAR"],
    [1, "PARTLY_CLOUDY"],
    [2, "PARTLY_CLOUDY"],
    [3, "CLOUDY"],
    [45, "FOG"],
    [48, "FOG"],
    [51, "DRIZZLE"],
    [57, "DRIZZLE"],
    [61, "RAIN"],
    [63, "RAIN"],
    [66, "RAIN"],
    [80, "RAIN"],
    [81, "RAIN"],
    [65, "HEAVY_RAIN"],
    [67, "HEAVY_RAIN"],
    [82, "HEAVY_RAIN"],
    [71, "SNOW"],
    [86, "SNOW"],
    [95, "THUNDERSTORM"],
    [99, "THUNDERSTORM"],
    [4, "UNKNOWN"],
    [null, "UNKNOWN"]
  ])("maps %s to %s", (code, expected) => {
    expect(conditionFromWmoCode(code)).toBe(expected);
  });

  it("treats drizzle, rain and storms as wet and nothing else", () => {
    expect(isWetCondition("DRIZZLE")).toBe(true);
    expect(isWetCondition("RAIN")).toBe(true);
    expect(isWetCondition("HEAVY_RAIN")).toBe(true);
    expect(isWetCondition("THUNDERSTORM")).toBe(true);
    expect(isWetCondition("CLOUDY")).toBe(false);
    expect(isWetCondition("SNOW")).toBe(false);
  });
});

describe("date helpers", () => {
  it("accepts only real calendar dates in YYYY-MM-DD form", () => {
    expect(isIsoDate("2026-10-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isIsoDate("2026-10-01T00:00:00Z")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("shifts years and clamps Feb 29 to Feb 28", () => {
    expect(shiftYears("2028-02-29", -1)).toBe("2027-02-28");
    expect(shiftYears("2026-10-10", -3)).toBe("2023-10-10");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-10-17")).toBe(16);
    expect(daysBetween("2026-10-01", "2026-09-30")).toBe(-1);
  });

  it("formats the UTC calendar date of an instant", () => {
    expect(toIsoDate(new Date("2026-10-01T23:30:00.000Z"))).toBe("2026-10-01");
  });
});
