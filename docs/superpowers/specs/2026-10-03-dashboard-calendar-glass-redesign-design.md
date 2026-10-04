# Dashboard Calendar + Glass Frame Redesign — Design Spec

**Date:** 2026-10-03
**Author:** brainstormed with Claude (Voyage)
**Status:** Draft — pending review
**Scope:** Voyage-Client (app frame, icon rail, Dashboard tab, Settings) + Voyage-Server (one new read endpoint)
**Builds on:** `2026-05-26-agency-dashboard-design.md` (owner/staff dashboards, worklist, KPIs, funnel, ratings)

---

## 1. Goal

A design critique of the Dashboard tab and sidebar (2026-10-02) found three problems:

1. **The frame is tuned to the Command Center.** The header shows the trip picker, "New Itinerary" and agent status on every tab, so the Dashboard shows controls that mean nothing there. The sidebar mixes navigation with utilities (theme, one-click Logout) and has no agency identity.
2. **No hierarchy.** Seven sections share the same pill + serif heading + white card, so nothing leads. The worklist, the most important content, carries the same red dot on every row.
3. **Contrast failures.** Eyebrow pills (3.28:1), worklist group headings (3.64:1), KPI labels (3.47:1) and terracotta text links (3.69:1) fail WCAG AA's 4.5:1 minimum. The dark-mode header controls are nearly invisible.

This redesign:

- gives the whole app a **glass frame with a slim icon rail**, modelled on a reference "smart calendar dashboard" ([uiuxcenter on Instagram](https://www.instagram.com/p/DdjOK6RIYk1/));
- rebuilds the Dashboard as **one page**: greeting, a "Needs you today" list and a **calendar of trips and client activity** on the left, **Insights** on the right;
- keeps the **Command Center design exactly as it is** (chat over the live map);
- fixes the measured contrast failures at the token level.

## 2. Decisions made during brainstorming

| Topic | Decision |
|---|---|
| What to take from the reference | Glass visual style, personal greeting, calendar as a feature, in-place detail popovers, slim icon rail |
| Theme | Keep Voyage's current light and dark palettes. Apply the glass treatment (translucent panels, hairline borders, large radii, background light streak) in **both** themes |
| Calendar content | Trip spans plus client activity, from **existing data only**. No new models, no migration |
| Dashboard layout | One page. Left: Needs you today + calendar. Right: Insights column. (An earlier "Agenda / Insights" tabs option was dropped.) |
| Day details | Clicking a calendar day opens a popover with that day's items and actions |
| Command Center | Unchanged: chat panel over the full-bleed live map. Only the header's position changes (it now sits beside the rail) |
| Staff view | Same layout. The right column shows the staff member's own work (continue card + pipeline), not agency-wide insights. Calendar shows only their trips |
| Team section | Moves from the Dashboard to **Settings** |
| Activity feed | Removed. Its useful events appear on the calendar |

Approved mockups: frame + rail (Section 1), and dashboard + Command Center (final layout), shown inline during brainstorming on 2026-10-03.

## 3. App frame (all tabs)

### 3.1 Background and frame

- The page background is the theme's `--color-background` with a soft diagonal **light streak** behind everything: two rotated bands drawn by a `::before` on the app shell, using new `--streak-1` / `--streak-2` tokens (white-ish in light mode, faint white and terracotta in dark mode).
- The workspace (rail + content) is one **floating glass panel**: 16px inset from the viewport, 24px radius, `--glass-panel` fill, 1px `--glass-border`, soft shadow, `backdrop-filter: blur(16px)`.
- At ≤900px the panel goes full-bleed (no inset, no radius), like today.

### 3.2 Icon rail (rewrite of `DashboardSidebar.jsx`)

Replaces the 90px labelled column with a 72px rail inside the frame.

| Slot | Content |
|---|---|
| Top | Voyage "Hops" small symbol (`voyage-symbol-small.svg`, 32px). Tooltip and `aria-label` = the agency name ("Voyage" for personal accounts) |
| Nav | Dashboard (agency members only), Command Center, Itineraries, Admin (super-admins, with pending badge), Settings ("My account" for personal accounts) |
| Bottom | Theme toggle (sun/moon), then the **avatar** button |

- Nav buttons are 40px circles. Inactive: `--glass-tile` fill, muted icon. **Active:** filled terracotta circle (`--color-secondary`) with a white icon in light mode and a near-black icon in dark mode (both ≥3:1).
- Every button has an `aria-label`, `aria-current="page"` when active, and a **tooltip** to the right on hover and keyboard focus.
- **Account menu** (new `AccountMenu.jsx`): the avatar opens a glass menu with name, email, role and agency, then "Account settings" (goes to Settings) and **Sign out**. Menu-button pattern: `aria-haspopup="menu"`, `aria-expanded`, arrow-key navigation, Esc closes and returns focus. Logout is no longer a one-click nav item.
- Existing `data-tour-target` attributes (`dashboard-overview`, `settings-replay`) move to the matching rail buttons so the first-use tour keeps working.

### 3.3 Header (`DashboardHeader.jsx`)

- **Dashboard tab (desktop):** the header is not rendered. The Dashboard's own greeting row takes its place.
- **Command Center, Itineraries, Settings, Admin:** the header keeps its current contents and behaviour: New Itinerary, ClientSwitcher, "Save to Client", live status. Two blocks are removed because the rail now owns them: the brand block (star tile, "VOYAGE", "Agency trip workspace") and the avatar/name block.
- The header moves inside the frame, beside the rail, instead of spanning the full window width above the sidebar.
- **≤900px:** the header always renders, because it holds the hamburger. On the Dashboard tab it shows only the hamburger and the logo mark.
- **First-use tour:** steps that target header elements (`new-itinerary`, `client-switcher`) must run while the Command Center tab is active. The plan must check that `handleFirstUseTutorialStepChange` switches tabs for those steps.

### 3.4 Mobile drawer (≤900px)

The rail is hidden. The existing hamburger opens the existing slide-in drawer, restyled with glass. It holds the same items, labelled, plus an account section at the bottom (name, theme toggle, Sign out).

## 4. Dashboard — owner / admin view

### 4.1 Layout

```
┌───────────────────────────────────────────────────────────────────┐
│ Good morning, Maria                                 [+ New trip]  │
│ 3 things need you today                                           │
├──────────────────────────────────────────────┬────────────────────┤
│ Needs you today                       3 items │ Insights   30d ▾   │
│ • Reply to Tanaka   comment · 1 day   Reply → │ ┌───────┬───────┐  │
│ • Lisbon link expires   in 2 days    Extend → │ │Win 62%│Share  │  │
│ • Okafor viewed Cebu   4 views    Follow up → │ ├───────┼───────┤  │
├──────────────────────────────────────────────┤ │Reply  │Rating │  │
│ October 2026 ▾                      ‹ Today › │ └───────┴───────┘  │
│ Sun Mon Tue Wed Thu Fri Sat                   │ Trip progress      │
│ [27][28][29][30][ 1][ 2][⋯3]                  │ ▬▬▬▬▬▬▬▬ 24        │
│ [ 4][ 5][ 6][ 7][ 8][ 9][10]                  │ ▬▬▬▬▬▬ 16 …        │
│  …  (trip spans as bars, events as dots)      │ Latest review      │
│ ■ Trip  ● Link expiry  ● Client activity      │ ★★★★★ "Seamless…"  │
└──────────────────────────────────────────────┴────────────────────┘
```

| Width | Layout |
|---|---|
| ≥1280px | Two columns; Insights column 320px |
| 1024–1279px | Two columns; Insights column 280px |
| <1024px | One column: Needs you → Calendar → Insights |

The content fills the frame. The old `max-w-[1280px]` centring is removed.

### 4.2 Greeting row (new `DashboardGreeting.jsx`)

- Title: "Good morning / Good afternoon / Good evening, {first name}" by local time (05–12, 12–17, 17–05), in DM Serif Display, 28px (32px ≥1280px).
- Subtitle: "{n} things need you today", "1 thing needs you today", or "Nothing needs you right now".
- **New trip** is the page's only filled button. It calls the existing `onNewTrip`.
- `JoinedNotice` (invite landing) renders above this row when `showJoinedNotice` is true.

### 4.3 Needs you today (new `NeedsYouList.jsx`, restyled `WorklistRow`)

Replaces the five headed worklist groups with **one flat list in priority order**:

1. `lowRated` (danger)
2. `sharesExpiring`, soonest first (warning)
3. `unreadComments`, oldest first
4. `viewedNotReplied`
5. `draftsStuck` (warning)

- Each row: type marker (colour **and** icon, so colour isn't the only cue), title, context text from the existing `describeWorklistItem`, action link (Reply / Extend / Follow up / Resume / Open trip).
- Actions open `TripSlideOver` for that trip, as today.
- Shows the first 5 items; "Show all ({n})" expands in place.
- Empty: "You're all caught up." with no card chrome.

### 4.4 Calendar (new `AgencyCalendar.jsx` + `CalendarDayPopover.jsx`)

**Grid**
- Month view, Sunday-first, 6 rows (42 days) so the height never jumps between months.
- Month title, previous/next buttons, and a "Today" button.

**Day tile**
- Date number. Days outside the month use muted text.
- Up to 3 event dots in the top corner, then "+n".
- Trip spans as a 3px terracotta bar along the bottom, with the trip's place label on the first day of the span and at the start of each week row. Past spans use 45% opacity.
- **Today:** dashed terracotta ring. **Open day:** terracotta tint fill with solid ring.

**Legend** under the grid: Trip (bar), Link expiry (amber dot), Client activity (slate dot). Dot mapping: `share_expires` → amber; every other event kind, including `share_sent`, → slate.

**Popover** (opens when a day is clicked)
- Anchored beside the day tile; it flips to the left near the right edge.
- Header: date, plus "Today" / "In n days" / "n days ago", and a close button.
- Each item: type bar, title, one-line detail, action link. **Open trip / Reply / Extend / View review** all open `TripSlideOver` for that trip (same as the worklist).
- Empty day: "Nothing on this day."
- ≤600px: the day's details render inline below the grid instead of in a popover.

**Item copy**

| Source | Title | Detail |
|---|---|---|
| Trip span, first day | "{client} · {place} departs" | "{n} nights · {travelers} travelers" |
| Trip span, middle | "{client} in {place}" | "Day {d} of {total}" |
| Trip span, last day | "{client} · {place} returns" | "{travelers} travelers" |
| `share_sent` | "Sent {trip} to {client}" | "Itinerary link shared" |
| `share_expires` | "{trip} link expires" | "Shared with {client}" |
| `client_viewed` | "{client} viewed {trip}" | "{viewCount} views in total" |
| `client_commented` | "{client} commented" | excerpt (80 chars) |
| `proposal_rated` | "{client} rated the proposal" | "{rating} out of 5" |
| `review_submitted` | "{client} reviewed {trip}" | "{rating} out of 5" + excerpt |

**Notes and states**
- If some trips have no dates: a muted line under the legend, "{n} trips don't have travel dates yet".
- Loading: skeleton tiles.
- Error: an inline message inside the calendar card with **Retry**. The rest of the dashboard still works.

### 4.5 Insights column (new `InsightsColumn.jsx`)

- Header: "Insights" and the existing `PeriodSwitcher` (7d / 30d / 90d).
- **KPIs, 2×2 grid**, using a new `compact` variant of `KpiTile`: Win rate, Time to first share, Comment reply time, Avg proposal rating.
  - Deltas are written in words with semantic colour: "+4 pts", "0.4d faster", "1 h slower", "80% rated".
  - This replaces the ▲/▼ arrows and the explanatory legend sentence.
  - The tiles are static: no hover lift or pointer cursor, so they no longer look clickable. This closes critique item "KPI tiles look clickable but do nothing".
- **Trip progress:** a `compact` variant of `FunnelChart` (label, bar, count per stage), plus a "Biggest drop: {stage} to {stage}" note. Stage click-through to `FunnelStageDetailPanel` stays.
- **Latest reviews:** a `compact` variant of `RatingsPanel` showing the 2 most recent. "All reviews" expands the list in place.

### 4.6 Removed from the Dashboard

- The "Overview", "Worklist", "Your numbers" and similar eyebrow pills, plus duplicate section headings.
- `ActivityRibbon`. Its accurate events (`share_sent`) move to the calendar. Its approximate ones (`trip_status_changed`, `itinerary_approved`, both from `trip.updatedAt`) are dropped, because any edit moves that timestamp.
- The Team section (see §6).

## 5. Dashboard — staff view (`StaffMyWork.jsx`)

Same frame, greeting and calendar (scoped to the staff member's trips by the server). Two differences:

- **Needs you today** uses the staff worklist: `unreadComments`, `mySharesExpiring`, `myDraftsStuck`, `startingSoon` ("{trip} starts in {n} days").
- **Right column** (new `MyWorkColumn.jsx`): the existing `HeroContinueCard` ("Continue where you left off"), the pipeline counts (Drafts, In review, Approved this month, Active now) as a 2×2 grid, and up to 3 `secondaryRecent` trips.

## 6. Settings: Team panel

- `SettingsPage.jsx` gets a **Team** panel that renders the existing `TeamPage` for all roles. Invite controls stay limited to OWNER/ADMIN, as `TeamPage` already does.
- Deep links (`app/page.jsx`):
  - `tab=team&invited=1` → Dashboard with `JoinedNotice` (unchanged).
  - `tab=team` without `invited` (e.g. `/agency/:id/team`) → **Settings**, scrolled to the Team panel.

## 7. Server: calendar endpoint

### 7.1 Route

`GET /agencies/:agencyId/dashboard/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

- Added to the existing `dashboardRoutes` router (`mergeParams: true`). If a params schema is added, it must include `agencyId` (the strict-params gotcha that caused 400s on 2026-07-01).
- `from`/`to` are inclusive local calendar dates of the visible grid. The rules are `from ≤ to` and a span of at most 42 days. Anything else returns 400 `CALENDAR_RANGE_INVALID`.
- Auth: `requireAuth` + `agencyAccessService.requireVerifiedAgencyMember`, the same as `GET /dashboard`.

### 7.2 Scoping

- OWNER / ADMIN: all of the agency's trips.
- STAFF: trips where `createdByUserId` or `assignedOrganizerUserId` is the caller. This is the same rule as `aggregations.ts` (staff worklist).
- Events are included only for trips in scope.

### 7.3 Response

```ts
type CalendarPayload = {
  from: string;          // "YYYY-MM-DD", echoed
  to: string;
  generatedAt: string;   // ISO instant
  tripsWithoutDates: number;   // in-scope, non-archived trips with no startDate
  trips: Array<{
    tripId: string;
    tripTitle: string;
    clientName: string | null;
    placeLabel: string;          // destinationSummary ?? title, for the tile label
    startDate: string;           // "YYYY-MM-DD" (calendar date)
    endDate: string;             // "YYYY-MM-DD"; equals startDate when endDate is null
    status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL";
    travelerCount: number | null;
  }>;
  events: Array<{
    id: string;                  // "{kind}:{sourceId}"
    kind:
      | "share_sent"
      | "share_expires"
      | "client_viewed"
      | "client_commented"
      | "proposal_rated"
      | "review_submitted";
    tripId: string;
    tripTitle: string;
    clientName: string | null;
    occurredAt: string;          // ISO instant
    detail: { viewCount?: number; rating?: number; excerpt?: string };
  }>;
};
```

### 7.4 Event sources

| Kind | Source | Rule |
|---|---|---|
| `share_sent` | `ItineraryShare.createdAt` | in window |
| `share_expires` | `ItineraryShare.expiresAt` | in window, `revokedAt` is null |
| `client_viewed` | `ItineraryShare.lastViewedAt` | in window; `detail.viewCount` = `viewCount`. Only the latest view is stored, so the calendar shows one "viewed" event per share |
| `client_commented` | `ItineraryComment.createdAt` | in window; `detail.excerpt` = first 80 chars |
| `proposal_rated` | `ItineraryShare.proposalRatedAt` | in window; `detail.rating` |
| `review_submitted` | `TripReview.submittedAt` | in window; `detail.rating`, `detail.excerpt` |

- Shares with a null `tripId` are skipped, because there is no trip to open.
- **Trip spans:** non-archived trips with a `startDate`, where `[startDate, endDate ?? startDate]` overlaps `[from, to]`. Trip dates are serialised as UTC date strings (`toISOString().slice(0, 10)`). This assumes the trip form stores dates at UTC midnight; the plan must verify that.
- **Instant window:** event timestamps are instants, while the client groups them by **local** date. The server therefore widens the query window to `from − 14h … to + 1 day + 14h` (covering UTC−12 to UTC+14). The client drops events outside the grid after bucketing.

### 7.5 Implementation

- `dashboardRepository.fetchCalendarWindow(agencyId, window)` runs bounded queries using existing indexes (`ClientTrip.agencyId`, `ItineraryShare.agencyId`, `TripReview(agencyId, submittedAt)`; comments filtered via `share: { agencyId }`).
- A pure `buildCalendar(raw, { role, userId, window })` lives in a new `calendar.ts`, separate from `aggregations.ts` so each stays focused. It is unit-tested without Prisma.
- `dashboardService.getCalendar(...)` adds a `TtlCache` (60s) keyed by `agencyId:scope:from:to`, where scope is `all` or the staff `userId`.
- Zod: `calendarQuerySchema` and `calendarPayloadSchema` in `dashboardSchemas.ts`. Types go in `dashboardTypes.ts`.

## 8. Client data flow

- **`useCalendarEvents({ agencyId, month })`** (new hook):
  - Works out the 42-day grid range and fetches `/agencies/{id}/dashboard/calendar` through `fetchApi`.
  - Keeps fetched months in memory for the session, so going back to a month is instant.
  - Refetches every 60s while the tab is visible, pausing when hidden like `useDashboardPoll`. On error it keeps the previous data.
- **`buildCalendarDays(payload, gridStart)`** (new `app/lib/calendarDays.js`): a pure function that returns 42 day cells `{ dateKey, inMonth, isToday, spans[], events[] }`. It groups events by local date and splits spans per week row for labels. Unit-tested, including the timezone edge cases.
- The dashboard poll (`useDashboardPoll`) is unchanged. The calendar and the dashboard payload load independently, so either can fail alone.

## 9. Visual system (`app/globals.css`)

### 9.1 New tokens

| Token | Light | Dark |
|---|---|---|
| `--glass-panel` | `rgba(255,255,255,.55)` | `rgba(26,29,33,.72)` |
| `--glass-tile` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.04)` |
| `--glass-border` | `rgba(34,56,67,.10)` | `rgba(255,255,255,.08)` |
| `--glass-popover` (solid) | `#FFFFFF` | `#22262B` |
| `--streak-1` / `--streak-2` | `rgba(255,255,255,.85)` / `rgba(215,122,97,.08)` | `rgba(255,255,255,.04)` / `rgba(224,144,111,.07)` |
| `--color-secondary-strong` (text links, filled-button fill) | `#AD5238` (5.2:1 on white) | `#E0906F` |
| `--on-secondary-strong` | `#FFFFFF` | `#111416` |
| `--status-good` / `--status-bad` | `#2E7D4F` / `#B3261E` | `#6FCF97` / `#F28B82` |
| `--cal-expiry` / `--cal-activity` | `#BA7517` / `#5F7A87` | `#EF9F27` / `#8FA3AE` |

### 9.2 Utilities and rules

- Utilities: `.glass-panel`, `.glass-tile`, `.glass-popover`.
- `backdrop-filter` only on the frame panel, popovers, the account menu and the mobile drawer, **not on calendar tiles**, to keep iOS PWA scrolling smooth.
- Fall back to solid surfaces under `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)`.
- **Contrast:**
  - All text ≥4.5:1 against the *blended* background in both themes; non-text UI (rail active circle, dots, bars) ≥3:1.
  - Filled terracotta buttons use `--color-secondary-strong` with `--on-secondary-strong`. In dark mode that is near-black text on `#E0906F` (7.4:1), replacing white (2.6:1).
- **Type:**
  - Minimum 12px everywhere except calendar day numbers, dots legend and tile labels (11px, ≥4.5:1).
  - Rail tooltips are 12px.
  - Section titles: Plus Jakarta Sans 14px/600.
- **Motion:** popover and menu fade + 4px rise, 120ms ease-out. Removed under `prefers-reduced-motion`.

## 10. Accessibility

- **Rail:** labelled buttons, tooltips on hover and focus, `aria-current`, visible focus rings (2px terracotta, 2px offset).
- **Account menu:** WAI-ARIA menu button pattern (see §3.2).
- **Calendar:** the grid is a `role="grid"` table of day buttons with a **roving tabindex**.
  - Keys: arrows move by day/week, Home/End go to week start/end, PageUp/PageDown change month, Enter/Space opens the popover.
  - Each day's `aria-label` reads "Thursday, October 8, 2 items, trip Kyoto departs".
- **Popover:** `role="dialog"` labelled by its date. Focus moves to the first action; Esc closes and returns focus to the day; clicking outside closes it.
- Colour is never the only cue: legend, rows and popover items carry an icon or text for their type.

## 11. Error handling and edge cases

| Case | Behaviour |
|---|---|
| Dashboard payload fails | Existing stale/error banner, restyled; calendar unaffected |
| Calendar request fails | Inline error inside the calendar card with Retry; last good month stays visible |
| Range invalid (client bug) | 400 `CALENDAR_RANGE_INVALID`; client logs it and shows the calendar error state |
| Not a member / not verified | 403 as on `GET /dashboard`; the Dashboard tab is already hidden for these users |
| Trip has `endDate` before `startDate` | Treated as a single-day span on `startDate` |
| More than 3 events on a day | 3 dots + "+n"; the popover lists all |
| Personal account | No Dashboard tab (unchanged); rail shows Command Center, Itineraries, My account |

## 12. Testing

**Server** (vitest, `Voyage-Server/tests/`)
- `dashboardCalendar.test.ts`: `buildCalendar` unit tests covering:
  - span overlap at both edges; null `endDate`; ARCHIVED excluded; `endDate < startDate`;
  - each event kind; revoked shares skipped; null-`tripId` shares skipped;
  - staff scoping (creator / assignee / neither); `tripsWithoutDates` count; instant-window padding.
- Route tests (pattern of `agentRoutes.test.ts`): 400 for >42 days and for `from > to`; 403 for non-members; STAFF gets only their trips; response parses with `calendarPayloadSchema`.

**Client** (vitest + RTL, `Voyage-Client/tests/`)
- `calendar-days.test.js`: bucketing, 42-cell grid, week-row span splitting, and an event at 23:30 local landing on the right day.
- `agency-calendar.test.jsx`: renders tiles; today ring; dots and "+n"; popover opens and closes; keyboard navigation; Esc returns focus; error + Retry.
- `dashboard-rail.test.jsx`: labels and tooltips; `aria-current`; account menu opens, Esc closes, Sign out calls `logout`; Admin badge.
- `dashboard-header.test.jsx`: hidden on the Dashboard tab (desktop); retained with its controls on the Command Center; no brand/avatar blocks.
- Update: `home-page-dashboard-tab.test.jsx`, `dashboard-server-contract.test.jsx`, and any test that expects the dashboard's Team section or `ActivityRibbon`.
- `settings-team.test.jsx`: Team panel renders; `tab=team` deep link opens Settings; `tab=team&invited=1` opens the Dashboard with `JoinedNotice`.

**Manual QA**
- Both themes at 1440, 1024 and 375 widths.
- Contrast spot checks with the blended-background measurement script used in the critique.
- iOS PWA scroll smoothness with the frame blur on.

## 13. Out of scope

- Creating or editing calendar events (would need a `CalendarEvent` model and migration).
- Approval timestamps (would need a migration). "Approved" therefore doesn't appear on the calendar.
- Per-view history, drag-to-reschedule, week/day views, search and the notification bell from the reference.
- Any change to the Command Center's chat, map or composer.

## 14. Expected file changes

**Voyage-Client**
- `app/globals.css`: tokens, glass utilities, streak background.
- `app/components/trip-dashboard/layout/DashboardSidebar.jsx` (rewrite to rail), new `layout/AccountMenu.jsx`, `layout/DashboardHeader.jsx`.
- `app/components/trip-dashboard/HomePage.jsx`: frame panel and header gating by tab.
- `app/page.jsx`: `tab=team` deep link.
- `app/agency/[agencyId]/components/dashboard/`:
  - changed: `OwnerOverview.jsx`, `StaffMyWork.jsx`, `widgets/WorklistRow.jsx`, `widgets/KpiTile.jsx`, `widgets/FunnelChart.jsx`, `widgets/RatingsPanel.jsx`;
  - new: `widgets/DashboardGreeting.jsx`, `widgets/NeedsYouList.jsx`, `widgets/AgencyCalendar.jsx`, `widgets/CalendarDayPopover.jsx`, `widgets/InsightsColumn.jsx`, `widgets/MyWorkColumn.jsx`;
  - delete `widgets/ActivityRibbon.jsx` once unused.
- New `app/hooks/useCalendarEvents.js`, new `app/lib/calendarDays.js`.
- `app/components/trip-dashboard/pages/SettingsPage.jsx`: Team panel.

**Voyage-Server**
- `src/modules/dashboard/`: `dashboardRoutes.ts`, `dashboardSchemas.ts`, `dashboardTypes.ts`, `dashboardRepository.ts`, `dashboardService.ts`; new `calendar.ts`.
- `tests/dashboardCalendar.test.ts`.

## 15. As built

Implemented on `feat/dashboard-calendar` (both repos) from `docs/superpowers/plans/2026-10-03-dashboard-calendar-glass-redesign.md`. Refinements made while planning:

- New `frame-*` tokens and utilities instead of `--glass-panel`, `--glass-tile` and `--glass-border`, because `--glass-*` and `glass-panel` drive the Command Center chat.
- Existing `--success`/`--danger`/`--color-status-warning`/`--color-text-muted` used for delta, expiry and activity colours. Only `--color-secondary-strong` and `--color-on-secondary-strong` are new.
- Server code in `calendar.ts`, `calendarRepository.ts` and `calendarService.ts`. `dashboardRepository.ts` and `dashboardService.ts` are unchanged.
- To-do rows keep their old actions and labels. Calendar popover actions open the trip slide-over: "Reply" for comments, "Open trip" otherwise.
- Empty to-do copy stays "All caught up."
- KPI sparklines, the activity ribbon and the staff "Starting soon" cards are removed.
- Popovers and the account menu use a solid surface. The rail logo is `/icon.svg`.
- Calendar day buttons are labelled with the date and item count; the items are read from the day's popover.

Changes made after code review:

- **Server:**
  - `TtlCache` takes a `maxEntries` cap (default 1000), because the calendar cache key includes the requested range.
  - The dated-trip query cuts at the day after `to` (`CalendarWindow.toDayEnd`), matching the builder's date comparison.
  - Shares, comments and reviews also require their trip to belong to the agency.
  - Excerpts are cut by code point, so emoji are never split.
  - A route test runs the real service against a mocked repository.
- **Frame and rail:**
  - The header has no z-index. As a flex item, `z-[100]` had started painting it over modals and slide-overs.
  - The phone/desktop boundary is 900px everywhere: `max-[900px]` with `min-[900px]`, and `useMobileViewport` uses `(max-width: 899.98px)`.
  - On phones the Dashboard always renders the compact header and hides it on desktop with CSS, so first paint doesn't shift.
  - The closed phone drawer is `inert`, and Escape closes it.
  - The drawer gets the glass fallbacks, and its active item uses the strong terracotta.
  - The account identity block sits outside `role="menu"`, and focus returns to the avatar.
- **Calendar:**
  - The day popover takes focus only once it is visible, and repositions on resize.
  - "Today" rolls over at midnight.
  - Requests are aborted when superseded.
  - The month cache lasts for the session (module level), and data refetches when a tab hidden for over 60s becomes visible again.
  - Tiles show placeholder bars on first load.
- **KPI tiles:** changes under 0.05 read "No change", and the accessible label uses the visible wording.
- **Dashboards (owner and staff):**
  - The calendar mounts straight away and loads independently of the `/dashboard` payload.
  - A failed first load shows a `DashboardStaleBanner` alert with Retry instead of empty states.
  - A failed refresh, while data is still showing, shows a status banner.
- **Contrast:** the period switcher's active pill and the status chips use the strong terracotta and muted tokens, at 12px.
- **Focus:**
  - A calendar popover action hands focus back to its day.
  - `TripSlideOver` focuses its close button on open and returns focus to the opener on close.
  - The closed slide-over is `inert`.
  - The open slide-over traps Tab.
  - If the slide-over's opener has left the page, focus falls back to "Needs you today".
- **Status chips:** labels use body text with a coloured dot, so they stay at 4.5:1 or better on row hover.
- **Server rendering:** the greeting and the calendar's "today" read the clock through `useSyncExternalStore` (`useLocalClock`), so a server-rendered page hydrates without a mismatch. `/agency/[agencyId]` passes `viewerName`.
