import { describe, expect, it } from "vitest";
import {
  DAYTIME_END_HOUR,
  DAYTIME_START_HOUR,
  describeHourlyForAgent,
  groupHoursByDate,
  summarizeHourlyDay
} from "../src/services/weather/hourlyWeather";
import type { RawHourlyWeather } from "../src/services/weather/types";
import { baguioHours } from "./baguioHourlyFixture";

/** A whole day of partly-cloudy hours, with the given hours' codes (null = the provider gave none) and chances overridden. */
const hoursWith = (
  codes: Record<number, number | null>,
  chance = 10,
  chances: Record<number, number> = {}
): RawHourlyWeather[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    date: "2026-10-08",
    hour,
    weatherCode: hour in codes ? codes[hour] : 1,
    precipitationProbabilityPct: chances[hour] ?? chance
  }));

describe("summarizeHourlyDay", () => {
  it("finds the first wet daytime hour and the worst wet window", () => {
    const outlook = summarizeHourlyDay(baguioHours(), []);

    expect(outlook).toEqual({
      firstWetHour: 11,
      // Storm rows 14-17 and 19 (18 is plain rain): the window ends after the 19:00 row.
      wetWindow: { condition: "THUNDERSTORM", fromHour: 14, toHour: 20 },
      // The 20:00 row is still drizzle: the wet spell outlasts the storms.
      lastWetHour: 20,
      // The 15:00 and 16:00 rows peak at 99%.
      maxDaytimePrecipitationProbabilityPct: 99,
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

    // The night's storms and chances do not count toward the daytime peak either.
    expect(outlook).toEqual({
      firstWetHour: null,
      wetWindow: null,
      lastWetHour: null,
      maxDaytimePrecipitationProbabilityPct: 10,
      stops: []
    });
  });

  it("has no wet hours at all on a dry day", () => {
    expect(summarizeHourlyDay(hoursWith({}), [])).toEqual({
      firstWetHour: null,
      wetWindow: null,
      lastWetHour: null,
      maxDaytimePrecipitationProbabilityPct: 10,
      stops: []
    });
  });

  it("names the heaviest condition within the worst band", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 9: 61, 10: 65, 13: 51 }), []);

    expect(outlook?.wetWindow).toEqual({ condition: "HEAVY_RAIN", fromHour: 9, toHour: 11 });
    expect(outlook?.firstWetHour).toBe(9);
    // The 13:00 drizzle is the last wet hour even though the rain band ended at 10.
    expect(outlook?.lastWetHour).toBe(13);
  });

  it("counts the 21:00 hour but not 22:00 as the last wet hour of the daytime", () => {
    expect(summarizeHourlyDay(hoursWith({ 21: 51, 22: 63 }), [])?.lastWetHour).toBe(21);
    expect(summarizeHourlyDay(hoursWith({ 22: 63 }), [])?.lastWetHour).toBeNull();
  });

  it("does not call snow dry: it is a wet window, worse than rain and milder than storms", () => {
    const snowy = summarizeHourlyDay(hoursWith({ 9: 61, 12: 71, 13: 73 }), [
      { id: "rain-stop", startTime: "09:00", endTime: "10:00" },
      { id: "snow-stop", startTime: "12:30", endTime: "13:30" },
      { id: "dry-stop", startTime: "15:00", endTime: "16:00" }
    ]);

    expect(snowy).toEqual({
      firstWetHour: 9,
      // Snow outranks the 9 AM rain.
      wetWindow: { condition: "SNOW", fromHour: 12, toHour: 14 },
      lastWetHour: 13,
      maxDaytimePrecipitationProbabilityPct: 10,
      stops: [
        { itemId: "rain-stop", outlook: "RAIN", maxPrecipitationProbabilityPct: 10 },
        { itemId: "snow-stop", outlook: "SNOW", maxPrecipitationProbabilityPct: 10 },
        { itemId: "dry-stop", outlook: "DRY", maxPrecipitationProbabilityPct: 10 }
      ]
    });
    expect(describeHourlyForAgent(snowy!)).toBe("dry until 9 AM; snow 12 PM-2 PM");

    const stormy = summarizeHourlyDay(hoursWith({ 12: 71, 13: 95 }), [{ id: "s", startTime: "12:00", endTime: "14:00" }]);
    expect(stormy?.wetWindow).toEqual({ condition: "THUNDERSTORM", fromHour: 13, toHour: 14 });
    expect(stormy?.stops[0].outlook).toBe("STORM");
  });

  it("treats a snow-only day as a snow window, not a dry day", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 6: 71, 7: 75 }), []);

    expect(outlook).toEqual({
      firstWetHour: 6,
      wetWindow: { condition: "SNOW", fromHour: 6, toHour: 8 },
      lastWetHour: 7,
      maxDaytimePrecipitationProbabilityPct: 10,
      stops: []
    });
    expect(describeHourlyForAgent(outlook!)).toBe("snow 6 AM-8 AM");
  });

  it("ignores hours with no weather code instead of reading them as dry", () => {
    // Every daytime hour is missing: the day has nothing to say, so it keeps its daily display.
    expect(summarizeHourlyDay(hoursWith(Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [hour, null]))), [])).toBeNull();
    // Only the night has codes (06:00-21:00 all missing): still nothing about the daytime.
    const nightOnly = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 6, null]));
    expect(summarizeHourlyDay(hoursWith({ ...nightOnly, 2: 95 }), [])).toBeNull();
    expect(summarizeHourlyDay([{ date: "2026-10-08", hour: 12, weatherCode: null, precipitationProbabilityPct: 80 }], [])).toBeNull();
    // One usable daytime row is enough to report.
    expect(summarizeHourlyDay(hoursWith({ ...nightOnly, 20: 61 }), [])?.wetWindow).toEqual({
      condition: "RAIN",
      fromHour: 20,
      toHour: 21
    });
  });

  it("does not let hours with no weather code cover a stop or add their chance", () => {
    // 09:00 and 10:00 have no code (and a 99% chance that must not count).
    const hours = hoursWith({ 9: null, 10: null }, 10, { 9: 99, 10: 99 });
    const outlook = summarizeHourlyDay(hours, [
      { id: "inside-gap", startTime: "09:00", endTime: "11:00" },
      { id: "edge", startTime: "08:00", endTime: "10:30" },
      { id: "after-gap", startTime: "11:00", endTime: "12:00" }
    ]);

    expect(outlook?.stops).toEqual([
      // Entirely in hours with no data: no entry rather than a made-up DRY.
      { itemId: "edge", outlook: "DRY", maxPrecipitationProbabilityPct: 10 },
      { itemId: "after-gap", outlook: "DRY", maxPrecipitationProbabilityPct: 10 }
    ]);
  });

  it("reads an end time of 24:00 as the end of the day", () => {
    const hours = hoursWith({ 22: 61, 23: 95 });

    expect(summarizeHourlyDay(hours, [{ id: "late", startTime: "22:00", endTime: "24:00" }])?.stops).toEqual([
      // Hours 22 and 23: the 23:00 storm counts.
      { itemId: "late", outlook: "STORM", maxPrecipitationProbabilityPct: 10 }
    ]);
    // 24:00 is only an end: it is not a time a stop can start.
    expect(summarizeHourlyDay(hours, [{ id: "bad", startTime: "24:00", endTime: "24:00" }])?.stops).toEqual([]);
    expect(summarizeHourlyDay(hours, [{ id: "bad", startTime: "23:00", endTime: "25:00" }])?.stops).toEqual([
      // 25:00 is not a real end: the stop counts as one hour, 23:00-24:00.
      { itemId: "bad", outlook: "STORM", maxPrecipitationProbabilityPct: 10 }
    ]);
  });

  it("caps a late stop with no end at the end of the day", () => {
    const hours = hoursWith({ 22: 95, 23: 61 });

    // 23:30 + 1 hour would run into tomorrow: only hour 23 counts, not the 22:00 storm.
    expect(summarizeHourlyDay(hours, [{ id: "late", startTime: "23:30" }])?.stops).toEqual([
      { itemId: "late", outlook: "RAIN", maxPrecipitationProbabilityPct: 10 }
    ]);
  });

  it("reports the highest daytime chance of rain, even on a dry-coded day", () => {
    // Dry codes all day, but a 70% hour at 14:00; the 95% at 02:00 and 90% at 23:00 are night.
    const outlook = summarizeHourlyDay(hoursWith({}, 10, { 2: 95, 14: 70, 23: 90 }), []);

    expect(outlook).toEqual({
      firstWetHour: null,
      wetWindow: null,
      lastWetHour: null,
      maxDaytimePrecipitationProbabilityPct: 70,
      stops: []
    });
  });

  it("counts 06:00 through 21:00 for the daytime chance and not 05:00 or 22:00", () => {
    expect(summarizeHourlyDay(hoursWith({}, 10, { 5: 99, 6: 55, 22: 99 }), [])?.maxDaytimePrecipitationProbabilityPct).toBe(55);
    expect(summarizeHourlyDay(hoursWith({}, 10, { 21: 80, 22: 99 }), [])?.maxDaytimePrecipitationProbabilityPct).toBe(80);
  });

  it("skips rows with no weather code when finding the daytime chance", () => {
    // The 12:00 row has no code, so its 99% chance is not read.
    const outlook = summarizeHourlyDay(hoursWith({ 12: null }, 10, { 12: 99, 15: 40 }), []);

    expect(outlook?.maxDaytimePrecipitationProbabilityPct).toBe(40);
  });

  it("has no daytime chance when the provider gave none for any daytime row", () => {
    const noChances = hoursWith({}).map((row) => ({
      ...row,
      // Night rows keep a chance: only the daytime counts.
      precipitationProbabilityPct: row.hour < DAYTIME_START_HOUR || row.hour >= DAYTIME_END_HOUR ? 90 : null
    }));
    const outlook = summarizeHourlyDay(noChances, [{ id: "s1", startTime: "09:00", endTime: "10:00" }]);

    expect(outlook?.maxDaytimePrecipitationProbabilityPct).toBeNull();
    expect(outlook?.stops).toEqual([{ itemId: "s1", outlook: "DRY", maxPrecipitationProbabilityPct: null }]);
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
    // The 8 PM drizzle row outlasts the storm window, so the spell's end is named too.
    expect(describeHourlyForAgent(summarizeHourlyDay(baguioHours(), [])!)).toBe(
      "dry until 11 AM; thunderstorms 2 PM-8 PM; wet until 9 PM"
    );
    expect(
      describeHourlyForAgent({
        firstWetHour: null,
        wetWindow: null,
        lastWetHour: null,
        maxDaytimePrecipitationProbabilityPct: 5,
        stops: []
      })
    ).toBe("dry from 6 AM to 10 PM");
    expect(
      describeHourlyForAgent({
        firstWetHour: 6,
        wetWindow: { condition: "RAIN", fromHour: 6, toHour: 9 },
        lastWetHour: 8,
        maxDaytimePrecipitationProbabilityPct: 90,
        stops: []
      })
    ).toBe("rain 6 AM-9 AM");
  });

  it("names when the whole wet spell ends only when the worst weather ends sooner", () => {
    // Storms 12-2 PM, then rain and drizzle until 6 PM.
    const stormThenDrizzle = summarizeHourlyDay(hoursWith({ 12: 95, 13: 95, 14: 61, 15: 61, 16: 51, 17: 51 }), []);
    expect(describeHourlyForAgent(stormThenDrizzle!)).toBe("dry until 12 PM; thunderstorms 12 PM-2 PM; wet until 6 PM");

    // The worst band runs to the last wet hour: nothing to add.
    const rainEndsLast = summarizeHourlyDay(hoursWith({ 9: 51, 10: 61, 11: 61 }), []);
    expect(describeHourlyForAgent(rainEndsLast!)).toBe("dry until 9 AM; rain 10 AM-12 PM");
    expect(rainEndsLast?.lastWetHour).toBe(11);

    // A spell that runs to the last daytime hour ends at 10 PM.
    const toTheEvening = summarizeHourlyDay(hoursWith({ 14: 80, 21: 51 }), []);
    expect(describeHourlyForAgent(toTheEvening!)).toBe("dry until 2 PM; rain 2 PM-3 PM; wet until 10 PM");
  });

  it("says snow in the agent's words", () => {
    const outlook = summarizeHourlyDay(hoursWith({ 10: 73, 11: 73 }), [])!;

    expect(describeHourlyForAgent(outlook)).toBe("dry until 10 AM; snow 10 AM-12 PM");
  });
});
