import { describe, expect, it, vi } from "vitest";
import { buildPlaceGate, createPlaceGate } from "../src/services/places/placeGate";
import type { PlaceNote } from "../src/services/places/placeTypes";

function note(overrides: Partial<PlaceNote> = {}): PlaceNote {
  return {
    provider: null,
    providerPlaceId: null,
    placeName: "Bayview",
    cityContext: null,
    status: "NEUTRAL",
    note: null,
    ...overrides
  };
}

describe("place eligibility", () => {
  it("does not block a namesake in another city", () => {
    const gate = buildPlaceGate([{
      provider: null, providerPlaceId: null, placeName: "Bayview",
      cityContext: "Cebu", status: "CLOSED", note: "Guide confirmed closure"
    }]);
    expect(gate.check({ name: "Bayview", cityContext: "Rome" }).allowed).toBe(true);
    expect(gate.check({ name: " bayview ", cityContext: " CEBU " }).allowed).toBe(false);
    expect(gate.check({ name: "Bayview" }).allowed).toBe(true);
  });

  it("blocks provider closure even with a preferred exact note", () => {
    const gate = buildPlaceGate([{
      provider: "GOOGLE_MAPS", providerPlaceId: "g-1", placeName: "Bayview",
      cityContext: null, status: "PREFERRED", note: null
    }]);
    expect(gate.check({
      provider: "GOOGLE_MAPS", providerPlaceId: "g-1",
      name: "Bayview", businessStatus: "CLOSED_PERMANENTLY"
    })).toMatchObject({ allowed: false, reason: "CLOSED_PERMANENTLY" });
  });

  it("treats an exact provider/ID note as authoritative despite a wrong city tag", () => {
    const gate = buildPlaceGate([
      note({ provider: "GOOGLE_MAPS", providerPlaceId: "g-1", cityContext: "Cebu", status: "AVOID" })
    ]);
    expect(gate.check({
      provider: "GOOGLE_MAPS", providerPlaceId: "g-1", name: "Bayview", cityContext: "Rome"
    })).toMatchObject({ allowed: false, reason: "AGENCY_AVOID" });
  });

  it("does not match the same ID under a different provider", () => {
    const gate = buildPlaceGate([
      note({ provider: "NOMINATIM", providerPlaceId: "g-1", status: "CLOSED" })
    ]);
    expect(gate.check({
      provider: "GOOGLE_MAPS", providerPlaceId: "g-1", name: "Bayview"
    }).allowed).toBe(true);
  });

  it("does not let a note with a different known ID match by name", () => {
    const gate = buildPlaceGate([
      note({ provider: "GOOGLE_MAPS", providerPlaceId: "g-other", status: "CLOSED" })
    ]);
    expect(gate.check({
      provider: "GOOGLE_MAPS", providerPlaceId: "g-1", name: "Bayview"
    }).allowed).toBe(true);
    expect(gate.check({ name: "Bayview" }).allowed).toBe(true);
    expect(gate.check({ name: "Bayview", cityContext: "Cebu" }).allowed).toBe(true);
  });

  it("applies a null-city unresolved note as agency-global", () => {
    const gate = buildPlaceGate([note({ status: "AVOID", cityContext: null })]);
    expect(gate.check({ name: "Bayview" }).allowed).toBe(false);
    expect(gate.check({ name: "Bayview", cityContext: "Rome" }).allowed).toBe(false);
    expect(gate.check({ name: "Bayview", cityContext: "Cebu" }).allowed).toBe(false);
  });

  it("lets a blocking note win among duplicate unresolved notes", () => {
    const gate = buildPlaceGate([
      note({ status: "PREFERRED", cityContext: "Cebu" }),
      note({ status: "CLOSED", cityContext: null, note: "Shut in 2025" })
    ]);
    const verdict = gate.check({ name: "Bayview", cityContext: "Cebu" });
    expect(verdict).toMatchObject({ allowed: false, reason: "AGENCY_CLOSED" });
  });

  it("prefers CLOSED over AVOID for a deterministic reason", () => {
    const gate = buildPlaceGate([
      note({ status: "AVOID" }),
      note({ status: "CLOSED" })
    ]);
    expect(gate.check({ name: "Bayview" })).toMatchObject({ reason: "AGENCY_CLOSED" });
  });

  it("advises but allows a temporary provider closure and a preferred note", () => {
    const gate = buildPlaceGate([note({ status: "PREFERRED", note: "House favorite" })]);
    const temporary = gate.check({ name: "Bayview", businessStatus: "CLOSED_TEMPORARILY" });
    expect(temporary.allowed).toBe(true);
    expect(temporary.allowed && temporary.advisory).toMatch(/temporar/i);

    const preferred = gate.check({ name: "Bayview", businessStatus: "OPERATIONAL" });
    expect(preferred.allowed).toBe(true);
    expect(preferred.allowed && preferred.advisory).toMatch(/preferred/i);
  });

  it("puts the agency block ahead of a permanent provider closure", () => {
    const gate = buildPlaceGate([note({ status: "AVOID" })]);
    expect(gate.check({ name: "Bayview", businessStatus: "CLOSED_PERMANENTLY" })).toMatchObject({
      allowed: false,
      reason: "AGENCY_AVOID"
    });
  });

  it("still blocks provider closures when notes are unavailable", () => {
    const gate = buildPlaceGate([], false);
    expect(gate.notesAvailable).toBe(false);
    expect(gate.check({ name: "Bayview", businessStatus: "CLOSED_PERMANENTLY" })).toMatchObject({
      allowed: false,
      reason: "CLOSED_PERMANENTLY"
    });
    expect(gate.check({ name: "Bayview" }).allowed).toBe(true);
  });

  it("partitions in input order and can block every result", () => {
    const gate = buildPlaceGate([note({ placeName: "Blocked", status: "CLOSED" })]);
    const partitioned = gate.partition([
      { name: "Alpha" },
      { name: "Blocked" },
      { name: "Beta" }
    ]);
    expect(partitioned.allowed.map((place) => place.name)).toEqual(["Alpha", "Beta"]);
    expect(partitioned.blocked).toHaveLength(1);
    expect(partitioned.blocked[0].result.name).toBe("Blocked");
    expect(partitioned.blocked[0].verdict.reason).toBe("AGENCY_CLOSED");

    const allBlocked = gate.partition([{ name: "Blocked" }, { name: "blocked" }]);
    expect(allBlocked.allowed).toEqual([]);
    expect(allBlocked.blocked).toHaveLength(2);
  });

  it("returns matching-city notes before global notes and never leaks identity", () => {
    const gate = buildPlaceGate([
      note({ placeName: "Global", status: "AVOID", cityContext: null }),
      note({ placeName: "CebuOnly", status: "CLOSED", cityContext: "Cebu", note: "Closed" }),
      note({ placeName: "RomeOnly", status: "AVOID", cityContext: "Rome" })
    ]);
    const notes = gate.notesFor("cebu");
    expect(notes.map((entry) => entry.placeName)).toEqual(["CebuOnly", "Global"]);
    expect(notes.every((entry) => !("provider" in entry) && !("providerPlaceId" in entry))).toBe(true);

    expect(gate.notesFor().map((entry) => entry.placeName)).toEqual(["Global"]);
  });

  it("carries the note text into the block detail", () => {
    const gate = buildPlaceGate([note({ status: "CLOSED", note: "Guide confirmed closure" })]);
    const verdict = gate.check({ name: "Bayview" });
    expect(verdict.allowed).toBe(false);
    expect(!verdict.allowed && verdict.detail).toContain("Guide confirmed closure");
  });
});

// Readable statement of the matching rule from design §4. `buildPlaceGate` uses
// normalized indexes for speed; this differential test proves the two agree.
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function matchingNotes(notes: PlaceNote[], place: { provider?: any; providerPlaceId?: string; name: string; cityContext?: string | null }): PlaceNote[] {
  const exact = place.provider && place.providerPlaceId
    ? notes.filter(entry => entry.provider === place.provider &&
        entry.providerPlaceId === place.providerPlaceId)
    : [];
  if (exact.length) return exact;
  return notes.filter(entry =>
    entry.providerPlaceId === null &&
    normalize(entry.placeName) === normalize(place.name) &&
    (entry.cityContext === null ||
      (Boolean(normalize(place.cityContext)) &&
       normalize(entry.cityContext) === normalize(place.cityContext)))
  );
}

const BLOCKING: Record<string, boolean> = { CLOSED: true, AVOID: true, PREFERRED: false, NEUTRAL: false };

describe("indexed lookup matches the reference matching rule", () => {
  const providers = [null, "GOOGLE_MAPS", "NOMINATIM"] as const;
  const names = ["Bayview", " bayview ", "Harbor"];
  const cities = [null, "Cebu", "cebu ", "Rome"];
  const statuses = ["AVOID", "CLOSED", "PREFERRED", "NEUTRAL"] as const;

  const corpus: PlaceNote[] = [];
  let seed = 0;
  for (const provider of providers) {
    for (const name of names) {
      for (const city of cities) {
        const status = statuses[seed % statuses.length];
        seed += 1;
        corpus.push({
          provider,
          providerPlaceId: provider ? `id-${seed % 3}` : null,
          placeName: name,
          cityContext: city,
          status,
          note: null
        });
      }
    }
  }

  it("agrees on whether a candidate is blocked across the whole corpus", () => {
    const gate = buildPlaceGate(corpus);
    let compared = 0;

    for (const provider of providers) {
      for (const id of ["id-0", "id-1", "id-2", "id-unknown"]) {
        for (const name of ["Bayview", "BAYVIEW", "Harbor", "Unknown"]) {
          for (const city of [null, "Cebu", "CEBU", "Rome", "Paris"]) {
            const candidate = {
              ...(provider ? { provider, providerPlaceId: id } : {}),
              name,
              cityContext: city
            };
            const reference = matchingNotes(corpus, candidate as any);
            const referenceBlocks = reference.some((entry) => BLOCKING[entry.status]);
            const verdict = gate.check(candidate as any);
            expect(verdict.allowed).toBe(!referenceBlocks);
            compared += 1;
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(100);
  });
});

describe("createPlaceGate", () => {
  function fakeClient(notes: unknown[], onFindMany?: (args: unknown) => void) {
    return {
      agencyPlaceNote: {
        findMany: vi.fn(async (args: unknown) => {
          onFindMany?.(args);
          return notes;
        })
      }
    } as any;
  }

  it("loads one agency-scoped query with only the required fields", async () => {
    let seen: any;
    const client = fakeClient(
      [{ provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: "Cebu", status: "CLOSED", note: null }],
      (args) => { seen = args; }
    );

    const gate = await createPlaceGate(client, "agency-1");

    expect(client.agencyPlaceNote.findMany).toHaveBeenCalledTimes(1);
    expect(seen.where).toEqual({ agencyId: "agency-1" });
    expect(seen.select).toEqual({
      provider: true,
      providerPlaceId: true,
      placeName: true,
      cityContext: true,
      status: true,
      note: true
    });
    expect(gate.notesAvailable).toBe(true);
    expect(gate.check({ name: "Bayview", cityContext: "Cebu" }).allowed).toBe(false);
  });

  it("never queries for a null agency but still filters provider closures", async () => {
    const client = fakeClient([]);
    const gate = await createPlaceGate(client, null);

    expect(client.agencyPlaceNote.findMany).not.toHaveBeenCalled();
    expect(gate.notesAvailable).toBe(true);
    expect(gate.notesFor("Cebu")).toEqual([]);
    expect(gate.check({ name: "Bayview", businessStatus: "CLOSED_PERMANENTLY" })).toMatchObject({
      allowed: false,
      reason: "CLOSED_PERMANENTLY"
    });
  });

  it("marks notes unavailable on query failure and logs without leaking the query", async () => {
    const client = {
      agencyPlaceNote: {
        findMany: vi.fn(async () => {
          throw new Error("connection to postgresql://user:hunter2@db.example.test failed");
        })
      }
    } as any;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const gate = await createPlaceGate(client, "agency-1");

    expect(gate.notesAvailable).toBe(false);
    expect(gate.check({ name: "Bayview" }).allowed).toBe(true);
    expect(gate.check({ name: "Bayview", businessStatus: "CLOSED_PERMANENTLY" }).allowed).toBe(false);

    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("hunter2");
    errorSpy.mockRestore();
  });
});
