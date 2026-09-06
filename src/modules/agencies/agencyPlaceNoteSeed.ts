/**
 * agencyPlaceNoteSeed.ts
 *
 * Validated, idempotent seeding of `AgencyPlaceNote` rows from an operator-
 * supplied file. This is a serial operator command (run from the CLI in
 * scripts/seed-agency-place-notes.ts), not a concurrent CRUD API — there is
 * no per-row locking beyond running the whole batch inside one transaction.
 *
 * Design (see docs/superpowers/specs/2026-08-16-place-freshness-gate-design.md
 * §3-4 and docs/superpowers/plans/2026-09-06-place-freshness-gate-implementation.md
 * Task 10):
 *   - The whole input is validated against `agencyPlaceNoteSeedSchema` before
 *     any database access.
 *   - The target agency must exist and `createdByUserId` must hold a
 *     membership in THAT agency (not merely membership somewhere else).
 *   - A "known-ID" row (provider + providerPlaceId both set) is upserted on
 *     the compound unique key, so re-running the same file is idempotent.
 *   - An "unresolved" row (provider + providerPlaceId both null) is matched
 *     by exact normalized agencyId/placeName/cityContext against existing
 *     unresolved notes. Zero matches creates a new note; exactly one match
 *     updates it; more than one is rejected rather than picking arbitrarily.
 */
import { z } from "zod";
import type { AgencyPlaceNoteStatus, PlaceProvider } from "@prisma/client";
import { ApiError } from "../../http/errors";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const agencyPlaceNoteSeedSchema = z.object({
  agencyId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  notes: z.array(z.object({
    provider: z.enum(["GOOGLE_MAPS", "NOMINATIM"]).nullable(),
    providerPlaceId: z.string().trim().min(1).nullable(),
    placeName: z.string().trim().min(1).max(500),
    cityContext: z.string().trim().min(1).max(200).nullable(),
    status: z.enum(["AVOID", "CLOSED", "PREFERRED", "NEUTRAL"]),
    note: z.string().trim().max(2000).nullable()
  }).refine(row => (row.provider === null) === (row.providerPlaceId === null), {
    message: "provider and providerPlaceId must both be set or both be null"
  })).max(1000)
});

export type AgencyPlaceNoteSeedInput = z.infer<typeof agencyPlaceNoteSeedSchema>;
export type AgencyPlaceNoteSeedRow = AgencyPlaceNoteSeedInput["notes"][number];

// ---------------------------------------------------------------------------
// Minimal Prisma-shaped client contract
// ---------------------------------------------------------------------------
// Only the operations this module needs, so tests can inject a hand-built
// fake (vitest `vi.fn()`) rather than a real PrismaClient/database. The real
// `prisma` singleton structurally satisfies this at the CLI call site.

export type AgencyPlaceNoteRecord = {
  id: string;
  agencyId: string;
  provider: PlaceProvider | null;
  providerPlaceId: string | null;
  placeName: string;
  cityContext: string | null;
  status: AgencyPlaceNoteStatus;
  note: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

type ResolvedNoteWhere = {
  agencyId_provider_providerPlaceId: {
    agencyId: string;
    provider: PlaceProvider;
    providerPlaceId: string;
  };
};

type NoteMutableFields = {
  placeName: string;
  cityContext: string | null;
  status: AgencyPlaceNoteStatus;
  note: string | null;
};

type NoteCreateData = NoteMutableFields & {
  agencyId: string;
  provider: PlaceProvider | null;
  providerPlaceId: string | null;
  createdByUserId: string;
};

export type SeedTransactionClient = {
  agency: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  agencyMembership: {
    findUnique(args: {
      where: { agencyId_userId: { agencyId: string; userId: string } };
    }): Promise<{ id: string; agencyId: string; userId: string } | null>;
  };
  agencyPlaceNote: {
    findUnique(args: { where: { id: string } | ResolvedNoteWhere }): Promise<AgencyPlaceNoteRecord | null>;
    findMany(args: {
      where: { agencyId: string; provider: null; providerPlaceId: null };
    }): Promise<AgencyPlaceNoteRecord[]>;
    upsert(args: {
      where: ResolvedNoteWhere;
      create: NoteCreateData;
      update: NoteMutableFields;
    }): Promise<AgencyPlaceNoteRecord>;
    create(args: { data: NoteCreateData }): Promise<AgencyPlaceNoteRecord>;
    update(args: { where: { id: string }; data: NoteMutableFields }): Promise<AgencyPlaceNoteRecord>;
  };
};

export type SeedPrismaClient = {
  $transaction<T>(fn: (tx: SeedTransactionClient) => Promise<T>): Promise<T>;
};

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type AgencyPlaceNoteSeedCounts = {
  created: number;
  updated: number;
};

export type AgencyPlaceNoteSeedResult = {
  resolved: AgencyPlaceNoteSeedCounts;
  unresolved: AgencyPlaceNoteSeedCounts;
};

export type AgencyPlaceNoteSeedOptions = {
  /**
   * When true, performs every read and validation step (including agency and
   * membership checks and unresolved-note ambiguity detection) but calls no
   * write method, so the database is left unchanged. The returned result
   * still reflects what a real run would create/update.
   */
  dryRun?: boolean;
};

// Same trim+lowercase normalization used by the pure eligibility gate
// (src/services/places/placeGate.ts §4) so seeding and runtime matching agree.
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

async function applyResolvedNote(
  tx: SeedTransactionClient,
  agencyId: string,
  row: AgencyPlaceNoteSeedRow,
  createdByUserId: string,
  dryRun: boolean
): Promise<{ created: boolean }> {
  // Schema's refine already guarantees provider/providerPlaceId are both set here.
  const provider = row.provider as PlaceProvider;
  const providerPlaceId = row.providerPlaceId as string;
  const where: ResolvedNoteWhere = {
    agencyId_provider_providerPlaceId: { agencyId, provider, providerPlaceId }
  };

  const existing = await tx.agencyPlaceNote.findUnique({ where });

  if (!dryRun) {
    await tx.agencyPlaceNote.upsert({
      where,
      create: {
        agencyId,
        provider,
        providerPlaceId,
        placeName: row.placeName,
        cityContext: row.cityContext,
        status: row.status,
        note: row.note,
        createdByUserId
      },
      update: {
        placeName: row.placeName,
        cityContext: row.cityContext,
        status: row.status,
        note: row.note
      }
    });
  }

  return { created: !existing };
}

async function applyUnresolvedNote(
  tx: SeedTransactionClient,
  agencyId: string,
  row: AgencyPlaceNoteSeedRow,
  createdByUserId: string,
  dryRun: boolean
): Promise<{ created: boolean }> {
  const targetName = normalize(row.placeName);
  const targetCity = normalize(row.cityContext);

  const candidates = await tx.agencyPlaceNote.findMany({
    where: { agencyId, provider: null, providerPlaceId: null }
  });
  const matches = candidates.filter(
    (candidate) => normalize(candidate.placeName) === targetName && normalize(candidate.cityContext) === targetCity
  );

  if (matches.length > 1) {
    const scope = row.cityContext ? `in "${row.cityContext}"` : "agency-global";
    throw new ApiError(
      409,
      "AGENCY_PLACE_NOTE_AMBIGUOUS",
      `Multiple existing unresolved notes match "${row.placeName}" (${scope}) for agency ${agencyId}; ` +
        "seeding cannot determine which one to update. Resolve the duplicate note manually before re-running."
    );
  }

  const [existing] = matches;

  if (existing) {
    if (!dryRun) {
      await tx.agencyPlaceNote.update({
        where: { id: existing.id },
        data: {
          placeName: row.placeName,
          cityContext: row.cityContext,
          status: row.status,
          note: row.note
        }
      });
    }
    return { created: false };
  }

  if (!dryRun) {
    await tx.agencyPlaceNote.create({
      data: {
        agencyId,
        provider: null,
        providerPlaceId: null,
        placeName: row.placeName,
        cityContext: row.cityContext,
        status: row.status,
        note: row.note,
        createdByUserId
      }
    });
  }

  return { created: true };
}

/**
 * Validates and applies a batch of agency place notes.
 *
 * `input` is validated against `agencyPlaceNoteSeedSchema` before anything
 * else runs (including before opening the transaction), so a malformed file
 * never reaches the database. The rest of the work — agency/membership
 * checks and every row write — happens inside a single transaction.
 */
export async function seedAgencyPlaceNotes(
  client: SeedPrismaClient,
  input: unknown,
  options: AgencyPlaceNoteSeedOptions = {}
): Promise<AgencyPlaceNoteSeedResult> {
  const parsed = agencyPlaceNoteSeedSchema.parse(input);
  const dryRun = options.dryRun ?? false;

  return client.$transaction(async (tx) => {
    const agency = await tx.agency.findUnique({ where: { id: parsed.agencyId } });
    if (!agency) {
      throw new ApiError(404, "AGENCY_NOT_FOUND", `No agency found with id ${parsed.agencyId}.`);
    }

    const membership = await tx.agencyMembership.findUnique({
      where: { agencyId_userId: { agencyId: parsed.agencyId, userId: parsed.createdByUserId } }
    });
    if (!membership) {
      throw new ApiError(
        403,
        "AGENCY_MEMBERSHIP_REQUIRED",
        `User ${parsed.createdByUserId} must hold a membership in agency ${parsed.agencyId} to author its place notes.`
      );
    }

    const result: AgencyPlaceNoteSeedResult = {
      resolved: { created: 0, updated: 0 },
      unresolved: { created: 0, updated: 0 }
    };

    for (const row of parsed.notes) {
      const isResolved = row.provider !== null;
      const { created } = isResolved
        ? await applyResolvedNote(tx, parsed.agencyId, row, parsed.createdByUserId, dryRun)
        : await applyUnresolvedNote(tx, parsed.agencyId, row, parsed.createdByUserId, dryRun);

      const bucket = isResolved ? result.resolved : result.unresolved;
      if (created) bucket.created += 1;
      else bucket.updated += 1;
    }

    return result;
  });
}
