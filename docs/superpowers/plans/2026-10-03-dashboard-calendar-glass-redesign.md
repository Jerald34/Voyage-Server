# Dashboard Calendar + Glass Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved redesign:
- a glass app frame with a slim icon rail;
- a one-page Dashboard: greeting, "Needs you today", a calendar of trips and client activity, and an Insights column;
- a new calendar read endpoint behind it.

The Command Center stays exactly as it is.

**Architecture:**
- **Server:** adds `GET /agencies/:agencyId/dashboard/calendar` as three small units in the existing dashboard module:
  - a pure payload builder (`calendar.ts`);
  - a Prisma repository (`calendarRepository.ts`);
  - a cached service (`calendarService.ts`).
- **Client:**
  - adds `frame-*` design tokens, rewrites the sidebar as an icon rail with an account menu, and wraps the app in a glass frame;
  - moves Team into Settings;
  - rebuilds `OwnerOverview` and `StaffMyWork` from new widgets (`NeedsYouList`, `AgencyCalendar`, `InsightsColumn`, `MyWorkColumn`);
  - feeds the widgets from a pure date helper (`calendarDays.js`) and a fetch hook (`useCalendarEvents.js`).

**Tech Stack:**
- Server (TypeScript): Express 5, Prisma 7, Zod, Vitest and Supertest.
- Client (JavaScript): Next 16, React 19, Tailwind CSS 4, Vitest and Testing Library.

**Spec:** `Voyage-Server/docs/superpowers/specs/2026-10-03-dashboard-calendar-glass-redesign-design.md`

---

## Before you start

- **Repos and branch:** both repos sit in `C:\Users\dever\OneDrive\Documents\Voyage\` (`Voyage-Server` and `Voyage-Client`). Each is on branch `feat/dashboard-calendar`, created from `staging`.
- **Shell:** commands are for Git Bash. Run each from the repo named in the task's **Repo:** line.
- **Commit at the end of every task.** The user switches branches in GitHub Desktop, which stashes uncommitted files, so never leave work uncommitted between tasks.
- **Commit messages:** Conventional Commits, for example `feat(dashboard): …`. Never add a `Co-Authored-By` line.
- **One test file:**
  - server: `npx vitest run tests/<file>`
  - client: `npx vitest run --pool=threads tests/<file>`
- **Server hot reload** is unreliable because the repo lives in OneDrive. Restart `npm run dev` by hand after server edits when testing manually.

## Deviations from the spec (decided while planning)

1. **New `frame-*` tokens and utilities instead of `--glass-panel`, `--glass-tile` and `--glass-border`.** `--glass-*` and the `glass-panel` utility already exist, and the Command Center chat panel uses them, so redefining them would restyle the Command Center.
2. **Semantic colours reuse existing tokens.** Good and bad deltas use `--success`/`--danger` (`--color-status-success` and `--color-status-danger`). Link-expiry dots use `--color-status-warning`; activity dots use `--color-text-muted`. Only `--color-secondary-strong` and `--color-on-secondary-strong` are new colours.
3. **The calendar server code lives in new files** (`calendar.ts`, `calendarRepository.ts`, `calendarService.ts`) instead of extending `dashboardRepository.ts` and `dashboardService.ts`. This keeps the dashboard's fake repositories and tests untouched.
4. **Worklist rows keep today's behaviour and labels.**
   - Comment rows open the slide-over; other rows open the trip in the Command Center.
   - Labels stay "Reply", "Extend", "Nudge", "Resume", "Open trip".
   - Calendar popover actions open the slide-over: "Reply" for comments, "Open trip" for everything else. There are no "Extend" or "View review" actions, because those flows don't exist.
5. **The empty to-do copy stays the existing EmptyState:** "All caught up." / "Nothing needs your attention right now."
6. **KPI sparklines are removed.** The dashboard's `widgets/Sparkline.jsx` is deleted; the payload still carries the data.
7. **The staff "Starting soon" cards are removed.** Those trips now appear on the calendar and in Needs you ("Starts in N days").
8. **Popovers and the account menu use a solid surface (`frame-popover`), not blur,** for maximum text contrast.
9. **The rail logo is `/icon.svg`,** the Hops symbol already in `public/`.
10. **The Team panel embeds `TeamPage` through a new `embedded` prop.** The Invite button also moves to the strong terracotta, a critique fix.

## File structure

**Voyage-Server** (`src/modules/dashboard/`)

| File | Change | Responsibility |
|---|---|---|
| `dashboardTypes.ts` | modify | `CalendarPayload`, `CalendarTrip`, `CalendarEvent`, `CalendarEventKind` |
| `dashboardSchemas.ts` | modify | `calendarQuerySchema` (YYYY-MM-DD), `calendarPayloadSchema` |
| `calendar.ts` | create | Pure: `calendarWindow()` (range check + timezone-padded window), `buildCalendar()` (spans, events, staff scoping) |
| `calendarRepository.ts` | create | Prisma queries for one agency and window |
| `calendarService.ts` | create | `getCalendar()`: window → cache → repository → builder |
| `dashboardRoutes.ts` | modify | `GET /calendar` |
| `tests/dashboardCalendarSchemas.test.ts`, `tests/dashboardCalendar.test.ts`, `tests/calendarRepository.test.ts`, `tests/calendarService.test.ts`, `tests/dashboardCalendarRoutes.test.ts` | create | Tests |

**Voyage-Client**

| File | Change | Responsibility |
|---|---|---|
| `app/globals.css` | modify | `frame-*` tokens and utilities, `--color-secondary-strong`, streak background, fallbacks, pop-in motion |
| `app/components/trip-dashboard/layout/RailButton.jsx` | create | Icon button with tooltip (desktop) or inline label (drawer) |
| `app/components/trip-dashboard/layout/AccountMenu.jsx` | create | Avatar menu button: identity, Account settings, Sign out |
| `app/components/trip-dashboard/layout/DashboardSidebar.jsx` | rewrite | Icon rail on desktop, glass drawer on phones |
| `app/components/trip-dashboard/layout/DashboardHeader.jsx` | rewrite | Command Center header without brand and avatar; `compact` variant |
| `app/components/trip-dashboard/HomePage.jsx` | modify | Glass frame, header gating, settings focus, `viewerName` |
| `app/lib/deepLinks.js` | create | `resolveInitialView()` for `?tab=team[&invited=1]` |
| `app/page.jsx` | modify | Uses `resolveInitialView()` |
| `app/components/trip-dashboard/pages/SettingsPage.jsx` | modify | Team panel and scroll-to-team |
| `app/components/team/TeamPage.jsx` | modify | `embedded` prop; Invite button contrast |
| `app/lib/calendarDays.js` | create | Pure grid, bucketing and day-copy helpers |
| `app/hooks/useCalendarEvents.js` | create | Fetch, cache, poll calendar ranges |
| `app/agency/[agencyId]/components/dashboard/needsYouItems.js` | create | Flatten and prioritise worklists |
| `.../dashboard/widgets/KindIcon.jsx` | create | Small icon per row or event kind |
| `.../dashboard/widgets/WorklistRow.jsx` | rewrite | Compact row with kind icon |
| `.../dashboard/widgets/NeedsYouList.jsx` | create | "Needs you today" list (5 + Show all) |
| `.../dashboard/widgets/DashboardGreeting.jsx` | create | h1 greeting, summary, New trip |
| `.../dashboard/widgets/KpiTile.jsx` | rewrite | Static compact KPI tile with worded deltas |
| `.../dashboard/widgets/FunnelChart.jsx` | rewrite | Compact trip progress + biggest drop |
| `.../dashboard/widgets/RatingsPanel.jsx` | rewrite | Latest 2 reviews + expand |
| `.../dashboard/widgets/InsightsColumn.jsx` | create | Right column for owners |
| `.../dashboard/widgets/CalendarDayPopover.jsx` | create | Day details dialog |
| `.../dashboard/widgets/AgencyCalendar.jsx` | create | Month grid, keyboard, popover |
| `.../dashboard/widgets/DashboardSkeleton.jsx` | create | Loading layout + shared grid class |
| `.../dashboard/widgets/MyWorkColumn.jsx` | create | Right column for staff |
| `.../dashboard/widgets/HeroContinueCard.jsx` | modify | Fits the narrow column |
| `.../dashboard/OwnerOverview.jsx`, `StaffMyWork.jsx` | rewrite | New layouts |
| `.../dashboard/widgets/ActivityRibbon.jsx`, `widgets/Sparkline.jsx` | delete | Unused after the redesign |

---

## Task 1: Calendar payload types and schemas

**Repo:** Voyage-Server

**Files:**
- Modify: `src/modules/dashboard/dashboardTypes.ts` (append)
- Modify: `src/modules/dashboard/dashboardSchemas.ts` (import + append)
- Test: `tests/dashboardCalendarSchemas.test.ts` (create)

- [ ] **Step 0: Record the baseline**

Run `npm test 2>&1 | tail -40`. Write down any failing test files; they fail on `staging` too, and Task 8 compares against this list.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboardCalendarSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calendarPayloadSchema, calendarQuerySchema } from "../src/modules/dashboard/dashboardSchemas";

const trip = {
  tripId: "t1",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Reyes",
  placeLabel: "Kyoto",
  startDate: "2026-10-08",
  endDate: "2026-10-14",
  status: "APPROVED_INTERNAL",
  travelerCount: 2
};

const event = {
  id: "client_viewed:s1",
  kind: "client_viewed",
  tripId: "t1",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Reyes",
  occurredAt: "2026-10-03T02:00:00.000Z",
  detail: { viewCount: 4 }
};

const payload = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T04:00:00.000Z",
  tripsWithoutDates: 1,
  trips: [trip],
  events: [event]
};

describe("calendarPayloadSchema", () => {
  it("accepts trips and events", () => {
    expect(calendarPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an event kind the calendar does not know", () => {
    const parsed = calendarPayloadSchema.safeParse({ ...payload, events: [{ ...event, kind: "itinerary_approved" }] });
    expect(parsed.success).toBe(false);
  });

  it("rejects archived trips", () => {
    const parsed = calendarPayloadSchema.safeParse({ ...payload, trips: [{ ...trip, status: "ARCHIVED" }] });
    expect(parsed.success).toBe(false);
  });
});

describe("calendarQuerySchema", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(calendarQuerySchema.safeParse({ from: "2026-09-27", to: "2026-11-07" }).success).toBe(true);
  });

  it("rejects impossible or misformatted dates and missing bounds", () => {
    expect(calendarQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-07" }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ from: "27/09/2026", to: "2026-11-07" }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ to: "2026-11-07" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dashboardCalendarSchemas.test.ts`
Expected: FAIL. `calendarPayloadSchema` / `calendarQuerySchema` are undefined, so `safeParse` throws a TypeError.

- [ ] **Step 3: Add the types**

Append to `src/modules/dashboard/dashboardTypes.ts`:

```ts

// ---------- Calendar ----------

export type CalendarEventKind =
  | "share_sent"
  | "share_expires"
  | "client_viewed"
  | "client_commented"
  | "proposal_rated"
  | "review_submitted";

export type CalendarTrip = {
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** destinationSummary, or the title when there is none; shown on the calendar tile. */
  placeLabel: string;
  /** Calendar date, YYYY-MM-DD. */
  startDate: string;
  /** Calendar date, YYYY-MM-DD; equals startDate for one-day or undated-end trips. */
  endDate: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL";
  travelerCount: number | null;
};

export type CalendarEvent = {
  /** "{kind}:{source row id}" — unique within a payload. */
  id: string;
  kind: CalendarEventKind;
  tripId: string;
  tripTitle: string;
  clientName: string | null;
  /** ISO instant; the client places it on the viewer's local day. */
  occurredAt: string;
  detail: { viewCount?: number; rating?: number; excerpt?: string };
};

export type CalendarPayload = {
  from: string;
  to: string;
  generatedAt: string;
  /** In-scope, non-archived trips with no start date. */
  tripsWithoutDates: number;
  trips: CalendarTrip[];
  events: CalendarEvent[];
};
```

- [ ] **Step 4: Add the schemas**

In `src/modules/dashboard/dashboardSchemas.ts`, change the first line from:

```ts
import { z } from "zod";
```

to:

```ts
import { z } from "zod";
import { isIsoDate } from "../../services/weather/dates";
```

Then append to the end of the file:

```ts

// ---------- Calendar ----------

const isoDateSchema = z.string().refine(isIsoDate, "Use a real date in YYYY-MM-DD format.");

export const calendarQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema
});

export const calendarEventKindSchema = z.enum([
  "share_sent",
  "share_expires",
  "client_viewed",
  "client_commented",
  "proposal_rated",
  "review_submitted"
]);

export const calendarPayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
  generatedAt: z.string(),
  tripsWithoutDates: z.number().int().nonnegative(),
  trips: z.array(
    z.object({
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      placeLabel: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED_INTERNAL"]),
      travelerCount: z.number().int().nullable()
    })
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: calendarEventKindSchema,
      tripId: z.string(),
      tripTitle: z.string(),
      clientName: z.string().nullable(),
      occurredAt: z.string(),
      detail: z.object({
        viewCount: z.number().int().nonnegative().optional(),
        rating: z.number().int().optional(),
        excerpt: z.string().optional()
      })
    })
  )
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/dashboardCalendarSchemas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard/dashboardTypes.ts src/modules/dashboard/dashboardSchemas.ts tests/dashboardCalendarSchemas.test.ts
git commit -m "feat(dashboard): add calendar payload types and schemas"
```

---

## Task 2: Calendar request window

**Repo:** Voyage-Server

**Files:**
- Create: `src/modules/dashboard/calendar.ts`
- Test: `tests/dashboardCalendar.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/dashboardCalendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { CALENDAR_MAX_DAYS, calendarWindow } from "../src/modules/dashboard/calendar";

describe("calendarWindow", () => {
  it("pads the requested local dates to cover every timezone", () => {
    const window = calendarWindow("2026-09-27", "2026-11-07");
    expect(window.from).toBe("2026-09-27");
    expect(window.to).toBe("2026-11-07");
    expect(window.fromDayStart.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(window.toDayStart.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.fromInstant.toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(window.toInstant.toISOString()).toBe("2026-11-08T13:59:59.999Z");
  });

  it("allows a single day", () => {
    expect(() => calendarWindow("2026-10-03", "2026-10-03")).not.toThrow();
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => calendarWindow("2026-10-08", "2026-10-01")).toThrow(ApiError);
  });

  it(`allows ${CALENDAR_MAX_DAYS} days and rejects more`, () => {
    expect(() => calendarWindow("2026-09-27", "2026-11-07")).not.toThrow();
    try {
      calendarWindow("2026-09-27", "2026-11-08");
      expect.unreachable("a 43-day range should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(400);
      expect((error as ApiError).code).toBe("CALENDAR_RANGE_INVALID");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: FAIL: `Failed to load url ../src/modules/dashboard/calendar` (module does not exist).

- [ ] **Step 3: Implement the window**

Create `src/modules/dashboard/calendar.ts`:

```ts
import { ApiError } from "../../http/errors";
import { daysBetween } from "../../services/weather/dates";

/**
 * Pure composition for the dashboard calendar: the request window and the
 * payload builder. No DB access, so every rule is unit-testable; the rows
 * come from `calendarRepository.ts`.
 */

/** The month grid shows six weeks; one request never covers more. */
export const CALENDAR_MAX_DAYS = 42;

const HOUR_MS = 60 * 60 * 1000;
/**
 * Clients place events on their *local* day, and UTC offsets run from −12h to
 * +14h, so the instant window is padded by 14h on both sides. The client drops
 * whatever lands outside its grid.
 */
const TIMEZONE_SLACK_MS = 14 * HOUR_MS;

export type CalendarWindow = {
  /** First requested local date, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last requested local date, inclusive (YYYY-MM-DD). */
  to: string;
  /** `from` at 00:00Z, for comparing date-only trip fields. */
  fromDayStart: Date;
  /** `to` at 00:00Z. */
  toDayStart: Date;
  /** Earliest instant that falls on `from` in any timezone. */
  fromInstant: Date;
  /** Latest instant that falls on `to` in any timezone. */
  toInstant: Date;
};

/**
 * The window for local dates `from`…`to` (inclusive, YYYY-MM-DD, already
 * validated by `calendarQuerySchema`). Throws 400 CALENDAR_RANGE_INVALID when
 * `to` is before `from` or the range is longer than the grid.
 */
export function calendarWindow(from: string, to: string): CalendarWindow {
  const span = daysBetween(from, to);
  if (span < 0 || span > CALENDAR_MAX_DAYS - 1) {
    throw new ApiError(
      400,
      "CALENDAR_RANGE_INVALID",
      `Ask for 1 to ${CALENDAR_MAX_DAYS} days, with from on or before to.`
    );
  }
  const fromDayStart = new Date(`${from}T00:00:00.000Z`);
  const toDayStart = new Date(`${to}T00:00:00.000Z`);
  return {
    from,
    to,
    fromDayStart,
    toDayStart,
    fromInstant: new Date(fromDayStart.getTime() - TIMEZONE_SLACK_MS),
    toInstant: new Date(toDayStart.getTime() + 24 * HOUR_MS + TIMEZONE_SLACK_MS - 1)
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/calendar.ts tests/dashboardCalendar.test.ts
git commit -m "feat(dashboard): add calendar request window with range check"
```

---

## Task 3: Trip spans and staff scoping

**Repo:** Voyage-Server

**Files:**
- Modify: `src/modules/dashboard/calendar.ts` (replace the whole file)
- Test: `tests/dashboardCalendar.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/dashboardCalendar.test.ts`, replace the import block at the top with:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import {
  CALENDAR_MAX_DAYS,
  buildCalendar,
  calendarWindow,
  type CalendarTripRef,
  type RawCalendarData
} from "../src/modules/dashboard/calendar";
```

Then append to the end of the file:

```ts

const NOW = new Date("2026-10-03T04:00:00.000Z");
const WINDOW = calendarWindow("2026-09-27", "2026-11-07");
const OWNER = "user-owner";
const STAFF = "user-staff";

function emptyRaw(): RawCalendarData {
  return { trips: [], undatedTrips: [], shares: [], comments: [], reviews: [] };
}

function tripRef(id: string, overrides: Partial<CalendarTripRef> = {}): CalendarTripRef {
  return {
    id,
    title: `Trip ${id}`,
    clientName: `Client ${id}`,
    createdByUserId: OWNER,
    assignedOrganizerUserId: null,
    ...overrides
  };
}

function datedTrip(
  id: string,
  startDate: string | null,
  endDate: string | null,
  overrides: Partial<RawCalendarData["trips"][number]> = {}
): RawCalendarData["trips"][number] {
  return {
    ...tripRef(id),
    destinationSummary: null,
    startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : null,
    endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
    status: "IN_REVIEW",
    travelerCount: 2,
    ...overrides
  };
}

function build(raw: RawCalendarData, role: "OWNER" | "ADMIN" | "STAFF" = "OWNER", userId = OWNER) {
  return buildCalendar(raw, { role, userId, window: WINDOW, now: NOW });
}

describe("buildCalendar trip spans", () => {
  it("keeps trips that overlap the window at either edge, sorted by start", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("after-overlap", "2026-11-07", "2026-11-12"),
      datedTrip("before-overlap", "2026-09-20", "2026-09-27"),
      datedTrip("ends-before", "2026-09-10", "2026-09-26"),
      datedTrip("starts-after", "2026-11-08", "2026-11-10")
    ];
    expect(build(raw).trips.map((trip) => trip.tripId)).toEqual(["before-overlap", "after-overlap"]);
  });

  it("serialises trip dates as calendar dates", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("kyoto", "2026-10-08", "2026-10-14", { destinationSummary: "Kyoto" })];
    expect(build(raw).trips).toEqual([
      {
        tripId: "kyoto",
        tripTitle: "Trip kyoto",
        clientName: "Client kyoto",
        placeLabel: "Kyoto",
        startDate: "2026-10-08",
        endDate: "2026-10-14",
        status: "IN_REVIEW",
        travelerCount: 2
      }
    ]);
  });

  it("treats a trip without an end date as a single day", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("day", "2026-10-10", null)];
    expect(build(raw).trips[0]).toMatchObject({ startDate: "2026-10-10", endDate: "2026-10-10" });
  });

  it("treats an end date before the start date as a single day on the start date", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("odd", "2026-10-10", "2026-10-05")];
    expect(build(raw).trips[0]).toMatchObject({ startDate: "2026-10-10", endDate: "2026-10-10" });
  });

  it("leaves out archived trips and trips without a start date", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("archived", "2026-10-10", "2026-10-12", { status: "ARCHIVED" }),
      datedTrip("undated", null, null)
    ];
    expect(build(raw).trips).toEqual([]);
  });

  it("labels each trip with its destination, falling back to the title", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("a", "2026-10-08", "2026-10-14", { destinationSummary: "  Kyoto  " }),
      datedTrip("b", "2026-10-20", "2026-10-25", { destinationSummary: "   " })
    ];
    expect(build(raw).trips.map((trip) => trip.placeLabel)).toEqual(["Kyoto", "Trip b"]);
  });
});

describe("buildCalendar staff scoping", () => {
  it("shows staff only the trips they created or organize", () => {
    const raw = emptyRaw();
    raw.trips = [
      datedTrip("mine", "2026-10-08", "2026-10-09", { createdByUserId: STAFF }),
      datedTrip("assigned", "2026-10-10", "2026-10-11", { assignedOrganizerUserId: STAFF }),
      datedTrip("other", "2026-10-12", "2026-10-13")
    ];
    expect(build(raw, "STAFF", STAFF).trips.map((trip) => trip.tripId)).toEqual(["mine", "assigned"]);
    expect(build(raw, "ADMIN", OWNER).trips).toHaveLength(3);
  });

  it("counts undated trips in scope", () => {
    const raw = emptyRaw();
    raw.undatedTrips = [
      { createdByUserId: STAFF, assignedOrganizerUserId: null },
      { createdByUserId: OWNER, assignedOrganizerUserId: null }
    ];
    expect(build(raw, "STAFF", STAFF).tripsWithoutDates).toBe(1);
    expect(build(raw).tripsWithoutDates).toBe(2);
  });

  it("stamps the payload with the window and the time it was built", () => {
    const payload = build(emptyRaw());
    expect(payload).toMatchObject({
      from: "2026-09-27",
      to: "2026-11-07",
      generatedAt: "2026-10-03T04:00:00.000Z",
      trips: [],
      events: []
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: FAIL: `buildCalendar is not a function` (window tests still pass).

- [ ] **Step 3: Implement spans and scoping**

Replace the whole content of `src/modules/dashboard/calendar.ts` with:

```ts
import { ApiError } from "../../http/errors";
import { daysBetween } from "../../services/weather/dates";
import type { CalendarPayload, CalendarTrip, DashboardRole } from "./dashboardTypes";

/**
 * Pure composition for the dashboard calendar: the request window and the
 * payload builder. No DB access, so every rule is unit-testable; the rows
 * come from `calendarRepository.ts`.
 */

/** The month grid shows six weeks; one request never covers more. */
export const CALENDAR_MAX_DAYS = 42;

const HOUR_MS = 60 * 60 * 1000;
/**
 * Clients place events on their *local* day, and UTC offsets run from −12h to
 * +14h, so the instant window is padded by 14h on both sides. The client drops
 * whatever lands outside its grid.
 */
const TIMEZONE_SLACK_MS = 14 * HOUR_MS;

export type CalendarWindow = {
  /** First requested local date, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last requested local date, inclusive (YYYY-MM-DD). */
  to: string;
  /** `from` at 00:00Z, for comparing date-only trip fields. */
  fromDayStart: Date;
  /** `to` at 00:00Z. */
  toDayStart: Date;
  /** Earliest instant that falls on `from` in any timezone. */
  fromInstant: Date;
  /** Latest instant that falls on `to` in any timezone. */
  toInstant: Date;
};

/** The trip fields every calendar row needs: its label, and who it belongs to. */
export type CalendarTripRef = {
  id: string;
  title: string;
  clientName: string | null;
  createdByUserId: string;
  assignedOrganizerUserId: string | null;
};

type TripStatus = "DRAFT" | "IN_REVIEW" | "APPROVED_INTERNAL" | "ARCHIVED";

export type RawCalendarData = {
  /** Trips whose dates can overlap the window. */
  trips: Array<
    CalendarTripRef & {
      destinationSummary: string | null;
      startDate: Date | null;
      endDate: Date | null;
      status: TripStatus;
      travelerCount: number | null;
    }
  >;
  /** Non-archived trips with no start date, for the "no travel dates" note. */
  undatedTrips: Array<Pick<CalendarTripRef, "createdByUserId" | "assignedOrganizerUserId">>;
  /** Shares with any of their timestamps inside the window. */
  shares: Array<{
    id: string;
    clientName: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastViewedAt: Date | null;
    viewCount: number;
    proposalRating: number | null;
    proposalRatedAt: Date | null;
    trip: CalendarTripRef | null;
  }>;
  /** Client comments created inside the window. */
  comments: Array<{
    id: string;
    content: string;
    authorName: string;
    createdAt: Date;
    share: { clientName: string | null; trip: CalendarTripRef | null };
  }>;
  /** Trip reviews submitted inside the window. */
  reviews: Array<{
    id: string;
    rating: number;
    reviewText: string | null;
    respondentName: string | null;
    submittedAt: Date;
    trip: CalendarTripRef;
  }>;
};

export type BuildCalendarOptions = {
  role: DashboardRole;
  userId: string;
  window: CalendarWindow;
  now: Date;
};

/**
 * The window for local dates `from`…`to` (inclusive, YYYY-MM-DD, already
 * validated by `calendarQuerySchema`). Throws 400 CALENDAR_RANGE_INVALID when
 * `to` is before `from` or the range is longer than the grid.
 */
export function calendarWindow(from: string, to: string): CalendarWindow {
  const span = daysBetween(from, to);
  if (span < 0 || span > CALENDAR_MAX_DAYS - 1) {
    throw new ApiError(
      400,
      "CALENDAR_RANGE_INVALID",
      `Ask for 1 to ${CALENDAR_MAX_DAYS} days, with from on or before to.`
    );
  }
  const fromDayStart = new Date(`${from}T00:00:00.000Z`);
  const toDayStart = new Date(`${to}T00:00:00.000Z`);
  return {
    from,
    to,
    fromDayStart,
    toDayStart,
    fromInstant: new Date(fromDayStart.getTime() - TIMEZONE_SLACK_MS),
    toInstant: new Date(toDayStart.getTime() + 24 * HOUR_MS + TIMEZONE_SLACK_MS - 1)
  };
}

/** Trip dates are stored at UTC midnight, so their UTC date is the calendar date. */
function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Builds the calendar payload. STAFF see only trips they created or organize
 * (the staff worklist's rule); OWNER and ADMIN see the whole agency.
 */
export function buildCalendar(raw: RawCalendarData, opts: BuildCalendarOptions): CalendarPayload {
  const { role, userId, window } = opts;
  const inScope = (trip: Pick<CalendarTripRef, "createdByUserId" | "assignedOrganizerUserId">): boolean =>
    role !== "STAFF" || trip.createdByUserId === userId || trip.assignedOrganizerUserId === userId;

  const trips: CalendarTrip[] = [];
  for (const trip of raw.trips) {
    if (trip.status === "ARCHIVED" || trip.startDate === null || !inScope(trip)) continue;
    const startDate = toDateKey(trip.startDate);
    // A missing end date, or one before the start, shows as a one-day trip.
    const endDate =
      trip.endDate !== null && trip.endDate >= trip.startDate ? toDateKey(trip.endDate) : startDate;
    if (startDate > window.to || endDate < window.from) continue;
    trips.push({
      tripId: trip.id,
      tripTitle: trip.title,
      clientName: trip.clientName,
      placeLabel: trip.destinationSummary?.trim() || trip.title,
      startDate,
      endDate,
      status: trip.status,
      travelerCount: trip.travelerCount
    });
  }
  trips.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.tripTitle.localeCompare(b.tripTitle));

  return {
    from: window.from,
    to: window.to,
    generatedAt: opts.now.toISOString(),
    tripsWithoutDates: raw.undatedTrips.filter(inScope).length,
    trips,
    events: []
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/calendar.ts tests/dashboardCalendar.test.ts
git commit -m "feat(dashboard): build calendar trip spans with staff scoping"
```

---

## Task 4: Client activity events

**Repo:** Voyage-Server

**Files:**
- Modify: `src/modules/dashboard/calendar.ts`
- Test: `tests/dashboardCalendar.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/dashboardCalendar.test.ts`, add this import below the existing imports:

```ts
import { calendarPayloadSchema } from "../src/modules/dashboard/dashboardSchemas";
```

Then append:

```ts

describe("buildCalendar events", () => {
  const lisbon = tripRef("t1", { title: "Lisbon Getaway", clientName: "Tanaka" });

  function share(overrides: Partial<RawCalendarData["shares"][number]> = {}): RawCalendarData["shares"][number] {
    return {
      id: "s1",
      clientName: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"), // before the window
      expiresAt: null,
      revokedAt: null,
      lastViewedAt: null,
      viewCount: 0,
      proposalRating: null,
      proposalRatedAt: null,
      trip: lisbon,
      ...overrides
    };
  }

  function expected(kind: string, occurredAt: string, detail: Record<string, unknown> = {}) {
    return {
      id: `${kind}:s1`,
      kind,
      tripId: "t1",
      tripTitle: "Lisbon Getaway",
      clientName: "Tanaka",
      occurredAt,
      detail
    };
  }

  it("turns share timestamps inside the window into events, in time order", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        expiresAt: new Date("2026-10-05T09:00:00.000Z"),
        lastViewedAt: new Date("2026-10-03T02:00:00.000Z"),
        viewCount: 4,
        proposalRating: 5,
        proposalRatedAt: new Date("2026-10-02T08:00:00.000Z")
      })
    ];
    expect(build(raw).events).toEqual([
      expected("share_sent", "2026-09-28T09:00:00.000Z"),
      expected("proposal_rated", "2026-10-02T08:00:00.000Z", { rating: 5 }),
      expected("client_viewed", "2026-10-03T02:00:00.000Z", { viewCount: 4 }),
      expected("share_expires", "2026-10-05T09:00:00.000Z")
    ]);
  });

  it("names the client the link was shared with", () => {
    const raw = emptyRaw();
    raw.shares = [share({ clientName: "Ken Tanaka", createdAt: new Date("2026-09-28T09:00:00.000Z") })];
    expect(build(raw).events[0].clientName).toBe("Ken Tanaka");
  });

  it("skips the expiry of a revoked link", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({ expiresAt: new Date("2026-10-05T09:00:00.000Z"), revokedAt: new Date("2026-10-01T00:00:00.000Z") })
    ];
    expect(build(raw).events).toEqual([]);
  });

  it("skips shares that are not linked to a trip", () => {
    const raw = emptyRaw();
    raw.shares = [share({ trip: null, createdAt: new Date("2026-09-28T09:00:00.000Z") })];
    expect(build(raw).events).toEqual([]);
  });

  it("adds client comments with a short excerpt", () => {
    const raw = emptyRaw();
    raw.comments = [
      {
        id: "c1",
        content: `Can we swap the day 2 lunch spot? ${"x".repeat(100)}`,
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: lisbon }
      }
    ];
    const [event] = build(raw).events;
    expect(event).toMatchObject({ id: "client_commented:c1", kind: "client_commented", clientName: "Tanaka" });
    expect(event.detail.excerpt).toHaveLength(80);
    expect(event.detail.excerpt?.startsWith("Can we swap the day 2 lunch spot?")).toBe(true);
    expect(event.detail.excerpt?.endsWith("…")).toBe(true);
  });

  it("falls back to the comment author when the trip has no client name", () => {
    const raw = emptyRaw();
    raw.comments = [
      {
        id: "c2",
        content: "Looks great",
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: tripRef("t9", { clientName: null }) }
      }
    ];
    expect(build(raw).events[0]).toMatchObject({ clientName: "Ken", detail: { excerpt: "Looks great" } });
  });

  it("adds submitted reviews with their rating", () => {
    const raw = emptyRaw();
    raw.reviews = [
      {
        id: "r1",
        rating: 5,
        reviewText: "Seamless trip, every detail handled.",
        respondentName: "Maria Cruz",
        submittedAt: new Date("2026-09-30T12:00:00.000Z"),
        trip: tripRef("t2", { title: "Bali Honeymoon", clientName: null })
      }
    ];
    expect(build(raw).events).toEqual([
      {
        id: "review_submitted:r1",
        kind: "review_submitted",
        tripId: "t2",
        tripTitle: "Bali Honeymoon",
        clientName: "Maria Cruz",
        occurredAt: "2026-09-30T12:00:00.000Z",
        detail: { rating: 5, excerpt: "Seamless trip, every detail handled." }
      }
    ]);
  });

  it("keeps events that could fall on the first day in any timezone", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({ id: "edge", createdAt: new Date("2026-09-26T10:00:00.000Z") }),
      share({ id: "early", createdAt: new Date("2026-09-26T09:59:59.999Z") })
    ];
    expect(build(raw).events.map((event) => event.id)).toEqual(["share_sent:edge"]);
  });

  it("leaves out events on other people's trips for staff", () => {
    const raw = emptyRaw();
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        trip: tripRef("theirs", { createdByUserId: "someone-else" })
      })
    ];
    expect(build(raw, "STAFF", STAFF).events).toEqual([]);
    expect(build(raw, "OWNER", OWNER).events).toHaveLength(1);
  });

  it("produces a payload the response schema accepts", () => {
    const raw = emptyRaw();
    raw.trips = [datedTrip("kyoto", "2026-10-08", "2026-10-14")];
    raw.undatedTrips = [{ createdByUserId: OWNER, assignedOrganizerUserId: null }];
    raw.shares = [
      share({
        createdAt: new Date("2026-09-28T09:00:00.000Z"),
        lastViewedAt: new Date("2026-10-03T02:00:00.000Z"),
        viewCount: 2
      })
    ];
    raw.comments = [
      {
        id: "c1",
        content: "Hi",
        authorName: "Ken",
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        share: { clientName: null, trip: lisbon }
      }
    ];
    expect(calendarPayloadSchema.safeParse(build(raw)).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: FAIL. The event tests get `[]` (e.g. "expected [] to deeply equal [ { id: 'share_sent:s1', … } ]").

- [ ] **Step 3: Implement the events**

In `src/modules/dashboard/calendar.ts`:

1. Replace the type import line

```ts
import type { CalendarPayload, CalendarTrip, DashboardRole } from "./dashboardTypes";
```

with

```ts
import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarPayload,
  CalendarTrip,
  DashboardRole
} from "./dashboardTypes";
```

2. Directly below `const TIMEZONE_SLACK_MS = 14 * HOUR_MS;` add:

```ts
/** Longest comment or review excerpt the calendar shows. */
const EXCERPT_LENGTH = 80;
```

3. Directly below the `toDateKey` function add:

```ts
/** One line of text, cut to EXCERPT_LENGTH with an ellipsis. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}
```

4. Replace the whole `buildCalendar` function with:

```ts
/**
 * Builds the calendar payload. STAFF see only trips they created or organize
 * (the staff worklist's rule); OWNER and ADMIN see the whole agency.
 */
export function buildCalendar(raw: RawCalendarData, opts: BuildCalendarOptions): CalendarPayload {
  const { role, userId, window } = opts;
  const inScope = (trip: Pick<CalendarTripRef, "createdByUserId" | "assignedOrganizerUserId">): boolean =>
    role !== "STAFF" || trip.createdByUserId === userId || trip.assignedOrganizerUserId === userId;
  const inWindow = (at: Date | null): at is Date =>
    at !== null && at >= window.fromInstant && at <= window.toInstant;

  const trips: CalendarTrip[] = [];
  for (const trip of raw.trips) {
    if (trip.status === "ARCHIVED" || trip.startDate === null || !inScope(trip)) continue;
    const startDate = toDateKey(trip.startDate);
    // A missing end date, or one before the start, shows as a one-day trip.
    const endDate =
      trip.endDate !== null && trip.endDate >= trip.startDate ? toDateKey(trip.endDate) : startDate;
    if (startDate > window.to || endDate < window.from) continue;
    trips.push({
      tripId: trip.id,
      tripTitle: trip.title,
      clientName: trip.clientName,
      placeLabel: trip.destinationSummary?.trim() || trip.title,
      startDate,
      endDate,
      status: trip.status,
      travelerCount: trip.travelerCount
    });
  }
  trips.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.tripTitle.localeCompare(b.tripTitle));

  const events: CalendarEvent[] = [];
  const addEvent = (
    kind: CalendarEventKind,
    sourceId: string,
    trip: CalendarTripRef,
    clientName: string | null,
    occurredAt: Date,
    detail: CalendarEvent["detail"] = {}
  ) => {
    events.push({
      id: `${kind}:${sourceId}`,
      kind,
      tripId: trip.id,
      tripTitle: trip.title,
      clientName,
      occurredAt: occurredAt.toISOString(),
      detail
    });
  };

  for (const share of raw.shares) {
    const trip = share.trip;
    if (trip === null || !inScope(trip)) continue;
    const clientName = share.clientName ?? trip.clientName;
    if (inWindow(share.createdAt)) {
      addEvent("share_sent", share.id, trip, clientName, share.createdAt);
    }
    if (share.revokedAt === null && inWindow(share.expiresAt)) {
      addEvent("share_expires", share.id, trip, clientName, share.expiresAt);
    }
    if (inWindow(share.lastViewedAt)) {
      addEvent("client_viewed", share.id, trip, clientName, share.lastViewedAt, { viewCount: share.viewCount });
    }
    if (share.proposalRating !== null && inWindow(share.proposalRatedAt)) {
      addEvent("proposal_rated", share.id, trip, clientName, share.proposalRatedAt, {
        rating: share.proposalRating
      });
    }
  }

  for (const comment of raw.comments) {
    const trip = comment.share.trip;
    if (trip === null || !inScope(trip) || !inWindow(comment.createdAt)) continue;
    const clientName = comment.share.clientName ?? trip.clientName ?? comment.authorName;
    addEvent("client_commented", comment.id, trip, clientName, comment.createdAt, {
      excerpt: excerpt(comment.content)
    });
  }

  for (const review of raw.reviews) {
    if (!inScope(review.trip) || !inWindow(review.submittedAt)) continue;
    addEvent(
      "review_submitted",
      review.id,
      review.trip,
      review.trip.clientName ?? review.respondentName,
      review.submittedAt,
      {
        rating: review.rating,
        ...(review.reviewText ? { excerpt: excerpt(review.reviewText) } : {})
      }
    );
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  return {
    from: window.from,
    to: window.to,
    generatedAt: opts.now.toISOString(),
    tripsWithoutDates: raw.undatedTrips.filter(inScope).length,
    trips,
    events
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboardCalendar.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/calendar.ts tests/dashboardCalendar.test.ts
git commit -m "feat(dashboard): add client activity events to the calendar"
```

---

## Task 5: Calendar repository

**Repo:** Voyage-Server

**Files:**
- Create: `src/modules/dashboard/calendarRepository.ts`
- Test: `tests/calendarRepository.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/calendarRepository.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { calendarWindow } from "../src/modules/dashboard/calendar";
import { createPrismaCalendarRepository } from "../src/modules/dashboard/calendarRepository";

const WINDOW = calendarWindow("2026-09-27", "2026-11-07");

function fakeClient() {
  return {
    clientTrip: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryShare: { findMany: vi.fn().mockResolvedValue([]) },
    itineraryComment: { findMany: vi.fn().mockResolvedValue([]) },
    tripReview: { findMany: vi.fn().mockResolvedValue([]) }
  };
}

async function fetchWith(client: ReturnType<typeof fakeClient>) {
  return createPrismaCalendarRepository(client as never).fetchCalendarWindow("agency-1", WINDOW);
}

describe("calendar repository", () => {
  it("scopes every query to the agency", async () => {
    const client = fakeClient();
    await fetchWith(client);

    for (const [args] of client.clientTrip.findMany.mock.calls) {
      expect(args.where.agencyId).toBe("agency-1");
    }
    expect(client.itineraryShare.findMany.mock.calls[0][0].where.agencyId).toBe("agency-1");
    expect(client.itineraryComment.findMany.mock.calls[0][0].where.share).toEqual({ agencyId: "agency-1" });
    expect(client.tripReview.findMany.mock.calls[0][0].where.agencyId).toBe("agency-1");
  });

  it("asks only for non-archived trips that can overlap the window", async () => {
    const client = fakeClient();
    await fetchWith(client);

    const dated = client.clientTrip.findMany.mock.calls[0][0].where;
    expect(dated.status).toEqual({ not: "ARCHIVED" });
    expect(dated.startDate).toEqual({ not: null, lte: new Date("2026-11-07T00:00:00.000Z") });
    expect(dated.OR).toEqual([
      { endDate: { gte: new Date("2026-09-27T00:00:00.000Z") } },
      { startDate: { gte: new Date("2026-09-27T00:00:00.000Z") } }
    ]);

    const undated = client.clientTrip.findMany.mock.calls[1][0].where;
    expect(undated).toEqual({ agencyId: "agency-1", status: { not: "ARCHIVED" }, startDate: null });
  });

  it("limits activity to the padded instant window", async () => {
    const client = fakeClient();
    await fetchWith(client);

    const range = { gte: WINDOW.fromInstant, lte: WINDOW.toInstant };
    const shares = client.itineraryShare.findMany.mock.calls[0][0].where;
    expect(shares.tripId).toEqual({ not: null });
    expect(shares.OR).toEqual([
      { createdAt: range },
      { expiresAt: range },
      { lastViewedAt: range },
      { proposalRatedAt: range }
    ]);
    expect(client.itineraryComment.findMany.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(client.tripReview.findMany.mock.calls[0][0].where.submittedAt).toEqual(range);
  });

  it("returns each query's rows under its own key", async () => {
    const client = fakeClient();
    client.clientTrip.findMany
      .mockResolvedValueOnce([{ id: "dated" }])
      .mockResolvedValueOnce([{ createdByUserId: "u1", assignedOrganizerUserId: null }]);
    client.itineraryShare.findMany.mockResolvedValueOnce([{ id: "s1" }]);
    client.itineraryComment.findMany.mockResolvedValueOnce([{ id: "c1" }]);
    client.tripReview.findMany.mockResolvedValueOnce([{ id: "r1" }]);

    expect(await fetchWith(client)).toEqual({
      trips: [{ id: "dated" }],
      undatedTrips: [{ createdByUserId: "u1", assignedOrganizerUserId: null }],
      shares: [{ id: "s1" }],
      comments: [{ id: "c1" }],
      reviews: [{ id: "r1" }]
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/calendarRepository.test.ts`
Expected: FAIL: `Failed to load url ../src/modules/dashboard/calendarRepository`.

- [ ] **Step 3: Implement the repository**

Create `src/modules/dashboard/calendarRepository.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { CalendarWindow, RawCalendarData } from "./calendar";

/**
 * Reads the rows the dashboard calendar needs for one agency and one window.
 * Every query is scoped to the agency; role scoping (staff see their own
 * trips) happens in `buildCalendar`, so the rules stay unit-testable.
 */
export interface CalendarRepository {
  fetchCalendarWindow(agencyId: string, window: CalendarWindow): Promise<RawCalendarData>;
}

const tripRefSelect = {
  id: true,
  title: true,
  clientName: true,
  createdByUserId: true,
  assignedOrganizerUserId: true
} as const;

export function createPrismaCalendarRepository(client: PrismaClient = prisma): CalendarRepository {
  return {
    async fetchCalendarWindow(agencyId, window) {
      const instantRange = { gte: window.fromInstant, lte: window.toInstant };

      const [trips, undatedTrips, shares, comments, reviews] = await Promise.all([
        client.clientTrip.findMany({
          where: {
            agencyId,
            status: { not: "ARCHIVED" },
            startDate: { not: null, lte: window.toDayStart },
            // Ends inside or after the window, or starts inside it (covers
            // trips with no end date and end dates before the start).
            OR: [{ endDate: { gte: window.fromDayStart } }, { startDate: { gte: window.fromDayStart } }]
          },
          select: {
            ...tripRefSelect,
            destinationSummary: true,
            startDate: true,
            endDate: true,
            status: true,
            travelerCount: true
          }
        }),
        client.clientTrip.findMany({
          where: { agencyId, status: { not: "ARCHIVED" }, startDate: null },
          select: { createdByUserId: true, assignedOrganizerUserId: true }
        }),
        client.itineraryShare.findMany({
          where: {
            agencyId,
            tripId: { not: null },
            OR: [
              { createdAt: instantRange },
              { expiresAt: instantRange },
              { lastViewedAt: instantRange },
              { proposalRatedAt: instantRange }
            ]
          },
          select: {
            id: true,
            clientName: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
            lastViewedAt: true,
            viewCount: true,
            proposalRating: true,
            proposalRatedAt: true,
            trip: { select: tripRefSelect }
          }
        }),
        client.itineraryComment.findMany({
          where: { createdAt: instantRange, share: { agencyId } },
          select: {
            id: true,
            content: true,
            authorName: true,
            createdAt: true,
            share: { select: { clientName: true, trip: { select: tripRefSelect } } }
          }
        }),
        client.tripReview.findMany({
          where: { agencyId, submittedAt: instantRange },
          select: {
            id: true,
            rating: true,
            reviewText: true,
            respondentName: true,
            submittedAt: true,
            trip: { select: tripRefSelect }
          }
        })
      ]);

      return { trips, undatedTrips, shares, comments, reviews };
    }
  };
}

export const calendarRepository = createPrismaCalendarRepository();
```

- [ ] **Step 4: Run the test and the type check**

Run: `npx vitest run tests/calendarRepository.test.ts`
Expected: PASS (4 tests).

Run: `npx tsc --noEmit`
Expected: no errors. If Prisma's `select` types disagree with `RawCalendarData`, fix the select here and do not loosen `RawCalendarData`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/calendarRepository.ts tests/calendarRepository.test.ts
git commit -m "feat(dashboard): add calendar repository"
```

---

## Task 6: Calendar service with cache

**Repo:** Voyage-Server

**Files:**
- Create: `src/modules/dashboard/calendarService.ts`
- Test: `tests/calendarService.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/calendarService.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { ApiError } from "../src/http/errors";
import { TtlCache } from "../src/modules/dashboard/cache";
import type { RawCalendarData } from "../src/modules/dashboard/calendar";
import type { CalendarRepository } from "../src/modules/dashboard/calendarRepository";
import { createCalendarService } from "../src/modules/dashboard/calendarService";
import type { CalendarPayload } from "../src/modules/dashboard/dashboardTypes";

const BASE = {
  agencyId: "agency-1",
  from: "2026-09-27",
  to: "2026-11-07",
  now: new Date("2026-10-03T04:00:00.000Z")
};

function setup() {
  const raw: RawCalendarData = { trips: [], undatedTrips: [], shares: [], comments: [], reviews: [] };
  const fetchCalendarWindow = vi.fn().mockResolvedValue(raw);
  const repository: CalendarRepository = { fetchCalendarWindow };
  const service = createCalendarService({ repository, cache: new TtlCache<CalendarPayload>(60_000) });
  return { service, fetchCalendarWindow };
}

describe("calendar service", () => {
  it("passes the agency and window to the repository", async () => {
    const { service, fetchCalendarWindow } = setup();
    const payload = await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });

    expect(payload).toMatchObject({ from: "2026-09-27", to: "2026-11-07", generatedAt: "2026-10-03T04:00:00.000Z" });
    const [agencyId, window] = fetchCalendarWindow.mock.calls[0];
    expect(agencyId).toBe("agency-1");
    expect(window).toMatchObject({ from: "2026-09-27", to: "2026-11-07" });
  });

  it("serves a repeat request for the same range from the cache", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(1);
  });

  it("shares one cached calendar between owners and admins", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "owner", role: "OWNER" });
    await service.getCalendar({ ...BASE, userId: "admin", role: "ADMIN" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(1);
  });

  it("caches staff calendars per person", async () => {
    const { service, fetchCalendarWindow } = setup();
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    await service.getCalendar({ ...BASE, userId: "staff-b", role: "STAFF" });
    await service.getCalendar({ ...BASE, userId: "staff-a", role: "STAFF" });
    expect(fetchCalendarWindow).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid range before touching the database", async () => {
    const { service, fetchCalendarWindow } = setup();
    await expect(
      service.getCalendar({ ...BASE, from: "2026-11-07", to: "2026-09-27", userId: "owner", role: "OWNER" })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchCalendarWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/calendarService.test.ts`
Expected: FAIL: `Failed to load url ../src/modules/dashboard/calendarService`.

- [ ] **Step 3: Implement the service**

Create `src/modules/dashboard/calendarService.ts`:

```ts
import { TtlCache } from "./cache";
import { buildCalendar, calendarWindow } from "./calendar";
import { calendarRepository, type CalendarRepository } from "./calendarRepository";
import type { CalendarPayload, DashboardRole } from "./dashboardTypes";

/**
 * Serves the dashboard calendar: validates the range, then returns a cached
 * payload or builds one from the repository's rows. Owners and admins share
 * one cache entry per agency and range; staff get their own (scoped) entry.
 */

const CACHE_TTL_MS = 60_000;

export type GetCalendarOptions = {
  agencyId: string;
  userId: string;
  role: DashboardRole;
  from: string;
  to: string;
  now?: Date;
};

export function createCalendarService(deps: {
  repository: CalendarRepository;
  cache: TtlCache<CalendarPayload>;
}) {
  async function getCalendar(opts: GetCalendarOptions): Promise<CalendarPayload> {
    const window = calendarWindow(opts.from, opts.to);
    const scope = opts.role === "STAFF" ? `staff:${opts.userId}` : "all";
    const cacheKey = `${opts.agencyId}:${scope}:${opts.from}:${opts.to}`;

    const cached = deps.cache.get(cacheKey);
    if (cached) return cached;

    const raw = await deps.repository.fetchCalendarWindow(opts.agencyId, window);
    const payload = buildCalendar(raw, {
      role: opts.role,
      userId: opts.userId,
      window,
      now: opts.now ?? new Date()
    });
    deps.cache.set(cacheKey, payload);
    return payload;
  }

  return { getCalendar };
}

export const calendarService = createCalendarService({
  repository: calendarRepository,
  cache: new TtlCache<CalendarPayload>(CACHE_TTL_MS)
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/calendarService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/calendarService.ts tests/calendarService.test.ts
git commit -m "feat(dashboard): add cached calendar service"
```

---

## Task 7: `GET /dashboard/calendar` route

**Repo:** Voyage-Server

**Files:**
- Modify: `src/modules/dashboard/dashboardRoutes.ts` (replace the whole file)
- Test: `tests/dashboardCalendarRoutes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/dashboardCalendarRoutes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  getCalendar: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({
  dashboardService: { getDashboard: vi.fn() }
}));
vi.mock("../src/modules/dashboard/calendarService", () => ({
  calendarService: { getCalendar: mocks.getCalendar }
}));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const staffUser = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff Member",
  memberships: []
};

const payload = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T04:00:00.000Z",
  tripsWithoutDates: 0,
  trips: [],
  events: []
};

const path = (query: string) => `/agencies/${AGENCY_ID}/dashboard/calendar?${query}`;

function createApp(authUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authUser) req.authUser = authUser as any;
    next();
  });
  app.use("/agencies/:agencyId/dashboard", dashboardRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.getCalendar.mockResolvedValue(payload);
});

describe("GET /agencies/:agencyId/dashboard/calendar", () => {
  it("returns the calendar for the caller's role", async () => {
    const response = await request(createApp(staffUser)).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(payload);
    expect(mocks.getCalendar).toHaveBeenCalledWith({
      agencyId: AGENCY_ID,
      userId: "user-staff",
      role: "STAFF",
      from: "2026-09-27",
      to: "2026-11-07"
    });
  });

  it("requires sign-in", async () => {
    const response = await request(createApp()).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(401);
    expect(mocks.getCalendar).not.toHaveBeenCalled();
  });

  it("refuses people who are not members of the agency", async () => {
    mocks.requireVerifiedAgencyMember.mockResolvedValue({
      agency: { id: AGENCY_ID, status: "VERIFIED" },
      membership: null
    });

    const response = await request(createApp(staffUser)).get(path("from=2026-09-27&to=2026-11-07"));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("AGENCY_ACCESS_REQUIRED");
  });

  it("rejects dates that are not YYYY-MM-DD", async () => {
    const response = await request(createApp(staffUser)).get(path("from=27-09-2026&to=2026-11-07"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.getCalendar).not.toHaveBeenCalled();
  });

  it("passes on range errors from the calendar service", async () => {
    mocks.getCalendar.mockRejectedValue(new ApiError(400, "CALENDAR_RANGE_INVALID", "Too long."));

    const response = await request(createApp(staffUser)).get(path("from=2026-01-01&to=2026-12-31"));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CALENDAR_RANGE_INVALID");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dashboardCalendarRoutes.test.ts`
Expected: FAIL. The 200 test gets 404 `NOT_FOUND` because the route doesn't exist yet.

- [ ] **Step 3: Add the route**

Replace the whole content of `src/modules/dashboard/dashboardRoutes.ts` with:

```ts
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { calendarService } from "./calendarService";
import { calendarQuerySchema, dashboardQuerySchema } from "./dashboardSchemas";
import { dashboardService } from "./dashboardService";

/**
 * Mounted at `/agencies/:agencyId/dashboard`.
 *
 * GET / — returns the role-branched dashboard payload.
 *   Query: view=owner|staff (optional), period=7d|30d|90d (optional, default 30d).
 *   Role enforcement: STAFF cannot request view=owner.
 *
 * GET /calendar — trips and client activity for the dashboard calendar.
 *   Query: from, to (YYYY-MM-DD local dates, inclusive, at most 42 days).
 *   STAFF get only the trips they created or organize.
 */
export const dashboardRoutes: Router = Router({ mergeParams: true });

dashboardRoutes.get("/", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }
    const role = access.membership.role;

    const parsed = dashboardQuerySchema.parse(request.query);

    const payload = await dashboardService.getDashboard({
      agencyId: access.agency.id,
      userId: request.authUser!.id,
      role,
      view: parsed.view,
      period: parsed.period
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

dashboardRoutes.get("/calendar", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    if (!access.membership) {
      throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
    }

    const { from, to } = calendarQuerySchema.parse(request.query);

    const payload = await calendarService.getCalendar({
      agencyId: access.agency.id,
      userId: request.authUser!.id,
      role: access.membership.role,
      from,
      to
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dashboardCalendarRoutes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/dashboardRoutes.ts tests/dashboardCalendarRoutes.test.ts
git commit -m "feat(dashboard): serve GET /dashboard/calendar"
```

---

## Task 8: Server verification

**Repo:** Voyage-Server

- [ ] **Step 1: Run the whole suite**

Run: `npm test 2>&1 | tail -40`
Expected: every new calendar test passes. Any failing files must also be on the Task 1 baseline list. Fix anything new before continuing.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Smoke-test the endpoint (needs a dev database and a signed-in agency user)**

Start the server (`npm run dev`), sign in to the client as an agency owner, then in the browser console on the app:

```js
await fetch("/api/agencies/<agencyId>/dashboard/calendar?from=2026-09-27&to=2026-11-07", { credentials: "include" }).then((r) => r.json())
```

Expected: a payload with `trips`, `events` and `tripsWithoutDates`. The same call with `to=2026-12-31` returns 400 `CALENDAR_RANGE_INVALID`.

- [ ] **Step 4: Commit only if Steps 1–3 required fixes**

```bash
git add -A
git commit -m "fix(dashboard): address calendar endpoint verification findings"
```

---

## Task 9: Frame tokens and utilities

**Repo:** Voyage-Client

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 0: Record the client baseline**

Run: `npm test 2>&1 | tail -40`. Write down any failing test files; Task 26 compares against this list.

- [ ] **Step 1: Add the strong terracotta to the theme**

In the `@theme { … }` block, find:

```css
  --color-sidebar-active: oklch(0.63 0.13 30);
  --color-border: oklch(0.33 0.03 220);
```

and add directly below it:

```css

  /* Terracotta for text links and filled buttons with text: the brand
     terracotta is too light for 4.5:1 text contrast on white. */
  --color-secondary-strong: #ad5238;
  --color-on-secondary-strong: #ffffff;
```

In the `.dark { … }` block, find:

```css
  --color-sidebar-active: oklch(0.70 0.12 35);
  --color-border: oklch(0.35 0.01 250);
```

and add directly below it:

```css

  --color-secondary-strong: #e0906f;
  --color-on-secondary-strong: #111416;
```

- [ ] **Step 2: Add the frame tokens**

In `:root`, find `  --glass-border: rgba(255, 255, 255, 0.30);` and add directly below it:

```css

  /* App frame glass (dashboard calendar redesign). Kept apart from --glass-*,
     which the Command Center chat panel uses. */
  --frame-panel: rgba(255, 255, 255, 0.55);
  --frame-tile: rgba(255, 255, 255, 0.72);
  --frame-border: rgba(34, 56, 67, 0.10);
  --frame-popover: #ffffff;
  --frame-streak-1: rgba(255, 255, 255, 0.85);
  --frame-streak-2: rgba(215, 122, 97, 0.08);
```

In `.dark`, find `  --glass-border: rgba(255, 255, 255, 0.05);` and add directly below it:

```css

  --frame-panel: rgba(26, 29, 33, 0.72);
  --frame-tile: rgba(255, 255, 255, 0.04);
  --frame-border: rgba(255, 255, 255, 0.08);
  --frame-popover: #22262b;
  --frame-streak-1: rgba(255, 255, 255, 0.04);
  --frame-streak-2: rgba(224, 144, 111, 0.07);
```

- [ ] **Step 3: Add the utilities**

Directly below the `@utility dashboard-eyebrow { … }` block add:

```css

/* Glass app frame. `frame-panel` carries the blur, so only use it on layers
   with no fixed-position children (see HomePage's frame background). */
@utility frame-panel {
  background: var(--frame-panel);
  border: 1px solid var(--frame-border);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}

@utility frame-tile {
  background: var(--frame-tile);
  border: 1px solid var(--frame-border);
}

@utility frame-popover {
  background: var(--frame-popover);
  border: 1px solid var(--frame-border);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
}
```

At the very end of the file add:

```css

/* ═══════════════════════════════════════════════════
   APP FRAME (dashboard calendar redesign)
   ═══════════════════════════════════════════════════ */

/* Soft diagonal light streak behind the frame. */
.app-frame-streak {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(115deg, transparent 30%, var(--frame-streak-1) 42%, transparent 54%),
    linear-gradient(115deg, transparent 58%, var(--frame-streak-2) 64%, transparent 70%);
}

/* No blur support: a solid surface reads better than an unblurred see-through one. */
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .frame-panel {
    background: rgb(var(--color-surface-rgb));
  }
}

@media (prefers-reduced-transparency: reduce) {
  .frame-panel,
  .frame-tile {
    background: rgb(var(--color-surface-rgb));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@keyframes frame-pop-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.frame-pop-in {
  animation: frame-pop-in 120ms var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .frame-pop-in {
    animation: none;
  }
}
```

- [ ] **Step 4: Check that the CSS still compiles**

Run: `npx next build 2>&1 | tail -15`
Expected: "Compiled successfully". Fix any CSS syntax error it reports.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): add glass frame tokens and strong terracotta"
```

---

## Task 10: Rail button and account menu

**Repo:** Voyage-Client

**Files:**
- Create: `app/components/trip-dashboard/layout/RailButton.jsx`
- Create: `app/components/trip-dashboard/layout/AccountMenu.jsx`
- Test: `tests/dashboard-rail.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard-rail.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AccountMenu from "../app/components/trip-dashboard/layout/AccountMenu.jsx";
import RailButton from "../app/components/trip-dashboard/layout/RailButton.jsx";

function renderMenu(props = {}) {
  const handlers = { onOpenSettings: vi.fn(), onSignOut: vi.fn() };
  render(
    <AccountMenu
      initials="MS"
      displayName="Maria Santos"
      email="maria@example.test"
      role="OWNER"
      agencyName="Sunline Travel"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  return screen.getByRole("menu", { name: "Account" });
}

describe("RailButton", () => {
  it("is named by its label and marks the current page", () => {
    render(<RailButton label="Dashboard" icon={<svg />} active onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves aria-current off when it is not the current page", () => {
    render(<RailButton label="Settings" icon={<svg />} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("shows a badge next to the icon", () => {
    render(<RailButton label="Admin" icon={<svg />} badge="3" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Admin" })).toHaveTextContent("3");
  });

  it("calls onClick", () => {
    const onClick = vi.fn();
    render(<RailButton label="Itineraries" icon={<svg />} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Itineraries" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("AccountMenu", () => {
  it("opens with the signed-in identity and focuses the first item", () => {
    renderMenu();
    const menu = openMenu();
    expect(menu).toHaveTextContent("Maria Santos");
    expect(menu).toHaveTextContent("maria@example.test");
    expect(menu).toHaveTextContent("Owner · Sunline Travel");
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "true");
  });

  it("moves between items with the arrow keys", () => {
    renderMenu();
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the avatar", () => {
    renderMenu();
    fireEvent.keyDown(openMenu(), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveFocus();
  });

  it("signs out", () => {
    const { onSignOut } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens account settings", () => {
    const { onOpenSettings } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Account settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("closes when you click outside", () => {
    renderMenu();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens with ArrowDown from the avatar", () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), { key: "ArrowDown" });
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx`
Expected: FAIL: `Failed to resolve import "../app/components/trip-dashboard/layout/AccountMenu.jsx"`.

- [ ] **Step 3: Create `RailButton.jsx`**

```jsx
"use client";

/**
 * One icon button in the app rail. On desktop its label is a tooltip that
 * shows on hover and keyboard focus; in the phone drawer the label sits
 * beside the icon. The accessible name is always `label`.
 */
export default function RailButton({ label, icon, active = false, badge = null, onClick, tourTarget }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-tour-target={tourTarget}
      onClick={onClick}
      className={[
        "group relative flex shrink-0 items-center transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "min-[901px]:h-10 min-[901px]:w-10 min-[901px]:justify-center min-[901px]:rounded-full",
        "max-[900px]:min-h-11 max-[900px]:w-full max-[900px]:gap-3 max-[900px]:rounded-xl max-[900px]:px-3",
        active ? "bg-secondary text-white dark:text-[#111416]" : "frame-tile text-text-muted hover:text-text-primary",
      ].join(" ")}
    >
      <span className="relative inline-flex" aria-hidden="true">
        {icon}
        {badge ? (
          <span className="absolute -right-2.5 -top-2 h-[18px] min-w-[18px] rounded-pill bg-secondary-strong px-1 text-center text-[11px] font-bold leading-[18px] text-on-secondary-strong">
            {badge}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={[
          "whitespace-nowrap text-[13px] font-semibold",
          "min-[901px]:pointer-events-none min-[901px]:absolute min-[901px]:left-[calc(100%+12px)] min-[901px]:top-1/2 min-[901px]:z-50 min-[901px]:-translate-y-1/2",
          "min-[901px]:rounded-md min-[901px]:bg-text-primary min-[901px]:px-2 min-[901px]:py-1 min-[901px]:text-[12px] min-[901px]:text-background",
          "min-[901px]:opacity-0 min-[901px]:transition-opacity min-[901px]:duration-150",
          "min-[901px]:group-hover:opacity-100 min-[901px]:group-focus-visible:opacity-100",
        ].join(" ")}
      >
        {label}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Create `AccountMenu.jsx`**

```jsx
"use client";

import { useEffect, useId, useRef, useState } from "react";

const ROLE_LABELS = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" };

/**
 * The avatar at the bottom of the rail and its account menu (WAI-ARIA menu
 * button). Click, Enter, Space or ArrowDown opens it with focus on the first
 * item; arrows, Home and End move between items; Escape closes it and returns
 * focus to the avatar; clicking outside or tabbing away closes it.
 */
export default function AccountMenu({ initials, displayName, email, role, agencyName, onOpenSettings, onSignOut }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return undefined;
    menuItems()[0]?.focus();
    function handlePointerDown(event) {
      if (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function handleMenuKeyDown(event) {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);
    const moves = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key in moves) {
      event.preventDefault();
      items[moves[event.key]]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  function choose(action) {
    setOpen(false);
    action?.();
  }

  const roleLine = [ROLE_LABELS[role], agencyName].filter(Boolean).join(" · ");
  const itemClass =
    "flex w-full items-center rounded-lg px-2 py-2 text-left text-[13px] text-text-primary hover:bg-text-primary/5 focus-visible:bg-text-primary/10 focus-visible:outline-none";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[12px] font-bold tracking-[0.04em] text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
      >
        {initials}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={handleMenuKeyDown}
          className="frame-popover frame-pop-in absolute bottom-0 left-[calc(100%+12px)] z-50 w-60 rounded-2xl p-2"
        >
          <div className="mb-1 border-b border-[color:var(--frame-border)] px-2 pb-2 pt-1">
            <p className="truncate text-[13px] font-semibold text-text-primary">{displayName}</p>
            {email ? <p className="truncate text-[12px] text-text-muted">{email}</p> : null}
            {roleLine ? <p className="truncate text-[12px] text-text-muted">{roleLine}</p> : null}
          </div>
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => choose(onOpenSettings)}>
            Account settings
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => choose(onSignOut)}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/trip-dashboard/layout/RailButton.jsx app/components/trip-dashboard/layout/AccountMenu.jsx tests/dashboard-rail.test.jsx
git commit -m "feat(layout): add rail button and account menu"
```

---

## Task 11: Icon rail

**Repo:** Voyage-Client

**Files:**
- Modify: `app/components/trip-dashboard/layout/DashboardSidebar.jsx` (replace the whole file)
- Test: `tests/dashboard-rail.test.jsx` (extend)

- [ ] **Step 1: Write the failing tests**

In `tests/dashboard-rail.test.jsx`, add below the existing imports:

```jsx
import DashboardSidebar from "../app/components/trip-dashboard/layout/DashboardSidebar.jsx";
```

Append:

```jsx

const agencyOwner = {
  id: "u1",
  displayName: "Maria Santos",
  email: "maria@example.test",
  accountType: "AGENCY_USER",
  role: "USER",
  memberships: [
    { agencyId: "agency-1", role: "OWNER", status: "ACTIVE", agency: { id: "agency-1", name: "Sunline Travel" } },
  ],
};

function renderRail(props = {}) {
  const handlers = { setActiveTab: vi.fn(), setIsSidebarOpen: vi.fn(), logout: vi.fn() };
  const utils = render(
    <DashboardSidebar
      isSidebarOpen={false}
      activeTab="dashboard"
      user={agencyOwner}
      agencyId="agency-1"
      pendingCount={0}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...utils };
}

describe("DashboardSidebar rail", () => {
  it("names every destination and marks the current one", () => {
    renderRail();
    for (const name of ["Dashboard", "Command Center", "Itineraries", "Settings"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
  });

  it("shows the logo with the workspace name", () => {
    renderRail();
    expect(screen.getByRole("img", { name: "Sunline Travel workspace" })).toBeInTheDocument();
  });

  it("switches tabs", () => {
    const { setActiveTab } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("keeps the first-use tour targets", () => {
    const { container } = renderRail();
    expect(container.querySelector('[data-tour-target="settings-replay"]')).toHaveAccessibleName("Settings");
    expect(container.querySelector('[data-tour-target="dashboard-overview"]')).toHaveAccessibleName("Dashboard");
  });

  it("shows Admin with its pending count to super admins", () => {
    renderRail({ user: { ...agencyOwner, role: "SUPER_ADMIN" }, pendingCount: 120 });
    expect(screen.getByRole("button", { name: "Admin" })).toHaveTextContent("99+");
  });

  it("calls a personal account's settings My account and has no Dashboard", () => {
    renderRail({ user: { id: "u2", displayName: "Pat", accountType: "PERSONAL", memberships: [] }, agencyId: null });
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My account" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Voyage workspace" })).toBeInTheDocument();
  });

  it("signs out from the account menu", () => {
    const { logout } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menu", { name: "Account" })).toHaveTextContent("Owner · Sunline Travel");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("offers a theme switch", () => {
    renderRail();
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx`
Expected: FAIL. For example, `Unable to find an accessible element with the role "img" and name "Sunline Travel workspace"`, and `Logout` is still present.

- [ ] **Step 3: Rewrite the sidebar as a rail**

Replace the whole content of `app/components/trip-dashboard/layout/DashboardSidebar.jsx` with:

```jsx
"use client";

import { useTheme } from "../../theme/ThemeProvider";
import { getInitials } from "../../../lib/formatters.js";
import useMobileViewport from "../mobile/useMobileViewport.js";
import AccountMenu from "./AccountMenu.jsx";
import RailButton from "./RailButton.jsx";

function Icon({ children }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  dashboard: (
    <Icon>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </Icon>
  ),
  commandCenter: (
    <Icon>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  ),
  itineraries: (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </Icon>
  ),
  admin: (
    <Icon>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  ),
  sun: (
    <Icon>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </Icon>
  ),
  moon: (
    <Icon>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Icon>
  ),
};

/**
 * App navigation. Desktop: a 72px icon rail inside the glass frame (logo,
 * destinations, theme switch, account menu). Phones (≤900px): the same items
 * in a slide-in glass drawer under the header, with the account inline.
 */
export default function DashboardSidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  activeTab,
  setActiveTab,
  logout,
  user,
  pendingCount,
  agencyId,
}) {
  const { theme, setTheme } = useTheme();
  const isMobile = useMobileViewport();
  const isDark = theme === "dark";
  const isAdmin = user?.role === "SUPER_ADMIN";
  const isPersonal = user?.accountType === "PERSONAL";
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  const hasAgencyMembership = memberships.some((m) => m?.status === "ACTIVE" && m?.agencyId);
  const membership = memberships.find((m) => m?.agencyId === agencyId) ?? null;
  const workspaceName = (!isPersonal && membership?.agency?.name) || "Voyage";
  const displayName = user?.displayName || "Traveler";

  const items = [
    hasAgencyMembership && !isPersonal && agencyId
      ? { tab: "dashboard", label: "Dashboard", icon: ICONS.dashboard, tourTarget: "dashboard-overview" }
      : null,
    { tab: "command-center", label: "Command Center", icon: ICONS.commandCenter },
    { tab: "itineraries", label: "Itineraries", icon: ICONS.itineraries },
    isAdmin
      ? {
          tab: "admin",
          label: "Admin",
          icon: ICONS.admin,
          badge: pendingCount > 0 ? (pendingCount > 99 ? "99+" : String(pendingCount)) : null,
        }
      : null,
    { tab: "settings", label: isPersonal ? "My account" : "Settings", icon: ICONS.settings, tourTarget: "settings-replay" },
  ].filter(Boolean);

  function go(tab) {
    setActiveTab(tab);
    if (isMobile) setIsSidebarOpen(false);
  }

  return (
    <>
      {isSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 top-12 z-[45] hidden bg-black/40 backdrop-blur-[4px] max-[900px]:block"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}
      <aside
        aria-label="Dashboard navigation"
        className={[
          "z-50 flex flex-shrink-0 flex-col gap-2",
          "min-[901px]:relative min-[901px]:w-[72px] min-[901px]:items-center min-[901px]:py-4",
          "max-[900px]:frame-panel max-[900px]:fixed max-[900px]:bottom-0 max-[900px]:left-0 max-[900px]:top-12 max-[900px]:w-64 max-[900px]:px-4 max-[900px]:py-5",
          "max-[900px]:transition-transform max-[900px]:duration-300",
          isSidebarOpen ? "max-[900px]:translate-x-0" : "max-[900px]:-translate-x-full",
        ].join(" ")}
      >
        <img
          src="/icon.svg"
          alt={`${workspaceName} workspace`}
          title={workspaceName}
          className="mb-2 h-8 w-8 max-[900px]:hidden"
        />

        <nav aria-label="Main" className="flex flex-col gap-2 min-[901px]:items-center">
          {items.map((item) => (
            <RailButton
              key={item.tab}
              label={item.label}
              icon={item.icon}
              badge={item.badge ?? null}
              tourTarget={item.tourTarget}
              active={activeTab === item.tab}
              onClick={() => go(item.tab)}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 min-[901px]:items-center">
          <RailButton
            label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            icon={isDark ? ICONS.sun : ICONS.moon}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          />
          {isMobile ? (
            <div className="mt-2 border-t border-[color:var(--frame-border)] pt-3">
              <p className="truncate text-[13px] font-semibold text-text-primary">{displayName}</p>
              {user?.email ? <p className="truncate text-[12px] text-text-muted">{user.email}</p> : null}
              <button
                type="button"
                onClick={logout}
                className="frame-tile mt-3 min-h-11 w-full rounded-xl px-3 text-left text-[13px] font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                Sign out
              </button>
            </div>
          ) : (
            <AccountMenu
              initials={getInitials(displayName)}
              displayName={displayName}
              email={user?.email ?? null}
              role={isPersonal ? null : membership?.role ?? null}
              agencyName={isPersonal ? null : membership?.agency?.name ?? null}
              onOpenSettings={() => go("settings")}
              onSignOut={logout}
            />
          )}
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/layout/DashboardSidebar.jsx tests/dashboard-rail.test.jsx
git commit -m "feat(layout): replace the labelled sidebar with an icon rail"
```

---

## Task 12: Glass frame and slimmer header

**Repo:** Voyage-Client

**Files:**
- Modify: `app/components/trip-dashboard/layout/DashboardHeader.jsx` (replace the whole file)
- Modify: `app/components/trip-dashboard/HomePage.jsx`
- Test: `tests/home-page-dashboard-tab.test.jsx`, `tests/home-page.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tests/home-page-dashboard-tab.test.jsx`, add inside `describe("HomePage Dashboard tab", …)` (after the first test):

```jsx
  it("hides the Command Center header controls on the Dashboard", () => {
    render(<HomePage user={agencyUser("OWNER")} initialTab="dashboard" />);

    expect(screen.queryByRole("button", { name: "New Itinerary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle menu" })).not.toBeInTheDocument();
  });

  it("keeps the Command Center header on the Command Center tab", () => {
    render(<HomePage user={agencyUser("OWNER")} initialTab="command-center" />);

    expect(screen.getByRole("button", { name: "New Itinerary" })).toBeInTheDocument();
  });
```

In `tests/home-page.test.jsx`, replace:

```jsx
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
```

with:

```jsx
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/home-page-dashboard-tab.test.jsx tests/home-page.test.jsx`
Expected: FAIL. "hides the Command Center header controls" fails because `New Itinerary` is still rendered on the Dashboard.

- [ ] **Step 3: Rewrite the header**

Replace the whole content of `app/components/trip-dashboard/layout/DashboardHeader.jsx` with:

```jsx
import React from "react";
import ClientSwitcher from "../command-center/ClientSwitcher.jsx";

/**
 * Top bar for the Command Center, Itineraries, Settings and Admin tabs:
 * New Itinerary, the client/trip switcher, "Save to Client" and the agent's
 * live status. The brand and the account live in the rail.
 *
 * `variant="compact"` (phones, Dashboard tab) keeps only the menu button and
 * the logo. On desktop the Dashboard renders no header at all.
 */
export default function DashboardHeader({
  variant = "full",
  isSidebarOpen,
  setIsSidebarOpen,
  liveStatus,
  scopedStreamError,
  scopedIsStreaming,
  getInitials,
  activeTab,
  // Trip management props
  onNewItinerary,
  isCreatingDraftThread,
  isClientMenuOpen,
  setIsClientMenuOpen,
  clientMenuRef,
  hasOptions,
  activeTripClientName,
  activeTripInitials,
  activeTripOrganizerInitials,
  clientMenuEmptyTitle,
  clientMenuEmptyBody,
  safeOptions,
  activeOption,
  onPlanningOptionDelete,
  deletingThreadId,
  onPlanningOptionChange,
  onRenameThread,
  canApproveDraft,
  onApproveDraft
}) {
  const isFull = variant === "full";
  const showCenterActions = isFull && activeTab !== "itineraries";
  return (
    <header className="z-[100] flex h-[84px] flex-shrink-0 items-center justify-between gap-5 border-b border-[color:var(--frame-border)] px-7 max-[900px]:h-[48px] max-[900px]:gap-2 max-[900px]:px-3">
      <div className="flex items-center gap-2">
        <button
          className="hidden max-[900px]:flex bg-transparent border-none text-primary p-2 cursor-pointer"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isSidebarOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        {!isFull ? <img src="/icon.svg" alt="Voyage" className="h-7 w-7" /> : null}
      </div>

      {showCenterActions && (
        <div className="flex items-center gap-3 flex-1 justify-center min-w-0 max-[900px]:gap-1.5">
          <button
            data-tour-target="new-itinerary"
            className="inline-flex items-center gap-2 border border-border/10 rounded-pill bg-white/10 text-text-primary px-[18px] text-[13px] font-bold tracking-[-0.01em] cursor-pointer whitespace-nowrap shadow-sm transition-all duration-200 h-11 hover:-translate-y-px hover:bg-white/15 hover:shadow-md disabled:cursor-wait disabled:opacity-50 disabled:translate-y-0 max-[900px]:w-8 max-[900px]:h-8 max-[900px]:px-0 max-[900px]:justify-center max-[900px]:rounded-full max-[900px]:border-none max-[900px]:shadow-none"
            onClick={() => onNewItinerary?.()}
            disabled={isCreatingDraftThread}
            type="button"
            aria-label="New Itinerary"
          >
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-pill bg-white/10 text-sm leading-none" aria-hidden="true">+</span>
            <span className="max-[900px]:hidden">{isCreatingDraftThread ? "Creating..." : "New Itinerary"}</span>
          </button>

          <div className="flex items-center gap-3 min-w-0 max-[900px]:gap-1.5">
            <div data-tour-target="client-switcher" className="min-w-0">
              <ClientSwitcher
                isClientMenuOpen={isClientMenuOpen}
                setIsClientMenuOpen={setIsClientMenuOpen}
                clientMenuRef={clientMenuRef}
                hasOptions={hasOptions}
                activeTripClientName={activeTripClientName}
                activeTripInitials={activeTripInitials}
                activeTripOrganizerInitials={activeTripOrganizerInitials}
                clientMenuEmptyTitle={clientMenuEmptyTitle}
                clientMenuEmptyBody={clientMenuEmptyBody}
                safeOptions={safeOptions}
                activeOption={activeOption}
                getInitials={getInitials}
                onPlanningOptionDelete={onPlanningOptionDelete}
                deletingThreadId={deletingThreadId}
                onPlanningOptionChange={onPlanningOptionChange}
                onRenameThread={onRenameThread}
              />
            </div>
            {canApproveDraft && (
              <button
                className="inline-flex items-center justify-center border border-border/10 rounded-pill bg-surface-elevated text-text-primary px-4 text-[13px] font-extrabold cursor-pointer whitespace-nowrap h-11 hover:border-secondary hover:text-secondary transition-colors shadow-sm max-[900px]:h-8 max-[900px]:px-2.5 max-[900px]:text-[11px]"
                onClick={() => onApproveDraft?.()}
                type="button"
              >
                Save<span className="max-[900px]:hidden"> to Client</span>
              </button>
            )}
          </div>
        </div>
      )}

      {isFull ? (
        <div className="flex items-center">
          <div
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-pill text-xs font-semibold border transition-colors max-[900px]:hidden ${
              scopedStreamError
                ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900"
                : scopedIsStreaming
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900"
                : "bg-white/5 text-text-primary border-border/10"
            }`}
          >
            <span className="w-2 h-2 rounded-pill bg-current" />
            {liveStatus}
          </div>
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 4: Put the app in the glass frame**

In `app/components/trip-dashboard/HomePage.jsx`:

**4a.** Find:

```jsx
  const currentTab = activeTab === "dashboard" && user && (isPersonal || !agencyId)
    ? "command-center"
    : activeTab;
```

and add directly below it:

```jsx

  // The Dashboard has its own greeting row; on phones the header stays for the menu button.
  const showHeader = currentTab !== "dashboard" || isMobile;
```

**4b.** Replace the root element's opening line:

```jsx
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-text-primary font-sans">
```

with:

```jsx
    <div className="relative flex h-screen w-screen overflow-hidden bg-background text-text-primary font-sans">
      <div className="app-frame-streak" aria-hidden="true" />
```

**4c.** Replace this block (from the `<div>` wrapping `<DashboardHeader` down to the `<main …>` opening tag):

```jsx
      <div>
        <DashboardHeader
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          liveStatus={liveStatus}
          scopedStreamError={isVisible ? streamError : null}
          scopedIsStreaming={isVisible ? isStreaming : false}
          getInitials={getInitials}
          displayName={user?.displayName || "Traveler"}
          agencyId={agencyId}
          activeTab={currentTab}
          onNewItinerary={() => {
            setPendingClientName(null);
            handleNewItinerary();
          }}
          isCreatingDraftThread={isCreatingDraftThread}
          isClientMenuOpen={isClientMenuOpen}
          setIsClientMenuOpen={setIsClientMenuOpen}
          clientMenuRef={clientMenuRef}
          hasOptions={effectivePlanningOptions.length > 0}
          activeTripClientName={activeTripClientName}
          activeTripInitials={activeTripInitials}
          activeTripOrganizerInitials={activeTripOrganizerInitials}
          clientMenuEmptyTitle={clientMenuEmptyTitle}
          clientMenuEmptyBody={clientMenuEmptyBody}
          safeOptions={currentTab === "itineraries" ? effectivePlanningOptions.filter(o => o.type !== "draft") : effectivePlanningOptions}
          activeOption={effectiveActiveOption}
          onPlanningOptionDelete={handleDeleteOption}
          deletingThreadId={deletingThreadId}
          onPlanningOptionChange={(ctx) => { setActiveContext(createPlanningContext(ctx?.type, ctx?.id)); setComposerInput(""); }}
          onRenameThread={renameThread}
          canApproveDraft={activeContext?.type === "draft" && Boolean(activeTripState?.itinerary?.id)}
          onApproveDraft={() => { setApprovalError(""); setIsApprovalModalOpen(true); }}
        />
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <DashboardSidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          activeTab={currentTab}
          setActiveTab={setActiveTab}
          logout={logout}
          user={user}
          pendingCount={pendingCount}
          agencyId={agencyId}
        />

        <main className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 max-[900px]:p-0 max-[900px]:overflow-hidden">
```

with:

```jsx
      <div className="relative flex min-w-0 flex-1 p-4 max-[900px]:p-0">
        <div className="relative flex min-w-0 flex-1 overflow-hidden rounded-[24px] shadow-[0_24px_60px_rgba(15,23,42,0.12)] max-[900px]:rounded-none max-[900px]:shadow-none">
          {/* The glass sits on its own layer: a backdrop-filter on an ancestor
              would become the containing block for fixed children (slide-overs,
              the phone drawer) and trap them inside the frame. */}
          <div className="frame-panel pointer-events-none absolute inset-0 rounded-[inherit] max-[900px]:border-0" aria-hidden="true" />

          <DashboardSidebar
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            activeTab={currentTab}
            setActiveTab={setActiveTab}
            logout={logout}
            user={user}
            pendingCount={pendingCount}
            agencyId={agencyId}
          />

          <div className="relative flex min-w-0 flex-1 flex-col">
            {showHeader ? (
              <DashboardHeader
                variant={currentTab === "dashboard" ? "compact" : "full"}
                isSidebarOpen={isSidebarOpen}
                setIsSidebarOpen={setIsSidebarOpen}
                liveStatus={liveStatus}
                scopedStreamError={isVisible ? streamError : null}
                scopedIsStreaming={isVisible ? isStreaming : false}
                getInitials={getInitials}
                activeTab={currentTab}
                onNewItinerary={() => {
                  setPendingClientName(null);
                  handleNewItinerary();
                }}
                isCreatingDraftThread={isCreatingDraftThread}
                isClientMenuOpen={isClientMenuOpen}
                setIsClientMenuOpen={setIsClientMenuOpen}
                clientMenuRef={clientMenuRef}
                hasOptions={effectivePlanningOptions.length > 0}
                activeTripClientName={activeTripClientName}
                activeTripInitials={activeTripInitials}
                activeTripOrganizerInitials={activeTripOrganizerInitials}
                clientMenuEmptyTitle={clientMenuEmptyTitle}
                clientMenuEmptyBody={clientMenuEmptyBody}
                safeOptions={currentTab === "itineraries" ? effectivePlanningOptions.filter(o => o.type !== "draft") : effectivePlanningOptions}
                activeOption={effectiveActiveOption}
                onPlanningOptionDelete={handleDeleteOption}
                deletingThreadId={deletingThreadId}
                onPlanningOptionChange={(ctx) => { setActiveContext(createPlanningContext(ctx?.type, ctx?.id)); setComposerInput(""); }}
                onRenameThread={renameThread}
                canApproveDraft={activeContext?.type === "draft" && Boolean(activeTripState?.itinerary?.id)}
                onApproveDraft={() => { setApprovalError(""); setIsApprovalModalOpen(true); }}
              />
            ) : null}

            <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 max-[900px]:overflow-hidden max-[900px]:p-0">
```

**4d.** Replace the end of the component's JSX:

```jsx
          ) : null}
        </main>
      </div>

    </div>
  );
}
```

with:

```jsx
          ) : null}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Leave the tab content inside `<main>` exactly as it is; don't re-indent it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/home-page-dashboard-tab.test.jsx tests/home-page.test.jsx tests/home-page-traveler-needs.test.jsx tests/prototype-flow.test.jsx`
Expected: PASS, apart from failures already on the Task 9 baseline.

- [ ] **Step 6: Commit**

```bash
git add app/components/trip-dashboard/layout/DashboardHeader.jsx app/components/trip-dashboard/HomePage.jsx tests/home-page-dashboard-tab.test.jsx tests/home-page.test.jsx
git commit -m "feat(layout): wrap the app in a glass frame and drop the header on the Dashboard"
```

---

## Task 13: Team in Settings and team deep links

**Repo:** Voyage-Client

**Files:**
- Create: `app/lib/deepLinks.js`
- Modify: `app/page.jsx`, `app/components/trip-dashboard/HomePage.jsx`, `app/components/trip-dashboard/pages/SettingsPage.jsx`, `app/components/team/TeamPage.jsx`
- Test: `tests/deep-links.test.js`, `tests/settings-team.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/deep-links.test.js`:

```js
import { describe, expect, it } from "vitest";
import { resolveInitialView } from "../app/lib/deepLinks.js";

const view = (query) => resolveInitialView(new URLSearchParams(query));

describe("resolveInitialView", () => {
  it("opens the Command Center by default", () => {
    expect(view("authenticated=1")).toEqual({ initialTab: "command-center", showJoinedNotice: false, settingsSection: null });
  });

  it("opens the Dashboard with the joined notice after an invite is accepted", () => {
    expect(view("authenticated=1&tab=team&invited=1")).toEqual({
      initialTab: "dashboard",
      showJoinedNotice: true,
      settingsSection: null,
    });
  });

  it("opens Settings at the Team panel for a plain team link", () => {
    expect(view("authenticated=1&tab=team")).toEqual({ initialTab: "settings", showJoinedNotice: false, settingsSection: "team" });
  });
});
```

Create `tests/settings-team.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/components/team/TeamPage.jsx", () => ({
  default: ({ agencyId, embedded }) => (
    <div data-testid="team-page" data-agency={agencyId} data-embedded={String(embedded)} />
  ),
}));
vi.mock("../app/lib/api/support.js", () => ({ createProblemReport: vi.fn() }));

import SettingsPage from "../app/components/trip-dashboard/pages/SettingsPage.jsx";

const agencyMember = { id: "u1", displayName: "Maria", email: "maria@example.test", accountType: "AGENCY_USER" };
const agency = { id: "agency-1", name: "Sunline Travel", status: "VERIFIED" };

function renderSettings(props = {}) {
  return render(
    <SettingsPage
      user={agencyMember}
      agency={agency}
      membership={{ role: "STAFF", status: "ACTIVE" }}
      logout={vi.fn()}
      onUpdateProfile={vi.fn()}
      onUpdateAgency={vi.fn()}
      onReplayTutorial={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings Team panel", () => {
  it("shows the agency team inside Settings for every member", () => {
    renderSettings();

    const team = screen.getByRole("region", { name: "Team" });
    expect(team).toContainElement(screen.getByTestId("team-page"));
    expect(screen.getByTestId("team-page")).toHaveAttribute("data-agency", "agency-1");
    expect(screen.getByTestId("team-page")).toHaveAttribute("data-embedded", "true");
  });

  it("has no Team panel for personal accounts", () => {
    renderSettings({ user: { id: "u2", displayName: "Pat", accountType: "PERSONAL" }, agency: null, membership: null });

    expect(screen.queryByRole("region", { name: "Team" })).not.toBeInTheDocument();
  });

  it("scrolls to the Team panel once when a team link opened Settings", () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const onFocusSectionHandled = vi.fn();

    renderSettings({ focusSection: "team", onFocusSectionHandled });

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(onFocusSectionHandled).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/deep-links.test.js tests/settings-team.test.jsx`
Expected: FAIL. `deepLinks.js` can't be resolved, and there is no region named "Team".

- [ ] **Step 3: Create `app/lib/deepLinks.js`**

```js
/**
 * Where an authenticated landing on `/` should open, from its query string.
 *
 * - `tab=team&invited=1` (invite just accepted): the Dashboard, with the
 *   "You joined this agency" notice.
 * - `tab=team` (e.g. /agency/:id/team): Settings, scrolled to the Team panel.
 * - anything else: the Command Center.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{ initialTab: string, showJoinedNotice: boolean, settingsSection: string | null }}
 */
export function resolveInitialView(searchParams) {
  const wantsTeam = searchParams.get("tab") === "team";
  const invited = searchParams.get("invited") === "1";

  if (wantsTeam && invited) {
    return { initialTab: "dashboard", showJoinedNotice: true, settingsSection: null };
  }
  if (wantsTeam) {
    return { initialTab: "settings", showJoinedNotice: false, settingsSection: "team" };
  }
  return { initialTab: "command-center", showJoinedNotice: false, settingsSection: null };
}
```

- [ ] **Step 4: Use it in `app/page.jsx`**

Add below `import { fetchApi } from "./lib/api/index.js";`:

```jsx
import { resolveInitialView } from "./lib/deepLinks.js";
```

Replace:

```jsx
  // Team lives inside the Dashboard tab, so the `tab=team` deep link (invite
  // acceptance, /agency/:id/team) opens the Dashboard — HomePage has no "team" tab.
  const requestedDashboardTab = searchParams.get("tab") === "team" ? "dashboard" : "command-center";
  const showJoinedNotice = requestedDashboardTab === "dashboard" && searchParams.get("invited") === "1";
```

with:

```jsx
  // `tab=team` links: invite acceptance lands on the Dashboard with a welcome
  // notice; other team links open Settings at the Team panel.
  const { initialTab, showJoinedNotice, settingsSection } = resolveInitialView(searchParams);
```

and in the `<HomePage …/>` element replace `initialTab={requestedDashboardTab}` with:

```jsx
        initialTab={initialTab}
        initialSettingsSection={settingsSection}
```

- [ ] **Step 5: Pass the focus through `HomePage.jsx`**

Replace:

```jsx
  initialTab = "command-center",
  showJoinedNotice = false,
}) {
```

with:

```jsx
  initialTab = "command-center",
  showJoinedNotice = false,
  initialSettingsSection = null,
}) {
```

Find `  const [activeTab, setActiveTab] = useState(initialTab);` and add directly below it:

```jsx
  const [settingsFocus, setSettingsFocus] = useState(initialSettingsSection);
  const clearSettingsFocus = useCallback(() => setSettingsFocus(null), []);
```

In the `<SettingsPage …/>` element, add after `onReplayTutorial={replayFirstUseTutorial}`:

```jsx
              focusSection={settingsFocus}
              onFocusSectionHandled={clearSettingsFocus}
```

- [ ] **Step 6: Add the Team panel to `SettingsPage.jsx`**

1. Replace `import { useEffect, useMemo, useState } from "react";` with `import { useEffect, useMemo, useRef, useState } from "react";`
2. Add below `import ReportProblemModal from "../../settings/ReportProblemModal.jsx";`:

```jsx
import TeamPage from "../../team/TeamPage.jsx";
```

3. In the props, replace

```jsx
  onReplayTutorial,
}) {
```

with

```jsx
  onReplayTutorial,
  focusSection = null,
  onFocusSectionHandled,
}) {
```

4. Find `  const [reportSent, setReportSent] = useState(false);` and add directly below it:

```jsx

  const teamRef = useRef(null);

  // A `tab=team` link opens Settings scrolled to the Team panel, once.
  useEffect(() => {
    if (focusSection !== "team" || !teamRef.current) return;
    teamRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    onFocusSectionHandled?.();
  }, [focusSection, onFocusSectionHandled]);
```

5. Find `        {!isPersonal && membership?.role === "OWNER" && agency?.id ? (` (the DangerZoneCard block) and insert directly **above** it:

```jsx
        {!isPersonal && agency?.id ? (
          <section
            ref={teamRef}
            id="settings-team"
            aria-label="Team"
            className="scroll-mt-4 rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] xl:col-span-2"
          >
            <TeamPage agencyId={agency.id} embedded />
          </section>
        ) : null}

```

- [ ] **Step 7: Let `TeamPage` sit inside a panel**

In `app/components/team/TeamPage.jsx`:

1. Replace `export default function TeamPage({ agencyId, showJoinedNotice = false }) {` with:

```jsx
export default function TeamPage({ agencyId, showJoinedNotice = false, embedded = false }) {
```

2. Replace `    <div className="mx-auto max-w-3xl px-6 py-8">` with:

```jsx
    <div className={embedded ? "" : "mx-auto max-w-3xl px-6 py-8"}>
```

3. Replace `        <h1 className="text-xl text-text-primary">Team</h1>` with:

```jsx
        {embedded ? (
          <h2 className="font-sans text-lg font-semibold tracking-normal text-text-primary">Team</h2>
        ) : (
          <h1 className="text-xl text-text-primary">Team</h1>
        )}
```

4. Replace the Invite button's class

```jsx
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
```

with

```jsx
            className="rounded-lg bg-secondary-strong px-4 py-2 text-sm font-semibold text-on-secondary-strong shadow-sm hover:opacity-90 transition"
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/deep-links.test.js tests/settings-team.test.jsx tests/home-page.test.jsx tests/agency-invite-landing.test.jsx`
Expected: PASS, apart from failures already on the baseline.

- [ ] **Step 9: Commit**

```bash
git add app/lib/deepLinks.js app/page.jsx app/components/trip-dashboard/HomePage.jsx app/components/trip-dashboard/pages/SettingsPage.jsx app/components/team/TeamPage.jsx tests/deep-links.test.js tests/settings-team.test.jsx
git commit -m "feat(settings): move Team into Settings and route team links there"
```

---

## Task 14: Calendar day helpers

**Repo:** Voyage-Client

**Files:**
- Create: `app/lib/calendarDays.js`
- Test: `tests/calendar-days.test.js` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/calendar-days.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  buildCalendarDays,
  describeDayItems,
  fullDayLabel,
  gridRange,
  relativeDayLabel,
  toDateKey,
} from "../app/lib/calendarDays.js";

const OCT = new Date(2026, 9, 1);
const TODAY = new Date(2026, 9, 3, 10, 0);

function payload(overrides = {}) {
  return {
    from: "2026-09-27",
    to: "2026-11-07",
    generatedAt: "2026-10-03T02:00:00.000Z",
    tripsWithoutDates: 0,
    trips: [],
    events: [],
    ...overrides,
  };
}

const kyoto = {
  tripId: "t-kyoto",
  tripTitle: "Kyoto Autumn Escape",
  clientName: "Reyes",
  placeLabel: "Kyoto",
  startDate: "2026-10-08",
  endDate: "2026-10-14",
  status: "APPROVED_INTERNAL",
  travelerCount: 2,
};

const cellFor = (cells, key) => cells.find((cell) => cell.key === key);

describe("gridRange", () => {
  it("covers six Sunday-first weeks around the month", () => {
    const { start, end } = gridRange(OCT);
    expect(toDateKey(start)).toBe("2026-09-27");
    expect(toDateKey(end)).toBe("2026-11-07");
  });
});

describe("buildCalendarDays", () => {
  it("returns 42 days and flags the month and today", () => {
    const cells = buildCalendarDays(payload(), OCT, TODAY);
    expect(cells).toHaveLength(42);
    expect(cellFor(cells, "2026-09-30").inMonth).toBe(false);
    expect(cellFor(cells, "2026-10-01").inMonth).toBe(true);
    expect(cells.filter((cell) => cell.isToday).map((cell) => cell.key)).toEqual(["2026-10-03"]);
  });

  it("spreads a trip across its days and labels the start of each week", () => {
    const cells = buildCalendarDays(payload({ trips: [kyoto] }), OCT, TODAY);
    expect(cells.filter((cell) => cell.spans.length > 0).map((cell) => cell.key)).toEqual([
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(cellFor(cells, "2026-10-08").spans[0]).toMatchObject({ isStart: true, showLabel: true, dayNumber: 1, totalDays: 7 });
    expect(cellFor(cells, "2026-10-10").spans[0].showLabel).toBe(false);
    expect(cellFor(cells, "2026-10-11").spans[0].showLabel).toBe(true); // Sunday starts a new row
    expect(cellFor(cells, "2026-10-14").spans[0]).toMatchObject({ isEnd: true, dayNumber: 7 });
  });

  it("marks trips that already ended", () => {
    const cells = buildCalendarDays(payload({ trips: [{ ...kyoto, startDate: "2026-09-27", endDate: "2026-10-02" }] }), OCT, TODAY);
    expect(cellFor(cells, "2026-09-28").spans[0].isPast).toBe(true);
  });

  it("puts an event on the viewer's local day", () => {
    const lateEvening = new Date(2026, 9, 8, 23, 30).toISOString();
    const event = {
      id: "client_viewed:s1",
      kind: "client_viewed",
      tripId: "t1",
      tripTitle: "Lisbon Getaway",
      clientName: "Tanaka",
      occurredAt: lateEvening,
      detail: { viewCount: 4 },
    };
    const cells = buildCalendarDays(payload({ events: [event] }), OCT, TODAY);
    expect(cellFor(cells, "2026-10-08").events).toEqual([event]);
    expect(cellFor(cells, "2026-10-09").events).toEqual([]);
  });

  it("shows an empty grid while the calendar is loading", () => {
    const cells = buildCalendarDays(null, OCT, TODAY);
    expect(cells.every((cell) => cell.spans.length === 0 && cell.events.length === 0)).toBe(true);
  });
});

describe("describeDayItems", () => {
  it("describes departure, middle and return days", () => {
    const cells = buildCalendarDays(payload({ trips: [kyoto] }), OCT, TODAY);
    expect(describeDayItems(cellFor(cells, "2026-10-08"))[0]).toMatchObject({
      kind: "trip",
      tripId: "t-kyoto",
      title: "Reyes · Kyoto departs",
      detail: "6 nights · 2 travelers",
      actionLabel: "Open trip",
    });
    expect(describeDayItems(cellFor(cells, "2026-10-10"))[0]).toMatchObject({ title: "Reyes in Kyoto", detail: "Day 3 of 7" });
    expect(describeDayItems(cellFor(cells, "2026-10-14"))[0]).toMatchObject({ title: "Reyes · Kyoto returns", detail: "2 travelers" });
  });

  it("calls a one-day trip a day trip", () => {
    const cells = buildCalendarDays(payload({ trips: [{ ...kyoto, endDate: "2026-10-08", travelerCount: null }] }), OCT, TODAY);
    expect(describeDayItems(cellFor(cells, "2026-10-08"))[0]).toMatchObject({ title: "Reyes · Kyoto departs", detail: "Day trip" });
  });

  it("describes each kind of client activity", () => {
    const at = new Date(2026, 9, 5, 9).toISOString();
    const base = { tripId: "t1", tripTitle: "Lisbon Getaway", clientName: "Tanaka", occurredAt: at };
    const events = [
      { ...base, id: "share_sent:s1", kind: "share_sent", detail: {} },
      { ...base, id: "share_expires:s1", kind: "share_expires", detail: {} },
      { ...base, id: "client_viewed:s1", kind: "client_viewed", detail: { viewCount: 4 } },
      { ...base, id: "client_commented:c1", kind: "client_commented", detail: { excerpt: "Can we swap lunch?" } },
      { ...base, id: "proposal_rated:s1", kind: "proposal_rated", detail: { rating: 5 } },
      { ...base, id: "review_submitted:r1", kind: "review_submitted", detail: { rating: 4, excerpt: "Lovely" } },
    ];
    const cells = buildCalendarDays(payload({ events }), OCT, TODAY);
    expect(
      describeDayItems(cellFor(cells, "2026-10-05")).map(({ title, detail, actionLabel }) => [title, detail, actionLabel]),
    ).toEqual([
      ["Sent Lisbon Getaway to Tanaka", "Itinerary link shared", "Open trip"],
      ["Lisbon Getaway link expires", "Shared with Tanaka", "Open trip"],
      ["Tanaka viewed Lisbon Getaway", "4 views in total", "Open trip"],
      ["Tanaka commented", "“Can we swap lunch?”", "Reply"],
      ["Tanaka rated the proposal", "5 out of 5", "Open trip"],
      ["Tanaka reviewed Lisbon Getaway", "4 out of 5 · “Lovely”", "Open trip"],
    ]);
  });
});

describe("day labels", () => {
  it("names the day in full", () => {
    expect(fullDayLabel(new Date(2026, 9, 8))).toBe("Thursday, October 8");
  });

  it("says how far a day is from today", () => {
    expect(relativeDayLabel("2026-10-03", "2026-10-03")).toBe("Today");
    expect(relativeDayLabel("2026-10-04", "2026-10-03")).toBe("Tomorrow");
    expect(relativeDayLabel("2026-10-02", "2026-10-03")).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-08", "2026-10-03")).toBe("In 5 days");
    expect(relativeDayLabel("2026-09-30", "2026-10-03")).toBe("3 days ago");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js`
Expected: FAIL: `Failed to resolve import "../app/lib/calendarDays.js"`.

- [ ] **Step 3: Implement `app/lib/calendarDays.js`**

```js
/**
 * Pure helpers for the dashboard month calendar. Trip dates are calendar
 * dates ("YYYY-MM-DD") and are compared as strings; event times are instants
 * that land on the viewer's local day.
 */

export const GRID_DAYS = 42;
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");

/** Local calendar date of a Date, as YYYY-MM-DD. */
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD key. */
export function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** The first day of the month `months` away from `date`'s month. */
export function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** The Sunday-first six-week grid that contains `month`. */
export function gridRange(month) {
  const first = startOfMonth(month);
  const start = addDays(first, -first.getDay());
  return { start, end: addDays(start, GRID_DAYS - 1) };
}

/** Whole days from `fromKey` to `toKey` (rounded, so DST shifts don't matter). */
export function daysBetweenKeys(fromKey, toKey) {
  return Math.round((fromDateKey(toKey) - fromDateKey(fromKey)) / DAY_MS);
}

/** "Thursday, October 8". */
export function fullDayLabel(date) {
  return `${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/** "Today", "Tomorrow", "Yesterday", "In 5 days" or "3 days ago". */
export function relativeDayLabel(key, todayKey) {
  const diff = daysBetweenKeys(todayKey, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 1 ? `In ${diff} days` : `${-diff} days ago`;
}

/**
 * The 42 cells of the month grid, Sunday first. Each cell carries the trips
 * spanning that day (with where the day falls in the trip) and the events
 * that happened on it, in the server's time order.
 *
 * @param {object|null} payload  calendar payload, or null while loading
 * @param {Date} month           any day in the month to show
 * @param {Date} [today]
 */
export function buildCalendarDays(payload, month, today = new Date()) {
  const { start } = gridRange(month);
  const todayKey = toDateKey(today);
  const monthIndex = month.getMonth();

  const eventsByDay = new Map();
  for (const event of payload?.events ?? []) {
    const key = toDateKey(new Date(event.occurredAt));
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(event);
  }

  const cells = [];
  for (let index = 0; index < GRID_DAYS; index += 1) {
    const date = addDays(start, index);
    const key = toDateKey(date);
    const spans = [];
    for (const trip of payload?.trips ?? []) {
      if (key < trip.startDate || key > trip.endDate) continue;
      const isStart = key === trip.startDate;
      spans.push({
        ...trip,
        isStart,
        isEnd: key === trip.endDate,
        showLabel: isStart || index % 7 === 0,
        isPast: trip.endDate < todayKey,
        dayNumber: daysBetweenKeys(trip.startDate, key) + 1,
        totalDays: daysBetweenKeys(trip.startDate, trip.endDate) + 1,
      });
    }
    cells.push({
      key,
      date,
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      isToday: key === todayKey,
      spans,
      events: eventsByDay.get(key) ?? [],
    });
  }
  return cells;
}

const travelers = (count) => (count == null ? null : `${count} traveler${count === 1 ? "" : "s"}`);
const views = (count) => (count === 1 ? "Viewed once" : `${count ?? 0} views in total`);
const quote = (text) => (text ? `“${text}”` : null);

function spanCopy(span) {
  const who = span.clientName ? `${span.clientName} · ` : "";
  if (span.isStart) {
    const nights = span.totalDays - 1;
    const length = nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Day trip";
    return {
      title: `${who}${span.placeLabel} departs`,
      detail: [length, travelers(span.travelerCount)].filter(Boolean).join(" · "),
    };
  }
  if (span.isEnd) {
    return { title: `${who}${span.placeLabel} returns`, detail: travelers(span.travelerCount) ?? span.tripTitle };
  }
  return {
    title: `${span.clientName ?? span.tripTitle} in ${span.placeLabel}`,
    detail: `Day ${span.dayNumber} of ${span.totalDays}`,
  };
}

const EVENT_COPY = {
  share_sent: (e) => ({
    title: `Sent ${e.tripTitle}${e.clientName ? ` to ${e.clientName}` : ""}`,
    detail: "Itinerary link shared",
  }),
  share_expires: (e) => ({
    title: `${e.tripTitle} link expires`,
    detail: e.clientName ? `Shared with ${e.clientName}` : "Itinerary link",
  }),
  client_viewed: (e) => ({ title: `${e.clientName ?? "Client"} viewed ${e.tripTitle}`, detail: views(e.detail?.viewCount) }),
  client_commented: (e) => ({ title: `${e.clientName ?? "Client"} commented`, detail: quote(e.detail?.excerpt) ?? e.tripTitle }),
  proposal_rated: (e) => ({ title: `${e.clientName ?? "Client"} rated the proposal`, detail: `${e.detail?.rating} out of 5` }),
  review_submitted: (e) => ({
    title: `${e.clientName ?? "Client"} reviewed ${e.tripTitle}`,
    detail: [`${e.detail?.rating} out of 5`, quote(e.detail?.excerpt)].filter(Boolean).join(" · "),
  }),
};

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
      ...copy(event),
    });
  }
  return items;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/calendar-days.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/calendarDays.js tests/calendar-days.test.js
git commit -m "feat(dashboard): add calendar grid and day-copy helpers"
```

---

## Task 15: `useCalendarEvents` hook

**Repo:** Voyage-Client

**Files:**
- Create: `app/hooks/useCalendarEvents.js`
- Test: `tests/use-calendar-events.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/use-calendar-events.test.jsx`:

```jsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("../app/lib/api/client.js", () => ({
  API_URL: "/api",
  fetchApi: (...args) => mocks.fetchApi(...args),
}));

import { useCalendarEvents } from "../app/hooks/useCalendarEvents.js";

const OCT = new Date(2026, 9, 1);
const NOV = new Date(2026, 10, 1);

const payloadFrom = (from) => ({ from, to: "", generatedAt: "", tripsWithoutDates: 0, trips: [], events: [] });
const fromOf = (url) => new URLSearchParams(url.split("?")[1]).get("from");

beforeEach(() => {
  mocks.fetchApi.mockReset();
});

describe("useCalendarEvents", () => {
  it("asks for the six-week grid around the month", async () => {
    mocks.fetchApi.mockResolvedValue(payloadFrom("2026-09-27"));

    const { result } = renderHook(() => useCalendarEvents({ agencyId: "agency-1", month: OCT }));

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(mocks.fetchApi).toHaveBeenCalledWith("/agencies/agency-1/dashboard/calendar?from=2026-09-27&to=2026-11-07");
  });

  it("keeps the last good calendar when a refresh fails", async () => {
    mocks.fetchApi.mockResolvedValueOnce(payloadFrom("2026-09-27"));
    const { result } = renderHook(() => useCalendarEvents({ agencyId: "agency-1", month: OCT }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    mocks.fetchApi.mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.refetch());

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toEqual(payloadFrom("2026-09-27"));
  });

  it("shows a month it already loaded straight away", async () => {
    mocks.fetchApi.mockImplementation((url) => Promise.resolve(payloadFrom(fromOf(url))));
    const { result, rerender } = renderHook(({ month }) => useCalendarEvents({ agencyId: "agency-1", month }), {
      initialProps: { month: OCT },
    });
    await waitFor(() => expect(result.current.data?.from).toBe("2026-09-27"));

    rerender({ month: NOV });
    await waitFor(() => expect(result.current.data?.from).toBe("2026-11-01"));

    mocks.fetchApi.mockImplementation(() => new Promise(() => {}));
    rerender({ month: OCT });
    expect(result.current.data?.from).toBe("2026-09-27");
  });

  it("does nothing without an agency", () => {
    renderHook(() => useCalendarEvents({ agencyId: null, month: OCT }));
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/use-calendar-events.test.jsx`
Expected: FAIL: `Failed to resolve import "../app/hooks/useCalendarEvents.js"`.

- [ ] **Step 3: Implement the hook**

Create `app/hooks/useCalendarEvents.js`:

```js
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "../lib/api/client";
import { gridRange, toDateKey } from "../lib/calendarDays";

const REFRESH_MS = 60_000;

/**
 * Loads the dashboard calendar for the six-week grid around `month`.
 * - Months already loaded this session show instantly while they refresh.
 * - The shown range refreshes every minute while the page is visible.
 * - A failed request keeps the last good data on screen and sets `error`.
 */
export function useCalendarEvents({ agencyId, month }) {
  const { start, end } = gridRange(month);
  const from = toDateKey(start);
  const to = toDateKey(end);
  const rangeKey = `${agencyId}:${from}:${to}`;

  const cacheRef = useRef(new Map());
  const requestIdRef = useRef(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!agencyId) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const result = await fetchApi(`/agencies/${agencyId}/dashboard/calendar?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      cacheRef.current.set(rangeKey, result);
      setData(result);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [agencyId, from, to, rangeKey]);

  useEffect(() => {
    setData(cacheRef.current.get(rangeKey) ?? null);
    setError(null);
    load();
  }, [rangeKey, load]);

  useEffect(() => {
    if (!agencyId) return undefined;
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [agencyId, load]);

  return { data, error, isLoading, refetch: load, from, to };
}

export default useCalendarEvents;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/use-calendar-events.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useCalendarEvents.js tests/use-calendar-events.test.jsx
git commit -m "feat(dashboard): add calendar fetch hook with month cache"
```

---

## Task 16: Kind icons and the compact worklist row

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/KindIcon.jsx`
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/WorklistRow.jsx` (replace the whole file)
- Test: `tests/dashboard-worklist-row.test.jsx` (extend)

- [ ] **Step 1: Write the failing test**

Append inside `describe("WorklistRow", …)` in `tests/dashboard-worklist-row.test.jsx`:

```jsx
  it("shows the row's kind as an icon, keeping the tone label for screen readers", () => {
    const { container } = renderRow({ kind: "unreadComments" });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".sr-only").textContent).toBe("info");
  });

  it("falls back to a dot when the kind has no icon", () => {
    const { container } = renderRow();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-row.test.jsx`
Expected: FAIL. "shows the row's kind as an icon" finds no `svg`.

- [ ] **Step 3: Create `KindIcon.jsx`**

```jsx
"use client";

/**
 * A small outline icon for a to-do row or calendar item, so its type is
 * readable without relying on colour. Decorative: always aria-hidden.
 */

const PATHS = {
  comment: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
};

const KIND_TO_ICON = {
  unreadComments: "comment",
  client_commented: "comment",
  sharesExpiring: "clock",
  mySharesExpiring: "clock",
  share_expires: "clock",
  viewedNotReplied: "eye",
  client_viewed: "eye",
  draftsStuck: "pencil",
  myDraftsStuck: "pencil",
  lowRated: "star",
  proposal_rated: "star",
  review_submitted: "star",
  startingSoon: "briefcase",
  trip: "briefcase",
  share_sent: "send",
};

export default function KindIcon({ kind, className = "h-4 w-4" }) {
  const icon = PATHS[KIND_TO_ICON[kind]];
  if (!icon) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon}
    </svg>
  );
}
```

- [ ] **Step 4: Rewrite `WorklistRow.jsx`**

Replace the whole file with:

```jsx
"use client";

import { useEffect, useRef, useState } from "react";
import KindIcon from "./KindIcon";

/**
 * One row in "Needs you today".
 *
 * - Leading badge: the row's kind as an icon on a tone-tinted circle, plus an
 *   sr-only tone label, so the meaning never rests on colour alone.
 * - The row body is a <button> when onRowClick is set; the action is its own
 *   ≥44px button, and its clicks never reach onRowClick.
 * - Enter animation: fade + 8px rise over 240ms; opacity only under
 *   prefers-reduced-motion.
 */

const TONE_BADGE_CLASS = {
  info: "bg-secondary/15 text-secondary-strong",
  success: "bg-status-success/15 text-status-success",
  warning: "bg-status-warning/15 text-status-warning",
  danger: "bg-status-danger/15 text-status-danger",
};

const TONE_DOT_CLASS = {
  info: "bg-secondary",
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
};

export default function WorklistRow({
  tone = "info",
  kind,
  title,
  subtitle,
  hint,
  actionLabel,
  onAction,
  onRowClick,
  actionDisabled = false,
  actionPending = false,
}) {
  const [mounted, setMounted] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Defer a frame so the transition actually runs.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rowStyle = reducedMotion.current
    ? { opacity: mounted ? 1 : 0, transition: "opacity 240ms ease" }
    : {
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 240ms var(--ease-out), transform 240ms var(--ease-out)",
      };

  function handleActionClick(event) {
    event.stopPropagation();
    if (!actionDisabled && !actionPending && onAction) onAction();
  }

  const BodyTag = onRowClick ? "button" : "span";
  const bodyProps = onRowClick
    ? {
        type: "button",
        onClick: onRowClick,
        className:
          "min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2",
      }
    : { className: "min-w-0 flex-1" };

  return (
    <div role="listitem" style={rowStyle} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
      <div className="flex shrink-0 items-center">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-full ${TONE_BADGE_CLASS[tone] ?? TONE_BADGE_CLASS.info}`}
        >
          {kind ? (
            <KindIcon kind={kind} className="h-3.5 w-3.5" />
          ) : (
            <span className={`block h-2 w-2 rounded-full ${TONE_DOT_CLASS[tone] ?? TONE_DOT_CLASS.info}`} />
          )}
        </span>
        <span className="sr-only">{tone}</span>
      </div>

      <BodyTag {...bodyProps}>
        <span className="block text-[13px] font-semibold leading-snug text-text-primary">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[12px] text-text-muted" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
      </BodyTag>

      {/* Beside the action on wider screens; on phones it wraps under the title. */}
      {hint ? (
        <span className="order-last basis-full pl-10 text-[12px] text-text-muted sm:order-none sm:basis-auto sm:whitespace-nowrap sm:pl-0">
          {hint}
        </span>
      ) : null}

      <button
        type="button"
        onClick={handleActionClick}
        disabled={actionDisabled || actionPending}
        className="min-h-[44px] min-w-[44px] shrink-0 rounded-md px-3 text-[13px] font-semibold text-secondary-strong transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ transitionDuration: "120ms", transitionTimingFunction: "var(--ease-out)" }}
      >
        {actionPending ? "…" : actionLabel}
      </button>
    </div>
  );
}
```

`KindIcon` returns `null` for the test's default row (no `kind`), so the second new test passes through the dot fallback.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-row.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: PASS (row tests 7; contract unchanged).

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/KindIcon.jsx" "app/agency/[agencyId]/components/dashboard/widgets/WorklistRow.jsx" tests/dashboard-worklist-row.test.jsx
git commit -m "feat(dashboard): show each to-do row's kind as an icon"
```

---

## Task 17: "Needs you today" items and list

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/needsYouItems.js`
- Create: `app/agency/[agencyId]/components/dashboard/widgets/NeedsYouList.jsx`
- Test: `tests/needs-you-items.test.js`, `tests/needs-you-list.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/needs-you-items.test.js`:

```js
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/dashboard-payloads.json";
import {
  OWNER_NEEDS_YOU_ORDER,
  STAFF_NEEDS_YOU_ORDER,
  buildNeedsYouItems,
} from "../app/agency/[agencyId]/components/dashboard/needsYouItems.js";

const NOW = Date.parse(fixtures.ownerBusy.generatedAt);
const ownerItems = () => buildNeedsYouItems(fixtures.ownerBusy.worklist, OWNER_NEEDS_YOU_ORDER, NOW);

describe("buildNeedsYouItems", () => {
  it("puts risks and deadlines before conversations and housekeeping", () => {
    expect(ownerItems().map((item) => item.kind)).toEqual([
      "lowRated",
      "sharesExpiring",
      "unreadComments",
      "unreadComments",
      "viewedNotReplied",
      "viewedNotReplied",
      "draftsStuck",
    ]);
  });

  it("answers the comment that has waited longest first", () => {
    const comments = ownerItems().filter((item) => item.kind === "unreadComments");
    expect(comments.map((item) => item.hint)).toEqual(["Waiting 1d", "Waiting 6h"]);
  });

  it("explains each row in plain words", () => {
    expect(ownerItems()[0]).toMatchObject({
      tone: "danger",
      subtitle: "Rated 2 out of 5",
      hint: "6d ago",
      actionLabel: "Open trip",
    });
  });

  it("gives every row a unique key", () => {
    const keys = ownerItems().map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders staff work by deadline, clients, upcoming trips, then drafts", () => {
    const items = buildNeedsYouItems(fixtures.staff.worklist, STAFF_NEEDS_YOU_ORDER, NOW);
    expect(items.map((item) => item.kind)).toEqual([
      "mySharesExpiring",
      "unreadComments",
      "unreadComments",
      "startingSoon",
      "myDraftsStuck",
    ]);
  });

  it("returns nothing for a missing worklist", () => {
    expect(buildNeedsYouItems(undefined, OWNER_NEEDS_YOU_ORDER, NOW)).toEqual([]);
  });
});
```

Create `tests/needs-you-list.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NeedsYouList from "../app/agency/[agencyId]/components/dashboard/widgets/NeedsYouList.jsx";

const item = (n) => ({
  key: `k${n}`,
  kind: "unreadComments",
  tone: "info",
  title: `Trip ${n}`,
  subtitle: null,
  hint: null,
  actionLabel: "Reply",
  tripId: `t${n}`,
  tripTitle: `Trip ${n}`,
  clientName: null,
});

describe("NeedsYouList", () => {
  it("shows the five most urgent items and the rest on request", () => {
    render(<NeedsYouList items={[1, 2, 3, 4, 5, 6, 7].map(item)} onAction={() => {}} />);
    const list = screen.getByRole("region", { name: "Needs you today" });

    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).getByText("7 items")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all (7)" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("passes the clicked item to onAction", () => {
    const onAction = vi.fn();
    render(<NeedsYouList items={[item(1), item(2)]} onAction={onAction} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1]);

    expect(onAction).toHaveBeenCalledWith(item(2));
  });

  it("says when everything is done", () => {
    render(<NeedsYouList items={[]} onAction={() => {}} />);

    expect(screen.getByText("All caught up.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/needs-you-items.test.js tests/needs-you-list.test.jsx`
Expected: FAIL: the imports cannot be resolved.

- [ ] **Step 3: Create `needsYouItems.js`**

```js
import { describeWorklistItem } from "./worklistContext";

/**
 * Flattens a dashboard worklist into the "Needs you today" list, highest
 * priority first. Each row keeps its worklist key as `kind`, so the caller
 * decides what its action does (comments open the slide-over; the rest open
 * the trip). Labels match the old grouped worklist.
 */

const byTime = (field) => (a, b) => Date.parse(a[field]) - Date.parse(b[field]);

export const OWNER_NEEDS_YOU_ORDER = [
  { key: "lowRated", tone: "danger", actionLabel: "Open trip" },
  { key: "sharesExpiring", tone: "warning", actionLabel: "Extend", sort: byTime("expiresAt") },
  { key: "unreadComments", tone: "info", actionLabel: "Reply", sort: byTime("createdAt") },
  { key: "viewedNotReplied", tone: "info", actionLabel: "Open trip" },
  { key: "draftsStuck", tone: "warning", actionLabel: "Resume" },
];

export const STAFF_NEEDS_YOU_ORDER = [
  { key: "mySharesExpiring", tone: "warning", actionLabel: "Nudge", sort: byTime("expiresAt") },
  { key: "unreadComments", tone: "info", actionLabel: "Reply", sort: byTime("createdAt") },
  { key: "startingSoon", tone: "success", actionLabel: "Open trip", sort: (a, b) => a.daysToStart - b.daysToStart },
  { key: "myDraftsStuck", tone: "warning", actionLabel: "Resume" },
];

/**
 * @param {object|undefined} worklist  the payload's worklist
 * @param {Array} order                OWNER_NEEDS_YOU_ORDER or STAFF_NEEDS_YOU_ORDER
 * @param {number} [now]               epoch ms that relative times count from
 */
export function buildNeedsYouItems(worklist, order, now = Date.now()) {
  const items = [];
  for (const group of order) {
    const rows = [...(worklist?.[group.key] ?? [])];
    if (group.sort) rows.sort(group.sort);
    rows.forEach((row, index) => {
      const { subtitle, hint } = describeWorklistItem(group.key, row, now);
      items.push({
        key: `${group.key}:${row.id ?? row.shareId ?? row.tripId ?? index}`,
        kind: group.key,
        tone: group.tone,
        title: row.tripTitle ?? "Untitled trip",
        subtitle,
        hint,
        actionLabel: group.actionLabel,
        tripId: row.tripId,
        tripTitle: row.tripTitle ?? "Trip",
        clientName: row.clientName ?? null,
      });
    });
  }
  return items;
}
```

- [ ] **Step 4: Create `widgets/NeedsYouList.jsx`**

```jsx
"use client";

import { useId, useState } from "react";
import EmptyState from "./EmptyState";
import WorklistRow from "./WorklistRow";

/** Rows shown before "Show all". */
export const NEEDS_YOU_VISIBLE = 5;

/**
 * "Needs you today": the flattened worklist, most urgent first. Shows five
 * rows and the rest on request. `onAction(item)` runs for the row body and
 * its action button.
 */
export default function NeedsYouList({ items, onAction }) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, NEEDS_YOU_VISIBLE);

  return (
    <section aria-labelledby={headingId} className="frame-tile rounded-[20px] px-4 py-3">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 id={headingId} className="font-sans text-[15px] font-semibold tracking-normal text-text-primary">
          Needs you today
        </h2>
        {items.length > 0 ? (
          <span className="text-[12px] text-text-muted">
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState variant="worklist" />
      ) : (
        <>
          <div role="list" className="divide-y divide-[color:var(--frame-border)]">
            {visible.map((item) => (
              <WorklistRow
                key={item.key}
                kind={item.kind}
                tone={item.tone}
                title={item.title}
                subtitle={item.subtitle}
                hint={item.hint}
                actionLabel={item.actionLabel}
                onAction={() => onAction(item)}
                onRowClick={() => onAction(item)}
              />
            ))}
          </div>
          {items.length > NEEDS_YOU_VISIBLE ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 min-h-[44px] rounded-lg px-2 text-[13px] font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              {expanded ? "Show fewer" : `Show all (${items.length})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/needs-you-items.test.js tests/needs-you-list.test.jsx`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/needsYouItems.js" "app/agency/[agencyId]/components/dashboard/widgets/NeedsYouList.jsx" tests/needs-you-items.test.js tests/needs-you-list.test.jsx
git commit -m "feat(dashboard): add the prioritised Needs you today list"
```

---

## Task 18: Greeting row

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/DashboardGreeting.jsx`
- Test: `tests/dashboard-greeting.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard-greeting.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardGreeting, {
  greetingFor,
  needsYouSummary,
} from "../app/agency/[agencyId]/components/dashboard/widgets/DashboardGreeting.jsx";

const MORNING = new Date(2026, 9, 3, 8);

describe("DashboardGreeting", () => {
  it("greets by time of day", () => {
    expect(greetingFor(new Date(2026, 9, 3, 8))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 9, 3, 13))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 9, 3, 19))).toBe("Good evening");
    expect(greetingFor(new Date(2026, 9, 3, 2))).toBe("Good evening");
  });

  it("summarises what needs attention", () => {
    expect(needsYouSummary(0)).toBe("Nothing needs you right now");
    expect(needsYouSummary(1)).toBe("1 thing needs you today");
    expect(needsYouSummary(3)).toBe("3 things need you today");
    expect(needsYouSummary(null)).toBeNull();
  });

  it("uses the first name in the page heading", () => {
    render(<DashboardGreeting name="Maria Santos" count={3} onNewTrip={() => {}} now={MORNING} />);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning, Maria" })).toBeInTheDocument();
    expect(screen.getByText("3 things need you today")).toBeInTheDocument();
  });

  it("greets without a name when there is none", () => {
    render(<DashboardGreeting count={0} onNewTrip={() => {}} now={MORNING} />);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning" })).toBeInTheDocument();
  });

  it("leaves the summary out until the count is known", () => {
    render(<DashboardGreeting name="Maria" count={null} onNewTrip={() => {}} now={MORNING} />);
    expect(screen.queryByText(/need/)).not.toBeInTheDocument();
  });

  it("starts a new trip", () => {
    const onNewTrip = vi.fn();
    render(<DashboardGreeting name="Maria" count={0} onNewTrip={onNewTrip} now={MORNING} />);
    fireEvent.click(screen.getByRole("button", { name: "New trip" }));
    expect(onNewTrip).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-greeting.test.jsx`
Expected: FAIL: the import cannot be resolved.

- [ ] **Step 3: Create `DashboardGreeting.jsx`**

```jsx
"use client";

/** "Good morning" 05–12, "Good afternoon" 12–17, "Good evening" otherwise. */
export function greetingFor(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The line under the greeting; null until the worklist has loaded. */
export function needsYouSummary(count) {
  if (count == null) return null;
  if (count === 0) return "Nothing needs you right now";
  return count === 1 ? "1 thing needs you today" : `${count} things need you today`;
}

/**
 * The Dashboard's header row (the app header is hidden on this tab): a
 * personal greeting as the page h1, how much needs attention, and the page's
 * one filled button, New trip.
 */
export default function DashboardGreeting({ name, count, onNewTrip, now }) {
  const firstName = String(name ?? "").trim().split(/\s+/)[0];
  const greeting = greetingFor(now ?? new Date());
  const summary = needsYouSummary(count);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="max-w-none text-[28px] leading-tight min-[1280px]:text-[32px]">
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </h1>
        {summary ? <p className="mt-1 text-sm text-text-muted">{summary}</p> : null}
      </div>
      <button
        type="button"
        onClick={onNewTrip}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill bg-secondary-strong px-5 text-sm font-semibold text-on-secondary-strong transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
      >
        <span aria-hidden="true" className="text-base leading-none">+</span>
        New trip
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-greeting.test.jsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/DashboardGreeting.jsx" tests/dashboard-greeting.test.jsx
git commit -m "feat(dashboard): add the greeting row"
```

---

## Task 19: Static KPI tile with worded changes

**Repo:** Voyage-Client

**Files:**
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/KpiTile.jsx` (replace the whole file)
- Delete: `app/agency/[agencyId]/components/dashboard/widgets/Sparkline.jsx`
- Test: `tests/dashboard-kpi-tile.test.jsx` (replace the whole file), `tests/dashboard-server-contract.test.jsx` (two edits)

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `tests/dashboard-kpi-tile.test.jsx` with:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import KpiTile from "../app/agency/[agencyId]/components/dashboard/widgets/KpiTile.jsx";

describe("KpiTile", () => {
  it("renders the label, value and unit", () => {
    render(<KpiTile label="Win rate" value={42.1} unit="%" deltaVsPrior={0} />);
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByText("42.1")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("is a static group, not a button", () => {
    render(<KpiTile label="Win rate" value={42} unit="%" deltaVsPrior={3} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Win rate:/ })).toBeInTheDocument();
  });

  it("writes a rise in percentage points as an improvement", () => {
    render(<KpiTile label="Win rate" value={42} unit="%" deltaVsPrior={3.2} />);
    expect(screen.getByText("+3.2 pts").className).toContain("--success");
  });

  it("writes a fall as a regression", () => {
    render(<KpiTile label="Win rate" value={42} unit="%" deltaVsPrior={-2} />);
    expect(screen.getByText("−2.0 pts").className).toContain("--danger");
  });

  it("says slower or faster for times where lower is better", () => {
    const { unmount } = render(<KpiTile label="Time to reply" value={2.5} unit="h" deltaVsPrior={1.2} lowerIsBetter />);
    expect(screen.getByText("1.2h slower").className).toContain("--danger");
    unmount();
    render(<KpiTile label="Time to share" value={1.7} unit="days" deltaVsPrior={-0.4} lowerIsBetter />);
    expect(screen.getByText("0.4d faster").className).toContain("--success");
  });

  it("says when nothing changed", () => {
    render(<KpiTile label="Win rate" value={42} unit="%" deltaVsPrior={0} />);
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  it("names the value and direction for screen readers", () => {
    render(<KpiTile label="Win rate" value={42.1} unit="%" deltaVsPrior={3.2} />);
    const label = screen.getByRole("group").getAttribute("aria-label");
    expect(label).toMatch(/Win rate/);
    expect(label).toMatch(/42\.1/);
    expect(label).toMatch(/up/i);
  });

  it("respects a custom formatValue", () => {
    render(<KpiTile label="Time" value={1234} deltaVsPrior={0} formatValue={(v) => `${v.toLocaleString()}!`} />);
    expect(screen.getByText("1,234!")).toBeInTheDocument();
  });

  it("shows an em dash instead of a zero when the period has no data", () => {
    render(<KpiTile label="Client rating" value={null} unit="★" deltaVsPrior={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("★")).not.toBeInTheDocument();
    expect(screen.getByRole("group").getAttribute("aria-label")).toMatch(/no data/i);
  });

  it("says there is no prior data when only the delta is missing", () => {
    render(<KpiTile label="Win rate" value={100} unit="%" deltaVsPrior={null} />);
    expect(screen.getByText("No prior data")).toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    render(<KpiTile label="Client rating" value={4.2} deltaVsPrior={0} subtitle="32 of 80 rated" />);
    expect(screen.getByText("32 of 80 rated")).toBeInTheDocument();
  });

  it("announces what the number measures", () => {
    render(
      <KpiTile
        label="Win rate"
        value={42}
        unit="%"
        deltaVsPrior={3}
        description="Approved trips out of all approved and archived trips"
      />,
    );
    expect(screen.getByRole("group")).toHaveAccessibleDescription("Approved trips out of all approved and archived trips");
  });
});
```

In `tests/dashboard-server-contract.test.jsx`:

1. Replace

```jsx
function kpiTile(label) {
  return screen.getByRole("button", { name: new RegExp(`^${label}:`) });
}
```

with

```jsx
function kpiTile(label) {
  return screen.getByRole("group", { name: new RegExp(`^${label}:`) });
}
```

2. Replace the whole test `it("treats slower share and response times as regressions", …)` with:

```jsx
  it("treats slower share and response times as regressions", () => {
    renderOwner(fixtures.ownerBusy);

    expect(within(kpiTile("Time to share")).getByText("0.8d slower").className).toContain("--danger");
    expect(within(kpiTile("Time to reply")).getByText("1.2h slower").className).toContain("--danger");
    expect(within(kpiTile("Win rate")).getByText("+16.7 pts").className).toContain("--success");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-kpi-tile.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: FAIL. The tiles are still buttons and still show ▲/▼.

- [ ] **Step 3: Rewrite `KpiTile.jsx`**

Replace the whole file with:

```jsx
"use client";
import { useId } from "react";

const UNIT_SHORT = { days: "d", h: "h" };

/**
 * Compact KPI tile for the Insights column: label, value, and the change vs
 * the prior period in words ("+4.0 pts", "0.8d slower"), green when it is an
 * improvement and red when it is a regression. Static: not clickable.
 *
 * A null `value` means the period has no signal ("—", not a fake 0); a null
 * `deltaVsPrior` means there is nothing to compare against. Set
 * `lowerIsBetter` for times. `description` says what the number measures and
 * is announced as the tile's description.
 */
export default function KpiTile({
  label,
  value,
  unit,
  deltaVsPrior = 0,
  subtitle,
  description,
  lowerIsBetter = false,
  formatValue = (v) => v.toString(),
}) {
  const descriptionId = useId();
  const hasValue = value != null;
  const hasDelta = hasValue && deltaVsPrior != null;
  const formatted = hasValue ? formatValue(value) : "—";
  const isUp = hasDelta && deltaVsPrior > 0;
  const isDown = hasDelta && deltaVsPrior < 0;
  const isImprovement = lowerIsBetter ? isDown : isUp;
  const isRegression = lowerIsBetter ? isUp : isDown;
  const magnitude = hasDelta ? Math.abs(deltaVsPrior).toFixed(1) : null;

  let deltaText;
  if (!hasValue) deltaText = "No data yet";
  else if (!hasDelta) deltaText = "No prior data";
  else if (!isUp && !isDown) deltaText = "No change";
  else if (lowerIsBetter) deltaText = `${magnitude}${UNIT_SHORT[unit] ?? ""} ${isUp ? "slower" : "faster"}`;
  else deltaText = `${isUp ? "+" : "−"}${magnitude}${unit === "%" ? " pts" : ""}`;

  const deltaColor = isImprovement
    ? "text-[color:var(--success)]"
    : isRegression
      ? "text-[color:var(--danger)]"
      : "text-text-muted";

  const a11yLabel = !hasValue
    ? `${label}: no data yet`
    : `${label}: ${formatted}${unit ?? ""}, ${
        hasDelta
          ? `${isUp ? "up" : isDown ? "down" : "unchanged"} ${magnitude}${unit === "%" ? " pts" : ""} vs prior period`
          : "no prior period data"
      }`;

  return (
    <div
      role="group"
      aria-label={a11yLabel}
      aria-describedby={description ? descriptionId : undefined}
      className="frame-tile min-w-0 rounded-[14px] p-3"
    >
      <span className="block truncate text-[12px] font-semibold text-text-muted">{label}</span>
      <span className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold leading-none tabular-nums text-text-primary">{formatted}</span>
        {unit && hasValue ? <span className="text-xs text-text-muted">{unit}</span> : null}
      </span>
      <span className={`mt-1.5 block truncate text-[12px] font-semibold tabular-nums ${deltaColor}`}>{deltaText}</span>
      {subtitle ? <span className="block truncate text-[12px] text-text-muted">{subtitle}</span> : null}
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Delete the unused sparkline**

Run: `grep -rn "widgets/Sparkline\|from \"./Sparkline\"" app`
Expected: no output. (`app/components/admin/usage/Sparkline.jsx` is a different file and stays.)

```bash
git rm "app/agency/[agencyId]/components/dashboard/widgets/Sparkline.jsx"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-kpi-tile.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/KpiTile.jsx" tests/dashboard-kpi-tile.test.jsx tests/dashboard-server-contract.test.jsx
git commit -m "feat(dashboard): make KPI tiles static and word their changes"
```

---

## Task 20: Compact trip progress and reviews

**Repo:** Voyage-Client

**Files:**
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/FunnelChart.jsx` (replace the whole file)
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx` (replace the whole file)
- Test: `tests/dashboard-insights-widgets.test.jsx` (create), `tests/dashboard-server-contract.test.jsx` (one edit)

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard-insights-widgets.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FunnelChart, { biggestDrop } from "../app/agency/[agencyId]/components/dashboard/widgets/FunnelChart.jsx";
import RatingsPanel from "../app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx";

const STAGES = [
  { key: "created", count: 6, dropOffPct: null },
  { key: "drafted", count: 6, dropOffPct: 0 },
  { key: "sent", count: 3, dropOffPct: 50 },
  { key: "viewed", count: 3, dropOffPct: 0 },
  { key: "approved", count: 2, dropOffPct: 33.3 },
];

const review = (id, overrides = {}) => ({
  id,
  rating: 5,
  reviewText: `Review ${id}`,
  respondentName: "Maria Cruz",
  tripTitle: "Bali Honeymoon",
  consentToTestimonial: false,
  submittedAt: "2026-09-30T12:00:00.000Z",
  ...overrides,
});

describe("biggestDrop", () => {
  it("names the stage change that loses the most trips", () => {
    expect(biggestDrop(STAGES)).toBe("Biggest drop: drafted to shared (50%)");
  });

  it("says nothing when no stage loses trips", () => {
    expect(biggestDrop(STAGES.map((stage) => ({ ...stage, dropOffPct: stage.dropOffPct === null ? null : 0 })))).toBeNull();
  });
});

describe("FunnelChart", () => {
  it("summarises trip progress compactly", () => {
    render(<FunnelChart stages={STAGES} agencyId="agency-1" periodLabel="Last 30 days" />);
    const section = screen.getByRole("region", { name: "Trip progress" });

    expect(within(section).getByText("Last 30 days: 6 trips created, 2 approved.")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Shared with client: 3. Open trip list." })).toBeInTheDocument();
    expect(within(section).getByText("Biggest drop: drafted to shared (50%)")).toBeInTheDocument();
  });

  it("renders nothing without stages", () => {
    const { container } = render(<FunnelChart stages={[]} agencyId="agency-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RatingsPanel", () => {
  it("shows the two latest reviews and the rest on request", () => {
    render(<RatingsPanel reviews={[review("a"), review("b"), review("c")]} />);
    const section = screen.getByRole("region", { name: "Latest reviews" });

    expect(within(section).getByText("Review a")).toBeInTheDocument();
    expect(within(section).queryByText("Review c")).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "All reviews (3)" }));
    expect(within(section).getByText("Review c")).toBeInTheDocument();
  });

  it("explains when reviews will appear", () => {
    render(<RatingsPanel reviews={[]} />);
    expect(screen.getByText("Reviews appear after trips complete.")).toBeInTheDocument();
  });
});
```

In `tests/dashboard-server-contract.test.jsx`, replace the whole test `it("describes trip progress without funnel jargon", …)` with:

```jsx
  it("describes trip progress without funnel jargon", () => {
    renderOwner(fixtures.ownerBusy);

    const progress = screen.getByRole("region", { name: "Trip progress" });
    expect(within(progress).getByText("Last 30 days: 6 trips created, 2 approved.")).toBeInTheDocument();
    expect(within(progress).getByRole("button", { name: /^Shared with client: 3\./ })).toBeInTheDocument();
    expect(within(progress).getByRole("button", { name: /^Viewed by client: 3\./ })).toBeInTheDocument();
    expect(within(progress).getByText("Biggest drop: drafted to shared (50%)")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-insights-widgets.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: FAIL: `biggestDrop` is not exported, and there is no region named "Trip progress".

- [ ] **Step 3: Rewrite `FunnelChart.jsx`**

```jsx
"use client";
import { useId, useState } from "react";
import FunnelStageDetailPanel from "./FunnelStageDetailPanel";

const STAGE_LABELS = {
  created: "Trips created",
  drafted: "Itineraries drafted",
  sent: "Shared with client",
  viewed: "Viewed by client",
  approved: "Approved",
};

const STAGE_SHORT = { created: "Created", drafted: "Drafted", sent: "Shared", viewed: "Viewed", approved: "Approved" };

/** "Biggest drop: drafted to shared (50%)", or null when no stage loses trips. */
export function biggestDrop(stages) {
  let worst = null;
  stages.forEach((stage, index) => {
    if (index === 0 || stage.dropOffPct == null || stage.dropOffPct <= 0) return;
    if (!worst || stage.dropOffPct > worst.pct) {
      worst = { from: stages[index - 1].key, to: stage.key, pct: stage.dropOffPct };
    }
  });
  if (!worst) return null;
  return `Biggest drop: ${STAGE_SHORT[worst.from].toLowerCase()} to ${STAGE_SHORT[worst.to].toLowerCase()} (${Math.round(worst.pct)}%)`;
}

/**
 * Compact trip progress for the Insights column: one bar per stage and a note
 * on where trips drop off most. Click (or Enter/Space) on a stage opens the
 * detail panel listing its trips.
 */
export default function FunnelChart({ stages = [], agencyId, periodLabel }) {
  const headingId = useId();
  const [activeStage, setActiveStage] = useState(null);

  if (stages.length === 0) return null;

  const maxCount = Math.max(...stages.map((stage) => stage.count), 1);
  const created = stages[0]?.count ?? 0;
  const approved = stages[stages.length - 1]?.count ?? 0;
  const counts = `${created} trip${created === 1 ? "" : "s"} created, ${approved} approved.`;
  const summary = periodLabel ? `${periodLabel}: ${counts}` : counts;
  const drop = biggestDrop(stages);

  return (
    <>
      <section aria-labelledby={headingId}>
        <h3 id={headingId} className="font-sans text-[13px] font-semibold tracking-normal text-text-primary">
          Trip progress
        </h3>
        <p className="mt-0.5 text-[12px] text-text-muted">{summary}</p>
        <ol className="mt-2 space-y-1">
          {stages.map((stage) => (
            <li key={stage.key}>
              <button
                type="button"
                onClick={() => setActiveStage(stage)}
                aria-label={`${STAGE_LABELS[stage.key]}: ${stage.count}. Open trip list.`}
                className="grid w-full grid-cols-[64px_minmax(0,1fr)_28px] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              >
                <span className="text-[12px] text-text-muted">{STAGE_SHORT[stage.key]}</span>
                <span className="h-1.5 rounded-full bg-text-primary/10">
                  <span className="block h-1.5 rounded-full bg-secondary" style={{ width: `${(stage.count / maxCount) * 100}%` }} />
                </span>
                <span className="text-right text-[12px] font-semibold tabular-nums text-text-primary">{stage.count}</span>
              </button>
            </li>
          ))}
        </ol>
        {drop ? <p className="mt-1.5 text-[12px] text-text-muted">{drop}</p> : null}
      </section>

      <FunnelStageDetailPanel stage={activeStage} agencyId={agencyId} onClose={() => setActiveStage(null)} />
    </>
  );
}
```

- [ ] **Step 4: Rewrite `RatingsPanel.jsx`**

```jsx
'use client';

import { useId, useState } from 'react';
import EmptyState from './EmptyState';

/** Reviews shown before "All reviews". */
const VISIBLE = 2;

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString();
  } catch {
    return isoString;
  }
}

function StarRating({ rating }) {
  return (
    <span className="inline-block text-[13px]" style={{ color: 'var(--rating-star)' }}>
      <span aria-hidden="true">
        {'★'.repeat(rating)}
        {'☆'.repeat(5 - rating)}
      </span>
      <span className="sr-only">{rating} out of 5 stars</span>
    </span>
  );
}

/**
 * Latest traveler reviews for the Insights column: the two newest, with the
 * rest of the payload's reviews (up to five) one click away.
 */
export default function RatingsPanel({ reviews = [], onToggleTestimonial }) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const all = reviews.slice(0, 5);
  const shown = expanded ? all : all.slice(0, VISIBLE);
  const showToggle = onToggleTestimonial !== undefined;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="font-sans text-[13px] font-semibold tracking-normal text-text-primary">
        Latest reviews
      </h3>

      {all.length === 0 ? (
        <div className="mt-1">
          <EmptyState variant="ratings" />
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {shown.map((review) => (
            <div key={review.id} className="frame-tile rounded-[12px] p-3">
              <StarRating rating={review.rating} />
              {review.reviewText ? (
                <p className="mt-1 line-clamp-2 text-[13px] text-text-primary">{review.reviewText}</p>
              ) : null}
              <p className="mt-1 text-[12px] text-text-muted">
                {review.respondentName || 'Anonymous'} · {review.tripTitle} · {formatDate(review.submittedAt)}
              </p>
              {showToggle && review.consentToTestimonial ? (
                <button
                  type="button"
                  onClick={() => onToggleTestimonial(review.id)}
                  className="mt-1 rounded-md px-1 text-xs font-semibold text-secondary-strong hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
                >
                  Mark as testimonial
                </button>
              ) : null}
            </div>
          ))}
          {all.length > VISIBLE ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="min-h-[44px] rounded-lg px-1 text-[13px] font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              {expanded ? 'Show fewer' : `All reviews (${all.length})`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-insights-widgets.test.jsx tests/dashboard-server-contract.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/FunnelChart.jsx" "app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx" tests/dashboard-insights-widgets.test.jsx tests/dashboard-server-contract.test.jsx
git commit -m "feat(dashboard): compact trip progress and latest reviews"
```

---

## Task 21: Insights column

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx`
- Test: `tests/insights-column.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/insights-column.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/dashboard-payloads.json";
import InsightsColumn from "../app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx";

function renderColumn(data, props = {}) {
  render(
    <InsightsColumn data={data} period={data.period} onPeriodChange={vi.fn()} agencyId="agency-1" {...props} />,
  );
  return screen.getByRole("complementary", { name: "Insights" });
}

describe("InsightsColumn", () => {
  it("shows the four KPIs, trip progress and reviews", () => {
    const column = renderColumn(fixtures.ownerBusy);

    for (const label of ["Win rate", "Time to share", "Time to reply", "Client rating"]) {
      expect(within(column).getByRole("group", { name: new RegExp(`^${label}:`) })).toBeInTheDocument();
    }
    expect(within(column).getByRole("region", { name: "Trip progress" })).toBeInTheDocument();
    expect(within(column).getByRole("region", { name: "Latest reviews" })).toBeInTheDocument();
  });

  it("names the period the numbers cover", () => {
    renderColumn(fixtures.ownerBusyWeek);
    expect(screen.getByText("Last 7 days, compared with the 7 days before")).toBeInTheDocument();
  });

  it("changes the period", () => {
    const onPeriodChange = vi.fn();
    renderColumn(fixtures.ownerBusy, { onPeriodChange });
    fireEvent.click(screen.getByRole("radio", { name: "7d" }));
    expect(onPeriodChange).toHaveBeenCalledWith("7d");
  });

  it("says how many shared itineraries the rating is based on", () => {
    renderColumn(fixtures.ownerBusy);
    expect(screen.getByText("0 of 3 rated")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --pool=threads tests/insights-column.test.jsx`
Expected: FAIL: the import cannot be resolved.

- [ ] **Step 3: Create `InsightsColumn.jsx`**

```jsx
"use client";

import { useId } from "react";
import FunnelChart from "./FunnelChart";
import KpiTile from "./KpiTile";
import PeriodSwitcher from "./PeriodSwitcher";
import RatingsPanel from "./RatingsPanel";

const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const formatOneDecimal = (value) => value.toFixed(1);

/** "3 of 10 rated": how many shared itineraries the average rating rests on. */
function formatRatedCount(kpi) {
  const { rated, total } = kpi?.responseRate ?? {};
  if (rated == null || !total) return undefined;
  return `${rated} of ${total} rated`;
}

/**
 * The owner dashboard's right column: period switcher, four KPI tiles, trip
 * progress and the latest reviews. The period label follows the payload (not
 * the switcher), which runs ahead of the data while a refetch is in flight.
 */
export default function InsightsColumn({ data, period, onPeriodChange, isFetching = false, agencyId }) {
  const headingId = useId();
  const kpis = data?.kpis ?? {};
  const periodDays = PERIOD_DAYS[data?.period ?? period] ?? 30;
  const periodLabel = `Last ${periodDays} days`;

  return (
    <aside aria-labelledby={headingId} className="frame-tile flex min-w-0 flex-col gap-4 self-start rounded-[20px] p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="font-sans text-[15px] font-semibold tracking-normal text-text-primary">
            Insights
          </h2>
          <PeriodSwitcher value={period} onChange={onPeriodChange} disabled={isFetching} />
        </div>
        <p className="mt-1 text-[12px] text-text-muted">
          {periodLabel}, compared with the {periodDays} days before
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KpiTile
          label="Win rate"
          value={kpis.winRate?.value ?? null}
          unit="%"
          deltaVsPrior={kpis.winRate?.deltaVsPrior ?? null}
          formatValue={formatOneDecimal}
          description="Approved trips out of all approved and archived trips"
        />
        <KpiTile
          label="Time to share"
          value={kpis.timeToFirstShareDays?.value ?? null}
          unit="days"
          deltaVsPrior={kpis.timeToFirstShareDays?.deltaVsPrior ?? null}
          formatValue={formatOneDecimal}
          description="Average days from a new trip to sharing its first itinerary"
          lowerIsBetter
        />
        <KpiTile
          label="Time to reply"
          value={kpis.medianCommentResponseHours?.value ?? null}
          unit="h"
          deltaVsPrior={kpis.medianCommentResponseHours?.deltaVsPrior ?? null}
          formatValue={formatOneDecimal}
          description="Typical time your team takes to answer a client comment"
          lowerIsBetter
        />
        <KpiTile
          label="Client rating"
          value={kpis.avgProposalRating?.value ?? null}
          unit="★"
          deltaVsPrior={kpis.avgProposalRating?.deltaVsPrior ?? null}
          formatValue={formatOneDecimal}
          subtitle={formatRatedCount(kpis.avgProposalRating)}
          description="Average stars clients gave your shared itineraries"
        />
      </div>

      {data?.funnel?.stages?.length > 0 ? (
        <FunnelChart stages={data.funnel.stages} agencyId={agencyId} periodLabel={periodLabel} />
      ) : null}

      <RatingsPanel reviews={data?.recentReviews ?? []} />
    </aside>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --pool=threads tests/insights-column.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/InsightsColumn.jsx" tests/insights-column.test.jsx
git commit -m "feat(dashboard): add the Insights column"
```

---

## Task 22: Calendar widget and day popover

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx`
- Create: `app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx`
- Test: `tests/agency-calendar.test.jsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/agency-calendar.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useCalendarEvents: vi.fn() }));

vi.mock("../app/hooks/useCalendarEvents.js", () => ({
  useCalendarEvents: (...args) => mocks.useCalendarEvents(...args),
  default: (...args) => mocks.useCalendarEvents(...args),
}));

import AgencyCalendar from "../app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx";

const PAYLOAD = {
  from: "2026-09-27",
  to: "2026-11-07",
  generatedAt: "2026-10-03T02:00:00.000Z",
  tripsWithoutDates: 2,
  trips: [
    {
      tripId: "t-kyoto",
      tripTitle: "Kyoto Autumn Escape",
      clientName: "Reyes",
      placeLabel: "Kyoto",
      startDate: "2026-10-08",
      endDate: "2026-10-14",
      status: "APPROVED_INTERNAL",
      travelerCount: 2,
    },
  ],
  events: [
    {
      id: "client_commented:c1",
      kind: "client_commented",
      tripId: "t-lisbon",
      tripTitle: "Lisbon Getaway",
      clientName: "Tanaka",
      occurredAt: new Date(2026, 9, 2, 10).toISOString(),
      detail: { excerpt: "Can we swap lunch?" },
    },
  ],
};

function hookResult(overrides = {}) {
  return { data: PAYLOAD, error: null, isLoading: false, refetch: vi.fn(), from: "2026-09-27", to: "2026-11-07", ...overrides };
}

/** A day button by its date ("Saturday, October 3"), ignoring the count suffix. */
const day = (label) =>
  screen.getByRole("button", { name: (name) => name === label || name.startsWith(`${label},`) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 10));
  mocks.useCalendarEvents.mockReset();
  mocks.useCalendarEvents.mockReturnValue(hookResult());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AgencyCalendar", () => {
  it("shows the current month with today marked and focusable", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(day("Saturday, October 3")).toHaveAccessibleName("Saturday, October 3, today");
    expect(day("Saturday, October 3")).toHaveAttribute("tabindex", "0");
    expect(day("Friday, October 9")).toHaveAttribute("tabindex", "-1");
  });

  it("counts what is on each day and labels a trip on its first day", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    expect(day("Thursday, October 8")).toHaveAccessibleName("Thursday, October 8, 1 item");
    expect(day("Friday, October 2")).toHaveAccessibleName("Friday, October 2, 1 item");
    expect(within(day("Thursday, October 8")).getByText("Kyoto")).toBeInTheDocument();
  });

  it("opens a day's details and acts on them", () => {
    const onOpenTrip = vi.fn();
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={onOpenTrip} />);

    fireEvent.click(day("Thursday, October 8"));
    const dialog = screen.getByRole("dialog", { name: "Thursday, October 8" });
    expect(dialog).toHaveTextContent("Reyes · Kyoto departs");
    expect(dialog).toHaveTextContent("6 nights · 2 travelers");
    expect(within(dialog).getByRole("button", { name: "Open trip" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open trip" }));
    expect(onOpenTrip).toHaveBeenCalledWith("t-kyoto", "Kyoto Autumn Escape", "Reyes");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers to reply to a client comment", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    fireEvent.click(day("Friday, October 2"));
    const dialog = screen.getByRole("dialog", { name: "Friday, October 2" });
    expect(dialog).toHaveTextContent("Tanaka commented");
    expect(dialog).toHaveTextContent("“Can we swap lunch?”");
    expect(within(dialog).getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("closes on Escape and puts focus back on the day", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    fireEvent.click(day("Thursday, October 8"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(day("Thursday, October 8")).toHaveFocus();
  });

  it("toggles a day closed when it is clicked again", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    fireEvent.click(day("Thursday, October 8"));
    fireEvent.click(day("Thursday, October 8"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves between days with the arrow keys", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    day("Saturday, October 3").focus();
    fireEvent.keyDown(day("Saturday, October 3"), { key: "ArrowDown" });
    expect(day("Saturday, October 10")).toHaveFocus();

    fireEvent.keyDown(day("Saturday, October 10"), { key: "ArrowLeft" });
    expect(day("Friday, October 9")).toHaveFocus();

    fireEvent.keyDown(day("Friday, October 9"), { key: "Home" });
    expect(day("Sunday, October 4")).toHaveFocus();
  });

  it("changes month with the buttons and PageDown", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    expect(mocks.useCalendarEvents).toHaveBeenLastCalledWith({ agencyId: "agency-1", month: new Date(2026, 10, 1) });

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();

    day("Saturday, October 3").focus();
    fireEvent.keyDown(day("Saturday, October 3"), { key: "PageDown" });
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    expect(day("Tuesday, November 3")).toHaveFocus();
  });

  it("says how many trips have no dates", () => {
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);
    expect(screen.getByText("2 trips don't have travel dates yet")).toBeInTheDocument();
  });

  it("offers a retry when the calendar fails to load", () => {
    const refetch = vi.fn();
    mocks.useCalendarEvents.mockReturnValue(hookResult({ error: new Error("offline"), refetch }));
    render(<AgencyCalendar agencyId="agency-1" onOpenTrip={vi.fn()} />);

    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx`
Expected: FAIL: the import cannot be resolved.

- [ ] **Step 3: Create `CalendarDayPopover.jsx`**

```jsx
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import KindIcon from "./KindIcon";
import { describeDayItems, fullDayLabel, relativeDayLabel } from "@/app/lib/calendarDays";

const KIND_BADGE = {
  trip: "bg-secondary/15 text-secondary-strong",
  share_expires: "bg-status-warning/15 text-status-warning",
};
const DEFAULT_BADGE = "bg-text-muted/15 text-text-muted";

/**
 * A calendar day's details. Floats beside the day inside the calendar card
 * (flipping left near the right edge) or, on narrow screens, sits inline
 * under the grid. Focus moves to the first action (the close button on an
 * empty day). Escape and the close button call `onClose({ restoreFocus: true })`.
 */
export default function CalendarDayPopover({ cell, todayKey, anchorEl, containerEl, inline = false, onClose, onAction }) {
  const titleId = useId();
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const items = describeDayItems(cell);

  useLayoutEffect(() => {
    if (inline) return;
    if (!anchorEl || !containerEl || !ref.current) {
      setPosition({ left: 8, top: 8 });
      return;
    }
    const box = containerEl.getBoundingClientRect();
    const anchor = anchorEl.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    let left = anchor.right - box.left + 8;
    if (left + width > box.width - 4) left = Math.max(4, anchor.left - box.left - width - 8);
    let top = anchor.top - box.top;
    if (top + height > box.height - 4) top = Math.max(4, box.height - height - 4);
    setPosition({ left, top });
  }, [inline, anchorEl, containerEl, cell.key]);

  useEffect(() => {
    ref.current?.querySelector("[data-autofocus]")?.focus();
  }, [cell.key]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose({ restoreFocus: true });
    }
  }

  const title = cell.isToday ? "Today" : fullDayLabel(cell.date);
  const subtitle = cell.isToday ? fullDayLabel(cell.date) : relativeDayLabel(cell.key, todayKey);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-calendar-popover=""
      onKeyDown={handleKeyDown}
      className={
        inline
          ? "frame-tile mt-3 rounded-[16px] p-3"
          : "frame-popover frame-pop-in absolute z-30 w-[260px] rounded-[16px] p-3"
      }
      style={
        inline
          ? undefined
          : { left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={titleId} className="text-[13px] font-semibold text-text-primary">
            {title}
          </p>
          <p className="text-[12px] text-text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          data-autofocus={items.length === 0 ? "" : undefined}
          onClick={() => onClose({ restoreFocus: true })}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-muted hover:bg-text-primary/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-[12px] text-text-muted">Nothing on this day.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--frame-border)]">
          {items.map((item, index) => (
            <li key={item.key} className="flex gap-2 py-2">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${KIND_BADGE[item.kind] ?? DEFAULT_BADGE}`}
              >
                <KindIcon kind={item.kind} className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-snug text-text-primary">{item.title}</p>
                {item.detail ? <p className="text-[12px] text-text-muted">{item.detail}</p> : null}
                <button
                  type="button"
                  data-autofocus={index === 0 ? "" : undefined}
                  onClick={() => onAction(item)}
                  className="mt-1 min-h-8 rounded text-[12px] font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                >
                  {item.actionLabel} <span aria-hidden="true">→</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `AgencyCalendar.jsx`**

```jsx
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useCalendarEvents } from "@/app/hooks/useCalendarEvents";
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  addDays,
  addMonths,
  buildCalendarDays,
  fullDayLabel,
  startOfMonth,
  toDateKey,
} from "@/app/lib/calendarDays";
import CalendarDayPopover from "./CalendarDayPopover";

const NARROW_QUERY = "(max-width: 600px)";
const KEY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const NAV_BUTTON =
  "frame-tile flex h-9 w-9 items-center justify-center rounded-full text-text-primary hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

/** True on screens narrow enough that day details sit under the grid. */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    setNarrow(mql.matches);
    const onChange = (event) => setNarrow(event.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return narrow;
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function dayLabel(cell) {
  const count = cell.spans.length + cell.events.length;
  return `${fullDayLabel(cell.date)}${cell.isToday ? ", today" : ""}${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`;
}

function ChevronIcon({ direction }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}

function DayDots({ events }) {
  if (events.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {events.slice(0, 3).map((event) => (
        <span
          key={event.id}
          className={`h-1.5 w-1.5 rounded-full ${event.kind === "share_expires" ? "bg-status-warning" : "bg-text-muted"}`}
        />
      ))}
      {events.length > 3 ? (
        <span className="text-[11px] font-semibold leading-none text-text-muted">+{events.length - 3}</span>
      ) : null}
    </span>
  );
}

function DayTile({ cell, isOpen, tabbable, buttonRef, onClick, onFocus, onKeyDown }) {
  const label = cell.spans.find((span) => span.showLabel) ?? null;
  const allPast = cell.spans.length > 0 && cell.spans.every((span) => span.isPast);
  return (
    <button
      ref={buttonRef}
      type="button"
      data-calendar-day=""
      tabIndex={tabbable ? 0 : -1}
      aria-label={dayLabel(cell)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={[
        "relative flex h-full min-h-[56px] w-full flex-col overflow-hidden rounded-[10px] p-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary",
        isOpen ? "border border-secondary bg-secondary/15" : "frame-tile hover:bg-text-primary/5",
        cell.isToday ? "outline-dashed outline-[1.5px] outline-offset-[-3px] outline-secondary" : "",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-1">
        <span className={`text-[11px] font-semibold tabular-nums ${cell.inMonth ? "text-text-primary" : "text-text-muted"}`}>
          {cell.dayOfMonth}
        </span>
        <DayDots events={cell.events} />
      </span>
      {label ? <span className="mt-auto truncate pb-1 text-[11px] leading-[13px] text-text-primary">{label.placeLabel}</span> : null}
      {cell.spans.length > 0 ? (
        <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-[3px] bg-secondary ${allPast ? "opacity-45" : ""}`} />
      ) : null}
    </button>
  );
}

/**
 * Month calendar of trips (bars) and client activity (dots). Clicking a day
 * opens its details; their actions call `onOpenTrip(tripId, tripTitle, clientName)`.
 * Keyboard: arrows move by day/week, Home/End jump to the week's edges,
 * PageUp/PageDown change month, Enter/Space opens a day, Escape closes it.
 */
export default function AgencyCalendar({ agencyId, onOpenTrip }) {
  const titleId = useId();
  const sectionRef = useRef(null);
  const buttonRefs = useRef(new Map());
  const focusAfterRenderRef = useRef(false);
  const isNarrow = useIsNarrow();

  const [today] = useState(() => new Date());
  const todayKey = toDateKey(today);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [focusKey, setFocusKey] = useState(todayKey);
  const [openKey, setOpenKey] = useState(null);

  const { data, error, isLoading, refetch } = useCalendarEvents({ agencyId, month });
  const cells = useMemo(() => buildCalendarDays(data, month, today), [data, month, today]);
  const weeks = [0, 1, 2, 3, 4, 5].map((week) => cells.slice(week * 7, week * 7 + 7));
  const activeFocusKey = cells.some((cell) => cell.key === focusKey) ? focusKey : toDateKey(month);
  const openCell = openKey ? cells.find((cell) => cell.key === openKey) ?? null : null;

  // Move DOM focus only after keyboard navigation or closing a popover.
  useEffect(() => {
    if (!focusAfterRenderRef.current) return;
    focusAfterRenderRef.current = false;
    buttonRefs.current.get(activeFocusKey)?.focus();
  });

  useEffect(() => {
    if (!openKey || isNarrow) return undefined;
    function handlePointerDown(event) {
      const target = event.target;
      if (target.closest?.("[data-calendar-popover]") || target.closest?.("[data-calendar-day]")) return;
      setOpenKey(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openKey, isNarrow]);

  function showMonth(date) {
    setMonth(startOfMonth(date));
    setOpenKey(null);
  }

  function moveFocus(nextDate) {
    if (!sameMonth(nextDate, month)) showMonth(nextDate);
    focusAfterRenderRef.current = true;
    setFocusKey(toDateKey(nextDate));
  }

  function handleDayKeyDown(event, cell) {
    let next = null;
    if (KEY_STEPS[event.key] !== undefined) {
      next = addDays(cell.date, KEY_STEPS[event.key]);
    } else if (event.key === "Home") {
      next = addDays(cell.date, -cell.date.getDay());
    } else if (event.key === "End") {
      next = addDays(cell.date, 6 - cell.date.getDay());
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      const target = addMonths(cell.date, event.key === "PageUp" ? -1 : 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      next = new Date(target.getFullYear(), target.getMonth(), Math.min(cell.date.getDate(), lastDay));
    }
    if (!next) return;
    event.preventDefault();
    moveFocus(next);
  }

  function closePopover({ restoreFocus = false } = {}) {
    const key = openKey;
    setOpenKey(null);
    if (restoreFocus && key) {
      focusAfterRenderRef.current = true;
      setFocusKey(key);
    }
  }

  function handleAction(item) {
    setOpenKey(null);
    onOpenTrip?.(item.tripId, item.tripTitle, item.clientName);
  }

  const undated = data?.tripsWithoutDates ?? 0;

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className="frame-tile relative rounded-[20px] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-normal text-text-primary">
          {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => showMonth(addMonths(month, -1))} className={NAV_BUTTON}>
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            onClick={() => {
              showMonth(today);
              setFocusKey(todayKey);
            }}
            className="frame-tile min-h-9 rounded-full px-3 text-[12px] font-semibold text-text-primary hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={() => showMonth(addMonths(month, 1))} className={NAV_BUTTON}>
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>

      <div role="grid" aria-labelledby={titleId} aria-busy={isLoading && !data ? "true" : undefined} className="mt-3 flex flex-col gap-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAY_SHORT.map((label, index) => (
            <div key={label} role="columnheader" aria-label={WEEKDAY_NAMES[index]} className="px-1 text-[11px] font-semibold text-text-muted">
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="grid grid-cols-7 gap-1">
            {week.map((cell) => (
              <div key={cell.key} role="gridcell" aria-selected={openKey === cell.key}>
                <DayTile
                  cell={cell}
                  isOpen={openKey === cell.key}
                  tabbable={cell.key === activeFocusKey}
                  buttonRef={(element) => {
                    if (element) buttonRefs.current.set(cell.key, element);
                    else buttonRefs.current.delete(cell.key);
                  }}
                  onClick={() => setOpenKey((current) => (current === cell.key ? null : cell.key))}
                  onFocus={() => setFocusKey(cell.key)}
                  onKeyDown={(event) => handleDayKeyDown(event, cell)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

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

      {undated > 0 ? (
        <p className="mt-1 text-[12px] text-text-muted">
          {undated === 1 ? "1 trip doesn't" : `${undated} trips don't`} have travel dates yet
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
          <span>Couldn&rsquo;t load the calendar.</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded font-semibold text-secondary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Retry
          </button>
        </div>
      ) : null}

      {openCell ? (
        <CalendarDayPopover
          cell={openCell}
          todayKey={todayKey}
          inline={isNarrow}
          anchorEl={buttonRefs.current.get(openCell.key) ?? null}
          containerEl={sectionRef.current}
          onClose={closePopover}
          onAction={handleAction}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/agency-calendar.test.jsx`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx" "app/agency/[agencyId]/components/dashboard/widgets/AgencyCalendar.jsx" tests/agency-calendar.test.jsx
git commit -m "feat(dashboard): add the month calendar with day details"
```

---

## Task 23: Owner dashboard

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/DashboardSkeleton.jsx`
- Modify: `app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx` (replace the whole file)
- Modify: `app/components/trip-dashboard/HomePage.jsx` (one prop)
- Test: `tests/dashboard-server-contract.test.jsx`, `tests/home-page-dashboard-tab.test.jsx`

- [ ] **Step 1: Update the tests to the new layout**

In `tests/dashboard-server-contract.test.jsx`:

1. Replace `import { render, screen, within } from "@testing-library/react";` with:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
```

2. Replace the `worklistGroup` helper (the comment line and the function) with:

```jsx
/** The "Needs you today" list, expanded so every row is on screen. */
function needsYouList() {
  const list = screen.getByRole("region", { name: "Needs you today" });
  const showAll = within(list).queryByRole("button", { name: /^Show all/ });
  if (showAll) fireEvent.click(showAll);
  return list;
}
```

3. Replace the whole `describe("Owner dashboard in plain words", …)` block **and** the whole `describe("Owner to-do list says why each trip is on it", …)` block, everything up to the line `describe("Staff dashboard with real server payloads", () => {`, with:

```jsx
describe("Owner dashboard in plain words", () => {
  it("explains what each number measures", () => {
    renderOwner(fixtures.ownerBusy);

    expect(kpiTile("Win rate")).toHaveAccessibleDescription("Approved trips out of all approved and archived trips");
    expect(kpiTile("Time to share")).toHaveAccessibleDescription(
      "Average days from a new trip to sharing its first itinerary",
    );
    expect(kpiTile("Time to reply")).toHaveAccessibleDescription(
      "Typical time your team takes to answer a client comment",
    );
    expect(kpiTile("Client rating")).toHaveAccessibleDescription("Average stars clients gave your shared itineraries");
  });

  it("says how many shared itineraries the client rating is based on", () => {
    renderOwner(fixtures.ownerBusy);

    expect(within(kpiTile("Client rating")).getByText("0 of 3 rated")).toBeInTheDocument();
  });

  it("names the period the numbers cover and what they are compared with", () => {
    renderOwner(fixtures.ownerBusyWeek);

    const insights = screen.getByRole("complementary", { name: "Insights" });
    expect(within(insights).getByText("Last 7 days, compared with the 7 days before")).toBeInTheDocument();
  });

  it("describes trip progress without funnel jargon", () => {
    renderOwner(fixtures.ownerBusy);

    const progress = screen.getByRole("region", { name: "Trip progress" });
    expect(within(progress).getByText("Last 30 days: 6 trips created, 2 approved.")).toBeInTheDocument();
    expect(within(progress).getByRole("button", { name: /^Shared with client: 3\./ })).toBeInTheDocument();
    expect(within(progress).getByRole("button", { name: /^Viewed by client: 3\./ })).toBeInTheDocument();
    expect(within(progress).getByText("Biggest drop: drafted to shared (50%)")).toBeInTheDocument();
  });

  it("greets the viewer and says how much needs them today", () => {
    renderOwner(fixtures.ownerBusy);

    expect(screen.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeInTheDocument();
    expect(screen.getByText("7 things need you today")).toBeInTheDocument();
  });

  it("says the to-do list is clear without placeholder counts", () => {
    renderOwner(fixtures.ownerEmpty);

    expect(screen.getByText("All caught up.")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs your attention right now.")).toBeInTheDocument();
    expect(screen.queryByText(/N active shares/)).not.toBeInTheDocument();
  });

  it("shows this month's calendar beside the to-do list", () => {
    renderOwner(fixtures.ownerBusy);

    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
  });
});

describe("Owner to-do list says why each trip is on it", () => {
  it("lists the low rating first and the stale draft last", () => {
    renderOwner(fixtures.ownerBusy);

    const rows = within(needsYouList()).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent("Rated 2 out of 5");
    expect(rows[rows.length - 1]).toHaveTextContent("Last edited 9d ago");
  });

  it("quotes each unread client comment and how long it has waited", () => {
    renderOwner(fixtures.ownerBusy);

    const list = needsYouList();
    expect(within(list).getByText("“Is the ryokan wheelchair accessible? My father uses one.”")).toBeInTheDocument();
    expect(within(list).getByText("Waiting 1d")).toBeInTheDocument();
    expect(within(list).getByText("“Can we swap the day 2 lunch spot?”")).toBeInTheDocument();
    expect(within(list).getByText("Waiting 6h")).toBeInTheDocument();
  });

  it("shows how often a client viewed a proposal nobody has followed up", () => {
    renderOwner(fixtures.ownerBusy);

    const list = needsYouList();
    expect(within(list).getByText("Viewed 4 times")).toBeInTheDocument();
    expect(within(list).getByText("Last viewed 5h ago")).toBeInTheDocument();
    expect(within(list).getByText("Viewed 2 times")).toBeInTheDocument();
    expect(within(list).getByText("Last viewed 6d ago")).toBeInTheDocument();
  });

  it("shows how long a stuck draft has gone untouched", () => {
    renderOwner(fixtures.ownerBusy);

    const list = needsYouList();
    expect(within(list).getByText("Batanes Road Trip")).toBeInTheDocument();
    expect(within(list).getByText("Last edited 9d ago")).toBeInTheDocument();
  });

  it("shows when an expiring itinerary link runs out", () => {
    renderOwner(fixtures.ownerBusy);

    expect(within(needsYouList()).getByText("Link expires in 20h")).toBeInTheDocument();
  });

  it("shows the low rating a client gave and when", () => {
    renderOwner(fixtures.ownerBusy);

    const list = needsYouList();
    expect(within(list).getByText("Rated 2 out of 5")).toBeInTheDocument();
    expect(within(list).getByText("6d ago")).toBeInTheDocument();
  });

  it("lists two comments on the same trip as separate rows", () => {
    const keyWarnings = captureKeyWarnings();

    renderOwner(fixtures.ownerBusy);

    expect(keyWarnings()).toEqual([]);
  });
});

```

In `tests/home-page-dashboard-tab.test.jsx`:

1. In the first test, replace

```jsx
    expect(within(scroller).getByRole("heading", { name: "How your agency is doing" })).toBeInTheDocument();
```

with

```jsx
    expect(
      within(scroller).getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening), Mara$/ }),
    ).toBeInTheDocument();
```

2. In the joined-notice test, replace

```jsx
    const firstSection = screen.getByRole("heading", {
      name: role === "STAFF" ? "Clients waiting on you" : "Needs your eyes today",
    });
```

with

```jsx
    const firstSection = screen.getByRole("heading", { name: "Needs you today" });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: FAIL. There is no "Needs you today" region and no Insights column yet.

- [ ] **Step 3: Create `widgets/DashboardSkeleton.jsx`**

```jsx
"use client";

/** Two columns from 1024px: main content, then a 280px (320px from 1280px) side column. */
export const DASHBOARD_GRID_CLASS =
  "mt-6 grid gap-5 min-[1024px]:grid-cols-[minmax(0,1fr)_280px] min-[1280px]:grid-cols-[minmax(0,1fr)_320px]";

/** Loading placeholder in the dashboard's own layout. */
export default function DashboardSkeleton() {
  return (
    <div className={`${DASHBOARD_GRID_CLASS} animate-pulse`} role="status" aria-label="Loading dashboard">
      <div className="space-y-5">
        <div className="frame-tile h-40 rounded-[20px]" />
        <div className="frame-tile h-[420px] rounded-[20px]" />
      </div>
      <div className="frame-tile h-[520px] rounded-[20px]" />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `OwnerOverview.jsx`**

Replace the whole file with:

```jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardPoll } from "../../../../hooks/useDashboardPoll";
import AgencyCalendar from "./widgets/AgencyCalendar";
import DashboardGreeting from "./widgets/DashboardGreeting";
import DashboardSkeleton, { DASHBOARD_GRID_CLASS } from "./widgets/DashboardSkeleton";
import InsightsColumn from "./widgets/InsightsColumn";
import JoinedNotice from "./widgets/JoinedNotice";
import NeedsYouList from "./widgets/NeedsYouList";
import TripSlideOver from "./TripSlideOver";
import { OWNER_NEEDS_YOU_ORDER, buildNeedsYouItems } from "./needsYouItems";

/**
 * Owner/admin dashboard: greeting, "Needs you today" and the calendar on the
 * left, Insights (KPIs, trip progress, reviews) on the right.
 * Comment rows and calendar actions open the trip slide-over; other to-do
 * rows open the trip in the Command Center.
 */
export default function OwnerOverview({
  agencyId,
  initialData = null,
  viewerName,
  onOpenTrip,
  onNewTrip,
  showJoinedNotice = false,
}) {
  const router = useRouter();
  const [period, setPeriod] = useState("30d");
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }

  const { data, isStale, isFetching, refetch } = useDashboardPoll({
    agencyId,
    view: "owner",
    period,
    initialData,
  });

  const needsYou = buildNeedsYouItems(data?.worklist, OWNER_NEEDS_YOU_ORDER);

  function openSlideOver(tripId, tripTitle, subtitle) {
    setSlideTrip({ tripId, tripTitle: tripTitle ?? "Trip", subtitle: subtitle ?? null });
  }

  function openInCommandCenter(tripId) {
    if (onOpenTrip) {
      onOpenTrip(tripId);
      return;
    }
    router.push(`/agency/${agencyId}/trip/${tripId}`);
  }

  function handleNewTrip() {
    if (onNewTrip) {
      onNewTrip();
      return;
    }
    router.push(`/agency/${agencyId}/trip/new`);
  }

  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openSlideOver(item.tripId, item.tripTitle, item.clientName);
    else openInCommandCenter(item.tripId);
  }

  return (
    <div className="px-6 py-6 md:px-8 lg:px-10">
      {showJoinedNotice && <JoinedNotice className="mb-5" />}

      <DashboardGreeting name={viewerName} count={data ? needsYou.length : null} onNewTrip={handleNewTrip} />

      {isStale && (
        <div
          role="alert"
          className="mt-4 inline-flex items-center gap-3 rounded-xl border border-secondary/30 bg-secondary/10 px-4 py-2 text-sm font-semibold text-secondary-strong"
        >
          <span>We couldn&rsquo;t refresh — last loaded a few minutes ago.</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded-pill bg-secondary-strong px-3 py-1 text-xs font-bold text-on-secondary-strong hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {data === null ? (
        <DashboardSkeleton />
      ) : (
        <div className={DASHBOARD_GRID_CLASS}>
          <div className="min-w-0 space-y-5">
            <NeedsYouList items={needsYou} onAction={handleNeedsYouAction} />
            <AgencyCalendar agencyId={agencyId} onOpenTrip={openSlideOver} />
          </div>
          <InsightsColumn
            data={data}
            period={period}
            onPeriodChange={setPeriod}
            isFetching={isFetching}
            agencyId={agencyId}
          />
        </div>
      )}

      <TripSlideOver
        isOpen={!!slideTrip}
        onClose={() => setSlideTrip(null)}
        agencyId={agencyId}
        tripId={slideTrip?.tripId}
        tripTitle={slideTrip?.tripTitle}
        subtitle={slideTrip?.subtitle}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openInCommandCenter(tripId);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Pass the viewer's name from `HomePage.jsx`**

Replace:

```jsx
                <OwnerOverview
                  agencyId={agencyId}
                  initialData={null}
```

with:

```jsx
                <OwnerOverview
                  agencyId={agencyId}
                  initialData={null}
                  viewerName={user?.displayName}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: the owner tests and the OWNER cases pass. The STAFF joined-notice case still fails until Task 24.

- [ ] **Step 7: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/DashboardSkeleton.jsx" "app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx" app/components/trip-dashboard/HomePage.jsx tests/dashboard-server-contract.test.jsx tests/home-page-dashboard-tab.test.jsx
git commit -m "feat(dashboard): rebuild the owner dashboard around the calendar"
```

---

## Task 24: Staff dashboard

**Repo:** Voyage-Client

**Files:**
- Create: `app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx`
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/HeroContinueCard.jsx`
- Modify: `app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx` (replace the whole file)
- Modify: `app/components/trip-dashboard/HomePage.jsx` (one prop)
- Test: `tests/dashboard-server-contract.test.jsx` (one edit)

- [ ] **Step 1: Update the staff test**

In `tests/dashboard-server-contract.test.jsx`, inside `it("says why each client is waiting", …)`, replace

```jsx
    const worklist = screen.getByRole("region", { name: "Clients waiting on you" });
```

with

```jsx
    const worklist = screen.getByRole("region", { name: "Needs you today" });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: FAIL. There is no "Needs you today" region on the staff dashboard.

- [ ] **Step 3: Fit `HeroContinueCard.jsx` into the narrow column**

In `app/agency/[agencyId]/components/dashboard/widgets/HeroContinueCard.jsx`:

1. Replace `    <div className="h-[200px] dashboard-card p-6 flex flex-col justify-between">` with:

```jsx
    <div className="frame-tile flex flex-col gap-3 rounded-[16px] p-4">
```

2. Replace

```jsx
        <h2 className="text-lg font-extrabold text-text-primary mb-1 line-clamp-2">
          {trip.tripTitle}
        </h2>
```

with

```jsx
        <h3 className="mb-1 line-clamp-2 font-sans text-[15px] font-semibold tracking-normal text-text-primary">
          {trip.tripTitle}
        </h3>
```

3. Replace the Continue button's class

```jsx
        className="w-full h-11 rounded-lg bg-secondary text-white font-bold text-sm shadow-soft hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
```

with

```jsx
        className="h-11 w-full rounded-lg bg-secondary-strong text-sm font-semibold text-on-secondary-strong transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2"
```

- [ ] **Step 4: Create `widgets/MyWorkColumn.jsx`**

```jsx
"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import HeroContinueCard from "./HeroContinueCard";

const STATUS_LABELS = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED_INTERNAL: "Approved",
  ARCHIVED: "Archived",
};

const STATUS_BG = {
  DRAFT: "color-mix(in srgb, var(--warning) 12%, transparent)",
  IN_REVIEW: "color-mix(in srgb, var(--accent) 12%, transparent)",
  APPROVED_INTERNAL: "color-mix(in srgb, var(--success) 12%, transparent)",
  ARCHIVED: "rgb(var(--color-border-rgb) / 0.08)",
};

const STATUS_COLOR = {
  DRAFT: "var(--warning)",
  IN_REVIEW: "var(--accent)",
  APPROVED_INTERNAL: "var(--success)",
  ARCHIVED: "rgb(var(--color-text-soft-rgb))",
};

function StatusChip({ status }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-lg px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.04em]"
      style={{
        backgroundColor: STATUS_BG[status] ?? "rgb(var(--color-border-rgb) / 0.08)",
        color: STATUS_COLOR[status] ?? "rgb(var(--color-text-soft-rgb))",
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** "2h ago", "3d ago"; the raw string if it can't be read. */
function relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diff)) return isoString;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RecentTripButton({ trip, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="frame-tile flex w-full flex-col gap-1 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="truncate text-[13px] font-semibold leading-snug text-text-primary">{trip.tripTitle}</span>
        <StatusChip status={trip.statusChip} />
      </span>
      <span className="flex items-end justify-between gap-2">
        <span className="truncate text-[12px] text-text-muted">{trip.clientName}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{relativeTime(trip.updatedAt)}</span>
      </span>
    </button>
  );
}

function PipelineCounter({ label, value, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="frame-tile flex flex-col items-start rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
    >
      <span className="text-[20px] font-semibold leading-none tabular-nums text-text-primary">{value ?? 0}</span>
      <span className="mt-1 text-[12px] text-text-muted">{label}</span>
    </button>
  );
}

/**
 * The staff dashboard's right column: continue the latest trip, the trips by
 * status (each count opens the filtered list), and up to three recent trips.
 */
export default function MyWorkColumn({ hero, recent = [], pipeline, agencyId, onOpenTrip, onOpenItineraries }) {
  const router = useRouter();
  const headingId = useId();

  function goToList(status) {
    if (onOpenItineraries) {
      onOpenItineraries(status);
      return;
    }
    router.push(`/agency/${agencyId}/trip?status=${status}`);
  }

  return (
    <aside aria-labelledby={headingId} className="frame-tile flex min-w-0 flex-col gap-4 self-start rounded-[20px] p-4">
      <h2 id={headingId} className="font-sans text-[15px] font-semibold tracking-normal text-text-primary">
        Your work
      </h2>

      <HeroContinueCard trip={hero} onContinue={onOpenTrip} />

      {pipeline ? (
        <div>
          <h3 className="mb-2 font-sans text-[13px] font-semibold tracking-normal text-text-primary">Your trips</h3>
          <div role="group" aria-label="Your trips by status" className="grid grid-cols-2 gap-2">
            <PipelineCounter label="Drafts" value={pipeline.drafts} onClick={() => goToList("DRAFT")} />
            <PipelineCounter label="In review" value={pipeline.inReview} onClick={() => goToList("IN_REVIEW")} />
            <PipelineCounter
              label="Approved this month"
              value={pipeline.approvedThisMonth}
              onClick={() => goToList("APPROVED_INTERNAL")}
            />
            <PipelineCounter label="Traveling now" value={pipeline.activeNow} onClick={() => goToList("ACTIVE")} />
          </div>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div>
          <h3 className="mb-2 font-sans text-[13px] font-semibold tracking-normal text-text-primary">Recent trips</h3>
          <div className="flex flex-col gap-2">
            {recent.slice(0, 3).map((trip) => (
              <RecentTripButton key={trip.tripId} trip={trip} onClick={() => onOpenTrip(trip.tripId)} />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 5: Rewrite `StaffMyWork.jsx`**

Replace the whole file with:

```jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useDashboardPoll from "@/app/hooks/useDashboardPoll";
import AgencyCalendar from "./widgets/AgencyCalendar";
import DashboardGreeting from "./widgets/DashboardGreeting";
import DashboardSkeleton, { DASHBOARD_GRID_CLASS } from "./widgets/DashboardSkeleton";
import JoinedNotice from "./widgets/JoinedNotice";
import MyWorkColumn from "./widgets/MyWorkColumn";
import NeedsYouList from "./widgets/NeedsYouList";
import TripSlideOver from "./TripSlideOver";
import { STAFF_NEEDS_YOU_ORDER, buildNeedsYouItems } from "./needsYouItems";

/**
 * Staff dashboard: greeting, "Needs you today" and the calendar (scoped by
 * the server to trips this person created or organizes) on the left, their
 * own work on the right. Nothing here depends on a period, so there is no
 * period switcher.
 */
export default function StaffMyWork({
  agencyId,
  initialData = null,
  viewerName,
  onOpenTrip,
  onNewTrip,
  onOpenItineraries,
  showJoinedNotice = false,
}) {
  const router = useRouter();

  const { data, isStale, isFetching, error, refetch } = useDashboardPoll({
    agencyId,
    view: "staff",
    period: "30d",
    initialData,
  });

  const isLoading = !data && isFetching;
  const [slideTrip, setSlideTrip] = useState(null); // { tripId, tripTitle, subtitle }
  const needsYou = buildNeedsYouItems(data?.worklist, STAFF_NEEDS_YOU_ORDER);

  const openTripSlide = (tripId, tripTitle, subtitle) => {
    setSlideTrip({ tripId, tripTitle: tripTitle ?? "Trip", subtitle: subtitle ?? null });
  };

  const openTrip = (tripId) => {
    if (onOpenTrip) {
      onOpenTrip(tripId);
      return;
    }
    router.push(`/agency/${agencyId}/trip/${tripId}/agent`);
  };

  const newTrip = () => {
    if (onNewTrip) {
      onNewTrip();
      return;
    }
    router.push(`/agency/${agencyId}/trip/new`);
  };

  function handleNeedsYouAction(item) {
    if (item.kind === "unreadComments") openTripSlide(item.tripId, item.tripTitle, item.clientName);
    else openTrip(item.tripId);
  }

  return (
    <div className="px-6 py-6 md:px-8 lg:px-10">
      {showJoinedNotice && <JoinedNotice className="mb-5" />}

      <DashboardGreeting name={viewerName} count={data ? needsYou.length : null} onNewTrip={newTrip} />

      {isStale && (
        <div
          role="status"
          className="mt-4 inline-flex items-center gap-3 rounded-xl border border-secondary/30 bg-secondary/10 px-4 py-2 text-sm font-semibold text-secondary-strong"
        >
          <span>Data may be outdated.</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded-pill bg-secondary-strong px-3 py-1 text-xs font-bold text-on-secondary-strong hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            Refresh
          </button>
        </div>
      )}

      {error && !isStale && (
        <div role="alert" className="frame-tile mt-4 rounded-xl px-4 py-3 text-[13px] text-text-muted">
          Could not refresh data.{" "}
          <button type="button" onClick={refetch} className="font-semibold text-secondary-strong hover:underline">
            Try again
          </button>
        </div>
      )}

      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className={DASHBOARD_GRID_CLASS}>
          <div className="min-w-0 space-y-5">
            <NeedsYouList items={needsYou} onAction={handleNeedsYouAction} />
            <AgencyCalendar agencyId={agencyId} onOpenTrip={openTripSlide} />
          </div>
          <MyWorkColumn
            hero={data?.hero ?? null}
            recent={data?.secondaryRecent ?? []}
            pipeline={data?.pipeline ?? null}
            agencyId={agencyId}
            onOpenTrip={openTrip}
            onOpenItineraries={onOpenItineraries}
          />
        </div>
      )}

      <TripSlideOver
        isOpen={!!slideTrip}
        onClose={() => setSlideTrip(null)}
        agencyId={agencyId}
        tripId={slideTrip?.tripId}
        tripTitle={slideTrip?.tripTitle}
        subtitle={slideTrip?.subtitle}
        onOpenFull={(tripId) => {
          setSlideTrip(null);
          openTrip(tripId);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Pass the viewer's name from `HomePage.jsx`**

Replace:

```jsx
                <StaffMyWork
                  agencyId={agencyId}
                  initialData={null}
```

with:

```jsx
                <StaffMyWork
                  agencyId={agencyId}
                  initialData={null}
                  viewerName={user?.displayName}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/home-page-dashboard-tab.test.jsx tests/dashboard-empty-state.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/MyWorkColumn.jsx" "app/agency/[agencyId]/components/dashboard/widgets/HeroContinueCard.jsx" "app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx" app/components/trip-dashboard/HomePage.jsx tests/dashboard-server-contract.test.jsx
git commit -m "feat(dashboard): rebuild the staff dashboard around the calendar"
```

---

## Task 25: Remove dead widgets

**Repo:** Voyage-Client

**Files:**
- Delete: `app/agency/[agencyId]/components/dashboard/widgets/ActivityRibbon.jsx`

- [ ] **Step 1: Confirm nothing uses it**

Run: `grep -rn "ActivityRibbon" app tests`
Expected: matches only inside `widgets/ActivityRibbon.jsx` itself.

- [ ] **Step 2: Delete it**

```bash
git rm "app/agency/[agencyId]/components/dashboard/widgets/ActivityRibbon.jsx"
```

`EmptyState` keeps its `activity` variant; it is still covered by `tests/dashboard-empty-state.test.jsx`.

- [ ] **Step 3: Run the dashboard tests**

Run: `npx vitest run --pool=threads tests/dashboard-server-contract.test.jsx tests/dashboard-empty-state.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(dashboard): remove the activity ribbon"
```

---

## Task 26: Final verification

**Repos:** both

- [ ] **Step 1: Client suite and build**

In Voyage-Client run `npm test 2>&1 | tail -40`.
Expected: everything passes except files on the Task 9 baseline list.

Then run `npm run build`.
Expected: "Compiled successfully".

- [ ] **Step 2: Server suite and build**

In Voyage-Server run `npm test 2>&1 | tail -40` and `npm run build`.
Expected: same as Task 8.

- [ ] **Step 3: Manual QA in the browser**

Start the server (`npm run dev` in Voyage-Server) and the client (`npm run dev` in Voyage-Client). Sign in as an agency **owner**, then as a **staff** member, and check each item at 1440px, 1024px and 375px wide, in light and dark:

- Frame:
  - [ ] Glass panel inset 16px with a rounded frame and a soft streak behind it.
  - [ ] Full-bleed at 375px.
- Rail:
  - [ ] Hovering or tabbing shows each label.
  - [ ] The active item is terracotta.
  - [ ] The theme toggle works.
  - [ ] The avatar menu opens with arrows/Escape and Sign out works.
  - [ ] At 375px the hamburger opens the drawer *below* the header, with an inline Sign out.
- Dashboard:
  - [ ] No Command Center header on desktop.
  - [ ] The greeting uses the first name.
  - [ ] New trip works.
  - [ ] Needs you shows 5 items + "Show all".
  - [ ] Comment rows open the slide-over; other rows open the Command Center.
- Calendar:
  - [ ] Trips show as bars with labels; activity shows as dots.
  - [ ] Today has a dashed ring.
  - [ ] Clicking a day opens details beside it (inline under the grid at 375px).
  - [ ] Popover actions open the slide-over.
  - [ ] Arrows, Home/End and PageUp/PageDown move focus; Escape returns focus to the day.
  - [ ] Prev/Next/Today work.
- Insights (owner):
  - [ ] Period switch updates the KPIs and the "Last N days" caption.
  - [ ] Funnel stages open the detail panel.
  - [ ] "All reviews" expands.
- Staff:
  - [ ] Right column shows Continue, the four trip counts and recent trips.
  - [ ] The calendar shows only their trips.
- Command Center:
  - [ ] Chat over the live map looks exactly as before.
  - [ ] The header sits beside the rail with New Itinerary, the switcher and the live status.
- Settings:
  - [ ] The Team panel shows members.
  - [ ] Invite works for owners.
  - [ ] `/?authenticated=1&tab=team` opens Settings scrolled to Team.
  - [ ] `/?authenticated=1&tab=team&invited=1` opens the Dashboard with the joined notice.
- First-use tour:
  - [ ] Replay from Settings.
  - [ ] Header steps switch to the Command Center.
  - [ ] The Settings step highlights the rail button.

- [ ] **Step 4: Contrast spot check**

On the Dashboard, in each theme, paste into the DevTools console:

```js
(() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const cx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c; } return rgba(getComputedStyle(document.body).backgroundColor); };
  const ratio = (el) => { const bg = bgOf(el); const fg = rgba(getComputedStyle(el).color); const mix = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])); const [a, b] = [lum(mix), lum(bg)]; return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); };
  return [...document.querySelectorAll("main *")]
    .filter((e) => e.children.length === 0 && e.textContent.trim())
    .map((e) => ({ text: e.textContent.trim().slice(0, 30), ratio: ratio(e), size: getComputedStyle(e).fontSize }))
    .filter((r) => r.ratio < 4.5);
})();
```

Expected: an empty list, or only items whose real (blended glass) background measures ≥4.5:1 when checked by hand. The script skips translucent backgrounds, so double-check anything it flags. Fix tokens, not individual components.

- [ ] **Step 5: Record what was built in the spec**

Append to `Voyage-Server/docs/superpowers/specs/2026-10-03-dashboard-calendar-glass-redesign-design.md`:

```markdown

## 15. As built

Implemented on `feat/dashboard-calendar` (both repos) from `docs/superpowers/plans/2026-10-03-dashboard-calendar-glass-redesign.md`. Refinements made while planning:

- New `frame-*` tokens and utilities instead of `--glass-panel`, `--glass-tile` and `--glass-border`, because `--glass-*` and `glass-panel` drive the Command Center chat.
- Existing `--success`/`--danger`/`--color-status-warning`/`--color-text-muted` used for delta, expiry and activity colours. Only `--color-secondary-strong` and `--color-on-secondary-strong` are new.
- Server code in `calendar.ts`, `calendarRepository.ts` and `calendarService.ts`. `dashboardRepository.ts` and `dashboardService.ts` are unchanged.
- To-do rows keep their old actions and labels. Calendar popover actions open the trip slide-over: "Reply" for comments, "Open trip" otherwise.
- Empty to-do copy stays "All caught up."
- KPI sparklines, the activity ribbon and the staff "Starting soon" cards are removed.
- Popovers and the account menu use a solid surface. The rail logo is `/icon.svg`.
```

- [ ] **Step 6: Commit**

In Voyage-Server:

```bash
git add docs/superpowers/specs/2026-10-03-dashboard-calendar-glass-redesign-design.md
git commit -m "docs(dashboard): record as-built notes for the calendar redesign"
```

Commit any QA fixes in the repo they belong to, with a message that names the fix.
