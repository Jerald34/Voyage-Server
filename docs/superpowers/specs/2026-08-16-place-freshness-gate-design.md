# Place Freshness Gate & Agency Place Notes — Design

**Date:** 2026-08-16
**Status:** Draft — pending review
**Scope:** `Voyage-Server` (§3–§8, §9) and `Voyage-Client` (§9.1). Two separate git repos; the server change must land first, since the client reads a field the server has to supply.
**Related specs:**
- `2026-05-28-rated-itinerary-reuse-picker-design.md` — defers "Agent RAG over rated history" (`search_rated_history`). That is a *discovery* feature over the agency's own trips. This spec is a *correctness* filter over live provider data. They are independent; §11 records the boundary.

## 1. Summary

Voyage plans trips around places that no longer exist. Permanently closed businesses are recommended by the agent, pinned on the map, and saved into itineraries, with nothing anywhere in the stack marking them as dead.

Two root causes, both verified in the current code:

1. **Google already tells us, and we never ask.** The Places API returns `businessStatus` (`OPERATIONAL` / `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY`). None of the four field masks in `src/services/maps/googleMaps.ts` request it. The field is Essentials-tier, so requesting it adds no Google spend.
2. **The `PlaceSnapshot` cache never expires.** `itineraryPlaceResolver.ts:128` and `:214` match on name + city with no `fetchedAt` predicate. The column exists (`schema.prisma:465`) and is written on every upsert — it is never read. A snapshot cached years ago is reused forever.

The fix is a single **place gate** at the provider boundary that every place-producing path funnels through. The gate blocks permanently-closed places and agency-blacklisted places before the agent ever sees them. A second layer, **agency place notes**, captures staff ground truth that outranks Google.

**Explicitly not RAG.** The originating request asked about RAG over places. Retrieval over a corpus we own is the wrong instrument here: a vector store of places is a snapshot of the past, so it would worsen staleness rather than fix it. It is also top-k and therefore lossy — a safety filter that can silently miss the one note saying "this hotel burned down" is not a safety filter. Agency notes are retrieved with exhaustive scoped SQL. See §11.

## 2. Goals & non-goals

**Goals**
- A permanently closed place never reaches the agent's context on a new lookup.
- Staff ground truth (`AVOID` / `CLOSED`) outranks Google.
- Closures surface on already-saved itineraries without mutating staff-reviewed work.
- One choke point, so the fix cannot drift across the seven map tools.
- No added Google spend; preserve most of the existing cache saving.
- Preserve Gemini `cachedContent` reuse (§7 constraint).

**Non-goals**
- Embeddings, pgvector, or semantic place retrieval.
- Auto-mutating saved itineraries (§6 decision).
- Blocking `CLOSED_TEMPORARILY` places.
- A staff CRUD UI for notes. This spec delivers the model, the gate, and the seeding path; the management screen is a follow-up. (The *closed-place badge* is in scope — see §9.1.)
- Opening-hours-aware scheduling ("is it open at 14:00 on a Tuesday").
- Backfilling `businessStatus` for every historical snapshot in one migration pass (§5.2 handles it incrementally).

## 3. Data model

```prisma
enum PlaceBusinessStatus {
  OPERATIONAL
  CLOSED_TEMPORARILY
  CLOSED_PERMANENTLY
}
```

`PlaceSnapshot` gains one column:

```prisma
businessStatus PlaceBusinessStatus?   // null = unknown, never "closed"
```

Nullable is load-bearing. Pre-migration rows and all Nominatim results genuinely have no status, and the gate must treat absent data as permission to proceed (§8).

No new timestamp. The existing `fetchedAt` is the status-freshness clock: every `upsertPlaceSnapshot` already bumps it, and after this change every write path carries `businessStatus`.

```prisma
enum AgencyPlaceNoteStatus {
  AVOID        // hard block — staff decided not to use this place
  CLOSED       // staff ground truth, outranks Google
  PREFERRED    // partnership / house favourite
  NEUTRAL      // informational only
}

model AgencyPlaceNote {
  id              String                @id @default(uuid()) @db.Uuid
  agencyId        String                @db.Uuid
  agency          Agency                @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  providerPlaceId String?
  placeName       String
  cityContext     String?
  status          AgencyPlaceNoteStatus @default(NEUTRAL)
  note            String?
  createdByUserId String                @db.Uuid
  createdByUser   User                  @relation(fields: [createdByUserId], references: [id])
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  @@unique([agencyId, providerPlaceId])
  @@index([agencyId, cityContext])
  @@index([agencyId, placeName])
}
```

`providerPlaceId` is nullable so staff can record a note before the place has ever been resolved. Postgres treats NULLs as distinct in unique constraints, so `@@unique([agencyId, providerPlaceId])` permits many un-resolved notes per agency while still preventing duplicate notes for a known place ID.

`onDelete: Cascade` on `agency` matches the convention used by `AgentThread`.

## 4. The gate

New module: `src/services/places/placeGate.ts`.

### 4.1 Contract

```ts
export type BlockReason = "CLOSED_PERMANENTLY" | "AGENCY_AVOID" | "AGENCY_CLOSED";

export type PlaceVerdict =
  | { allowed: true; advisory?: string }
  | { allowed: false; reason: BlockReason; detail: string };

type GateInput = {
  providerPlaceId?: string;
  name: string;
  businessStatus?: PlaceBusinessStatus;
};

export type PlaceGate = {
  /** Single-place check. Synchronous — notes are preloaded. */
  check(place: GateInput): PlaceVerdict;

  /** Bulk split for search results. Preserves input order in `allowed`. */
  partition<T extends GateInput>(results: T[]): {
    allowed: T[];
    blocked: Array<{ result: T; verdict: Extract<PlaceVerdict, { allowed: false }> }>;
  };

  /** Notes relevant to a destination, for the agent context block (§7). */
  notesFor(cityContext?: string): NoteView[];
};

/** Projection handed to the context block — deliberately excludes ids and
 *  authorship, which the model has no use for and which cost tokens. */
export type NoteView = {
  status: AgencyPlaceNoteStatus;
  placeName: string;
  cityContext: string | null;
  note: string | null;
};

export async function createPlaceGate(
  client: PrismaClient,
  agencyId: string | null
): Promise<PlaceGate>;
```

### 4.2 Lifecycle

**One instance per agent run, notes preloaded.** The factory issues a single query for the agency's notes and indexes them in memory. Every subsequent `check` is a synchronous Map lookup — no N+1, no per-place round trip. A single agency's note count is realistically dozens to low hundreds of rows, so loading all of them is cheaper than filtering per call.

`agencyId === null` (personal accounts) yields a gate with an empty note set. `businessStatus` filtering still applies, since it needs no database access.

### 4.3 Precedence

1. Agency `CLOSED` or `AVOID` → blocked. **Staff ground truth wins over Google.** This is the entire justification for the notes layer: Google can list a place as `OPERATIONAL` that an agency's own guide watched shut down last month.
2. Google `CLOSED_PERMANENTLY` → blocked.
3. Google `CLOSED_TEMPORARILY` → allowed, with an advisory. A museum shut for renovation is a legitimate stop for a trip four months out; blocking it would be a regression.
4. `PREFERRED` → allowed, advisory carries the note text.
5. Anything else, including unknown status → allowed.

### 4.4 Matching

Exact `providerPlaceId` first, then lowercased `placeName` optionally narrowed by `cityContext`. An ID match is authoritative and a name match never overrides it — otherwise a note naming "Bayview" would blanket-block every unrelated Bayview in the world.

Name matching normalises case and trims whitespace only. No fuzzy matching: a false positive here silently removes a valid place from planning, which is worse than a miss the gate's second layer catches by ID.

### 4.5 Destination scoping for `notesFor`

`notesFor(cityContext)` returns, in this order:

1. Notes whose `cityContext` matches case-insensitively after trimming.
2. Notes with `cityContext === null` — treated as agency-global and always included.

Notes for other cities are excluded, to keep the context block small. Scoping affects **only** what the agent is *told*; it never affects enforcement. `check()` always consults the agency's full note set regardless of city, so a mis-tagged `cityContext` can never let a blacklisted place through.

## 5. Freshness

### 5.1 Cache TTL

`PLACE_SNAPSHOT_TTL_DAYS`, default **30**, added to `src/config/env.ts`.

Applied as `fetchedAt: { gte: new Date(Date.now() - ttlMs) }` on both `findFirst` calls in `itineraryPlaceResolver.ts` (:128, :214).

Rationale for 30 days: name, address and coordinates are near-static, and closure is the volatile field. Thirty days caps worst-case staleness at a month while preserving most of the existing cache hit rate (documented at roughly $0.04 saved per hit in `docs/google-maps-cost-reduction.md`).

A TTL miss is not a cache purge — the row is re-resolved and upserted, refreshing `businessStatus` as a side effect. This is how historical rows acquire a status without a bulk migration.

### 5.2 Revalidation of saved itineraries

TTL only governs *new* resolutions, so saved trips need their own path. Snapshots past TTL are re-checked **asynchronously, fire-and-forget**: capped at 10 per request, concurrency 3, reusing the worker-queue pattern already proven in `backfillUnenrichedSnapshots` (`placeSnapshotEnrichment.ts:151`).

Trigger point: the two single-itinerary read paths in `itineraryRepository.ts` that hydrate `placeSnapshot` (:300 and :343). Deliberately **not** `listTripsWithItineraries` (:75) — that path selects only `{ id, status, version }` and hydrates no snapshots, so a list view would fan out revalidation across every trip an agency owns for no display benefit.

Chosen over a cron job because it needs no scheduler infrastructure, which matters on Railway.

**Accepted trade-off:** the first load after a closure still renders the stale pin; it is correct from the second load onward. Made explicit because it is the one case where the reported symptom survives this change.

## 6. Saved itineraries: mark, do not mutate

When revalidation finds a saved item's place has closed, the snapshot's `businessStatus` updates and the client badges the item. **The itinerary is not rewritten.**

The advisory block (§7) tells the agent the item is closed and to *offer* a replacement. Staff accept it.

Rationale: silently rewriting a trip a human already reviewed — possibly one already sent to a client — is worse than a clear flag beside it. Hard filtering applies to new place *selection*; saved work keeps a human in the loop.

## 7. Agent context

### 7.1 Caching constraint

`agentContextBuilder.ts:308` documents that variable runtime context is folded into a **user** message specifically so `systemInstruction` stays byte-identical across turns, which is a prerequisite for Gemini `cachedContent` reuse.

Therefore place advisories go through `buildRuntimeContextBlock`, **never** the system prompt. Putting per-agency note text into `buildVoyageSystemPrompt` would silently break prompt caching on every run.

### 7.2 The block

New `buildPlaceAdvisoryBlock()` in `agentContextBuilder.ts`, composed into `buildRuntimeContextBlock` alongside the existing itinerary and task blocks. Destination-scoped and compact:

```
Place advisories for this agency:
- AVOID "Hotel Bayview" (Cebu) — service complaints, stopped booking Mar 2026
- CLOSED "Ristorante Alba" (Rome) — confirmed shut by our guide
- PREFERRED "Casa Marina" (Cebu) — partner rate available

Blocked this run: "Ristorante Alba" (permanently closed) — propose a replacement and say why.
Saved-itinerary items now closed: Day 3 "Ristorante Alba" — offer a swap; do not remove it yourself.
```

Returns `""` when there is nothing to report, matching the existing convention of `buildTaskListBlock` and `buildItineraryIdentifierBlock` so callers can safely `.filter(Boolean).join()`.

### 7.3 Prompt rule

A rule is also added to `buildVoyageSystemPrompt`: never plan around a place flagged closed; when a place is blocked, state the substitution and the reason. This is static text, so it does not disturb caching.

This is belt-and-braces only. Enforcement is the gate's job, deterministically, before the model sees anything. The rule exists so the agent *explains* substitutions well, not so it performs them.

## 8. Error handling

| Condition | Behaviour |
|---|---|
| Notes query fails | Log, proceed with empty note set. Notes are advisory; a DB hiccup must not halt trip planning. `businessStatus` filtering is unaffected — it reads the provider payload, not the DB. |
| `businessStatus` absent (Nominatim, pre-migration rows) | Allow. Never block on missing data. |
| `resolvePlace` returns a blocked place | Tool returns a structured error the agent can act on — not a thrown exception that kills the run. |
| Every search result blocked | Return an empty allowed set plus the blocked list, so the agent can widen its query rather than seeing a bare zero-result response. |
| `CLOSED_TEMPORARILY` | Allowed with advisory. |

The consistent bias is **fail-open on our own infrastructure, fail-closed on confirmed-dead places.** Voyage's own DB being unreachable must never make trips unplannable; a place Google or staff confirm as dead must never reach a plan.

## 9. Wiring points

| File | Change |
|---|---|
| `src/services/maps/googleMaps.ts` | `businessStatus` into all four field masks, including the minimal `resolvePlace` mask at :69 |
| `src/services/maps/parsing.ts` | Parse raw field to typed enum; unrecognised value → `undefined` |
| `src/services/maps/types.ts` | `businessStatus?` on `PlaceSearchResult`, `PlaceDetailsResult`, `ResolvedPlace` |
| `src/services/places/placeGate.ts` | **New.** §4 |
| `src/config/env.ts` | `PLACE_SNAPSHOT_TTL_DAYS`, default 30 (§5.1) |
| `.env.example` | Document the new variable |
| `src/modules/agent/tools/toolUtils.ts` | Persist `businessStatus` in both `create` and `update` branches of `upsertPlaceSnapshot` |
| `src/modules/agent/tools/mapTools.ts` | `partition()` on search/nearby; `check()` on pinpoint/insights |
| `src/modules/agent/tools/itineraryPlaceResolver.ts` | TTL on both cache lookups; gate on resolved places |
| `src/modules/agent/agentContextBuilder.ts` | `buildPlaceAdvisoryBlock()`, composed into `buildRuntimeContextBlock` |
| `src/modules/agent/agentPrompts.ts` | Static prompt rule (§7.3) |
| `src/modules/itineraries/itineraryTypes.ts` | `businessStatus` on the `placeSnapshot` shape |
| `src/services/places/revalidateSnapshots.ts` | **New.** Async TTL revalidation worker (§5.2) |
| `src/modules/itineraries/itineraryRepository.ts` | Fire-and-forget revalidation call on the two snapshot-hydrating reads (:300, :343) |
| `prisma/schema.prisma` + migration | §3 |

`itineraryPlaceResolver.ts` is the load-bearing edit. It calls `maps.resolvePlace` **directly, bypassing the tool layer entirely** — which is precisely why the bug reaches saved itineraries and why per-tool filtering (the rejected Approach 2) would not have fixed it.

`itineraryRepository.ts:40` uses `include: { placeSnapshot: true }`, so the new column reaches the client automatically once `ItineraryItemRecord` declares it — no repository change is needed *for the column itself*. The repository edit listed above is solely the §5.2 revalidation trigger.

### 9.1 Client

The reported symptom is *"the place doesn't exist but the map still shows it open."* Server changes alone make that data available without making it visible, so the client badge is **in scope** — without it, the saved-itinerary case (§6) is not actually fixed for the person looking at the screen.

`Voyage-Client` has its own single choke point that mirrors the server gate: `buildPlaceEntities` in `app/lib/trip-dashboard/placeEntities.js:51` normalizes both itinerary items and live map markers into one entity shape, which every downstream consumer reads.

| File | Change |
|---|---|
| `app/lib/trip-dashboard/placeEntities.js` | Carry `businessStatus` through both `addUniquePlace` calls (:65 itinerary, :89 live marker) |
| `app/lib/stream/normalizers.js` | Preserve `businessStatus` on streamed markers |
| `app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx` | Distinct pin treatment for closed places |
| `app/components/trip-dashboard/mobile/CompactPlaceCard.jsx` | "Permanently closed" badge |
| `app/components/trip-dashboard/mobile/PlaceDetailSheet.jsx` | "Permanently closed" badge |

Adding the field at `placeEntities.js` is what makes the rest cheap; each component then reads one already-normalized property.

Badge treatment: text label, not colour alone — the same place may be a legitimate historical record in a past trip, and colour-only signalling fails both accessibility and print/PDF export (`app/lib/pdfExport.js` reads snapshots too).

## 10. Testing

| Suite | Coverage |
|---|---|
| `tests/mapsProvider.test.ts` (existing) | All four field masks request `businessStatus`; each enum value parses; missing field → `undefined`; unrecognised value → `undefined` |
| `tests/placeGate.test.ts` (new) | Precedence: agency `CLOSED` beats Google `OPERATIONAL`; ID match beats name match; `CLOSED_TEMPORARILY` allowed; unknown allowed; empty notes fail-open; `partition` preserves order; `agencyId: null` still filters on Google status |
| `tests/placeSnapshotTtl.test.ts` (new) | Fresh row hits cache; row past TTL does not; TTL boundary is inclusive per `gte`; re-resolution refreshes `businessStatus` |
| `tests/itineraryService.test.ts` (existing) | A closed place never lands in a built itinerary |
| `tests/agentOrchestrator.test.ts` (existing) | Advisory block appears in the user message, **not** in `systemInstruction` — the caching regression guard for §7.1 |

Run with `npm test` (vitest) in `Voyage-Server`.

Client side, in `Voyage-Client` (also vitest):

| Suite | Coverage |
|---|---|
| `tests/placeEntities.test.js` (new or extended) | `businessStatus` survives `buildPlaceEntities` for both the itinerary path and the live-marker path; absent status stays `undefined` rather than becoming a falsy badge |

## 11. Boundary with the deferred RAG spec

`2026-05-28-rated-itinerary-reuse-picker-design.md` defers an agent RAG feature (`search_rated_history`) over the agency's rated past trips. That is a **discovery** feature: recall-oriented, subjective, semantic, and top-k is appropriate.

This spec is a **correctness** filter: precision-oriented, factual, exhaustive, and top-k is disqualifying. The two must not be merged into one retrieval layer, because they have opposite failure tolerances — missing a suggestion is a mild disappointment, while missing a closure puts a client at a locked door.

If `search_rated_history` is built later, it must run its candidates through this gate before returning them. A past itinerary is exactly the kind of source that recommends places which have since closed.

## 12. Open questions

None blocking. Deferred by choice:

- Staff CRUD UI for `AgencyPlaceNote` (model and gate ship first; notes can be seeded directly until then).
- Whether `PREFERRED` should actively bias the agent's ranking rather than only annotate. Annotation only, for now.
- Opening-hours-aware scheduling.
