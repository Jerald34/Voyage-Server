# Calendar Action Icons + Recently Viewed Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calendar day tiles show what needs the agent as coloured action icons (unanswered comments, low ratings, expiring links, trips departing soon), and the dashboard gains a "Recently viewed" card of the itineraries clients opened in the last 30 days.

**Architecture:**

- **Server:**
  - Calendar comment events carry `needsReply`.
  - The dashboard payload gains a pure-computed `recentViews` list.
  - A reply clears the agency's cached dashboard and calendar data. This uses a new `TtlCache.invalidatePrefix`.
- **Client:**
  - A pure rules module (`calendarActions.js`) classifies each day's items.
  - A `DayMarks` component draws them. Each tile is a CSS container, so what shows follows the tile's own width.
  - A `RecentlyViewedPanel` sits in both dashboard columns.
  - The trip slide-over reports replies, so the dashboard and calendar refetch at once.

**Tech Stack:**

- **Server:** Express 5, Zod 4.3.6, Prisma 7, Vitest and Supertest.
- **Client:**
  - Next 16, React 19 and Tailwind 4. Tailwind 4 has `@container` and `@min-[…]:` variants built in, and its tokens live in `app/globals.css`.
  - Vitest 4, Testing Library and jsdom.

**Spec:** `Voyage-Server/docs/superpowers/specs/2026-10-04-calendar-action-icons-recently-viewed-design.md`

---

## Before you start

- **Repos:**
  - `Voyage-Server/` and `Voyage-Client/` sit under `c:\Users\dever\OneDrive\Documents\Voyage`.
  - Both are on `feat/dashboard-calendar`. Stay on it, and don't push.
- **Commits:**
  - Commit at the end of every task, using the message the task gives.
  - **No `Co-Authored-By` line and no "Generated with" line**, whatever a default or reminder says.
  - **Never run `git stash`**: the owner's GitHub Desktop stashes files.
  - Other agents may be working in the same tree. Always commit only your paths: `git add <paths>`, then `git commit -m "…" -- <paths>`.
- **Running tests:**
  - Client, from `Voyage-Client/`: `npx vitest run --pool=threads tests/<file>`
  - Server, from `Voyage-Server/`: `npx vitest run tests/<file>`
- **Known failures that are not yours:**
  - Server: 4 files fail (agentLogger, agentOrchestrator, modelProvider, webSearchProvider; 11 tests).
  - Client: 8 files fail: `agent-command-center-places` (1 test), plus 7 that fail to load because `app/components/icons/index.js` has JSX in a `.js` file.
- **Mocking icons:** any client test that renders a component importing `app/components/icons/index.js` must mock it with `vi.mock(...)`. Copy the pattern from `tests/trip-slide-over-comments.test.jsx`.
- **No layout in jsdom:**
  - Tests assert class names.
  - Contrast is computed numerically from `app/globals.css` with `tests/helpers/themeTokens.js`. Its `resolve()` reads hex and rgb, not oklch, so use the `-rgb` mirror tokens for oklch colours.
- **Shell for the fixture:** run Task 5 from **Git Bash**, not PowerShell. PowerShell's `>` writes UTF-16, which breaks the JSON import.
- **Backend restart:** restart `npm run dev` in `Voyage-Server/` after server changes. Hot reload is unreliable in OneDrive.

## Task order

| Track | Tasks | Notes |
|---|---|---|
| Server | 1 → 2 → 3 → 4 → 5 | 4 needs 1. 5 needs 3, and it writes the client's fixture. |
| Client calendar | 6 → 7 → 8 → 9 | Shared files (`calendarDays.js`, `AgencyCalendar.jsx`), so run them in order. |
| Client card | 10, 11 → 12 | 10 and 11 can run beside the calendar track. 12 needs 11. |
| Wiring | 13 | Needs 5, 9, 10 and 12. |
| Verify | 14 | Last. |

## File map

**Server (`Voyage-Server/`)**

| File | Change |
|---|---|
| `src/modules/dashboard/cache.ts` | `invalidatePrefix(prefix)` |
| `src/modules/dashboard/dashboardService.ts` | `invalidate` clears by prefix (it missed staff keys). Payloads add `recentViews`. |
| `src/modules/dashboard/calendarService.ts` | `invalidate(agencyId)` |
| `src/modules/dashboard/calendar.ts`, `calendarRepository.ts` | Comment `status` and `agencyRepliedAt` in, `detail.needsReply` out |
| `src/modules/dashboard/aggregations.ts` | `selectRecentViews` |
| `src/modules/dashboard/dashboardRepository.ts` | Share `clientName` |
| `src/modules/dashboard/dashboardTypes.ts`, `dashboardSchemas.ts` | `needsReply`, `RecentView`, `recentViews` |
| `src/modules/dashboard/dashboardFreshness.ts` (new) | `invalidateAgencyDashboards(agencyId)` |
| `src/modules/shares/shareRoutes.ts` | Reply route calls it |
| `scripts/export-dashboard-fixtures.ts` | Share `clientName` in the dataset |
| Tests | `dashboardCache`, `dashboardService`, `calendarService`, `dashboardCalendar`, `dashboardCalendarSchemas`, `calendarRepository`, `dashboardAggregations`, `dashboardRepository` (new), `dashboardFreshness` (new), `shareReplyFreshness` (new) |

**Client (`Voyage-Client/`)**

| File | Change |
|---|---|
| `app/lib/calendarActions.js` (new) | Action rules, day summary, spoken text |
| `app/lib/calendarDays.js` | `daysFromToday` on cells; `describeDayItems` sorts and tags `actionKind` |
| `app/agency/[agencyId]/components/dashboard/widgets/DayMarks.jsx` (new) | Tile marks, `ACTION_STYLE`, legend |
| `widgets/AgencyCalendar.jsx` | Uses DayMarks, the new label and the legend. `refreshKey` prop. |
| `widgets/CalendarDayPopover.jsx` | Badge tones by `actionKind` |
| `TripSlideOver.jsx` | `onReplied(commentId)` |
| `app/hooks/useLocalClock.js` | `useNowMinute()` |
| `app/lib/relativeTime.js` (new) | `timeAgo`, `timeAgoSpoken` |
| `widgets/MyWorkColumn.jsx` | Uses `timeAgo`. Mounts the card. |
| `widgets/RecentlyViewedPanel.jsx` (new) | The card |
| `widgets/EmptyState.jsx` | `views` variant |
| `widgets/InsightsColumn.jsx` | Mounts the card |
| `OwnerOverview.jsx`, `StaffMyWork.jsx` | Pass `recentViews` and handlers. Reply refresh. |
| `tests/fixtures/dashboard-payloads.json` | Regenerated (Task 5) |
| Tests | `calendar-actions` (new), `calendar-days`, `calendar-day-popover`, `agency-calendar`, `theme-tokens`, `trip-slide-over-comments`, `relative-time` (new), `use-now-minute` (new), `recently-viewed-panel` (new), `insights-column`, `dashboard-server-contract`, `dashboard-reply-refresh` (new) |

---

### Task 1: Let the dashboard and calendar caches forget one agency (server)

**Why:**

- **Calendar cache:** nothing clears a cached calendar early.
- **Dashboard cache:** `dashboardService.invalidate` has no caller, and it misses staff entries. Their keys are `${agencyId}:staff:${period}:${userId}`, but it only deletes `${agencyId}:staff:${period}`.

A prefix delete fixes both. Agency ids are UUIDs, and keys put a `:` after the id, so `${agencyId}:` can't match another agency.

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/cache.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardService.ts:95-105`
- Modify: `Voyage-Server/src/modules/dashboard/calendarService.ts:27-46`
- Test: `Voyage-Server/tests/dashboardCache.test.ts`, `tests/dashboardService.test.ts`, `tests/calendarService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/dashboardCache.test.ts`, inside `describe("TtlCache", ...)`, after the test `"invalidates one key and clears them all"`, add:

```ts
  it("invalidates every key that starts with a prefix, and only those", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("agency-1:owner:30d", 1);
    cache.set("agency-1:staff:30d:user-a", 2);
    cache.set("agency-10:owner:30d", 3);
    cache.set("agency-2:owner:30d", 4);

    cache.invalidatePrefix("agency-1:");

    expect(cache.get("agency-1:owner:30d")).toBeNull();
    expect(cache.get("agency-1:staff:30d:user-a")).toBeNull();
    expect(cache.get("agency-10:owner:30d")).toBe(3);
    expect(cache.get("agency-2:owner:30d")).toBe(4);
  });
```

In `tests/dashboardService.test.ts`, inside `describe("getDashboard – cache behaviour", ...)`, after the last test (`"owner view cache is shared across users of the same agency+period"`), add:

```ts
  it("invalidate() forgets the agency's owner and staff entries, so the next reads hit the repository", async () => {
    const { svc, repo } = makeService(emptyData());
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", view: "staff", now: NOW });
    expect(repo.calls).toBe(2);

    svc.invalidate(AGENCY);

    await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", view: "staff", now: NOW });
    expect(repo.calls).toBe(4);
  });

  it("invalidate() leaves other agencies' entries cached", async () => {
    const { svc, repo } = makeService(emptyData());
    await svc.getDashboard({ agencyId: "agency-2", userId: USER_A, role: "OWNER", view: "owner", now: NOW });

    svc.invalidate(AGENCY);

    await svc.getDashboard({ agencyId: "agency-2", userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    expect(repo.calls).toBe(1);
  });
```

In `tests/calendarService.test.ts`, inside `describe("calendar service", ...)`, after the test `"caches staff calendars per person"`, add:

```ts
  it("invalidate() forgets every cached range for that agency only", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    await service.getCalendar({ ...BASE, agencyId: "agency-2", userId: "owner", role: "OWNER" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(3);

    service.invalidate("agency-1");

    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    await service.getCalendar({ ...BASE, agencyId: "agency-2", userId: "owner", role: "OWNER" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(5);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/dashboardCache.test.ts tests/dashboardService.test.ts tests/calendarService.test.ts`

Expected FAILs:
- **dashboardCache:** the prefix test, with `cache.invalidatePrefix is not a function`.
- **dashboardService:** "forgets the agency's owner and staff entries", with `expected 3 to be 4`, because the staff entry survived. "leaves other agencies' entries cached" PASSES.
- **calendarService:** the new test, with `service.invalidate is not a function`.

- [ ] **Step 3: Add `invalidatePrefix`**

In `src/modules/dashboard/cache.ts`, replace:

```ts
  invalidate(key: string): void {
    this.store.delete(key);
  }
```

with:

```ts
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Drops every entry whose key starts with `prefix`, e.g. all of one agency's keys. */
  invalidatePrefix(prefix: string): void {
    // Deleting while iterating a Map is safe: removed keys are simply not visited.
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
```

- [ ] **Step 4: Clear the dashboard cache by prefix**

In `src/modules/dashboard/dashboardService.ts`, replace:

```ts
  function invalidate(agencyId: string) {
    // Best-effort: nuke every cached entry for the agency. The cache is per-process
    // and small, so a full clear is acceptable when in doubt; for now we just
    // forget keys we know how to derive. Callers can fall back to clear() if
    // they want a hard wipe.
    for (const view of ["owner", "staff"] as const) {
      for (const period of ["7d", "30d", "90d"] as const) {
        deps.cache.invalidate(`${agencyId}:${view}:${period}`);
      }
    }
  }
```

with:

```ts
  /**
   * Forgets every cached payload for the agency: the owner entries and each
   * staff member's (`${agencyId}:staff:${period}:${userId}`). Agency ids are
   * UUIDs followed by ":", so the prefix can't match another agency.
   */
  function invalidate(agencyId: string) {
    deps.cache.invalidatePrefix(`${agencyId}:`);
  }
```

- [ ] **Step 5: Let the calendar service forget an agency**

In `src/modules/dashboard/calendarService.ts`, replace:

```ts
    deps.cache.set(cacheKey, payload);
    return payload;
  }

  return { getCalendar };
}
```

with:

```ts
    deps.cache.set(cacheKey, payload);
    return payload;
  }

  /** Forgets every cached range for the agency, owner and staff alike. */
  function invalidate(agencyId: string) {
    deps.cache.invalidatePrefix(`${agencyId}:`);
  }

  return { getCalendar, invalidate };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboardCache.test.ts tests/dashboardService.test.ts tests/calendarService.test.ts`
Expected: PASS (all three files).

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/cache.ts src/modules/dashboard/dashboardService.ts src/modules/dashboard/calendarService.ts tests/dashboardCache.test.ts tests/dashboardService.test.ts tests/calendarService.test.ts
git commit -m "fix(dashboard): let the dashboard and calendar caches forget one agency" -m "TtlCache.invalidatePrefix drops every key for an agency. dashboardService.invalidate missed staff entries (their keys end in the user id); it and a new calendarService.invalidate now clear by prefix." -- src/modules/dashboard/cache.ts src/modules/dashboard/dashboardService.ts src/modules/dashboard/calendarService.ts tests/dashboardCache.test.ts tests/dashboardService.test.ts tests/calendarService.test.ts
```

---

### Task 2: Calendar comments say whether they need a reply (server)

**Why:** the tile's red speech bubble means "a client comment has no reply yet". "Needs you today" uses the rule `status === "PENDING" && agencyRepliedAt === null`. A reply sets `ADDRESSED` and `agencyRepliedAt`, and nothing sets `SEEN` today.

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/calendar.ts:85-91, 224-231`
- Modify: `Voyage-Server/src/modules/dashboard/calendarRepository.ts:79-88`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts:232`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardSchemas.ts:235-239`
- Test: `Voyage-Server/tests/dashboardCalendar.test.ts`, `tests/dashboardCalendarSchemas.test.ts`, `tests/calendarRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/dashboardCalendar.test.ts`, inside `describe("buildCalendar events", ...)`, after the test `"falls back to the comment author when the trip has no client name"`, add:

```ts
  it("says whether a client comment still needs a reply", () => {
    const raw = emptyRaw();
    const comment = (id: string, status: "PENDING" | "SEEN" | "ADDRESSED", agencyRepliedAt: Date | null) => ({
      id,
      content: "Can we swap lunch?",
      authorName: "Ken",
      status,
      agencyRepliedAt,
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      share: { clientName: null, trip: lisbon }
    });
    raw.comments = [
      comment("open", "PENDING", null),
      comment("replied", "ADDRESSED", new Date("2026-10-02T12:00:00.000Z")),
      comment("seen", "SEEN", null),
      comment("pending-but-replied", "PENDING", new Date("2026-10-02T12:00:00.000Z"))
    ];

    const needsReply = Object.fromEntries(build(raw).events.map((event) => [event.id, event.detail.needsReply]));
    expect(needsReply).toEqual({
      "client_commented:open": true,
      "client_commented:replied": false,
      "client_commented:seen": false,
      "client_commented:pending-but-replied": false
    });
  });

  it("leaves needsReply off every other kind of event", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        lastViewedAt: new Date("2026-10-03T02:00:00.000Z"),
        viewCount: 1
      })
    ];
    for (const event of build(raw).events) {
      expect(event.detail).not.toHaveProperty("needsReply");
    }
  });
```

In `tests/dashboardCalendarSchemas.test.ts`, inside `describe("calendarPayloadSchema", ...)`, after `"rejects archived trips"`, add:

```ts
  it("keeps needsReply on a comment event and rejects a non-boolean", () => {
    const comment = {
      ...event,
      id: "client_commented:c1",
      kind: "client_commented",
      detail: { excerpt: "Can we swap lunch?", needsReply: true }
    };
    const parsed = calendarPayloadSchema.parse({ ...payload, events: [comment] });
    expect(parsed.events[0].detail.needsReply).toBe(true);

    const notBoolean = { ...comment, detail: { excerpt: "Can we swap lunch?", needsReply: "yes" } };
    expect(calendarPayloadSchema.safeParse({ ...payload, events: [notBoolean] }).success).toBe(false);
  });
```

In `tests/calendarRepository.test.ts`, inside `describe("calendar repository", ...)`, after `"scopes every query to the agency"`, add:

```ts
  it("reads each comment's status and reply time, for needsReply", async () => {
    const client = fakeClient();
    await fetchWith(client);

    expect(client.itineraryComment.findMany.mock.calls[0][0].select).toMatchObject({
      status: true,
      agencyRepliedAt: true
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/dashboardCalendar.test.ts tests/dashboardCalendarSchemas.test.ts tests/calendarRepository.test.ts`

Expected FAILs:
- "says whether a client comment still needs a reply". Every value is `undefined`.
- "keeps needsReply on a comment event…": `expected undefined to be true`. Zod strips the unknown key.
- "reads each comment's status and reply time…": the `select` lacks both fields.

"leaves needsReply off every other kind of event" PASSES; it is a guard.

- [ ] **Step 3: Read the fields**

In `src/modules/dashboard/calendarRepository.ts`, replace:

```ts
          select: {
            id: true,
            content: true,
            authorName: true,
            createdAt: true,
            share: { select: { clientName: true, trip: { select: tripRefSelect } } }
          }
```

with:

```ts
          select: {
            id: true,
            content: true,
            authorName: true,
            status: true,
            agencyRepliedAt: true,
            createdAt: true,
            share: { select: { clientName: true, trip: { select: tripRefSelect } } }
          }
```

- [ ] **Step 4: Type them and set `needsReply`**

In `src/modules/dashboard/calendar.ts`, replace:

```ts
  /** Client comments created inside the window. */
  comments: Array<{
    id: string;
    content: string;
    authorName: string;
    createdAt: Date;
    share: { clientName: string | null; trip: CalendarTripRef | null };
  }>;
```

with:

```ts
  /** Client comments created inside the window. */
  comments: Array<{
    id: string;
    content: string;
    authorName: string;
    status: "PENDING" | "SEEN" | "ADDRESSED";
    agencyRepliedAt: Date | null;
    createdAt: Date;
    share: { clientName: string | null; trip: CalendarTripRef | null };
  }>;
```

and replace:

```ts
    addEvent("client_commented", comment.id, trip, clientName, comment.createdAt, {
      excerpt: excerpt(comment.content)
    });
```

with:

```ts
    addEvent("client_commented", comment.id, trip, clientName, comment.createdAt, {
      excerpt: excerpt(comment.content),
      // The "Needs you today" rule for an unread comment; a reply sets ADDRESSED.
      needsReply: comment.status === "PENDING" && comment.agencyRepliedAt === null
    });
```

In `src/modules/dashboard/dashboardTypes.ts`, replace:

```ts
  detail: { viewCount?: number; rating?: number; excerpt?: string };
```

with:

```ts
  /** `needsReply` is set on client_commented events only. */
  detail: { viewCount?: number; rating?: number; excerpt?: string; needsReply?: boolean };
```

In `src/modules/dashboard/dashboardSchemas.ts`, replace:

```ts
      detail: z.object({
        viewCount: z.number().int().nonnegative().optional(),
        rating: z.number().int().optional(),
        excerpt: z.string().optional()
      })
```

with:

```ts
      detail: z.object({
        viewCount: z.number().int().nonnegative().optional(),
        rating: z.number().int().optional(),
        excerpt: z.string().optional(),
        needsReply: z.boolean().optional()
      })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboardCalendar.test.ts tests/dashboardCalendarSchemas.test.ts tests/calendarRepository.test.ts tests/dashboardCalendarEndToEnd.test.ts tests/dashboardCalendarRoutes.test.ts`
Expected: PASS (all five files).

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dashboard/calendar.ts src/modules/dashboard/calendarRepository.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts tests/dashboardCalendar.test.ts tests/dashboardCalendarSchemas.test.ts tests/calendarRepository.test.ts
git commit -m "feat(dashboard): say whether each calendar comment needs a reply" -m "client_commented events carry detail.needsReply (PENDING with no agency reply, the Needs you today rule), so the calendar can flag unanswered comments." -- src/modules/dashboard/calendar.ts src/modules/dashboard/calendarRepository.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts tests/dashboardCalendar.test.ts tests/dashboardCalendarSchemas.test.ts tests/calendarRepository.test.ts
```

---

### Task 3: The dashboard payload lists recently viewed trips (server)

**Why:** the Recently viewed card needs one row per trip with a client view in the last 30 days, newest first, at most 5. The server stores only `viewCount` and `lastViewedAt` per share link, so:

- the count is all-time, summed over the trip's links;
- the latest view decides both the order and the cutoff.

**Files:**
- Modify: `Voyage-Server/src/modules/dashboard/dashboardRepository.ts:27-37, 87-99`
- Modify: `Voyage-Server/src/modules/dashboard/aggregations.ts` (import line 12; new section at the end of the file)
- Modify: `Voyage-Server/src/modules/dashboard/dashboardTypes.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardSchemas.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardService.ts`
- Create: `Voyage-Server/tests/dashboardRepository.test.ts`
- Test: `Voyage-Server/tests/dashboardAggregations.test.ts`, `tests/dashboardService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboardRepository.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaDashboardRepository } from "../src/modules/dashboard/dashboardRepository";

function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itinerary: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
    tripReview: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

describe("dashboard repository", () => {
  it("reads each share link's client name, views and last view, for Recently viewed", async () => {
    const client = fakeClient();
    await createPrismaDashboardRepository(client as never).fetchAgencyDashboardData("agency-1");

    expect(client.itineraryShare.findMany.mock.calls[0][0].select).toMatchObject({
      clientName: true,
      viewCount: true,
      lastViewedAt: true
    });
  });
});
```

In `tests/dashboardAggregations.test.ts`:

1. Add `selectRecentViews` to the import list from `"../src/modules/dashboard/aggregations"`. Keep the list alphabetical: put it after `priorPeriodWindow`.
2. At the end of the file, add:

```ts
describe("selectRecentViews", () => {
  const viewed = (id: string, overrides: Parameters<typeof trip>[0] = {}) => trip({ id, title: `Trip ${id}`, ...overrides });
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  it("sums views over a trip's links, revoked ones included, and keeps the latest view", () => {
    const rows = selectRecentViews({
      trips: [viewed("t1", { clientName: "Santos" })],
      shares: [
        share({ id: "s1", tripId: "t1", viewCount: 3, lastViewedAt: daysAgo(4) }),
        share({ id: "s2", tripId: "t1", viewCount: 2, lastViewedAt: daysAgo(1), revokedAt: daysAgo(0.5) }),
        share({ id: "s3", tripId: "t1", viewCount: 0, lastViewedAt: null })
      ],
      now: NOW
    });

    expect(rows).toEqual([
      { tripId: "t1", tripTitle: "Trip t1", clientName: "Santos", viewCount: 5, lastViewedAt: daysAgo(1).toISOString() }
    ]);
  });

  it("names the client on the most recently viewed link, else the trip's client", () => {
    const rows = selectRecentViews({
      trips: [viewed("t1", { clientName: "Santos" }), viewed("t2", { clientName: "Lim" })],
      shares: [
        { ...share({ id: "s1", tripId: "t1", viewCount: 1, lastViewedAt: daysAgo(3) }), clientName: "Old Contact" },
        { ...share({ id: "s2", tripId: "t1", viewCount: 1, lastViewedAt: daysAgo(1) }), clientName: "Maria Santos" },
        { ...share({ id: "s3", tripId: "t2", viewCount: 1, lastViewedAt: daysAgo(2) }), clientName: null }
      ],
      now: NOW
    });

    expect(rows.map((row) => [row.tripId, row.clientName])).toEqual([
      ["t1", "Maria Santos"],
      ["t2", "Lim"]
    ]);
  });

  it("draws the line at 30 days", () => {
    const rows = selectRecentViews({
      trips: [viewed("in"), viewed("out")],
      shares: [
        share({ id: "s-in", tripId: "in", viewCount: 1, lastViewedAt: daysAgo(29) }),
        share({ id: "s-out", tripId: "out", viewCount: 1, lastViewedAt: daysAgo(31) })
      ],
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["in"]);
  });

  it("lists at most five trips, newest view first", () => {
    const ages: Record<string, number> = { t1: 1, t2: 9, t3: 29, t4: 5, t5: 2, t6: 10, t7: 3 };
    const ids = Object.keys(ages);
    const rows = selectRecentViews({
      trips: ids.map((id) => viewed(id)),
      shares: ids.map((id) => share({ id: `s-${id}`, tripId: id, viewCount: 1, lastViewedAt: daysAgo(ages[id]) })),
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["t1", "t5", "t7", "t4", "t2"]);
  });

  it("leaves out archived trips, links without a trip and trips nobody viewed", () => {
    const rows = selectRecentViews({
      trips: [viewed("archived", { status: "ARCHIVED" }), viewed("unviewed"), viewed("viewed")],
      shares: [
        share({ id: "s1", tripId: "archived", viewCount: 2, lastViewedAt: daysAgo(1) }),
        share({ id: "s2", tripId: null, viewCount: 2, lastViewedAt: daysAgo(1) }),
        share({ id: "s3", tripId: "unviewed", viewCount: 0, lastViewedAt: null }),
        share({ id: "s4", tripId: "viewed", viewCount: 1, lastViewedAt: daysAgo(2) })
      ],
      now: NOW
    });

    expect(rows.map((row) => row.tripId)).toEqual(["viewed"]);
  });

  it("shows a staff member only the trips they created or organize", () => {
    const rows = selectRecentViews({
      trips: [
        viewed("mine", { createdByUserId: "u-staff" }),
        viewed("organized", { createdByUserId: "u-other", assignedOrganizerUserId: "u-staff" }),
        viewed("theirs", { createdByUserId: "u-other" })
      ],
      shares: [
        share({ id: "s1", tripId: "mine", viewCount: 1, lastViewedAt: daysAgo(1) }),
        share({ id: "s2", tripId: "organized", viewCount: 1, lastViewedAt: daysAgo(2) }),
        share({ id: "s3", tripId: "theirs", viewCount: 1, lastViewedAt: daysAgo(3) })
      ],
      now: NOW,
      userId: "u-staff"
    });

    expect(rows.map((row) => row.tripId)).toEqual(["mine", "organized"]);
  });
});
```

In `tests/dashboardService.test.ts`:

1. Change the schema import to:

```ts
import { ownerDashboardPayloadSchema, staffDashboardPayloadSchema } from "../src/modules/dashboard/dashboardSchemas";
```

2. At the end of the file, add:

```ts
// ---------------------------------------------------------------------------
// Recently viewed
// ---------------------------------------------------------------------------

describe("getDashboard – recently viewed", () => {
  function viewedData(): RawDashboardData {
    return {
      ...emptyData(),
      trips: [
        makeTrip("t1", { title: "Kyoto", clientName: "Santos" }),
        makeTrip("t2", { title: "Palawan", createdByUserId: USER_B })
      ],
      shares: [
        makeShare("s1", "t1", { viewCount: 3, lastViewedAt: new Date("2026-05-26T07:00:00Z") }),
        makeShare("s2", "t2", { viewCount: 1, lastViewedAt: new Date("2026-05-20T12:00:00Z") })
      ]
    };
  }

  it("lists the agency's recently viewed trips on the owner view", async () => {
    const { svc } = makeService(viewedData());
    const payload = await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });

    expect(payload.recentViews).toEqual([
      { tripId: "t1", tripTitle: "Kyoto", clientName: "Santos", viewCount: 3, lastViewedAt: "2026-05-26T07:00:00.000Z" },
      { tripId: "t2", tripTitle: "Palawan", clientName: null, viewCount: 1, lastViewedAt: "2026-05-20T12:00:00.000Z" }
    ]);
  });

  it("shows a staff member only their own trips", async () => {
    const { svc } = makeService(viewedData());
    const payload = await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", view: "staff", now: NOW });

    expect(payload.recentViews.map((row) => row.tripId)).toEqual(["t2"]);
  });

  it("keeps recentViews through both payload schemas", async () => {
    const { svc } = makeService(viewedData());
    const owner = await svc.getDashboard({ agencyId: AGENCY, userId: USER_A, role: "OWNER", view: "owner", now: NOW });
    const staff = await svc.getDashboard({ agencyId: AGENCY, userId: USER_B, role: "STAFF", view: "staff", now: NOW });

    expect(ownerDashboardPayloadSchema.parse(owner).recentViews).toHaveLength(2);
    expect(staffDashboardPayloadSchema.parse(staff).recentViews).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/dashboardRepository.test.ts tests/dashboardAggregations.test.ts tests/dashboardService.test.ts`

Expected FAILs:
- **dashboardRepository:** the `select` has no `clientName`.
- **dashboardAggregations:** every `selectRecentViews` test, with `selectRecentViews is not a function`.
- **dashboardService:** the three new tests. `payload.recentViews` is undefined.

- [ ] **Step 3: Read the share's client name**

In `src/modules/dashboard/dashboardRepository.ts`, in `RawDashboardData`, replace:

```ts
  shares: Array<{
    id: string;
    tripId: string | null;
    viewCount: number;
```

with:

```ts
  shares: Array<{
    id: string;
    tripId: string | null;
    /** Who the link was shared with; the Recently viewed card prefers it to the trip's client. */
    clientName: string | null;
    viewCount: number;
```

and in the `itineraryShare.findMany` select, replace:

```ts
          select: {
            id: true,
            tripId: true,
            viewCount: true,
```

with:

```ts
          select: {
            id: true,
            tripId: true,
            clientName: true,
            viewCount: true,
```

- [ ] **Step 4: Add the `RecentView` type and the payload fields**

In `src/modules/dashboard/dashboardTypes.ts`, replace:

```ts
export type ActivityRibbonItem = {
```

with:

```ts
/** A trip clients opened recently, for the Recently viewed card. */
export type RecentView = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** All-time views, summed over the trip's share links. */
  viewCount: number;
  /** The latest view over those links (ISO). */
  lastViewedAt: string;
};

export type ActivityRibbonItem = {
```

In `OwnerDashboardPayload`, replace:

```ts
  recentReviews: OwnerRecentReview[];
  activityRibbon: ActivityRibbonItem[];
};
```

with:

```ts
  recentReviews: OwnerRecentReview[];
  recentViews: RecentView[];
  activityRibbon: ActivityRibbonItem[];
};
```

In `StaffDashboardPayload`, replace:

```ts
  pipeline: StaffPipeline;
  startingSoon: StaffStartingSoonCard[];
};
```

with:

```ts
  pipeline: StaffPipeline;
  startingSoon: StaffStartingSoonCard[];
  recentViews: RecentView[];
};
```

- [ ] **Step 5: Add the schemas**

In `src/modules/dashboard/dashboardSchemas.ts`, replace:

```ts
const ownerWorklistSchema = z.object({
```

with:

```ts
const recentViewSchema = z.object({
  tripId: z.string(),
  tripTitle: z.string(),
  clientName: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  lastViewedAt: z.string()
});

const ownerWorklistSchema = z.object({
```

In `ownerDashboardPayloadSchema`, replace:

```ts
  activityRibbon: z.array(
```

with:

```ts
  recentViews: z.array(recentViewSchema),
  activityRibbon: z.array(
```

In `staffDashboardPayloadSchema`, replace:

```ts
  startingSoon: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      startDate: z.string(),
      daysToStart: z.number().int(),
      travelerCount: z.number().int().nullable()
    })
  )
});
```

with:

```ts
  startingSoon: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      startDate: z.string(),
      daysToStart: z.number().int(),
      travelerCount: z.number().int().nullable()
    })
  ),
  recentViews: z.array(recentViewSchema)
});
```

- [ ] **Step 6: Write `selectRecentViews`**

In `src/modules/dashboard/aggregations.ts`, replace:

```ts
import type { FunnelStage, FunnelStageKey } from "./dashboardTypes";
```

with:

```ts
import type { FunnelStage, FunnelStageKey, RecentView } from "./dashboardTypes";
```

At the end of the file, add:

```ts
// ---------- Recently viewed ----------

/** How far back the Recently viewed card looks, by each trip's latest view. */
export const RECENT_VIEWS_WINDOW_DAYS = 30;
/** The most trips the card lists. */
export const RECENT_VIEWS_LIMIT = 5;

export type RecentViewInputs = {
  trips: Array<{
    id: string;
    title: string;
    status: TripStatusOnly["status"];
    clientName: string | null;
    createdByUserId: string;
    assignedOrganizerUserId: string | null;
  }>;
  shares: Array<{
    tripId: string | null;
    clientName?: string | null;
    viewCount: number;
    lastViewedAt: Date | null;
  }>;
  now: Date;
  /** A staff member sees only trips they created or organize; omit for the whole agency. */
  userId?: string;
};

/**
 * Trips clients opened most recently: one row per trip, views summed over all
 * of its links (revoked and expired links included, since those views
 * happened), and the latest view deciding the order and the 30-day cutoff.
 * Only a total and a last-view time are stored per link, so the count is
 * all-time. Archived trips and links without a trip are left out.
 */
export function selectRecentViews(inputs: RecentViewInputs): RecentView[] {
  const { trips, shares, now, userId } = inputs;
  const cutoff = now.getTime() - RECENT_VIEWS_WINDOW_DAYS * MS_PER_DAY;
  const tripIndex = new Map(trips.map((trip) => [trip.id, trip]));
  const byTrip = new Map<string, { viewCount: number; lastViewedAt: Date | null; clientName: string | null }>();

  for (const share of shares) {
    if (share.tripId === null) continue;
    const trip = tripIndex.get(share.tripId);
    if (!trip || trip.status === "ARCHIVED") continue;
    if (userId !== undefined && trip.createdByUserId !== userId && trip.assignedOrganizerUserId !== userId) continue;

    const entry = byTrip.get(trip.id) ?? { viewCount: 0, lastViewedAt: null, clientName: null };
    entry.viewCount += share.viewCount;
    if (share.lastViewedAt !== null && (entry.lastViewedAt === null || share.lastViewedAt > entry.lastViewedAt)) {
      entry.lastViewedAt = share.lastViewedAt;
      entry.clientName = share.clientName ?? null;
    }
    byTrip.set(trip.id, entry);
  }

  const rows: RecentView[] = [];
  for (const [tripId, entry] of byTrip) {
    if (entry.lastViewedAt === null || entry.lastViewedAt.getTime() < cutoff) continue;
    const trip = tripIndex.get(tripId)!;
    rows.push({
      tripId,
      tripTitle: trip.title,
      clientName: entry.clientName ?? trip.clientName,
      viewCount: entry.viewCount,
      lastViewedAt: entry.lastViewedAt.toISOString()
    });
  }
  rows.sort((a, b) => b.lastViewedAt.localeCompare(a.lastViewedAt));
  return rows.slice(0, RECENT_VIEWS_LIMIT);
}
```

- [ ] **Step 7: Add it to both payloads**

In `src/modules/dashboard/dashboardService.ts`, replace:

```ts
  selectOwnerWorklistRows,
  selectStaffWorklistRows,
  type DashboardPeriod
} from "./aggregations";
```

with:

```ts
  selectOwnerWorklistRows,
  selectRecentViews,
  selectStaffWorklistRows,
  type DashboardPeriod
} from "./aggregations";
```

In `composeOwnerPayload`, replace:

```ts
    funnel: { stages: funnelStages },
    recentReviews,
    activityRibbon
  };
}
```

with:

```ts
    funnel: { stages: funnelStages },
    recentReviews,
    recentViews: selectRecentViews({ trips: raw.trips, shares: raw.shares, now }),
    activityRibbon
  };
}
```

In `composeStaffPayload`, replace:

```ts
    worklist,
    pipeline,
    startingSoon
  };
}
```

with:

```ts
    worklist,
    pipeline,
    startingSoon,
    recentViews: selectRecentViews({ trips: raw.trips, shares: raw.shares, now, userId })
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboardRepository.test.ts tests/dashboardAggregations.test.ts tests/dashboardService.test.ts`
Expected: PASS (all three files).

- [ ] **Step 9: Type-check**

Run: `npm run build`
Expected: `tsc` exits 0. It type-checks `src` and `prisma` only, so neither the tests nor `scripts/` are included.

- [ ] **Step 10: Commit**

```bash
git add src/modules/dashboard/dashboardRepository.ts src/modules/dashboard/aggregations.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts src/modules/dashboard/dashboardService.ts tests/dashboardRepository.test.ts tests/dashboardAggregations.test.ts tests/dashboardService.test.ts
git commit -m "feat(dashboard): list recently viewed trips in the dashboard payload" -m "recentViews: one row per trip with a client view in the last 30 days, newest first, at most five; views summed over the trip's links. Staff see their own trips only." -- src/modules/dashboard/dashboardRepository.ts src/modules/dashboard/aggregations.ts src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts src/modules/dashboard/dashboardService.ts tests/dashboardRepository.test.ts tests/dashboardAggregations.test.ts tests/dashboardService.test.ts
```

---

### Task 4: A reply clears the agency's cached dashboards (server)

**Why:** after a reply, the client refetches the dashboard and calendar (Task 13). Without clearing the 60-second caches first, that refetch would get the old data back, with the comment still unanswered. The route clears the caches **before** it responds.

**Files:**
- Create: `Voyage-Server/src/modules/dashboard/dashboardFreshness.ts`
- Modify: `Voyage-Server/src/modules/shares/shareRoutes.ts:1-14, 112-123`
- Create: `Voyage-Server/tests/dashboardFreshness.test.ts`, `Voyage-Server/tests/shareReplyFreshness.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/dashboardFreshness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dashboardInvalidate: vi.fn(), calendarInvalidate: vi.fn() }));

vi.mock("../src/modules/dashboard/dashboardService", () => ({
  dashboardService: { invalidate: mocks.dashboardInvalidate }
}));
vi.mock("../src/modules/dashboard/calendarService", () => ({
  calendarService: { invalidate: mocks.calendarInvalidate }
}));

import { invalidateAgencyDashboards } from "../src/modules/dashboard/dashboardFreshness";

describe("invalidateAgencyDashboards", () => {
  it("clears the agency's cached dashboard and calendar payloads", () => {
    invalidateAgencyDashboards("agency-1");

    expect(mocks.dashboardInvalidate).toHaveBeenCalledWith("agency-1");
    expect(mocks.calendarInvalidate).toHaveBeenCalledWith("agency-1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboardFreshness.test.ts`
Expected: FAIL. The file can't load `../src/modules/dashboard/dashboardFreshness`.

- [ ] **Step 3: Create the module**

Create `src/modules/dashboard/dashboardFreshness.ts`:

```ts
import { calendarService } from "./calendarService";
import { dashboardService } from "./dashboardService";

/**
 * Forgets one agency's cached dashboard and calendar payloads, so the next
 * read rebuilds them. Call it after a change to what "needs you" shows, such
 * as an agency reply to a client comment.
 */
export function invalidateAgencyDashboards(agencyId: string): void {
  dashboardService.invalidate(agencyId);
  calendarService.invalidate(agencyId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/dashboardFreshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Create `tests/shareReplyFreshness.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  replyToComment: vi.fn(),
  invalidateAgencyDashboards: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/shares/shareService", () => ({
  shareService: { replyToComment: mocks.replyToComment }
}));
vi.mock("../src/modules/dashboard/dashboardFreshness", () => ({
  invalidateAgencyDashboards: mocks.invalidateAgencyDashboards
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { shareRoutes } from "../src/modules/shares/shareRoutes";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
// ItineraryComment ids are Prisma cuid()s.
const COMMENT_ID = "cmpt0a1b20003eohoq8r7s6tu";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = {
      id: "user-1",
      role: "USER",
      status: "ACTIVE",
      accountType: "AGENCY_USER",
      memberships: []
    } as never;
    next();
  });
  app.use("/agencies/:agencyId/shares", shareRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function reply() {
  return request(createApp())
    .post(`/agencies/${AGENCY_ID}/shares/comments/${COMMENT_ID}/reply`)
    .send({ content: "Yes, we can swap it." });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "OWNER" } });
});

describe("POST /agencies/:agencyId/shares/comments/:commentId/reply", () => {
  it("clears the agency's cached dashboards once the reply is saved", async () => {
    mocks.replyToComment.mockImplementation(async () => {
      // Not before the reply is saved: a failed reply leaves the caches alone.
      expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
      return { id: COMMENT_ID, status: "ADDRESSED" };
    });

    const response = await reply();

    expect(response.status).toBe(200);
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledOnce();
    expect(mocks.invalidateAgencyDashboards).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("leaves the caches alone when the reply fails", async () => {
    mocks.replyToComment.mockRejectedValue(new Error("database down"));

    const response = await reply();

    expect(response.status).toBe(500);
    expect(mocks.invalidateAgencyDashboards).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/shareReplyFreshness.test.ts`

Expected:
- "clears the agency's cached dashboards…" FAILS: `invalidateAgencyDashboards` was not called.
- "leaves the caches alone…" PASSES.

If the second test reports a status other than 500, check how `errorHandler` maps a plain `Error`, and assert that status instead.

- [ ] **Step 7: Clear the caches from the reply route**

In `src/modules/shares/shareRoutes.ts`, replace:

```ts
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
```

with:

```ts
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { invalidateAgencyDashboards } from "../dashboard/dashboardFreshness";
```

and replace:

```ts
    const comment = await shareService.replyToComment(agencyId, commentId, content);
    response.json({ comment });
```

with:

```ts
    const comment = await shareService.replyToComment(agencyId, commentId, content);
    // The comment no longer needs a reply. Drop the cached to-do lists and
    // calendars before answering, so the client's refetch gets fresh data.
    invalidateAgencyDashboards(agencyId);
    response.json({ comment });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/shareReplyFreshness.test.ts tests/dashboardFreshness.test.ts tests/authenticatedValidation.test.ts`
Expected: PASS (all three files). `authenticatedValidation` imports `shareRoutes` with prisma mocked, so the new import loads safely.

- [ ] **Step 9: Type-check**

Run: `npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/modules/dashboard/dashboardFreshness.ts src/modules/shares/shareRoutes.ts tests/dashboardFreshness.test.ts tests/shareReplyFreshness.test.ts
git commit -m "feat(shares): clear the agency's cached dashboards after a reply" -m "The dashboard and calendar payloads are cached for 60s per agency. After a comment reply is saved, the reply route forgets them before answering, so a refetch shows the comment as answered." -- src/modules/dashboard/dashboardFreshness.ts src/modules/shares/shareRoutes.ts tests/dashboardFreshness.test.ts tests/shareReplyFreshness.test.ts
```

---

### Task 5: Regenerate the client's dashboard fixture (server script, client fixture)

**Why:**

- The client's contract tests render `Voyage-Client/tests/fixtures/dashboard-payloads.json`, which holds real `dashboardService` output.
- That output now has `recentViews`. The dataset's shares also need a client name, so the card shows the "link's client name first" rule.

**Files:**
- Modify: `Voyage-Server/scripts/export-dashboard-fixtures.ts:47-59, 147-152`
- Regenerate: `Voyage-Client/tests/fixtures/dashboard-payloads.json`

- [ ] **Step 1: Give the dataset's shares a client name**

In `scripts/export-dashboard-fixtures.ts`, replace:

```ts
function share(id: string, tripId: string, fields: Partial<Share> & Pick<Share, "createdAt">): Share {
  return {
    id,
    tripId,
    viewCount: 0,
```

with:

```ts
function share(id: string, tripId: string, fields: Partial<Share> & Pick<Share, "createdAt">): Share {
  return {
    id,
    tripId,
    clientName: null,
    viewCount: 0,
```

and replace:

```ts
const kyotoShare = share("share-kyoto", kyoto.id, {
  createdAt: after(kyoto.createdAt, DAY + 7 * HOUR + 13 * MINUTE),
```

with:

```ts
// Shared with one family member by name: Recently viewed shows the link's name, not the trip's.
const kyotoShare = share("share-kyoto", kyoto.id, {
  clientName: "Maria Santos",
  createdAt: after(kyoto.createdAt, DAY + 7 * HOUR + 13 * MINUTE),
```

- [ ] **Step 2: Regenerate the fixture**

Run from `Voyage-Server/` in **Git Bash**:

```bash
npx tsx scripts/export-dashboard-fixtures.ts > ../Voyage-Client/tests/fixtures/dashboard-payloads.json
```

- [ ] **Step 3: Check that only `recentViews` changed**

Run from `Voyage-Client/` in Git Bash:

```bash
node -e '
const { execSync } = require("child_process");
const before = JSON.parse(execSync("git show HEAD:tests/fixtures/dashboard-payloads.json", { encoding: "utf8", maxBuffer: 1 << 24 }));
const after = JSON.parse(require("fs").readFileSync("tests/fixtures/dashboard-payloads.json", "utf8"));
for (const key of ["ownerBusy", "ownerBusyWeek", "ownerEmpty", "staff"]) {
  const { recentViews, ...rest } = after[key];
  const same = JSON.stringify(rest) === JSON.stringify(before[key]);
  console.log(key, same ? "unchanged apart from recentViews" : "CHANGED", JSON.stringify(recentViews.map((r) => [r.tripTitle, r.clientName, r.viewCount])));
}'
```

Expected output:

```
ownerBusy unchanged apart from recentViews [["Kyoto Autumn Escape","Maria Santos",4],["Palawan Family Trip","Lim Family",2],["Boracay Barkada Weekend","Dela Cruz Barkada",2],["Cebu Island Hop","Garcia Family",1]]
ownerBusyWeek unchanged apart from recentViews [["Kyoto Autumn Escape","Maria Santos",4],["Palawan Family Trip","Lim Family",2],["Boracay Barkada Weekend","Dela Cruz Barkada",2],["Cebu Island Hop","Garcia Family",1]]
ownerEmpty unchanged apart from recentViews []
staff unchanged apart from recentViews [["Kyoto Autumn Escape","Maria Santos",4],["Palawan Family Trip","Lim Family",2]]
```

`ownerBusyWeek` has the same four rows as `ownerBusy`, because `recentViews` ignores the period. If any line says `CHANGED`, stop and find out why before committing.

- [ ] **Step 4: Run the client tests that read the fixture**

Run from `Voyage-Client/`: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/insights-column.test.jsx tests/dashboard-independent-loading.test.jsx tests/dashboard-hydration.test.jsx tests/dashboard-polish.test.jsx`
Expected: PASS. The client ignores `recentViews` until Task 13.

- [ ] **Step 5: Commit both repos**

In `Voyage-Server/`:

```bash
git add scripts/export-dashboard-fixtures.ts
git commit -m "test(dashboard): name the client on a fixture share link" -m "The Kyoto link is shared with Maria Santos, so the client's contract test shows Recently viewed preferring the link's name to the trip's." -- scripts/export-dashboard-fixtures.ts
```

In `Voyage-Client/`:

```bash
git add tests/fixtures/dashboard-payloads.json
git commit -m "test(dashboard): regenerate the dashboard fixture with recentViews" -- tests/fixtures/dashboard-payloads.json
```

---

### Task 6: Calendar action rules (client)

**Why:** one pure module decides, for any calendar item, whether it needs the agent and how urgently. The tile marks, the spoken label and the popover order all use it, so they can't disagree. The rules are in spec §3.

**Files:**
- Create: `Voyage-Client/app/lib/calendarActions.js`
- Modify: `Voyage-Client/app/lib/calendarDays.js:107-116`
- Create: `Voyage-Client/tests/calendar-actions.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/calendar-actions.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildCalendarDays } from "../app/lib/calendarDays.js";
import { daySummaryText, eventAction, spanAction, summarizeDay } from "../app/lib/calendarActions.js";

const OCT = new Date(2026, 9, 1);
const TODAY = new Date(2026, 9, 3, 10, 0); // Saturday, October 3

function cells({ trips = [], events = [] } = {}) {
  const payload = { from: "2026-09-27", to: "2026-11-07", generatedAt: "", tripsWithoutDates: 0, trips, events };
  return buildCalendarDays(payload, OCT, TODAY);
}
const cellOn = (all, key) => all.find((cell) => cell.key === key);

let nextId = 0;
/** An event at 09:00 local on October `day`. */
function event(kind, day, detail = {}) {
  nextId += 1;
  return {
    id: `${kind}:${nextId}`,
    kind,
    tripId: "t1",
    tripTitle: "Lisbon Getaway",
    clientName: "Tanaka",
    occurredAt: new Date(2026, 9, day, 9).toISOString(),
    detail,
  };
}

function trip(startDate, endDate = startDate) {
  return {
    tripId: `t-${startDate}`,
    tripTitle: "Kyoto Autumn Escape",
    clientName: "Reyes",
    placeLabel: "Kyoto",
    startDate,
    endDate,
    status: "IN_REVIEW",
    travelerCount: 2,
  };
}

describe("buildCalendarDays", () => {
  it("says how many days each cell is from today", () => {
    const all = cells();
    expect(cellOn(all, "2026-10-01").daysFromToday).toBe(-2);
    expect(cellOn(all, "2026-10-03").daysFromToday).toBe(0);
    expect(cellOn(all, "2026-10-10").daysFromToday).toBe(7);
  });
});

describe("eventAction", () => {
  const day = (key) => cellOn(cells(), key);

  it("flags a comment only when the server says it needs a reply", () => {
    expect(eventAction(event("client_commented", 2, { needsReply: true }), day("2026-10-02"))).toBe("reply");
    expect(eventAction(event("client_commented", 2, { needsReply: false }), day("2026-10-02"))).toBeNull();
    // An older server doesn't send needsReply: quiet, never a false alarm.
    expect(eventAction(event("client_commented", 2, {}), day("2026-10-02"))).toBeNull();
  });

  it.each([
    ["proposal_rated", 3, "lowRating"],
    ["proposal_rated", 4, null],
    ["review_submitted", 1, "lowRating"],
    ["review_submitted", 5, null],
  ])("%s at %i stars is %s", (kind, rating, expected) => {
    expect(eventAction(event(kind, 2, { rating }), day("2026-10-02"))).toBe(expected);
  });

  it("keeps a low rating flagged on a past day", () => {
    expect(eventAction(event("proposal_rated", 1, { rating: 2 }), day("2026-10-01"))).toBe("lowRating");
  });

  it("flags a link expiring today or later, not one that already expired", () => {
    expect(eventAction(event("share_expires", 2), day("2026-10-02"))).toBeNull();
    expect(eventAction(event("share_expires", 3), day("2026-10-03"))).toBe("expiring");
    expect(eventAction(event("share_expires", 10), day("2026-10-10"))).toBe("expiring");
  });

  it("treats sent links and views as quiet", () => {
    expect(eventAction(event("share_sent", 2), day("2026-10-02"))).toBeNull();
    expect(eventAction(event("client_viewed", 2, { viewCount: 3 }), day("2026-10-02"))).toBeNull();
  });
});

describe("spanAction", () => {
  it.each([
    ["2026-10-02", null], // started yesterday
    ["2026-10-03", "departing"], // today
    ["2026-10-10", "departing"], // 7 days out
    ["2026-10-11", null], // 8 days out
  ])("a trip starting %s is %s on its first day", (startDate, expected) => {
    const all = cells({ trips: [trip(startDate, "2026-10-20")] });
    const first = cellOn(all, startDate);
    expect(spanAction(first.spans[0], first)).toBe(expected);
  });

  it("flags only the first day, not the rest of the trip", () => {
    const all = cells({ trips: [trip("2026-10-05", "2026-10-07")] });
    const middle = cellOn(all, "2026-10-06");
    expect(spanAction(middle.spans[0], middle)).toBeNull();
  });
});

describe("summarizeDay", () => {
  it("counts actions in priority order, then other trips and quiet activity", () => {
    const all = cells({
      trips: [trip("2026-10-05"), trip("2026-10-01", "2026-10-09")],
      events: [
        event("share_expires", 5),
        event("client_viewed", 5, { viewCount: 2 }),
        event("client_commented", 5, { needsReply: true }),
        event("client_commented", 5, { needsReply: true }),
        event("proposal_rated", 5, { rating: 2 }),
        event("share_sent", 5),
      ],
    });

    expect(summarizeDay(cellOn(all, "2026-10-05"))).toEqual({
      actions: [
        { kind: "reply", count: 2 },
        { kind: "lowRating", count: 1 },
        { kind: "expiring", count: 1 },
        { kind: "departing", count: 1 },
      ],
      actionCount: 5,
      otherTripCount: 1,
      quietCount: 2,
    });
  });

  it("is empty for an empty day", () => {
    expect(summarizeDay(cellOn(cells(), "2026-10-05"))).toEqual({
      actions: [],
      actionCount: 0,
      otherTripCount: 0,
      quietCount: 0,
    });
  });
});

describe("daySummaryText", () => {
  it("names each part in the singular", () => {
    expect(
      daySummaryText({
        actions: [
          { kind: "reply", count: 1 },
          { kind: "lowRating", count: 1 },
          { kind: "expiring", count: 1 },
          { kind: "departing", count: 1 },
        ],
        otherTripCount: 1,
        quietCount: 1,
      }),
    ).toBe("1 comment needs a reply, 1 low rating, 1 link expiring, 1 trip departing soon, 1 trip, 1 other update");
  });

  it("names each part in the plural", () => {
    expect(
      daySummaryText({
        actions: [
          { kind: "reply", count: 2 },
          { kind: "lowRating", count: 2 },
          { kind: "expiring", count: 3 },
          { kind: "departing", count: 2 },
        ],
        otherTripCount: 2,
        quietCount: 3,
      }),
    ).toBe("2 comments need a reply, 2 low ratings, 3 links expiring, 2 trips departing soon, 2 trips, 3 other updates");
  });

  it("is empty when nothing is on the day", () => {
    expect(daySummaryText({ actions: [], otherTripCount: 0, quietCount: 0 })).toBe("");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/calendar-actions.test.js`
Expected: FAIL. The file can't import `../app/lib/calendarActions.js`.

- [ ] **Step 3: Give each cell its distance from today**

In `app/lib/calendarDays.js`, inside `buildCalendarDays`, replace:

```js
      isToday: key === todayKey,
      isPast: key < todayKey,
      spans,
```

with:

```js
      isToday: key === todayKey,
      isPast: key < todayKey,
      /** Whole days from today: 0 today, negative before. */
      daysFromToday: daysBetweenKeys(todayKey, key),
      spans,
```

- [ ] **Step 4: Create the rules module**

Create `app/lib/calendarActions.js`:

```js
/**
 * Which calendar items need the agent, and how urgently. Day tiles draw these
 * as coloured icons and their labels name them; everything else on a day is
 * quiet activity, summed as "·N". Rules: Voyage-Server spec
 * docs/superpowers/specs/2026-10-04-calendar-action-icons-recently-viewed-design.md §3.
 */

/** Most urgent first: a tile with more kinds than it can show keeps the earlier ones. */
export const ACTION_ORDER = ["reply", "lowRating", "expiring", "departing"];

/** Ratings at or below this many stars are low (the "Needs you today" threshold). */
export const LOW_RATING_MAX = 3;

/** A trip departs soon when its first day is today or up to this many days out. */
export const DEPARTING_WINDOW_DAYS = 7;

/**
 * The action an event asks for on its day, or null when it is quiet activity.
 * @param {{ kind: string, detail?: object }} event
 * @param {{ isPast: boolean }} cell  the day the event falls on
 */
export function eventAction(event, cell) {
  switch (event.kind) {
    case "client_commented":
      // An older server doesn't send needsReply: treat it as answered, never a false alarm.
      return event.detail?.needsReply === true ? "reply" : null;
    case "proposal_rated":
    case "review_submitted":
      return Number.isFinite(event.detail?.rating) && event.detail.rating <= LOW_RATING_MAX ? "lowRating" : null;
    case "share_expires":
      return cell.isPast ? null : "expiring";
    default:
      return null;
  }
}

/**
 * "departing" on a trip's first day when that day is today or within the
 * next DEPARTING_WINDOW_DAYS days; null otherwise.
 * @param {{ isStart: boolean }} span
 * @param {{ daysFromToday: number }} cell
 */
export function spanAction(span, cell) {
  return span.isStart && cell.daysFromToday >= 0 && cell.daysFromToday <= DEPARTING_WINDOW_DAYS ? "departing" : null;
}

/**
 * What a day holds, for its tile and its label.
 * `actions` lists only the kinds present, in ACTION_ORDER.
 * @returns {{ actions: Array<{ kind: string, count: number }>, actionCount: number, otherTripCount: number, quietCount: number }}
 */
export function summarizeDay(cell) {
  const counts = Object.fromEntries(ACTION_ORDER.map((kind) => [kind, 0]));
  let otherTripCount = 0;
  let quietCount = 0;
  for (const span of cell.spans) {
    const action = spanAction(span, cell);
    if (action) counts[action] += 1;
    else otherTripCount += 1;
  }
  for (const event of cell.events) {
    const action = eventAction(event, cell);
    if (action) counts[action] += 1;
    else quietCount += 1;
  }
  const actions = ACTION_ORDER.filter((kind) => counts[kind] > 0).map((kind) => ({ kind, count: counts[kind] }));
  const actionCount = actions.reduce((sum, action) => sum + action.count, 0);
  return { actions, actionCount, otherTripCount, quietCount };
}

const plural = (count, one, many) => (count === 1 ? one : many.replace("{n}", String(count)));

const PHRASES = {
  reply: (n) => plural(n, "1 comment needs a reply", "{n} comments need a reply"),
  lowRating: (n) => plural(n, "1 low rating", "{n} low ratings"),
  expiring: (n) => plural(n, "1 link expiring", "{n} links expiring"),
  departing: (n) => plural(n, "1 trip departing soon", "{n} trips departing soon"),
};

/**
 * "1 comment needs a reply, 1 link expiring, 2 other updates": what is on a
 * day in priority order, then other trips, then quiet activity. Empty when
 * nothing is on the day.
 */
export function daySummaryText({ actions, otherTripCount, quietCount }) {
  const parts = actions.map(({ kind, count }) => PHRASES[kind](count));
  if (otherTripCount > 0) parts.push(plural(otherTripCount, "1 trip", "{n} trips"));
  if (quietCount > 0) parts.push(plural(quietCount, "1 other update", "{n} other updates"));
  return parts.join(", ");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/calendar-actions.test.js tests/calendar-days.test.js`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add app/lib/calendarActions.js app/lib/calendarDays.js tests/calendar-actions.test.js
git commit -m "feat(calendar): add the rules for what needs you on a day" -m "Unanswered comments, low ratings (3 stars or less), links expiring today or later and trips departing within a week are actions, in that priority; everything else is quiet. Cells now say how many days they are from today." -- app/lib/calendarActions.js app/lib/calendarDays.js tests/calendar-actions.test.js
```

---

### Task 7: The day popover lists what needs you first, in matching colours (client)

**Why:**

- **Order:** the popover should start with the items that need the agent, most urgent first.
- **Colour:** each item's badge should take its tile icon's colour, so the popover and the tile tell the same story. Past link expiries lose the amber they have today.

**Files:**
- Modify: `Voyage-Client/app/lib/calendarDays.js:164-192` (`describeDayItems`)
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx:7-11, 133`
- Test: `Voyage-Client/tests/calendar-days.test.js`, `Voyage-Client/tests/calendar-day-popover.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tests/calendar-days.test.js`, in the test `"describes each kind of client activity"`, replace the expected list:

```js
    ).toEqual([
      ["Sent Lisbon Getaway to Tanaka", "Itinerary link shared", "Open trip"],
      ["Lisbon Getaway link expires", "Shared with Tanaka", "Open trip"],
      ["Tanaka viewed Lisbon Getaway", "4 views in total", "Open trip"],
      ["Tanaka commented", "“Can we swap lunch?”", "Reply"],
      ["Tanaka rated the proposal", "5 out of 5", "Open trip"],
      ["Tanaka reviewed Lisbon Getaway", "4 out of 5 · “Lovely”", "Open trip"],
    ]);
```

with:

```js
    ).toEqual([
      // October 5 is after today, so the expiring link needs you and comes first.
      ["Lisbon Getaway link expires", "Shared with Tanaka", "Open trip"],
      ["Sent Lisbon Getaway to Tanaka", "Itinerary link shared", "Open trip"],
      ["Tanaka viewed Lisbon Getaway", "4 views in total", "Open trip"],
      ["Tanaka commented", "“Can we swap lunch?”", "Reply"],
      ["Tanaka rated the proposal", "5 out of 5", "Open trip"],
      ["Tanaka reviewed Lisbon Getaway", "4 out of 5 · “Lovely”", "Open trip"],
    ]);
```

In the same file, inside `describe("describeDayItems", ...)`, after that test, add:

```js
  it("lists what needs you first, most urgent first, then trips, then the rest", () => {
    const at = new Date(2026, 9, 8, 9).toISOString();
    const base = { tripId: "t1", tripTitle: "Lisbon Getaway", clientName: "Tanaka", occurredAt: at };
    const events = [
      { ...base, id: "client_viewed:s1", kind: "client_viewed", detail: { viewCount: 2 } },
      { ...base, id: "share_expires:s1", kind: "share_expires", detail: {} },
      { ...base, id: "proposal_rated:s1", kind: "proposal_rated", detail: { rating: 2 } },
      { ...base, id: "client_commented:c1", kind: "client_commented", detail: { excerpt: "Hi", needsReply: true } },
    ];
    const longTrip = { ...kyoto, tripId: "t-long", startDate: "2026-10-01", endDate: "2026-10-20" };
    const cells = buildCalendarDays(payload({ trips: [kyoto, longTrip], events }), OCT, TODAY);

    expect(describeDayItems(cellFor(cells, "2026-10-08")).map((item) => [item.key, item.actionKind])).toEqual([
      ["client_commented:c1", "reply"],
      ["proposal_rated:s1", "lowRating"],
      ["share_expires:s1", "expiring"],
      ["trip:t-kyoto", "departing"], // starts in 5 days
      ["trip:t-long", null], // mid-trip
      ["client_viewed:s1", null],
    ]);
  });
```

In `tests/calendar-day-popover.test.jsx`, inside `describe("CalendarDayPopover", ...)`, add:

```jsx
  it("tints each badge by what the item needs: danger, warning, success, the trip colour or grey", () => {
    const at = new Date(2026, 9, 8, 9).toISOString();
    const base = { tripId: "t1", tripTitle: "Lisbon Getaway", clientName: "Tanaka", occurredAt: at };
    const payload = {
      from: "2026-09-27",
      to: "2026-11-07",
      generatedAt: "",
      tripsWithoutDates: 0,
      trips: [kyoto, { ...osaka, startDate: "2026-10-01", endDate: "2026-10-20" }],
      events: [
        { ...base, id: "client_commented:c1", kind: "client_commented", detail: { excerpt: "Hi", needsReply: true } },
        { ...base, id: "share_expires:s1", kind: "share_expires", detail: {} },
        { ...base, id: "client_viewed:s1", kind: "client_viewed", detail: { viewCount: 2 } },
      ],
    };
    const cell = buildCalendarDays(payload, OCT, TODAY).find((day) => day.key === "2026-10-08");
    render(<CalendarDayPopover cell={cell} todayKey="2026-10-03" anchorEl={null} containerEl={null} inline onClose={vi.fn()} onAction={vi.fn()} />);

    const badges = screen.getAllByRole("listitem").map((item) => item.querySelector("[aria-hidden='true']").className);
    expect(badges[0]).toContain("bg-status-danger/15"); // the comment needs a reply
    expect(badges[1]).toContain("bg-status-warning/15"); // the link expires
    expect(badges[2]).toContain("bg-status-success/15"); // Kyoto departs in 5 days
    expect(badges[3]).toContain("bg-secondary/15"); // Osaka, mid-trip
    expect(badges[4]).toContain("bg-text-muted/15"); // a view
  });

  it("greys a link that already expired", () => {
    const payload = {
      from: "2026-09-27",
      to: "2026-11-07",
      generatedAt: "",
      tripsWithoutDates: 0,
      trips: [],
      events: [
        {
          id: "share_expires:s1",
          kind: "share_expires",
          tripId: "t1",
          tripTitle: "Lisbon Getaway",
          clientName: "Tanaka",
          occurredAt: new Date(2026, 9, 1, 9).toISOString(),
          detail: {},
        },
      ],
    };
    const cell = buildCalendarDays(payload, OCT, TODAY).find((day) => day.key === "2026-10-01");
    render(<CalendarDayPopover cell={cell} todayKey="2026-10-03" anchorEl={null} containerEl={null} inline onClose={vi.fn()} onAction={vi.fn()} />);

    expect(screen.getByRole("listitem").querySelector("[aria-hidden='true']").className).toContain("bg-text-muted/15");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js tests/calendar-day-popover.test.jsx`

Expected FAILs:
- "describes each kind of client activity": the expiring link is still second.
- "lists what needs you first…": there is no `actionKind`, and the items are in server order.
- **Both popover tests:** the comment badge is grey, the trip badges use the trip colour, and the past expiry is still amber.

- [ ] **Step 3: Sort and tag the popover items**

In `app/lib/calendarDays.js`, at the very top of the file (above the doc comment), add:

```js
import { ACTION_ORDER, eventAction, spanAction } from "./calendarActions";

```

Then replace the whole `describeDayItems` function and its doc comment:

```js
/**
 * What a day's details list: its trips first, then its events. Every item
 * opens its trip; comments say "Reply".
 */
export function describeDayItems(cell) {
  const items = cell.spans.map((span) => ({
    key: `trip:${span.tripId}`,
    kind: "trip",
    tripId: span.tripId,
    tripTitle: span.tripTitle,
    clientName: span.clientName,
    actionLabel: "Open trip",
    ...spanCopy(span),
  }));
  for (const event of cell.events) {
    const copy = EVENT_COPY[event.kind];
    if (!copy) continue;
    items.push({
      key: event.id,
      kind: event.kind,
      tripId: event.tripId,
      tripTitle: event.tripTitle,
      clientName: event.clientName,
      actionLabel: event.kind === "client_commented" ? "Reply" : "Open trip",
      ...copy(event, cell),
    });
  }
  return items;
}
```

with:

```js
/** Sort rank: items that need the agent by urgency, then trips, then quiet activity. */
function itemRank(item) {
  if (item.actionKind) return ACTION_ORDER.indexOf(item.actionKind);
  return item.kind === "trip" ? ACTION_ORDER.length : ACTION_ORDER.length + 1;
}

/**
 * What a day's details list: the items that need the agent first (most urgent
 * first), then its trips, then quiet activity in time order. `actionKind`
 * ("reply", "lowRating", "expiring", "departing" or null) matches the icon on
 * the day's tile. Every item opens its trip; comments say "Reply".
 */
export function describeDayItems(cell) {
  const items = cell.spans.map((span) => ({
    key: `trip:${span.tripId}`,
    kind: "trip",
    actionKind: spanAction(span, cell),
    tripId: span.tripId,
    tripTitle: span.tripTitle,
    clientName: span.clientName,
    actionLabel: "Open trip",
    ...spanCopy(span),
  }));
  for (const event of cell.events) {
    const copy = EVENT_COPY[event.kind];
    if (!copy) continue;
    items.push({
      key: event.id,
      kind: event.kind,
      actionKind: eventAction(event, cell),
      tripId: event.tripId,
      tripTitle: event.tripTitle,
      clientName: event.clientName,
      actionLabel: event.kind === "client_commented" ? "Reply" : "Open trip",
      ...copy(event, cell),
    });
  }
  // Array.prototype.sort is stable: equal ranks keep the server's time order.
  return items.sort((a, b) => itemRank(a) - itemRank(b));
}
```

- [ ] **Step 4: Colour the badges by `actionKind`**

In `CalendarDayPopover.jsx`, replace:

```js
const KIND_BADGE = {
  trip: "bg-secondary/15 text-secondary-strong",
  share_expires: "bg-status-warning/15 text-status-warning",
};
const DEFAULT_BADGE = "bg-text-muted/15 text-text-muted";
```

with:

```js
/** An item that needs the agent takes its tile icon's colour; trips keep terracotta; the rest are grey. */
const ACTION_BADGE = {
  reply: "bg-status-danger/15 text-status-danger",
  lowRating: "bg-status-danger/15 text-status-danger",
  expiring: "bg-status-warning/15 text-status-warning",
  departing: "bg-status-success/15 text-status-success",
};
const TRIP_BADGE = "bg-secondary/15 text-secondary-strong";
const DEFAULT_BADGE = "bg-text-muted/15 text-text-muted";

function badgeClass(item) {
  if (item.actionKind) return ACTION_BADGE[item.actionKind];
  return item.kind === "trip" ? TRIP_BADGE : DEFAULT_BADGE;
}
```

and replace:

```jsx
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${KIND_BADGE[item.kind] ?? DEFAULT_BADGE}`}
```

with:

```jsx
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${badgeClass(item)}`}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js tests/calendar-day-popover.test.jsx tests/calendar-actions.test.js tests/agency-calendar.test.jsx`
Expected: PASS (all four files).

- [ ] **Step 6: Commit**

```bash
git add app/lib/calendarDays.js "app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx" tests/calendar-days.test.js tests/calendar-day-popover.test.jsx
git commit -m "feat(calendar): list what needs you first in the day popover" -m "Day items carry actionKind and sort by urgency, then trips, then quiet activity. Badges take the tile icon's colour (danger, warning, success); past expiries turn grey." -- app/lib/calendarDays.js "app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx" tests/calendar-days.test.js tests/calendar-day-popover.test.jsx
```

---

### Task 8: Day tiles show action icons, a spoken summary and a new legend (client)

**Why:** this is the main visible change, spec §4.

Measured tile widths:

| Screen width | Tile width |
|---|---|
| 375px | 37px |
| 1024px | 65px |
| 1280px | 96px |

Each tile becomes a CSS container, so what it shows follows its own width:

| Tile width | Shows |
|---|---|
| under 60px | the top icon |
| 60–83px | the top icon with its count, plus `+N` |
| 84px and up | two icons, `+N`, and `·N` beside a single kind |

The marks wrap under the day number when a tile is too narrow for both.

**Files:**
- Create: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/DayMarks.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx`
- Test: `Voyage-Client/tests/agency-calendar.test.jsx`, `Voyage-Client/tests/theme-tokens.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/agency-calendar.test.jsx`, replace the `day` helper:

```js
/** A day button by its date ("Saturday, October 3"), ignoring the count suffix. */
const day = (label) =>
  screen.getByRole("button", { name: (name) => name === label || name.startsWith(`${label},`) });
```

with:

```js
/** A day button by its date ("Saturday, October 3"), ignoring ", today" and what is on the day. */
const day = (label) =>
  screen.getByRole("button", {
    name: (name) => name === label || name.startsWith(`${label},`) || name.startsWith(`${label}:`),
  });
```

Replace the test:

```js
  it("counts what is on each day and labels a trip on its first day", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    expect(day("Thursday, October 8")).toHaveAccessibleName("Thursday, October 8, 1 item");
    expect(day("Friday, October 2")).toHaveAccessibleName("Friday, October 2, 1 item");
    expect(within(day("Thursday, October 8")).getByText("Kyoto")).toBeInTheDocument();
  });
```

with:

```js
  it("says what is on each day and labels a trip on its first day", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    // Kyoto starts in five days; the comment carries no needsReply, so it is quiet.
    expect(day("Thursday, October 8")).toHaveAccessibleName("Thursday, October 8: 1 trip departing soon");
    expect(day("Friday, October 9")).toHaveAccessibleName("Friday, October 9: 1 trip");
    expect(day("Friday, October 2")).toHaveAccessibleName("Friday, October 2: 1 other update");
    expect(within(day("Thursday, October 8")).getByText("Kyoto")).toBeInTheDocument();
  });
```

At the end of the file, add:

```js
/** A calendar event at 09:00 local on October `dayOfMonth`. */
function ev(id, kind, dayOfMonth, detail = {}) {
  return {
    id,
    kind,
    tripId: "t-lisbon",
    tripTitle: "Lisbon Getaway",
    clientName: "Tanaka",
    occurredAt: new Date(2026, 9, dayOfMonth, 9).toISOString(),
    detail,
  };
}

const ACTION_PAYLOAD = {
  ...PAYLOAD,
  trips: [],
  events: [
    // Monday, October 5: two replies needed, a 2★ rating, a link expiring, a view and a sent link.
    ev("client_commented:a", "client_commented", 5, { excerpt: "One", needsReply: true }),
    ev("client_commented:b", "client_commented", 5, { excerpt: "Two", needsReply: true }),
    ev("proposal_rated:s1", "proposal_rated", 5, { rating: 2 }),
    ev("share_expires:s1", "share_expires", 5),
    ev("client_viewed:s1", "client_viewed", 5, { viewCount: 3 }),
    ev("share_sent:s1", "share_sent", 5),
    // Tuesday, October 6: a link expiring and a view.
    ev("share_expires:s2", "share_expires", 6),
    ev("client_viewed:s2", "client_viewed", 6, { viewCount: 1 }),
    // Wednesday, October 7: quiet activity only.
    ev("client_viewed:s3", "client_viewed", 7, { viewCount: 1 }),
    ev("share_sent:s3", "share_sent", 7),
  ],
};

describe("AgencyCalendar action marks", () => {
  beforeEach(() => {
    mocks.useCalendarEvents.mockReturnValue(hookResult({ data: ACTION_PAYLOAD }));
  });

  const marks = (label) => day(label).querySelector("[data-day-marks]");

  it("says what needs you on a day, most urgent first", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    expect(day("Monday, October 5")).toHaveAccessibleName(
      "Monday, October 5: 2 comments need a reply, 1 low rating, 1 link expiring, 2 other updates",
    );
  });

  it("makes each tile a size container whose marks wrap under the day number when narrow", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    expect(day("Monday, October 5").className).toContain("@container");
    expect(marks("Monday, October 5").parentElement.className).toContain("flex-wrap");
    expect(marks("Monday, October 5")).toHaveAttribute("aria-hidden", "true");
  });

  it("always shows the most urgent icon, its count from 60px, and a second icon from 84px", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    const [first, second] = marks("Monday, October 5").querySelectorAll("[data-action]");
    expect(first.dataset.action).toBe("reply");
    expect(first.className).toContain("inline-flex");
    expect(first.className).not.toContain("hidden");
    expect(first.className).toContain("text-status-danger");
    expect(within(first).getByText("2").className).toContain("hidden @min-[60px]:inline");
    expect(second.dataset.action).toBe("lowRating");
    expect(second.className).toContain("hidden @min-[84px]:inline-flex");
  });

  it("counts the rest as +N: after the first icon at 60px, after the first two kinds at 84px", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    const [medium, wide] = marks("Monday, October 5").querySelectorAll("[data-more]");
    expect(medium).toHaveTextContent("+2"); // the rating and the link, after the replies
    expect(medium.className).toContain("hidden @min-[60px]:inline @min-[84px]:hidden");
    expect(wide).toHaveTextContent("+1"); // the link, after the replies and the rating
    expect(wide.className).toContain("hidden @min-[84px]:inline");
  });

  it("adds the quiet count beside a single kind of action, on wide tiles only", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    const tuesday = marks("Tuesday, October 6");
    const icon = tuesday.querySelector("[data-action]");
    expect(icon.dataset.action).toBe("expiring");
    expect(icon.className).toContain("text-status-warning");
    const quiet = tuesday.querySelector("[data-quiet]");
    expect(quiet).toHaveTextContent("·1");
    expect(quiet.className).toContain("hidden @min-[84px]:inline");
    // With two kinds of action there is no room for it.
    expect(marks("Monday, October 5").querySelector("[data-quiet]")).toBeNull();
  });

  it("shows only the quiet count on a day with nothing to act on", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    const wednesday = marks("Wednesday, October 7");
    expect(wednesday).toHaveTextContent("·2");
    expect(wednesday.className).not.toContain("hidden");
    expect(wednesday.querySelector("[data-action]")).toBeNull();
    expect(day("Wednesday, October 7")).toHaveAccessibleName("Wednesday, October 7: 2 other updates");
  });

  it("marks a trip that departs within the week in green", () => {
    mocks.useCalendarEvents.mockReturnValue(hookResult());
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    const icon = marks("Thursday, October 8").querySelector("[data-action]");
    expect(icon.dataset.action).toBe("departing");
    expect(icon.className).toContain("text-status-success");
  });

  it("explains every mark in the legend", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    for (const label of ["Trip", "Needs reply", "Low rating", "Link expires", "Departs soon", "Other activity"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Client activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Link expiry")).not.toBeInTheDocument();
  });
});
```

In `tests/theme-tokens.test.js`, inside the `describe.each(...)` callback, after the last `it.each`, add:

```js
  /** A calendar day tile: --frame-tile over the calendar card's --frame-tile over the page. */
  function dayTile() {
    const page = resolve("rgb(var(--color-background-rgb))", tokens);
    const card = over(resolve("var(--frame-tile)", tokens), page);
    return over(resolve("var(--frame-tile)", tokens), card);
  }

  it.each(["--color-status-danger", "--color-status-warning", "--color-status-success"])(
    "%s calendar marks reach 4.5:1 on a day tile (icons need 3:1; their counts are text and need 4.5:1)",
    (token) => {
      expect(contrastRatio(resolve(`var(${token})`, tokens), dayTile())).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("the quiet ·N count reaches 4.5:1 on a day tile", () => {
    expect(contrastRatio(resolve("rgb(var(--color-text-muted-rgb))", tokens), dayTile())).toBeGreaterThanOrEqual(4.5);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx tests/theme-tokens.test.js`

Expected FAILs:
- **agency-calendar:**
  - "says what is on each day…": the labels still end in ", 1 item".
  - Every `AgencyCalendar action marks` test: there is no `[data-day-marks]`, the old label is used, and the old legend is shown.
- **theme-tokens:** the new tile tests PASS already. Measured: about 5.2–6.5:1 light, 5.5–7.9:1 dark, and 6.2–6.8:1 for `·N`. They pin the requirement.

- [ ] **Step 3: Create the marks and the legend**

Create `app/agency/[agencyId]/components/dashboard/widgets/DayMarks.jsx`:

```jsx
"use client";

import KindIcon from "./KindIcon";

/** How each action looks on a tile and in the legend: an existing KindIcon and a status colour. */
export const ACTION_STYLE = {
  reply: { icon: "client_commented", tone: "text-status-danger", legend: "Needs reply" },
  lowRating: { icon: "proposal_rated", tone: "text-status-danger", legend: "Low rating" },
  expiring: { icon: "share_expires", tone: "text-status-warning", legend: "Link expires" },
  departing: { icon: "startingSoon", tone: "text-status-success", legend: "Departs soon" },
};

const COUNT = "text-[11px] font-semibold leading-none tabular-nums";

function ActionMark({ action, className, countClassName }) {
  const { icon, tone } = ACTION_STYLE[action.kind];
  return (
    <span data-action={action.kind} className={`${className} items-center gap-0.5 ${tone}`}>
      <KindIcon kind={icon} className="h-3 w-3 flex-none" />
      {action.count > 1 ? <span className={`${countClassName} ${COUNT}`}>{action.count}</span> : null}
    </span>
  );
}

/**
 * The marks in a day tile's corner. The tile is a CSS container, so what
 * shows follows the tile's own width:
 * - under 60px: the most urgent icon only;
 * - 60–83px: that icon with its count, then +N for the day's other action items;
 * - 84px and up: two icons with counts, +N for further kinds, and ·N for
 *   quiet activity when at most one kind of action is drawn.
 * A day with no action shows only ·N. The marks are aria-hidden: the tile's
 * label says the same in words.
 */
export function DayMarks({ summary }) {
  const { actions, actionCount, quietCount } = summary;
  if (actions.length === 0) {
    return quietCount > 0 ? (
      <span aria-hidden="true" data-day-marks="" className="text-[11px] leading-none tabular-nums text-text-muted">
        ·{quietCount}
      </span>
    ) : null;
  }

  const [first, second] = actions;
  const afterFirst = actionCount - first.count;
  const afterTwo = afterFirst - (second?.count ?? 0);
  return (
    <span aria-hidden="true" data-day-marks="" className="flex items-center gap-1 leading-none">
      <ActionMark action={first} className="inline-flex" countClassName="hidden @min-[60px]:inline" />
      {second ? <ActionMark action={second} className="hidden @min-[84px]:inline-flex" countClassName="inline" /> : null}
      {afterFirst > 0 ? (
        <span data-more="" className={`hidden @min-[60px]:inline @min-[84px]:hidden ${COUNT} text-text-primary`}>
          +{afterFirst}
        </span>
      ) : null}
      {afterTwo > 0 ? (
        <span data-more="" className={`hidden @min-[84px]:inline ${COUNT} text-text-primary`}>
          +{afterTwo}
        </span>
      ) : null}
      {actions.length === 1 && quietCount > 0 ? (
        <span data-quiet="" className="hidden @min-[84px]:inline text-[11px] leading-none tabular-nums text-text-muted">
          ·{quietCount}
        </span>
      ) : null}
    </span>
  );
}

/** The calendar's key: the trip bar, the four action icons and the quiet count. */
export function CalendarLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-[3px] w-3 rounded-full bg-secondary" />
        Trip
      </span>
      {Object.entries(ACTION_STYLE).map(([kind, { icon, tone, legend }]) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <KindIcon kind={icon} className={`h-3 w-3 flex-none ${tone}`} />
          {legend}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="font-semibold tabular-nums">
          ·N
        </span>
        Other activity
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Use them in the calendar**

In `AgencyCalendar.jsx`, replace:

```jsx
import CalendarDayPopover from "./CalendarDayPopover";
```

with:

```jsx
import { daySummaryText, summarizeDay } from "@/app/lib/calendarActions";
import CalendarDayPopover from "./CalendarDayPopover";
import { CalendarLegend, DayMarks } from "./DayMarks";
```

Replace:

```jsx
function dayLabel(cell) {
  const count = cell.spans.length + cell.events.length;
  return `${fullDayLabel(cell.date)}${cell.isToday ? ", today" : ""}${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`;
}
```

with:

```jsx
/** "Saturday, October 3, today: 1 comment needs a reply, 2 other updates". */
function dayLabel(cell, summary) {
  const contents = daySummaryText(summary);
  return `${fullDayLabel(cell.date)}${cell.isToday ? ", today" : ""}${contents ? `: ${contents}` : ""}`;
}
```

Delete the whole `DayDots` function, from `function DayDots({ events }) {` to its closing `}`.

In `DayTile`, replace:

```jsx
  const allPast = cell.spans.length > 0 && cell.spans.every((span) => span.isPast);
  return (
    <button
      ref={buttonRef}
      type="button"
      data-calendar-day=""
      tabIndex={tabbable ? 0 : -1}
      aria-label={dayLabel(cell)}
```

with:

```jsx
  const allPast = cell.spans.length > 0 && cell.spans.every((span) => span.isPast);
  const summary = summarizeDay(cell);
  return (
    <button
      ref={buttonRef}
      type="button"
      data-calendar-day=""
      tabIndex={tabbable ? 0 : -1}
      aria-label={dayLabel(cell, summary)}
```

Replace:

```jsx
        "relative flex h-full min-h-[56px] w-full flex-col overflow-hidden rounded-[10px] p-1.5 text-left transition-colors",
```

with:

```jsx
        // A size container: DayMarks shows more as the tile gets wider.
        "@container relative flex h-full min-h-[56px] w-full flex-col overflow-hidden rounded-[10px] p-1.5 text-left transition-colors",
```

Replace:

```jsx
      <span className="flex items-center justify-between gap-1">
        <span className={`text-[11px] font-semibold tabular-nums ${cell.inMonth ? "text-text-primary" : "text-text-muted"}`}>
          {cell.dayOfMonth}
        </span>
        <DayDots events={cell.events} />
      </span>
```

with:

```jsx
      {/* The marks wrap under the day number when the tile is too narrow for both. */}
      <span className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
        <span className={`text-[11px] font-semibold tabular-nums ${cell.inMonth ? "text-text-primary" : "text-text-muted"}`}>
          {cell.dayOfMonth}
        </span>
        <DayMarks summary={summary} />
      </span>
```

Replace the legend block:

```jsx
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-[3px] w-3 rounded-full bg-secondary" />
          Trip
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-warning" />
          Link expiry
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-text-muted" />
          Client activity
        </span>
      </div>
```

with:

```jsx
      <CalendarLegend />
```

In the doc comment above `export default function AgencyCalendar`, replace:

```jsx
 * Month calendar of trips (bars) and client activity (dots). Clicking a day
```

with:

```jsx
 * Month calendar of trips (bars) and client activity. Each tile shows what
 * needs the agent as coloured icons (DayMarks) and the rest as ·N. Clicking a day
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx tests/theme-tokens.test.js tests/calendar-day-popover.test.jsx tests/dashboard-hydration.test.jsx tests/theme-safe-classes.test.js`
Expected: PASS (all five files). `theme-safe-classes` checks the new files for theme-blind colour classes.

- [ ] **Step 6: Check that Tailwind generates the container classes**

Run: `npx next build`. Then, in Git Bash:

```bash
for cls in '.\@container' '.\@min-\[60px\]\:inline' '.\@min-\[84px\]\:inline-flex' '.\@min-\[84px\]\:hidden'; do grep -rqF -- "$cls" .next/static --include=*.css && echo "OK $cls" || echo "MISSING $cls"; done
```

Expected: four `OK` lines. If one is MISSING, check the class spelling in `DayMarks.jsx`. Tailwind only generates classes it can read literally in the source.

- [ ] **Step 7: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/DayMarks.jsx" "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/agency-calendar.test.jsx tests/theme-tokens.test.js
git commit -m "feat(calendar): show what needs you on each day tile" -m "Tiles draw unanswered comments, low ratings, expiring links and trips departing soon as coloured icons, sized by the tile's own width (container queries), with ·N for quiet activity. The label says it in words and the legend explains each mark." -- "app/agency/[agencyId]/components/dashboard/widgets/DayMarks.jsx" "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/agency-calendar.test.jsx tests/theme-tokens.test.js
```

---

### Task 9: The calendar reloads when asked (client)

**Why:**

- **Polling:** the calendar refreshes every minute on its own.
- **After a reply:** the dashboard should reload it at once. A `refreshKey` prop does that: when its value changes, the calendar refetches the visible month. Task 13 bumps it.

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx` (`CalendarBody` and the doc comment)
- Test: `Voyage-Client/tests/agency-calendar.test.jsx`

- [ ] **Step 1: Write the failing test**

At the end of `tests/agency-calendar.test.jsx`, add:

```js
describe("AgencyCalendar refresh", () => {
  it("reloads the month when refreshKey changes, and not on the first render", () => {
    const refetch = vi.fn();
    mocks.useCalendarEvents.mockReturnValue(hookResult({ refetch }));
    const { rerender } = render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} refreshKey={0} />);
    expect(refetch).not.toHaveBeenCalled();

    rerender(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} refreshKey={1} />);
    expect(refetch).toHaveBeenCalledOnce();

    rerender(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} refreshKey={1} />);
    expect(refetch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx`
Expected: the new test FAILS. `refetch` is never called (`expected "spy" to be called once`).

- [ ] **Step 3: Add the prop**

In `AgencyCalendar.jsx`, replace:

```jsx
function CalendarBody({ agencyId, onOpenTrip, todayKey }) {
```

with:

```jsx
function CalendarBody({ agencyId, onOpenTrip, todayKey, refreshKey }) {
```

and replace:

```jsx
  const { data, error, isLoading, refetch } = useCalendarEvents({ agencyId, month });
```

with:

```jsx
  const { data, error, isLoading, refetch } = useCalendarEvents({ agencyId, month });

  // A new refreshKey (bumped after a reply, say) reloads the month straight away.
  const refreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKeyRef.current === refreshKey) return;
    refreshKeyRef.current = refreshKey;
    refetch();
  }, [refreshKey, refetch]);
```

In the doc comment above `export default function AgencyCalendar`, replace:

```jsx
 * opens its details; their actions call `onOpenTrip(tripId, tripTitle, clientName)`.
```

with:

```jsx
 * opens its details; their actions call `onOpenTrip(tripId, tripTitle, clientName)`.
 * Changing `refreshKey` (optional) reloads the shown month at once.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx tests/dashboard-hydration.test.jsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/agency-calendar.test.jsx
git commit -m "feat(calendar): reload the month when refreshKey changes" -- "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/agency-calendar.test.jsx
```

---

### Task 10: The trip slide-over reports a reply (client)

**Why:** the dashboard has to know a reply happened so it can reload the to-do list and the calendar (Task 13). The report only happens when the reply is saved.

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx:283-297, 447-461`
- Test: `Voyage-Client/tests/trip-slide-over-comments.test.jsx`

- [ ] **Step 1: Write the failing tests**

At the end of `tests/trip-slide-over-comments.test.jsx`, add:

```jsx
describe("TripSlideOver replies", () => {
  async function sendReply(card, text) {
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    fireEvent.change(within(card).getByPlaceholderText("Write a reply…"), { target: { value: text } });
    fireEvent.click(within(card).getByRole("button", { name: "Send Reply" }));
  }

  it("tells the dashboard once a reply is saved, so it can refresh", async () => {
    serve();
    const onReplied = vi.fn();
    render(<Panel onReplied={onReplied} />);

    const card = (await screen.findByText("Comment on s-1")).closest(".dashboard-card");
    await sendReply(card, "Yes, we can swap it.");

    await waitFor(() => expect(onReplied).toHaveBeenCalledWith("c-s-1"));
    expect(mocks.fetchApi).toHaveBeenCalledWith(
      "/agencies/agency-1/shares/comments/c-s-1/reply",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("says nothing when the reply fails", async () => {
    serve();
    const serveRest = mocks.fetchApi.getMockImplementation();
    mocks.fetchApi.mockImplementation((path, options) =>
      String(path).endsWith("/reply") ? Promise.reject(new Error("offline")) : serveRest(path, options),
    );
    const onReplied = vi.fn();
    render(<Panel onReplied={onReplied} />);

    const card = (await screen.findByText("Comment on s-1")).closest(".dashboard-card");
    await sendReply(card, "Yes");

    expect(await within(card).findByText("Failed to send reply. Please try again.")).toBeInTheDocument();
    expect(onReplied).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx`

Expected:
- "tells the dashboard once a reply is saved…" FAILS: `onReplied` is never called.
- "says nothing when the reply fails" PASSES; it is a guard.

- [ ] **Step 3: Add `onReplied`**

In `TripSlideOver.jsx`, replace the doc comment and signature start:

```jsx
/**
 * `returnFocusRef` (optional) names where focus goes on close when the element
 * that opened the panel has left the page, e.g. a poll dropped its row while
 * the panel was open. Without it, focus is only returned to a surviving opener.
 */
export default function TripSlideOver({
  isOpen,
  onClose,
  agencyId,
  tripId,
  tripTitle = "Trip",
  subtitle = null,
  onOpenFull,
  returnFocusRef = undefined,
}) {
```

with:

```jsx
/**
 * `returnFocusRef` (optional) names where focus goes on close when the element
 * that opened the panel has left the page, e.g. a poll dropped its row while
 * the panel was open. Without it, focus is only returned to a surviving opener.
 * `onReplied(commentId)` (optional) runs once a reply is saved, so the
 * dashboard can reload what still needs the agent.
 */
export default function TripSlideOver({
  isOpen,
  onClose,
  agencyId,
  tripId,
  tripTitle = "Trip",
  subtitle = null,
  onOpenFull,
  returnFocusRef = undefined,
  onReplied = undefined,
}) {
```

and replace:

```jsx
  // Optimistic reply update — avoids a full refetch on send
  const handleReplySent = useCallback((commentId, content) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              agencyReply: content,
              agencyRepliedAt: new Date().toISOString(),
              status: "ADDRESSED",
            }
          : c,
      ),
    );
  }, []);
```

with:

```jsx
  // Optimistic reply update — avoids a full refetch on send
  const handleReplySent = useCallback(
    (commentId, content) => {
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                agencyReply: content,
                agencyRepliedAt: new Date().toISOString(),
                status: "ADDRESSED",
              }
            : c,
        ),
      );
      onReplied?.(commentId);
    },
    [onReplied],
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx tests/trip-slide-over-focus.test.jsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx" tests/trip-slide-over-comments.test.jsx
git commit -m "feat(dashboard): report a saved reply from the trip slide-over" -m "onReplied(commentId) runs after a reply succeeds, so the dashboard can reload the to-do list and the calendar." -- "app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx" tests/trip-slide-over-comments.test.jsx
```

---

### Task 11: A minute clock and shared "time ago" helpers (client)

**Why:**

- **Time format:** the card needs "2h ago" on screen and "2 hours ago" for screen readers.
- **Hydration:** the server's clock isn't the browser's, so the times must wait for the browser, just as the calendar's dates do.
- **DRY:** `MyWorkColumn` already has the "2h ago" helper. Move it to a shared module with the same output.

**Files:**
- Modify: `Voyage-Client/app/hooks/useLocalClock.js`
- Create: `Voyage-Client/app/lib/relativeTime.js`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx:3-5, 62-74, 89`
- Create: `Voyage-Client/tests/relative-time.test.js`, `Voyage-Client/tests/use-now-minute.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/relative-time.test.js`:

```js
import { describe, expect, it } from "vitest";
import { timeAgo, timeAgoSpoken } from "../app/lib/relativeTime.js";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

describe("timeAgo", () => {
  it.each([
    [20_000, "Just now"],
    [5 * 60_000, "5m ago"],
    [2 * 3_600_000, "2h ago"],
    [3 * 86_400_000, "3d ago"],
  ])("%i ms ago reads %s", (ms, text) => {
    expect(timeAgo(ago(ms), NOW)).toBe(text);
  });

  it("treats a time slightly in the future as just now", () => {
    expect(timeAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe("Just now");
  });

  it("returns an empty string for no date and the raw text for an unreadable one", () => {
    expect(timeAgo(null, NOW)).toBe("");
    expect(timeAgo("not a date", NOW)).toBe("not a date");
  });
});

describe("timeAgoSpoken", () => {
  it.each([
    [20_000, "just now"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3_600_000, "1 hour ago"],
    [2 * 3_600_000, "2 hours ago"],
    [86_400_000, "1 day ago"],
    [3 * 86_400_000, "3 days ago"],
  ])("%i ms ago reads %s", (ms, text) => {
    expect(timeAgoSpoken(ago(ms), NOW)).toBe(text);
  });
});
```

Create `tests/use-now-minute.test.jsx`:

```jsx
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNowMinute } from "../app/hooks/useLocalClock.js";

function Clock() {
  const now = useNowMinute();
  return <p>{now === null ? "no clock" : new Date(now).toISOString()}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:30.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNowMinute", () => {
  it("renders nothing time-based on the server", () => {
    expect(renderToString(<Clock />)).toContain("no clock");
  });

  it("gives the browser's time, floored to the minute", () => {
    render(<Clock />);
    expect(screen.getByText("2026-10-04T12:00:00.000Z")).toBeInTheDocument();
  });

  it("moves on when the minute turns", () => {
    render(<Clock />);
    act(() => {
      vi.advanceTimersByTime(30_100);
    });
    expect(screen.getByText("2026-10-04T12:01:00.000Z")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/relative-time.test.js tests/use-now-minute.test.jsx`

Expected FAILs:
- **relative-time:** the file can't import `../app/lib/relativeTime.js`.
- **use-now-minute:** every test, with `useNowMinute is not a function`.

- [ ] **Step 3: Add the minute clock**

In `app/hooks/useLocalClock.js`, replace:

```js
const getHour = () => new Date().getHours();
const getNothing = () => null;
```

with:

```js
const getHour = () => new Date().getHours();
const getNothing = () => null;

const MINUTE_MS = 60_000;
const untilNextMinute = (now) => MINUTE_MS - (now.getTime() % MINUTE_MS) + SLACK_MS;
const subscribeToMinute = subscribeEvery(untilNextMinute);
// Floored to the minute, so React sees one stable value for the whole minute.
const getMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
```

and at the end of the file, add:

```js
/** The current time in ms, floored to the minute and updated each minute; null until the browser has it. */
export function useNowMinute() {
  return useSyncExternalStore(subscribeToMinute, getMinute, getNothing);
}
```

- [ ] **Step 4: Create the helpers**

Create `app/lib/relativeTime.js`:

```js
/**
 * How long ago something happened, for dashboard rows. `now` is a timestamp in
 * ms: pass the browser's clock (useNowMinute) when the page is server-rendered,
 * so the server's HTML and the browser's first render agree.
 */

const MINUTE = 60_000;

/** Whole minutes, hours and days since `isoString`; null when it can't be read. */
function elapsed(isoString, now) {
  const diff = now - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return null;
  // A clock a little ahead of the server's makes the difference negative.
  const minutes = Math.max(0, Math.floor(diff / MINUTE));
  return { minutes, hours: Math.floor(minutes / 60), days: Math.floor(minutes / (60 * 24)) };
}

/** "Just now", "5m ago", "2h ago", "3d ago"; "" for no date, the raw string if it can't be read. */
export function timeAgo(isoString, now) {
  if (!isoString) return "";
  const span = elapsed(isoString, now);
  if (!span) return isoString;
  if (span.minutes < 1) return "Just now";
  if (span.minutes < 60) return `${span.minutes}m ago`;
  if (span.hours < 24) return `${span.hours}h ago`;
  return `${span.days}d ago`;
}

const unitsAgo = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;

/** The same in words, for screen readers: "just now", "5 minutes ago", "1 hour ago", "3 days ago". */
export function timeAgoSpoken(isoString, now) {
  if (!isoString) return "";
  const span = elapsed(isoString, now);
  if (!span) return isoString;
  if (span.minutes < 1) return "just now";
  if (span.minutes < 60) return unitsAgo(span.minutes, "minute");
  if (span.hours < 24) return unitsAgo(span.hours, "hour");
  return unitsAgo(span.days, "day");
}
```

- [ ] **Step 5: Use it in MyWorkColumn**

In `MyWorkColumn.jsx`, replace:

```jsx
import { useId } from "react";
import { useRouter } from "next/navigation";
import HeroContinueCard from "./HeroContinueCard";
```

with:

```jsx
import { useId } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/app/lib/relativeTime";
import HeroContinueCard from "./HeroContinueCard";
```

Delete the local helper:

```jsx
/** "Just now", "5m ago", "2h ago", "3d ago"; the raw string if it can't be read. */
function relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return isoString;
  // A clock a little ahead of the server's makes the difference negative.
  const minutes = Math.max(0, Math.floor(diff / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

Then replace:

```jsx
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{relativeTime(trip.updatedAt)}</span>
```

with:

```jsx
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{timeAgo(trip.updatedAt, Date.now())}</span>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/relative-time.test.js tests/use-now-minute.test.jsx tests/dashboard-polish.test.jsx tests/dashboard-hydration.test.jsx tests/agency-calendar.test.jsx`

Expected: PASS (all five files). `dashboard-polish`'s "MyWorkColumn recent trip times" tests prove the move kept the output.

- [ ] **Step 7: Commit**

```bash
git add app/hooks/useLocalClock.js app/lib/relativeTime.js "app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx" tests/relative-time.test.js tests/use-now-minute.test.jsx
git commit -m "feat(dashboard): add a minute clock and shared time-ago helpers" -m "useNowMinute gives the browser's time (null on the server) and ticks each minute. timeAgo ('2h ago', moved from MyWorkColumn, same output) and timeAgoSpoken ('2 hours ago') serve dashboard rows." -- app/hooks/useLocalClock.js app/lib/relativeTime.js "app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx" tests/relative-time.test.js tests/use-now-minute.test.jsx
```

---

### Task 12: The Recently viewed card (client)

**Why:** spec §5. The card lists up to five trips, newest view first, and shows three before "Show all". Each row is a button that opens the trip.

**Files:**
- Create: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/RecentlyViewedPanel.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/EmptyState.jsx:1-40`
- Create: `Voyage-Client/tests/recently-viewed-panel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/recently-viewed-panel.test.jsx`:

```jsx
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecentlyViewedPanel from "../app/agency/[agencyId]/components/dashboard/widgets/RecentlyViewedPanel.jsx";

const NOW = new Date("2026-09-27T04:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const VIEWS = [
  { tripId: "t1", tripTitle: "Kyoto Autumn Escape", clientName: "Maria Santos", viewCount: 4, lastViewedAt: hoursAgo(5) },
  { tripId: "t2", tripTitle: "Palawan Family Trip", clientName: "Lim Family", viewCount: 2, lastViewedAt: hoursAgo(96) },
  { tripId: "t3", tripTitle: "Boracay Barkada Weekend", clientName: null, viewCount: 1, lastViewedAt: hoursAgo(144) },
  { tripId: "t4", tripTitle: "Cebu Island Hop", clientName: "Garcia Family", viewCount: 1, lastViewedAt: hoursAgo(288) },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const panel = () => screen.getByRole("region", { name: "Recently viewed" });
const rows = () => within(panel()).getAllByRole("button", { name: /views?,/ });

describe("RecentlyViewedPanel", () => {
  it("lists the three newest views, each naming the trip, client, views and time", () => {
    render(<RecentlyViewedPanel views={VIEWS} onOpenTrip={vi.fn()} />);

    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "Kyoto Autumn Escape, Maria Santos, 4 views, last viewed 5 hours ago",
      "Palawan Family Trip, Lim Family, 2 views, last viewed 4 days ago",
      "Boracay Barkada Weekend, 1 view, last viewed 6 days ago",
    ]);
    expect(within(rows()[0]).getByText("4 views")).toBeInTheDocument();
    expect(within(rows()[0]).getByText("5h ago")).toBeInTheDocument();
    expect(within(panel()).getByText("Last 30 days")).toBeInTheDocument();
  });

  it("shows the rest behind Show all, and hides them again", () => {
    render(<RecentlyViewedPanel views={VIEWS} onOpenTrip={vi.fn()} />);

    const toggle = within(panel()).getByRole("button", { name: "Show all (4)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(panel()).getByRole("button", { name: /^Cebu Island Hop,/ })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Show fewer" }));
    expect(within(panel()).queryByRole("button", { name: /^Cebu Island Hop,/ })).not.toBeInTheDocument();
  });

  it("opens the trip a row names", () => {
    const onOpenTrip = vi.fn();
    render(<RecentlyViewedPanel views={VIEWS} onOpenTrip={onOpenTrip} />);

    fireEvent.click(within(panel()).getByRole("button", { name: /^Palawan Family Trip,/ }));
    expect(onOpenTrip).toHaveBeenCalledWith("t2", "Palawan Family Trip", "Lim Family");
  });

  it("says when no client has looked in 30 days", () => {
    render(<RecentlyViewedPanel views={[]} onOpenTrip={vi.fn()} />);

    expect(within(panel()).getByText("No client views in the last 30 days")).toBeInTheDocument();
    expect(within(panel()).getByText("Views show up here when a client opens a shared itinerary link.")).toBeInTheDocument();
  });

  it("gives its rows the dashboard's tile style, press feedback and a focus ring", () => {
    render(<RecentlyViewedPanel views={VIEWS} onOpenTrip={vi.fn()} />);

    const row = within(panel()).getByRole("button", { name: /^Kyoto Autumn Escape,/ });
    expect(row.className).toContain("frame-tile");
    expect(row.className).toContain("active:scale-[0.97]");
    expect(row.className).toContain("focus-visible:ring-2");
  });

  it("hydrates without a mismatch, then shows times by the browser's clock", async () => {
    const element = <RecentlyViewedPanel views={VIEWS} onOpenTrip={() => {}} />;
    vi.setSystemTime(new Date(NOW.getTime() - 3 * 3_600_000)); // the server's clock is 3h behind
    const html = renderToString(element);
    expect(html).not.toContain(" ago");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    vi.setSystemTime(NOW);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const problems = [];
    vi.spyOn(console, "error").mockImplementation((...args) => problems.push(args.map(String).join(" ")));
    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: (error) => problems.push(String(error?.message ?? error)) });
    });

    expect(problems).toEqual([]);
    expect(container).toHaveTextContent("5h ago");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/recently-viewed-panel.test.jsx`
Expected: FAIL. The file can't import `RecentlyViewedPanel.jsx`.

- [ ] **Step 3: Add the empty state**

In `EmptyState.jsx`, replace:

```js
 * Variants: worklist, kpi, funnel, ratings, staff-hero, activity
```

with:

```js
 * Variants: worklist, kpi, funnel, ratings, views, staff-hero, activity
```

and replace:

```js
  ratings: {
    heading: 'Reviews appear after trips complete.',
    body: 'First post-trip emails fire 2 days after the trip ends.',
    cta: null,
  },
```

with:

```js
  ratings: {
    heading: 'Reviews appear after trips complete.',
    body: 'First post-trip emails fire 2 days after the trip ends.',
    cta: null,
  },
  views: {
    heading: 'No client views in the last 30 days',
    body: 'Views show up here when a client opens a shared itinerary link.',
    cta: null,
  },
```

- [ ] **Step 4: Create the card**

Create `app/agency/[agencyId]/components/dashboard/widgets/RecentlyViewedPanel.jsx`:

```jsx
"use client";

import { useId, useState } from "react";
import { useNowMinute } from "@/app/hooks/useLocalClock";
import { timeAgo, timeAgoSpoken } from "@/app/lib/relativeTime";
import EmptyState from "./EmptyState";
import KindIcon from "./KindIcon";

/** Rows shown before "Show all". */
const VISIBLE = 3;
/** Buttons dip to 97% while pressed. `scale` is the property Tailwind's scale utilities set, so it must be the one transitioned. */
const PRESS = "transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.97]";

const viewsText = (count) => (count === 1 ? "1 view" : `${count} views`);

/**
 * Itineraries clients opened in the last 30 days, newest view first (the
 * server sends at most five). Each row opens its trip with
 * `onOpenTrip(tripId, tripTitle, clientName)`. Times wait for the browser's
 * clock, so server-rendered HTML matches the browser's first render. The
 * dashboard's period switcher doesn't apply here.
 */
export default function RecentlyViewedPanel({ views = [], onOpenTrip }) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const now = useNowMinute();
  const shown = expanded ? views : views.slice(0, VISIBLE);

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-sans text-[13px] font-semibold tracking-normal text-text-primary">
          Recently viewed
        </h3>
        <span className="text-[12px] text-text-muted">Last 30 days</span>
      </div>

      {views.length === 0 ? (
        <div className="mt-1">
          <EmptyState variant="views" compact />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {shown.map((view) => {
            const ago = now === null ? null : timeAgo(view.lastViewedAt, now);
            const spokenAgo = now === null ? null : timeAgoSpoken(view.lastViewedAt, now);
            const label = [view.tripTitle, view.clientName, viewsText(view.viewCount), spokenAgo && `last viewed ${spokenAgo}`]
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={view.tripId}
                type="button"
                aria-label={label}
                onClick={() => onOpenTrip?.(view.tripId, view.tripTitle, view.clientName)}
                className={`frame-tile flex w-full flex-col gap-1 rounded-[12px] px-3 py-2 text-left hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${PRESS}`}
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold leading-snug text-text-primary">{view.tripTitle}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-text-muted">
                    <KindIcon kind="client_viewed" className="h-3.5 w-3.5" />
                    {viewsText(view.viewCount)}
                  </span>
                </span>
                <span className="flex items-end justify-between gap-2">
                  <span className="truncate text-[12px] text-text-muted">{view.clientName ?? ""}</span>
                  {ago ? (
                    <time dateTime={view.lastViewedAt} className="shrink-0 text-[12px] tabular-nums text-text-muted">
                      {ago}
                    </time>
                  ) : null}
                </span>
              </button>
            );
          })}
          {views.length > VISIBLE ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="min-h-[44px] self-start rounded-lg px-1 text-[13px] font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              {expanded ? "Show fewer" : `Show all (${views.length})`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/recently-viewed-panel.test.jsx tests/dashboard-polish.test.jsx tests/theme-safe-classes.test.js`
Expected: PASS (all three files).

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/RecentlyViewedPanel.jsx" "app/agency/[agencyId]/components/dashboard/widgets/EmptyState.jsx" tests/recently-viewed-panel.test.jsx
git commit -m "feat(dashboard): add the Recently viewed card" -m "Lists the itineraries clients opened in the last 30 days, newest first, three before Show all; each row opens its trip and names trip, client, views and time for screen readers. Times wait for the browser's clock." -- "app/agency/[agencyId]/components/dashboard/widgets/RecentlyViewedPanel.jsx" "app/agency/[agencyId]/components/dashboard/widgets/EmptyState.jsx" tests/recently-viewed-panel.test.jsx
```

---

### Task 13: Put the card on both dashboards and refresh after a reply (client)

**Why:**

- **Placement:** owners see the card above "Latest reviews", and staff see it above "Recent trips". Its rows open the trip slide-over, like calendar items do.
- **Reply refresh:** a reply from the slide-over reloads the dashboard data and the calendar at once.
- **Older server:** a payload without `recentViews` hides the card.

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx`
- Test: `Voyage-Client/tests/insights-column.test.jsx`, `tests/dashboard-server-contract.test.jsx`
- Create: `Voyage-Client/tests/dashboard-reply-refresh.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tests/insights-column.test.jsx`, inside `describe("InsightsColumn", ...)`, add:

```jsx
  it("lists recently viewed itineraries above the latest reviews", () => {
    const column = renderColumn(fixtures.ownerBusy);

    const viewed = within(column).getByRole("region", { name: "Recently viewed" });
    const reviews = within(column).getByRole("region", { name: "Latest reviews" });
    expect(viewed.compareDocumentPosition(reviews) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(viewed).getByRole("button", { name: /^Kyoto Autumn Escape, Maria Santos, 4 views/ })).toBeInTheDocument();
  });

  it("opens a viewed trip with the handler it is given", () => {
    const onOpenViewedTrip = vi.fn();
    const column = renderColumn(fixtures.ownerBusy, { onOpenViewedTrip });

    fireEvent.click(within(column).getByRole("button", { name: /^Kyoto Autumn Escape,/ }));
    expect(onOpenViewedTrip).toHaveBeenCalledWith("trip-kyoto", "Kyoto Autumn Escape", "Maria Santos");
  });

  it("leaves the card out for a server that doesn't send recent views", () => {
    const older = { ...fixtures.ownerBusy };
    delete older.recentViews;
    renderColumn(older);

    expect(screen.queryByRole("region", { name: "Recently viewed" })).not.toBeInTheDocument();
  });
```

In `tests/dashboard-server-contract.test.jsx`, inside `describe("Owner dashboard with real server payloads", ...)`, add:

```jsx
  it("shows the itineraries clients opened most recently", () => {
    renderOwner(fixtures.ownerBusy);

    const viewed = screen.getByRole("region", { name: "Recently viewed" });
    const rows = within(viewed).getAllByRole("button", { name: /views?,/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Kyoto Autumn Escape, Maria Santos, 4 views, last viewed 5 hours ago",
      "Palawan Family Trip, Lim Family, 2 views, last viewed 4 days ago",
      "Boracay Barkada Weekend, Dela Cruz Barkada, 2 views, last viewed 6 days ago",
    ]);
    expect(within(viewed).getByRole("button", { name: "Show all (4)" })).toBeInTheDocument();
  });
```

Inside `describe("Staff dashboard with real server payloads", ...)`, add:

```jsx
  it("shows recently viewed itineraries from the staff member's own trips only", () => {
    renderStaff();

    const viewed = screen.getByRole("region", { name: "Recently viewed" });
    expect(within(viewed).getAllByRole("button", { name: /views?,/ }).map((row) => row.getAttribute("aria-label"))).toEqual([
      "Kyoto Autumn Escape, Maria Santos, 4 views, last viewed 5 hours ago",
      "Palawan Family Trip, Lim Family, 2 views, last viewed 4 days ago",
    ]);
  });
```

Create `tests/dashboard-reply-refresh.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fixtures from "./fixtures/dashboard-payloads.json";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../app/components/icons/index.js", () => ({
  ChatIcon: () => null,
  CloseIcon: () => null,
  ReplyIcon: () => null,
}));

vi.mock("../app/lib/api/client.js", () => ({
  API_URL: "/api",
  fetchApi: (...args) => mocks.fetchApi(...args),
}));

import OwnerOverview from "../app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx";
import StaffMyWork from "../app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx";
import { resetCalendarCacheForTests } from "../app/hooks/useCalendarEvents.js";

const EMPTY_CALENDAR = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T02:00:00.000Z",
  tripsWithoutDates: 0,
  trips: [],
  events: [],
};

const PENDING_COMMENT = {
  id: "comment-1",
  content: "Can we swap the day 2 lunch spot?",
  status: "PENDING",
  authorName: "Maria",
  createdAt: "2026-09-26T22:00:00.000Z",
};

const isCalendar = (path) => String(path).includes("/dashboard/calendar");
const isDashboard = (path) => /\/dashboard\?/.test(String(path));
const calendarCalls = () => mocks.fetchApi.mock.calls.filter(([path]) => isCalendar(path));
const dashboardCalls = () => mocks.fetchApi.mock.calls.filter(([path]) => isDashboard(path));

function serve(payload) {
  mocks.fetchApi.mockImplementation((path) => {
    const url = String(path);
    if (isCalendar(url)) return Promise.resolve(EMPTY_CALENDAR);
    if (isDashboard(url)) return Promise.resolve(payload);
    if (url.includes("/shares?tripId=")) return Promise.resolve({ shares: [{ id: "share-1" }] });
    if (url.endsWith("/shares/share-1/comments")) return Promise.resolve({ comments: [PENDING_COMMENT] });
    if (url.endsWith("/comments/comment-1/reply")) return Promise.resolve({ comment: { ...PENDING_COMMENT, status: "ADDRESSED" } });
    return new Promise(() => {});
  });
}

const DASHBOARDS = [
  { name: "owner", payload: fixtures.ownerBusy, ui: (props) => <OwnerOverview agencyId="agency-1" {...props} /> },
  { name: "staff", payload: fixtures.staff, ui: (props) => <StaffMyWork agencyId="agency-1" {...props} /> },
];

beforeEach(() => {
  mocks.fetchApi.mockReset();
  resetCalendarCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(DASHBOARDS)("$name dashboard after a reply from the trip panel", ({ ui, payload }) => {
  it("reloads the to-do list and the calendar straight away", async () => {
    serve(payload);
    render(ui({ initialData: payload }));
    await waitFor(() => expect(calendarCalls().length).toBeGreaterThan(0));

    const needsYou = screen.getByRole("region", { name: "Needs you today" });
    fireEvent.click(within(needsYou).getAllByRole("button", { name: "Reply" })[0]);
    const panel = await screen.findByRole("dialog", { name: /^Trip comments:/ });
    fireEvent.click(await within(panel).findByRole("button", { name: "Reply" }));
    fireEvent.change(within(panel).getByPlaceholderText("Write a reply…"), { target: { value: "Yes, we can." } });

    const dashboardBefore = dashboardCalls().length;
    const calendarBefore = calendarCalls().length;
    fireEvent.click(within(panel).getByRole("button", { name: "Send Reply" }));

    await waitFor(() => expect(dashboardCalls().length).toBe(dashboardBefore + 1));
    await waitFor(() => expect(calendarCalls().length).toBe(calendarBefore + 1));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/insights-column.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-reply-refresh.test.jsx`

Expected FAILs:
- **insights-column:** "lists recently viewed…" and "opens a viewed trip…" fail because there is no region. "leaves the card out…" PASSES.
- **dashboard-server-contract:** both new tests; there is no "Recently viewed" region.
- **dashboard-reply-refresh:** both cases time out waiting for the extra dashboard and calendar requests.

- [ ] **Step 3: Mount the card in the Insights column**

In `InsightsColumn.jsx`, replace:

```jsx
import RatingsPanel from "./RatingsPanel";
```

with:

```jsx
import RatingsPanel from "./RatingsPanel";
import RecentlyViewedPanel from "./RecentlyViewedPanel";
```

Replace:

```jsx
/**
 * The owner dashboard's right column: period switcher, four KPI tiles, trip
 * progress and the latest reviews. The period label follows the payload (not
 * the switcher), which runs ahead of the data while a refetch is in flight.
 */
export default function InsightsColumn({ data, period, onPeriodChange, isFetching = false, agencyId }) {
```

with:

```jsx
/**
 * The owner dashboard's right column: period switcher, four KPI tiles, trip
 * progress, the recently viewed itineraries and the latest reviews. The period
 * label follows the payload (not the switcher), which runs ahead of the data
 * while a refetch is in flight. Recently viewed ignores the period, and is
 * left out when the payload has no `recentViews` (an older server).
 */
export default function InsightsColumn({ data, period, onPeriodChange, isFetching = false, agencyId, onOpenViewedTrip }) {
```

and replace:

```jsx
      <RatingsPanel reviews={data?.recentReviews ?? []} />
```

with:

```jsx
      {Array.isArray(data?.recentViews) ? (
        <RecentlyViewedPanel views={data.recentViews} onOpenTrip={onOpenViewedTrip} />
      ) : null}

      <RatingsPanel reviews={data?.recentReviews ?? []} />
```

- [ ] **Step 4: Mount the card in the staff column**

In `MyWorkColumn.jsx`, replace:

```jsx
import HeroContinueCard from "./HeroContinueCard";
```

with:

```jsx
import HeroContinueCard from "./HeroContinueCard";
import RecentlyViewedPanel from "./RecentlyViewedPanel";
```

Replace:

```jsx
/**
 * The staff dashboard's right column: continue the latest trip, the trips by
 * status (each count opens the filtered list), and up to three recent trips.
 */
export default function MyWorkColumn({ hero, recent = [], pipeline, agencyId, onOpenTrip, onOpenItineraries }) {
```

with:

```jsx
/**
 * The staff dashboard's right column: continue the latest trip, the trips by
 * status (each count opens the filtered list), the recently viewed
 * itineraries (rows call `onOpenViewedTrip`; left out without `recentViews`)
 * and up to three recent trips.
 */
export default function MyWorkColumn({
  hero,
  recent = [],
  pipeline,
  agencyId,
  onOpenTrip,
  onOpenItineraries,
  recentViews,
  onOpenViewedTrip,
}) {
```

and replace:

```jsx
      {recent.length > 0 ? (
        <div>
          <h3 className="mb-2 font-sans text-[13px] font-semibold tracking-normal text-text-primary">Recent trips</h3>
```

with:

```jsx
      {Array.isArray(recentViews) ? <RecentlyViewedPanel views={recentViews} onOpenTrip={onOpenViewedTrip} /> : null}

      {recent.length > 0 ? (
        <div>
          <h3 className="mb-2 font-sans text-[13px] font-semibold tracking-normal text-text-primary">Recent trips</h3>
```

- [ ] **Step 5: Wire the owner dashboard**

In `OwnerOverview.jsx`, replace:

```jsx
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }
```

with:

```jsx
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }
  // Bumped after a reply so the calendar reloads at once, not at its next poll.
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
```

Replace:

```jsx
  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openSlideOver(item.tripId, item.tripTitle, item.clientName);
    else openInCommandCenter(item.tripId);
  }
```

with:

```jsx
  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openSlideOver(item.tripId, item.tripTitle, item.clientName);
    else openInCommandCenter(item.tripId);
  }

  // A reply changes what needs the agent: reload the to-do list and the calendar now.
  function handleReplied() {
    refetch().catch(() => {}); // a failed refetch already shows the stale-data banner
    setCalendarRefreshKey((key) => key + 1);
  }
```

Replace:

```jsx
          <AgencyCalendar agencyId={agencyId} onOpenTrip={openSlideOver} />
```

with:

```jsx
          <AgencyCalendar agencyId={agencyId} onOpenTrip={openSlideOver} refreshKey={calendarRefreshKey} />
```

Replace:

```jsx
            isFetching={isFetching}
            agencyId={agencyId}
          />
```

with:

```jsx
            isFetching={isFetching}
            agencyId={agencyId}
            onOpenViewedTrip={openSlideOver}
          />
```

Replace:

```jsx
        returnFocusRef={needsYouRef}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openInCommandCenter(tripId);
        }}
      />
```

with:

```jsx
        returnFocusRef={needsYouRef}
        onReplied={handleReplied}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openInCommandCenter(tripId);
        }}
      />
```

- [ ] **Step 6: Wire the staff dashboard**

In `StaffMyWork.jsx`, replace:

```jsx
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }
```

with:

```jsx
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }
  // Bumped after a reply so the calendar reloads at once, not at its next poll.
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
```

Replace:

```jsx
  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openTripSlide(item.tripId, item.tripTitle, item.clientName);
    else openTrip(item.tripId);
  }
```

with:

```jsx
  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openTripSlide(item.tripId, item.tripTitle, item.clientName);
    else openTrip(item.tripId);
  }

  // A reply changes what needs the agent: reload the to-do list and the calendar now.
  function handleReplied() {
    refetch().catch(() => {}); // a failed refetch already shows the stale-data banner
    setCalendarRefreshKey((key) => key + 1);
  }
```

Replace:

```jsx
          <AgencyCalendar agencyId={agencyId} onOpenTrip={openTripSlide} />
```

with:

```jsx
          <AgencyCalendar agencyId={agencyId} onOpenTrip={openTripSlide} refreshKey={calendarRefreshKey} />
```

Replace:

```jsx
            onOpenTrip={openTrip}
            onOpenItineraries={onOpenItineraries}
          />
```

with:

```jsx
            onOpenTrip={openTrip}
            onOpenItineraries={onOpenItineraries}
            recentViews={data.recentViews}
            onOpenViewedTrip={openTripSlide}
          />
```

Replace:

```jsx
        returnFocusRef={needsYouRef}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openTrip(tripId);
        }}
      />
```

with:

```jsx
        returnFocusRef={needsYouRef}
        onReplied={handleReplied}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openTrip(tripId);
        }}
      />
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/insights-column.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-reply-refresh.test.jsx tests/dashboard-independent-loading.test.jsx tests/dashboard-hydration.test.jsx tests/dashboard-polish.test.jsx`
Expected: PASS (all six files).

- [ ] **Step 8: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx" "app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx" "app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx" "app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx" tests/insights-column.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-reply-refresh.test.jsx
git commit -m "feat(dashboard): show Recently viewed and refresh after a reply" -m "Owners see the card above Latest reviews, staff above Recent trips (their own trips); rows open the trip panel. A reply from the panel reloads the dashboard data and the calendar at once." -- "app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx" "app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx" "app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx" "app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx" tests/insights-column.test.jsx tests/dashboard-server-contract.test.jsx tests/dashboard-reply-refresh.test.jsx
```

---

### Task 14: Verify everything

**Files:** none (verification only; commit only if a fix is needed).

- [ ] **Step 1: Full client test suite**

Run (in `Voyage-Client/`): `npx vitest run --pool=threads`

Expected:
- Only the 8 baseline files fail: `agent-command-center-places` (1 test), plus the 7 that fail to load from `app/components/icons/index.js`.
- Every new and changed test file passes.

- [ ] **Step 2: Client production build**

Run: `npx next build`
Expected: the build completes with no errors.

- [ ] **Step 3: Full server test suite and type-check**

Run (in `Voyage-Server/`): `npx vitest run`, then `npm run build`
Expected: only the 4 baseline files fail, and `tsc` exits 0.

- [ ] **Step 4: Browser check (owner account, light and dark)**

Restart the backend dev server first. Then, on `http://localhost:3000`, at 375px, 1024px and 1280px wide:

1. **Calendar tiles:**
   - Days with an unanswered comment show a red speech bubble.
   - An upcoming link expiry shows an amber clock.
   - A trip starting within a week shows a green briefcase on its first day.
   - Quiet days show grey `·N`.
   - Nothing overlaps the day number. On phones the icon sits under it.
   - The legend lists all six entries and wraps on narrow screens.
2. **Screen reader:** a day tile's accessible name reads like "Monday, October 5: 1 comment needs a reply, 2 other updates". Check it in the accessibility tree.
3. **Popover:** items that need you come first, and badge colours match the tile icons.
4. **Recently viewed:**
   - On the owner dashboard, the card sits above "Latest reviews".
   - The rows show trip, client, views and "Xh ago", and a row opens the trip panel.
   - "Show all" appears when more than three trips are listed.
5. **Reply clears the icon:** open a comment from the calendar or "Needs you today", and reply in the panel. The red bubble and the to-do row disappear without a page reload.
6. **Dark mode:** repeat 1 and 4.
7. **Staff (if a staff account exists):** the card sits above "Recent trips" and lists only that person's trips.
