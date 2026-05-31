import { describe, expect, it } from "vitest";
import { startDateToSeason } from "../src/modules/ratedHistory/seasonHelper";

describe("startDateToSeason", () => {
  it("returns null when input is null", () => {
    expect(startDateToSeason(null)).toBeNull();
  });

  it("returns 'spring' for March 15", () => {
    const date = new Date(Date.UTC(2025, 2, 15)); // March
    expect(startDateToSeason(date)).toBe("spring");
  });

  it("returns 'spring' for May 31", () => {
    const date = new Date(Date.UTC(2025, 4, 31)); // May
    expect(startDateToSeason(date)).toBe("spring");
  });

  it("returns 'summer' for June 1", () => {
    const date = new Date(Date.UTC(2025, 5, 1)); // June
    expect(startDateToSeason(date)).toBe("summer");
  });

  it("returns 'summer' for August 31", () => {
    const date = new Date(Date.UTC(2025, 7, 31)); // August
    expect(startDateToSeason(date)).toBe("summer");
  });

  it("returns 'fall' for September 1", () => {
    const date = new Date(Date.UTC(2025, 8, 1)); // September
    expect(startDateToSeason(date)).toBe("fall");
  });

  it("returns 'fall' for November 30", () => {
    const date = new Date(Date.UTC(2025, 10, 30)); // November
    expect(startDateToSeason(date)).toBe("fall");
  });

  it("returns 'winter' for December 1", () => {
    const date = new Date(Date.UTC(2025, 11, 1)); // December
    expect(startDateToSeason(date)).toBe("winter");
  });

  it("returns 'winter' for January 15", () => {
    const date = new Date(Date.UTC(2025, 0, 15)); // January
    expect(startDateToSeason(date)).toBe("winter");
  });

  it("returns 'winter' for February 29 (leap day)", () => {
    const date = new Date(Date.UTC(2024, 1, 29)); // February 29, 2024
    expect(startDateToSeason(date)).toBe("winter");
  });
});
