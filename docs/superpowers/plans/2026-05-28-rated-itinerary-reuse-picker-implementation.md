# Rated Itinerary Reuse Picker — Implementation Plan

**Date:** 2026-05-28
**Spec:** [2026-05-28-rated-itinerary-reuse-picker-design.md](../specs/2026-05-28-rated-itinerary-reuse-picker-design.md)
**Branches:** `feat/rated-history-picker` on both Voyage-Server and Voyage-Client (branched from the current `staging`)

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) for fresh-subagent-per-task dispatch with two-stage review, or superpowers:executing-plans for inline batch execution. Task steps in this plan are stage briefs (precedent: the agency-dashboard plan), not bite-sized TDD steps — each subagent receives a self-contained brief and produces a complete diff.

**Goal:** Let agency staff drag stops, whole days, or multi-day segments from the agency's high-rated past trips (`TripReview.rating ≥ 4`) into the current draft itinerary, via three entry points (editor button, client itinerary page button, `/reuse` slash in the agent thread).

**Architecture:** New standalone `ratedHistory` module on the server (mirrors the dashboard module precedent) with three endpoints; new `ratedHistory` component set on the client with a side-panel picker, two drag-aware hooks, and three thin entry-point wrappers. Server is authoritative for date re-anchoring, ID generation, PII stripping, and optimistic concurrency via `Itinerary.version`.

**Tech stack:** Voyage-Server is Express + Prisma + Postgres, Vitest for tests (tests live at `Voyage-Server/tests/*.test.ts`). Voyage-Client is Next.js (App Router) + React + Tailwind. The agent canvas lives at `Voyage-Client/app/components/agent/itinerary/ItineraryCanvas.jsx`; the trip-dashboard floating draft lives at `Voyage-Client/app/components/trip-dashboard/itinerary/ItineraryDraftPanel.jsx`; the agent composer lives at `Voyage-Client/app/components/trip-dashboard/command-center/AgentCommandCenter.jsx`.

---

## How to read this plan

Work is **staged**. Within each stage, tasks listed under **Parallel groups** can be dispatched in a **single message** with multiple `Agent` tool calls.

Between stages there is a **gate** — a hard dependency that must be verified before the next stage begins. Do not start a stage until its gate condition is confirmed.

### Model tier guide

| Tier | Use for |
|---|---|
| **Haiku 4.5** | Mechanical / scaffolding: small components, simple buttons, plain Zod schemas, fetch hooks, season/date helpers |
| **Sonnet 4.6** | Moderate implementation: Prisma queries, REST endpoints with validation, picker UI components, integration tests, a11y audits |
| **Opus 4.6** | Complex / cross-cutting: date re-anchoring math + copy semantics, drag-and-drop drop-target logic across two surfaces, composer-interception slash command flow |
| **Opus 4.7** | Reserve for genuine reasoning depth. Not used in this plan — every hard task fits in Opus 4.6's envelope. |

Default rule: pick the lowest tier that gets it done. Each task below specifies its tier explicitly.

### Subagent brief template

Every dispatch uses this template:

> **Repo:** [server / client]
> **Branch:** `feat/rated-history-picker` (already created from `staging`)
> **Spec:** `Voyage-Server/docs/superpowers/specs/2026-05-28-rated-itinerary-reuse-picker-design.md` — read sections X.Y
> **Scope:** [bounded list of files to touch]
> **Out of scope:** [explicit exclusions so the agent doesn't drift]
> **Deliverables:** [files created/modified, tests passing, command output]
> **Verification:** [exact command to run before reporting done]
> **Report format:** diff summary + verification command output, capped to 300 lines

Trust-but-verify: after every agent run, the main thread reads the actual diff before marking the task done.

---

## File structure (locked in before task decomposition)

### Server (`Voyage-Server`)

| File | Responsibility |
|---|---|
| `src/modules/ratedHistory/ratedHistoryRoutes.ts` | Express router; two routers exported — one for `/agencies/:agencyId/rated-history` (list + detail), one for `/trips/:tripId/itinerary` (insert) |
| `src/modules/ratedHistory/ratedHistoryService.ts` | Source-itinerary selection rule, copy semantics, date re-anchoring, validation, optimistic concurrency |
| `src/modules/ratedHistory/ratedHistoryRepository.ts` | Prisma access: rated-trip query with TripReview join, source-itinerary lookup, transactional insertion |
| `src/modules/ratedHistory/ratedHistorySchemas.ts` | Zod schemas for query params + request body + response |
| `src/modules/ratedHistory/ratedHistoryTypes.ts` | TypeScript DTOs (`RatedTripSummary`, `RatedItinerary`, `InsertSelection`, `InsertTarget`) |
| `src/modules/ratedHistory/ratedHistoryErrors.ts` | Typed errors: `SourceNotFoundError`, `SameAgencyViolationError`, `MalformedSelectionError`, `StaleVersionError`, `MissingStartDateAdvisory` |
| `src/modules/ratedHistory/seasonHelper.ts` | Pure function `startDateToSeason(date: Date | null): Season \| null` (northern-hemisphere defaults) |
| `src/app.ts` | Mount `ratedHistoryListRoutes` at `/agencies/:agencyId/rated-history`; mount `ratedHistoryInsertRoutes` at `/trips/:tripId/itinerary` |
| `tests/ratedHistoryService.test.ts` | Unit tests: selection rule, re-anchoring, PII strip, ID regen, validation |
| `tests/ratedHistoryRoutes.test.ts` | Integration tests: all three endpoints, all status codes |
| `tests/seasonHelper.test.ts` | Unit tests for the helper |

### Client (`Voyage-Client`)

| File | Responsibility |
|---|---|
| `app/components/ratedHistory/RatedHistoryPicker.jsx` | Side-panel container; owns open/closed state, filter state, currently-expanded trip state |
| `app/components/ratedHistory/RatedTripList.jsx` | List of trip summaries with rating + meta; click expands |
| `app/components/ratedHistory/RatedTripExpanded.jsx` | Day-by-day view inside an expanded list row |
| `app/components/ratedHistory/RatedDayCard.jsx` | Day header with drag handle + "Select range" toggle |
| `app/components/ratedHistory/RatedItemRow.jsx` | Item row with drag handle (`⋮⋮`) |
| `app/components/ratedHistory/EmptyRatedState.jsx` | Empty-pool messaging |
| `app/components/ratedHistory/hooks/useRatedHistory.js` | SWR-style fetch hook, agency-scoped cache |
| `app/components/ratedHistory/hooks/useReuseDrop.js` | Drop-target registration + highlight overlays for both editor surfaces |
| `app/components/ratedHistory/entryPoints/ReuseButton.jsx` | Button used by the editor toolbar AND the client itinerary page |
| `app/components/ratedHistory/entryPoints/ReuseSlashCommand.jsx` | Composer interceptor + inline picker for the agent thread |
| `app/components/agent/itinerary/ItineraryCanvas.jsx` | Modified: receive drop-target overlays from `useReuseDrop` |
| `app/components/trip-dashboard/itinerary/ItineraryDraftPanel.jsx` | Modified: dock-mode when picker open, suppress self-drag |
| `app/components/trip-dashboard/command-center/AgentCommandCenter.jsx` | Modified: register `<ReuseSlashCommand>` on the composer textarea |
| `tests/ratedHistoryPicker.test.jsx` | Component tests for the picker + filters |
| `tests/useReuseDrop.test.jsx` | Hook tests for drop-target highlighting + drop event payload |
| `tests/reuseSlashCommand.test.jsx` | Composer interception + system-visible recap |

---

## Stage 0 — Pre-flight (main thread, sequential)

Single sequential task; no subagents.

1. Confirm `feat/rated-history-picker` branch exists on both repos (create from `staging` if not).
2. Re-read the spec end-to-end. Note any ambiguity now and amend the spec before dispatching agents — agents won't ask, they'll guess.
3. Confirm the open questions in spec §11 remain open (they stay open through implementation; the plan does not resolve them).
4. Confirm the model selection rubric: Haiku for mechanical, Sonnet for standard, Opus 4.6 for the hard correctness tasks. No Opus 4.7 dispatches in this plan.

**Gate to Stage 1:** Spec is unambiguous; both branches clean; subagent brief template understood.

---

## Stage 1 — Server foundation (1 subagent)

### 1 · Module skeleton + schemas + 501 stubs — **Sonnet 4.6**

Create the entire module skeleton with empty implementations that compile and return 501 from each endpoint. Wire mounts into `app.ts`. Add Zod schemas and TypeScript types.

**Scope (server):**
- Create `src/modules/ratedHistory/ratedHistoryRoutes.ts` — export two routers: `ratedHistoryListRoutes` (handles `GET /` and `GET /:tripId`) and `ratedHistoryInsertRoutes` (handles `POST /:tripId/insert-from-rated`). Each route handler returns `response.status(501).json({ error: 'Not implemented' })`.
- Create `src/modules/ratedHistory/ratedHistorySchemas.ts` — Zod schemas per spec §5.1, §5.2, §5.3 (query params for list, path param for detail, request body for insert with discriminated `selection` union).
- Create `src/modules/ratedHistory/ratedHistoryTypes.ts` — `RatedTripSummary`, `RatedItinerary`, `RatedItineraryDay`, `RatedItineraryItem`, `InsertSelection` (union), `InsertTarget`, `InsertResult`.
- Create `src/modules/ratedHistory/ratedHistoryErrors.ts` — five typed errors per spec §8 (`SourceNotFoundError` → 404/410 depending on cause, `SameAgencyViolationError` → 403, `MalformedSelectionError` → 400, `StaleVersionError` → 409, `MissingStartDateAdvisory` → flag in 200 response not a status code; document as a non-thrown advisory).
- Create empty `src/modules/ratedHistory/ratedHistoryService.ts` and `ratedHistoryRepository.ts` exporting placeholder functions that `throw new Error('not implemented')`. Real implementation lands in Stage 3.
- Create `src/modules/ratedHistory/seasonHelper.ts` exporting `startDateToSeason` returning `null` for now (Stage 2 fills it in).
- Modify `src/app.ts`:
  - Import both routers.
  - Mount: `app.use("/agencies/:agencyId/rated-history", ratedHistoryListRoutes)`.
  - Mount: `app.use("/trips/:tripId/itinerary", ratedHistoryInsertRoutes)`.

**Out of scope:** any business logic; tests beyond `npx tsc --noEmit` passing; client work.

**Deliverables:** all files created; `npx tsc --noEmit` clean; `curl http://localhost:PORT/agencies/00000000-0000-0000-0000-000000000000/rated-history` returns 501 (with auth cookie); same for the other two routes.

**Verification:** `npx tsc --noEmit` from `Voyage-Server/`, then start server and curl all three routes returning 501.

**Gate to Stage 2:**
- Server: TypeScript clean. Routes wired. Stubs return 501.
- Branch committed locally.

---

## Stage 2 — Server pure helpers (parallel × 2)

Two completely independent pieces. Dispatch in one message.

### 2A · Season helper — **Haiku 4.5**

Implement `src/modules/ratedHistory/seasonHelper.ts` and its tests.

**Scope (server):**
- `startDateToSeason(date: Date | null): 'spring' | 'summer' | 'fall' | 'winter' | null` — northern-hemisphere defaults:
  - `null` input → `null`
  - Month 3–5 → `spring`; 6–8 → `summer`; 9–11 → `fall`; 12, 1, 2 → `winter`
- Create `tests/seasonHelper.test.ts` covering: null input, each season boundary month, leap-day edge case.

**Out of scope:** any DB or service integration.

**Verification:** `npx vitest run tests/seasonHelper.test.ts` — all tests pass.

### 2B · Repository layer — **Sonnet 4.6**

Implement `src/modules/ratedHistory/ratedHistoryRepository.ts`. Pure Prisma access — no HTTP concerns, no validation.

**Scope (server):**
- `listRatedTrips({ agencyId, destination?, durationDays?, season?, page, pageSize })`:
  - Find `TripReview` rows where `agencyId = :agencyId AND rating >= 4`, joined to `ClientTrip` (eager-load).
  - Filter on `ClientTrip.destinationSummary` (case-insensitive `contains`) if `destination` provided.
  - Filter on `endDate - startDate + 1` if `durationDays` provided (compute in app code from rows OR via raw SQL `DATE_PART`).
  - Filter on `season` derived via the helper.
  - Order by `TripReview.submittedAt DESC`. Paginate.
  - Return: array of `{ tripId, title, destinationSummary, dayCount, startDate, endDate, rating, ratedAt }`. `dayCount` is `ItineraryDay` count on the most recent itinerary (see selection rule in 3B).
  - Exclude trips with zero itineraries (LEFT JOIN to count days; filter out 0).
- `getSourceItinerary(tripId)`:
  - Apply the selection rule (spec §6.1): `WHERE tripId = :tripId ORDER BY (status = 'APPROVED_INTERNAL') DESC, updatedAt DESC LIMIT 1`. Include days + items + placeSnapshot.
  - Returns `null` if no itinerary exists.
- `insertItemsTransactional({ targetItineraryId, ifMatchVersion, insertions })`:
  - Open a Prisma `$transaction`.
  - Re-fetch `Itinerary` with `version` field; if `version !== ifMatchVersion`, throw `StaleVersionError`.
  - For each insertion, create new `ItineraryDay` (if kind=day/segment) or new `ItineraryItem` (if kind=item) with the prepared payload. Re-number affected `dayNumber` values. Re-compute `sortOrder` slots on affected days.
  - Increment `Itinerary.version`.
  - Return updated itinerary (days + items + placeSnapshots).
- Use Prisma's `select`/`include` to keep payloads tight.

**Out of scope:** copy semantics decisions (which fields to strip / clear / regen) — that's the service layer's job. The repository just persists what the service hands it.

**Deliverables:** repository functions with full type signatures matching the DTOs from Stage 1.

**Verification:** `npx tsc --noEmit` clean. No tests yet — repository will be exercised by service tests in Stage 3.

**Gate to Stage 3:**
- Both 2A and 2B committed locally.
- TypeScript clean across server.

---

## Stage 3 — Server service + routes (1 subagent)

### 3 · Service implementation + route wiring + unit tests — **Opus 4.6**

The complex stage. Source-itinerary selection rule lives here in the service layer (repository helpers call it but the rule is service-owned). Copy semantics (PII strip, route clear, ID regen), date re-anchoring math, selection validation, optimistic-concurrency wiring. Replace the 501 stubs with real handlers.

**Scope (server):**
- `src/modules/ratedHistory/ratedHistoryService.ts`:
  - `listRatedHistory({ agencyId, filters, page, pageSize })` — delegates to repo, formats response per §5.1.
  - `getRatedItinerary({ agencyId, tripId })`:
    - Repo call to get source itinerary.
    - Validate the rated trip belongs to `agencyId`; throw `SameAgencyViolationError` if not.
    - Throw `SourceNotFoundError` if the trip exists but has zero itineraries OR the trip was deleted (`410`).
    - Strip `clientNotes` from each item before returning (PII; never crosses this boundary).
    - Return shape per §5.2.
  - `insertFromRated({ callerAgencyId, targetTripId, sourceTripId, selection, target, ifMatchVersion })`:
    - Validate caller has write access (rely on existing trip-access middleware before this handler runs).
    - Validate source trip belongs to `callerAgencyId`; same for target.
    - Validate selection per §5.3:
      - `kind=item`: all `itemIds` belong to the same source `ItineraryDay`.
      - `kind=segment`: all `dayIds` form a consecutive `dayNumber` range in the source itinerary.
      - `kind=day`: each `dayId` exists in the source.
    - For each selected item or day, build the copy payload using §6.2 / §6.3 rules:
      - Item: regen `id`, regen `itineraryDayId` (per target day), reassign `sortOrder`, preserve `type`/`title`/`description`/`startTime`/`endTime`/`placeSnapshotId`/`staffNotes`, **null** `clientNotes`, **null** `routeFromPrevious`.
      - Day: regen `id`, reassign `dayNumber` based on `target.dayIndex` (and renumber downstream days), re-anchor `date` to `targetItinerary.trip.startDate + (newDayNumber - 1) days` or `null` if no `startDate`, preserve `title`/`summary`, recursively copy items.
    - Hand prepared payload to `insertItemsTransactional`.
    - If target trip has no `startDate`, attach a `missingStartDateAdvisory: true` field to the response (200, not an error).
    - Catch `Prisma.PrismaClientKnownRequestError` for FK violations from a concurrently-deleted source → throw `SourceNotFoundError` mapped to 410.
- `src/modules/ratedHistory/ratedHistoryRoutes.ts`:
  - Replace 501 stubs in all three routes.
  - Apply existing `requireAuth` middleware + agency-membership check (mirror `dashboardRoutes` pattern at `Voyage-Server/src/modules/dashboard/dashboardRoutes.ts`).
  - For the insertion route, additionally apply trip-write-access check (find existing helper via grep on `requireTripWriteAccess` or equivalent; if none exists, inline the agency-membership check + verify `assignedOrganizerUserId === caller.id OR caller.role IN ['OWNER', 'ADMIN']`).
  - Map typed errors to status codes per spec §5.3:
    - `MalformedSelectionError` → 400
    - `SameAgencyViolationError` → 403
    - `SourceNotFoundError` → 404 (or 410 if `reason === 'deleted'`)
    - `StaleVersionError` → 409
- `tests/ratedHistoryService.test.ts`:
  - Source-itinerary selection rule: APPROVED_INTERNAL preferred even when older; fallback to most-recent any-status; `null` when zero itineraries.
  - Date re-anchoring: each new day's `date = targetStart + (newDayNumber - 1) days`; `null` `targetStart` → all dates `null`.
  - Selection validation: `kind=item` rejects mixed-day item IDs; `kind=segment` rejects non-consecutive day numbers; `kind=day` accepts arbitrary day IDs.
  - ID regeneration: copies have new UUIDs; source unchanged.
  - PII strip: `clientNotes` null on every copied item.
  - `routeFromPrevious` cleared on every copied item.
  - `placeSnapshotId` preserved (not regenerated).
  - Cross-agency rejection: `getRatedItinerary` and `insertFromRated` both throw `SameAgencyViolationError` when source trip belongs to a different agency.
  - Concurrency: stale `ifMatchVersion` → `StaleVersionError`; up-to-date version increments by 1.
  - Use Vitest, follow the pattern of `tests/dashboardService.test.ts` (mock the repository where convenient; otherwise use the existing test DB setup if there is one).

**Out of scope:** integration tests (Stage 7A); any client work.

**Deliverables:** service + routes + comprehensive unit tests passing.

**Verification:**
- `npx tsc --noEmit` clean.
- `npx vitest run tests/ratedHistoryService.test.ts` — all unit tests pass.
- `curl http://localhost:PORT/agencies/<seeded-agency>/rated-history` with auth cookie returns a list payload of the expected shape.

**Gate to Stage 4:**
- All three endpoints respond with real data against the dev DB.
- Service tests green.
- Committed locally.

---

## Stage 4 — Client picker UI components (parallel × 3)

Three independent component groups. Dispatch in one message.

### 4A · Picker shell + filters + empty state — **Sonnet 4.6**

The outer container, the filter chip row, and the empty-state component. Owns picker state (open/closed, filter values, currently-expanded trip ID, selection set).

**Scope (client):**
- Create `app/components/ratedHistory/RatedHistoryPicker.jsx`:
  - Props: `isOpen`, `onClose`, `currentTrip` (destinationSummary), `mode: 'editor' | 'clientItinerary' | 'slash'`, `agencyId`, `onConfirmInsertions(payload)`.
  - Layout: 440px right-edge panel on desktop, full-width drawer on mobile (use Tailwind `md:` breakpoints).
  - Header: title "Rated history", close button, filter chip row.
  - Body: scrolling content slot — renders `<RatedTripList>` from 4B.
  - Filter state: `destination`, `durationDays`, `season`. `destination` defaults to `currentTrip.destinationSummary`; a "Show all rated" toggle clears it.
  - Empty pool → renders `<EmptyRatedState>`.
  - Animations per spec §10: 320ms slide-in with `cubic-bezier(0.4, 0, 0.2, 1)`. Respect `prefers-reduced-motion` (opacity-only transition).
- Create `app/components/ratedHistory/EmptyRatedState.jsx`:
  - Static component, copy per spec §7.1: "No rated trips yet. Once travelers rate trips ≥4★, those itineraries appear here for reuse."

**Out of scope:** 4B's list, 4C's day/item rows, the hooks (Stage 5), entry points (Stage 6).

**Deliverables:** picker shell renders correctly with empty body when no list provided; passes a11y baseline (`role="dialog"`, `aria-modal="true"`, focus trap, Escape closes).

**Verification:** mount `<RatedHistoryPicker isOpen={true} onClose={() => {}} currentTrip={{destinationSummary:'Tokyo'}} mode="editor" agencyId="..." />` in a scratch page; verify slide-in animation, focus trap, Esc closes, mobile layout reflows correctly.

### 4B · List + expansion — **Sonnet 4.6**

The trip-row list with click-to-expand behavior.

**Scope (client):**
- Create `app/components/ratedHistory/RatedTripList.jsx`:
  - Props: `trips`, `expandedTripId`, `onTripToggle(tripId)`, `selection`, `onSelectionChange`.
  - Renders one row per trip: title · destination · day count · `MMM YYYY` trip month · `★N/5`.
  - Click row → `onTripToggle`. Expanded row renders `<RatedTripExpanded>` from 4B (inline below the row).
  - Star display: filled stars for the rating, outline for the rest. Use existing `<StarRating>` component if present (memory references it in the dashboard work); otherwise inline simple SVG stars.
  - Keyboard: rows are `<button>` elements; Enter/Space toggle expansion.
- Create `app/components/ratedHistory/RatedTripExpanded.jsx`:
  - Props: `itinerary`, `selection`, `onSelectionChange`.
  - Fetches its own data via `useRatedHistory().getDetail(tripId)` (the hook from 5A; for this stage, accept the data as a prop and let the parent fetch).
  - Renders `<RatedDayCard>` (from 4C) for each day.
  - Shows a small "Draft" badge for itineraries whose source is `status === 'DRAFT'` (per spec §11 open question 5: v1 includes drafts).

**Out of scope:** drag handles (4C owns those); fetching (5A owns that).

**Deliverables:** list renders correctly with fixture data; clicking a row expands inline; only one row expanded at a time.

**Verification:** mount with a fixture of three trips, two with day-by-day data and one without itinerary; assert click behavior and proper "Draft" badge rendering on a draft-status fixture.

### 4C · Draggable day cards + item rows — **Sonnet 4.6**

The leaf components that carry the drag handles.

**Scope (client):**
- Create `app/components/ratedHistory/RatedDayCard.jsx`:
  - Props: `day` (with `id`, `dayNumber`, `title`, `date`, `summary`, `items`), `selection`, `onSelectionChange`.
  - Header: `⋮⋮` drag handle on the left (cursor `grab`, native `draggable={true}`), "Day {dayNumber} · {title}" label, "Select range" toggle on the right.
  - When "Select range" toggle is on, day headers in this list become checkboxes; multiple consecutive days can be selected. The component publishes the consecutive-range constraint by visually showing a "non-consecutive" error if the user checks non-adjacent days (UI prevents the bad submission).
  - Body: list of `<RatedItemRow>`s for each item.
  - On dragstart from the day handle: set `dataTransfer.setData('application/x-voyage-reuse', JSON.stringify({ kind: 'day', dayIds: [day.id] }))`. The cursor + ghost are handled by `useReuseDrop` (Stage 5B).
  - Multi-day segment dragstart: when range mode active and ≥2 consecutive days selected, drag handle on any selected day publishes `{ kind: 'segment', dayIds: [...] }`.
- Create `app/components/ratedHistory/RatedItemRow.jsx`:
  - Props: `item` (full shape from spec §5.2), `dayId`, `selection`, `onSelectionChange`.
  - Left edge: `⋮⋮` drag handle.
  - Row: time label (`startTime - endTime`), title, description (truncated to 2 lines).
  - On dragstart: `dataTransfer.setData('application/x-voyage-reuse', JSON.stringify({ kind: 'item', itemIds: [item.itemId], sourceDayId: dayId }))`.

**Out of scope:** drop-target logic (5B); the panel chrome (4A); the list scaffolding (4B).

**Deliverables:** day cards and item rows render with handles; native HTML5 drag fires `dragstart` with the correct payload; range-select toggle prevents non-consecutive selections.

**Verification:** mount with fixture data; simulate `dragstart` and assert `dataTransfer.getData('application/x-voyage-reuse')` payload shape for each kind.

**Gate to Stage 5:**
- All three components render in isolation with prop fixtures.
- TypeScript / JSX lint clean.
- Committed locally.

---

## Stage 5 — Client data + drag hooks (parallel × 2)

### 5A · `useRatedHistory` fetch hook — **Haiku 4.5**

SWR-style fetch hook with agency-scoped cache.

**Scope (client):**
- Create `app/components/ratedHistory/hooks/useRatedHistory.js`:
  - Inputs: `{ agencyId, filters }` where `filters = { destination?, durationDays?, season? }`.
  - Returns `{ trips, isLoading, hasMore, loadMore, getDetail(tripId), error }`.
  - List endpoint: `GET /agencies/:agencyId/rated-history?destination=&durationDays=&season=&page=&pageSize=`. Paginate with `page`/`pageSize` (20 default).
  - Detail: `getDetail(tripId)` fetches `GET /agencies/:agencyId/rated-history/:tripId` lazily on first call per `tripId`. Cache results in a `Map` keyed by `tripId`.
  - In-memory cache scoped to `agencyId`; cleared when `agencyId` changes.
  - Use `useEffect` + `fetch`; no external SWR library (the repo doesn't pull SWR for the dashboard either — confirm by grep). If grep shows SWR is in deps, use it.
- Cookies forwarded automatically (same-origin).

**Out of scope:** insertion endpoint (5B's drop handler calls it directly); error UI (the picker shell handles it).

**Deliverables:** hook returns paginated trips; detail call cached; filter changes refetch.

**Verification:** unit-test the hook with `fetch` mocked; assert paginated calls and detail caching.

### 5B · `useReuseDrop` drop-target hook + insertion call — **Opus 4.6**

The hard one. Drop-target registration on both editor surfaces, drop-zone highlighting, ghost rendering, keyboard fallback, insertion API call.

**Scope (client):**
- Create `app/components/ratedHistory/hooks/useReuseDrop.js`:
  - API: `useReuseDrop({ targetTripId, targetItineraryId, currentVersion, onInserted(updated, advisory) })` returns `{ dropTargets, registerCanvas, registerPanel, isDragging }`.
  - `registerCanvas(ref)` — attaches `dragover` / `drop` listeners to the `ItineraryCanvas` DOM node. Inserts overlay `<div>`s for drop zones (between days, between items in a day, on day headers).
  - `registerPanel(ref)` — same for `ItineraryDraftPanel`'s inner timeline; additionally toggles "dock mode" on the panel (suppresses its position-drag while `isDragging`).
  - On `dragover`: compute the nearest valid drop zone given the payload's `kind` (day-typed payloads only target between-days; item-typed payloads target between-items and on day headers; segment payloads same as day). Highlight that zone with `--accent-soft` 4px bar.
  - On `drop`: parse `dataTransfer.getData('application/x-voyage-reuse')`. Compute `target.dayIndex` and optional `target.position`. Call `POST /trips/:targetTripId/itinerary/insert-from-rated` with `{ sourceTripId, selection, target, ifMatchVersion: currentVersion }`. On 200, invoke `onInserted(updatedItinerary, advisory)`. On 409, toast "Itinerary changed — please refresh" and trigger parent refetch. On 410, toast "Source trip was removed" + clear that trip from the list cache. On 403, toast "Insertion not allowed". On 422, toast "Trip has no start date — added days don't have dates yet" but treat as success.
  - Keyboard fallback: expose a `getKeyboardTargets(payload)` function that returns `[{ dayIndex, position?, label }]` for the "Move to…" menu. Day-typed selections produce `[{ dayIndex: 0, label: "Top" }, ...{ dayIndex: N, label: "After Day N" }]`. Item-typed selections enumerate every (day, position) slot.
  - Drop animation per spec §10: ghost rotation 4°, soft shadow; 1.2s `--accent-soft` afterglow on inserted items (target node temporarily wrapped with an animated class).
- Modify `app/components/agent/itinerary/ItineraryCanvas.jsx`:
  - Accept a `reuseDropRef` prop. Forward it to the outer container `<div>` (line 37). The hook attaches listeners via that ref.
- Modify `app/components/trip-dashboard/itinerary/ItineraryDraftPanel.jsx`:
  - Accept a `reuseDropRef` prop. Forward it to the inner timeline `<div>` (around line 138).
  - Accept a new `dockMode` prop. When `true`, set `transform: translate(0, 0)` and add CSS class `pointer-events-auto cursor-default` to the drag handle; show a small "Pinned while picker open" pill below the title.

**Out of scope:** any picker UI changes (4A–4C own those); the slash command (6C).

**Deliverables:** `useReuseDrop` fully functional against the two surfaces; drop highlights render; insertion API call wired with full error mapping; keyboard fallback returns valid target list.

**Verification:**
- `tests/useReuseDrop.test.jsx`: mock `fetch`, simulate drag events, assert drop-zone calculation (between vs on vs invalid), assert insertion payload shape, assert error toasting for each error code.
- Manual: in a dev session, drag from a picker fixture into the canvas; observe highlights and successful insertion.

**Gate to Stage 6:**
- Both hooks committed locally; tests green where applicable.
- Manual smoke: end-to-end drag from picker fixture into `ItineraryCanvas` produces an inserted day with re-anchored date.

---

## Stage 6 — Entry points (parallel × 3)

### 6A · Editor button — **Haiku 4.5**

Single button placement in the itinerary editor toolbar.

**Scope (client):**
- Create `app/components/ratedHistory/entryPoints/ReuseButton.jsx`:
  - Props: `agencyId`, `currentTrip`, `mode: 'editor' | 'clientItinerary'`, `onOpen()`, `count` (badge).
  - Renders a button with label "Reuse from rated trips" and a small badge for `count`. Disabled state when `count === 0` with tooltip "No rated trips yet".
  - Styling matches existing toolbar buttons — grep the editor toolbar for the button pattern.
- Locate the itinerary editor toolbar: search for `ItineraryHeader.jsx` (`Voyage-Client/app/components/trip-dashboard/pages/ItineraryHeader.jsx`) and add `<ReuseButton mode="editor" ... />` to the action row.
- Wire to open `<RatedHistoryPicker>` via local state in the parent page component (`Voyage-Client/app/agency/[agencyId]/trip/[tripId]/page.jsx` or the surrounding layout).
- `count` is fetched via `useRatedHistory({ agencyId, filters: {} })` returning `trips.length` and `hasMore` — show `N` or `N+` when more pages exist.

**Out of scope:** the picker itself; insertion logic.

**Deliverables:** button visible in editor toolbar; clicking opens the picker; disabled+tooltip when pool empty.

**Verification:** open the editor route in dev, click the button, picker slides in.

### 6B · Client itinerary page button — **Haiku 4.5**

Same `<ReuseButton>` placed in the client itinerary page actions row.

**Scope (client):**
- Locate the staff-internal "client itinerary" page. Grep for `clientItinerary` or `/itinerary/view/[token]` not — that's the public view. The staff view likely lives at a path like `app/agency/[agencyId]/trip/[tripId]/itinerary/page.jsx` or similar. Confirm exact path before editing.
- Add `<ReuseButton mode="clientItinerary" ... />` to the page actions row.
- Wire to the same `RatedHistoryPicker` instance pattern as 6A.

**Out of scope:** picker; insertion; toolbar (6A).

**Deliverables:** button visible in client itinerary page; opens picker on click.

**Verification:** navigate to a trip's client itinerary page in dev, click the button, picker opens.

### 6C · Slash command in agent thread — **Opus 4.6**

The most involved entry point. Composer interception, autocomplete dropdown for `/`, picker rendered as floating sheet above the composer, confirm flow, `SYSTEM_VISIBLE` recap message posting.

**Scope (client):**
- Create `app/components/ratedHistory/entryPoints/ReuseSlashCommand.jsx`:
  - Props: `composerInputRef`, `composerValue`, `onComposerChange(value)`, `tripId`, `agencyId`, `onMessagePosted(message)`.
  - Watches `composerValue`. When it starts with `/` (and only `/`), render an autocomplete dropdown above the composer listing one entry: `reuse — Insert items from a rated past trip`.
  - When the user picks `reuse` (click or Enter), clear the composer, open the picker as a floating sheet anchored above the composer (440px wide).
  - Picker confirm flow: in slash mode the picker's selection is committed via "Add to this trip" buttons next to each selectable item / day / segment (not drag). On confirm, call `POST /trips/:tripId/itinerary/insert-from-rated`.
  - After successful insertion, call `onMessagePosted` with a `SYSTEM_VISIBLE` message:
    ```
    {
      role: 'SYSTEM_VISIBLE',
      content: `Added to itinerary: Day {sourceDay} from "{sourceTripTitle}" ({itemCount} stops). Anchored to your trip as Day {newDay}.`,
      metadata: { kind: 'reuse-recap', sourceTripId, insertedDayIds, insertedItemIds }
    }
    ```
  - Mid-message slashes (e.g., user typed `"Use this plan /reuse"`) MUST pass through as plain text — only parse `/` at index 0 (or following only-whitespace).
  - Optional comment field on the confirm sheet: "Add a note (optional)" — appended to the recap content if filled.
- Modify `app/components/trip-dashboard/command-center/AgentCommandCenter.jsx`:
  - Around the composer textarea (lines 229–247 contain `handleKeyDown` and `submitComposer`), render `<ReuseSlashCommand>` adjacent to the textarea.
  - `submitComposer` (line 239): before dispatching to the agent, check if `<ReuseSlashCommand>` consumed the input. The slash component owns its own opening; the composer behaviour is unchanged for non-slash input.
  - On `onMessagePosted` from the slash component, append the system-visible message to the local `messages` state (use whatever existing helper the parent already passes for inserting messages — if none, expose a new callback prop `dispatchSystemVisibleMessage` and add it to the parent component's prop list).

**Out of scope:** picker UI (4A–4C); drag-and-drop (5B). The slash flow uses click-confirm only.

**Deliverables:**
- `/reuse` at message start triggers autocomplete → opens picker.
- Mid-message `/reuse` does NOT trigger.
- Confirm posts a `SYSTEM_VISIBLE` message into the thread with the recap content.
- Agent does NOT auto-run (no agent dispatch).

**Verification:**
- `tests/reuseSlashCommand.test.jsx`: type `/reuse` at start → autocomplete shows → pick → picker opens. Type `"hi /reuse"` → autocomplete does NOT show. Confirm inserts → system message appears.
- Manual: in dev, open an agent thread, type `/reuse`, pick a fixture trip, confirm, verify recap appears in chat and no agent run starts.

**Gate to Stage 7:**
- All three entry points open the picker.
- Insertion works end-to-end from each entry point.
- Committed locally.

---

## Stage 7 — Tests + accessibility pass (parallel × 3)

### 7A · Server integration tests — **Sonnet 4.6**

Seed a deterministic fixture and exercise all three endpoints.

**Scope (server):**
- Create `tests/ratedHistoryRoutes.test.ts`:
  - Seed: one agency, two ClientTrips with completed itineraries + TripReview rating 4 (eligible), one ClientTrip with rating 3 (excluded), one ClientTrip with no itinerary (excluded), one trip in a different agency (excluded).
  - `GET /agencies/:id/rated-history`:
    - Returns the two eligible trips; excludes ineligible.
    - Destination filter narrows results.
    - Season filter (use a fixed-month seed date).
    - Duration filter.
    - Pagination boundaries.
    - 403 when caller not a member of the agency.
  - `GET /agencies/:id/rated-history/:tripId`:
    - Returns full itinerary structure with `clientNotes` absent from every item.
    - APPROVED_INTERNAL preferred over DRAFT when both exist.
    - 404 when trip exists but no itinerary.
    - 403 when cross-agency.
  - `POST /trips/:tripId/itinerary/insert-from-rated`:
    - Happy path for each `kind` (item, day, segment); assert returned itinerary contains inserted IDs and re-anchored dates.
    - 400 on `kind=item` with mixed-day item IDs.
    - 400 on `kind=segment` with non-consecutive day numbers.
    - 403 on cross-agency source.
    - 404 on missing source itinerary.
    - 409 on stale `ifMatchVersion`.
    - 410 on source trip deleted mid-request (simulate by deleting between calls in the test).
    - 200 with `missingStartDateAdvisory: true` when target has `startDate = null`.
- Use the existing test helpers; mirror the pattern of `tests/dashboardService.test.ts` for seeding.

**Out of scope:** unit tests already in place from Stage 3.

**Verification:** `npx vitest run tests/ratedHistoryRoutes.test.ts` — all tests pass.

### 7B · Client component tests — **Sonnet 4.6**

React Testing Library + Vitest for the picker and entry points.

**Scope (client):**
- Create `tests/ratedHistoryPicker.test.jsx`:
  - `RatedHistoryPicker` opens / closes / Esc closes / focus trap holds.
  - Filter chips update fetch params.
  - Empty pool renders `<EmptyRatedState>` copy.
  - `RatedTripList` click expands; only one row expanded at a time; "Draft" badge on draft-status fixture.
  - `RatedDayCard` drag handle fires `dragstart` with `kind=day` payload.
  - `RatedDayCard` range mode prevents non-consecutive selection.
  - `RatedItemRow` drag fires `kind=item` payload with `sourceDayId`.
- Create `tests/reuseSlashCommand.test.jsx`:
  - Leading `/` triggers autocomplete; mid-message `/` does not.
  - Picking `reuse` clears composer + opens picker.
  - Confirm posts SYSTEM_VISIBLE message; no agent run.
- Reuse `tests/useReuseDrop.test.jsx` from Stage 5B (verify it's in the suite).

**Out of scope:** server tests (7A); a11y (7C).

**Verification:** `npm test` in `Voyage-Client/` — all tests pass.

### 7C · Accessibility audit — **Sonnet 4.6**

Manual sweep + axe automated checks.

**Scope:**
- Run `axe-core` against the picker mounted on a dev page (both light + dark mode if dark exists for these surfaces).
- Manual keyboard sweep across all three entry points:
  - Editor → button → picker opens with focus inside → Tab cycles through filter chips → expanded trips reachable → "Move to…" menu replaces drag for items/days/segments → focus returns to button on close.
  - Client itinerary page → same as above.
  - Agent thread → `/reuse` → autocomplete navigable with ↑/↓ → Enter selects → picker opens → confirm sheet keyboard-operable → focus returns to composer on close.
- Verify ARIA:
  - Picker: `role="dialog"`, `aria-modal="true"`, labelled by header.
  - Day handle: `aria-label="Drag Day {n}: {title}"`.
  - Item handle: `aria-label="Drag {item title}"`.
  - Drop result: live-region announcement "Added Day 3 from Tokyo Family Spring 2025 to your draft as Day 5".
- Document any violations in `Voyage-Server/docs/superpowers/reviews/2026-05-28-rated-history-picker-a11y-audit.md` (mirror the existing dashboard audit format).

**Out of scope:** fixing visual contrast issues outside picker scope.

**Verification:** axe clean across all three entry-point surfaces; manual keyboard checklist documented in the audit file.

**Gate to ship:**
- All tests green on both repos.
- Axe clean.
- A11y audit document committed.
- Both diffs reviewed.

---

## Stage 8 — Reconciliation (main thread)

Solo task.

1. Re-read the spec against the merged code. Note any drift; either amend the spec or open follow-up tickets.
2. Verify branch hygiene on both repos (no stray files, no unintended deletions).
3. Confirm open questions in spec §11 remain unresolved (this is correct — they're intentionally deferred).
4. Hand back to user: summary of commits, any deviations from spec, anything deferred to follow-up specs (calendar + RAG).

---

## Parallel groups at a glance

| Stage | Parallel count | Hardest task (model) | Lightest task (model) |
|---|---|---|---|
| 1 — Server foundation | 1 | Module skeleton (Sonnet) | — |
| 2 — Server helpers | 2 | Repository (Sonnet) | Season helper (Haiku) |
| 3 — Service + routes | 1 | Service + tests (Opus 4.6) | — |
| 4 — Picker UI | 3 | Drag rows (Sonnet) | Empty state (Sonnet) |
| 5 — Hooks | 2 | useReuseDrop (Opus 4.6) | useRatedHistory (Haiku) |
| 6 — Entry points | 3 | Slash command (Opus 4.6) | Editor button (Haiku) |
| 7 — Test + a11y | 3 | Server integration tests (Sonnet) | Component tests (Sonnet) |

**Estimated subagent dispatches:** 13 across 7 active stages. Main thread handles Stage 0 and Stage 8, plus the verify step between each stage.

### Per-task model tier summary

| Task | Tier | Why this tier |
|---|---|---|
| 1 · Module skeleton + schemas | Sonnet 4.6 | Wiring routes into existing app.ts needs care, but boilerplate-heavy |
| 2A · Season helper | Haiku 4.5 | Pure 8-line function with branch table |
| 2B · Repository | Sonnet 4.6 | Prisma queries with joins + filters, no novel logic |
| 3 · Service + routes + unit tests | Opus 4.6 | Date re-anchoring, copy semantics, selection validation, concurrency — multi-axis correctness traps |
| 4A · Picker shell + filters | Sonnet 4.6 | Stateful container with a11y requirements |
| 4B · List + expansion | Sonnet 4.6 | Standard list with toggle state |
| 4C · Draggable day/item rows | Sonnet 4.6 | HTML5 drag payload + range-select constraint |
| 5A · useRatedHistory | Haiku 4.5 | Plain fetch hook with cache map |
| 5B · useReuseDrop | Opus 4.6 | Drop logic across two different DOM surfaces, drag preview, keyboard fallback, full error mapping |
| 6A · Editor button | Haiku 4.5 | Single button placement |
| 6B · Client itinerary button | Haiku 4.5 | Single button placement |
| 6C · Slash command + composer interception | Opus 4.6 | Composer state machine + autocomplete + system-visible message wiring + edge cases on mid-message slashes |
| 7A · Server integration tests | Sonnet 4.6 | Seed + assert across many status codes |
| 7B · Client component tests | Sonnet 4.6 | RTL with drag-event simulation |
| 7C · A11y audit | Sonnet 4.6 | Axe + manual keyboard sweep + write-up |

Rule applied per memory feedback `[[feedback_subagent_model_selection]]`: match tier to task difficulty; skip Opus for mechanical work. Opus 4.7 is reserved and not used in this plan because every hard task fits inside Opus 4.6's reasoning envelope.

---

## Risks and where to be careful

1. **Cross-repo coordination.** Server stages 1–3 land first; client stages 4–6 require those endpoints. Don't dispatch a client stage that depends on an unmerged server change.
2. **Existing `dragstart` handlers on `ItineraryDraftPanel`.** The draft panel already implements its own header-drag for repositioning. The `dockMode` prop in 5B must reliably suppress that drag while the picker is open; otherwise users will accidentally drag the entire panel when they meant to drag an item. Test this explicitly.
3. **Trip-write-access check.** The spec mentions "write access on the target trip" but the codebase may not have a centralized helper. The Stage 3 subagent should grep for `requireTripWriteAccess` first; if absent, inline the agency-membership check + owner/admin OR assigned-organizer check, and flag the duplication for a future refactor (don't extract a new helper as part of this work — YAGNI).
4. **Composer interception subtleties.** The `<ReuseSlashCommand>` component must not break the existing image-attachment flow or the multi-line shift-Enter behaviour in `AgentCommandCenter`. Test both with the slash component mounted.
5. **`SYSTEM_VISIBLE` message persistence.** Confirm whether the agent thread persists system messages to `AgentMessage` (likely yes, given the `AgentMessageRole.SYSTEM_VISIBLE` enum). The slash flow must use the same persistence path so the recap survives reloads.
6. **PII strip enforcement.** Audit twice — once in 3, once in 7A — that `clientNotes` does NOT make it across the boundary. A regression here is a privacy bug.
7. **`prefers-reduced-motion`.** Picker slide-in and drop animations must downgrade to opacity-only transitions. Already established globally in the dashboard work; spot-check in 4A and 5B.
8. **Place snapshot freshness (spec §11 open question 1).** Implementation in 3 reuses snapshots as-is. Do not silently re-fetch — that's an open question, not a decision.

---

## Branch / commit hygiene

- All work lands on `feat/rated-history-picker` on the relevant repo. No sub-branches per stage.
- Commits per stage, not per subagent — squash the parallel work into one logical commit per stage with a descriptive message. Easier to revert a stage if something goes wrong.
- Don't push to remote until the user says so (per existing instruction).
- After each stage, the main thread does a quick `git diff staging..HEAD --stat` sanity check.

---

## What this plan deliberately does not include

- **Agent RAG over rated history.** Separate spec to follow — will plug into this module's `getRatedItinerary` and add a new `search_rated_history` tool.
- **Dashboard calendar widget.** Separate spec to follow — independent surface.
- **Analytics on reuse frequency.** Deferred to a future analytics spec (spec §12).
- **Place snapshot freshness policy.** Open question in spec §11.
- **Multi-source cherry-picking** (selecting items from more than one source trip into one insertion). Open question.
- **Whole-trip-clone "Start from a rated trip" card on the dashboard.** Deferred.
- **Per-item ratings within a day.** Out of scope per spec §2.
- **Cross-agency reuse / template marketplace.** Out of scope per spec §2.
