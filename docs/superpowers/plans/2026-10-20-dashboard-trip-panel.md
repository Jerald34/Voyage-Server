# Dashboard Trip Panel, Client Comments and Honest Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make client comments easy to find and answer from the agency dashboard, and make every dashboard button do what its label says.

**Architecture:** The dashboard's comments-only side panel (`TripSlideOver`) becomes a real trip panel. One new server call (`GET /agencies/:id/dashboard/trips/:tripId`) feeds it the trip, its share link and every comment, with stop names already looked up. The dashboard payload gains a `clientComments` list (Waiting / Answered) for a new card. Funnel stages and staff counters gain the trip lists behind their numbers, which open one shared `TripListPanel`. A new `PATCH /shares/:id/expiry` makes "Extend" real. Share and comment events now refresh the dashboard cache.

**Tech Stack:** Voyage-Server: Express, Prisma 7, Zod, Vitest and Supertest. Voyage-Client: Next.js 16 (App Router, client components), React 19, Tailwind, Vitest and Testing Library.

---

## Design decisions (approved in chat 2026-10-20, no separate spec)

1. **Trip panel, option A: stacked sections.** The header shows status, title, client, dates and travelers. Below it come **Shared link** (views, last viewed, rating, expiry, Extend 7 / 30 days), then **Comments** (waiting first, then answered, each with an inline reply), then the "Open in Planner →" footer.
2. **Where the panel opens.** It opens at what was clicked:
   - Reply on a comment row, a "Client comments" card row, or a calendar comment → that comment, with its reply box open.
   - Extend, or a calendar link-expiry item → the Shared link section.
   - Everything else → the top.
   - "Open trip" always opens this panel. "Resume" on a stuck draft still opens the Planner.
3. **Client comments card, placement A.** It sits in the main column under "Needs you today" on both dashboards, with Waiting / Answered filters. Answered covers replies in the last 30 days, newest first, up to 20. Waiting covers unanswered comments, oldest first, up to 50. Staff see only their own trips.
4. **Comment rows in "Needs you today"** read "Comment from Maria Santos". The quote is still the fallback when the server sends no name.
5. **Real Extend.** `PATCH /agencies/:agencyId/shares/:shareId/expiry` takes `{ extendDays: 7 | 30 }`. The new expiry is `max(now, current expiry) + days`. A revoked link gets 409 `SHARE_REVOKED`, and a link that never expires gets 409 `SHARE_NEVER_EXPIRES`. Staff "Nudge" becomes "Extend".
6. **Trip progress counts trips.** Each stage is "trips created in the period that reached this stage": has an itinerary, ever shared, ever viewed, approved. Shared ≤ drafted ≤ created holds by construction. Each stage sends up to 50 trips, and clicking a stage lists them in `TripListPanel`.
7. **Staff counters open `TripListPanel`.** The user picked this over filtering the Itineraries page, because that page hides draft trips. Each counter lists its trips, and "Traveling now" uses the trip dates.
8. **Bug fixes rolled in:**
   - The trip header's Comments badge counts only that trip.
   - The mobile Comments button gets the badge too.
   - The panel shows the real stop name. The server resolves `itemId` → title, where before the code read an `itemTitle` field nobody sent.
   - The dead `parentId` filter is removed.
   - A new comment, a link view, a client rating, and creating, revoking or extending a link all clear the dashboard and calendar caches.

## Ground rules for whoever executes this

- **Branch:** `feat/dashboard-trip-panel` in **both** repos (already created from `staging`). Never create or switch branches.
- **Commits:** never add a `Co-Authored-By` line (user rule).
- **Server tests:** `cd Voyage-Server && npx vitest run tests/<file>.test.ts`. Full suite: `npx vitest run`. Typecheck: `npx tsc --noEmit`.
- **Client tests:** `cd Voyage-Client && npx vitest run --pool=threads tests/<file>`. Full suite: `npm test`. Build: `npm run build`.
- **Known pre-existing failures** (not yours): about 11 stale server tests and 8 stale client test files. Compare against `staging` before calling something a regression.
- **OneDrive:** if a dev server serves stale code, stop it, delete `Voyage-Client/.next/dev`, and restart.
- **Shell:** run the fixture export (Task 9) in **Git Bash**. PowerShell's `>` writes UTF-16 and breaks the JSON import.

## File map

**Voyage-Server**
| File | Change |
|---|---|
| `src/modules/dashboard/dashboardRepository.ts` | comment author/reply/day/item fields, `itemTitles` lookup |
| `src/modules/dashboard/aggregations.ts` | `authorName` on unread-comment worklist rows |
| `src/modules/dashboard/clientComments.ts` | **new**: pure `selectClientComments` |
| `src/modules/dashboard/tripLists.ts` | **new**: `toTripListRows`, `selectFunnelCohort` |
| `src/modules/dashboard/dashboardService.ts` | wire clientComments, cohort funnel with trips, `pipelineTrips` |
| `src/modules/dashboard/dashboardTypes.ts` / `dashboardSchemas.ts` | new payload fields, trip preview types, params schema |
| `src/modules/dashboard/tripPreviewRepository.ts` | **new**: Prisma reads for one trip |
| `src/modules/dashboard/tripPreviewService.ts` | **new**: `buildTripPreview` + service |
| `src/modules/dashboard/dashboardRoutes.ts` | `GET /trips/:tripId` |
| `src/modules/shares/shareExpiry.ts` | **new**: `computeExtendedExpiry` |
| `src/modules/shares/shareSchemas.ts`, `shareTypes.ts`, `shareRepository.ts`, `shareService.ts`, `shareRoutes.ts` | extend link, activity hook, invalidation |
| `src/modules/reviews/reviewService.ts` | invalidate dashboards after a rating |
| `scripts/export-dashboard-fixtures.ts` | new comment fields + stop titles |

**Voyage-Client** (`D` = `app/agency/[agencyId]/components/dashboard`)
| File | Change |
|---|---|
| `app/lib/api/dashboard.js` | **new**: `fetchTripPreview` |
| `app/lib/api/shares.js`, `app/lib/api/index.js` | `extendShare`, exports |
| `app/hooks/useTripPreview.js` | **new**: load hook with stale-response guard |
| `D/tripPanel/tripPanelFormat.js` | **new**: pure text helpers |
| `D/tripPanel/CommentCard.jsx`, `D/tripPanel/CommentsSection.jsx` | **new** (CommentCard moved out of TripSlideOver) |
| `D/tripPanel/SharedLinkSection.jsx` | **new**: link state + Extend |
| `D/widgets/TripStatusChip.jsx` | **new**: extracted from MyWorkColumn |
| `D/TripSlideOver.jsx` | rewritten body: trip panel |
| `D/needsYouItems.js`, `D/worklistContext.js` | author label, `rowId`, Extend, `needsYouTarget` |
| `D/widgets/ClientCommentsCard.jsx` | **new** |
| `D/widgets/TripListPanel.jsx` | **new** (replaces `FunnelStageDetailPanel.jsx`, deleted) |
| `D/widgets/FunnelChart.jsx`, `D/widgets/InsightsColumn.jsx`, `D/widgets/MyWorkColumn.jsx` | trip lists |
| `D/OwnerOverview.jsx`, `D/StaffMyWork.jsx` | wiring |
| `app/lib/calendarDays.js`, `D/widgets/AgencyCalendar.jsx` | panel focus from calendar items |
| `app/components/trip-dashboard/HomePage.jsx` | drop `onOpenItineraries` |
| `app/components/trip-dashboard/pages/ClientItineraryPage.jsx` | per-trip badge, mobile badge |

---

# Part 1 — Voyage-Server

### Task 1: Comment details and stop titles in the dashboard read

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/dashboardRepository.ts`
- Test: `Voyage-Server/tests/dashboardRepository.test.ts`

- [ ] **Step 1: Write the failing tests.** In `tests/dashboardRepository.test.ts`, add `itineraryItem` to `fakeClient()`, then add the two tests.

```ts
function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itinerary: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryItem: { findMany: vi.fn().mockResolvedValue([]) },
    tripReview: { findMany: vi.fn().mockResolvedValue([]) }
  };
}
```

Add these inside the existing `describe("dashboard repository", ...)`:

```ts
  it("reads each comment's author, reply and stop, and looks up the stop titles once", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    client.itineraryComment.findMany.mockResolvedValue([
      { id: "c1", shareId: "share-1", itemId: "item-1" },
      { id: "c2", shareId: "share-1", itemId: "item-1" },
      { id: "c3", shareId: "share-1", itemId: null }
    ]);
    client.itineraryItem.findMany.mockResolvedValue([{ id: "item-1", title: "Ryokan check-in" }]);

    const raw = await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryComment.findMany.mock.calls[0][0].select).toMatchObject({
      authorName: true,
      agencyReply: true,
      dayNumber: true,
      itemId: true
    });
    expect(client.itineraryItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["item-1"] } },
      select: { id: true, title: true }
    });
    expect(raw.itemTitles).toEqual([{ id: "item-1", title: "Ryokan check-in" }]);
  });

  it("skips the stop lookup when no comment points at a stop", async () => {
    const client = fakeClient();
    client.itineraryShare.findMany.mockResolvedValue([{ id: "share-1" }]);
    client.itineraryComment.findMany.mockResolvedValue([{ id: "c1", shareId: "share-1", itemId: null }]);

    const raw = await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryItem.findMany).not.toHaveBeenCalled();
    expect(raw.itemTitles).toEqual([]);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/dashboardRepository.test.ts`
Expected: FAIL. The select lacks `authorName`, and `raw.itemTitles` is undefined.

- [ ] **Step 3: Implement.** In `dashboardRepository.ts`, extend the `comments` entry of `RawDashboardData` and add `itemTitles`:

```ts
  comments: Array<{
    id: string;
    shareId: string;
    content: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    agencyRepliedAt: Date | null;
    createdAt: Date;
    /** Who wrote it, as typed on the share page. */
    authorName: string;
    agencyReply: string | null;
    dayNumber: number | null;
    /** The ItineraryItem the comment is on; its title is in `itemTitles`. */
    itemId: string | null;
  }>;
```

and after the `reviews` entry:

```ts
  /**
   * Titles of the stops comments point at. Optional so hand-built fixtures can
   * leave it out; a missing entry means the stop has no known title.
   */
  itemTitles?: Array<{ id: string; title: string }>;
```

Replace the comment fetch and the return at the end of `fetchAgencyDashboardData`:

```ts
      // Comments are joined via shares — fetch by shareId set.
      const shareIds = shares.map((s) => s.id);
      const comments = shareIds.length
        ? await client.itineraryComment.findMany({
            where: { shareId: { in: shareIds } },
            select: {
              id: true,
              shareId: true,
              content: true,
              status: true,
              agencyRepliedAt: true,
              createdAt: true,
              authorName: true,
              agencyReply: true,
              dayNumber: true,
              itemId: true
            }
          })
        : [];

      // One lookup for every stop a comment points at, so the dashboard can name it.
      const itemIds = [...new Set(comments.flatMap((c) => (c.itemId ? [c.itemId] : [])))];
      const itemTitles = itemIds.length
        ? await client.itineraryItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, title: true }
          })
        : [];

      return { trips, itineraries, shares, comments, reviews, itemTitles };
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run tests/dashboardRepository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/dashboardRepository.ts tests/dashboardRepository.test.ts
git commit -m "feat(dashboard): read comment author, reply and stop for the dashboard"
```

---

### Task 2: Unread-comment rows carry the author's name

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/aggregations.ts` (the `WorklistInputs` comments type, `OwnerWorklistResult`, and the `unreadComments` map in `selectOwnerWorklistRows`)
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts` (`OwnerWorklistUnreadComment`)
- Modify: `Voyage-Server/src/modules/dashboard/dashboardSchemas.ts` (both `unreadComments` item schemas)
- Test: `Voyage-Server/tests/dashboardAggregations.test.ts`, `Voyage-Server/tests/dashboardService.test.ts` (helpers only)

- [ ] **Step 1: Update the test helpers and write the failing test.** In `tests/dashboardAggregations.test.ts`, give the `comment()` helper the new fields:

```ts
function comment(overrides: Partial<Parameters<typeof selectOwnerWorklistRows>[0]["comments"][number]> = {}) {
  return {
    id: "c1",
    shareId: "s1",
    content: "Looks great",
    status: "PENDING" as const,
    agencyRepliedAt: null,
    createdAt: NOW,
    authorName: "Maria Santos",
    agencyReply: null,
    dayNumber: null,
    itemId: null,
    ...overrides
  };
}
```

Add this test inside `describe("selectOwnerWorklistRows", ...)`:

```ts
  it("names who wrote each unread comment", () => {
    const result = selectOwnerWorklistRows({
      trips: [trip()],
      shares: [share()],
      comments: [comment({ authorName: "Leo Cruz" })],
      now: NOW
    });
    expect(result.unreadComments[0]).toMatchObject({ id: "c1", authorName: "Leo Cruz" });
  });
```

In `tests/dashboardService.test.ts`, update `makeComment` the same way, so the payload schemas still parse:

```ts
function makeComment(
  id: string,
  shareId: string,
  overrides: Partial<RawDashboardData["comments"][number]> = {}
): RawDashboardData["comments"][number] {
  return {
    id,
    shareId,
    content: "Test comment",
    status: "PENDING",
    agencyRepliedAt: null,
    createdAt: NOW,
    authorName: "Maria Santos",
    agencyReply: null,
    dayNumber: null,
    itemId: null,
    ...overrides
  };
}
```

- [ ] **Step 2: Run to make sure the new test fails**

Run: `npx vitest run tests/dashboardAggregations.test.ts -t "names who wrote"`
Expected: FAIL, because `authorName` is missing from the row.

- [ ] **Step 3: Implement.** In `aggregations.ts`, add `authorName: string;` to the `comments` element type of `WorklistInputs`, after `createdAt`. Change the `unreadComments` entry of `OwnerWorklistResult` to:

```ts
  unreadComments: Array<{ id: string; tripId: string; tripTitle: string; authorName: string; commentExcerpt: string; createdAt: string }>;
```

In `selectOwnerWorklistRows`, make the map return:

```ts
      return {
        id: c.id,
        tripId,
        tripTitle: trip?.title ?? "(untitled)",
        authorName: c.authorName,
        commentExcerpt: c.content.slice(0, 140),
        createdAt: c.createdAt.toISOString()
      };
```

In `dashboardTypes.ts`, add `authorName: string;` to `OwnerWorklistUnreadComment` after `tripTitle`. In `dashboardSchemas.ts`, add `authorName: z.string(),` after `tripTitle: z.string(),` in **both** the owner and staff `unreadComments` object schemas.

- [ ] **Step 4: Run the dashboard tests**

Run: `npx vitest run tests/dashboardAggregations.test.ts tests/dashboardService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/aggregations.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts tests/dashboardAggregations.test.ts tests/dashboardService.test.ts
git commit -m "feat(dashboard): name the author on unread-comment to-do rows"
```

---

### Task 3: `selectClientComments` — the Waiting / Answered lists

**Files:**
- Create: `Voyage-Server/src/modules/dashboard/clientComments.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts`
- Test: `Voyage-Server/tests/dashboardClientComments.test.ts`

- [ ] **Step 1: Add the types.** Append to the Owner section of `dashboardTypes.ts`:

```ts
/** One client comment on the dashboard's "Client comments" card. */
export type ClientCommentRow = {
  id: string;
  shareId: string;
  tripId: string;
  tripTitle: string;
  /** Who the link was shared with, else the trip's client. */
  clientName: string | null;
  authorName: string;
  excerpt: string;
  dayNumber: number | null;
  /** The stop's title; null for a day-level comment or a deleted stop. */
  itemTitle: string | null;
  createdAt: string;
  agencyReply: string | null;
  agencyRepliedAt: string | null;
};

export type ClientComments = {
  /** No reply yet, oldest first. */
  waiting: ClientCommentRow[];
  /** Replied in the last 30 days, newest reply first. */
  answered: ClientCommentRow[];
};
```

- [ ] **Step 2: Write the failing tests** in `tests/dashboardClientComments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ANSWERED_LIMIT,
  WAITING_LIMIT,
  selectClientComments
} from "../src/modules/dashboard/clientComments";
import type { RawDashboardData } from "../src/modules/dashboard/dashboardRepository";

const NOW = new Date("2026-10-20T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type Trip = RawDashboardData["trips"][number];
type Share = RawDashboardData["shares"][number];
type Comment = RawDashboardData["comments"][number];

const trip = (id: string, fields: Partial<Trip> = {}): Trip => ({
  id,
  title: `Trip ${id}`,
  status: "IN_REVIEW",
  createdAt: at(-10 * DAY),
  updatedAt: at(-1 * DAY),
  startDate: null,
  endDate: null,
  travelerCount: null,
  clientName: "Trip Client",
  createdByUserId: "u1",
  assignedOrganizerUserId: null,
  ...fields
});

const share = (id: string, tripId: string | null, fields: Partial<Share> = {}): Share => ({
  id,
  tripId,
  clientName: null,
  viewCount: 0,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  proposalRatedAt: null,
  createdAt: at(-5 * DAY),
  ...fields
});

const comment = (id: string, shareId: string, fields: Partial<Comment> = {}): Comment => ({
  id,
  shareId,
  content: `Question ${id}`,
  status: "PENDING",
  agencyRepliedAt: null,
  createdAt: at(-2 * HOUR),
  authorName: "Maria Santos",
  agencyReply: null,
  dayNumber: null,
  itemId: null,
  ...fields
});

describe("selectClientComments", () => {
  it("splits comments into waiting (oldest first) and answered (newest reply first)", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [
        comment("new", "s1", { createdAt: at(-1 * HOUR) }),
        comment("old", "s1", { createdAt: at(-5 * HOUR) }),
        comment("replied-early", "s1", { status: "ADDRESSED", agencyReply: "Yes", agencyRepliedAt: at(-3 * DAY) }),
        comment("replied-late", "s1", { status: "ADDRESSED", agencyReply: "Done", agencyRepliedAt: at(-1 * DAY) })
      ],
      now: NOW
    });

    expect(result.waiting.map((row) => row.id)).toEqual(["old", "new"]);
    expect(result.answered.map((row) => row.id)).toEqual(["replied-late", "replied-early"]);
  });

  it("describes each row with the trip, the client, the stop and the reply", () => {
    const result = selectClientComments({
      trips: [trip("t1", { title: "Kyoto Autumn Escape" })],
      shares: [share("s1", "t1", { clientName: "Santos Family" })],
      comments: [
        comment("c1", "s1", {
          content: "Is the ryokan wheelchair accessible?",
          dayNumber: 1,
          itemId: "item-1",
          status: "ADDRESSED",
          agencyReply: "Yes, it is.",
          agencyRepliedAt: at(-1 * HOUR)
        })
      ],
      itemTitles: [{ id: "item-1", title: "Ryokan check-in" }],
      now: NOW
    });

    expect(result.answered[0]).toEqual({
      id: "c1",
      shareId: "s1",
      tripId: "t1",
      tripTitle: "Kyoto Autumn Escape",
      clientName: "Santos Family",
      authorName: "Maria Santos",
      excerpt: "Is the ryokan wheelchair accessible?",
      dayNumber: 1,
      itemTitle: "Ryokan check-in",
      createdAt: at(-2 * HOUR).toISOString(),
      agencyReply: "Yes, it is.",
      agencyRepliedAt: at(-1 * HOUR).toISOString()
    });
  });

  it("falls back to the trip's client and leaves an unknown stop untitled", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [comment("c1", "s1", { itemId: "deleted-item", dayNumber: 2 })],
      itemTitles: [],
      now: NOW
    });
    expect(result.waiting[0]).toMatchObject({ clientName: "Trip Client", dayNumber: 2, itemTitle: null });
  });

  it("drops replies older than 30 days and comments without a trip", () => {
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1"), share("s-personal", null), share("s-gone", "t-deleted")],
      comments: [
        comment("stale", "s1", { status: "ADDRESSED", agencyReply: "Ok", agencyRepliedAt: at(-31 * DAY) }),
        comment("personal", "s-personal"),
        comment("orphan", "s-gone")
      ],
      now: NOW
    });
    expect(result).toEqual({ waiting: [], answered: [] });
  });

  it("keeps only the given trips for the staff view", () => {
    const result = selectClientComments({
      trips: [trip("mine"), trip("theirs")],
      shares: [share("s-mine", "mine"), share("s-theirs", "theirs")],
      comments: [comment("c-mine", "s-mine"), comment("c-theirs", "s-theirs")],
      now: NOW,
      tripIds: new Set(["mine"])
    });
    expect(result.waiting.map((row) => row.id)).toEqual(["c-mine"]);
  });

  it("caps both lists", () => {
    const many = Array.from({ length: WAITING_LIMIT + 5 }, (_, i) =>
      comment(`w${i}`, "s1", { createdAt: at(-(i + 1) * HOUR) })
    );
    const answered = Array.from({ length: ANSWERED_LIMIT + 5 }, (_, i) =>
      comment(`a${i}`, "s1", { status: "ADDRESSED", agencyReply: "Ok", agencyRepliedAt: at(-(i + 1) * HOUR) })
    );
    const result = selectClientComments({
      trips: [trip("t1")],
      shares: [share("s1", "t1")],
      comments: [...many, ...answered],
      now: NOW
    });
    expect(result.waiting).toHaveLength(WAITING_LIMIT);
    expect(result.answered).toHaveLength(ANSWERED_LIMIT);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/dashboardClientComments.test.ts`
Expected: FAIL, because the module `clientComments` does not exist.

- [ ] **Step 4: Implement** `src/modules/dashboard/clientComments.ts`:

```ts
import type { RawDashboardData } from "./dashboardRepository";
import type { ClientCommentRow, ClientComments } from "./dashboardTypes";

/**
 * The dashboard's "Client comments" card: comments still waiting for the
 * agency (the same rule as the "Needs you today" rows) and the ones answered
 * recently, so an agent can look back at what was asked and what they said.
 * Pure: the service hands in the rows and the clock.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How far back the Answered list reaches. */
export const ANSWERED_WINDOW_DAYS = 30;
/** Most rows each list sends. */
export const WAITING_LIMIT = 50;
export const ANSWERED_LIMIT = 20;
const EXCERPT_LENGTH = 280;

export type ClientCommentInputs = {
  trips: RawDashboardData["trips"];
  shares: RawDashboardData["shares"];
  comments: RawDashboardData["comments"];
  itemTitles?: RawDashboardData["itemTitles"];
  now: Date;
  /** Staff view: only comments on these trips. */
  tripIds?: Set<string>;
};

export function selectClientComments(inputs: ClientCommentInputs): ClientComments {
  const tripIndex = new Map(inputs.trips.map((trip) => [trip.id, trip]));
  const shareIndex = new Map(inputs.shares.map((share) => [share.id, share]));
  const titles = new Map((inputs.itemTitles ?? []).map((item) => [item.id, item.title]));
  const answeredCutoff = inputs.now.getTime() - ANSWERED_WINDOW_DAYS * MS_PER_DAY;

  const waiting: ClientCommentRow[] = [];
  const answered: ClientCommentRow[] = [];

  for (const comment of inputs.comments) {
    const share = shareIndex.get(comment.shareId);
    if (!share?.tripId) continue;
    if (inputs.tripIds && !inputs.tripIds.has(share.tripId)) continue;
    const trip = tripIndex.get(share.tripId);
    if (!trip) continue;

    const row: ClientCommentRow = {
      id: comment.id,
      shareId: comment.shareId,
      tripId: trip.id,
      tripTitle: trip.title,
      clientName: share.clientName ?? trip.clientName ?? null,
      authorName: comment.authorName,
      excerpt: comment.content.slice(0, EXCERPT_LENGTH),
      dayNumber: comment.dayNumber,
      itemTitle: comment.itemId ? titles.get(comment.itemId) ?? null : null,
      createdAt: comment.createdAt.toISOString(),
      agencyReply: comment.agencyReply,
      agencyRepliedAt: comment.agencyRepliedAt ? comment.agencyRepliedAt.toISOString() : null
    };

    if (comment.agencyRepliedAt === null) {
      if (comment.status === "PENDING") waiting.push(row);
    } else if (comment.agencyRepliedAt.getTime() >= answeredCutoff) {
      answered.push(row);
    }
  }

  waiting.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  answered.sort((a, b) => (a.agencyRepliedAt! > b.agencyRepliedAt! ? -1 : 1));
  return { waiting: waiting.slice(0, WAITING_LIMIT), answered: answered.slice(0, ANSWERED_LIMIT) };
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run tests/dashboardClientComments.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/clientComments.ts src/modules/dashboard/dashboardTypes.ts tests/dashboardClientComments.test.ts
git commit -m "feat(dashboard): select waiting and answered client comments"
```

---

### Task 4: Trip lists and the trip-cohort funnel

**Files:**
- Create: `Voyage-Server/src/modules/dashboard/tripLists.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts`
- Test: `Voyage-Server/tests/dashboardTripLists.test.ts`

- [ ] **Step 1: Add the types** to `dashboardTypes.ts`, next to `FunnelStage`:

```ts
export type TripStatus = "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";

/** One trip in a dashboard trip list (a funnel stage, a staff counter). */
export type TripListRow = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  status: TripStatus;
};

/** A funnel stage with the trips behind its count (at most 50; `count` stays exact). */
export type FunnelStageWithTrips = FunnelStage & { trips: TripListRow[] };
```

and change `OwnerFunnel` to:

```ts
export type OwnerFunnel = {
  stages: FunnelStageWithTrips[];
};
```

- [ ] **Step 2: Write the failing tests** in `tests/dashboardTripLists.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RawDashboardData } from "../src/modules/dashboard/dashboardRepository";
import { TRIP_LIST_LIMIT, selectFunnelCohort, toTripListRows } from "../src/modules/dashboard/tripLists";

const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const WINDOW = { start: at(-30 * DAY), end: NOW };

type Trip = RawDashboardData["trips"][number];

const trip = (id: string, fields: Partial<Trip> = {}): Trip => ({
  id,
  title: `Trip ${id}`,
  status: "DRAFT",
  createdAt: at(-5 * DAY),
  updatedAt: at(-1 * DAY),
  startDate: null,
  endDate: null,
  travelerCount: null,
  clientName: null,
  createdByUserId: "u1",
  assignedOrganizerUserId: null,
  ...fields
});

const share = (tripId: string, viewCount = 0) => ({
  id: `share-${tripId}-${viewCount}`,
  tripId,
  clientName: null,
  viewCount,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  proposalRatedAt: null,
  createdAt: at(-1 * DAY)
});

describe("selectFunnelCohort", () => {
  it("counts trips created in the window by the furthest stage each reached", () => {
    const trips = [
      trip("bare"),
      trip("drafted"),
      trip("shared"),
      trip("viewed", { status: "APPROVED_INTERNAL" }),
      trip("old", { createdAt: at(-60 * DAY) })
    ];
    const cohort = selectFunnelCohort(
      {
        trips,
        itineraries: ["drafted", "shared", "viewed", "old"].map((id) => ({ id: `it-${id}`, tripId: id, createdAt: NOW })),
        // Two links on one trip still count it once.
        shares: [share("shared"), share("shared"), share("viewed", 3), share("old", 9)]
      },
      WINDOW
    );

    const ids = (key: keyof typeof cohort) => cohort[key].map((t) => t.id).sort();
    expect(ids("created")).toEqual(["bare", "drafted", "shared", "viewed"]);
    expect(ids("drafted")).toEqual(["drafted", "shared", "viewed"]);
    expect(ids("sent")).toEqual(["shared", "viewed"]);
    expect(ids("viewed")).toEqual(["viewed"]);
    expect(ids("approved")).toEqual(["viewed"]);
  });
});

describe("toTripListRows", () => {
  it("lists trips newest first in the chosen order, as rows", () => {
    const rows = toTripListRows(
      [
        trip("a", { createdAt: at(-3 * DAY), updatedAt: at(-1 * DAY), title: "Alpha", clientName: "Ana" }),
        trip("b", { createdAt: at(-1 * DAY), updatedAt: at(-2 * DAY), title: "Beta" })
      ],
      "created"
    );
    expect(rows).toEqual([
      { tripId: "b", tripTitle: "Beta", clientName: null, status: "DRAFT" },
      { tripId: "a", tripTitle: "Alpha", clientName: "Ana", status: "DRAFT" }
    ]);
    expect(toTripListRows([trip("a", { updatedAt: at(-1 * DAY) }), trip("b", { updatedAt: at(-2 * DAY) })], "updated").map((r) => r.tripId)).toEqual(["a", "b"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: TRIP_LIST_LIMIT + 3 }, (_, i) => trip(`t${i}`));
    expect(toTripListRows(many, "created")).toHaveLength(TRIP_LIST_LIMIT);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/dashboardTripLists.test.ts`
Expected: FAIL, because the module `tripLists` does not exist.

- [ ] **Step 4: Implement** `src/modules/dashboard/tripLists.ts`:

```ts
import type { RawDashboardData } from "./dashboardRepository";
import type { FunnelStageKey, TripListRow } from "./dashboardTypes";

/** Most trips any one dashboard list sends; the count beside it stays exact. */
export const TRIP_LIST_LIMIT = 50;

type Trip = RawDashboardData["trips"][number];

/** Trips as list rows, newest first by creation or by last update. */
export function toTripListRows(trips: Trip[], order: "created" | "updated"): TripListRow[] {
  const time = (trip: Trip) => (order === "created" ? trip.createdAt : trip.updatedAt).getTime();
  return [...trips]
    .sort((a, b) => time(b) - time(a))
    .slice(0, TRIP_LIST_LIMIT)
    .map((trip) => ({ tripId: trip.id, tripTitle: trip.title, clientName: trip.clientName, status: trip.status }));
}

/**
 * Trip progress as a cohort: the trips created in the window, and which of
 * them reached each stage (has an itinerary, was ever shared, was ever
 * viewed, is approved). Counting trips rather than links keeps every stage
 * at or below the one before it, except approval, which needs no share.
 */
export function selectFunnelCohort(
  raw: Pick<RawDashboardData, "trips" | "itineraries" | "shares">,
  window: { start: Date; end: Date }
): Record<FunnelStageKey, Trip[]> {
  const created = raw.trips.filter((t) => t.createdAt >= window.start && t.createdAt <= window.end);
  const drafted = new Set(raw.itineraries.flatMap((i) => (i.tripId ? [i.tripId] : [])));
  const shared = new Set(raw.shares.flatMap((s) => (s.tripId ? [s.tripId] : [])));
  const viewed = new Set(raw.shares.flatMap((s) => (s.tripId && s.viewCount > 0 ? [s.tripId] : [])));
  return {
    created,
    drafted: created.filter((t) => drafted.has(t.id)),
    sent: created.filter((t) => shared.has(t.id)),
    viewed: created.filter((t) => viewed.has(t.id)),
    approved: created.filter((t) => t.status === "APPROVED_INTERNAL")
  };
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run tests/dashboardTripLists.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/tripLists.ts src/modules/dashboard/dashboardTypes.ts tests/dashboardTripLists.test.ts
git commit -m "feat(dashboard): trip lists and a trip-cohort funnel"
```

---

### Task 5: Put client comments, stage trips and counter trips in the payloads

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/dashboardService.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardSchemas.ts`
- Test: `Voyage-Server/tests/dashboardService.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `tests/dashboardService.test.ts`, which already provides `makeService`, `makeTrip`, `makeShare`, `makeComment`, `emptyData`, `NOW`, `AGENCY`, `USER_A` and `USER_B`:

```ts
describe("client comments, stage trips and counter trips", () => {
  it("sends the owner every waiting comment and the trips behind each funnel stage", async () => {
    const { svc } = makeService({
      ...emptyData(),
      trips: [makeTrip("t1", { title: "Kyoto", status: "IN_REVIEW" })],
      itineraries: [{ id: "it1", tripId: "t1", createdAt: NOW }],
      shares: [makeShare("s1", "t1", { viewCount: 2 })],
      comments: [makeComment("c1", "s1", { dayNumber: 1, itemId: "item-1" })],
      itemTitles: [{ id: "item-1", title: "Ryokan check-in" }]
    });

    const payload = await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", now: NOW });
    if (payload.view !== "owner") throw new Error("expected the owner view");

    expect(payload.clientComments.waiting).toEqual([
      expect.objectContaining({ id: "c1", tripTitle: "Kyoto", itemTitle: "Ryokan check-in", authorName: "Maria Santos" })
    ]);
    expect(payload.clientComments.answered).toEqual([]);
    const viewed = payload.funnel.stages.find((stage) => stage.key === "viewed")!;
    expect(viewed.count).toBe(1);
    expect(viewed.trips).toEqual([{ tripId: "t1", tripTitle: "Kyoto", clientName: null, status: "IN_REVIEW" }]);
    expect(() => ownerDashboardPayloadSchema.parse(payload)).not.toThrow();
  });

  it("scopes staff comments to their trips and lists the trips behind each counter", async () => {
    const { svc } = makeService({
      ...emptyData(),
      trips: [
        makeTrip("mine-draft", { createdByUserId: USER_B }),
        makeTrip("mine-away", {
          createdByUserId: USER_B,
          status: "APPROVED_INTERNAL",
          startDate: new Date(NOW.getTime() - 86_400_000),
          endDate: new Date(NOW.getTime() + 86_400_000)
        }),
        makeTrip("theirs", { createdByUserId: USER_A })
      ],
      shares: [makeShare("s-mine", "mine-draft"), makeShare("s-theirs", "theirs")],
      comments: [makeComment("c-mine", "s-mine"), makeComment("c-theirs", "s-theirs")]
    });

    const payload = await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", now: NOW });
    if (payload.view !== "staff") throw new Error("expected the staff view");

    expect(payload.clientComments.waiting.map((row) => row.id)).toEqual(["c-mine"]);
    expect(payload.pipelineTrips.drafts.map((row) => row.tripId)).toEqual(["mine-draft"]);
    expect(payload.pipelineTrips.activeNow.map((row) => row.tripId)).toEqual(["mine-away"]);
    expect(payload.pipeline.drafts).toBe(1);
    expect(payload.pipeline.activeNow).toBe(1);
    expect(() => staffDashboardPayloadSchema.parse(payload)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `npx vitest run tests/dashboardService.test.ts -t "client comments, stage trips"`
Expected: FAIL, because `payload.clientComments` is undefined.

- [ ] **Step 3: Update the types.** In `dashboardTypes.ts`:
  - Add `clientComments: ClientComments;` to `OwnerDashboardPayload` after `worklist`.
  - Add the staff types:

```ts
/** The trips behind each staff counter, at most 50 each, most recently updated first. */
export type StaffPipelineTrips = {
  drafts: TripListRow[];
  inReview: TripListRow[];
  approvedThisMonth: TripListRow[];
  activeNow: TripListRow[];
};
```

  - In `StaffDashboardPayload`, add `clientComments: ClientComments;` after `worklist` and `pipelineTrips: StaffPipelineTrips;` after `pipeline`.

- [ ] **Step 4: Update the schemas.** In `dashboardSchemas.ts`, above `ownerWorklistSchema`:

```ts
const tripListRowSchema = z.object({
  tripId: z.string(),
  tripTitle: z.string(),
  clientName: z.string().nullable(),
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED_INTERNAL", "ARCHIVED"])
});

const clientCommentRowSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  tripId: z.string(),
  tripTitle: z.string(),
  clientName: z.string().nullable(),
  authorName: z.string(),
  excerpt: z.string(),
  dayNumber: z.number().int().nullable(),
  itemTitle: z.string().nullable(),
  createdAt: z.string(),
  agencyReply: z.string().nullable(),
  agencyRepliedAt: z.string().nullable()
});

const clientCommentsSchema = z.object({
  waiting: z.array(clientCommentRowSchema),
  answered: z.array(clientCommentRowSchema)
});
```

Change `funnelStageSchema` to include `trips: z.array(tripListRowSchema)`. Add `clientComments: clientCommentsSchema,` after `worklist: ownerWorklistSchema,` in the owner schema. In the staff schema, add `clientComments: clientCommentsSchema,` after `worklist: staffWorklistSchema,`, and this after `pipeline`:

```ts
  pipelineTrips: z.object({
    drafts: z.array(tripListRowSchema),
    inReview: z.array(tripListRowSchema),
    approvedThisMonth: z.array(tripListRowSchema),
    activeNow: z.array(tripListRowSchema)
  }),
```

- [ ] **Step 5: Wire the service.** In `dashboardService.ts`, add these imports:

```ts
import { selectClientComments } from "./clientComments";
import { selectFunnelCohort, toTripListRows } from "./tripLists";
```

In `composeOwnerPayload`, replace the whole `// ---- Funnel ----` block with:

```ts
  // ---- Funnel ----
  // Trips created in the window, by the furthest stage each reached; each
  // stage carries its trips so the dashboard can list them.
  const cohort = selectFunnelCohort(raw, window);
  const funnelStages = computeFunnelStages({
    created: cohort.created.length,
    drafted: cohort.drafted.length,
    sent: cohort.sent.length,
    viewed: cohort.viewed.length,
    approved: cohort.approved.length
  }).map((stage) => ({ ...stage, trips: toTripListRows(cohort[stage.key], "created") }));
```

In the owner return object, add after `worklist,`:

```ts
    clientComments: selectClientComments({
      trips: raw.trips,
      shares: raw.shares,
      comments: raw.comments,
      itemTitles: raw.itemTitles,
      now
    }),
```

In `composeStaffPayload`, replace the `const pipeline = { ... };` block with:

```ts
  const isTravelingNow = (t: RawDashboardData["trips"][number]) =>
    t.startDate !== null && t.endDate !== null && t.startDate <= now && t.endDate >= now;
  const pipelineGroups = {
    drafts: myTrips.filter((t) => t.status === "DRAFT"),
    inReview: myTrips.filter((t) => t.status === "IN_REVIEW"),
    approvedThisMonth: myTrips.filter((t) => t.status === "APPROVED_INTERNAL" && t.updatedAt >= monthStart),
    activeNow: myTrips.filter(isTravelingNow)
  };
  const pipeline = {
    drafts: pipelineGroups.drafts.length,
    inReview: pipelineGroups.inReview.length,
    approvedThisMonth: pipelineGroups.approvedThisMonth.length,
    activeNow: pipelineGroups.activeNow.length
  };
  const pipelineTrips = {
    drafts: toTripListRows(pipelineGroups.drafts, "updated"),
    inReview: toTripListRows(pipelineGroups.inReview, "updated"),
    approvedThisMonth: toTripListRows(pipelineGroups.approvedThisMonth, "updated"),
    activeNow: toTripListRows(pipelineGroups.activeNow, "updated")
  };
```

In the staff return object, add after `worklist,`:

```ts
    clientComments: selectClientComments({
      trips: raw.trips,
      shares: raw.shares,
      comments: raw.comments,
      itemTitles: raw.itemTitles,
      now,
      tripIds: new Set(myTrips.map((t) => t.id))
    }),
```

and add `pipelineTrips,` after `pipeline,`.

- [ ] **Step 6: Run the dashboard tests, then typecheck**

Run: `npx vitest run tests/dashboardService.test.ts tests/dashboardAggregations.test.ts`
Expected: PASS. The existing `funnel.stages[0].count` tests still pass, because stage 0 is unchanged.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/dashboardService.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts tests/dashboardService.test.ts
git commit -m "feat(dashboard): send client comments, stage trips and counter trips"
```

---

### Task 6: `GET /agencies/:agencyId/dashboard/trips/:tripId` — the trip panel's data

**Files:**
- Create: `Voyage-Server/src/modules/dashboard/tripPreviewRepository.ts`
- Create: `Voyage-Server/src/modules/dashboard/tripPreviewService.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts`, `dashboardSchemas.ts`, `dashboardRoutes.ts`
- Test: `Voyage-Server/tests/dashboardTripPreview.test.ts`, `Voyage-Server/tests/dashboardTripPreviewRoutes.test.ts`

- [ ] **Step 1: Add the types** to `dashboardTypes.ts` in a new section:

```ts
// ---------- Trip panel ----------

export type TripPreviewComment = {
  id: string;
  shareId: string;
  authorName: string;
  content: string;
  status: "PENDING" | "SEEN" | "ADDRESSED";
  dayNumber: number | null;
  itemId: string | null;
  /** Null for a day-level comment, or when the stop was deleted. */
  itemTitle: string | null;
  agencyReply: string | null;
  agencyRepliedAt: string | null;
  createdAt: string;
};

export type TripPreview = {
  trip: {
    id: string;
    title: string;
    status: TripStatus;
    clientName: string | null;
    startDate: string | null;
    endDate: string | null;
    travelerCount: number | null;
    destinationSummary: string | null;
  };
  /** The newest live link, else the newest link; null when never shared. */
  share: {
    id: string;
    clientName: string | null;
    viewCount: number;
    lastViewedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    proposalRating: number | null;
    createdAt: string;
  } | null;
  /** Every comment on every link of the trip, oldest first. */
  comments: TripPreviewComment[];
};
```

- [ ] **Step 2: Write the failing unit tests** in `tests/dashboardTripPreview.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { ApiError } from "../src/http/errors";
import type { RawTripPreview } from "../src/modules/dashboard/tripPreviewRepository";
import { buildTripPreview, createTripPreviewService } from "../src/modules/dashboard/tripPreviewService";

const NOW = new Date("2026-10-20T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const HOUR = 60 * 60 * 1000;

const tripRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Kyoto Autumn Escape",
  status: "IN_REVIEW" as const,
  clientName: "Santos Family",
  startDate: new Date("2026-11-03T00:00:00Z"),
  endDate: new Date("2026-11-08T00:00:00Z"),
  travelerCount: 4,
  destinationSummary: "Kyoto"
};

const shareRow = (id: string, fields: Partial<RawTripPreview["shares"][number]> = {}) => ({
  id,
  clientName: null,
  viewCount: 0,
  lastViewedAt: null,
  expiresAt: null,
  revokedAt: null,
  proposalRating: null,
  createdAt: at(-10 * HOUR),
  ...fields
});

function raw(fields: Partial<RawTripPreview> = {}): RawTripPreview {
  return { trip: tripRow, shares: [], comments: [], itemTitles: [], ...fields };
}

describe("buildTripPreview", () => {
  it("returns the trip with ISO dates", () => {
    expect(buildTripPreview(raw()).trip).toEqual({
      ...tripRow,
      startDate: "2026-11-03T00:00:00.000Z",
      endDate: "2026-11-08T00:00:00.000Z"
    });
  });

  it("picks the newest live link over a newer revoked one, and null when never shared", () => {
    const shares = [
      shareRow("revoked-new", { revokedAt: at(-1 * HOUR), createdAt: at(-2 * HOUR) }),
      shareRow("live-old", { viewCount: 4, lastViewedAt: at(-3 * HOUR), expiresAt: at(20 * HOUR), proposalRating: 4 })
    ];
    expect(buildTripPreview(raw({ shares })).share).toEqual({
      id: "live-old",
      clientName: null,
      viewCount: 4,
      lastViewedAt: at(-3 * HOUR).toISOString(),
      expiresAt: at(20 * HOUR).toISOString(),
      revokedAt: null,
      proposalRating: 4,
      createdAt: at(-10 * HOUR).toISOString()
    });
    expect(buildTripPreview(raw({ shares: [shareRow("only", { revokedAt: at(-1 * HOUR) })] })).share?.id).toBe("only");
    expect(buildTripPreview(raw()).share).toBeNull();
  });

  it("names each comment's stop", () => {
    const comments = [
      {
        id: "c1",
        shareId: "live",
        authorName: "Maria",
        content: "Wheelchair?",
        status: "PENDING" as const,
        dayNumber: 1,
        itemId: "item-1",
        agencyReply: null,
        agencyRepliedAt: null,
        createdAt: at(-2 * HOUR)
      },
      {
        id: "c2",
        shareId: "live",
        authorName: "Maria",
        content: "Gone stop",
        status: "PENDING" as const,
        dayNumber: 2,
        itemId: "item-deleted",
        agencyReply: null,
        agencyRepliedAt: null,
        createdAt: at(-1 * HOUR)
      }
    ];
    const preview = buildTripPreview(raw({ comments, itemTitles: [{ id: "item-1", title: "Ryokan check-in" }] }));
    expect(preview.comments.map((c) => c.itemTitle)).toEqual(["Ryokan check-in", null]);
    expect(preview.comments[0].createdAt).toBe(at(-2 * HOUR).toISOString());
  });

  it("says the trip is not found when it is not the agency's", () => {
    expect(() => buildTripPreview(raw({ trip: null }))).toThrow(ApiError);
    try {
      buildTripPreview(raw({ trip: null }));
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(404);
    }
  });
});

describe("createTripPreviewService", () => {
  it("reads the trip through the repository with the agency's id", async () => {
    const fetchTripPreview = vi.fn().mockResolvedValue(raw());
    const service = createTripPreviewService({ repository: { fetchTripPreview } });
    const preview = await service.getTripPreview("agency-1", tripRow.id);
    expect(fetchTripPreview).toHaveBeenCalledWith("agency-1", tripRow.id);
    expect(preview.trip.title).toBe("Kyoto Autumn Escape");
  });
});
```

(`ApiError` exposes `statusCode` and `code`; see `src/http/errors.ts`.)

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/dashboardTripPreview.test.ts`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 4: Implement the repository** `src/modules/dashboard/tripPreviewRepository.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

/**
 * Raw reads for the dashboard's trip panel: one trip, its share links, every
 * comment on them and the titles of the stops those comments point at.
 * Scoped by agency, so another agency's trip reads as missing.
 */

export type RawTripPreview = {
  trip: {
    id: string;
    title: string;
    status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";
    clientName: string | null;
    startDate: Date | null;
    endDate: Date | null;
    travelerCount: number | null;
    destinationSummary: string | null;
  } | null;
  /** Newest first. */
  shares: Array<{
    id: string;
    clientName: string | null;
    viewCount: number;
    lastViewedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    proposalRating: number | null;
    createdAt: Date;
  }>;
  /** Oldest first. */
  comments: Array<{
    id: string;
    shareId: string;
    authorName: string;
    content: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    dayNumber: number | null;
    itemId: string | null;
    agencyReply: string | null;
    agencyRepliedAt: Date | null;
    createdAt: Date;
  }>;
  itemTitles: Array<{ id: string; title: string }>;
};

export interface TripPreviewRepository {
  fetchTripPreview(agencyId: string, tripId: string): Promise<RawTripPreview>;
}

export function createPrismaTripPreviewRepository(client: PrismaClient = prisma): TripPreviewRepository {
  return {
    async fetchTripPreview(agencyId, tripId) {
      const trip = await client.clientTrip.findFirst({
        where: { id: tripId, agencyId },
        select: {
          id: true,
          title: true,
          status: true,
          clientName: true,
          startDate: true,
          endDate: true,
          travelerCount: true,
          destinationSummary: true
        }
      });
      if (!trip) return { trip: null, shares: [], comments: [], itemTitles: [] };

      const shares = await client.itineraryShare.findMany({
        where: { agencyId, tripId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          clientName: true,
          viewCount: true,
          lastViewedAt: true,
          expiresAt: true,
          revokedAt: true,
          proposalRating: true,
          createdAt: true
        }
      });

      const comments = shares.length
        ? await client.itineraryComment.findMany({
            where: { shareId: { in: shares.map((s) => s.id) } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              shareId: true,
              authorName: true,
              content: true,
              status: true,
              dayNumber: true,
              itemId: true,
              agencyReply: true,
              agencyRepliedAt: true,
              createdAt: true
            }
          })
        : [];

      const itemIds = [...new Set(comments.flatMap((c) => (c.itemId ? [c.itemId] : [])))];
      const itemTitles = itemIds.length
        ? await client.itineraryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, title: true } })
        : [];

      return { trip, shares, comments, itemTitles };
    }
  };
}

export const tripPreviewRepository = createPrismaTripPreviewRepository();
```

- [ ] **Step 5: Implement the service** `src/modules/dashboard/tripPreviewService.ts`:

```ts
import { ApiError } from "../../http/errors";
import type { TripPreview } from "./dashboardTypes";
import { tripPreviewRepository, type RawTripPreview, type TripPreviewRepository } from "./tripPreviewRepository";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Shapes one trip's raw rows into the trip panel's payload. */
export function buildTripPreview(raw: RawTripPreview): TripPreview {
  if (!raw.trip) {
    throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
  }
  const titles = new Map(raw.itemTitles.map((item) => [item.id, item.title]));
  // Shares arrive newest first: the newest live link, else the newest of all.
  const share = raw.shares.find((s) => s.revokedAt === null) ?? raw.shares[0] ?? null;

  return {
    trip: {
      ...raw.trip,
      startDate: iso(raw.trip.startDate),
      endDate: iso(raw.trip.endDate)
    },
    share: share
      ? {
          id: share.id,
          clientName: share.clientName,
          viewCount: share.viewCount,
          lastViewedAt: iso(share.lastViewedAt),
          expiresAt: iso(share.expiresAt),
          revokedAt: iso(share.revokedAt),
          proposalRating: share.proposalRating,
          createdAt: share.createdAt.toISOString()
        }
      : null,
    comments: raw.comments.map((comment) => ({
      ...comment,
      itemTitle: comment.itemId ? titles.get(comment.itemId) ?? null : null,
      agencyRepliedAt: iso(comment.agencyRepliedAt),
      createdAt: comment.createdAt.toISOString()
    }))
  };
}

export function createTripPreviewService(deps: { repository: TripPreviewRepository }) {
  return {
    async getTripPreview(agencyId: string, tripId: string): Promise<TripPreview> {
      return buildTripPreview(await deps.repository.fetchTripPreview(agencyId, tripId));
    }
  };
}

export const tripPreviewService = createTripPreviewService({ repository: tripPreviewRepository });
```

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run tests/dashboardTripPreview.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Write the failing route tests** in `tests/dashboardTripPreviewRoutes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  getTripPreview: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({ dashboardService: { getDashboard: vi.fn() } }));
vi.mock("../src/modules/dashboard/calendarService", () => ({ calendarService: { getCalendar: vi.fn() } }));
vi.mock("../src/modules/dashboard/tripPreviewService", () => ({
  tripPreviewService: { getTripPreview: mocks.getTripPreview }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const user = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff Member",
  memberships: []
};

function createApp(authUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authUser) req.authUser = authUser as never;
    next();
  });
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const preview = { trip: { id: TRIP_ID, title: "Kyoto" }, share: null, comments: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.getTripPreview.mockResolvedValue(preview);
});

describe("GET /agencies/:agencyId/dashboard/trips/:tripId", () => {
  it("returns the trip panel's data for a member", async () => {
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(preview);
    expect(mocks.getTripPreview).toHaveBeenCalledWith(AGENCY_ID, TRIP_ID);
  });

  it("requires sign-in", async () => {
    const response = await request(createApp()).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(401);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("rejects a trip id that is not a UUID", async () => {
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/not-a-trip`);
    expect(response.status).toBe(400);
    expect(mocks.getTripPreview).not.toHaveBeenCalled();
  });

  it("refuses a member without an active membership", async () => {
    mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: null });
    const response = await request(createApp(user)).get(`/agencies/${AGENCY_ID}/dashboard/trips/${TRIP_ID}`);
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `npx vitest run tests/dashboardTripPreviewRoutes.test.ts`
Expected: FAIL with 404, because the route doesn't exist.

- [ ] **Step 9: Add the params schema and the route.** In `dashboardSchemas.ts`, add `import { idParamsSchema } from "../../http/requestSchemas";` and:

```ts
/** `/agencies/:agencyId/dashboard/trips/:tripId` (mergeParams carries agencyId). */
export const tripPreviewParamsSchema = idParamsSchema("agencyId", "tripId");
```

In `dashboardRoutes.ts`, import `tripPreviewParamsSchema` with the other schemas and `import { tripPreviewService } from "./tripPreviewService";`. Add to the header comment:

```ts
 * GET /trips/:tripId — the dashboard trip panel: the trip, its share link and
 *   every client comment, with stop names. Any verified member of the agency.
```

and add the route after `/calendar`:

```ts
dashboardRoutes.get("/trips/:tripId", requireAuth, async (request, response, next) => {
  try {
    const { agencyId, tripId } = tripPreviewParamsSchema.parse(request.params);

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }

    response.json(await tripPreviewService.getTripPreview(access.agency.id, tripId));
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 10: Run the route tests, then the existing route tests and typecheck**

Run: `npx vitest run tests/dashboardTripPreviewRoutes.test.ts tests/dashboardCalendarRoutes.test.ts`
Expected: PASS. (`errorHandler` answers a `ZodError` with 400 `VALIDATION_ERROR`, which covers the bad-UUID case.)
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/modules/dashboard/tripPreviewRepository.ts src/modules/dashboard/tripPreviewService.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts src/modules/dashboard/dashboardRoutes.ts tests/dashboardTripPreview.test.ts tests/dashboardTripPreviewRoutes.test.ts
git commit -m "feat(dashboard): trip panel endpoint with share link and named comments"
```

---

### Task 7: Extend a share link

**Files:**
- Create: `Voyage-Server/src/modules/shares/shareExpiry.ts`
- Modify: `Voyage-Server/src/modules/shares/shareSchemas.ts`, `shareTypes.ts`, `shareRepository.ts`, `shareService.ts`, `shareRoutes.ts`
- Test: `Voyage-Server/tests/shareExtend.test.ts`, `Voyage-Server/tests/shareExtendRoutes.test.ts`

- [ ] **Step 1: Write the failing service tests** in `tests/shareExtend.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { computeExtendedExpiry } from "../src/modules/shares/shareExpiry";
import { createShareService } from "../src/modules/shares/shareService";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe("computeExtendedExpiry", () => {
  it("adds the days to an expiry still ahead", () => {
    expect(computeExtendedExpiry(at(2 * DAY), 7, NOW)).toEqual(at(9 * DAY));
  });
  it("counts from now for a link that already expired", () => {
    expect(computeExtendedExpiry(at(-3 * DAY), 30, NOW)).toEqual(at(30 * DAY));
  });
});

function serviceWith(share: Record<string, unknown> | null) {
  const repository = {
    findShareForAgency: vi.fn().mockResolvedValue(share),
    updateShareExpiry: vi.fn(async (_id: string, expiresAt: Date) => ({ ...share, expiresAt }))
  };
  return { repository, service: createShareService({ repository: repository as never }) };
}

describe("shareService.extendShare", () => {
  it("saves the extended expiry for the agency's live link", async () => {
    const { repository, service } = serviceWith({ id: "share-1", expiresAt: at(1 * DAY), revokedAt: null });
    const share = await service.extendShare(AGENCY_ID, "share-1", 7, NOW);
    expect(repository.findShareForAgency).toHaveBeenCalledWith(AGENCY_ID, "share-1");
    expect(repository.updateShareExpiry).toHaveBeenCalledWith("share-1", at(8 * DAY));
    expect(share.expiresAt).toEqual(at(8 * DAY));
  });

  it("says not found for another agency's link", async () => {
    const { service } = serviceWith(null);
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_NOT_FOUND" });
  });

  it("refuses a revoked link", async () => {
    const { repository, service } = serviceWith({ id: "share-1", expiresAt: at(1 * DAY), revokedAt: at(-1 * DAY) });
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_REVOKED" });
    expect(repository.updateShareExpiry).not.toHaveBeenCalled();
  });

  it("refuses a link that never expires", async () => {
    const { service } = serviceWith({ id: "share-1", expiresAt: null, revokedAt: null });
    await expect(service.extendShare(AGENCY_ID, "share-1", 7, NOW)).rejects.toMatchObject({ code: "SHARE_NEVER_EXPIRES" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/shareExtend.test.ts`
Expected: FAIL, because `shareExpiry` is missing and `extendShare` is not a function.

- [ ] **Step 3: Implement the pure helper** `src/modules/shares/shareExpiry.ts`:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The day counts the dashboard offers for extending a link. */
export const EXTEND_DAY_OPTIONS = [7, 30] as const;
export type ExtendDays = (typeof EXTEND_DAY_OPTIONS)[number];

/**
 * A link's new expiry: `extendDays` after its current expiry, or after now
 * when it has already expired, so an extension never lands in the past.
 */
export function computeExtendedExpiry(current: Date, extendDays: number, now: Date): Date {
  const base = current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + extendDays * MS_PER_DAY);
}
```

- [ ] **Step 4: Add the schema.** In `shareSchemas.ts`, after `replyCommentInputSchema`:

```ts
export const extendShareInputSchema = z.object({
  extendDays: z.union([z.literal(7), z.literal(30)])
}).strict();
```

and with the other type exports: `export type ExtendShareInput = z.infer<typeof extendShareInputSchema>;`

- [ ] **Step 5: Extend the repository interface.** In `shareTypes.ts`, add to `ShareRepository`:

```ts
  /** The agency's link by id, or null when it is not theirs. */
  findShareForAgency(agencyId: string, shareId: string): Promise<ShareRecord | null>;
  updateShareExpiry(shareId: string, expiresAt: Date): Promise<ShareRecord>;
```

In `shareRepository.ts`, add after `revokeShare`:

```ts
    async findShareForAgency(agencyId, shareId) {
      const share = await client.itineraryShare.findFirst({ where: { id: shareId, agencyId } });
      return (share as ShareRecord | null) ?? null;
    },

    async updateShareExpiry(shareId, expiresAt) {
      const updated = await client.itineraryShare.update({
        where: { id: shareId },
        data: { expiresAt }
      });
      return updated as ShareRecord;
    },
```

- [ ] **Step 6: Add the service method.** In `shareService.ts`, add `import { computeExtendedExpiry } from "./shareExpiry";` and, after `revokeShare`:

```ts
    async extendShare(agencyId: string, shareId: string, extendDays: number, now: Date = new Date()) {
      assertUuid(agencyId, "agencyId");
      const share = await options.repository.findShareForAgency(agencyId, shareId);
      if (!share) {
        throw new ApiError(404, "SHARE_NOT_FOUND", "Share not found.");
      }
      if (share.revokedAt !== null) {
        throw new ApiError(409, "SHARE_REVOKED", "This link was turned off. Share the itinerary again instead.");
      }
      if (share.expiresAt === null) {
        throw new ApiError(409, "SHARE_NEVER_EXPIRES", "This link never expires.");
      }
      return options.repository.updateShareExpiry(shareId, computeExtendedExpiry(share.expiresAt, extendDays, now));
    },
```

- [ ] **Step 7: Run the service tests**

Run: `npx vitest run tests/shareExtend.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Write the failing route test** in `tests/shareExtendRoutes.test.ts`, mirroring `shareReplyFreshness.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  extendShare: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { extendShare: mocks.extendShare }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SHARE_ID = "cmpt0a1b20003eohoq8r7s6tu";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = { id: "user-1", role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", memberships: [] } as never;
    next();
  });
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const extend = (body: unknown) =>
  request(createApp()).patch(`/agencies/${AGENCY_ID}/shares/${SHARE_ID}/expiry`).send(body as object);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "STAFF" } });
});

describe("PATCH /agencies/:agencyId/shares/:shareId/expiry", () => {
  it("extends the link and clears the agency's cached dashboards", async () => {
    mocks.extendShare.mockResolvedValue({ id: SHARE_ID, expiresAt: "2026-10-27T12:00:00.000Z" });

    const response = await extend({ extendDays: 7 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ share: { id: SHARE_ID, expiresAt: "2026-10-27T12:00:00.000Z" } });
    expect(mocks.extendShare).toHaveBeenCalledWith(AGENCY_ID, SHARE_ID, 7);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("only offers 7 or 30 days", async () => {
    const response = await extend({ extendDays: 365 });
    expect(response.status).toBe(400);
    expect(mocks.extendShare).not.toHaveBeenCalled();
  });

  it("leaves the caches alone when the extension fails", async () => {
    mocks.extendShare.mockRejectedValue(new Error("boom"));
    await extend({ extendDays: 30 });
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9: Run it to make sure it fails**

Run: `npx vitest run tests/shareExtendRoutes.test.ts`
Expected: FAIL with 404, because the route doesn't exist.

- [ ] **Step 10: Add the route.** In `shareRoutes.ts`, import `extendShareInputSchema`. Add it after the DELETE route:

```ts
// PATCH /agencies/:agencyId/shares/:shareId/expiry — push a link's expiry out by 7 or 30 days
shareRoutes.patch("/:shareId/expiry", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { shareId } = shareIdParamsSchema.parse(request.params);
    const { extendDays } = extendShareInputSchema.parse(request.body);
    const share = await shareService.extendShare(agencyId, shareId, extendDays);
    // "Link expires" rows and calendar marks change with the expiry.
    invalidateAgencyDashboards(agencyId);
    response.json({ share });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 11: Run the share tests and typecheck**

Run: `npx vitest run tests/shareExtend.test.ts tests/shareExtendRoutes.test.ts tests/shareReplyFreshness.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/modules/shares tests/shareExtend.test.ts tests/shareExtendRoutes.test.ts
git commit -m "feat(shares): extend a share link by 7 or 30 days"
```

---

### Task 8: Refresh the dashboard when links, comments, views and ratings change

**Files:**
- Modify: `Voyage-Server/src/modules/shares/shareRoutes.ts` (create and revoke)
- Modify: `Voyage-Server/src/modules/shares/shareService.ts` (activity hook: comment and view)
- Modify: `Voyage-Server/src/modules/reviews/reviewService.ts` (rating)
- Test: `Voyage-Server/tests/shareFreshness.test.ts`, `Voyage-Server/tests/shareServiceActivity.test.ts`, `Voyage-Server/tests/reviewRatingFreshness.test.ts`

- [ ] **Step 1: Write the failing route test** in `tests/shareFreshness.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  createShare: vi.fn(),
  revokeShare: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { createShare: mocks.createShare, revokeShare: mocks.revokeShare }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const ITINERARY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const SHARE_ID = "cmpt0a1b20003eohoq8r7s6tu";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = { id: "user-1", role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", memberships: [] } as never;
    next();
  });
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "OWNER" } });
});

describe("share link changes refresh the dashboard", () => {
  it("clears the caches after a link is created", async () => {
    mocks.createShare.mockResolvedValue({ id: SHARE_ID });
    const response = await request(createApp()).post(`/agencies/${AGENCY_ID}/shares/${ITINERARY_ID}`).send({});
    expect(response.status).toBe(201);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("clears the caches after a link is revoked", async () => {
    mocks.revokeShare.mockResolvedValue({ id: SHARE_ID });
    const response = await request(createApp()).delete(`/agencies/${AGENCY_ID}/shares/${SHARE_ID}`);
    expect(response.status).toBe(200);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("leaves the caches alone when revoking fails", async () => {
    mocks.revokeShare.mockRejectedValue(new Error("boom"));
    await request(createApp()).delete(`/agencies/${AGENCY_ID}/shares/${SHARE_ID}`);
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing service test** in `tests/shareServiceActivity.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createShareService } from "../src/modules/shares/shareService";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(agencyId: string | null) {
  const share = { id: "share-1", agencyId, revokedAt: null, expiresAt: null };
  const repository = {
    findShareByToken: vi.fn().mockResolvedValue({ share }),
    incrementViewCount: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue({ id: "c1" })
  };
  const onAgencyActivity = vi.fn();
  const service = createShareService({ repository: repository as never, onAgencyActivity });
  return { repository, onAgencyActivity, service };
}

describe("shareService agency activity", () => {
  it("reports a new client comment for the link's agency", async () => {
    const { service, onAgencyActivity } = setup("agency-1");
    await service.addComment("token-123456789", { authorName: "Maria", content: "Hi" });
    expect(onAgencyActivity).toHaveBeenCalledWith("agency-1");
  });

  it("reports a view once the count is saved", async () => {
    const { service, onAgencyActivity } = setup("agency-1");
    await service.getShareByToken("token-123456789");
    await flush();
    expect(onAgencyActivity).toHaveBeenCalledWith("agency-1");
  });

  it("stays quiet for a personal link with no agency", async () => {
    const { service, onAgencyActivity } = setup(null);
    await service.addComment("token-123456789", { authorName: "Maria", content: "Hi" });
    await service.getShareByToken("token-123456789");
    await flush();
    expect(onAgencyActivity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write the failing rating test** in `tests/reviewRatingFreshness.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({
  prisma: { itineraryShare: { findUnique: mocks.findUnique, update: mocks.update } }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { createReviewService } from "../src/modules/reviews/reviewService";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ proposalRating: 4, proposalRatingComment: null, proposalRatedAt: new Date() });
});

describe("proposal rating", () => {
  it("clears the agency's cached dashboards once the rating is saved", async () => {
    mocks.findUnique.mockResolvedValue({ id: "share-1", agencyId: "agency-1", revokedAt: null, expiresAt: null, proposalRating: null, proposalRatedAt: null });
    await createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 });
    expect(mocks.findUnique.mock.calls[0][0].select).toMatchObject({ agencyId: true });
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith("agency-1");
  });

  it("does nothing for a personal link", async () => {
    mocks.findUnique.mockResolvedValue({ id: "share-1", agencyId: null, revokedAt: null, expiresAt: null, proposalRating: null, proposalRatedAt: null });
    await createReviewService({ repository: {} as never }).rateProposal("token-123456789", { rating: 4 });
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `npx vitest run tests/shareFreshness.test.ts tests/shareServiceActivity.test.ts tests/reviewRatingFreshness.test.ts`
Expected: FAIL. The invalidation is not called, and `onAgencyActivity` is never called.

- [ ] **Step 5: Routes.** In `shareRoutes.ts`, add `invalidateAgencyDashboards(agencyId);` right after the `await shareService.createShare(...)` line and right after the `await shareService.revokeShare(...)` line, each with this comment:

```ts
    // Expiry rows, calendar marks and Recently viewed follow the agency's links.
```

- [ ] **Step 6: Service hook.** In `shareService.ts`:
  - Add the import `import { invalidateAgencyDashboards } from "../dashboard/dashboardFreshness";`.
  - Change the factory signature to `export function createShareService(options: { repository: ShareRepository; onAgencyActivity?: (agencyId: string) => void }) {`.
  - Add this comment above it:

```ts
/**
 * `onAgencyActivity(agencyId)` runs after a client touches an agency's link
 * (a comment, a view), so the agency's dashboard caches can be cleared. The
 * public routes don't know the agency; the share record does.
 */
```

  - In `getShareByToken`, replace the increment line with:

```ts
      // Increment view count asynchronously — don't block the response
      options.repository
        .incrementViewCount(share.id)
        .then(() => {
          if (share.agencyId) options.onAgencyActivity?.(share.agencyId);
        })
        .catch(() => undefined);
```

  - In `addComment`, replace `return options.repository.addComment(share.id, input);` with:

```ts
      const comment = await options.repository.addComment(share.id, input);
      if (share.agencyId) options.onAgencyActivity?.(share.agencyId);
      return comment;
```

  - Change the singleton to:

```ts
export const shareService = createShareService({
  repository: shareRepository,
  onAgencyActivity: invalidateAgencyDashboards
});
```

- [ ] **Step 7: Rating.** In `reviewService.ts`, add `import { invalidateAgencyDashboards } from "../dashboard/dashboardFreshness";`, add `agencyId: true,` to the `select` of the share `findUnique` in `rateProposal`, and right after the `prisma.itineraryShare.update(...)` call:

```ts
    // The low-rating to-do row and the calendar's rating mark change with it.
    if (share.agencyId) invalidateAgencyDashboards(share.agencyId);
```

- [ ] **Step 8: Run the tests, the share and security suites, and typecheck**

Run: `npx vitest run tests/shareFreshness.test.ts tests/shareServiceActivity.test.ts tests/reviewRatingFreshness.test.ts tests/shareReplyFreshness.test.ts tests/securityHardening.test.ts tests/publicShareBranding.test.ts`
Expected: PASS, apart from any failure already on `staging` (check with `git stash; npx vitest run tests/securityHardening.test.ts; git stash pop` if in doubt).
Run: `npx tsc --noEmit`
Expected: no errors. A circular-import error would mean something in `dashboard/` now imports `shares/`; nothing should.

- [ ] **Step 9: Commit**

```bash
git add src/modules/shares/shareRoutes.ts src/modules/shares/shareService.ts src/modules/reviews/reviewService.ts tests/shareFreshness.test.ts tests/shareServiceActivity.test.ts tests/reviewRatingFreshness.test.ts
git commit -m "fix(dashboard): refresh after link, comment, view and rating changes"
```

---

### Task 9: Fixture script and the client contract fixture

**Files:**
- Modify: `Voyage-Server/scripts/export-dashboard-fixtures.ts`
- Regenerate: `Voyage-Client/tests/fixtures/dashboard-payloads.json`

- [ ] **Step 1: Give the fixture comments real fields.** In `scripts/export-dashboard-fixtures.ts`, replace `repliedComment` with:

```ts
function repliedComment(id: string, shareId: string, createdAt: Date, replyAfterMs: number): Comment {
  return {
    id,
    shareId,
    content: "Client question",
    status: "ADDRESSED",
    agencyRepliedAt: after(createdAt, replyAfterMs),
    createdAt,
    authorName: "Ana Reyes",
    agencyReply: "Yes, that works.",
    dayNumber: 1,
    itemId: null
  };
}
```

Add these fields to the two unread Kyoto comments:
- `comment-kyoto-unread`: `authorName: "Maria Santos", agencyReply: null, dayNumber: 2, itemId: "item-kyoto-lunch"`.
- `comment-kyoto-unread-access`: `authorName: "Maria Santos", agencyReply: null, dayNumber: 1, itemId: "item-kyoto-ryokan"`.

Add to `busyAgency`, after `reviews`:

```ts
  itemTitles: [
    { id: "item-kyoto-lunch", title: "Nishiki Market lunch" },
    { id: "item-kyoto-ryokan", title: "Ryokan check-in" }
  ]
```

Add `itemTitles: []` to `emptyAgency`.

- [ ] **Step 2: Type-check the script.** The script is outside `tsconfig.json`. Create a scratch tsconfig outside the repo, for example `%TEMP%/fixture-tsconfig.json`:

```json
{
  "extends": "C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Server/tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Server", "typeRoots": ["C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Server/node_modules/@types"] },
  "include": ["C:/Users/dever/OneDrive/Documents/Voyage/Voyage-Server/scripts/export-dashboard-fixtures.ts"]
}
```

Run: `npx tsc -p <that file>`
Expected: no errors. Delete the scratch file afterwards.

- [ ] **Step 3: Regenerate the client fixture (in Git Bash)**

Run: `cd Voyage-Server && npx tsx scripts/export-dashboard-fixtures.ts > ../Voyage-Client/tests/fixtures/dashboard-payloads.json`
Then check: `head -c 300 ../Voyage-Client/tests/fixtures/dashboard-payloads.json` shows plain JSON, and `grep -c '"clientComments"' ../Voyage-Client/tests/fixtures/dashboard-payloads.json` prints `4`.

- [ ] **Step 4: Run the client tests that read the fixture**

Run: `cd ../Voyage-Client && npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/needs-you-items.test.js`
Expected: PASS. The payload only gained fields, and authorName-less fallbacks still hold. If the "Shared" / "Viewed" funnel numbers asserted in the contract test changed because of the cohort switch (Task 5), update those expected numbers to the new fixture values. That is the intended behaviour change.

- [ ] **Step 5: Commit in both repos**

```bash
cd ../Voyage-Server
git add scripts/export-dashboard-fixtures.ts
git commit -m "chore(dashboard): fixture comments with authors and stops"
cd ../Voyage-Client
git add tests/fixtures/dashboard-payloads.json tests/dashboard-server-contract.test.jsx
git commit -m "test(dashboard): regenerate dashboard payload fixture"
```

---

# Part 2 — Voyage-Client

All paths below are relative to `Voyage-Client/`. `D` = `app/agency/[agencyId]/components/dashboard`.

### Task 10: API helpers

**Files:**
- Create: `app/lib/api/dashboard.js`
- Modify: `app/lib/api/shares.js`, `app/lib/api/index.js`
- Test: `tests/dashboard-api.test.js`

- [ ] **Step 1: Write the failing test** in `tests/dashboard-api.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import { extendShare, fetchTripPreview } from "../app/lib/api/index.js";

beforeEach(() => mocks.fetchApi.mockReset().mockResolvedValue({}));

describe("dashboard API helpers", () => {
  it("reads one trip for the trip panel", async () => {
    await fetchTripPreview("agency-1", "trip-1");
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/agency-1/dashboard/trips/trip-1");
  });

  it("extends a share link by the chosen days", async () => {
    await extendShare("agency-1", "share-1", 30);
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/agency-1/shares/share-1/expiry", {
      method: "PATCH",
      body: JSON.stringify({ extendDays: 30 }),
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/dashboard-api.test.js`
Expected: FAIL, because the exports don't exist.

- [ ] **Step 3: Implement.** Create `app/lib/api/dashboard.js`:

```js
/**
 * Dashboard endpoints that load on demand. The polled payload and the
 * calendar load in their own hooks.
 */
import { fetchApi } from "./client.js";

/** Everything the dashboard's trip panel shows: the trip, its share link and every comment. */
export async function fetchTripPreview(agencyId, tripId) {
  return fetchApi(`/agencies/${agencyId}/dashboard/trips/${encodeURIComponent(tripId)}`);
}
```

Append to `app/lib/api/shares.js`, after `revokeShare`:

```js
/** Pushes a link's expiry out by 7 or 30 days, counted from now if it has already expired. */
export async function extendShare(agencyId, shareId, extendDays) {
  return fetchApi(`/agencies/${agencyId}/shares/${shareId}/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ extendDays }),
  });
}
```

In `app/lib/api/index.js`, add `extendShare,` to the shares export list after `revokeShare,`, and a new block:

```js
// Dashboard
export { fetchTripPreview } from "./dashboard.js";
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --pool=threads tests/dashboard-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/api/dashboard.js app/lib/api/shares.js app/lib/api/index.js tests/dashboard-api.test.js
git commit -m "feat(api): trip preview and extend-link helpers"
```

---

### Task 11: Trip panel text helpers

**Files:**
- Create: `D/tripPanel/tripPanelFormat.js`
- Test: `tests/trip-panel-format.test.js`

- [ ] **Step 1: Write the failing tests** in `tests/trip-panel-format.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  commentPlace,
  describeLinkState,
  describeLinkViews,
  describeTripLine,
  orderPanelComments,
} from "../app/agency/[agencyId]/components/dashboard/tripPanel/tripPanelFormat.js";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

describe("describeTripLine", () => {
  it("joins client, dates and travelers, leaving out what is missing", () => {
    expect(
      describeTripLine({ clientName: "Maria Santos", startDate: "2026-11-03T12:00:00.000Z", endDate: "2026-11-08T12:00:00.000Z", travelerCount: 4 }),
    ).toBe("Maria Santos · Nov 3, 2026 - Nov 8, 2026 · 4 travelers");
    expect(describeTripLine({ clientName: null, startDate: null, travelerCount: 1 }, "Fallback")).toBe("Fallback · 1 traveler");
    expect(describeTripLine(undefined, "From the row")).toBe("From the row");
    expect(describeTripLine({ clientName: null, startDate: null, travelerCount: null })).toBeNull();
  });
});

describe("describeLinkState", () => {
  it("names each state and whether it can be extended", () => {
    expect(describeLinkState({ revokedAt: iso(-HOUR), expiresAt: iso(HOUR) }, NOW)).toEqual({ label: "Link turned off", tone: "danger", canExtend: false });
    expect(describeLinkState({ revokedAt: null, expiresAt: null }, NOW)).toEqual({ label: "Never expires", tone: "neutral", canExtend: false });
    expect(describeLinkState({ revokedAt: null, expiresAt: iso(-HOUR) }, NOW)).toEqual({ label: "Link has expired", tone: "danger", canExtend: true });
    expect(describeLinkState({ revokedAt: null, expiresAt: iso(20 * HOUR) }, NOW)).toEqual({ label: "Expires in 20h", tone: "warning", canExtend: true });
    expect(describeLinkState({ revokedAt: null, expiresAt: "2026-11-30T12:00:00.000Z" }, NOW)).toEqual({ label: "Expires Nov 30, 2026", tone: "neutral", canExtend: true });
  });
});

describe("describeLinkViews", () => {
  it("counts views and says when the last one was", () => {
    expect(describeLinkViews({ viewCount: 0 }, NOW)).toBe("Not opened yet");
    expect(describeLinkViews({ viewCount: 1, lastViewedAt: iso(-2 * HOUR) }, NOW)).toBe("Viewed once · last viewed 2h ago");
    expect(describeLinkViews({ viewCount: 4, lastViewedAt: null }, NOW)).toBe("Viewed 4 times");
  });
});

describe("commentPlace", () => {
  it("says where on the trip a comment points", () => {
    expect(commentPlace({ dayNumber: 1, itemId: "i1", itemTitle: "Ryokan check-in" })).toBe("Day 1 · Ryokan check-in");
    expect(commentPlace({ dayNumber: 2, itemId: null, itemTitle: null })).toBe("Day 2");
    expect(commentPlace({ dayNumber: 3, itemId: "gone", itemTitle: null })).toBe("Day 3 · Removed stop");
    expect(commentPlace({ dayNumber: null, itemId: null, itemTitle: null })).toBe("General");
  });
});

describe("orderPanelComments", () => {
  it("puts unanswered comments first, oldest first, then answered ones newest first", () => {
    const comments = [
      { id: "answered-old", agencyReply: "Ok", createdAt: iso(-5 * HOUR) },
      { id: "waiting-new", agencyReply: null, createdAt: iso(-1 * HOUR) },
      { id: "answered-new", agencyReply: "Done", createdAt: iso(-2 * HOUR) },
      { id: "waiting-old", agencyReply: null, createdAt: iso(-4 * HOUR) },
    ];
    const { waiting, answered } = orderPanelComments(comments);
    expect(waiting.map((c) => c.id)).toEqual(["waiting-old", "waiting-new"]);
    expect(answered.map((c) => c.id)).toEqual(["answered-new", "answered-old"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/trip-panel-format.test.js`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `D/tripPanel/tripPanelFormat.js`:

```js
import { formatShortDate, formatTripDates } from "@/app/lib/formatters.js";
import { timeAgo } from "@/app/lib/relativeTime.js";

/**
 * Plain-language text for the dashboard trip panel. Pure: every time-based
 * helper takes `now` (epoch ms) so tests and renders agree.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A link this close to expiring is flagged. */
export const EXPIRING_SOON_MS = 3 * DAY;

/** Compact span such as "45m", "20h" or "2d". */
function span(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** "Maria Santos · Nov 3, 2026 - Nov 8, 2026 · 4 travelers"; null when there is nothing to say. */
export function describeTripLine(trip, fallbackClientName = null) {
  if (!trip) return fallbackClientName;
  const travelers = trip.travelerCount
    ? `${trip.travelerCount} ${trip.travelerCount === 1 ? "traveler" : "travelers"}`
    : null;
  const parts = [
    trip.clientName ?? fallbackClientName,
    trip.startDate ? formatTripDates(trip.startDate, trip.endDate) : null,
    travelers,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The link's state as a chip, and whether Extend applies. */
export function describeLinkState(share, now = Date.now()) {
  if (share.revokedAt) return { label: "Link turned off", tone: "danger", canExtend: false };
  if (!share.expiresAt) return { label: "Never expires", tone: "neutral", canExtend: false };
  const left = Date.parse(share.expiresAt) - now;
  if (!Number.isFinite(left)) return { label: "Expiry unknown", tone: "neutral", canExtend: true };
  if (left <= 0) return { label: "Link has expired", tone: "danger", canExtend: true };
  if (left <= EXPIRING_SOON_MS) return { label: `Expires in ${span(left)}`, tone: "warning", canExtend: true };
  return { label: `Expires ${formatShortDate(share.expiresAt)}`, tone: "neutral", canExtend: true };
}

/** "Viewed 4 times · last viewed 2h ago", or "Not opened yet". */
export function describeLinkViews(share, now = Date.now()) {
  if (!share.viewCount) return "Not opened yet";
  const times = share.viewCount === 1 ? "Viewed once" : `Viewed ${share.viewCount} times`;
  return share.lastViewedAt ? `${times} · last viewed ${timeAgo(share.lastViewedAt, now).toLowerCase()}` : times;
}

/** Where a comment points: "Day 1 · Ryokan check-in", "Day 2", "Day 3 · Removed stop" or "General". */
export function commentPlace(comment) {
  const day = comment.dayNumber != null ? `Day ${comment.dayNumber}` : null;
  const stop = comment.itemTitle ?? (comment.itemId ? "Removed stop" : null);
  return [day, stop].filter(Boolean).join(" · ") || "General";
}

/** True until the agency has replied. */
export const isWaiting = (comment) => !comment.agencyReply;

/** Unanswered comments first, oldest first; then answered ones, newest first. */
export function orderPanelComments(comments = []) {
  const byCreated = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return {
    waiting: comments.filter(isWaiting).sort(byCreated),
    answered: comments.filter((comment) => !isWaiting(comment)).sort((a, b) => byCreated(b, a)),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/trip-panel-format.test.js`
Expected: PASS. If the date strings differ by a day, the test machine's timezone is far from UTC. The noon-UTC inputs are there to avoid that, so check that `formatShortDate` still uses `toLocaleDateString("en-US")`.

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/tripPanel/tripPanelFormat.js" tests/trip-panel-format.test.js
git commit -m "feat(dashboard): trip panel text helpers"
```

---

### Task 12: `useTripPreview` hook

**Files:**
- Create: `app/hooks/useTripPreview.js`
- Test: `tests/use-trip-preview.test.jsx`

- [ ] **Step 1: Write the failing tests** in `tests/use-trip-preview.test.jsx`:

```jsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import { useTripPreview } from "../app/hooks/useTripPreview.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => mocks.fetchApi.mockReset());

describe("useTripPreview", () => {
  it("loads the trip while enabled", async () => {
    mocks.fetchApi.mockResolvedValue({ trip: { id: "t1", title: "Kyoto" }, share: null, comments: [] });
    const { result } = renderHook(() => useTripPreview({ agencyId: "a1", tripId: "t1", enabled: true }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.trip.title).toBe("Kyoto"));
    expect(result.current.loading).toBe(false);
  });

  it("does nothing while disabled", () => {
    renderHook(() => useTripPreview({ agencyId: "a1", tripId: "t1", enabled: false }));
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });

  it("keeps the open trip when an earlier trip's answer lands late", async () => {
    const first = deferred();
    const second = deferred();
    mocks.fetchApi.mockImplementation((path) => (String(path).endsWith("/t1") ? first.promise : second.promise));
    const { result, rerender } = renderHook((props) => useTripPreview(props), {
      initialProps: { agencyId: "a1", tripId: "t1", enabled: true },
    });
    rerender({ agencyId: "a1", tripId: "t2", enabled: true });
    await act(async () => second.resolve({ trip: { id: "t2", title: "Baguio" }, share: null, comments: [] }));
    await act(async () => first.resolve({ trip: { id: "t1", title: "Kyoto" }, share: null, comments: [] }));
    expect(result.current.data.trip.title).toBe("Baguio");
  });

  it("reports a failure and loads again on reload", async () => {
    mocks.fetchApi.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ trip: { id: "t1" }, share: null, comments: [] });
    const { result } = renderHook(() => useTripPreview({ agencyId: "a1", tripId: "t1", enabled: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    await act(async () => result.current.reload());
    await waitFor(() => expect(result.current.data?.trip.id).toBe("t1"));
    expect(result.current.error).toBeNull();
  });

  it("applies local edits with update", async () => {
    mocks.fetchApi.mockResolvedValue({ trip: { id: "t1" }, share: { expiresAt: "a" }, comments: [] });
    const { result } = renderHook(() => useTripPreview({ agencyId: "a1", tripId: "t1", enabled: true }));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    act(() => result.current.update((prev) => ({ ...prev, share: { expiresAt: "b" } })));
    expect(result.current.data.share.expiresAt).toBe("b");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/use-trip-preview.test.jsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `app/hooks/useTripPreview.js`:

```js
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTripPreview } from "@/app/lib/api/index.js";

/**
 * Loads the dashboard trip panel's data while `enabled` (the panel is open).
 * The panel stays mounted between trips, so a slow answer for an earlier trip
 * can land after a later one: each load is stamped and only the latest counts.
 * Closing or switching trips retires whatever is still in flight.
 *
 * Returns { data, error, loading, reload, update }. `data` is only ever the
 * current trip's; `update(fn)` edits it in place after a reply or an extension.
 */
export function useTripPreview({ agencyId, tripId, enabled }) {
  const [state, setState] = useState({ forTripId: null, data: null, error: null, loading: false });
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!agencyId || !tripId) return;
    const requestId = ++requestIdRef.current;
    setState((prev) => ({
      forTripId: tripId,
      data: prev.forTripId === tripId ? prev.data : null,
      error: null,
      loading: true,
    }));
    try {
      const data = await fetchTripPreview(agencyId, tripId);
      if (requestId !== requestIdRef.current) return;
      setState({ forTripId: tripId, data, error: null, loading: false });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState({ forTripId: tripId, data: null, error, loading: false });
    }
  }, [agencyId, tripId]);

  useEffect(() => {
    if (enabled) load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [enabled, load]);

  const update = useCallback((edit) => {
    setState((prev) => (prev.data ? { ...prev, data: edit(prev.data) } : prev));
  }, []);

  const isCurrent = state.forTripId === tripId;
  return {
    data: isCurrent ? state.data : null,
    error: isCurrent ? state.error : null,
    loading: isCurrent ? state.loading : enabled,
    reload: load,
    update,
  };
}

export default useTripPreview;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/use-trip-preview.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useTripPreview.js tests/use-trip-preview.test.jsx
git commit -m "feat(dashboard): useTripPreview hook with stale-answer guard"
```

---

### Task 13: Comment card and Comments section

**Files:**
- Create: `D/tripPanel/CommentCard.jsx`, `D/tripPanel/CommentsSection.jsx`
- Test: `tests/trip-panel-comments.test.jsx`

- [ ] **Step 1: Write the failing tests** in `tests/trip-panel-comments.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../app/components/icons/index.js", () => ({ ReplyIcon: () => null, ChatIcon: () => null, CloseIcon: () => null }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import CommentsSection from "../app/agency/[agencyId]/components/dashboard/tripPanel/CommentsSection.jsx";

const waiting = {
  id: "c-wait",
  authorName: "Maria Santos",
  content: "Is the ryokan wheelchair accessible?",
  status: "PENDING",
  dayNumber: 1,
  itemId: "i1",
  itemTitle: "Ryokan check-in",
  agencyReply: null,
  agencyRepliedAt: null,
  createdAt: "2026-10-20T08:00:00.000Z",
};
const answered = {
  ...waiting,
  id: "c-done",
  content: "Can we move dinner to 7pm?",
  dayNumber: 2,
  itemTitle: "Kaiseki dinner",
  status: "ADDRESSED",
  agencyReply: "Done, moved to 7pm.",
  agencyRepliedAt: "2026-10-20T09:00:00.000Z",
};

beforeEach(() => mocks.fetchApi.mockReset());

describe("CommentsSection", () => {
  it("lists waiting comments before answered ones, each with where it points", () => {
    render(<CommentsSection agencyId="a1" comments={[answered, waiting]} />);
    const section = screen.getByRole("region", { name: "Comments" });
    const cards = within(section).getAllByRole("article");
    expect(within(cards[0]).getByText("Is the ryokan wheelchair accessible?")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Day 1 · Ryokan check-in")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Done, moved to 7pm.")).toBeInTheDocument();
    expect(within(section).getByText("1 waiting")).toBeInTheDocument();
  });

  it("opens the reply box of the comment the panel was opened for", () => {
    render(<CommentsSection agencyId="a1" comments={[waiting]} focusCommentId="c-wait" />);
    expect(screen.getByPlaceholderText("Write a reply…")).toHaveFocus();
  });

  it("sends a reply and reports it", async () => {
    mocks.fetchApi.mockResolvedValue({ comment: { ...waiting, agencyReply: "Yes" } });
    const onReplySent = vi.fn();
    render(<CommentsSection agencyId="a1" comments={[waiting]} onReplySent={onReplySent} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Yes, it is." } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));
    await waitFor(() => expect(onReplySent).toHaveBeenCalledWith("c-wait", "Yes, it is."));
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/a1/shares/comments/c-wait/reply", expect.objectContaining({ method: "POST" }));
  });

  it("invites comments when there are none", () => {
    render(<CommentsSection agencyId="a1" comments={[]} />);
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/trip-panel-comments.test.jsx`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement** `D/tripPanel/CommentCard.jsx`. This is moved from `TripSlideOver.jsx` with these changes: it is an `<article>` with `data-comment-id`, has a place line instead of the item chip, uses theme-token status chips, and takes `defaultReplyOpen`.

```jsx
"use client";

import { useState } from "react";
import { replyToShareComment } from "@/app/lib/api/index.js";
import { ReplyIcon } from "@/app/components/icons/index.js";
import { formatCommentTime } from "@/app/lib/formatters.js";
import { commentPlace, isWaiting } from "./tripPanelFormat";

/**
 * One client comment in the trip panel: who, where on the trip, what they
 * said, and either the agency's reply or a Reply box. `defaultReplyOpen` opens
 * (and focuses) the box at once, for the comment the panel was opened for.
 */
export default function CommentCard({ comment, agencyId, onReplySent, defaultReplyOpen = false }) {
  const [replyOpen, setReplyOpen] = useState(defaultReplyOpen);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState(null);
  const waiting = isWaiting(comment);

  const handleSubmit = async () => {
    const content = replyText.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setReplyError(null);
    try {
      await replyToShareComment(agencyId, comment.id, content);
      setReplyText("");
      setReplyOpen(false);
      onReplySent?.(comment.id, content);
    } catch {
      setReplyError("Failed to send reply. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      data-comment-id={comment.id}
      aria-label={`Comment from ${comment.authorName || "Client"}`}
      className={`dashboard-card flex flex-col gap-2 px-4 py-3 ${waiting ? "border-l-[3px] border-l-status-warning" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-[0.75rem] font-extrabold text-white">
          {String(comment.authorName || "?")[0].toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-[0.85rem] font-bold text-text-primary">{comment.authorName || "Client"}</span>
            <span className="text-[0.73rem] text-text-muted">{formatCommentTime(comment.createdAt)}</span>
          </span>
          <span className="text-[12px] text-text-muted">{commentPlace(comment)}</span>
        </div>
        <span
          className={`inline-flex flex-shrink-0 items-center rounded-md px-2 py-[3px] text-[11px] font-semibold text-text-primary ${
            waiting ? "bg-status-warning/15" : "bg-status-success/15"
          }`}
        >
          {waiting ? "Waiting" : "Replied"}
        </span>
      </div>

      <p className="m-0 whitespace-pre-wrap pl-[2.375rem] text-[0.88rem] leading-[1.55] text-text-primary">{comment.content}</p>

      {comment.agencyReply ? (
        <div className="ml-[2.375rem] flex flex-col gap-1 border-l-[3px] border-secondary bg-background px-3.5 py-2.5">
          <span className="flex items-center gap-[5px] text-[0.72rem] font-extrabold uppercase tracking-[0.04em] text-secondary-strong">
            <ReplyIcon width={12} height={12} />
            Your reply
          </span>
          <p className="m-0 whitespace-pre-wrap text-[0.85rem] leading-[1.5] text-text-primary">{comment.agencyReply}</p>
          {comment.agencyRepliedAt ? (
            <span className="text-[0.72rem] text-text-muted">{formatCommentTime(comment.agencyRepliedAt)}</span>
          ) : null}
        </div>
      ) : (
        <div className="ml-[2.375rem] flex flex-col">
          {!replyOpen ? (
            <button
              type="button"
              onClick={() => setReplyOpen(true)}
              className="inline-flex min-h-9 items-center gap-[5px] self-start rounded-lg border border-border bg-surface-elevated px-2.5 text-[0.78rem] font-bold text-text-primary transition-colors duration-150 hover:border-secondary/50 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <ReplyIcon width={12} height={12} />
              Reply
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                className="box-border w-full resize-none rounded-[10px] border border-border bg-background px-3 py-2.5 text-[0.85rem] leading-relaxed text-text-primary focus:border-secondary focus:outline-none"
                placeholder="Write a reply…"
                aria-label={`Reply to ${comment.authorName || "the client"}`}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                autoFocus
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                  if (e.key === "Escape") {
                    // Close the box, not the whole panel.
                    e.stopPropagation();
                    setReplyOpen(false);
                    setReplyError(null);
                  }
                }}
              />
              {replyError ? (
                <span role="alert" className="text-[0.78rem] font-semibold text-status-danger">
                  {replyError}
                </span>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplyOpen(false);
                    setReplyError(null);
                  }}
                  className="min-h-9 rounded-lg border border-border bg-surface-elevated px-3 text-[0.8rem] font-bold text-text-primary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting || !replyText.trim()}
                  onClick={handleSubmit}
                  className="min-h-9 rounded-lg bg-secondary-strong px-4 text-[0.8rem] font-bold text-on-secondary-strong hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {submitting ? "Sending…" : "Send Reply"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
```

Note: the Escape handler stops propagation, so the panel's document-level Escape listener doesn't close the panel while you type. React's `stopPropagation` on a synthetic event does not stop a native `document` listener. So in Task 15 the panel's Escape handler also ignores events whose target is a `textarea` (see the code there).

- [ ] **Step 4: Implement** `D/tripPanel/CommentsSection.jsx`:

```jsx
"use client";

import { useId } from "react";
import CommentCard from "./CommentCard";
import { isWaiting, orderPanelComments } from "./tripPanelFormat";

/**
 * The trip panel's comments: every comment on every link of the trip,
 * unanswered first. `focusCommentId` opens that comment's reply box.
 */
export default function CommentsSection({ comments = [], agencyId, focusCommentId = null, onReplySent }) {
  const headingId = useId();
  const { waiting, answered } = orderPanelComments(comments);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="font-sans text-[13px] font-semibold tracking-normal text-text-primary">
          Comments
        </h3>
        {waiting.length > 0 ? (
          <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-[12px] font-semibold text-text-primary">
            {waiting.length} waiting
          </span>
        ) : null}
      </div>

      {comments.length === 0 ? (
        <p className="m-0 text-[13px] text-text-muted">
          No comments yet. Clients can comment on any stop from the shared link.
        </p>
      ) : (
        [...waiting, ...answered].map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            agencyId={agencyId}
            onReplySent={onReplySent}
            defaultReplyOpen={comment.id === focusCommentId && isWaiting(comment)}
          />
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --pool=threads tests/trip-panel-comments.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/tripPanel/CommentCard.jsx" "app/agency/[agencyId]/components/dashboard/tripPanel/CommentsSection.jsx" tests/trip-panel-comments.test.jsx
git commit -m "feat(dashboard): trip panel comments with stop names"
```

---

### Task 14: Shared link section with Extend

**Files:**
- Create: `D/tripPanel/SharedLinkSection.jsx`
- Test: `tests/trip-panel-shared-link.test.jsx`

- [ ] **Step 1: Write the failing tests** in `tests/trip-panel-shared-link.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import SharedLinkSection from "../app/agency/[agencyId]/components/dashboard/tripPanel/SharedLinkSection.jsx";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const share = {
  id: "share-1",
  viewCount: 4,
  lastViewedAt: "2026-10-20T10:00:00.000Z",
  expiresAt: "2026-10-21T08:00:00.000Z",
  revokedAt: null,
  proposalRating: 4,
};

beforeEach(() => mocks.fetchApi.mockReset());

describe("SharedLinkSection", () => {
  it("shows views, rating and expiry with both Extend choices", () => {
    render(<SharedLinkSection agencyId="a1" share={share} now={NOW} />);
    expect(screen.getByRole("region", { name: "Shared link" })).toBeInTheDocument();
    expect(screen.getByText("Viewed 4 times · last viewed 2h ago")).toBeInTheDocument();
    expect(screen.getByText("Rated 4 out of 5")).toBeInTheDocument();
    expect(screen.getByText("Expires in 20h")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extend 7 days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extend 30 days" })).toBeInTheDocument();
  });

  it("extends the link and hands back the saved link", async () => {
    mocks.fetchApi.mockResolvedValue({ share: { ...share, expiresAt: "2026-10-28T08:00:00.000Z" } });
    const onExtended = vi.fn();
    render(<SharedLinkSection agencyId="a1" share={share} now={NOW} onExtended={onExtended} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend 7 days" }));
    await waitFor(() => expect(onExtended).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: "2026-10-28T08:00:00.000Z" })));
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/a1/shares/share-1/expiry", { method: "PATCH", body: JSON.stringify({ extendDays: 7 }) });
  });

  it("says so when extending fails", async () => {
    mocks.fetchApi.mockRejectedValue(new Error("nope"));
    render(<SharedLinkSection agencyId="a1" share={share} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend 30 days" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't extend the link. Try again.");
  });

  it("offers no Extend for a turned-off link or one that never expires", () => {
    const { rerender } = render(<SharedLinkSection agencyId="a1" share={{ ...share, revokedAt: "2026-10-19T00:00:00.000Z" }} now={NOW} />);
    expect(screen.getByText("Link turned off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extend/ })).not.toBeInTheDocument();
    rerender(<SharedLinkSection agencyId="a1" share={{ ...share, expiresAt: null }} now={NOW} />);
    expect(screen.getByText("Never expires")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extend/ })).not.toBeInTheDocument();
  });

  it("says when the trip was never shared", () => {
    render(<SharedLinkSection agencyId="a1" share={null} now={NOW} />);
    expect(screen.getByText(/Not shared with the client yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/trip-panel-shared-link.test.jsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `D/tripPanel/SharedLinkSection.jsx`:

```jsx
"use client";

import { useId, useState } from "react";
import { extendShare } from "@/app/lib/api/index.js";
import { describeLinkState, describeLinkViews } from "./tripPanelFormat";

const EXTEND_DAYS = [7, 30];
const TONE_CLASS = {
  danger: "bg-status-danger/15",
  warning: "bg-status-warning/15",
  neutral: "bg-text-primary/5",
};

/**
 * The trip panel's share link: views, rating and expiry, with Extend 7 / 30
 * days for a live link that expires. `onExtended(share)` gets the saved link.
 * `ref` reaches the section, so the panel can scroll to it.
 */
export default function SharedLinkSection({ agencyId, share, onExtended, now, ref }) {
  const headingId = useId();
  const [pendingDays, setPendingDays] = useState(null);
  const [error, setError] = useState(null);
  const clock = now ?? Date.now();

  async function handleExtend(days) {
    if (pendingDays) return;
    setPendingDays(days);
    setError(null);
    try {
      const result = await extendShare(agencyId, share.id, days);
      onExtended?.(result?.share ?? null);
    } catch {
      setError("Couldn't extend the link. Try again.");
    } finally {
      setPendingDays(null);
    }
  }

  const state = share ? describeLinkState(share, clock) : null;

  return (
    <section ref={ref} aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-sans text-[13px] font-semibold tracking-normal text-text-primary">
        Shared link
      </h3>

      {!share ? (
        <p className="m-0 text-[13px] text-text-muted">Not shared with the client yet. Share it from the Itineraries page.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-text-primary">{describeLinkViews(share, clock)}</span>
            <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold text-text-primary ${TONE_CLASS[state.tone]}`}>
              {state.label}
            </span>
          </div>
          {share.proposalRating != null ? (
            <span className="text-[12px] text-text-muted">Rated {share.proposalRating} out of 5</span>
          ) : null}
          {state.canExtend ? (
            <div className="flex flex-wrap gap-2">
              {EXTEND_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => handleExtend(days)}
                  disabled={pendingDays !== null}
                  className="min-h-9 rounded-lg border border-border bg-surface-elevated px-3 text-[12px] font-semibold text-text-primary transition-colors hover:border-secondary/50 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-60"
                >
                  {pendingDays === days ? "Extending…" : `Extend ${days} days`}
                </button>
              ))}
            </div>
          ) : null}
          {error ? (
            <span role="alert" className="text-[12px] font-semibold text-status-danger">
              {error}
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/trip-panel-shared-link.test.jsx`
Expected: PASS (5 tests). The "Extending…" label replaces the clicked button's name while it is pending. The test waits on `onExtended`, so that's fine.

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/tripPanel/SharedLinkSection.jsx" tests/trip-panel-shared-link.test.jsx
git commit -m "feat(dashboard): shared link section with Extend 7 or 30 days"
```

---

### Task 15: TripStatusChip and the rewritten TripSlideOver

**Files:**
- Create: `D/widgets/TripStatusChip.jsx` (extracted from `D/widgets/MyWorkColumn.jsx`)
- Modify: `D/widgets/MyWorkColumn.jsx` (import the chip)
- Modify (rewrite the body): `D/TripSlideOver.jsx`
- Rewrite test: `tests/trip-slide-over-comments.test.jsx`
- Modify tests: `tests/trip-slide-over-focus.test.jsx`, `tests/dashboard-reply-refresh.test.jsx`, `tests/heading-typography.test.js`

- [ ] **Step 1: Extract the status chip.** Create `D/widgets/TripStatusChip.jsx` by moving `STATUS_LABELS`, `STATUS_BG`, `STATUS_TEXT`, `STATUS_DOT` and `StatusChip` out of `MyWorkColumn.jsx` verbatim, keeping its comments. Export it as the default:

```jsx
// (STATUS_LABELS, STATUS_BG, STATUS_TEXT, STATUS_DOT and their comment, moved verbatim from MyWorkColumn.jsx)

/** A trip's status as a tinted chip with a leading dot; nothing for no status. */
export default function TripStatusChip({ status }) {
  // (the body of MyWorkColumn's StatusChip, verbatim)
}
```

In `MyWorkColumn.jsx`, delete those constants and the function, add `import TripStatusChip from "./TripStatusChip";`, and replace `<StatusChip status={trip.statusChip} />` with `<TripStatusChip status={trip.statusChip} />`.
Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx tests/dashboard-contrast.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: PASS (no behaviour change).

- [ ] **Step 2: Rewrite `tests/trip-slide-over-comments.test.jsx`** for the new endpoint. Replace the whole file:

```jsx
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("../app/components/icons/index.js", () => ({ ChatIcon: () => null, CloseIcon: () => null, ReplyIcon: () => null }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import TripSlideOver from "../app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx";

const comment = (id, fields = {}) => ({
  id,
  shareId: "s-1",
  authorName: "Ana",
  content: `Comment ${id}`,
  status: "PENDING",
  dayNumber: 1,
  itemId: null,
  itemTitle: null,
  agencyReply: null,
  agencyRepliedAt: null,
  createdAt: "2026-10-02T02:00:00.000Z",
  ...fields,
});

const preview = (fields = {}) => ({
  trip: {
    id: "t-1",
    title: "Kyoto Autumn Escape",
    status: "IN_REVIEW",
    clientName: "Maria Santos",
    startDate: null,
    endDate: null,
    travelerCount: 4,
    destinationSummary: "Kyoto",
  },
  share: { id: "s-1", clientName: null, viewCount: 4, lastViewedAt: null, expiresAt: null, revokedAt: null, proposalRating: null, createdAt: "2026-10-01T00:00:00.000Z" },
  comments: [comment("c-1")],
  ...fields,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function Panel(props) {
  return <TripSlideOver isOpen onClose={() => {}} agencyId="agency-1" tripId="t-1" tripTitle="Kyoto" {...props} />;
}

beforeEach(() => mocks.fetchApi.mockReset());

describe("TripSlideOver trip panel", () => {
  it("shows the trip, its link and its comments from one request", async () => {
    mocks.fetchApi.mockResolvedValue(preview());
    render(<Panel />);
    const panel = screen.getByRole("dialog", { name: /^Trip:/ });
    expect(await within(panel).findByText("Comment c-1")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Kyoto Autumn Escape" })).toBeInTheDocument();
    expect(within(panel).getByText("Maria Santos · 4 travelers")).toBeInTheDocument();
    expect(within(panel).getByText("In review")).toBeInTheDocument();
    expect(within(panel).getByRole("region", { name: "Shared link" })).toBeInTheDocument();
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1);
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/agency-1/dashboard/trips/t-1");
  });

  it("reports a failure with Retry, and loads again", async () => {
    mocks.fetchApi.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(preview());
    render(<Panel />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this trip.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Comment c-1")).toBeInTheDocument();
  });

  it("keeps the open trip when an earlier trip's answer lands late", async () => {
    const first = deferred();
    const second = deferred();
    mocks.fetchApi.mockImplementation((path) => (String(path).endsWith("/t-1") ? first.promise : second.promise));
    const { rerender } = render(<Panel tripId="t-1" />);
    rerender(<Panel tripId="t-2" />);
    await act(async () => second.resolve(preview({ comments: [comment("c-2")] })));
    await act(async () => first.resolve(preview({ comments: [comment("c-1")] })));
    expect(screen.getByText("Comment c-2")).toBeInTheDocument();
    expect(screen.queryByText("Comment c-1")).not.toBeInTheDocument();
  });

  it("opens at the comment it was opened for, with its reply box ready", async () => {
    mocks.fetchApi.mockResolvedValue(preview({ comments: [comment("c-1"), comment("c-2")] }));
    render(<Panel focus={{ type: "comment", id: "c-2" }} />);
    const box = await screen.findByPlaceholderText("Write a reply…");
    expect(box).toHaveFocus();
    expect(box.closest("[data-comment-id]")).toHaveAttribute("data-comment-id", "c-2");
  });
});

describe("TripSlideOver changes", () => {
  it("tells the dashboard once a reply is saved", async () => {
    mocks.fetchApi.mockImplementation((path) =>
      String(path).endsWith("/reply") ? Promise.resolve({ comment: {} }) : Promise.resolve(preview()),
    );
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Yes")).toBeInTheDocument();
  });

  it("says nothing when the reply fails", async () => {
    mocks.fetchApi.mockImplementation((path) =>
      String(path).endsWith("/reply") ? Promise.reject(new Error("no")) : Promise.resolve(preview()),
    );
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));
    expect(await screen.findByText("Failed to send reply. Please try again.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not call a saved reply failed when the dashboard's handler throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchApi.mockImplementation((path) =>
      String(path).endsWith("/reply") ? Promise.resolve({ comment: {} }) : Promise.resolve(preview()),
    );
    render(<Panel onChanged={() => { throw new Error("boom"); }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));
    await settle();
    expect(screen.queryByText("Failed to send reply. Please try again.")).not.toBeInTheDocument();
  });

  it("updates the expiry and tells the dashboard after Extend", async () => {
    const live = { ...preview().share, expiresAt: "2026-10-03T00:00:00.000Z" };
    mocks.fetchApi.mockImplementation((path) =>
      String(path).endsWith("/expiry")
        ? Promise.resolve({ share: { ...live, expiresAt: "2099-01-01T12:00:00.000Z" } })
        : Promise.resolve(preview({ share: live })),
    );
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Extend 30 days" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Expires Jan 1, 2099")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx`
Expected: FAIL. The old panel calls the share endpoints, and the dialog is named "Trip comments: …".

- [ ] **Step 4: Rewrite `D/TripSlideOver.jsx`.** Keep `TABBABLE_SELECTOR`, `isTabbable`, `tabbablesIn`, `LoadAlert` and the three focus effects (opener return, focus-in on open or trip change, Tab cycling) **verbatim**. Delete `getStatusClasses`, `getStatusLabel`, the old `CommentCard`, the share/comment fetching, `handleReplySent`, the `grouped` memo and the count badges. The file becomes:

```jsx
"use client";

/**
 * TripSlideOver — the dashboard's trip panel: a right-side drawer with the
 * trip at a glance (status, client, dates, travelers), its share link (views,
 * rating, expiry, Extend) and every client comment with an inline reply.
 *
 * `focus` says what the person clicked for: { type: "comment", id } scrolls to
 * that comment with its reply box open, { type: "share" } scrolls to the share
 * link, null starts at the top.
 */

import { useCallback, useEffect, useRef } from "react";
import { CloseIcon } from "@/app/components/icons/index.js";
import { useTripPreview } from "@/app/hooks/useTripPreview.js";
import CommentsSection from "./tripPanel/CommentsSection";
import SharedLinkSection from "./tripPanel/SharedLinkSection";
import { describeTripLine } from "./tripPanel/tripPanelFormat";
import TripStatusChip from "./widgets/TripStatusChip";

// ─── Focus containment ───────────────────────────────────────────────────────
// (TABBABLE_SELECTOR, isTabbable, tabbablesIn: unchanged)

// ─── Load failure notice ─────────────────────────────────────────────────────
// (LoadAlert: unchanged)

/**
 * `returnFocusRef` (optional) names where focus goes on close when the element
 * that opened the panel has left the page. `onChanged()` (optional) runs after
 * a reply or an extension is saved, so the dashboard can reload what still
 * needs the agent.
 */
export default function TripSlideOver({
  isOpen,
  onClose,
  agencyId,
  tripId,
  tripTitle = "Trip",
  subtitle = null,
  focus = null,
  onOpenFull,
  returnFocusRef = undefined,
  onChanged = undefined,
}) {
  const { data, error, loading, reload, update } = useTripPreview({ agencyId, tripId, enabled: isOpen });
  const closeButtonRef = useRef(null);
  const panelRef = useRef(null);
  // Where focus rests while the list's own controls (the Retry button) are swapped out.
  const listRef = useRef(null);
  const shareSectionRef = useRef(null);

  // (returnFocusRefLatest ref + its effect: unchanged)
  // (focus effect 1 — remember the opener and send focus back on close: unchanged)
  // (focus effect 2 — into the panel on open and on trip change: unchanged)
  // (focus effect 3 — Tab and Shift+Tab cycle inside the open panel: unchanged)

  // Retry swaps its own alert for the spinner, which would drop focus to <body>
  // inside an aria-modal dialog. Park focus on the list first.
  const retry = useCallback(() => {
    listRef.current?.focus();
    reload();
  }, [reload]);

  // Close on Escape, unless the person is typing a reply (Escape closes that box instead).
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEsc = (e) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof HTMLTextAreaElement) return;
      onClose?.();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // Once loaded, bring what was clicked for into view.
  const focusKey = focus ? `${focus.type}:${focus.id ?? ""}` : "";
  useEffect(() => {
    if (!isOpen || !data || !focusKey) return;
    let target = null;
    if (focus?.type === "share") target = shareSectionRef.current;
    if (focus?.type === "comment") {
      target = [...(panelRef.current?.querySelectorAll("[data-comment-id]") ?? [])].find(
        (element) => element.getAttribute("data-comment-id") === focus.id,
      );
    }
    target?.scrollIntoView?.({ block: "center" });
    // focusKey stands in for `focus`, which parents may pass as a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, data, focusKey]);

  // Saved changes are already on screen. A throwing dashboard handler must not
  // reach the reply's catch and report "Failed to send reply"; log it instead.
  const notifyChanged = useCallback(() => {
    try {
      onChanged?.();
    } catch (err) {
      console.error("TripSlideOver: onChanged threw after a saved change", err);
    }
  }, [onChanged]);

  const handleReplySent = useCallback(
    (commentId, content) => {
      update((prev) => ({
        ...prev,
        comments: (prev.comments ?? []).map((c) =>
          c.id === commentId ? { ...c, agencyReply: content, agencyRepliedAt: new Date().toISOString(), status: "ADDRESSED" } : c,
        ),
      }));
      notifyChanged();
    },
    [update, notifyChanged],
  );

  const handleExtended = useCallback(
    (share) => {
      if (share) update((prev) => ({ ...prev, share: { ...prev.share, expiresAt: share.expiresAt } }));
      else reload();
      notifyChanged();
    },
    [update, reload, notifyChanged],
  );

  const title = data?.trip?.title ?? tripTitle;
  const tripLine = describeTripLine(data?.trip, subtitle);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* While closed the panel only sits off-screen, so `inert` keeps its buttons out of the tab order and `aria-hidden` out of the accessibility tree. */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-label={`Trip: ${title}`}
        aria-modal="true"
        aria-hidden={isOpen ? undefined : true}
        inert={!isOpen}
        className={`fixed top-0 right-0 z-[61] flex h-full w-full max-w-md flex-col border-l border-border/10 bg-background shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-border/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            {data?.trip?.status ? (
              <div className="mb-1.5">
                <TripStatusChip status={data.trip.status} />
              </div>
            ) : null}
            <h2 className="truncate font-sans text-base font-semibold leading-snug tracking-normal text-text-primary">{title}</h2>
            {tripLine ? <p className="mt-0.5 truncate text-xs text-text-muted">{tripLine}</p> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            aria-label="Close panel"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        {/* Not a tab stop: Retry moves focus here before its alert unmounts, so it stays inside the dialog. */}
        <div
          ref={listRef}
          role="region"
          aria-label="Trip details"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 focus:outline-none"
        >
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-secondary border-t-transparent" />
              <p className="text-xs text-text-muted">Loading trip…</p>
            </div>
          ) : null}

          {!loading && error ? <LoadAlert message="Couldn't load this trip." onRetry={retry} /> : null}

          {data ? (
            <>
              <SharedLinkSection
                ref={shareSectionRef}
                agencyId={agencyId}
                share={data.share ?? null}
                onExtended={handleExtended}
              />
              <div className="border-t border-border/10" />
              <CommentsSection
                comments={data.comments ?? []}
                agencyId={agencyId}
                focusCommentId={focus?.type === "comment" ? focus.id : null}
                onReplySent={handleReplySent}
              />
            </>
          ) : null}
        </div>

        <div className="flex-shrink-0 border-t border-border/10 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              onOpenFull?.(tripId);
              onClose?.();
            }}
            className="w-full rounded-lg border border-secondary/30 bg-secondary/5 px-4 py-2.5 text-sm font-bold text-secondary-strong transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
          >
            Open in Planner →
          </button>
        </div>
      </aside>
    </>
  );
}
```

`CommentsSection` sits inside `{data ? … : null}`. Mounting it after the load is what lets `defaultReplyOpen` take effect for the focused comment. Its `useState(defaultReplyOpen)` only reads the initial value.

- [ ] **Step 5: Update the other panel tests.**
  - `tests/trip-slide-over-focus.test.jsx`: replace every `/^Trip comments:/` with `/^Trip:/`, and every `"Trip comments: …"` string with `"Trip: …"`. Its catch-all mock (`{ shares: [], comments: [] }`) still works, because the panel falls back to the `tripTitle` prop when `data.trip` is missing.
  - `tests/dashboard-reply-refresh.test.jsx`:
    - In `serve`, replace the two share lines with: `if (url.includes("/dashboard/trips/")) return Promise.resolve({ trip: { id: "t", title: "Kyoto Autumn Escape", status: "IN_REVIEW", clientName: "Maria Santos" }, share: null, comments: [PENDING_COMMENT] });`
    - Replace `/^Trip comments:/` with `/^Trip:/` and `/^Trip comments: Kyoto Autumn Escape/` with `/^Trip: Kyoto Autumn Escape/`.
    - In "reloads the to-do list…", delete the line that clicks the panel's "Reply" button. The panel now opens with that comment's reply box already open.
    - Give `PENDING_COMMENT` the id the fixture row uses: `id: fixtures.ownerBusy.worklist.unreadComments[0].id`. Use the same id for the staff case; both fixtures share the Kyoto comments.
    - Add `agencyReply: null, dayNumber: null, itemId: null, itemTitle: null` to `PENDING_COMMENT`.
  - `tests/heading-typography.test.js`: change `["…/TripSlideOver.jsx", "{tripTitle}", "sans"]` to `"{title}"`. Add these to `SCOPED_FILES`:
    - `"app/agency/[agencyId]/components/dashboard/tripPanel/CommentsSection.jsx"`
    - `"app/agency/[agencyId]/components/dashboard/tripPanel/SharedLinkSection.jsx"`

- [ ] **Step 6: Run the panel tests**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx tests/trip-slide-over-focus.test.jsx tests/dashboard-reply-refresh.test.jsx tests/heading-typography.test.js`
Expected: PASS. If "opens at the comment…" fails on focus because the close button grabbed it after the textarea, check effect order. The close-button focus effect runs on `[isOpen, tripId]`, before the load, and the textarea mounts after the load. So the textarea must win. If it doesn't, the effect is keyed on `data` by mistake.

- [ ] **Step 7: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard" tests/trip-slide-over-comments.test.jsx tests/trip-slide-over-focus.test.jsx tests/dashboard-reply-refresh.test.jsx tests/heading-typography.test.js
git commit -m "feat(dashboard): turn the comments panel into a trip panel"
```

---

### Task 16: "Needs you today" — author label, Extend, and where each row goes

**Files:**
- Modify: `D/worklistContext.js`, `D/needsYouItems.js`
- Test: `tests/dashboard-worklist-context.test.js`, `tests/needs-you-items.test.js`

- [ ] **Step 1: Write the failing tests.** Add to `tests/dashboard-worklist-context.test.js`, inside its describe:

```js
  it("names who commented when the server says", () => {
    const item = { authorName: "Maria Santos", commentExcerpt: "Hi", createdAt: iso(-6 * HOUR) };
    expect(describeWorklistItem("unreadComments", item, NOW).subtitle).toBe("Comment from Maria Santos");
  });
```

Add to `tests/needs-you-items.test.js`. Extend its import with `needsYouTarget`:

```js
describe("needsYouTarget", () => {
  it("opens the trip panel at the comment, at the link, or at the top; drafts resume in the Planner", () => {
    const items = buildNeedsYouItems(fixtures.ownerBusy.worklist, OWNER_NEEDS_YOU_ORDER, NOW);
    const of = (kind) => items.find((item) => item.kind === kind);
    expect(needsYouTarget(of("unreadComments"))).toEqual({ to: "panel", focus: { type: "comment", id: of("unreadComments").rowId } });
    expect(needsYouTarget(of("sharesExpiring"))).toEqual({ to: "panel", focus: { type: "share" } });
    expect(needsYouTarget(of("lowRated"))).toEqual({ to: "panel", focus: null });
    expect(needsYouTarget(of("draftsStuck"))).toEqual({ to: "planner" });
  });

  it("calls the staff link action Extend, like the owner's", () => {
    const staffItems = buildNeedsYouItems(fixtures.staff.worklist, STAFF_NEEDS_YOU_ORDER, NOW);
    expect(staffItems.find((item) => item.kind === "mySharesExpiring").actionLabel).toBe("Extend");
  });

  it("keeps each row's own id for the panel to find", () => {
    const comment = ownerItems().find((item) => item.kind === "unreadComments");
    expect(comment.rowId).toBe(fixtures.ownerBusy.worklist.unreadComments.find((row) => comment.key.endsWith(row.id)).id);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-context.test.js tests/needs-you-items.test.js`
Expected: FAIL. The subtitle is still the quote, `needsYouTarget` is undefined, and the staff label is "Nudge".

- [ ] **Step 3: Implement.** In `worklistContext.js`, change the `unreadComments` case:

```js
    case "unreadComments": {
      const waited = since(item.createdAt, now);
      const quote = item.commentExcerpt ? `“${item.commentExcerpt}”` : null;
      return {
        subtitle: item.authorName ? `Comment from ${item.authorName}` : quote,
        hint: waited && `Waiting ${waited}`,
      };
    }
```

In `needsYouItems.js`:
- Update the header comment to say rows route through `needsYouTarget`.
- In `STAFF_NEEDS_YOU_ORDER`, change `actionLabel: "Nudge"` to `actionLabel: "Extend"`.
- In `buildNeedsYouItems`, add `rowId: row.id ?? null,` after `kind: group.key,`.
- Append:

```js
const PLANNER_KINDS = new Set(["draftsStuck", "myDraftsStuck"]);
const SHARE_KINDS = new Set(["sharesExpiring", "mySharesExpiring"]);

/**
 * Where a "Needs you today" row goes. A stuck draft resumes in the Planner;
 * everything else opens the trip panel: at the comment for a comment, at the
 * share link for an expiring link, at the top otherwise.
 * @returns {{ to: "planner" } | { to: "panel", focus: object | null }}
 */
export function needsYouTarget(item) {
  if (PLANNER_KINDS.has(item.kind)) return { to: "planner" };
  if (item.kind === "unreadComments") return { to: "panel", focus: { type: "comment", id: item.rowId } };
  if (SHARE_KINDS.has(item.kind)) return { to: "panel", focus: { type: "share" } };
  return { to: "panel", focus: null };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-context.test.js tests/needs-you-items.test.js tests/needs-you-list.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/worklistContext.js" "app/agency/[agencyId]/components/dashboard/needsYouItems.js" tests/dashboard-worklist-context.test.js tests/needs-you-items.test.js
git commit -m "feat(dashboard): name comment authors and route to-do rows to the trip panel"
```

---

### Task 17: Client comments card

**Files:**
- Create: `D/widgets/ClientCommentsCard.jsx`
- Test: `tests/client-comments-card.test.jsx`

- [ ] **Step 1: Write the failing tests** in `tests/client-comments-card.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ClientCommentsCard from "../app/agency/[agencyId]/components/dashboard/widgets/ClientCommentsCard.jsx";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const row = (id, fields = {}) => ({
  id,
  shareId: "s1",
  tripId: "t1",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Santos Family",
  authorName: "Maria Santos",
  excerpt: "Is the ryokan wheelchair accessible?",
  dayNumber: 1,
  itemTitle: "Ryokan check-in",
  createdAt: "2026-10-20T06:00:00.000Z",
  agencyReply: null,
  agencyRepliedAt: null,
  ...fields,
});
const comments = {
  waiting: [row("w1"), row("w2", { authorName: "Leo Cruz", tripTitle: "Boracay", dayNumber: 2, itemTitle: null })],
  answered: [row("a1", { agencyReply: "Yes, it is.", agencyRepliedAt: "2026-10-18T12:00:00.000Z" })],
};

describe("ClientCommentsCard", () => {
  it("lists waiting comments by default, with who, where and how long", () => {
    render(<ClientCommentsCard comments={comments} onOpenComment={vi.fn()} now={NOW} />);
    const card = screen.getByRole("region", { name: "Client comments" });
    expect(within(card).getByRole("button", { name: "Waiting (2)" })).toHaveAttribute("aria-pressed", "true");
    const first = within(card).getAllByRole("button", { name: /^Maria Santos/ })[0];
    expect(within(first).getByText("Kyoto Autumn Escape · Day 1 · Ryokan check-in")).toBeInTheDocument();
    expect(within(first).getByText("“Is the ryokan wheelchair accessible?”")).toBeInTheDocument();
    expect(within(first).getByText("Waiting 6h")).toBeInTheDocument();
  });

  it("switches to answered comments and shows the reply", () => {
    render(<ClientCommentsCard comments={comments} onOpenComment={vi.fn()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Answered (1)" }));
    expect(screen.getByText("You: Yes, it is.")).toBeInTheDocument();
    expect(screen.getByText("Replied 2d ago")).toBeInTheDocument();
  });

  it("opens the comment that was clicked", () => {
    const onOpenComment = vi.fn();
    render(<ClientCommentsCard comments={comments} onOpenComment={onOpenComment} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /^Leo Cruz/ }));
    expect(onOpenComment).toHaveBeenCalledWith(comments.waiting[1]);
  });

  it("says when nothing is waiting", () => {
    render(<ClientCommentsCard comments={{ waiting: [], answered: [] }} onOpenComment={vi.fn()} now={NOW} />);
    expect(screen.getByText("No comments are waiting for a reply.")).toBeInTheDocument();
  });

  it("shows five rows, then the rest on request", () => {
    const many = { waiting: Array.from({ length: 7 }, (_, i) => row(`w${i}`, { authorName: `Client ${i}` })), answered: [] };
    render(<ClientCommentsCard comments={many} onOpenComment={vi.fn()} now={NOW} />);
    expect(screen.getAllByRole("button", { name: /^Client \d/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all (7)" }));
    expect(screen.getAllByRole("button", { name: /^Client \d/ })).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/client-comments-card.test.jsx`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement** `D/widgets/ClientCommentsCard.jsx`:

```jsx
"use client";

import { useId, useState } from "react";
import { useNowMinute } from "@/app/hooks/useLocalClock";
import { timeAgo } from "@/app/lib/relativeTime";
import { commentPlace } from "../tripPanel/tripPanelFormat";

/** Rows shown before "Show all". */
const VISIBLE = 5;
/** Buttons dip to 97% while pressed. `scale` is the property Tailwind's scale utilities set, so it must be the one transitioned. */
const PRESS = "transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]";

const FILTERS = [
  { key: "waiting", label: "Waiting", empty: "No comments are waiting for a reply." },
  { key: "answered", label: "Answered", empty: "No replies in the last 30 days." },
];

/** "Waiting 6h" for an open comment, "Replied 2d ago" for an answered one; null before the clock is known. */
function rowTime(row, now) {
  if (now === null) return null;
  if (row.agencyRepliedAt) return `Replied ${timeAgo(row.agencyRepliedAt, now).toLowerCase()}`;
  const ago = timeAgo(row.createdAt, now);
  return ago === "Just now" ? "Waiting under a minute" : `Waiting ${ago.replace(/ ago$/, "")}`;
}

/**
 * "Client comments": every comment waiting for the agency, and the ones
 * answered in the last 30 days, so nobody has to hunt for what a client asked
 * or what the team said. Each row opens the trip panel at that comment
 * through `onOpenComment(row)`. `now` (epoch ms) is for tests; the page uses
 * the browser's minute clock so server and browser renders agree.
 */
export default function ClientCommentsCard({ comments, onOpenComment, now: nowProp }) {
  const headingId = useId();
  const clock = useNowMinute();
  const now = nowProp ?? clock;
  const [filter, setFilter] = useState("waiting");
  const [expanded, setExpanded] = useState(false);
  const rows = comments?.[filter] ?? [];
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const active = FILTERS.find((f) => f.key === filter);

  return (
    <section aria-labelledby={headingId} className="frame-tile rounded-[20px] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <h2 id={headingId} className="font-sans text-[15px] font-semibold tracking-normal text-text-primary">
          Client comments
        </h2>
        <div role="group" aria-label="Show comments" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setExpanded(false);
              }}
              className={`min-h-9 rounded-lg px-2.5 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${PRESS} ${
                filter === f.key ? "bg-secondary-strong text-on-secondary-strong" : "text-text-muted hover:bg-text-primary/5"
              }`}
            >
              {`${f.label} (${comments?.[f.key]?.length ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 py-1 text-[13px] text-text-muted">{active.empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--frame-border)]">
          {shown.map((row) => {
            const time = rowTime(row, now);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenComment(row)}
                className={`flex w-full min-w-0 flex-col gap-0.5 rounded-md py-2 text-left hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${PRESS}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-text-primary">{row.authorName}</span>
                  {time ? <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{time}</span> : null}
                </span>
                <span className="truncate text-[12px] text-text-muted">{`${row.tripTitle} · ${commentPlace(row)}`}</span>
                <span className="line-clamp-2 text-[13px] text-text-primary">{`“${row.excerpt}”`}</span>
                {row.agencyReply ? (
                  <span className="line-clamp-1 text-[12px] text-text-muted">{`You: ${row.agencyReply}`}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {rows.length > VISIBLE ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={`mt-1 min-h-[44px] rounded-lg px-2 text-[13px] font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${PRESS}`}
        >
          {expanded ? "Show fewer" : `Show all (${rows.length})`}
        </button>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/client-comments-card.test.jsx`
Expected: PASS (5 tests). `commentPlace` gives "Day 1 · Ryokan check-in" here, because card rows carry no `itemId`. A deleted stop reads as just "Day N", which is fine for the card.

- [ ] **Step 5: Add the file to `tests/heading-typography.test.js` `SCOPED_FILES`**, then run that test.

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/ClientCommentsCard.jsx" tests/client-comments-card.test.jsx tests/heading-typography.test.js
git commit -m "feat(dashboard): client comments card with waiting and answered"
```

---

### Task 18: Trip list panel (replaces the funnel placeholder)

**Files:**
- Create: `D/widgets/TripListPanel.jsx`
- Delete: `D/widgets/FunnelStageDetailPanel.jsx`
- Modify: `D/widgets/FunnelChart.jsx`, `D/widgets/InsightsColumn.jsx`
- Test: `tests/trip-list-panel.test.jsx`; update `tests/dashboard-insights-widgets.test.jsx`, `tests/heading-typography.test.js`

- [ ] **Step 1: Write the failing tests** in `tests/trip-list-panel.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FunnelChart from "../app/agency/[agencyId]/components/dashboard/widgets/FunnelChart.jsx";
import TripListPanel from "../app/agency/[agencyId]/components/dashboard/widgets/TripListPanel.jsx";

const trips = [
  { tripId: "t1", tripTitle: "Kyoto Autumn Escape", clientName: "Maria Santos", status: "IN_REVIEW" },
  { tripId: "t2", tripTitle: "Baguio Weekend", clientName: null, status: "APPROVED_INTERNAL" },
];

describe("TripListPanel", () => {
  it("lists the trips and opens the one clicked", () => {
    const onOpenTrip = vi.fn();
    const onClose = vi.fn();
    render(<TripListPanel isOpen title="Shared with client" summary="2 trips" trips={trips} onOpenTrip={onOpenTrip} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Shared with client" });
    expect(within(dialog).getByText("2 trips")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Kyoto Autumn Escape/ }));
    expect(onOpenTrip).toHaveBeenCalledWith("t1", "Kyoto Autumn Escape", "Maria Santos");
    expect(onClose).toHaveBeenCalled();
  });

  it("says when a list is empty, and notes a cut-off list", () => {
    const { rerender } = render(<TripListPanel isOpen title="Drafts" trips={[]} onOpenTrip={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No trips here right now.")).toBeInTheDocument();
    rerender(<TripListPanel isOpen title="Drafts" trips={trips} total={60} onOpenTrip={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Showing the latest 2 of 60.")).toBeInTheDocument();
  });

  it("closes on Escape and renders nothing while closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(<TripListPanel isOpen title="Drafts" trips={trips} onOpenTrip={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    rerender(<TripListPanel isOpen={false} title="Drafts" trips={trips} onOpenTrip={vi.fn()} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("FunnelChart stage lists", () => {
  it("opens a stage's trips, and each opens the trip panel", () => {
    const onOpenTrip = vi.fn();
    const stages = [
      { key: "created", count: 2, dropOffPct: null, trips },
      { key: "sent", count: 1, dropOffPct: 50, trips: [trips[0]] },
    ];
    render(<FunnelChart stages={stages} agencyId="a1" onOpenTrip={onOpenTrip} />);
    fireEvent.click(screen.getByRole("button", { name: "Shared with client: 1. Open trip list." }));
    const dialog = screen.getByRole("dialog", { name: "Shared with client" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Kyoto Autumn Escape/ }));
    expect(onOpenTrip).toHaveBeenCalledWith("t1", "Kyoto Autumn Escape", "Maria Santos");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/trip-list-panel.test.jsx`
Expected: FAIL, because `TripListPanel` doesn't exist.

- [ ] **Step 3: Implement** `D/widgets/TripListPanel.jsx`:

```jsx
"use client";

import { useEffect, useId, useRef } from "react";
import TripStatusChip from "./TripStatusChip";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A right-side list of trips behind a dashboard number (a Trip progress
 * stage, a staff counter). Clicking a trip closes this list and calls
 * `onOpenTrip(tripId, tripTitle, clientName)`, which opens the trip panel.
 * `total` is the exact count when the server cut the list short.
 */
export default function TripListPanel({ isOpen, title, summary = null, trips = [], total = null, onOpenTrip, onClose }) {
  const headingId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="relative flex h-full w-full flex-col bg-surface shadow-xl md:w-[380px]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/10 px-6 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={headingId} className="font-sans text-base font-semibold tracking-normal text-text-primary">
              {title}
            </h2>
            {summary ? <p className="m-0 text-xs text-text-muted">{summary}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/20 bg-surface-elevated text-text-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
          {trips.length === 0 ? (
            <p className="m-0 px-2 text-sm text-text-muted">No trips here right now.</p>
          ) : (
            trips.map((trip) => (
              <button
                key={trip.tripId}
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTrip(trip.tripId, trip.tripTitle, trip.clientName);
                }}
                className="frame-tile flex w-full flex-col gap-1 rounded-[12px] px-3 py-2 text-left hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-text-primary">{trip.tripTitle}</span>
                  <TripStatusChip status={trip.status} />
                </span>
                <span className="truncate text-[12px] text-text-muted">{trip.clientName || "No client name"}</span>
              </button>
            ))
          )}
          {total != null && total > trips.length ? (
            <p className="m-0 px-2 text-xs text-text-muted">{`Showing the latest ${trips.length} of ${total}.`}</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
```

`onClose()` runs before `onOpenTrip`, so this panel's focus-return runs first. The trip panel then records the restored opener (the stage button) as where to return focus.

- [ ] **Step 4: Use it in FunnelChart.** In `FunnelChart.jsx`:
  - Replace the `FunnelStageDetailPanel` import with `import TripListPanel from "./TripListPanel";`.
  - Add `onOpenTrip` to the props: `export default function FunnelChart({ stages = [], agencyId, periodLabel, onOpenTrip = () => {} })`.
  - Update the doc comment: "Click a stage to list its trips; each opens the trip panel."
  - Replace the `<FunnelStageDetailPanel …/>` element with:

```jsx
      <TripListPanel
        isOpen={!!activeStage}
        title={activeStage ? STAGE_LABELS[activeStage.key] ?? activeStage.key : ""}
        summary={activeStage ? `${activeStage.count} trip${activeStage.count === 1 ? "" : "s"}${periodLabel ? ` · ${periodLabel}` : ""}` : null}
        trips={activeStage?.trips ?? []}
        total={activeStage?.count ?? null}
        onOpenTrip={onOpenTrip}
        onClose={() => setActiveStage(null)}
      />
```

`agencyId` is no longer used inside FunnelChart. Keep the prop accepted, because callers and tests pass it, and don't use it.

In `InsightsColumn.jsx`, pass `onOpenTrip={onOpenViewedTrip}` to `<FunnelChart …/>`. Update its doc comment to "…trip progress (each stage lists its trips)…".

- [ ] **Step 5: Delete the placeholder and fix references**

Run: `git rm "app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx"`
In `tests/heading-typography.test.js`, swap the `FunnelStageDetailPanel.jsx` path in `SCOPED_FILES` for `…/widgets/TripListPanel.jsx`, and change the heading expectation to `["…/widgets/TripListPanel.jsx", "{title}", "sans"]`.
Run: `grep -rn "FunnelStageDetailPanel" app tests` and expect no output.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --pool=threads tests/trip-list-panel.test.jsx tests/dashboard-insights-widgets.test.jsx tests/heading-typography.test.js tests/dashboard-server-contract.test.jsx`
Expected: PASS. If `dashboard-insights-widgets.test.jsx` asserted the old placeholder text, replace that assertion with the dialog title check from Step 1.

- [ ] **Step 7: Commit**

```bash
git add -A "app/agency/[agencyId]/components/dashboard/widgets" tests/trip-list-panel.test.jsx tests/dashboard-insights-widgets.test.jsx tests/heading-typography.test.js
git commit -m "feat(dashboard): list the trips behind each trip progress stage"
```

---

### Task 19: Staff counters open their trip lists

**Files:**
- Modify: `D/widgets/MyWorkColumn.jsx`, `D/StaffMyWork.jsx`, `app/components/trip-dashboard/HomePage.jsx`
- Test: `tests/staff-counter-lists.test.jsx`

- [ ] **Step 1: Write the failing test** in `tests/staff-counter-lists.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import MyWorkColumn from "../app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx";

const row = (tripId, tripTitle) => ({ tripId, tripTitle, clientName: "Ana", status: "DRAFT" });
const pipeline = { drafts: 2, inReview: 0, approvedThisMonth: 0, activeNow: 0 };
const pipelineTrips = { drafts: [row("d1", "Batanes"), row("d2", "Siargao")], inReview: [], approvedThisMonth: [], activeNow: [] };

describe("staff counters", () => {
  it("list the trips behind a counter, and open the one clicked in the trip panel", () => {
    const onOpenViewedTrip = vi.fn();
    render(
      <MyWorkColumn hero={null} pipeline={pipeline} pipelineTrips={pipelineTrips} agencyId="a1" onOpenTrip={vi.fn()} onOpenViewedTrip={onOpenViewedTrip} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Drafts/ }));
    const dialog = screen.getByRole("dialog", { name: "Your drafts" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Siargao/ }));
    expect(onOpenViewedTrip).toHaveBeenCalledWith("d2", "Siargao", "Ana");
  });

  it("are plain numbers for a server that doesn't send the lists", () => {
    render(<MyWorkColumn hero={null} pipeline={pipeline} agencyId="a1" onOpenTrip={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Drafts/ })).not.toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/staff-counter-lists.test.jsx`
Expected: FAIL, because no dialog opens.

- [ ] **Step 3: Implement.** In `MyWorkColumn.jsx`:
  - Remove `useRouter`, `goToList`, `agencyId`'s router use, and the `onOpenItineraries` prop.
  - Add `import { useState } from "react";` (merge it with the `useId` import) and `import TripListPanel from "./TripListPanel";`.
  - Change `PipelineCounter` so it renders a `<div>` when there is no `onClick`:

```jsx
function PipelineCounter({ label, value, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`frame-tile flex flex-col items-start rounded-[12px] px-3 py-2 text-left ${
        onClick ? `hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${PRESS}` : ""
      }`}
    >
      <span className="text-[20px] font-semibold leading-none tabular-nums text-text-primary">{value ?? 0}</span>
      <span className="mt-1 text-[12px] text-text-muted">{label}</span>
    </Tag>
  );
}
```

  - Add above the component:

```jsx
/** Each counter: its label, the payload keys, and its list's title. */
const COUNTERS = [
  { key: "drafts", label: "Drafts", title: "Your drafts" },
  { key: "inReview", label: "In review", title: "Your trips in review" },
  { key: "approvedThisMonth", label: "Approved this month", title: "Approved this month" },
  { key: "activeNow", label: "Traveling now", title: "Traveling now" },
];
```

  - Change the signature to `export default function MyWorkColumn({ hero, recent = [], pipeline, pipelineTrips = null, onOpenTrip, recentViews, onOpenViewedTrip })`, and update its doc comment: "the trips by status (each count lists its trips, which open the trip panel; plain numbers without `pipelineTrips`)". Add `const [openCounter, setOpenCounter] = useState(null);`.
  - Replace the four `<PipelineCounter …/>` elements with:

```jsx
            {COUNTERS.map((counter) => (
              <PipelineCounter
                key={counter.key}
                label={counter.label}
                value={pipeline[counter.key]}
                onClick={pipelineTrips ? () => setOpenCounter(counter) : undefined}
              />
            ))}
```

  - Before the closing `</aside>`, add:

```jsx
      <TripListPanel
        isOpen={!!openCounter}
        title={openCounter?.title ?? ""}
        trips={openCounter ? pipelineTrips?.[openCounter.key] ?? [] : []}
        total={openCounter ? pipeline?.[openCounter.key] ?? null : null}
        onOpenTrip={(tripId, tripTitle, clientName) => onOpenViewedTrip?.(tripId, tripTitle, clientName)}
        onClose={() => setOpenCounter(null)}
      />
```

In `StaffMyWork.jsx`:
- Remove the `onOpenItineraries` prop.
- Pass `pipelineTrips={data.pipelineTrips ?? null}` to `<MyWorkColumn>` and remove `onOpenItineraries={onOpenItineraries}`.
- Update the doc comment: "trips by status (each lists its trips)".

In `HomePage.jsx`, delete the `onOpenItineraries={() => setActiveTab("itineraries")}` line on `<StaffMyWork>`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/staff-counter-lists.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-rail.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: PASS. Leftover `onOpenItineraries={vi.fn()}` props in old tests are ignored harmlessly, so delete them only if a lint rule complains.

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard" app/components/trip-dashboard/HomePage.jsx tests/staff-counter-lists.test.jsx
git commit -m "feat(dashboard): staff counters list their trips"
```

---

### Task 20: Calendar items open the panel where they point

**Files:**
- Modify: `app/lib/calendarDays.js`, `D/widgets/AgencyCalendar.jsx`
- Test: `tests/calendar-days.test.js`, `tests/agency-calendar.test.jsx`

- [ ] **Step 1: Write the failing test.** Add to `tests/calendar-days.test.js`, extending its import with `dayItemFocus`:

```js
describe("dayItemFocus", () => {
  it("opens the trip panel at a comment, at the link, or at the top", () => {
    expect(dayItemFocus({ key: "client_commented:c-42", kind: "client_commented" })).toEqual({ type: "comment", id: "c-42" });
    expect(dayItemFocus({ key: "share_expires:s-1", kind: "share_expires" })).toEqual({ type: "share" });
    expect(dayItemFocus({ key: "trip:t-1", kind: "trip" })).toBeNull();
  });
});
```

In `tests/agency-calendar.test.jsx` line 95, change the expectation to `expect(onOpenTrip).toHaveBeenCalledWith("t-kyoto", "Kyoto Autumn Escape", "Reyes", null);`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js tests/agency-calendar.test.jsx`
Expected: FAIL. `dayItemFocus` is not exported, and the 4th argument is missing.

- [ ] **Step 3: Implement.** Append to `app/lib/calendarDays.js`:

```js
/**
 * Where the trip panel should open for a day-details item: at the comment
 * for a client comment (event ids are "{kind}:{source row id}"), at the share
 * link for a link expiry, at the top for anything else.
 */
export function dayItemFocus(item) {
  if (item.kind === "client_commented") return { type: "comment", id: item.key.slice("client_commented:".length) };
  if (item.kind === "share_expires") return { type: "share" };
  return null;
}
```

In `AgencyCalendar.jsx`:
- Import `dayItemFocus` alongside the other `@/app/lib/calendarDays` imports.
- In `handleAction`, change the call to `onOpenTrip?.(item.tripId, item.tripTitle, item.clientName, dayItemFocus(item));`.
- Update the doc comment on line 133 to `onOpenTrip(tripId, tripTitle, clientName, focus)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js tests/agency-calendar.test.jsx tests/calendar-day-popover.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/calendarDays.js "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/calendar-days.test.js tests/agency-calendar.test.jsx
git commit -m "feat(dashboard): calendar comments and link expiries open the panel at them"
```

---

### Task 21: Wire the dashboards

**Files:**
- Modify: `D/OwnerOverview.jsx`, `D/StaffMyWork.jsx`
- Test: `tests/dashboard-trip-panel-wiring.test.jsx`

- [ ] **Step 1: Write the failing tests** in `tests/dashboard-trip-panel-wiring.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/dashboard-payloads.json";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("../app/components/icons/index.js", () => ({ ChatIcon: () => null, CloseIcon: () => null, ReplyIcon: () => null }));
vi.mock("../app/lib/api/client.js", () => ({ API_URL: "/api", fetchApi: (...args) => mocks.fetchApi(...args) }));

import OwnerOverview from "../app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx";
import StaffMyWork from "../app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx";
import { resetCalendarCacheForTests } from "../app/hooks/useCalendarEvents.js";

const kyotoComment = fixtures.ownerBusy.clientComments.waiting[0];

beforeEach(() => {
  mocks.fetchApi.mockReset();
  mocks.push.mockReset();
  resetCalendarCacheForTests();
  mocks.fetchApi.mockImplementation((path) => {
    const url = String(path);
    if (url.includes("/dashboard/trips/")) {
      return Promise.resolve({
        trip: { id: kyotoComment.tripId, title: kyotoComment.tripTitle, status: "IN_REVIEW", clientName: "Santos Family" },
        share: null,
        comments: [{ ...kyotoComment, content: kyotoComment.excerpt, status: "PENDING", itemId: null }],
      });
    }
    return new Promise(() => {});
  });
});

describe.each([
  ["owner", fixtures.ownerBusy, (props) => <OwnerOverview agencyId="agency-1" {...props} />],
  ["staff", fixtures.staff, (props) => <StaffMyWork agencyId="agency-1" {...props} />],
])("%s dashboard", (_name, payload, ui) => {
  it("shows the Client comments card under Needs you today", () => {
    render(ui({ initialData: payload }));
    const needsYou = screen.getByRole("region", { name: "Needs you today" });
    const card = screen.getByRole("region", { name: "Client comments" });
    expect(needsYou.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the trip panel at a comment from the card, with its reply box ready", async () => {
    render(ui({ initialData: payload }));
    const card = screen.getByRole("region", { name: "Client comments" });
    fireEvent.click(within(card).getAllByRole("button", { name: new RegExp(`^${kyotoComment.authorName}`) })[0]);
    const panel = await screen.findByRole("dialog", { name: new RegExp(`^Trip: ${kyotoComment.tripTitle}`) });
    await waitFor(() => expect(within(panel).getByPlaceholderText("Write a reply…")).toHaveFocus());
  });

  it("opens the trip panel, not the Planner, for an expiring link's Extend", async () => {
    render(ui({ initialData: payload }));
    const needsYou = screen.getByRole("region", { name: "Needs you today" });
    const showAll = within(needsYou).queryByRole("button", { name: /^Show all/ });
    if (showAll) fireEvent.click(showAll);
    fireEvent.click(within(needsYou).getAllByRole("button", { name: "Extend" })[0]);
    expect(await screen.findByRole("dialog", { name: /^Trip:/ })).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/dashboard-trip-panel-wiring.test.jsx`
Expected: FAIL. There is no "Client comments" region, and Extend calls the Planner.

- [ ] **Step 3: Wire OwnerOverview.** In `OwnerOverview.jsx`:
  - Import `ClientCommentsCard` from `./widgets/ClientCommentsCard`.
  - Change the needsYouItems import to `import { OWNER_NEEDS_YOU_ORDER, buildNeedsYouItems, needsYouTarget } from "./needsYouItems";`.
  - Change the slide state comment to `// { tripId, tripTitle, subtitle, focus }`.
  - Replace `openSlideOver`, `handleNeedsYouAction` and `handleReplied` with:

```jsx
  // focus: null (top), { type: "comment", id } or { type: "share" } — see TripSlideOver.
  function openSlideOver(tripId, tripTitle, subtitle, focus = null) {
    setSlideTrip({ tripId, tripTitle: tripTitle ?? "Trip", subtitle: subtitle ?? null, focus });
  }

  function handleNeedsYouAction(item) {
    const target = needsYouTarget(item);
    if (target.to === "planner") openInCommandCenter(item.tripId);
    else openSlideOver(item.tripId, item.tripTitle, item.clientName, target.focus);
  }

  function openComment(row) {
    openSlideOver(row.tripId, row.tripTitle, row.clientName, { type: "comment", id: row.id });
  }

  // A reply or an extension changes what needs the agent: reload the to-do list and the calendar now.
  function handleChanged() {
    refetch().catch(() => {}); // a failed refetch already shows the stale-data banner
    setCalendarRefreshKey((key) => key + 1);
  }
```

  - In the left column, between the Needs-you block and the calendar block, add:

```jsx
          {data?.clientComments ? <ClientCommentsCard comments={data.clientComments} onOpenComment={openComment} /> : null}
```

  - On `<TripSlideOver>`, add `focus={slideTrip?.focus ?? null}` and replace `onReplied={handleReplied}` with `onChanged={handleChanged}`.
  - Update the component's doc comment:

```
 * Owner/admin dashboard: greeting, "Needs you today", "Client comments" and
 * the calendar on the left, Insights on the right. Every trip row, comment,
 * calendar action, trip-progress trip and Recently viewed row opens the trip
 * panel (at the comment or share link it is about); only "Resume" on a stuck
 * draft opens the Planner.
```

- [ ] **Step 4: Wire StaffMyWork the same way.** Make the same changes in `StaffMyWork.jsx`, with these names:
  - `openTripSlide(tripId, tripTitle, subtitle, focus = null)`.
  - `handleNeedsYouAction` using `needsYouTarget` and calling `openTrip` for the planner.
  - `openComment(row)` and `handleChanged()`.
  - The `ClientCommentsCard` between Needs you and the calendar.
  - `focus` and `onChanged` on `<TripSlideOver>`.
  - The doc comment updated to match.

- [ ] **Step 5: Run the dashboard tests**

Run: `npx vitest run --pool=threads tests/dashboard-trip-panel-wiring.test.jsx tests/dashboard-reply-refresh.test.jsx tests/trip-slide-over-focus.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-independent-loading.test.jsx tests/dashboard-hydration.test.jsx`
Expected: PASS. If `dashboard-hydration` complains that server and client HTML differ, the card's times are the cause: they must come from `useNowMinute` (null on the server), as implemented. Check that no `Date.now()` slipped into render.

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx" "app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx" tests/dashboard-trip-panel-wiring.test.jsx
git commit -m "feat(dashboard): client comments card and trip panel routing on both dashboards"
```

---

### Task 22: Itineraries page — per-trip comment badge

**Files:**
- Modify: `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`
- Test: `tests/client-itinerary-comment-badge.test.jsx`

- [ ] **Step 1: Write the failing test.** Create `tests/client-itinerary-comment-badge.test.jsx`.
  - Copy the whole module-mock block from `tests/client-itinerary-approve.test.jsx`, lines 1–115: the icons, ui, next/dynamic, map, ShareDialog, CommentsPanel, ItineraryDayView, MobileGlassSheet, CompactPlaceCard, pdfExport, ThemeProvider and formatters mocks, plus the API mock.
  - Change the API mock's two count functions to:

```js
  getUnreadCommentCount: vi.fn().mockResolvedValue({ count: 9 }),
  getUnreadCommentCountsByTrip: vi.fn().mockResolvedValue({ counts: [{ tripId: "t1", count: 2 }, { tripId: "t2", count: 7 }] }),
```

Then add:

```jsx
const trip = { id: "t1", clientName: "Alice", approvalStatus: "In review", destination: "Tokyo", itineraryId: "iter-1", isSaved: true };

describe("ClientItineraryPage comment badge", () => {
  it("counts only the open trip's unread comments, not the whole agency's", async () => {
    render(<ClientItineraryPage agencyTrips={[trip]} agencyId="agency-1" />);
    fireEvent.click(screen.getByText("Alice"));
    await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: "Comments" });
      expect(buttons.some((button) => within(button).queryByText("2"))).toBe(true);
    });
    for (const button of screen.getAllByRole("button", { name: "Comments" })) {
      expect(within(button).queryByText("9")).toBeNull();
    }
  });
});
```

Add `within` to the testing-library import. If the approve test selects a client differently (for example, the first client auto-selects), follow it and drop the `fireEvent.click`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run --pool=threads tests/client-itinerary-comment-badge.test.jsx`
Expected: FAIL, because a Comments button shows "9".

- [ ] **Step 3: Implement.** In `ClientItineraryPage.jsx`:
  - Delete the `const [unreadCommentCount, setUnreadCommentCount] = useState(0);` line.
  - Delete the whole effect commented "Fetch unread comment count when a trip with a valid agencyId is selected" (the one calling `getUnreadCommentCount`).
  - Remove `getUnreadCommentCount,` from the API import.
  - After the `unreadByClientId` memo, add:

```jsx
  // The open trip's own unread count, from the per-trip map the client list badges use.
  const unreadCommentCount = selectedTripId ? unreadByTrip[selectedTripId] ?? 0 : 0;
```

In the mobile header's icon-only Comments button (the one with `aria-label="Comments"` beside Share, around line 720), wrap the icon with a relative container and add the badge:

```jsx
                        <button
                          className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full border transition-all duration-200 ${showCommentsPanel
                            ? "bg-secondary text-white border-secondary"
                            : "bg-surface-elevated text-text-primary border-border/20"
                            }`}
                          onClick={() => setShowCommentsPanel((v) => !v)}
                          aria-label="Comments"
                        >
                        <ChatIcon width={16} height={16} />
                        {unreadCommentCount > 0 && (
                          <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-[#dc2626] px-1 text-[0.65rem] font-extrabold leading-none text-white">
                            {unreadCommentCount > 99 ? "99+" : unreadCommentCount}
                          </span>
                        )}
                      </button>
```

The aria-label stays "Comments", and the desktop button already announces nothing extra. Keep the two consistent.

- [ ] **Step 4: Run the Itineraries tests**

Run: `npx vitest run --pool=threads tests/client-itinerary-comment-badge.test.jsx tests/client-itinerary-approve.test.jsx tests/client-itinerary-editing.test.jsx tests/client-itinerary-options.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/pages/ClientItineraryPage.jsx tests/client-itinerary-comment-badge.test.jsx
git commit -m "fix(itineraries): comment badge counts only the open trip"
```

---

### Task 23: Full verification

- [ ] **Step 1: Server suite and typecheck**

Run: `cd Voyage-Server && npx vitest run && npx tsc --noEmit`
Expected: the typecheck is clean. Test failures should be only the pre-existing stale ones. To confirm, compare the failing file list with `git stash -u; npx vitest run; git stash pop` on `staging` (or note them from before Task 1).

- [ ] **Step 2: Client suite and build**

Run: `cd ../Voyage-Client && npm test && npm run build`
Expected: the build is clean. Test failures should be only the pre-existing stale files.

- [ ] **Step 3: Browser check without logging in.** Create a temporary `app/scratch/trip-panel/page.jsx`:
  - It renders `<OwnerOverview agencyId="agency-1" viewerName="Jamie" />`.
  - Stub `window.fetch` at module scope, handling string, `Request` and `URL` inputs:
    - `/dashboard?` returns `fixtures.ownerBusy`.
    - `/dashboard/calendar` returns `{ from: null, to: null, generatedAt: "", tripsWithoutDates: 0, trips: [], events: [] }`.
    - `/dashboard/trips/` returns a preview with a trip, a share expiring in 20h, and two comments (one waiting, one answered).
    - `/expiry` returns `{ share: {…, expiresAt: <+7d> } }`.
    - `/reply` returns `{ comment: {} }`.
  - Start the client preview (`voyage-client`) and open `/scratch/trip-panel`.

  Then check, with a screenshot of each:
  1. The "Client comments" card sits under "Needs you today", and the comment rows read "Comment from Maria Santos".
  2. Clicking a card row opens the trip panel at that comment with the reply box focused.
  3. "Extend" on the expired-link row opens the panel scrolled to Shared link, and "Extend 7 days" updates the chip.
  4. The calendar "Open trip" opens the panel at the top, never a comments-only view.
  5. Clicking the Trip progress "Shared" bar lists trips, and a trip opens the panel.
  6. Dark mode (`resize_window` with `colorScheme: "dark"`): the chips and text stay readable.
  7. At 375px width the panel is full-width and the card has no horizontal scroll.

  Then delete `app/scratch/trip-panel` and clear the pane's localStorage.

- [ ] **Step 4: Deploy notes for the user** (no code). The server must deploy before the client, because the client calls `/dashboard/trips/:id` and `/shares/:id/expiry`. Without them, the old server answers 404 and the panel shows "Couldn't load this trip." No migration is needed, because every field already exists.

---

## Self-review notes

- **Spec coverage:**

  | Decision | Covered by |
  |---|---|
  | 1 (panel layout) | Tasks 13–15 |
  | 2 (open-at) | Tasks 15, 16, 20, 21 |
  | 3 (comments card) | Tasks 3, 5, 17, 21 |
  | 4 (author label) | Tasks 2, 16 |
  | 5 (extend) | Tasks 7, 14, 16 |
  | 6 (funnel cohort + list) | Tasks 4, 5, 18 |
  | 7 (staff counters) | Tasks 5, 19 |
  | 8 (bugs) | Badge: Task 22. Stop names: Tasks 1, 6, 13. `parentId`: Task 15 rewrite. Freshness: Tasks 7, 8 |

- **Names used across tasks:**
  - Server: `selectClientComments`, `toTripListRows`, `selectFunnelCohort`, `buildTripPreview`, `tripPreviewService.getTripPreview`, `computeExtendedExpiry`, `shareService.extendShare`, `onAgencyActivity`.
  - Client: `fetchTripPreview`, `extendShare`, `useTripPreview`, `needsYouTarget`, `dayItemFocus`, `TripSlideOver` props `focus` and `onChanged` (replaces `onReplied`).
  - Payload fields: `clientComments`, `pipelineTrips`, and `funnel.stages[].trips`.
- **Checked against the code while writing:**
  - `ApiError` has `statusCode` and `code`.
  - `ZodError` → 400.
  - Prisma models: `ItineraryComment.itemId`, `ItineraryItem.title`, `ClientTrip.destinationSummary`.
  - The Itineraries page hides draft trips (hence decision 7).
  - Every test file named here exists on `staging`.
