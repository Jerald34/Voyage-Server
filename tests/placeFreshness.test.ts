import { describe, expect, it } from "vitest";
import { isLegacyNominatim, statusIsFresh } from "../src/services/places/placeFreshness";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("statusIsFresh", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  const ttlMs = 30 * DAY_MS;

  it("treats a never-checked snapshot as stale", () => {
    expect(statusIsFresh(null, now, ttlMs)).toBe(false);
    expect(statusIsFresh(undefined, now, ttlMs)).toBe(false);
  });

  it("treats the exact TTL boundary as fresh", () => {
    const boundary = new Date(now.getTime() - ttlMs);
    expect(statusIsFresh(boundary, now, ttlMs)).toBe(true);
  });

  it("treats one millisecond past the boundary as stale", () => {
    const justOver = new Date(now.getTime() - ttlMs - 1);
    expect(statusIsFresh(justOver, now, ttlMs)).toBe(false);
  });

  it("accepts a recent check and rejects an invalid date", () => {
    expect(statusIsFresh(new Date(now.getTime() - 1000), now, ttlMs)).toBe(true);
    expect(statusIsFresh(new Date("nonsense"), now, ttlMs)).toBe(false);
    expect(statusIsFresh("2026-09-01" as unknown as Date, now, ttlMs)).toBe(false);
  });
});

describe("isLegacyNominatim", () => {
  it("recognizes a correctly labelled Nominatim row", () => {
    expect(isLegacyNominatim({ provider: "NOMINATIM" })).toBe(true);
  });

  it("recognizes a historically mislabelled row by its Nominatim metadata", () => {
    expect(
      isLegacyNominatim({ provider: "GOOGLE_MAPS", metadata: { osmType: "node", osmId: "1" } })
    ).toBe(true);
  });

  it("does not treat a genuine Google row as Nominatim", () => {
    expect(isLegacyNominatim({ provider: "GOOGLE_MAPS" })).toBe(false);
    expect(isLegacyNominatim({ provider: "GOOGLE_MAPS", metadata: { query: "Bayview" } })).toBe(false);
    expect(isLegacyNominatim({ provider: "GOOGLE_MAPS", metadata: null })).toBe(false);
    expect(isLegacyNominatim({ provider: "GOOGLE_MAPS", metadata: "osmType" })).toBe(false);
  });
});
