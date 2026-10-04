# Calendar Action Icons + Recently Viewed Card — Design Spec

**Date:** 2026-10-04
**Author:** brainstormed with Claude (Voyage)
**Status:** Draft — pending review
**Scope:** Voyage-Client (calendar day tiles, day popover, legend, a new Recently viewed card, refresh after a reply) + Voyage-Server (calendar `needsReply`, dashboard `recentViews`, cache clearing on reply)
**Builds on:** `2026-10-03-dashboard-calendar-glass-redesign-design.md` (the calendar, the day popover, the Insights and Your work columns)

---

## 1. Goal

Without a click, a calendar day tile shows only:

- a day number;
- up to three dots and "+N".

Five kinds of client activity all draw as the same grey dot:

- link sent;
- link viewed;
- comment;
- rating;
- review.

So a comment waiting for your reply looks exactly like a link view. Only link expiries have their own colour (amber).

This change:

- makes each tile show **what needs you** at a glance, as coloured action icons, with everything else folded into a quiet grey count;
- adds a **Recently viewed** card to the dashboard, so you can see which itineraries clients are opening.

## 2. Decisions made while brainstorming

| Question | Decision |
|---|---|
| What should a tile say first? | What needs you. Plain activity stays in the background. |
| What counts as "needs you"? | Four things: unanswered comments, links expiring, low ratings and trips departing soon. |
| Tile style | Action icons. Rejected: a count badge, and a tinted tile with words. |
| Where do itinerary views go? | A Recently viewed card on the dashboard. |
| Considered and not chosen | A views line in the trip slide-over. A view count on the Itineraries page. De-duplicated ("trustworthy") view counts. |

## 3. Action rules

| Action | Rule | Icon | Colour |
|---|---|---|---|
| Comment needs a reply | A `client_commented` event whose comment is still `PENDING` with no `agencyRepliedAt`. "Needs you today" uses the same rule for unread comments. A reply sets `ADDRESSED`, and nothing sets `SEEN` today, so in practice this means "not replied to". | `comment` | danger |
| Low rating | A `proposal_rated` or `review_submitted` event with `rating <= 3`, on the day it arrived, whatever its age. | `star` | danger |
| Link expiring | A `share_expires` event on today or a later day, by the viewer's local date. Past expiries are quiet. | `clock` | warning |
| Departs soon | A trip whose first day is today through 7 days out, inclusive. Shown on its first-day tile only. | `briefcase` | success |

**Quiet activity** is everything else:

- `share_sent`;
- `client_viewed`;
- comments that have been answered;
- ratings of 4 or 5;
- past link expiries.

Trips keep their bar and destination label and are not counted as quiet activity.

**Priority**, when a tile has more kinds than it can show: reply, then low rating, then link expiring, then departs soon. Items of the same kind are counted, not listed.

**Icons** come from `KindIcon`: `comment`, `star`, `clock` and `briefcase`. "Needs you today" already uses this set, and `briefcase` is the icon of the staff "Starting soon" row. `KindIcon` needs no change.

**Why low ratings stay flagged at any age.** On a calendar, a bad rating is history worth spotting when browsing back. It marks a past day; it doesn't nag.

**Why any future expiry is amber.** "Needs you today" uses a 48-hour window. On a calendar, though, each expiry sits on its own deadline day, so every upcoming one is useful for planning.

## 4. Day tile

### Width tiers

Tile widths measured in the browser on 2026-10-04:

| Screen width | Tile width |
|---|---|
| 375px (phone) | 37px |
| 602px | 69px |
| 1024px (laptop) | 65px |
| 1280px | 96px |

Tiles have 6px of padding, so what a tile shows follows **the tile's own width**, not the screen's. Make each tile a CSS container (Tailwind 4 `@container`, with `@min-[…]:` variants):

| Tile width | Shows |
|---|---|
| under 60px (phones) | The top action icon, wrapped onto a line under the day number. A day with only quiet activity shows `·N` there instead. |
| 60–83px | The top action icon beside the day number, with its count when it is above 1 ("2"). Then `+N`, counting the day's other action items. A day with only quiet activity shows `·N`. |
| 84px and up | Up to two action icons, each with its count when it is above 1. Then `+N`, counting action items of further kinds. `·N` for quiet activity, shown only when at most one action kind is drawn. |

The 60px and 84px thresholds are starting values. Tune them in browser QA at 375, 1024 and 1280px.

### Details

- **Text sizes and colours:**
  - counts, `+N` and `·N` are 11px text;
  - a count takes its icon's colour;
  - `+N` is `text-text-primary`, semibold;
  - `·N` is `text-text-muted`.
- **Icons:** 12 to 13px and `aria-hidden`. The tile's label carries their meaning.
- **Unchanged:**
  - the day number;
  - the trip bar and destination label;
  - today's dashed outline;
  - the selected state;
  - the loading skeleton;
  - keyboard navigation.
- **Overlap:** the marks never overlap the day number. The tile keeps `overflow-hidden` as a last resort.

### Colours and contrast

- Icons and counts use `text-status-danger`, `text-status-warning` and `text-status-success`.
- In both themes:
  - every icon must reach at least 3:1 against the tile;
  - every count, `+N` and `·N` must reach at least 4.5:1.

  The tile is `--frame-tile` over the calendar card's `--frame-tile` over `--color-background`. Tests compute this numerically with `tests/helpers/themeTokens.js`.
- If a status colour misses, the fix is a token change reviewed with the user, not a one-off colour in a component.

### Spoken label

The tile's `aria-label` lists what is on the day, instead of "N items". For example:

> Saturday, October 3, 2026, today: 1 comment needs a reply, 1 link expiring, 2 other updates

- **Order:**
  1. replies
  2. low ratings
  3. links expiring
  4. trips departing soon
  5. other trips on the day
  6. other updates

  Parts with a count of zero are left out.
- **Phrases**, singular then plural:

  | Kind | Singular | Plural |
  |---|---|---|
  | Reply needed | 1 comment needs a reply | 2 comments need a reply |
  | Low rating | 1 low rating | 2 low ratings |
  | Link expiring | 1 link expiring | 2 links expiring |
  | Departs soon | 1 trip departing soon | 2 trips departing soon |
  | Other trip | 1 trip | 2 trips |
  | Other update | 1 other update | 3 other updates |

- **Empty day:** keeps today's label, "Saturday, October 3, 2026", plus ", today" when it is today.

### Day popover

- **Order:**
  1. action items, in priority order (a departing trip belongs here);
  2. other trips;
  3. quiet activity, oldest first.
- **Badge circles:**

  | Item | Badge |
  |---|---|
  | Reply needed, low rating | danger tint |
  | Upcoming expiry | warning tint |
  | Departs soon | success tint |
  | Other trips | existing terracotta |
  | Quiet activity, including answered comments and past expiries | grey |

  Past expiries lose the amber they have today.
- **Unchanged:** titles, details and the "Reply" / "Open trip" buttons.

### Legend

The legend replaces "Trip / Link expiry / Client activity" with:

| Marker | Label |
|---|---|
| Bar | Trip |
| Comment icon | Needs reply |
| Star | Low rating |
| Clock | Link expires |
| Briefcase | Departs soon |
| `·N` | Other activity |

It wraps on narrow screens, as it does now.

## 5. Recently viewed card

### Placement

- **Owner and admin:** in the Insights column, directly above "Latest reviews".
- **Staff:** in the "Your work" column, directly above "Recent trips". Staff see only trips they created or organize, the same rule as the calendar and to-do list.

### Content

- **Heading:** "Recently viewed", with "Last 30 days" on the right in muted text.
- **Which trips:**
  - one row per trip, newest view first;
  - at most 5 trips;
  - the first 3 show, with a "Show all (N)" / "Show fewer" toggle. This copies the Latest reviews pattern: `aria-expanded` and a 44px target.
- **Each row** is a button styled like the "Recent trips" rows (`frame-tile`, 12px radius):
  - first line: the trip title, and an eye icon with "5 views";
  - second line: the client name and the last-view time ("Just now", "5m ago", "2h ago", "3d ago").
- **Accessible name:** "Elen itinerary, Jay, 5 views, last viewed 2 hours ago".
- **Click:** opens the trip slide-over, with the same handler calendar items use.
- **Period switcher:** the 7d / 30d / 90d switcher does not affect the card.
- **Empty state:** the compact `EmptyState`, with a new `views` variant:
  - title: "No client views in the last 30 days";
  - body: "Views show up here when a client opens a shared itinerary link."
- **Older server:** if the payload has no `recentViews`, the card doesn't render at all.

### How views are counted

The server keeps only a total and a last-view time per share link, and it counts every page load, including refreshes and team members' own visits. So:

- **Views:** a trip's views are the sum of `viewCount` over all its links, revoked and expired links included, since those views happened.
- **Last view:** the latest `lastViewedAt` over its links.
- **Window:** the 30-day window applies to the last view; the count itself is all-time.
- **Client name:** the name on the most recently viewed link, or else the trip's client name.
- **Excluded:** archived trips, and links without a trip.

Relative times are computed in the browser after mount and refresh every minute, so the server-rendered HTML and the browser agree. This is the same approach as the calendar's date handling.

## 6. Data and API changes (Voyage-Server)

### Calendar: `GET /agencies/:agencyId/dashboard/calendar`

- `calendarRepository.ts`: the comments query also selects `status` and `agencyRepliedAt`.
- `calendar.ts`: `client_commented` events add `detail.needsReply`, which is `status === "PENDING" && agencyRepliedAt === null`.
- `dashboardSchemas.ts` and `dashboardTypes.ts`: an event's `detail` gains an optional `needsReply: boolean`.
- No other event changes. The client classifies ratings, expiries and departures from data it already gets.

### Dashboard: `GET /agencies/:agencyId/dashboard`

- `dashboardRepository.ts`: the shares query also selects `clientName`.
- `aggregations.ts`: a new pure `selectRecentViews({ trips, shares, now, userId? })` returns `RecentView[]` by the rules in §5. It is scoped to the staff member's trips when `userId` is given.
- Owner and staff payloads gain `recentViews: RecentView[]`:
  - each item is `{ tripId, tripTitle, clientName: string | null, viewCount, lastViewedAt }`, with `lastViewedAt` as an ISO string;
  - at most 5 items, newest first.
- Update the schemas and types.
- Regenerate the client's contract fixture with

  ```
  npx tsx scripts/export-dashboard-fixtures.ts > ../Voyage-Client/tests/fixtures/dashboard-payloads.json
  ```

  Give the fixture's dataset some viewed shares, so the card renders in the contract test.

### Clearing caches on reply

Both payloads are cached for 60 seconds per agency, and nothing clears them early. After `POST /agencies/:agencyId/shares/comments/:commentId/reply` succeeds:

- clear the agency's dashboard cache with `dashboardService.invalidate(agencyId)`. It exists already, but nothing calls it, and it misses staff entries, whose keys end in the user id (`${agencyId}:staff:${period}:${userId}`). It switches to the prefix invalidation below;
- clear the agency's calendar cache entries. Their keys are `${agencyId}:${scope}:${from}:${to}`, so add a prefix invalidation to `TtlCache` (`invalidatePrefix(prefix)`) and call it with `${agencyId}:`.

## 7. Client changes (Voyage-Client)

| File | Change |
|---|---|
| `app/lib/calendarDays.js`, or a new `app/lib/calendarActions.js` | Pure rules: classify a day's events and trips into action kinds, with counts, the quiet count, the priority order and the spoken summary. Sort the popover's items. |
| `widgets/AgencyCalendar.jsx` | Replace `DayDots` with an action-marks component that has the width tiers. New `aria-label`. New legend. Accept a `refreshKey` prop that refetches the visible month. |
| `widgets/CalendarDayPopover.jsx` | Item order and badge tones. |
| `widgets/RecentlyViewedPanel.jsx` (new) | The card. |
| `widgets/EmptyState.jsx` | `views` variant. |
| `widgets/InsightsColumn.jsx`, `widgets/MyWorkColumn.jsx` | Mount the card. MyWorkColumn receives the handler that opens the slide-over. |
| `OwnerOverview.jsx`, `StaffMyWork.jsx` | Pass `recentViews` and the handlers down. After a reply from the slide-over, refetch the dashboard and bump the calendar's `refreshKey`. |
| `TripSlideOver.jsx` | Optional `onReplied()`, called after a reply succeeds. |
| `app/lib/relativeTime.js` (new), plus a `useNow` hook | A shared "2h ago" helper, moved from MyWorkColumn with the same output, and a mount-safe clock that ticks each minute. |

## 8. Freshness and mismatched deploys

- **A reply from the slide-over** clears its red icon and its "Needs you today" row straight away: the client refetches, and the server clears its caches.
- **Replies made elsewhere** (Itineraries page, Command Center) show within about a minute. The calendar and the dashboard data each refresh every 60 seconds while the page is visible, and both refetch when the Dashboard opens. The server clears its caches on every reply, so those refreshes get fresh data.
- **New views** reach the card within the 60-second poll plus the 60-second cache: about two minutes at worst.
- **Separate deploys.** The client (Vercel) and server (Railway) deploy separately:
  - a new client with an old server: comments without `needsReply` stay quiet, so there is no false red, and a missing `recentViews` hides the card;
  - an old client with a new server: the new fields are ignored.

## 9. Errors

- The card lives inside the columns that wait for the dashboard data, so it shares their skeleton and their stale-data banner.
- The calendar keeps "Couldn't load the calendar." with Retry.
- If the refetch after a reply fails, the old data stays on screen. The next poll or visit corrects it.

## 10. Testing

**Server (Vitest):**

- **Calendar:**
  - `needsReply` is true for a `PENDING` comment with no reply;
  - it is false once the comment is replied to or `ADDRESSED`;
  - it appears only on comment events.
- **`selectRecentViews`:**
  - views are summed per trip, and the latest view wins;
  - 29 days back is in, 31 days back is out;
  - at most 5 trips, newest first;
  - archived trips and links without a trip are excluded;
  - views on revoked links are counted;
  - the client name falls back to the trip's;
  - a staff member sees only their trips.
- **Schemas:** the payload schemas accept `recentViews` and `needsReply`, and both the owner and staff payloads include `recentViews`.
- **Caches:**
  - the reply route clears the dashboard and calendar caches (spy on the invalidation calls);
  - `TtlCache.invalidatePrefix` removes only matching keys.

**Client (Vitest and Testing Library):**

- **Rules module:**
  - rating 3 versus 4;
  - an expiry yesterday, today and next week;
  - a departure today, at +7 days, at +8 days, and one already started;
  - `needsReply` true, false and missing;
  - priority order, counts and the quiet count;
  - the spoken summary's grammar.
- **Tile:**
  - the marks in each tier (assert the container-query classes);
  - `+N`, and `·N` only where allowed;
  - the `aria-label`;
  - the legend entries.
- **Popover:** item order and badge tone classes.
- **Contrast:** status icon colours at least 3:1, and count text at least 4.5:1, on the composited tile in both themes.
- **Card:**
  - rows and their order;
  - "Show all" / "Show fewer";
  - a click opens the slide-over for that trip;
  - the empty state;
  - hidden when `recentViews` is missing;
  - accessible names;
  - relative time appears after mount.
- **Refresh after a reply:** `onReplied` triggers a dashboard refetch and a calendar refetch.
- **Contract test:** passes with the regenerated fixture.

**Browser QA**, in light and dark at 375, 1024 and 1280px:

- the tile tiers fit without overlap;
- the legend wraps;
- the card appears in both the owner and staff columns;
- a reply clears its red icon.

## 11. Out of scope

- De-duplicated view counts, per-day view history and unique viewers.
- A views line in the trip slide-over, and view counts on the Itineraries page.
- The Itineraries header overlap at 1280px, which is tracked as a separate task.
- Hover previews on tiles.
