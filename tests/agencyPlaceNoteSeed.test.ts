import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agencyPlaceNoteSeedSchema,
  seedAgencyPlaceNotes,
  type AgencyPlaceNoteRecord,
  type SeedPrismaClient,
  type SeedTransactionClient
} from "../src/modules/agencies/agencyPlaceNoteSeed";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_AGENCY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OUTSIDER_USER_ID = "44444444-4444-4444-8444-444444444444";

function validInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agencyId: AGENCY_ID,
    createdByUserId: USER_ID,
    notes: [],
    ...overrides
  };
}

function makeRecord(overrides: Partial<AgencyPlaceNoteRecord> = {}): AgencyPlaceNoteRecord {
  return {
    id: "seed-note-1",
    agencyId: AGENCY_ID,
    provider: null,
    providerPlaceId: null,
    placeName: "Bayview",
    cityContext: null,
    status: "NEUTRAL",
    note: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

type FakeClient = SeedPrismaClient & {
  tx: SeedTransactionClient;
  notes: Map<string, AgencyPlaceNoteRecord>;
};

/**
 * A hand-built, in-memory fake matching the minimal Prisma-shaped surface
 * `seedAgencyPlaceNotes` depends on. Every model method is a `vi.fn()` so
 * tests can assert exactly what was (or was not) called — in particular that
 * a dry run never reaches a write method. This never touches a real database.
 */
function createFakeClient(
  options: {
    agencies?: string[];
    memberships?: Array<{ agencyId: string; userId: string }>;
    notes?: AgencyPlaceNoteRecord[];
  } = {}
): FakeClient {
  const agencies = new Set(options.agencies ?? [AGENCY_ID]);
  const membershipKeys = new Set(
    (options.memberships ?? [{ agencyId: AGENCY_ID, userId: USER_ID }]).map((m) => `${m.agencyId}:${m.userId}`)
  );
  const notes = new Map<string, AgencyPlaceNoteRecord>();
  for (const note of options.notes ?? []) {
    notes.set(note.id, note);
  }
  let nextId = notes.size + 1;

  const tx: SeedTransactionClient = {
    agency: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        agencies.has(where.id) ? { id: where.id } : null
      )
    },
    agencyMembership: {
      findUnique: vi.fn(
        async ({ where }: { where: { agencyId_userId: { agencyId: string; userId: string } } }) => {
          const { agencyId, userId } = where.agencyId_userId;
          return membershipKeys.has(`${agencyId}:${userId}`)
            ? { id: "membership-1", agencyId, userId }
            : null;
        }
      )
    },
    agencyPlaceNote: {
      findUnique: vi.fn(async ({ where }: { where: any }) => {
        if ("id" in where) {
          return notes.get(where.id) ?? null;
        }
        const key = where.agencyId_provider_providerPlaceId;
        for (const note of notes.values()) {
          if (
            note.agencyId === key.agencyId &&
            note.provider === key.provider &&
            note.providerPlaceId === key.providerPlaceId
          ) {
            return note;
          }
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { agencyId: string } }) => {
        return [...notes.values()].filter(
          (note) => note.agencyId === where.agencyId && note.provider === null && note.providerPlaceId === null
        );
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.agencyId_provider_providerPlaceId;
        for (const note of notes.values()) {
          if (
            note.agencyId === key.agencyId &&
            note.provider === key.provider &&
            note.providerPlaceId === key.providerPlaceId
          ) {
            const updated: AgencyPlaceNoteRecord = { ...note, ...update, updatedAt: new Date() };
            notes.set(note.id, updated);
            return updated;
          }
        }
        const created = makeRecord({ id: `seed-note-${nextId++}`, ...create });
        notes.set(created.id, created);
        return created;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = makeRecord({ id: `seed-note-${nextId++}`, ...data });
        notes.set(created.id, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = notes.get(where.id);
        if (!existing) throw new Error(`Missing note ${where.id}`);
        const updated: AgencyPlaceNoteRecord = { ...existing, ...data, updatedAt: new Date() };
        notes.set(where.id, updated);
        return updated;
      })
    }
  };

  return {
    tx,
    notes,
    $transaction: vi.fn(async (fn: (tx: SeedTransactionClient) => Promise<unknown>) => fn(tx))
  };
}

describe("agencyPlaceNoteSeedSchema", () => {
  function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
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

  it("accepts a row where provider and providerPlaceId are both null (unresolved)", () => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(validInput({ notes: [baseRow()] }));
    expect(parsed.success).toBe(true);
  });

  it("accepts a row where provider and providerPlaceId are both set (resolved)", () => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(
      validInput({ notes: [baseRow({ provider: "GOOGLE_MAPS", providerPlaceId: "place-1" })] })
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a row with provider set but providerPlaceId null", () => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(
      validInput({ notes: [baseRow({ provider: "GOOGLE_MAPS", providerPlaceId: null })] })
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with providerPlaceId set but provider null", () => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(
      validInput({ notes: [baseRow({ provider: null, providerPlaceId: "place-1" })] })
    );
    expect(parsed.success).toBe(false);
  });

  it.each(["AVOID", "CLOSED", "PREFERRED", "NEUTRAL"])("accepts status %s", (status) => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(validInput({ notes: [baseRow({ status })] }));
    expect(parsed.success).toBe(true);
  });

  it("rejects an unrecognized status", () => {
    const parsed = agencyPlaceNoteSeedSchema.safeParse(validInput({ notes: [baseRow({ status: "BOGUS" })] }));
    expect(parsed.success).toBe(false);
  });

  it("trims placeName and rejects a whitespace-only name", () => {
    const trimmed = agencyPlaceNoteSeedSchema.safeParse(validInput({ notes: [baseRow({ placeName: "  Bayview  " })] }));
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.notes[0].placeName).toBe("Bayview");
    }

    const blank = agencyPlaceNoteSeedSchema.safeParse(validInput({ notes: [baseRow({ placeName: "   " })] }));
    expect(blank.success).toBe(false);
  });

  it("rejects a non-uuid agencyId or createdByUserId", () => {
    expect(agencyPlaceNoteSeedSchema.safeParse(validInput({ agencyId: "not-a-uuid", notes: [baseRow()] })).success).toBe(
      false
    );
    expect(
      agencyPlaceNoteSeedSchema.safeParse(validInput({ createdByUserId: "not-a-uuid", notes: [baseRow()] })).success
    ).toBe(false);
  });
});

describe("seedAgencyPlaceNotes", () => {
  it("validates the whole input before touching the database", async () => {
    const client = createFakeClient();

    await expect(
      seedAgencyPlaceNotes(client, validInput({ notes: [{ provider: "GOOGLE_MAPS", providerPlaceId: null }] }))
    ).rejects.toBeTruthy();

    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when the target agency does not exist", async () => {
    const client = createFakeClient({ agencies: [] });

    await expect(
      seedAgencyPlaceNotes(
        client,
        validInput({
          notes: [{ provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: null, status: "NEUTRAL", note: null }]
        })
      )
    ).rejects.toMatchObject({ code: "AGENCY_NOT_FOUND" });
  });

  it("allows a seed authored by an actual member of the target agency", async () => {
    const client = createFakeClient();

    const result = await seedAgencyPlaceNotes(
      client,
      validInput({
        notes: [{ provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: null, status: "NEUTRAL", note: null }]
      })
    );

    expect(result.unresolved).toEqual({ created: 1, updated: 0 });
  });

  it("rejects when the author is not a member of any agency", async () => {
    const client = createFakeClient({ memberships: [] });

    await expect(
      seedAgencyPlaceNotes(
        client,
        validInput({
          createdByUserId: OUTSIDER_USER_ID,
          notes: [{ provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: null, status: "NEUTRAL", note: null }]
        })
      )
    ).rejects.toMatchObject({ code: "AGENCY_MEMBERSHIP_REQUIRED" });
  });

  it("rejects cross-agency authorship: the author is only a member of a different agency", async () => {
    const client = createFakeClient({
      agencies: [AGENCY_ID, OTHER_AGENCY_ID],
      memberships: [{ agencyId: OTHER_AGENCY_ID, userId: USER_ID }]
    });

    await expect(
      seedAgencyPlaceNotes(
        client,
        validInput({
          agencyId: AGENCY_ID,
          createdByUserId: USER_ID,
          notes: [{ provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: null, status: "NEUTRAL", note: null }]
        })
      )
    ).rejects.toMatchObject({ code: "AGENCY_MEMBERSHIP_REQUIRED" });
  });

  it("dry run reports counts but writes nothing", async () => {
    const client = createFakeClient();

    const result = await seedAgencyPlaceNotes(
      client,
      validInput({
        notes: [
          { provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: null, status: "NEUTRAL", note: null },
          { provider: "GOOGLE_MAPS", providerPlaceId: "g-1", placeName: "Old Fort", cityContext: "Manila", status: "PREFERRED", note: null }
        ]
      }),
      { dryRun: true }
    );

    expect(result).toEqual({ resolved: { created: 1, updated: 0 }, unresolved: { created: 1, updated: 0 } });
    expect(client.tx.agencyPlaceNote.create).not.toHaveBeenCalled();
    expect(client.tx.agencyPlaceNote.update).not.toHaveBeenCalled();
    expect(client.tx.agencyPlaceNote.upsert).not.toHaveBeenCalled();
    expect(client.notes.size).toBe(0);
  });

  it("idempotently re-running a known-ID note updates the same row instead of duplicating it", async () => {
    const client = createFakeClient();
    const row = {
      provider: "GOOGLE_MAPS",
      providerPlaceId: "g-1",
      placeName: "Old Fort",
      cityContext: "Manila",
      status: "PREFERRED",
      note: "Guide favorite"
    };

    const first = await seedAgencyPlaceNotes(client, validInput({ notes: [row] }));
    expect(first.resolved).toEqual({ created: 1, updated: 0 });
    expect(client.notes.size).toBe(1);

    const second = await seedAgencyPlaceNotes(client, validInput({ notes: [{ ...row, status: "NEUTRAL" }] }));
    expect(second.resolved).toEqual({ created: 0, updated: 1 });
    expect(client.notes.size).toBe(1);
    expect([...client.notes.values()][0].status).toBe("NEUTRAL");
  });

  it("idempotently re-running an unresolved note updates the same row instead of duplicating it", async () => {
    const client = createFakeClient();
    const row = { provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: "Cebu", status: "AVOID", note: "Closed for renovation" };

    const first = await seedAgencyPlaceNotes(client, validInput({ notes: [row] }));
    expect(first.unresolved).toEqual({ created: 1, updated: 0 });
    expect(client.notes.size).toBe(1);

    const second = await seedAgencyPlaceNotes(client, validInput({ notes: [{ ...row, status: "CLOSED" }] }));
    expect(second.unresolved).toEqual({ created: 0, updated: 1 });
    expect(client.notes.size).toBe(1);
    expect([...client.notes.values()][0].status).toBe("CLOSED");
  });

  it("matches unresolved notes on normalized (trimmed/lowercased) name and city", async () => {
    const client = createFakeClient({
      notes: [makeRecord({ id: "existing-1", placeName: "bayview", cityContext: "cebu" })]
    });

    const result = await seedAgencyPlaceNotes(
      client,
      validInput({
        notes: [
          { provider: null, providerPlaceId: null, placeName: "  Bayview  ", cityContext: " CEBU ", status: "CLOSED", note: null }
        ]
      })
    );

    expect(result.unresolved).toEqual({ created: 0, updated: 1 });
    expect(client.notes.size).toBe(1);
    expect(client.notes.get("existing-1")?.status).toBe("CLOSED");
  });

  it("treats a null cityContext as agency-global and does not match a differently-cased city note", async () => {
    const client = createFakeClient({
      notes: [makeRecord({ id: "existing-global", placeName: "Bayview", cityContext: null })]
    });

    const result = await seedAgencyPlaceNotes(
      client,
      validInput({
        notes: [
          { provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: "Rome", status: "AVOID", note: null }
        ]
      })
    );

    // A city-specific row must not match the existing agency-global note.
    expect(result.unresolved).toEqual({ created: 1, updated: 0 });
    expect(client.notes.size).toBe(2);
    expect(client.notes.get("existing-global")?.status).toBe("NEUTRAL");
  });

  it("rejects an ambiguous unresolved match when multiple existing notes match the same normalized name/city", async () => {
    const client = createFakeClient({
      notes: [
        makeRecord({ id: "dup-1", placeName: "Bayview", cityContext: "Cebu" }),
        makeRecord({ id: "dup-2", placeName: "Bayview", cityContext: "Cebu" })
      ]
    });

    await expect(
      seedAgencyPlaceNotes(
        client,
        validInput({
          notes: [
            { provider: null, providerPlaceId: null, placeName: "Bayview", cityContext: "Cebu", status: "CLOSED", note: null }
          ]
        })
      )
    ).rejects.toMatchObject({ code: "AGENCY_PLACE_NOTE_AMBIGUOUS" });

    // Ambiguity must be rejected before either candidate is mutated.
    expect(client.tx.agencyPlaceNote.update).not.toHaveBeenCalled();
    expect(client.notes.get("dup-1")?.status).toBe("NEUTRAL");
    expect(client.notes.get("dup-2")?.status).toBe("NEUTRAL");
  });
});
