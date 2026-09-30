# Place Freshness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.
>
> **Coordinator:** Use the user's installed lead-developer-orchestrator skill. This document is an implementation handoff for Claude Code; it does not authorize implementation until the user reviews and approves the plan.

**Goal:** Prevent known-closed or agency-blocked places from becoming new trip stops, retain and label saved work, and refresh status with bounded provider usage.

**Architecture:** Keep raw provider observations separate from a pure agency-scoped eligibility gate. A shared selection service handles cached/name/ID candidates; a run/request context carries the gate through tools and mutation services. A bounded status-only worker refreshes saved snapshots; clients display provider status and authorized agency overlays.

**Tech Stack:** TypeScript, Express 5, Prisma 7/PostgreSQL, Google Places API (New), Nominatim, Vitest; Next.js 16/React 19, existing Google map presentation and jsPDF.

---

## 0. Handoff, authority, and baseline

Read the revised [design](../specs/2026-08-16-place-freshness-gate-design.md) first. It incorporates the eight changes reviewed in this conversation. This plan and that revision supersede the original draft's incorrect read-hook locations, fetchedAt-only clock, incomplete tool coverage, and zero-added-spend promise.

Repository roots:

- Server: C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Server
- Client: C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Client

All paths below are relative to the explicitly named repository. Do not make app changes in the parent Voyage repository.

Planning snapshot:

- Server branch feat/place-freshness-gate, HEAD 16ea10dce7b549af0104313f663baf58c375336f; baseline staging e7fefbe5a8aada871f605d607f561bbc88372026.
- Client branch staging, HEAD 7fb74e77875e96245bd3d0020509e6dcb07c5147.
- Before documentation edits both repositories were clean.
- Earlier focused server run: 51 passed, 4 failed across mapsProvider, itineraryService, agentOrchestrator. All four failures expected itinerary.updated for creation but production emitted itinerary.created. Server src/tests tree hashes matched staging, so these are inherited failures.
- TypeScript no-emit and branch diff checks passed in the earlier review. Re-run at execution; do not treat those observations as fresh execution evidence.
- No database migration, paid Google call, browser validation, implementation, commit, or push was performed during planning.
- Claude Code 2.1.260 is installed. A read-only Claude Sonnet 5 review attempt failed before inference with HTTP 401, OAuth access token expired; reported cost and model usage were zero. Thus no completed Claude review is claimed for this plan.

### Claude model policy

Use lead-developer-orchestrator from C:/Users/dever/.claude/skills/lead-developer-orchestrator/SKILL.md. It is a **skill**, not a custom agent definition: do not assume --agent lead-developer-orchestrator exists.

| Role | Claude selection | Reason |
|---|---|---|
| Lead, migration/contract decisions, gate/guard/worker tasks, final review | Opus 5, claude-opus-5 | Cross-cutting correctness and tenant isolation |
| Provider wiring, context integration, client work, seed utility | Sonnet 5, claude-sonnet-5 | Bounded multi-file implementation |
| Independent path/format verification and mechanical documentation checks | Haiku 4.5, claude-haiku-4-5-20251001 | Read-only/mechanical work |
| Review of a Sonnet implementation | Separate Opus reviewer | Fresh context and stronger reasoning |
| Review of an Opus implementation | Separate Opus reviewer | Independent judgment; no Fable escalation |

Fable is prohibited for the lead, subagents, reviewers, defaults, fallback chains, and overload fallback. Do not use opusplan because its phase switching obscures this explicit assignment. Use explicit task model selection; never let a worker inherit an unknown default. At execution verify /model and actual resolved IDs for opus/sonnet/haiku; inspect model-only overrides such as ANTHROPIC_DEFAULT_OPUS_MODEL and CLAUDE_CODE_SUBAGENT_MODEL without printing secrets. If the desired Claude is unavailable, stop that dispatch and report the problem; do not silently substitute Fable or a non-Claude model.

These pins were checked against [Anthropic's Opus 5 release](https://www.anthropic.com/news/claude-opus-5) and [Claude Code model configuration](https://support.claude.com/en/articles/11940350-claude-code-model-configuration). Recheck availability at execution rather than assuming aliases cannot change. Claude's [subagent documentation](https://code.claude.com/docs/en/sub-agents) describes explicit model selection.

After reauthentication, launch from the server:

~~~powershell
Set-Location 'C:\Users\dever\OneDrive\Documents\Voyage\Voyage-Server'
claude --model claude-opus-5 --add-dir '..\Voyage-Client'
~~~

First review prompt:

~~~text
Use /lead-developer-orchestrator. Read docs/superpowers/specs/2026-08-16-place-freshness-gate-design.md and docs/superpowers/plans/2026-09-06-place-freshness-gate-implementation.md. Review the plan, verify model mappings and repository state, and wait for my approval before implementation. Use Claude Opus/Sonnet/Haiku only, assigned by task difficulty. Never use Fable, including defaults or fallbacks.
~~~

Once the user approves implementation, the lead executes the numbered tasks with spec-compliance review before code-quality review, fixes findings, and re-verifies before advancing. Load TDD, systematic-debugging when needed, and verification-before-completion. Frontend assignments must also load ui-ux-pro-max, frontend-design, and emil-design-eng as required by the coordinator; keep the existing visual language and report UI review in its Before/After/Why format.

Do not apply migrations to the configured shared database or run real note seeding during implementation tests. Use a disposable local database whose target has been checked. Deployment, push, public posting, and shared-database changes require separate user authorization.

## 1. File boundaries and dependency order

New server units:

| File | Responsibility |
|---|---|
| src/services/places/placeTypes.ts | Domain status/verdict/advisory/session contracts |
| src/services/places/placeGate.ts | Pure matching/precedence and scoped note loading |
| src/services/places/placeFreshness.ts | Clock, provider-support, observation ordering helpers |
| src/services/places/placeSnapshotRepository.ts | Snapshot lookups and atomic status observation persistence |
| src/services/places/placeRefreshScheduler.ts | Status-only request deduplication, queue, budgets, cooldown |
| src/services/places/placeSelectionService.ts | Name/ID preparation with fresh observations and eligibility |
| src/services/places/placeServices.ts | Lazy production composition; no eager provider construction |
| src/modules/agent/placeRunContext.ts | Per-run gate, budget and explanation state |
| src/modules/agent/placeAdvisoryBlock.ts | Compact user-runtime advisory formatting |
| src/modules/itineraries/itineraryPlaceGuard.ts | New-versus-preserved identity rules and mutation preparation |
| src/modules/itineraries/savedPlaceAdvisories.ts | Authenticated item overlays and refresh scheduling |
| src/modules/agencies/agencyPlaceNoteSeed.ts | Validated, idempotent seed service |
| scripts/seed-agency-place-notes.ts | Explicit file-driven seed CLI |

New client units:

| File | Responsibility |
|---|---|
| app/lib/trip-dashboard/placeStatus.js | Pure status normalization and label selection |
| app/components/trip-dashboard/itinerary/PlaceStatusBadge.jsx | Shared readable warning label |
| tests/place-status.test.jsx | Status policy and component coverage |
| tests/place-status-normalization.test.jsx | SSE/entity/map status propagation |
| tests/pdf-place-status.test.js | PDF closure text and pagination regression |

Existing modification paths are listed per task. No new package dependency is required.

Task ordering and writers:

- Task 0: lead preflight and isolated checkouts at execution.
- Task 1: schema/config/contracts.
- Tasks 2 (provider fields) and 3 (pure gate) can run in parallel after Task 1; they own disjoint files/tests.
- Task 4 (persistence/enrichment) follows Task 2.
- Task 5 (scheduler) follows Task 4.
- Task 6 (selection service) follows Tasks 3–5.
- Task 7 (mutation guards) and Task 8 (run/tool integration) are sequential: both affect itinerary tool contracts.
- Task 9 (current context/saved reads/serializers) follows Task 8.
- Task 10 (seed utility) can run alongside Task 9 after Task 3; only Task 10 owns package.json for the seed command.
- Tasks 11–12 are client normalization and presentation, sequential after the response contract is frozen.
- Task 13 is integrated verification/review.

Do not dispatch parallel writers to agentTools.ts, itineraryTools.ts, agentFactory.ts, package.json, Prisma schema, or shared test files. The lead owns merge/conflict resolution and integration commits. After each numbered implementation task: run its targeted tests, review, then commit only its listed files. A small task may be split into fresh agents at the checkbox boundaries, never at an unreviewed shared-file boundary.

## Task 0: Establish execution state and baseline

**Model:** Opus lead; Haiku may independently check paths/status read-only.

- [ ] Obtain the user's approval of this plan before editing implementation.
- [ ] Fetch both repositories and inspect status, branches, remotes, HEADs, and current AGENTS/CLAUDE instructions. Reconcile drift with the source anchors in this plan.
- [ ] Use using-git-worktrees at execution if isolation is needed. Carry these documentation changes into the server execution checkout; do not start from staging and lose them. Create a client feature checkout from its verified staging baseline. Do not switch or reset another task's checkout.
- [ ] Confirm Claude authentication and explicit non-Fable models before any worker starts.
- [ ] Run the baseline commands separately in each repository and save results in the lead's execution report:

~~~powershell
# Server
npm test
npx tsc --noEmit
git diff --check
# Client
npm test
npm run build
git diff --check
~~~

- [ ] Classify any existing failures, including the four known server creation-event assertions. Do not weaken runtime behavior or rewrite unrelated tests merely to make a green report.
- [ ] Read actual function definitions before each task. Existing line numbers are not an authority after branches move.

## Task 1: Add schema, configuration, and shared contracts

**Model:** Opus.
**Server files:** Modify prisma/schema.prisma, src/config/env.ts, .env.example. Create prisma/migrations/20260906000000_place_freshness_gate/migration.sql and src/services/places/placeTypes.ts. Extend tests/env.test.ts. Create tests/placeSchema.test.ts.

- [ ] Add failing config cases for defaults, zero/negative TTL, zero/negative concurrency, and invalid budgets. Verify migration text contains nullable status/time and the paired-provider-ID constraint.
- [ ] Run npm test -- tests/env.test.ts tests/placeSchema.test.ts; require failures caused by missing feature behavior.
- [ ] Add enums/model/opposite relations from spec §3 and these two nullable PlaceSnapshot columns:

~~~prisma
businessStatus          PlaceBusinessStatus?
businessStatusCheckedAt DateTime?
~~~

The migration is additive, with no bulk provider fetch or invented historical verification timestamps:

~~~sql
CREATE TYPE "PlaceBusinessStatus" AS ENUM ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY');
CREATE TYPE "AgencyPlaceNoteStatus" AS ENUM ('AVOID', 'CLOSED', 'PREFERRED', 'NEUTRAL');
ALTER TABLE "PlaceSnapshot"
  ADD COLUMN "businessStatus" "PlaceBusinessStatus",
  ADD COLUMN "businessStatusCheckedAt" TIMESTAMP(3);
CREATE TABLE "AgencyPlaceNote" (
  "id" UUID NOT NULL,
  "agencyId" UUID NOT NULL,
  "provider" "PlaceProvider",
  "providerPlaceId" TEXT,
  "placeName" TEXT NOT NULL,
  "cityContext" TEXT,
  "status" "AgencyPlaceNoteStatus" NOT NULL DEFAULT 'NEUTRAL',
  "note" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyPlaceNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgencyPlaceNote_provider_id_pair"
    CHECK (("provider" IS NULL) = ("providerPlaceId" IS NULL)),
  CONSTRAINT "AgencyPlaceNote_agencyId_fkey"
    FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgencyPlaceNote_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgencyPlaceNote_agencyId_provider_providerPlaceId_key"
  ON "AgencyPlaceNote"("agencyId", "provider", "providerPlaceId");
CREATE INDEX "AgencyPlaceNote_agencyId_cityContext_idx" ON "AgencyPlaceNote"("agencyId", "cityContext");
CREATE INDEX "AgencyPlaceNote_agencyId_placeName_idx" ON "AgencyPlaceNote"("agencyId", "placeName");
~~~

Prisma supplies UUIDs and updatedAt for normal creates. Add Agency.placeNotes and User.createdPlaceNotes as the opposite relations.

- [ ] Add validated configuration and document exact defaults:

~~~ts
PLACE_SNAPSHOT_TTL_DAYS: z.coerce.number().int().positive().default(30),
PLACE_STATUS_MAX_REFRESHES_PER_READ: z.coerce.number().int().min(0).max(100).default(10),
PLACE_STATUS_REFRESH_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
PLACE_STATUS_MAX_REFRESHES_PER_RUN: z.coerce.number().int().min(0).default(20),
PLACE_STATUS_MAX_REFRESHES_PER_HOUR: z.coerce.number().int().min(0).default(120),
PLACE_STATUS_RETRY_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
~~~

A zero budget disables extra refreshes, not cached/provider-payload filtering. Existing normal tool quotas are not replaced.

- [ ] Define the shared contracts; import generated Prisma enums as types:

~~~ts
import type { AgencyPlaceNoteStatus, PlaceBusinessStatus, PlaceProvider } from "@prisma/client";

export type GateInput = {
  provider?: PlaceProvider;
  providerPlaceId?: string;
  name: string;
  cityContext?: string | null;
  businessStatus?: PlaceBusinessStatus | null;
};
export type BlockReason = "CLOSED_PERMANENTLY" | "AGENCY_AVOID" | "AGENCY_CLOSED";
export type PlaceVerdict =
  | { allowed: true; advisory?: string }
  | { allowed: false; reason: BlockReason; detail: string };
export type NoteView = {
  status: AgencyPlaceNoteStatus;
  placeName: string;
  cityContext: string | null;
  note: string | null;
};
export type PlaceNote = NoteView & {
  provider: PlaceProvider | null;
  providerPlaceId: string | null;
};
export type PlaceAdvisory = {
  reason: BlockReason | "CLOSED_TEMPORARILY" | "STATUS_UNVERIFIED" | "NOTES_UNAVAILABLE";
  label: string;
};
export type PlaceGate = {
  notesAvailable: boolean;
  check(place: GateInput): PlaceVerdict;
  partition<T extends GateInput>(places: T[]): {
    allowed: T[];
    blocked: Array<{ result: T; verdict: Extract<PlaceVerdict, { allowed: false }> }>;
  };
  notesFor(cityContext?: string | null): NoteView[];
};
export type StatusObservation = {
  businessStatus: PlaceBusinessStatus;
  // Time immediately before the successful provider request was issued.
  businessStatusCheckedAt: Date;
};
~~~

- [ ] Run npx prisma validate and npm run prisma:generate, then the targeted tests and npx tsc --noEmit. Validation/generation do not apply migrations.
- [ ] Review additive SQL on a disposable local database; test null historical fields, paired-ID constraint, known-ID uniqueness, and multiple unresolved notes.
- [ ] Commit: feat(places): add status clock and agency note schema.

## Task 2: Request and propagate provider status

**Model:** Sonnet.
**Server files:** Modify src/services/maps/types.ts, parsing.ts, googleMaps.ts. Extend tests/mapsProvider.test.ts.

- [ ] Add fake-fetch tests for resolvePlace, searchPlaces, searchNearby, and getPlaceDetails masks; each recognized value, missing/unrecognized values, and details containing status without coordinates. All tests use injected fetchImpl.
- [ ] Run npm test -- tests/mapsProvider.test.ts and observe the missing-field failures.
- [ ] Add optional businessStatus and businessStatusCheckedAt to PlaceSearchResult and ResolvedPlace; PlaceDetailsResult inherits them. Add an optional getPlaceStatus method to MapsProvider for an inexpensive status-only details request; Nominatim need not implement it.

~~~ts
getPlaceStatus?(placeId: string): Promise<{
  businessStatus?: PlaceBusinessStatus;
  businessStatusCheckedAt?: Date;
}>;
~~~

- [ ] Export a strict parser from parsing.ts:

~~~ts
export function parseBusinessStatus(value: unknown) {
  return value === "OPERATIONAL" ||
    value === "CLOSED_TEMPORARILY" ||
    value === "CLOSED_PERMANENTLY"
    ? value
    : undefined;
}
~~~

In parsePlace, only add businessStatus when recognized so existing missing-field object shapes remain compatible.

- [ ] Add places.businessStatus to resolve/search/nearby masks and businessStatus to full details. Each call records a request-start Date and attaches it only to recognized status results. Copy both fields in resolvePlace's return object.
- [ ] Implement getPlaceStatus through the same authenticated, timeout-limited readJsonResponse helper, GET /v1/places/{encoded ID}, field mask id,businessStatus. It must not fetch photos or require coordinates.
- [ ] Run the tests, then npx tsc --noEmit. Assert fake responses never cause external calls.
- [ ] Commit: feat(maps): collect business status observations.

## Task 3: Implement the pure agency gate

**Model:** Opus.
**Server files:** Create src/services/places/placeGate.ts and tests/placeGate.test.ts.

- [ ] Add the following initial tests, using buildPlaceGate as the pure constructor:

~~~ts
import { describe, expect, it } from "vitest";
import { buildPlaceGate } from "../src/services/places/placeGate";

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
});
~~~

- [ ] Run npm test -- tests/placeGate.test.ts and verify missing implementation failures.
- [ ] Implement buildPlaceGate(notes, notesAvailable = true). Use normalized string indexes for exact provider/ID, unresolved name/city, and unresolved global name. Do not index known-ID notes into fallback-name matching. The lookup algorithm is:

~~~ts
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
export function matchingNotes(notes: PlaceNote[], place: GateInput): PlaceNote[] {
  const exact = place.provider && place.providerPlaceId
    ? notes.filter(note => note.provider === place.provider &&
        note.providerPlaceId === place.providerPlaceId)
    : [];
  if (exact.length) return exact;
  return notes.filter(note =>
    note.providerPlaceId === null &&
    normalize(note.placeName) === normalize(place.name) &&
    (note.cityContext === null ||
      (Boolean(normalize(place.cityContext)) &&
       normalize(note.cityContext) === normalize(place.cityContext)))
  );
}
~~~

Use this reference behavior to test the indexed implementation; expose matchingNotes only if the production code uses it rather than adding unused exports. Among matches choose CLOSED, then AVOID, then PREFERRED, then NEUTRAL for deterministic behavior. Provider permanent closure follows the agency block check. Temporary closures remain allowed.

- [ ] Implement createPlaceGate(client, agencyId), one agency-scoped findMany query with only required fields, no query for null agency. On query failure return buildPlaceGate([], false) and a safely redacted log. notesFor returns matching-city notes followed by null-city notes; no IDs/authorship.
- [ ] Extend tests for wrong-city exact ID, different-provider same ID, different known ID same name, global notes, duplicate unresolved notes, input-order preservation, null-agency closure filtering, notes failure, and all-result blocking.
- [ ] Run targeted tests and type check.
- [ ] Commit: feat(places): add agency-scoped eligibility policy.

## Task 4: Separate status observations from general snapshot writes

**Model:** Opus for persistence; Sonnet may handle enrichment wiring after its contract is reviewed.
**Server files:** Create src/services/places/placeFreshness.ts and placeSnapshotRepository.ts. Modify src/modules/agent/tools/toolUtils.ts and placeSnapshotEnrichment.ts. Create tests/placeFreshness.test.ts and tests/placeSnapshotStatus.test.ts.

- [ ] Write tests proving general upserts and failed enrichment do not advance status time, closure observations persist despite selection rejection, and older responses cannot overwrite newer status.
- [ ] Run npm test -- tests/placeFreshness.test.ts tests/placeSnapshotStatus.test.ts.
- [ ] Implement the freshness helper and test the inclusive boundary:

~~~ts
export function statusIsFresh(checkedAt: Date | null | undefined, now: Date, ttlMs: number) {
  return checkedAt instanceof Date &&
    Number.isFinite(checkedAt.getTime()) &&
    checkedAt.getTime() >= now.getTime() - ttlMs;
}
export function isLegacyNominatim(snapshot: {
  provider: string; metadata?: unknown;
}) {
  if (snapshot.provider === "NOMINATIM") return true;
  const metadata = snapshot.metadata;
  return Boolean(metadata && typeof metadata === "object" &&
    "osmType" in metadata && (metadata as { osmType?: unknown }).osmType);
}
~~~

- [ ] Move shared snapshot persistence into placeSnapshotRepository.ts so places services do not import agent tool modules. Keep upsertPlaceSnapshot in toolUtils as an imported re-export for existing callers. General create/update retains fetchedAt behavior but never writes status fields from a reconstructed cached object. Add a repository path for provider candidates with optional coordinates: full search/details observations may create a snapshot using their ID/name and nullable coordinates; status-only worker responses update only an already-existing row.
- [ ] Add observeStatus(provider, providerPlaceId, observation). After ensuring the snapshot row exists, use an atomic conditional update:

~~~ts
await client.placeSnapshot.updateMany({
  where: {
    provider,
    providerPlaceId,
    OR: [
      { businessStatusCheckedAt: null },
      { businessStatusCheckedAt: { lt: observation.businessStatusCheckedAt } }
    ]
  },
  data: {
    businessStatus: observation.businessStatus,
    businessStatusCheckedAt: observation.businessStatusCheckedAt
  }
});
~~~

Observation time is captured at request start, not at a later enrichment upsert. A tie does not replace the stored observation. The create path writes a recognized observation atomically with the new row; subsequent updates use the conditional operation. Return/read the persisted row after observation so callers decide using the latest stored status, not an older response.

- [ ] Fix toPlaceSnapshotProvider to preserve NOMINATIM, which already exists in the Prisma enum. Do not bulk relabel historical rows; recognize their Nominatim metadata when deciding Google refresh eligibility.
- [ ] In enrichment, propagate a recognized details observation with its original request time. Backfill reconstruction preserves known status for eligibility/display but does not manufacture an observation time. If details fail, there is no status write. A skipped enrichment is not a check.
- [ ] Preserve status on mapPinpointPayload for subsequent SSE/client normalization; include checked time only as a serialized observation timestamp, never mark the place open from a missing value.
- [ ] Test successful reopen, missing field retaining closure, failed details retaining time, pre-migration rows, unsupported provider skip, and out-of-order concurrent observations.
- [ ] Run targeted tests, mapsProvider tests, and type check.
- [ ] Commit: fix(places): preserve status freshness across enrichment.

## Task 5: Implement the shared status refresh scheduler

**Model:** Opus.
**Server files:** Create src/services/places/placeRefreshScheduler.ts and tests/placeRefreshScheduler.test.ts.

- [ ] Build tests with injected clock, getPlaceStatus, and observation repository. Cover read cap 10, concurrency 3 across simultaneous callers, process cap 120/hour, run cap 20, duplicate IDs, retries after five minutes, and eviction. Do not use real timers or Google.
- [ ] Run npm test -- tests/placeRefreshScheduler.test.ts.
- [ ] Expose the following dependency-injected interface:

~~~ts
export type RefreshBudget = { remaining: number };
export type RefreshResult =
  | { kind: "updated" }
  | { kind: "fresh" | "unsupported" | "cooldown" | "budget" | "failed" };
export type RefreshSnapshot = {
  id: string;
  provider: "GOOGLE_MAPS" | "NOMINATIM";
  providerPlaceId: string;
  businessStatusCheckedAt: Date | null;
  metadata?: unknown;
};
export type PlaceRefreshScheduler = {
  refresh(snapshot: RefreshSnapshot, budget: RefreshBudget): Promise<RefreshResult>;
  scheduleRead(snapshots: RefreshSnapshot[]): void;
};
~~~

Implement factory dependencies for now, ttlMs, concurrency, perRead, perHour, cooldownMs, getPlaceStatus, observeStatus, and a redacted counter/logger. scheduleRead is synchronous; it attaches a catch handler to its background drain.

- [ ] Implement ordering: remove expired hourly timestamps/cooldowns; skip unsupported/fresh/cooldown; coalesce existing in-flight work before charging another budget; reserve run/hour tokens before enqueueing; drain the shared queue with at most concurrency workers.
- [ ] For scheduleRead, deduplicate by provider/ID and choose null/oldest status time first. Filter in-flight/cooldown entries before consuming the ten-request allowance so a repeatedly failing first item cannot starve later items.
- [ ] Perform one status-only provider call. Recognized observation is persisted through observeStatus; absent/unrecognized/failed result enters cooldown. Always release active/in-flight entries in finally. Never update status time on failure, even to throttle retries.
- [ ] Expire metadata without keeping timers alive indefinitely. Export a test-only drain hook through factory return if needed, but production callers use scheduleRead/refresh.
- [ ] Run tests with deferred promises that assert maximum active fetches is 3 and two reads share the same fetch. Confirm budgets count actual additional calls, not deduplicated waiters.
- [ ] Commit: feat(places): bound and deduplicate status refreshes.

## Task 6: Implement the shared selection session

**Model:** Opus.
**Server files:** Create src/services/places/placeSelectionService.ts and placeServices.ts. Extend placeTypes.ts. Create tests/placeSelectionService.test.ts.

- [ ] Write tests for fresh closed cache hits, stale known IDs, supplied missing IDs, new name resolution, unresolved notes blocking without a maps provider, a blocked observation saved before rejection, and provider failure retaining an existing closure.
- [ ] Run npm test -- tests/placeSelectionService.test.ts.
- [ ] Define these shared contracts in placeTypes.ts:

~~~ts
export type PlaceItemInput = {
  placeSnapshotId?: string | null;
  placeName?: string;
  cityContext?: string | null;
};
export type PreparedPlace = {
  placeSnapshotId?: string;
  point: { latitude: number; longitude: number } | null;
  candidate: GateInput | null;
};
export type PlaceSelectionSession = {
  agencyId: string | null;
  gate: PlaceGate;
  prepare(item: PlaceItemInput, cityContextFallback?: string): Promise<PreparedPlace>;
  evaluate(candidate: GateInput): PlaceVerdict;
  consider<T extends GateInput & { businessStatusCheckedAt?: Date }>(
    candidate: T
  ): Promise<{ candidate: T; verdict: PlaceVerdict }>;
  explanations(): Array<{ name: string; reason: string; detail: string }>;
  notesUnavailable: boolean;
};
~~~

createPlaceSelectionService dependencies are the snapshot repository, optional MapsProvider, refresh scheduler, createGate, TTL, clock, and per-run budget. Its public method createSession(agencyId) loads a gate once and initializes bounded per-session memoization. createSession never reads a global mutable currentAgency.

- [ ] prepare resolves a supplied ID through storage first, failing PLACE_SNAPSHOT_NOT_FOUND if absent. For a name: apply name/city notes before any provider call; look up a generally fresh cached row; otherwise resolve via the provider and save its observation. Refresh status independently when eligible. Re-read stored status after refresh. Evaluate the actual provider name/ID as well as any unresolved input-name restriction.
- [ ] Implement consider(candidate) for fresh provider tool output: persist any recognized observation, merge a newer stored status (including a retained closure when this response omits status), then call evaluate and record the explanation. Preserve all caller payload fields in the returned candidate. Tool adapters supply provider/ID/name and optional coordinates; this is the async counterpart to the pure gate and does not discard blocked observations.
- [ ] Throw new ApiError(409, "PLACE_BLOCKED", a concise name/reason) after recording the block explanation. Existing HTTP middleware already serializes ApiError; the agent registry gets a recoverable conversion in Task 8.
- [ ] On failed name resolution, retain the existing best-effort unresolved-item behavior only if there is no available block. Never catch PLACE_BLOCKED or missing-supplied-ID errors as a generic maps failure.
- [ ] Check for an existing canonical provider ID after name resolution; merge current stored status even if the latest provider omitted it. Raw provider closure may still block if database persistence fails. A known agency block never becomes allowed because maps is unavailable.
- [ ] Use null-safe coordinate checks; missing coordinates do not suppress a valid status check or warning. Memoize raw lookup/provider promises within the session, not final allowed verdicts. At a new attachment boundary merge the latest stored observation again, so a closure learned by another tool in the same run cannot be bypassed by a cached allowed decision.
- [ ] Compose production dependencies lazily in placeServices.ts. It can import config/db/maps and the new places units; it must not import itinerary/agent factories (avoid circular imports and import-time provider calls).
- [ ] Run targeted tests, existing itineraryService and agentOrchestrator suites, and type check. Preserve/re-document inherited failures.
- [ ] Commit: feat(places): centralize name and snapshot selection checks.

## Task 7: Guard all itinerary writes and existing rated-history copies

**Model:** Opus.
**Server files:** Create src/modules/itineraries/itineraryPlaceGuard.ts. Modify itineraryService.ts, src/modules/agent/tools/itineraryPlaceResolver.ts, itineraryTools.ts, src/modules/agent/agentTools.ts, src/modules/ratedHistory/ratedHistoryService.ts and ratedHistoryRepository.ts. Create tests/itineraryPlaceGuard.test.ts and tests/itineraryPlaceResolver.test.ts; extend tests/itineraryService.test.ts and tests/ratedHistoryService.test.ts.

- [ ] Write guard tests before wiring: closed supplied ID on create/add; cached closure; title/time patch of an existing closed stop succeeds; changed identity fails; movement succeeds; full replacement preserves an existing closed occurrence but rejects a new duplicate; bulk rejection makes zero repository mutation calls.
- [ ] Run the four relevant suites and confirm missing behavior fails.
- [ ] Add an optional final internal execution argument carrying PlaceSelectionSession to create/add/replace/update service methods and matching agent-service interfaces. This argument is not part of any request-body schema. Production service composition always provides createSession; existing isolated unit tests can inject deterministic fakes. Require session.agencyId to equal the authorized agency argument.
- [ ] Make itineraryPlaceGuard the single owner of preservation decisions. Full replacement uses the existing authorized snapshot-ID multiset; do not exempt every occurrence because an ID appears once. Start with this helper:

~~~ts
export function consumePreservedId(
  remaining: Map<string, number>,
  snapshotId: string | null | undefined
) {
  if (!snapshotId) return false;
  const count = remaining.get(snapshotId) ?? 0;
  if (count <= 0) return false;
  remaining.set(snapshotId, count - 1);
  return true;
}
~~~

Only call it when the replacement's identity is unchanged. A conflicting supplied placeName must be checked/resolved, not hidden behind an old ID. Compare against the stored item's canonical snapshot name; count-based preservation is conservative because full replacement's current schema has no item IDs.

- [ ] For create/add prepare every place-bearing item. For updateItem, load the existing item from the authorized itinerary and prepare only when the identity changes; other patches retain its snapshot and overlay. For replaceDraft, compute preservation from the already-loaded existing itinerary before preparing remaining items. Preserve current draft/version/ownership checks before provider work and before repository mutation.
- [ ] Wire the existing resolvers to session.prepare, including both cached and supplied-ID early-return branches. Keep route-estimation behavior, in-run dedup, and skipEnrichment semantics. Do not use itinerary title as if it were an exact city for agency matching; a title may be a search fallback, but city-specific notes match only explicitly established city context.
- [ ] Make the guarded service the owner of which items require preparation; tools must not pre-check preserved stops before the service computes exemptions. Pass a preparation callback into the existing bulk resolver so it returns trusted stored points for preserved items and calls session.prepare for new items. The guard computes this callback's preservation map from the authorized stored target; no request body can supply it. Continue using addRoutesWithinDay and attachRouteFromPrevious after preparation so this change does not remove routing. Move only these preparation dependencies through the service/factory boundary; do not import the agent factory into places or itinerary services.
- [ ] Pass the same session through the service call so notes load once and lookup promises coalesce. Add a regression that updating the title of a saved closed stop does not invoke session.prepare for that stop and still retains its route data.
- [ ] In insertFromRated, after existing agency/access/version/selection validation and before insertItemsTransactional, prepare all selected item snapshot IDs with the **target** agency's session. Copies are new selections even if those IDs already exist in the target. Keep provider calls outside the database transaction. Use a narrow injected prepareCopiedPlaces dependency in RatedHistoryDeps for testability.
- [ ] Preserve stored-item mutation atomicity: assemble and validate the entire prepared payload first, then call the existing repository operation once. A blocked item/day/segment yields a recoverable 409 PLACE_BLOCKED without shifting days, incrementing versions, or partially inserting.
- [ ] Reuse existing getSourceItinerary internal IDs rather than removing them from the copy payload. Do not build the deferred RAG tool.
- [ ] Add regression cases to both item and day/segment rated insertion tests, including no mutation on rejection and unchanged stale-version/agency errors.
- [ ] Run the focused resolver/guard/service/rated tests and type check.
- [ ] Commit: fix(itineraries): gate new and reused place attachments.

## Task 8: Scope the gate per run and cover every map tool

**Model:** Sonnet implementation, Opus review.
**Server files:** Create src/modules/agent/placeRunContext.ts. Modify agentTools.ts, agentFactory.ts, agentOrchestrator.ts, tools/mapTools.ts, tools/itineraryTools.ts. Create tests/placeRunContext.test.ts and tests/mapToolsPlaceGate.test.ts; extend tests/agentOrchestrator.test.ts.

- [ ] Test two simultaneous agencies with different notes, one note query per run, personal provider-only behavior, and run cancellation cleanup. Test all seven place-producing tools listed below with closed provider payloads.
- [ ] Run npm test -- tests/placeRunContext.test.ts tests/mapToolsPlaceGate.test.ts.
- [ ] Add places?: PlaceSelectionSession to AgentToolContext. Add a createPlaceSession(agencyId) dependency to createAgentOrchestrator; production always supplies it from placeServices. In run(), create a local session after authorizing/loading the thread and include it in the context object passed to registry.execute. Do not store it on the singleton orchestrator.
- [ ] Use the session for tool/service calls even when maps is unavailable; agency restrictions must still apply. Tests that intentionally construct a bare tool must pass a fake session for gate assertions rather than relying on production omission.
- [ ] Apply the output/persistence behavior for each tool. Use session.consider for raw provider payloads before partitioning/returning; it merges stored closure evidence when a response omits status. Preserve the actual result's other fields:

| Existing tool | Required gate point |
|---|---|
| search_google_places | Normalize id/provider, persist recognized observations, partition before returning usable results |
| search_nearby_google_places | Same as text search, preserve input order |
| get_google_place_details | Persist observation, check, then return usable details |
| map_pinpoint | Prepare/check before emitting map.pinpoint or recording an allowed source |
| place_insights | Same; agency policy applies before downstream insights become a candidate |
| route_logistics | Check both endpoints before emitting route or storing allowed source metadata |
| estimate_route | Name mode checks both endpoints; coordinate-only routing remains a geometric calculation |

get_google_place_photos remains historical media retrieval. A photo result does not assert eligibility and triggers no extra paid status request. Internal enrichment can observe a closed place; it must not filter away the observation before persistence.

- [ ] Search output becomes { results, blocked }, where blocked holds only { name, reason, detail }. Inspect actual consumer expectations and update internal tests/context summarizers in the same task. Do not return blocked coordinates/URLs as usable results. Preserve raw allowed result fields including temporary-closure advisories.
- [ ] Convert gate errors into recoverable tool output at the registry's existing catch boundary:

~~~ts
if (error instanceof ApiError &&
    (error.code === "PLACE_BLOCKED" || error.code === "PLACE_SNAPSHOT_NOT_FOUND")) {
  return { error: { code: error.code, message: error.message }, retryable: true };
}
~~~

Leave unrelated errors and rate-limit handling unchanged. Test the next model turn can select a replacement and run completion still succeeds.
- [ ] Ensure source/event creation follows successful eligibility; block explanations use the session, not fake successful map events.
- [ ] Run targeted tests, agentOrchestrator, mapsProvider, and type check.
- [ ] Commit: feat(agent): apply per-run place eligibility to map tools.

## Task 9: Refresh saved reads and expose current advisories

**Model:** Sonnet implementation with Opus contract review.
**Server files:** Create src/modules/itineraries/savedPlaceAdvisories.ts and src/modules/agent/placeAdvisoryBlock.ts. Modify src/modules/itineraries/itineraryService.ts, itineraryTypes.ts, src/modules/personal/personalRepository.ts and personalService.ts, src/modules/agent/agentContextBuilder.ts, agentOrchestrator.ts, agentFactory.ts, agentPrompts.ts, src/modules/shares/shareRepository.ts and shareTypes.ts. Create tests/savedPlaceAdvisories.test.ts; extend personalService, publicShareBranding, agentOrchestrator tests.

- [ ] Write saved-read tests with deferred provider promises: first read returns old data immediately; after drain, later read has new status; other snapshots remain for later capped reads. Unauthorized/missing/list/public reads make no refresh request.
- [ ] Write context regression: an old tool event says OPERATIONAL, current authorized stored snapshot says CLOSED_PERMANENTLY; user runtime context warns while systemInstruction remains identical.
- [ ] Run npm test -- tests/savedPlaceAdvisories.test.ts tests/personalService.test.ts tests/agentOrchestrator.test.ts.
- [ ] Add businessStatus and businessStatusCheckedAt to itineraryTypes' snapshot shape, plus optional placeAdvisory on the item and placeAdvisories on the authenticated itinerary for request-level verification warnings. No advisory is persisted.
- [ ] In itineraryService.getItinerary, after findItineraryByAgency succeeds, create/use the scoped session, overlay current agency warnings, scheduleRead for the loaded snapshots, and return. Preserve auth/404 behavior. Do not put the scheduling hook at repository addDay/updateDay or general include helpers used inside mutations.
- [ ] Add days/items/placeSnapshot hydration only to personalRepository.findItineraryForUser, preserving its agencyId:null + createdByUserId constraint. Extend PersonalItineraryRecord's detail shape without broadening list payloads; personalService.getItinerary schedules status work after authorization and never loads agency notes.
- [ ] Authenticated item overlay carries a small { reason, label } object. Provider closure is read from the shared snapshot. Agency CLOSED/AVOID gets an agency label; temporary closure gets a temporary label. When notes are unavailable, include itinerary.placeAdvisories = [{ reason: "NOTES_UNAVAILABLE", label: "Agency restrictions could not be checked. Review these places before confirming the trip." }]. It is never a global provider status.
- [ ] Add buildPlaceAdvisoryBlock inputs for notes, notesAvailable, blocked explanations, and current saved-item labels. Format note names/text as quoted data, trim reasonable per-note lengths, and bound the context block without truncating deterministic gate enforcement.
- [ ] Extend buildRuntimeContextBlock(activeItineraryContext, placeAdvisoryBlock = "") so advisories still appear when there is no active itinerary. Keep all dynamic content in the user message; update both initial and synthesis calls.
- [ ] Add an authorized load-current-itinerary callback to the orchestrator factory. Use itineraryService.getItinerary for agency runs and createPrismaPersonalRepository().findItineraryForUser(userId, itineraryId) for null-agency owner runs. The current personalService module exports a factory, not a ready-made singleton; do not import a nonexistent personalService export. Refresh current stored status for the active itinerary ID identified in events; do not trust an event ID without that authorization. Do not replay stale status from historical events over the fresh record.
- [ ] Propagate current status/overlays after mutation results so later continuation turns see the latest saved stop, and append current session block explanations.
- [ ] Extend shareRepository's explicit snapshot projection and shareTypes with provider businessStatus/checked time only. Exclude internal note text, placeAdvisory, and placeAdvisories. Public share reads do not schedule Google work.
- [ ] Run saved/context/personal/share tests and type check.
- [ ] Commit: feat(places): refresh saved views and surface scoped advisories.

## Task 10: Deliver validated agency-note seeding

**Model:** Sonnet; Haiku can check CLI help/docs.
**Server files:** Create src/modules/agencies/agencyPlaceNoteSeed.ts, scripts/seed-agency-place-notes.ts, tests/agencyPlaceNoteSeed.test.ts. Modify package.json. Create docs/operations/agency-place-notes.md.

- [ ] Write tests for provider/ID pairs, valid statuses, trimmed nonempty names, author membership, cross-agency rejection, and idempotent re-running of the same known-ID/unresolved note.
- [ ] Run npm test -- tests/agencyPlaceNoteSeed.test.ts.
- [ ] Define file validation with Zod:

~~~ts
import { z } from "zod";
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
~~~

- [ ] Implement seedAgencyPlaceNotes(client, input) in a transaction after validating agency and author's membership. Upsert known IDs using the compound unique key. For unresolved notes, match exact normalized agency/name/city and update deterministically; reject ambiguous multiple existing matches rather than updating an arbitrary note. This is a serial operator command, not a concurrent CRUD API.
- [ ] CLI supports --file <path> and --dry-run. Validate whole input first; dry run reports counts only and does not write. Require an explicit file, print target host/database name without credentials, and document that production execution is a separate operator action.
- [ ] Add "seed:place-notes": "tsx scripts/seed-agency-place-notes.ts" to package scripts. Document examples with fictional UUIDs and the meaning of null city as agency-global. Do not seed real notes during tests or this plan's execution.
- [ ] Run tests and type check, then commit: feat(agencies): add validated place-note seed command.

## Task 11: Preserve status through client normalization

**Model:** Sonnet.
**Client files:** Create app/lib/trip-dashboard/placeStatus.js and tests/place-status-normalization.test.jsx. Modify app/lib/trip-dashboard/placeEntities.js, app/lib/stream/normalizers.js, app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx, app/lib/trip-dashboard/richItinerary.js. Extend tests/trip-dashboard-place-entities.test.jsx.

- [ ] Add tests for itinerary status, streamed markers, raw map item normalization, raw live marker normalization, temporary status, null/unknown status, and stale live marker versus current snapshot of the same ID.
- [ ] Run npm test -- tests/place-status-normalization.test.jsx tests/trip-dashboard-place-entities.test.jsx.
- [ ] Implement the pure normalizer and label function:

~~~js
export function normalizeBusinessStatus(value) {
  return ["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"].includes(value)
    ? value
    : undefined;
}
export function getPlaceStatusLabel({ businessStatus, placeAdvisory } = {}) {
  if (placeAdvisory?.reason === "AGENCY_CLOSED") return "Agency marked closed";
  if (placeAdvisory?.reason === "AGENCY_AVOID") return "Agency recommends avoiding";
  if (businessStatus === "CLOSED_PERMANENTLY") return "Permanently closed";
  if (businessStatus === "CLOSED_TEMPORARILY") return "Temporarily closed";
  return "";
}
~~~

No provider operational/open badge is inferred from missing status.

- [ ] In buildPlaceEntities, carry normalized snapshot status/time and item.placeAdvisory on itinerary entries, and normalized marker status/time on live entries. normalizeMapMarker must preserve placeSnapshotId in addition to its display ID so identities can be reconciled.
- [ ] Preserve status/overlay in mapItemToPoint, normalizeLiveMarker, and selectedPlace projection inside ItineraryLiveMap. Do not assume buildPlaceEntities is the map's only data source.
- [ ] When current saved and historical live entries refer to the same snapshot, use the newer recognized status observation; a missing/older live status cannot erase a current closure. If no comparable time is present, prefer the authenticated saved snapshot. Keep selection IDs stable.
- [ ] Carry a separate closure label into buildRichItinerarySections; do not replace the existing mapped/location-pending meaning without preserving it.
- [ ] Test the serialization boundary using plain JSON strings for checkedAt; do not require Date objects in browser payloads.
- [ ] Run targeted tests and npm run build. Commit: feat(client): preserve place status through map and stream data.

## Task 12: Render accessible warnings and PDF status

**Model:** Sonnet implementation, Opus UI review.
**Client files:** Create app/components/trip-dashboard/itinerary/PlaceStatusBadge.jsx and tests/place-status.test.jsx, tests/pdf-place-status.test.js. Modify mobile/CompactPlaceCard.jsx, mobile/PlaceDetailSheet.jsx, itinerary/ItineraryLiveMap.jsx, itinerary/map/PlaceDetailPanel.jsx, command-center/RichItineraryMessage.jsx, itinerary/ItineraryDraftPanel.jsx, and app/lib/pdfExport.js.

- [ ] Load the three frontend skills required by lead-developer-orchestrator. Retain existing tokens, typography, card layouts, selection behavior, and responsive structure.
- [ ] Write tests before UI changes:

~~~jsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import PlaceStatusBadge from "../app/components/trip-dashboard/itinerary/PlaceStatusBadge.jsx";

it("uses readable closure text", () => {
  render(<PlaceStatusBadge businessStatus="CLOSED_PERMANENTLY" />);
  expect(screen.getByText("Permanently closed")).toBeVisible();
});
it("does not claim missing status is open", () => {
  const { container } = render(<PlaceStatusBadge />);
  expect(container).toBeEmptyDOMElement();
});
~~~

- [ ] Run npm test -- tests/place-status.test.jsx tests/pdf-place-status.test.js.
- [ ] Implement the shared badge:

~~~jsx
import { getPlaceStatusLabel } from "../../../lib/trip-dashboard/placeStatus.js";

export default function PlaceStatusBadge({ businessStatus, placeAdvisory }) {
  const label = getPlaceStatusLabel({ businessStatus, placeAdvisory });
  if (!label) return null;
  return (
    <span className="inline-flex rounded-md border border-amber-700/30 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
      {label}
    </span>
  );
}
~~~

Place it beside/below the name in compact card, mobile sheet, desktop detail panel, rich itinerary stop, and map selected-place panel. Pass item.placeAdvisory only on authorized staff views; public views get provider status only.

- [ ] Render authenticated itinerary.placeAdvisories in ItineraryDraftPanel as a compact readable warning above the itinerary. It must survive a re-fetch and disappear after notes load successfully. Public share screens do not receive this field. Add a component test for notes-unavailable and successful subsequent read.
- [ ] Give closed map pins a distinguishable glyph and accessible title including the closure label, while maintaining selection, focus, and historical visibility. Preserve the existing active-state treatment. Keep the existing empty-map, missing-configuration, and agency-location fallback behavior; do not introduce another map library or paid lookup.
- [ ] In pdfExport, derive a provider-only closure/temporary label from item.placeSnapshot.businessStatus. Add its wrapped-line height to estimatedHeight before checkPageBreak and draw it with the item. Do not export staff note text or agency overlays.
- [ ] Mock jsPDF for a focused test that verifies closure text is printed and its height participates in the page-break calculation. Include long names near a page boundary and missing-status output.
- [ ] Run focused tests, full client tests, and npm run build.
- [ ] Manually inspect desktop/mobile, keyboard access, text contrast, an old saved closure, temporary closure, unknown status, and PDF output. Record any unrun browser checks.
- [ ] Commit: feat(client): label closed places without removing saved stops.

## Task 13: Integrate, verify, and prepare release handoff

**Model:** Opus lead and independent Opus reviewer; Haiku may check paths and conflict markers.

- [ ] Review each task for spec compliance, then code quality. Use independent reviewer context containing exact SHAs, task text, tests, and touched files; do not supply a conclusion to rubber-stamp.
- [ ] Run these commands in the server execution checkout:

~~~powershell
npm run prisma:generate
npx prisma validate
npx tsc --noEmit
npm test
git diff --check
git status --short --branch
~~~

- [ ] Run these in the client execution checkout:

~~~powershell
npm test
npm run build
git diff --check
git status --short --branch
~~~

- [ ] On an explicitly verified disposable database, apply the additive migration and verify existing snapshots remain readable/null-status, opposite relations work, and known-ID/unresolved-note constraints behave as designed. No paid Google calls are necessary; use provider fakes.
- [ ] Run one cross-boundary scenario with fixtures: an old saved stop remains visible; revalidation stores closure; subsequent authenticated read supplies warning; new add/create/copy by that snapshot ID fails; unrelated title edit succeeds; public share/PDF show only provider closure.
- [ ] Verify a single process's extra request caps and concurrency with a multi-request test. Confirm docs do not call these global monetary limits.
- [ ] Check no shared singleton contains agency notes, no internal note reaches public output, no provider keys enter logs/URLs, no historical event is rewritten, and no missing-status response clears a known closure.
- [ ] Compare final failures to the baseline by exact failing test names and assertions. Do not say all tests pass if inherited failures remain. Resolve new regressions before handoff; separate unrelated baseline maintenance from this feature.
- [ ] Record manual gaps separately: real Google API, applied deployment migration, actual agency notes, desktop/mobile maps, PDF export, and public-share browser check.
- [ ] Prepare two focused reviewable change sets. Server rollout/migration comes before client rollout; do not push, merge, deploy, or mutate shared databases without authorization.
- [ ] Provide final report with commit SHAs, model IDs actually used, tests/exit codes, unresolved baseline failures, and unrun live validation.

## Acceptance traceability

| Revised spec | Plan tasks |
|---|---|
| Known-closure guarantee; unknown is unverified | 2–8, 11–13 |
| Schema, paired identity, nullable history | 1, 10, 13 |
| Successful-observation clock, reopening, race ordering | 2, 4–6 |
| Matching, global notes, agency/provider isolation | 3, 6, 8–10 |
| Read-triggered freshness, budgets, cooldown, no public calls | 5, 9, 13 |
| Cache/ID/name/copy coverage and preserved saved stops | 6–8 |
| Current runtime context and stable system instruction | 8–9 |
| Recoverable errors and atomic mutation rejection | 6–8 |
| API/SSE/map/mobile/desktop/PDF status propagation | 9, 11–12 |
| Validated notes seed path; no notes UI | 10 |
| Claude routing, no Fable, review and conflict gates | 0, all task assignments, 13 |

## Plan review record

This is a plan, not an implementation result. Before accepting it, the lead should check that all named existing paths/functions still resolve, new files have clear owners, dependency ordering prevents concurrent writers, every spec behavior maps to a task, and observation/session/overlay type names remain consistent.

The current plan's Claude review attempt did not run because authentication expired. Reauthentication and a fresh Claude plan review are part of Task 0. This limitation does not authorize any fallback to Fable.
