import { describe, expect, it } from "vitest";
import {
  describeHourlyForAgent,
  groupHoursByDate,
  summarizeHourlyDay
} from "../src/services/weather/hourlyWeather";
import type { RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";

const hoursWith = (codes: Record<number, number>, chance = 10): RawHourlyWeather[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    date: "2026-10-08",
    hour,
    weatherCode: codes[hour] ?? 1,
    precipitationProbabilityPct: chance
  }));

describe("summarizeHourlyDay", () => {
  it("finds the first wet daytime hour and the worst wet window", () => {
    const outlook = summarizeHourlyDay(baguioHours(), []);

    expect(outlook).toEqual({
      firstWetHour: 11,
      // Storm rows 14-17 and 19 (18 is plain rain): the window ends after the 19:00 row.
      wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
      stops: []
    });
  });

  it("gives each timed stop the worst weather in the hours it overlaps", () => {
    const outlook = summarizeHourlyDay(baguioHours(), [
      { id: "s1", startTime: "09:00", endTime: "11:00" },
      { id: "s2", startTime: "11:30", endTime: "13:00" },
      { id: "s3", startTime: "14:00", endTime: "16:30" },
      { id: "s4", startTime: "6:00 PM", endTime: "7:30 PM" },
      { id: "s5", startTime: null, endTime: null },
      { id: "s6", startTime: "10:00" },
      { id: "s7", startTime: "08:00", endTime: "07:00" },
      { id: "s8", startTime: "12:00", endTime: "12:45" },
      { id: null, startTime: "09:00" },
      { id: "s9", startTime: "lunch" }
    ]);

    expect(outlook?.stops).toEqual([
      { itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
      { itemId: "s2", outlook: "SHOWERS", maxPrecipitationProbabilityPct: 79 },
      { itemId: "s3", outlook: "STORM", maxPrecipitationProbabilityPct: 99 },
      // 18:00 rain + 19:00 storm: the storm wins.
      { itemId: "s4", outlook: "STORM", maxPrecipitationProbabilityPct: 91 },
      // No end time: one hour.
      { itemId: "s6", outlook: "DRY", maxPrecipitationProbabilityPct: 45 },
      // End before start: one hour.
      { itemId: "s7", outlook: "DRY", maxPrecipitationProbabilityPct: 4 },
      // Overcast (code 3) but a 79% chance: light rain possible.
      { itemId: "s8", outlook: "SHOWERS", maxPrecipitationProbabilityPct: 79 }
    ]);
  });

  it("ignores rain at night", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 0: 95, 1: 95, 2: 63, 23: 61 }), []);

    expect(outlook).toEqual({ firstWetHour: null, wetWindow: null, stops: [] });
  });

  it("names the heaviest condition within the worst band", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 9: 61, 10: 65, 13: 51 }), []);

    expect(outlook?.wetWindow).toEqual({ condition: "HEAVY_RAIN", fromHour: 9, toHour: 11 });
    expect(outlook?.firstWetHour).toBe(9);
  });

  it("returns null when the date has no hours", () => {
    expect(summarizeHourlyDay([], [{ id: "s1", startTime: "09:00" }])).toBeNull();
  });
});

describe("groupHoursByDate", () => {
  it("groups rows by local date in hour order", () => {
    const grouped = groupHoursByDate([
      { date: "2026-10-09", hour: 1, weatherCode: 1, precipitationProbabilityPct: 0 },
      { date: "2026-10-08", hour: 5, weatherCode: 1, precipitationProbabilityPct: 0 },
      { date: "2026-10-09", hour: 0, weatherCode: 1, precipitationProbabilityPct: 0 }
    ]);

    expect([...grouped.keys()]).toEqual(["2026-10-09", "2026-10-08"]);
    expect(grouped.get("2026-10-09")?.map((row) => row.hour)).toEqual([0, 1]);
  });
});

describe("describeHourlyForAgent", () => {
  it("says when the day is dry and when the worst weather comes", () => {
    expect(describeHourlyForAgent(summarizeHourlyDay(baguioHours(), [])!)).toBe(
      "dry until 11 AM; thunderstorms 2 PM-8 PM"
    );
    expect(describeHourlyForAgent({ firstWetHour: null, wetWindow: null, stops: [] })).toBe("dry from 6 AM to 10 PM");
    expect(
      describeHourlyForAgent({ firstWetHour: 6, wetWindow: { condition: "RAIN", fromHour: 6, toHour: 9 }, stops: [] })
    ).toBe("rain 6 AM-9 AM");
  });
});
