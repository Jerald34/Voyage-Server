# Agency Dashboard — Design Spec

**Date:** 2026-05-26
**Author:** brainstormed with Claude (Voyage)
**Status:** Draft — pending review
**Scope:** Voyage-Client (UI) + Voyage-Server (API, schema, scheduled job)

---

## 1. Goal

Replace the current `/agency/[agencyId]` redirect with a two-mode dashboard that:

1. Gives agency owners an action-first view focused on the **conversion lever** (proposals → approvals), so client signals turn into agency actions faster.
2. Gives staff a personal "resume work" surface so they spend less time figuring out what to do next and more time on craft.
3. Introduces a lightweight **rating system** (client-rated proposals + post-trip traveler reviews) that feeds both growth signals and the dashboard's worklist.

The dashboard helps the agency grow by **shortening the loop between a client signal and an agency action** and **making conversion leaks visible enough that the owner can fix the right one.**

---

## 2. Architecture decision

**Approach A** — add an "Overview" tab as the first nav item in the agency layout. The current `/agency/[agencyId]` redirect is replaced with the actual Overview page, which branches at the page level by `useAgencyRole`:

- `OWNER` / `ADMIN` → Owner Overview
- `STAFF` → Staff My Work

Both views share a small widget library (`KpiTile`, `WorklistRow`, `FunnelChart`, `HeroContinueCard`, `RatingsPanel`, `ActivityRibbon`, `EmptyState`, `Sparkline`). Trips / Team / Settings tabs stay where they are.

**Rejected alternatives:**

- **Absorb Trips into the dashboard** — bigger change, constrains the Trips tab's future growth into a full management surface. Premature.
- **Customizable widget canvas** — too much surface area for v1, and we don't yet know which widgets users actually use. Revisit in v2.

---

## 3. Owner Overview content

Single scrollable page, four zones top-to-bottom, action density highest at the top.

### 3.1 "Needs your eyes today" (hero worklist)

Grouped attention list. Each row links to the trip and offers a primary inline action so the owner doesn't drill down for trivial follow-ups.

| Category | Source | Inline action |
|---|---|---|
| Unread client comments | `ItineraryComment` where `status = PENDING`, oldest first | Reply |
| Viewed, not replied | `ItineraryShare` with `viewCount > 0`, trip still `IN_REVIEW`, no recent agency activity | Open trip |
| Drafts stuck > 7 days | `ClientTrip` in `DRAFT` with stagnant `updatedAt` | Resume |
| Shares expiring < 48h | `ItineraryShare.expiresAt` window | Extend / resend |
| Low-rated proposals (≤3) | New `ItineraryShare.proposalRating` ≤ 3 in last 14d, no follow-up | Open trip |

Empty state: "All caught up. N active shares · M trips upcoming."

### 3.2 KPI strip (4 tiles)

Each tile: big number + sparkline + delta-vs-prior-period chip. 30-day default, switcher for 7/30/90.

- **Win rate** — `APPROVED_INTERNAL / (APPROVED + ARCHIVED)` over period
- **Avg time-to-first-share** — days from `ClientTrip.createdAt` to first `ItineraryShare.createdAt`
- **Median comment response time** — hours from `ItineraryComment.createdAt` to first `agencyRepliedAt`
- **Avg proposal rating** — mean of `ItineraryShare.proposalRating` (with N-count visible)

Tiles are clickable → side panel listing contributing trips.

### 3.3 Funnel (one chart, not many)

Horizontal funnel: **Trips created → Itineraries drafted → Shares sent → Shares viewed → Approved.**

Each stage shows count + drop-off %. Click a stage → side panel slides in with that stage's trips. Single visual covers the entire conversion story.

### 3.4 Team pulse + recent reviews (tail)

Two low-density sections:

- **Recent traveler reviews** — last 3–5 `TripReview` entries (star count, trip title, quote snippet, "Mark as testimonial" toggle when consent granted).
- **Activity ribbon** — compact union of share-sent / trip-status-changed / itinerary-approved events. Caps at ~6 rows.

### 3.5 Quick actions

Two buttons in the page header: **New trip** (primary), **Invite teammate** (secondary).

### 3.6 Explicit omissions

No revenue widgets, no OKR/goal-setting, no customizable layout, no multi-agency switcher, no client CRM view.

---

## 4. Staff "My Work" content

Same URL, role-branched render. Frame is operational, not analytic.

### 4.1 "Pick up where you left off" (hero)

One large card for the most recently touched trip (`assignedOrganizerUserId = me` OR `createdByUserId = me`, max `updatedAt`). Shows trip title, client name, status chip, last activity preview, primary **Continue** CTA → opens the trip's agent thread.

Below, 2–3 secondary cards of other recently-touched trips for one-tap context switching.

### 4.2 "Clients waiting on you" (scoped worklist)

Same pattern as owner, filtered to *my* trips, tighter thresholds:

| Row | Filter | Inline action |
|---|---|---|
| Unread client comments | `ItineraryComment.status = PENDING` on my trips | Reply |
| My drafts stuck > 3 days | 3-day threshold (tighter than owner's 7) | Resume |
| My shares expiring < 48h | No comments yet | Extend / nudge |
| Trips starting in 7 days | My trips, including `APPROVED_INTERNAL` (pre-trip touches) | Open trip |

### 4.3 Pipeline strip (thin counters, not big tiles)

Single row: `Drafts N · In review N · Approved this month N · Active right now N`. Click any to filter trip list.

### 4.4 "Starting soon" (horizontal scroller)

5–6 upcoming trips by start date, oldest-first. Card: trip title, client, days-to-start, traveler count.

### 4.5 Quick action

**New trip** only (no "Invite teammate" — staff usually can't invite).

### 4.6 Rating touchpoints on staff page

Not as KPIs. Two lightweight touchpoints:

- Toast at the top when a new rating arrives on one of their trips.
- On the trip detail page when reopened, rating shown inline.

### 4.7 Deliberately not on staff dashboard

- No personal KPIs (avoid surveillance feel; opt-in "My stats" sub-page possible later)
- No team activity feed (owner concern)
- No funnel (owner concern)
- No team workload widget (owner concern)

---

## 5. Rating system

### 5.1 Flavors in scope

- **A — Client rates proposal** (pre-trip, embedded in `ItineraryShare` view). 1–5 stars + optional comment. Lives on the same surface as `ItineraryComment` to maximize response rate.
- **B — Traveler rates trip** (post-trip, NPS + testimonial). Email fires 2 days after `ClientTrip.endDate`. One-tap star buttons in the email body; full form opens only if a star is tapped.

### 5.2 Flavors deferred to v2

- **C — Internal peer / owner review** (covered partly by existing `NEEDS_REVIEW` status; risks team politics)
- **Per-item ratings** (within a day) — useful for AI agent learning later, but not v1

### 5.3 Low-rating behavior

A proposal rating ≤ 3 creates a **worklist row only** in the owner's "Needs your eyes today." No auto-email. Owner/staff decides whether to call, email, or rework. (Auto-templated replies and full automation are explicitly deferred.)

### 5.4 Dashboard placements

- **Owner Overview KPI strip:** "Avg proposal rating (N over 30d)" replaces share view-through.
- **Owner Overview worklist:** "Low-rated proposals" row.
- **Owner Overview tail:** "Recent traveler reviews" panel with testimonial toggle.
- **Staff dashboard:** lightweight toast + on trip detail.

---

## 6. Visual design language

### 6.1 Mood

Quiet, fast, professional. Closer to Linear's Inbox than Stripe's executive dashboard. Action-first hierarchy: eye lands on worklist first, KPIs second, charts third. Decoration earns its place by communicating state, never just by existing.

### 6.2 Color tokens (extend existing `globals.css`)

Semantic, never raw hex in components. Light + dark designed together; dark uses desaturated tonals, not inversion.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` (existing) | `#FAFAFA` | `#0B0B0C` | Page background |
| `--surface` | `#FFFFFF` | `#141416` | Card surfaces |
| `--surface-elevated` (existing) | `#F4F4F5` | `#1B1B1E` | Hover, raised states |
| `--border` (existing) | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | Hairlines |
| `--text-primary` (existing) | `#0A0A0A` | `#F4F4F5` | Body/headings |
| `--text-muted` (existing) | `#71717A` | `#A1A1AA` | Secondary |
| `--accent` | `#3B82F6` | `#60A5FA` | Primary CTA, sparkline trend line |
| `--success` | `#16A34A` | `#22C55E` | Positive deltas, approvals |
| `--warning` | `#D97706` | `#F59E0B` | Stuck/expiring rows |
| `--danger` | `#DC2626` | `#EF4444` | Low ratings, errored shares |
| `--rating-star` | `#EAB308` | `#FACC15` | Star fills |

Status is never color-alone — every status pairs color with label or icon. Contrast verified per WCAG AA in both modes.

### 6.3 Typography

System stack + Inter Variable. Scale (8pt-derived): `12 · 14 · 16 · 18 · 22 · 28 · 36`. Body 16px. KPI hero number 28px. Page H1 22px.

**Tabular numerals on all KPI digits, ratings, and counts** (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter when numbers update.

### 6.4 Component anatomy

- **KPI tile** — fixed 120px height, label + period switcher on top, hero number + delta chip, 32px sparkline. Delta chip pairs color with `▲`/`▼` glyph. Whole tile is a button (≥44pt effective hit area).
- **Worklist row** — leading status dot, title + comment preview (clamped, full text in tooltip), right-aligned inline action. Row click = open trip (secondary); button click = primary action. Real `<button>` / `<a>` elements.
- **Hero "Continue" card (staff)** — single 200px-tall card, 48px CTA. Below: 2–3 secondary cards at 96px tall.
- **Funnel** — horizontal proportional bars, drop-off % between stages (not inside). Tap a stage → right-side slide-in panel with trip list (not modal — preserves dashboard context).

### 6.5 Motion language

Shared easing tokens in `globals.css`:

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

| Element | Animation | Duration | Easing |
|---|---|---|---|
| Button press | `scale(0.97)` | 120ms in / 160ms release | `--ease-out` on release |
| KPI tile hover | bg → `--surface-elevated` | 160ms | `ease` |
| Worklist row enter | opacity + `translateY(8px → 0)`, stagger 40ms | 240ms | `--ease-out` |
| Side panel in | `translateX(100% → 0)` | 280ms | `--ease-drawer` |
| Side panel out | reverse | 200ms (faster exit) | `--ease-out` |
| Sparkline draw | `stroke-dashoffset` reveal, once on mount | 400ms | `--ease-out` |
| Number ticker | crossfade + 1px blur during swap | 180ms | `ease` |
| Toast | `translateY(100% → 0)` + opacity | 320ms in / 200ms out | `--ease-out` |

**Rules applied:**

- Only `transform` and `opacity` animated. Never `width`/`height`/`top`/`left`.
- Nothing enters from `scale(0)`; minimum `scale(0.95)`.
- Exit animations 60–70% of enter duration.
- `transform-origin` matches trigger for popovers (Radix `--radix-popover-content-transform-origin`); modals stay centered.
- `@media (prefers-reduced-motion: reduce)` strips transforms, keeps opacity fades.
- No animation on initial page load beyond worklist stagger — frequent actions don't get animated.

### 6.6 Spacing & layout

- 8pt grid. Component padding `12 / 16 / 24`. Section gaps `24 / 32 / 48`.
- Page max-width `1280px`, `px-6 md:px-8`.
- Owner: 12-column grid (4 × 3-col KPI tiles, full-width worklist + funnel).
- Staff: 8-column (8-col hero, 2 × 4-col secondary cards).
- Sticky header reserves height — no content jump.

### 6.7 Accessibility floor

- All interactive targets ≥44×44pt effective.
- Focus rings: 2px solid `--accent`, 2px offset, never removed.
- KPI tiles + funnel have `aria-label` summarizing data ("Win rate 42.1%, up 3.2 points vs prior 30 days").
- Tab order matches visual order. Skip-to-main link.
- Status colors always paired with text/icon (color-not-only).

### 6.8 Light/dark mode

Designed together. Dark `surface` is `#141416` (not pure black) so borders/elevation still read. Dark accent slightly brighter (`#60A5FA`) for 3:1 contrast against data.

---

## 7. Architecture & data flow

### 7.1 Client routes

```
Voyage-Client/app/agency/[agencyId]/
  page.jsx                          ← REPLACE redirect with role-branched dashboard
  layout.jsx                        ← add "Overview" as first tab
  components/dashboard/
    OwnerOverview.jsx
    StaffMyWork.jsx
    widgets/
      KpiTile.jsx
      WorklistRow.jsx
      FunnelChart.jsx
      HeroContinueCard.jsx
      RatingsPanel.jsx
      ActivityRibbon.jsx
      EmptyState.jsx
      Sparkline.jsx
```

`page.jsx` is a server component that reads the session, resolves the role for this agency, fetches the initial dashboard payload, and renders `<OwnerOverview />` or `<StaffMyWork />` with data already hydrated.

### 7.2 Server module

New module `Voyage-Server/src/modules/dashboard/`:

```
dashboardRoutes.ts       ← GET /agencies/:id/dashboard
dashboardService.ts      ← composes data from existing repos
dashboardRepository.ts   ← the queries (mostly aggregates)
dashboardSchemas.ts      ← Zod input/output schemas
dashboardTypes.ts
```

A new module rather than bolting onto `agencies/` because the dashboard reads across trips, itineraries, shares, comments, agent threads, and ratings. Single-purpose read-side composition layer.

### 7.3 API surface

One endpoint per dashboard view:

```
GET /agencies/:agencyId/dashboard?view=owner|staff&period=7d|30d|90d
```

- Auth via existing session middleware.
- Role enforced server-side: STAFF requesting `view=owner` → 403.
- Default `view` selected by role when omitted.
- Default `period` = `30d`.

Payload shapes are role-specific (see Sections 3 and 4 for fields).

### 7.4 Refresh strategy

- **First paint:** server-rendered, hydrated. Instant.
- **Background poll:** 60s interval on the client. Light payload (<10KB typical).
- **Optimistic updates** on local actions (reply, extend, nudge). Revert + toast on failure.
- **No realtime push** in v1 — polling at 60s gets 95% of perceived freshness for 5% of the cost.

### 7.5 Caching

Heavy aggregates cached in-memory per `(agencyId, period)` key with a 60s TTL — matches poll cadence.

### 7.6 Schema changes (Prisma)

**Extend `ItineraryShare`:**

```prisma
proposalRating         Int?
proposalRatingComment  String?
proposalRatedAt        DateTime?
@@index([proposalRating])
```

**New `TripReview` model:**

```prisma
model TripReview {
  id                    String     @id @default(uuid()) @db.Uuid
  tripId                String     @db.Uuid
  trip                  ClientTrip @relation(fields: [tripId], references: [id], onDelete: Cascade)
  agencyId              String     @db.Uuid
  agency                Agency     @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  rating                Int
  npsScore              Int?
  reviewText            String?
  respondentName        String?
  respondentEmail       String?
  consentToTestimonial  Boolean    @default(false)
  submittedAt           DateTime   @default(now())
  emailSentAt           DateTime?
  createdAt             DateTime   @default(now())

  @@index([agencyId])
  @@index([agencyId, submittedAt])
  @@index([rating])
}
```

**New `TripReviewEmailLog` (so we don't double-send):**

```prisma
model TripReviewEmailLog {
  tripId  String     @id @db.Uuid
  trip    ClientTrip @relation(fields: [tripId], references: [id], onDelete: Cascade)
  sentAt  DateTime   @default(now())
}
```

One migration commit, reversible.

### 7.7 Rating ingestion endpoints

- `POST /shares/:token/rate` — public, token-gated, rate-limited. Sets proposal rating fields on `ItineraryShare`.
- `POST /reviews/:tripToken/submit` — public, token-gated. Creates `TripReview` from the one-shot link in the post-trip email.

### 7.8 Scheduled job (post-trip review emails)

In-process node-cron, hourly:

```ts
// Voyage-Server/src/modules/reviews/reviewScheduler.ts
cron.schedule('0 * * * *', sendDuePostTripEmails);
```

Logic: find `ClientTrip` with `endDate < now() - 2 days`, status `APPROVED_INTERNAL`, no `TripReviewEmailLog` entry. Send via existing `email.ts`. Insert `TripReviewEmailLog`.

Multi-instance safety: Postgres advisory lock (`pg_try_advisory_lock`). Swap to BullMQ + Redis only when volume warrants.

### 7.9 Permission model (server-enforced)

- `view=owner` requires `OWNER` or `ADMIN` for that agency.
- `view=staff` requires any active membership.
- All trip data filtered server-side by `agencyId` — never trust the client to scope.

### 7.10 What is explicitly not built

- No GraphQL — REST + Zod is enough.
- No SWR/React Query in v1 — a small custom hook is fine for a single endpoint per page.
- No widget personalization (column order, hide/show).
- No analytics event stream.
- No multi-tenant isolation rework — existing `agencyAccessService` pattern continues to apply.

---

## 8. State system

### 8.1 Loading

- **First paint:** SSR with real data. No loading state.
- **Background refresh:** silent; numbers swap via crossfade with 1px blur.
- **Period switch:** affected KPI tiles show subtle skeleton overlay for ~150ms. Tile dimensions don't change.
- **Funnel side panel:** slides in immediately with skeleton list inside.
- **Optimistic actions:** row updates instantly; reverts on error.

Skeletons use a single low-contrast shimmer (4px radius, quiet motion).

### 8.2 Empty states

| Widget | Empty copy |
|---|---|
| Worklist | "All caught up. N active shares · M trips upcoming." + soft secondary link |
| KPI tile | "—" with hint "No closed trips in last 30d" |
| Funnel | "Your funnel will appear once you create your first trip" + primary CTA |
| Recent reviews | "Reviews appear after trips complete. First post-trip emails fire 2 days after the trip ends." |
| Staff hero | "Ready when you are." + "New trip" CTA + tutorial link |
| Activity ribbon | "Activity will show up here as your team works." |

Empty is treated as positive information, not absence.

### 8.3 Errors

Per-widget error boundaries — one widget crashing doesn't blank the page.

| Failure | Behavior |
|---|---|
| Single widget fetch fails | Quiet "Couldn't load — retry" inline; rest of dashboard works |
| Whole endpoint fails | Top banner: "We couldn't refresh — last loaded N min ago." Last-good data stays visible |
| Optimistic action fails | Row reverts; toast "Couldn't send reply — try again." `aria-live="polite"`. |
| Permission lost mid-session | Server returns 403 → client redirects to `/` with flash message |
| Offline | Lightweight pill: "You're offline — showing last loaded data." Resume polling when back online |

All errors include a recovery path.

---

## 9. Testing strategy

Three layers, scaled to risk. Existing Vitest setup on both repos.

### 9.1 Unit (server) — pure aggregation functions

- `computeWinRate(trips)` — happy / all-draft / single-trip cases
- `computeMedianResponseTime(comments)` — even/odd / no-comments
- `computeFunnelStages(...)` — drop-off % math, division-by-zero
- `selectWorklistRows(...)` — sorting, thresholds, role scoping

### 9.2 Integration (server) — joins + permission enforcement

Seeded test DB:

- Owner payload completeness
- Staff payload scoping (no cross-staff leakage)
- Role enforcement (STAFF asking for `view=owner` → 403)
- Period switch changes counts correctly
- Cache returns stale within TTL, fresh after eviction

### 9.3 Component (client) — interactive bits

- `KpiTile` — number / delta / `aria-label` / period switcher dispatch
- `WorklistRow` — keyboard activation, row click ≠ action click
- `FunnelChart` — stage click opens side panel with right filter
- `EmptyState` — per-widget copy + CTA wiring
- `useDashboardPoll` hook — interval, pauses when tab hidden, resumes on visible
- Reduced-motion: with `matchMedia` mocked, no transforms applied

### 9.4 E2E — one happy path (Playwright)

1. Log in as agency owner
2. Land on `/agency/[id]` → Overview renders
3. Worklist shows seeded unread comment
4. Click "Reply" → trip detail opens with comment composer focused
5. Submit reply → return to dashboard → row gone (optimistic), stays gone after refresh

### 9.5 Not testing in v1

- Visual regression (too brittle for fast-moving design)
- Motion frame timing (manual review per Emil's framework)
- Performance budgets via CI (add when regressions actually happen)

---

## 10. Observability (light)

- Structured log per dashboard fetch: `{agencyId, view, period, durationMs, cacheHit}`.
- Counter on optimistic-action failure rate.
- No new dashboards-on-dashboards.

---

## 11. Open questions for the writing-plans phase

These are not blockers for the spec but need decisions during implementation planning:

1. Exact polling interval — 60s is the default; do we want it user-configurable (likely no)?
2. Period switcher placement — per-tile or single global switch (lean: single global, simpler).
3. Side-panel vs full route for funnel stage drill-down — UX prefers panel; bookmarkability prefers route. Decide based on whether owners want to share/bookmark these.
4. Review email copy + send-after delay (2 days proposed; needs agency feedback).
5. Should the `Avg proposal rating` KPI tile show response rate (`% of shares rated`) as a subtitle, in addition to the raw N-count already specified? Low response rate would otherwise be invisible at a glance. (Leaning yes.)

---

## 12. Out of scope (parked for v2+)

- Customizable widget canvas (drag/drop, hide/show)
- Internal peer/owner ratings on draft itineraries
- Per-item ratings (within a day) — useful for AI agent learning later
- Multi-agency switcher on the dashboard surface
- Revenue / financial widgets
- Goal-setting / OKR widgets
- Analytics event stream / Mixpanel-style telemetry
- Realtime push (WebSocket/SSE)
- Personal staff KPI sub-page ("My stats")
- Auto-template reply for low-rated proposals
