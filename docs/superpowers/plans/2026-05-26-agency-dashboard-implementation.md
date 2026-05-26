# Agency Dashboard — Implementation Plan

**Date:** 2026-05-26
**Spec:** [2026-05-26-agency-dashboard-design.md](../specs/2026-05-26-agency-dashboard-design.md)
**Branches:** `feat/agency-dashboard` on both Voyage-Server and Voyage-Client (local, branched from `staging`)

---

## How to read this plan

Work is **staged**. Within each stage, tasks that can run truly independently are grouped under **Parallel groups** and should be dispatched in a **single message** containing multiple `Agent` tool calls (per the parallel-agents convention).

Between stages there is a **gate** — a hard dependency that must be confirmed merged before the next stage begins. Do not start a stage until its gate condition is verified.

### Model tier guide

| Tier | Use for |
|---|---|
| **Haiku 4.5** | Mechanical / scaffolding: small UI components, CSS token additions, simple file moves, boilerplate routes |
| **Sonnet 4.6** | Moderate implementation: REST endpoints, hooks, widgets with non-trivial interaction, integration tests |
| **Opus 4.6** | Complex / cross-cutting: aggregate query logic, the funnel + side panel, E2E test design, anything with subtle correctness traps |
| **Opus 4.7** | Reserve for genuine reasoning depth — schema design across many relations, multi-system trade-off calls. Don't use for mechanical work. |

Each subagent task below specifies its tier explicitly. The default is "use the lowest tier that gets it done."

### Subagent brief template (use this for every dispatch)

> **Repo:** [server / client / both]
> **Branch:** `feat/agency-dashboard` (already created from `staging`)
> **Spec:** Voyage-Server/docs/superpowers/specs/2026-05-26-agency-dashboard-design.md (read sections X.Y)
> **Scope:** [bounded list of files to touch]
> **Out of scope:** [explicit exclusions so the agent doesn't drift]
> **Deliverables:** [files created/modified, tests passing, command output]
> **Verification:** [exact command to run before reporting done]
> **Report format:** [what to send back — diff summary + verification output, capped]

Trust-but-verify: after every agent run, the main thread reads the actual diff before marking the task done.

---

## Stage 0 — Pre-flight (main thread, sequential)

Single task; no subagents.

1. Confirm both `feat/agency-dashboard` branches exist and are clean.
2. Re-read the spec end-to-end. Note any spec ambiguity now and amend the spec before dispatching agents (agents won't ask, they'll guess).
3. Decide if there are shared TypeScript types worth extracting between repos (probably no for v1 — payload contract is in `dashboardSchemas.ts` on the server; client can hand-mirror).

**Gate to Stage 1:** Spec is unambiguous; both branches green.

---

## Stage 1 — Foundation (parallel × 3)

Three completely independent pieces of groundwork. Dispatch in one message.

### 1A · Prisma schema + migration (server) — **Sonnet 4.6**

- Extend `ItineraryShare` with `proposalRating`, `proposalRatingComment`, `proposalRatedAt` + `@@index([proposalRating])`.
- Add `TripReview` model (full shape in spec §7.6).
- Add `TripReviewEmailLog` model.
- Generate migration: `npx prisma migrate dev --name agency_dashboard_ratings`.
- Update `prisma/schema.prisma` and run codegen.
- Verify: `npx prisma validate` passes, migration applies cleanly on a fresh DB.

**Scope:** `Voyage-Server/prisma/schema.prisma`, generated migration files only.
**Out of scope:** any service/repo code touching the new fields (Stage 2).

### 1B · Design tokens + motion easings (client) — **Haiku 4.5**

- Add new CSS variables to `globals.css` per spec §6.2 (`--surface`, `--accent`, `--success`, `--warning`, `--danger`, `--rating-star`) with both light + dark values.
- Add easing tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`) per §6.5.
- Add a `@media (prefers-reduced-motion: reduce)` rule that disables transforms while keeping opacity.
- No component changes.

**Scope:** `Voyage-Client/app/globals.css` only.
**Out of scope:** any JSX changes; component-level motion (added in Stage 3).

### 1C · "Overview" tab stub + replace redirect (client) — **Haiku 4.5**

- Add "Overview" as the first item in `Voyage-Client/app/agency/[agencyId]/layout.jsx` tab list.
- Replace `Voyage-Client/app/agency/[agencyId]/page.jsx` (currently a redirect) with a placeholder server component that imports `useAgencyRole`, branches to `<OwnerOverview />` or `<StaffMyWork />`, both currently returning a single `<div>Coming soon</div>`.
- Keep the existing `?invited=1` query-string handling working — it should still route invited users to the Team tab on first land.

**Scope:** `Voyage-Client/app/agency/[agencyId]/page.jsx`, `layout.jsx`, plus two placeholder JSX files.
**Out of scope:** real dashboard content (Stage 4).

**Gate to Stage 2:**
- Server: `prisma migrate status` clean, codegen up to date.
- Client: `npm run build` green; navigating to `/agency/[id]` lands on the Overview placeholder.
- Both diffs reviewed and committed.

---

## Stage 2 — Backend implementation (parallel × 3)

All three depend on Stage 1A's schema being merged. They do not depend on each other.

### 2A · Dashboard module — **Opus 4.6**

The complex one. Aggregate query logic, period filtering, role-branched payload composition, 60s in-memory cache, role enforcement.

- Create `Voyage-Server/src/modules/dashboard/{dashboardRoutes,dashboardService,dashboardRepository,dashboardSchemas,dashboardTypes}.ts`.
- Implement `GET /agencies/:agencyId/dashboard?view=owner|staff&period=7d|30d|90d`.
- Pure aggregation helpers (`computeWinRate`, `computeMedianResponseTime`, `computeFunnelStages`, `selectWorklistRows`) exported separately for unit testing.
- 60s TTL in-memory cache keyed by `(agencyId, view, period)`.
- Role enforcement: STAFF requesting `view=owner` → 403; default `view` selected by caller role.
- Trip data filtered server-side by `agencyId` from URL — never trust client.

**Scope:** the new module + minimal wire-up in the routes registrar.
**Out of scope:** rating ingestion endpoints (2B), scheduled job (2C), client integration.
**Verification:** `npm test -- dashboard` passes (unit tests written as part of this task).

### 2B · Rating ingestion endpoints — **Sonnet 4.6**

- `POST /shares/:token/rate` (public, token-gated): validates token via existing `shareService` resolver, applies rate limit, writes `proposalRating`, `proposalRatingComment`, `proposalRatedAt` on `ItineraryShare`.
- `POST /reviews/:tripToken/submit` (public, token-gated): one-shot trip-review token issuance (sign with existing secret), endpoint creates `TripReview` row, idempotent on tripToken.
- Both endpoints use Zod schemas and return semantic errors per existing module conventions.

**Scope:** new `Voyage-Server/src/modules/reviews/` module (reviewRoutes, reviewService, reviewSchemas, reviewTypes); extension of `shares/shareRoutes.ts` with the rate endpoint.
**Out of scope:** the scheduler (2C) and the dashboard's read path (handled in 2A).
**Verification:** integration test posts a rating against a seeded share token; assert DB state.

### 2C · Post-trip review scheduler — **Sonnet 4.6**

- Add `node-cron` to server deps if not already present.
- New file `Voyage-Server/src/modules/reviews/reviewScheduler.ts`.
- Hourly cron: scan `ClientTrip` with `endDate < now() - 2 days`, status `APPROVED_INTERNAL`, no `TripReviewEmailLog`.
- Send via existing `services/email.ts` (`sendTripReviewEmail` — add to the service).
- Insert `TripReviewEmailLog`.
- Postgres advisory lock around the scan (`pg_try_advisory_lock`) so multi-instance deployment is safe.
- Initialize from server bootstrap (`src/index.ts` or equivalent).

**Scope:** scheduler file, email service extension, bootstrap wiring.
**Out of scope:** the public submit endpoint (2B owns that).
**Verification:** unit test with a fake clock + seeded trips asserts correct send + log behavior; manual run with `endDate` backdated by 3 days in a dev DB sends the email.

**Gate to Stage 3:**
- `curl /agencies/:id/dashboard?view=owner` against a seeded local DB returns a structurally-correct payload.
- `npm test` green on server.
- Both diffs reviewed and committed.

---

## Stage 3 — Frontend widget library (parallel × 4)

All widgets are independent atomic components. Group them by tier; each group is one subagent.

### 3A · Heavy widgets — **Opus 4.6**

- `FunnelChart.jsx` + the side-panel drill-down component. Proportional horizontal bars, drop-off labels between stages, side panel slides in from right on stage click with `--ease-drawer`, listing trips at that stage. Accessibility: `aria-label` summarizes the funnel; keyboard activates stages; side panel traps focus and `Esc` closes.
- `KpiTile.jsx` — label + period chip, hero number with tabular nums, delta chip (color + `▲`/`▼` glyph), 32px `Sparkline.jsx` (own file, simple SVG). 120px fixed height. Clickable as button.

**Scope:** `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/{FunnelChart,KpiTile,Sparkline}.jsx` + a small `FunnelStageDetailPanel.jsx`.
**Verification:** Storybook-free visual smoke (mount each with prop fixtures in a scratch page); component tests cover keyboard + a11y.

### 3B · Worklist + interaction primitives — **Sonnet 4.6**

- `WorklistRow.jsx` — leading status dot in semantic color, clamped one-line comment preview with full text in tooltip, right-aligned inline action button, real `<button>` / `<a>` elements, ≥44pt hit area, row click ≠ action click event isolation.
- `useDashboardPoll.js` hook — 60s interval, pauses on `document.hidden`, resumes on `visibilitychange`, dedupes in-flight requests, exposes `{data, isStale, refetch}`.

**Scope:** `widgets/WorklistRow.jsx`, `hooks/useDashboardPoll.js`.
**Verification:** keyboard activation works, tab-hidden pause covered by a test.

### 3C · Lightweight widgets — **Haiku 4.5**

Static composition components, no tricky state.

- `HeroContinueCard.jsx` + 2–3 secondary cards layout (96px tall).
- `RatingsPanel.jsx` (renders last N reviews).
- `ActivityRibbon.jsx` (compact union list).
- `EmptyState.jsx` (variant by widget name).

**Scope:** four small `widgets/*.jsx` files.
**Verification:** rendering with prop fixtures, no a11y violations on axe.

### 3D · Period switcher control — **Haiku 4.5**

Single global switcher (7d / 30d / 90d) that sits above the KPI strip. Just a segmented control with three buttons + active state + keyboard arrow nav.

**Scope:** `widgets/PeriodSwitcher.jsx`.

**Gate to Stage 4:** all widgets render in isolation with prop fixtures; component tests green; reduced-motion media query strips transforms.

---

## Stage 4 — Pages assembly (parallel × 3)

All three depend on Stage 2 (API) and Stage 3 (widgets). They don't depend on each other.

### 4A · OwnerOverview.jsx — **Sonnet 4.6**

Composes widgets per spec §3. Owns period state (lifted from PeriodSwitcher), passes data slices to KPI tiles + funnel + worklist + ratings panel + activity ribbon. Handles optimistic updates on worklist actions (reply / extend / nudge).

**Scope:** `Voyage-Client/app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx`.

### 4B · StaffMyWork.jsx — **Sonnet 4.6**

Composes widgets per spec §4. Hero "Continue" card + secondary cards + scoped worklist + pipeline counters + starting-soon scroller + rating toast.

**Scope:** `Voyage-Client/app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx`.

### 4C · Server component + SSR fetch — **Sonnet 4.6**

Replace the Stage 1C placeholder content in `page.jsx`. Server component: read session, resolve role via existing server-side helper, fetch the initial dashboard payload from the dashboard endpoint with cookies forwarded, render `<OwnerOverview initialData={...} />` or `<StaffMyWork initialData={...} />` hydrated.

**Scope:** `Voyage-Client/app/agency/[agencyId]/page.jsx`.

**Gate to Stage 5:**
- Both dashboards render against the seeded dev DB with real data.
- Manual smoke: log in as OWNER, see full overview; log in as STAFF, see staff page; STAFF cannot hit `?view=owner`.
- Both diffs reviewed and committed.

---

## Stage 5 — Rating UI surfaces (parallel × 2)

Independent of each other; depend on Stage 2B endpoints existing.

### 5A · Proposal rating on share view — **Sonnet 4.6**

Embed a 1–5 star control + optional comment on the existing client-facing `ItineraryShare` view. Submits to `POST /shares/:token/rate`. Once rated, the control shows the score with an "Update" affordance for 24h then locks.

**Scope:** wherever the existing share view component lives (locate via grep on `ItineraryShare` in the client).
**Verification:** rating round-trips to DB; share view renders the captured rating after refresh.

### 5B · Post-trip review email + form — **Sonnet 4.6**

- HTML email template with five star buttons that each link to `/reviews/[tripToken]?rating=N`.
- New client route `/reviews/[tripToken]/page.jsx` — pre-fills with the rating from query string, asks for `reviewText`, NPS optional, "OK to use as testimonial?" checkbox; submits to `POST /reviews/:tripToken/submit`.
- Idempotent UX: if a review already exists for the token, show the prior submission with a thank-you.

**Scope:** server-side email template (in `email.ts` or a new template file), client route + page.

**Gate to Stage 6:** rating capture works end-to-end on both surfaces against the dev DB.

---

## Stage 6 — Testing + accessibility pass (parallel × 4)

All independent. Dispatch together.

### 6A · Server integration tests for dashboard — **Sonnet 4.6**

Seed a deterministic fixture agency + trips + shares + comments + ratings. Assert payload completeness (owner), scoping (staff doesn't leak), role enforcement (403), period switching, cache TTL.

### 6B · Client component tests — **Sonnet 4.6**

RTL/Vitest for KpiTile (number/delta/aria), WorklistRow (keyboard + isolation), FunnelChart (stage click opens panel with filter), EmptyState, useDashboardPoll (visibility pause/resume).

### 6C · E2E happy path — **Opus 4.6**

Playwright (or whatever Voyage-Client uses — check `tests/` first). Single test: login as owner → land on Overview → seeded unread comment appears → click Reply → trip detail opens with composer focused → submit → return to dashboard → row gone (optimistic) → row stays gone after a poll cycle.

### 6D · Accessibility audit — **Sonnet 4.6**

Run axe against both dashboards in light and dark mode. Manual keyboard sweep: tab order, focus rings visible, side panel focus trap, skip-link works. Document any violations and fix.

**Gate to ship:** all tests green; axe clean; manual a11y sweep documented.

---

## Stage 7 — Final review + spec reconciliation (main thread)

Solo task.

1. Re-read the spec against the merged code. Note any drift; either amend the spec or open follow-up tickets.
2. Verify branch hygiene on both repos.
3. Hand back to user: summary of commits, any deviations from spec, anything explicitly deferred.

---

## Parallel groups at a glance

| Stage | Parallel count | Hardest task (model) | Lightest task (model) |
|---|---|---|---|
| 1 — Foundation | 3 | Schema migration (Sonnet) | CSS tokens (Haiku) |
| 2 — Backend | 3 | Dashboard module (Opus 4.6) | Scheduler (Sonnet) |
| 3 — Widgets | 4 | Funnel + side panel (Opus 4.6) | Period switcher (Haiku) |
| 4 — Pages | 3 | Server component SSR (Sonnet) | StaffMyWork (Sonnet) |
| 5 — Rating UIs | 2 | Post-trip email + form (Sonnet) | Proposal rating widget (Sonnet) |
| 6 — Testing | 4 | E2E (Opus 4.6) | Component tests (Sonnet) |

**Estimated subagent dispatches:** 19 across 6 stages. Main thread handles 0 + 7 (pre-flight and reconciliation), plus the merge/verify step between each stage.

---

## Risks and where to be careful

1. **Cross-repo coordination.** Each subagent works in one repo. Don't dispatch a client-side task that depends on a server change that hasn't been merged yet — that's why stages 1 and 2 land server changes first, and stage 4 (page SSR) depends on the dashboard endpoint existing.
2. **Prisma migration on shared dev DB.** If multiple devs share one DB, the migration in 1A must be communicated. Local-only branches don't push the migration upstream until merge; that's fine.
3. **Subagent context blindness.** Each agent gets a self-contained brief. Don't write "implement per the spec" — quote the exact spec section number and the exact file paths.
4. **Optimistic update correctness.** Worklist actions on the owner dashboard update local state immediately. If the action fails, the row must revert *and* the toast must explain why. This is a classic source of subtle UX bugs — give the agent owning 3B explicit test cases for the failure path.
5. **`prefers-reduced-motion`.** Easy to overlook in widgets. Stage 1B sets it up globally; Stage 3 agents need to verify their components honor it (covered in the brief template).
6. **Cron in-process gotcha.** If Voyage-Server runs more than one instance in production (Railway can scale), the advisory lock is non-optional. Confirm with the deploy environment before shipping.
7. **Trust-but-verify on subagents.** After every agent reports done, read the diff. Agents have been observed claiming a test passes when it doesn't. The brief should require the verification command's output in the report.

---

## Branch / commit hygiene

- All work lands on `feat/agency-dashboard` on the relevant repo. No sub-branches per stage.
- Commits per stage, not per subagent — squash the parallel work into one logical commit per stage with a descriptive message. Easier to revert a stage if something goes wrong.
- Don't push to remote until the user says so (per existing instruction).
- After each stage, the main thread does a quick `git diff staging..HEAD --stat` sanity check.

---

## What this plan deliberately does not include

- Performance benchmarking (only if regressions show up).
- Mobile-first layout work beyond responsive defaults (the dashboard targets desktop usage primarily).
- Analytics events (parked per spec §12).
- v2 features: customizable widgets, internal peer reviews, per-item ratings, multi-agency switcher.
