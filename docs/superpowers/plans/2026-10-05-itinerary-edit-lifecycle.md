# Itinerary Edit Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agency staff change a saved itinerary until it is approved (by hand on the Itineraries page, or through the agent), lock it at approval, and let them reopen an approved trip for more changes.

**Architecture:** One status rule on the server (`itineraryLock.ts`) replaces the draft-only check on every edit path, including Reuse. New HTTP routes expose the agent's existing edit service methods to the Itineraries page, behind a trip-level access check. On the client, a hook (`useItineraryEditor`) holds the edit state and requests; small dialog components and a per-stop menu plug into the existing day view and mobile stop list.

**Tech Stack:** Express + Zod 4 + Prisma (server, Vitest + supertest); Next 16 / React 19 + Tailwind 4 (client, Vitest + Testing Library, jsdom).

---

## How it works

| Itinerary status | Trip label on the page | Who can change it | Header action |
|---|---|---|---|
| `DRAFT` | (still in chat) | The agent | Save (in chat) |
| `NEEDS_REVIEW` | In review | The agent in chat, staff by hand, Reuse | Approve |
| `APPROVED_INTERNAL` | Approved | Nobody: locked | Reopen for edits |

Reopen for edits sets the trip to `IN_REVIEW` and its itinerary to `NEEDS_REVIEW`. Staff make their changes, then approve again.

## Design decisions (approved in chat, 2026-10-05)

1. **The lock starts at Approve, not at Save.** Every edit path (agent tools, full replace, Reuse, hand edits) allows `DRAFT` and `NEEDS_REVIEW` and refuses `APPROVED_INTERNAL` with `409 ITINERARY_LOCKED` ("This itinerary is approved. Reopen it to make changes."). The agent's `delete_itinerary` stays draft-only (`ITINERARY_NOT_DRAFT`): a saved trip is removed with Delete trip.
2. **What staff can change by hand:** a stop's title, type, start and end time, description, client notes and staff notes; delete a stop; move it up, down or to another day (it lands at the end of that day); rename a day; add a custom stop with no map place. Swapping a stop's place stays with the agent, so hand edits never touch Google Places. The hand-edit schemas are strict and reject place fields.
3. **Who can reopen:** owners and admins for any trip, staff only for trips assigned to them. This is the existing `requireTripAccess` rule. Approve, Reopen, hand edits and the full-replace `PATCH` all use it (Approve had no trip check before).
4. **UI (option A from the mockups):** a ⋯ menu on each stop card with Edit details, Move up, Move down, Move to another day and Delete stop. Edit details and "+ Add stop" open a side panel, which becomes a bottom sheet on phones. Desktop renames a day with a pencil next to its title; the phone list has a "Rename day" button. Delete and Reopen ask for confirmation. Approved trips hide every edit control and Reuse, and show "Reopen for edits" in the header.
5. **Every hand-edit route answers `{ itinerary }`, using the same authorized read as `GET /:itineraryId`**, so the page swaps its copy for the response.
6. **Stale routes are cleared.** When stops are added, removed or moved, any stop whose previous stop changed has `routeFromPrevious` cleared, so the map leaves that leg out instead of drawing a wrong route. This lives in the repository, so the agent's add and move get the fix too.
7. **The agent reads the live itinerary at the start of each run** (instead of the last tool snapshot stored in the thread), so it sees hand edits and never overwrites them. If the itinerary is approved, the agent's context says it's locked and tells the agent to point staff to Reopen for edits.
8. **Errors:** a lock (409) or a stop that no longer exists (404) closes the dialog, shows a notice and reloads the itinerary. Other failures keep the dialog open with the message.
9. **Share links and the PDF** read the live itinerary, so they show the latest saved version. The Reopen confirmation says so.

**Out of scope:** Approve and Reopen on the phone layout (Approve isn't there today either); swapping a stop's place by hand; adding or removing whole days by hand; showing which staff member made an edit.

## Branches and test commands

The work lives on `fix/share-link-theme-pdf` in both repos, because it builds on that branch's Reuse-reload change (`ClientItineraryPage.handleReuseInserted`). It merges into `staging` together with that branch. Commits: server 5bf6da5 (this plan) and 0b5599b (the code); client e6b6123 (the code), then 65511b1, 16ffcc2 and 52f0e92 (fixes from Task 20's QA). An earlier `feat/itinerary-edit-lifecycle` branch points at the same commits and is no longer used.

- Server, one file: `cd Voyage-Server && npx vitest run tests/<file>`
- Server, all + build: `cd Voyage-Server && npx vitest run && npm run build`
- Client, one file: `cd Voyage-Client && npx vitest run --pool=threads tests/<file>`
- Client, all: `cd Voyage-Client && npx vitest run --pool=threads`

Client test gotcha: `app/components/icons/index.js` holds JSX in a `.js` file, which Vitest can't parse, so every test that renders an icon mocks that module. New tests use the Proxy mock from `tests/itinerary-header.test.jsx` (it stubs any icon). The page tests mock `ui/index.js` and `lib/api/index.js` with fixed export lists, so new page code imports `Modal`, the edit API and the new components **by direct path**.

Commit messages carry no `Co-Authored-By` line (the user's standing rule).

## File map

**Server (`Voyage-Server/`)**
- Create `src/modules/itineraries/itineraryLock.ts`: the one status rule.
- Create `src/modules/itineraries/routeStaleness.ts`: which stops' routes go stale after a reorder (pure).
- Modify `src/modules/itineraries/itineraryRepository.ts`: lock rule, stale-route clearing, `findItineraryTripId`, `reopenTrip`.
- Modify `src/modules/itineraries/itineraryTypes.ts`: the two new repository methods.
- Modify `src/modules/itineraries/itineraryService.ts`: lock rule in `replaceDraft`, `getItineraryTripId`, `reopenTrip`.
- Modify `src/modules/itineraries/itinerarySchemas.ts`: the hand-edit schemas.
- Modify `src/modules/itineraries/itineraryRoutes.ts`: hand-edit routes, reopen, trip access on approve and full replace.
- Modify `src/modules/ratedHistory/ratedHistoryErrors.ts`, `ratedHistoryService.ts`, `ratedHistoryRepository.ts`, `ratedHistoryRoutes.ts`: Reuse follows the lock.
- Modify `src/modules/agent/agentContextBuilder.ts`, `agentOrchestrator.ts`: live itinerary and the locked notice.
- Tests: create `tests/itineraryLock.test.ts`, `tests/routeStaleness.test.ts`, `tests/itineraryRepositoryEditing.test.ts`, `tests/itineraryManualEditSchemas.test.ts`, `tests/itineraryEditRoutes.test.ts`, `tests/ratedHistoryInsertLock.test.ts`, `tests/agentLiveItinerary.test.ts`; modify `tests/itineraryService.test.ts`, `tests/ratedHistoryService.test.ts`, `tests/ratedHistoryRoutes.test.ts`, `tests/agentOrchestrator.test.ts`.

**Client (`Voyage-Client/`)**
- Create `app/lib/api/itineraryEditing.js`: edit and reopen requests. Modify `app/lib/api/index.js` to re-export them.
- Create `app/lib/trip-dashboard/itineraryEditing.js`: lock rule, form helpers, move options, error messages (pure).
- Create `app/hooks/useItineraryEditor.js`: dialog state and requests.
- Modify `app/components/icons/index.js`: `MoreIcon`, `PencilIcon`.
- Modify `app/components/ui/Modal.jsx`: the side variant becomes a bottom sheet below `sm`.
- Create in `app/components/trip-dashboard/itinerary-edit/`: `StopActionsMenu.jsx`, `StopEditDialog.jsx`, `MoveStopDialog.jsx`, `RenameDayDialog.jsx`, `ConfirmActionDialog.jsx`, `DayEditActions.jsx`, `ItineraryEditDialogs.jsx`.
- Modify `app/components/trip-dashboard/pages/ItineraryDayView.jsx`, `app/components/trip-dashboard/mobile/CompactPlaceCard.jsx`, `app/components/trip-dashboard/pages/ItineraryHeader.jsx`, `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`.
- Modify `app/components/ratedHistory/hooks/useReuseDrop.js`, `app/components/ratedHistory/entryPoints/ReuseSlashCommand.jsx`: a plain message for a locked itinerary.
- Tests: create `tests/itinerary-editing-api.test.js`, `tests/itinerary-editing-helpers.test.js`, `tests/use-itinerary-editor.test.jsx`, `tests/stop-actions-menu.test.jsx`, `tests/stop-edit-dialog.test.jsx`, `tests/itinerary-edit-dialogs.test.jsx`, `tests/itinerary-day-view-editing.test.jsx`, `tests/client-itinerary-editing.test.jsx`; modify `tests/itinerary-header.test.jsx`, `tests/client-itinerary-reuse-insert.test.jsx`, `tests/useReuseDrop.smoke.test.jsx`, `tests/reuseSlashCommand.behaviour.test.jsx`.

---

### Task 0: Baseline

- [x] **Step 1: Record the current test results in both repos**

```bash
cd Voyage-Server && npx vitest run 2>&1 | tail -40
```

```bash
cd Voyage-Client && npx vitest run --pool=threads 2>&1 | tail -40
```

Write the failing test names down. Some stale tests already fail on this branch (see memory "Voyage known test failures"); the goal at the end is no **new** failures.

---

### Task 1: The lock rule

**Files:**
- Create: `Voyage-Server/src/modules/itineraries/itineraryLock.ts`
- Modify: `Voyage-Server/src/modules/itineraries/itineraryService.ts` (`replaceDraft`, ~line 193)
- Test: `Voyage-Server/tests/itineraryLock.test.ts`, `Voyage-Server/tests/itineraryService.test.ts`

- [x] **Step 1: Write the failing test**

Create `Voyage-Server/tests/itineraryLock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ITINERARY_LOCKED_MESSAGE,
  assertItineraryEditable,
  isItineraryEditable
} from "../src/modules/itineraries/itineraryLock";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("itinerary lock rule", () => {
  it("allows drafts and itineraries in review", () => {
    expect(isItineraryEditable("DRAFT")).toBe(true);
    expect(isItineraryEditable("NEEDS_REVIEW")).toBe(true);
  });

  it("locks approved itineraries and anything it doesn't recognise", () => {
    expect(isItineraryEditable("APPROVED_INTERNAL")).toBe(false);
    expect(isItineraryEditable(undefined)).toBe(false);
  });

  it("throws 409 ITINERARY_LOCKED for a locked itinerary", () => {
    expect(thrownBy(() => assertItineraryEditable("APPROVED_INTERNAL"))).toMatchObject({
      statusCode: 409,
      code: "ITINERARY_LOCKED",
      message: ITINERARY_LOCKED_MESSAGE
    });
    expect(thrownBy(() => assertItineraryEditable("NEEDS_REVIEW"))).toBeUndefined();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/itineraryLock.test.ts`
Expected: FAIL, cannot resolve `../src/modules/itineraries/itineraryLock`.

- [x] **Step 3: Write the rule**

Create `Voyage-Server/src/modules/itineraries/itineraryLock.ts`:

```ts
import { ApiError } from "../../http/errors";

/**
 * An itinerary can be changed while it is a draft or in review. Approval locks it
 * until someone reopens the trip (POST /agencies/:agencyId/itineraries/trips/:tripId/reopen).
 * Every edit path uses this rule: the agent's tools, the full replace, hand edits
 * from the Itineraries page and Reuse.
 */
export const ITINERARY_LOCKED_CODE = "ITINERARY_LOCKED";
export const ITINERARY_LOCKED_MESSAGE = "This itinerary is approved. Reopen it to make changes.";

export function isItineraryEditable(status: string | null | undefined): boolean {
  return status === "DRAFT" || status === "NEEDS_REVIEW";
}

export function assertItineraryEditable(status: string | null | undefined): void {
  if (!isItineraryEditable(status)) {
    throw new ApiError(409, ITINERARY_LOCKED_CODE, ITINERARY_LOCKED_MESSAGE);
  }
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Server && npx vitest run tests/itineraryLock.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Change the service test to the new rule**

In `Voyage-Server/tests/itineraryService.test.ts`:

(a) Add to the imports at the top:

```ts
import { assertItineraryEditable, ITINERARY_LOCKED_MESSAGE } from "../src/modules/itineraries/itineraryLock";
```

(b) In `createMemoryRepository().replaceItineraryDraft`, replace

```ts
      if (itinerary.status !== "DRAFT") {
        throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
      }
```

with

```ts
      assertItineraryEditable(itinerary.status);
```

(c) Replace the whole test `it("rejects replacing non-draft itineraries", ...)` with these two tests:

```ts
  it("replaces an itinerary that is in review", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());
    created.itinerary.status = "NEEDS_REVIEW";

    const replaced = await service.replaceDraft("agency-1", created.itinerary.id, {
      title: "Updated Cebu Plan",
      days: [{ dayNumber: 1, title: "Slower arrival", items: [] }]
    });

    expect(replaced.title).toBe("Updated Cebu Plan");
    expect(replaced.version).toBe(2);
  });

  it("refuses to replace an approved itinerary", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());
    created.itinerary.status = "APPROVED_INTERNAL";

    await expect(
      service.replaceDraft("agency-1", created.itinerary.id, {
        title: "Updated Cebu Plan",
        days: [{ dayNumber: 1, title: "Slower arrival", items: [] }]
      })
    ).rejects.toMatchObject({
      code: "ITINERARY_LOCKED",
      statusCode: 409,
      message: ITINERARY_LOCKED_MESSAGE
    });

    expect(repository.itineraries[0]?.title).toBe("4-Day Cebu Honeymoon");
    expect(repository.itineraries[0]?.version).toBe(1);
  });
```

- [x] **Step 6: Run the service test to verify the in-review case fails**

Run: `cd Voyage-Server && npx vitest run tests/itineraryService.test.ts`
Expected: FAIL. "replaces an itinerary that is in review" rejects with `ITINERARY_NOT_DRAFT`, and "refuses to replace an approved itinerary" gets `ITINERARY_NOT_DRAFT` instead of `ITINERARY_LOCKED`.

- [x] **Step 7: Use the rule in `replaceDraft`**

In `Voyage-Server/src/modules/itineraries/itineraryService.ts`, add an import next to the other local imports:

```ts
import { assertItineraryEditable } from "./itineraryLock";
```

and in `replaceDraft` replace

```ts
      if (existing.status !== "DRAFT") {
        throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
      }
```

with

```ts
      assertItineraryEditable(existing.status);
```

- [x] **Step 8: Run the tests to verify they pass**

Run: `cd Voyage-Server && npx vitest run tests/itineraryService.test.ts tests/itineraryLock.test.ts`
Expected: PASS.

- [x] **Step 9: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/itineraryLock.ts src/modules/itineraries/itineraryService.ts tests/itineraryLock.test.ts tests/itineraryService.test.ts && git commit -m "feat(itinerary): allow edits while in review and lock them at approval"
```

---

### Task 2: Which routes go stale after a reorder

**Files:**
- Create: `Voyage-Server/src/modules/itineraries/routeStaleness.ts`
- Test: `Voyage-Server/tests/routeStaleness.test.ts`

- [x] **Step 1: Write the failing test**

Create `Voyage-Server/tests/routeStaleness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stopsWithStaleRoutes, type DayItemOrder } from "../src/modules/itineraries/routeStaleness";

const day = (id: string, ...itemIds: string[]) => ({ id, items: itemIds.map((itemId) => ({ id: itemId })) });

describe("stopsWithStaleRoutes", () => {
  it("flags the stop after a removed stop", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b", "c")], [day("d1", "a", "c")])).toEqual(["c"]);
  });

  it("flags every stop whose previous stop changed in a reorder", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b", "c")], [day("d1", "b", "a", "c")])).toEqual(["b", "a", "c"]);
  });

  it("flags a stop moved to another day and the stop it left behind", () => {
    const before: DayItemOrder = [day("d1", "a", "b", "c"), day("d2", "d")];
    const after: DayItemOrder = [day("d1", "a", "c"), day("d2", "d", "b")];
    expect(stopsWithStaleRoutes(before, after)).toEqual(["c", "b"]);
  });

  it("skips a new stop but flags the stop it was inserted before", () => {
    expect(stopsWithStaleRoutes([day("d1", "a", "b")], [day("d1", "a", "new", "b")])).toEqual(["b"]);
  });

  it("flags nothing when a stop is added at the end", () => {
    expect(stopsWithStaleRoutes([day("d1", "a")], [day("d1", "a", "new")])).toEqual([]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/routeStaleness.test.ts`
Expected: FAIL, cannot resolve `routeStaleness`.

- [x] **Step 3: Write the helper**

Create `Voyage-Server/src/modules/itineraries/routeStaleness.ts`:

```ts
/**
 * A stop's stored route (routeFromPrevious) starts at the stop before it. After stops
 * are added, removed or moved, a stop whose previous stop changed keeps a route from
 * the wrong place. Those routes are cleared, so the map leaves the leg out instead of
 * drawing it wrong.
 */
export type DayItemOrder = Array<{ id: string; items: Array<{ id: string }> }>;

/** Each stop's previous stop in the same day; the first stop of a day has none. */
function previousStopById(days: DayItemOrder): Map<string, string | null> {
  const previous = new Map<string, string | null>();
  for (const day of days) {
    day.items.forEach((item, index) => {
      previous.set(item.id, index === 0 ? null : day.items[index - 1].id);
    });
  }
  return previous;
}

/**
 * Stops in both orders whose previous stop is different afterwards, in `after` order.
 * A stop that only appears in `after` is skipped: whoever added it set its route.
 */
export function stopsWithStaleRoutes(before: DayItemOrder, after: DayItemOrder): string[] {
  const previousBefore = previousStopById(before);
  const stale: string[] = [];
  for (const [itemId, previous] of previousStopById(after)) {
    if (previousBefore.has(itemId) && previousBefore.get(itemId) !== previous) {
      stale.push(itemId);
    }
  }
  return stale;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Server && npx vitest run tests/routeStaleness.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/routeStaleness.ts tests/routeStaleness.test.ts && git commit -m "feat(itinerary): work out which stop routes a reorder makes stale"
```

---

### Task 3: Repository: lock, stale routes, trip lookup and reopen

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRepository.ts`
- Modify: `Voyage-Server/src/modules/itineraries/itineraryTypes.ts` (`ItineraryRepository`, ~line 92)
- Test: `Voyage-Server/tests/itineraryRepositoryEditing.test.ts`

- [x] **Step 1: Write the failing test**

Create `Voyage-Server/tests/itineraryRepositoryEditing.test.ts`. The fake client implements only the Prisma calls these repository methods make, backed by plain arrays:

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

type FakeItem = { id: string; itineraryDayId: string; sortOrder: number; title: string; routeFromPrevious: unknown };
type FakeState = {
  trips: Array<{ id: string; agencyId: string; status: string }>;
  itineraries: Array<{ id: string; agencyId: string; tripId: string; status: string; updatedAt: Date }>;
  days: Array<{ id: string; itineraryId: string; dayNumber: number; title: string }>;
  items: FakeItem[];
};

const AGENCY = "agency-1";

function createState(status: "NEEDS_REVIEW" | "APPROVED_INTERNAL" = "NEEDS_REVIEW"): FakeState {
  return {
    trips: [{ id: "trip-1", agencyId: AGENCY, status: status === "APPROVED_INTERNAL" ? "APPROVED_INTERNAL" : "IN_REVIEW" }],
    itineraries: [{ id: "itin-1", agencyId: AGENCY, tripId: "trip-1", status, updatedAt: new Date("2026-10-01") }],
    days: [
      { id: "day-1", itineraryId: "itin-1", dayNumber: 1, title: "Arrival" },
      { id: "day-2", itineraryId: "itin-1", dayNumber: 2, title: "Old town" }
    ],
    items: [
      { id: "a", itineraryDayId: "day-1", sortOrder: 1, title: "A", routeFromPrevious: null },
      { id: "b", itineraryDayId: "day-1", sortOrder: 2, title: "B", routeFromPrevious: { polyline: "a-b" } },
      { id: "c", itineraryDayId: "day-1", sortOrder: 3, title: "C", routeFromPrevious: { polyline: "b-c" } },
      { id: "d", itineraryDayId: "day-2", sortOrder: 1, title: "D", routeFromPrevious: null }
    ]
  };
}

function createFakeClient(state: FakeState): PrismaClient {
  const itemsOf = (dayId: string) =>
    state.items.filter((item) => item.itineraryDayId === dayId).sort((x, y) => x.sortOrder - y.sortOrder);
  const dayOf = (dayId: string) => state.days.find((day) => day.id === dayId);
  const fullItinerary = (itinerary: FakeState["itineraries"][number]) => ({
    ...itinerary,
    days: state.days
      .filter((day) => day.itineraryId === itinerary.id)
      .sort((x, y) => x.dayNumber - y.dayNumber)
      .map((day) => ({ ...day, items: itemsOf(day.id).map((item) => ({ ...item, placeSnapshot: null })) }))
  });

  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      return fn(client);
    },
    itinerary: {
      async findFirst({ where, include }: any) {
        const row = state.itineraries.find((it) => it.id === where.id && it.agencyId === where.agencyId);
        if (!row) return null;
        return include ? fullItinerary(row) : { id: row.id, status: row.status, tripId: row.tripId };
      },
      async update({ where, data }: any) {
        const row = state.itineraries.find((it) => it.id === where.id)!;
        if (typeof data.status === "string") row.status = data.status;
        return { id: row.id, status: row.status };
      }
    },
    clientTrip: {
      async findFirst({ where }: any) {
        const trip = state.trips.find((row) => row.id === where.id && row.agencyId === where.agencyId);
        if (!trip) return null;
        const itineraries = state.itineraries
          .filter((row) => row.tripId === trip.id)
          .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())
          .slice(0, 1)
          .map((row) => ({ id: row.id, status: row.status }));
        return { ...trip, itineraries };
      },
      async update({ where, data }: any) {
        const trip = state.trips.find((row) => row.id === where.id)!;
        Object.assign(trip, data);
        return { ...trip };
      }
    },
    itineraryDay: {
      async findFirst({ where }: any) {
        const day = state.days.find((row) => row.id === where.id && row.itineraryId === where.itineraryId);
        return day ? { id: day.id, dayNumber: day.dayNumber } : null;
      },
      async findMany({ where }: any) {
        return state.days
          .filter((day) => where.id.in.includes(day.id))
          .map((day) => ({ id: day.id, items: itemsOf(day.id).map((item) => ({ id: item.id })) }));
      },
      async update({ where, data }: any) {
        const day = dayOf(where.id)!;
        Object.assign(day, data);
        return { ...day, items: itemsOf(day.id) };
      }
    },
    itineraryItem: {
      async findFirst({ where }: any) {
        const item = state.items.find((row) => row.id === where.id);
        if (!item || dayOf(item.itineraryDayId)?.itineraryId !== where.itineraryDay.itineraryId) return null;
        return { id: item.id, itineraryDayId: item.itineraryDayId };
      },
      async findMany({ where }: any) {
        return itemsOf(where.itineraryDayId)
          .filter((item) => item.id !== where.NOT?.id)
          .map((item) => ({ id: item.id, sortOrder: item.sortOrder, startTime: null }));
      },
      async create({ data }: any) {
        const item = { routeFromPrevious: null, ...data, id: `new-${state.items.length + 1}` };
        state.items.push(item);
        return { ...item, placeSnapshot: null };
      },
      async update({ where, data }: any) {
        const item = state.items.find((row) => row.id === where.id)!;
        Object.assign(item, data);
        return { ...item, placeSnapshot: null };
      },
      async updateMany({ where, data }: any) {
        const rows = state.items.filter((row) => where.id.in.includes(row.id));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      async delete({ where }: any) {
        state.items = state.items.filter((row) => row.id !== where.id);
      }
    }
  };
  return client as PrismaClient;
}

const repoFor = (state: FakeState) => createPrismaItineraryRepository(createFakeClient(state));
const orderOf = (state: FakeState, dayId: string) =>
  state.items
    .filter((item) => item.itineraryDayId === dayId)
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((item) => item.id);
const routeOf = (state: FakeState, itemId: string) => state.items.find((item) => item.id === itemId)?.routeFromPrevious;

describe("itinerary repository lock", () => {
  it("lets an itinerary in review be edited", async () => {
    const state = createState("NEEDS_REVIEW");
    await repoFor(state).updateItem("itin-1", AGENCY, "b", { title: "B, renamed" });
    expect(state.items.find((item) => item.id === "b")?.title).toBe("B, renamed");
  });

  it("refuses edits to an approved itinerary with ITINERARY_LOCKED", async () => {
    const state = createState("APPROVED_INTERNAL");
    await expect(repoFor(state).updateItem("itin-1", AGENCY, "b", { title: "Nope" })).rejects.toMatchObject({
      statusCode: 409,
      code: "ITINERARY_LOCKED"
    });
    await expect(repoFor(state).updateDay("itin-1", AGENCY, "day-1", { title: "Nope" })).rejects.toMatchObject({
      code: "ITINERARY_LOCKED"
    });
    expect(state.items.find((item) => item.id === "b")?.title).toBe("B");
    expect(state.days[0].title).toBe("Arrival");
  });
});

describe("stale route clearing", () => {
  it("clears the route of the stop after a removed stop", async () => {
    const state = createState();
    await repoFor(state).removeItem("itin-1", AGENCY, "b");
    expect(orderOf(state, "day-1")).toEqual(["a", "c"]);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
  });

  it("clears both routes that change when a stop moves up", async () => {
    const state = createState();
    await repoFor(state).moveItem("itin-1", AGENCY, "c", { toDayId: "day-1", toSortOrder: 2 });
    expect(orderOf(state, "day-1")).toEqual(["a", "c", "b"]);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
  });

  it("clears the moved stop's route and the one it leaves behind when moving to another day", async () => {
    const state = createState();
    await repoFor(state).moveItem("itin-1", AGENCY, "b", { toDayId: "day-2" });
    expect(orderOf(state, "day-1")).toEqual(["a", "c"]);
    expect(orderOf(state, "day-2")).toEqual(["d", "b"]);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
    expect(routeOf(state, "c")).toBe(Prisma.DbNull);
  });

  it("keeps routes that still start from the right stop when a stop is inserted", async () => {
    const state = createState();
    await repoFor(state).addItem("itin-1", AGENCY, {
      dayId: "day-1",
      sortOrder: 2,
      item: { type: "NOTE", title: "Coffee" } as any
    });
    const added = state.items.find((item) => item.title === "Coffee")!;
    expect(orderOf(state, "day-1")).toEqual(["a", added.id, "b", "c"]);
    expect(routeOf(state, "b")).toBe(Prisma.DbNull);
    expect(routeOf(state, "c")).toEqual({ polyline: "b-c" });
  });
});

describe("trip lookup and reopen", () => {
  it("finds the trip an itinerary belongs to, only inside the agency", async () => {
    const state = createState();
    await expect(repoFor(state).findItineraryTripId("itin-1", AGENCY)).resolves.toMatchObject({ tripId: "trip-1" });
    await expect(repoFor(state).findItineraryTripId("itin-1", "agency-2")).resolves.toBeNull();
  });

  it("moves an approved trip and its itinerary back to review", async () => {
    const state = createState("APPROVED_INTERNAL");
    const result = await repoFor(state).reopenTrip("trip-1", AGENCY);
    expect(state.trips[0].status).toBe("IN_REVIEW");
    expect(state.itineraries[0].status).toBe("NEEDS_REVIEW");
    expect(result.itinerary).toEqual({ id: "itin-1", status: "NEEDS_REVIEW" });
    expect(result.trip.status).toBe("IN_REVIEW");
  });

  it("returns a trip that is already in review unchanged", async () => {
    const state = createState("NEEDS_REVIEW");
    const result = await repoFor(state).reopenTrip("trip-1", AGENCY);
    expect(state.trips[0].status).toBe("IN_REVIEW");
    expect(result.itinerary).toEqual({ id: "itin-1", status: "NEEDS_REVIEW" });
  });

  it("404s for another agency's trip and changes nothing", async () => {
    const state = createState("APPROVED_INTERNAL");
    await expect(repoFor(state).reopenTrip("trip-1", "agency-2")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
    expect(state.trips[0].status).toBe("APPROVED_INTERNAL");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/itineraryRepositoryEditing.test.ts`
Expected: FAIL. The in-review edit gets `ITINERARY_NOT_DRAFT`, routes stay set, and `findItineraryTripId` / `reopenTrip` are not functions.

- [x] **Step 3: Add the two methods to the repository type**

In `Voyage-Server/src/modules/itineraries/itineraryTypes.ts`, inside `export interface ItineraryRepository {`, add after `findItineraryByAgency(...)`:

```ts
  /** The trip an itinerary belongs to, for trip-level access checks. Null outside the agency. */
  findItineraryTripId(id: string, agencyId: string): Promise<{ tripId: string | null } | null>;
```

and after `approveTrip(...)`:

```ts
  /** Undo an approval: the trip goes back to IN_REVIEW and its latest itinerary to NEEDS_REVIEW. */
  reopenTrip(
    tripId: string,
    agencyId: string
  ): Promise<{ trip: ClientTripRecord; itinerary: { id: string; status: string } | null }>;
```

- [x] **Step 4: Change the repository**

In `Voyage-Server/src/modules/itineraries/itineraryRepository.ts`:

(a) Replace the first import line

```ts
import type { Prisma, PrismaClient } from "@prisma/client";
```

with (`Prisma.DbNull` is a value, so `Prisma` can no longer be a type-only import)

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
```

and add after the `import { assertUuid } from "./itineraryService";` line:

```ts
import { assertItineraryEditable } from "./itineraryLock";
import { stopsWithStaleRoutes, type DayItemOrder } from "./routeStaleness";
```

(b) In `replaceItineraryDraft`, replace

```ts
        if (existing.status !== "DRAFT") {
          throw new ApiError(409, "ITINERARY_NOT_DRAFT", "Only draft itineraries can be replaced.");
        }
```

with

```ts
        assertItineraryEditable(existing.status);
```

Leave `deleteItinerary`'s draft-only check (`ITINERARY_NOT_DRAFT`, "Only draft itineraries can be deleted.") as it is.

(c) At the bottom of the file, replace the whole `assertDraftItinerary` function with:

```ts
async function assertEditableItinerary(tx: ItineraryTx, id: string, agencyId: string) {
  const existing = await tx.itinerary.findFirst({
    where: { id, agencyId },
    select: { id: true, status: true }
  });
  if (!existing) {
    throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
  }
  assertItineraryEditable(existing.status);
  return existing;
}

/** The stop order of the given days, for working out which routes a change made stale. */
async function readDayOrders(tx: ItineraryTx, dayIds: string[]): Promise<DayItemOrder> {
  return tx.itineraryDay.findMany({
    where: { id: { in: [...new Set(dayIds)] } },
    select: { id: true, items: { orderBy: { sortOrder: "asc" }, select: { id: true } } }
  });
}

/** Clears the stored route of every stop whose previous stop changed since `before`. */
async function clearStaleRoutes(tx: ItineraryTx, dayIds: string[], before: DayItemOrder) {
  const stale = stopsWithStaleRoutes(before, await readDayOrders(tx, dayIds));
  if (stale.length === 0) return;
  await tx.itineraryItem.updateMany({
    where: { id: { in: stale } },
    data: { routeFromPrevious: Prisma.DbNull }
  });
}
```

Then rename the seven calls `await assertDraftItinerary(tx, itineraryId, agencyId);` to `await assertEditableItinerary(tx, itineraryId, agencyId);` (in `addDay`, `updateDay`, `removeDay`, `addItem`, `updateItem`, `removeItem`, `moveItem`). Check with `grep -n assertDraftItinerary src/modules/itineraries/itineraryRepository.ts`: there should be no matches left.

(d) In `addItem`, right after the `if (!day) { throw ... "Itinerary day not found." }` block, add:

```ts
        const before = await readDayOrders(tx, [data.dayId]);
```

and right after the `const created = await tx.itineraryItem.create({ ... });` statement, add:

```ts
        await clearStaleRoutes(tx, [data.dayId], before);
```

(e) In `removeItem`, right after the `if (!existing) { throw ... "Itinerary item not found." }` block, add:

```ts
        const before = await readDayOrders(tx, [existing.itineraryDayId]);
```

and right after `await resequenceDayItems(tx, existing.itineraryDayId);`, add:

```ts
        await clearStaleRoutes(tx, [existing.itineraryDayId], before);
```

(f) In `moveItem`, right after `const toDayId = target.toDayId;`, add:

```ts
        const before = await readDayOrders(tx, [fromDayId, toDayId]);
```

and right after the final block

```ts
        if (fromDayId === toDayId) {
          await resequenceDayItems(tx, toDayId);
        }
```

add:

```ts
        await clearStaleRoutes(tx, [fromDayId, toDayId], before);
```

(g) Add `findItineraryTripId` right after `findItineraryByAgency`:

```ts
    async findItineraryTripId(id, agencyId) {
      return client.itinerary.findFirst({
        where: { id, agencyId },
        select: { tripId: true }
      });
    },
```

(h) Add `reopenTrip` right after `approveTrip`:

```ts
    async reopenTrip(tripId, agencyId) {
      return client.$transaction(async (tx) => {
        const trip = await tx.clientTrip.findFirst({
          where: { id: tripId, agencyId },
          include: {
            itineraries: {
              orderBy: { updatedAt: "desc" as const },
              take: 1,
              select: { id: true, status: true }
            }
          }
        });
        if (!trip) {
          throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
        }

        // Reopening only undoes an approval. A trip that is still a draft or in
        // review is returned unchanged, so a repeated click does no harm.
        const { itineraries, ...tripRow } = trip;
        const updatedTrip =
          tripRow.status === "APPROVED_INTERNAL"
            ? await tx.clientTrip.update({ where: { id: tripId }, data: { status: "IN_REVIEW" } })
            : tripRow;

        const latest = itineraries[0] ?? null;
        const itinerary =
          latest?.status === "APPROVED_INTERNAL"
            ? await tx.itinerary.update({
                where: { id: latest.id },
                data: { status: "NEEDS_REVIEW" },
                select: { id: true, status: true }
              })
            : latest;

        return { trip: updatedTrip as unknown as ClientTripRecord, itinerary };
      });
    },
```

- [x] **Step 5: Run the test to verify it passes**

Run: `cd Voyage-Server && npx vitest run tests/itineraryRepositoryEditing.test.ts`
Expected: PASS (11 tests).

- [x] **Step 6: Check the types**

Run: `cd Voyage-Server && npx tsc --noEmit`
Expected: no new errors. `itineraryService.test.ts`'s memory repository doesn't implement the two new methods yet; tests are outside `tsconfig.json`'s `include`, so tsc doesn't see them, and Task 4 adds them.

- [x] **Step 7: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/itineraryRepository.ts src/modules/itineraries/itineraryTypes.ts tests/itineraryRepositoryEditing.test.ts && git commit -m "feat(itinerary): lock edits at approval, clear stale routes, add reopen"
```

---

### Task 4: Service: trip lookup and reopen

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryService.ts`
- Test: `Voyage-Server/tests/itineraryService.test.ts`

- [x] **Step 1: Teach the memory repository the two methods**

In `Voyage-Server/tests/itineraryService.test.ts`, inside `createMemoryRepository()`'s returned object, add after `findItineraryByAgency`:

```ts
    async findItineraryTripId(id, agencyId) {
      const itinerary = itineraries.find((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      return itinerary ? { tripId: itinerary.tripId } : null;
    },
```

and after `approveTrip`:

```ts
    async reopenTrip(tripId, agencyId) {
      const trip = trips.find((t) => t.id === tripId && t.agencyId === agencyId);
      if (!trip) {
        throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
      }
      const itinerary = itineraries.find((i) => i.tripId === tripId) ?? null;
      if (trip.status === "APPROVED_INTERNAL") trip.status = "IN_REVIEW";
      if (itinerary?.status === "APPROVED_INTERNAL") itinerary.status = "NEEDS_REVIEW";
      return { trip, itinerary: itinerary ? { id: itinerary.id, status: itinerary.status } : null };
    },
```

- [x] **Step 2: Write the failing tests**

Append to the end of `Voyage-Server/tests/itineraryService.test.ts`:

```ts
describe("getItineraryTripId", () => {
  it("returns the trip an itinerary belongs to", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    await expect(service.getItineraryTripId("agency-1", created.itinerary.id)).resolves.toBe(created.trip.id);
  });

  it("404s for another agency's itinerary", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-other", "user-1", createStructuredInput());

    await expect(service.getItineraryTripId("agency-1", created.itinerary.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "ITINERARY_NOT_FOUND"
    });
  });
});

describe("reopenTrip", () => {
  it("puts an approved trip back in review", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());
    created.trip.status = "APPROVED_INTERNAL";
    created.itinerary.status = "APPROVED_INTERNAL";

    const result = await service.reopenTrip("agency-1", created.trip.id);

    expect(result.trip.status).toBe("IN_REVIEW");
    expect(result.itinerary).toEqual({ id: created.itinerary.id, status: "NEEDS_REVIEW" });
  });
});
```

- [x] **Step 3: Run them to verify they fail**

Run: `cd Voyage-Server && npx vitest run tests/itineraryService.test.ts`
Expected: FAIL, `service.getItineraryTripId is not a function` and `service.reopenTrip is not a function`.

- [x] **Step 4: Add the methods**

In `Voyage-Server/src/modules/itineraries/itineraryService.ts`, add before `async approveTrip(`:

```ts
    /** The trip an itinerary belongs to, for trip-level access checks on edits. */
    async getItineraryTripId(agencyId: string, itineraryId: string) {
      const found = await options.repository.findItineraryTripId(itineraryId, agencyId);
      if (!found?.tripId) {
        throw new ApiError(404, "ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return found.tripId;
    },
```

and after `approveTrip`:

```ts
    async reopenTrip(agencyId: string, tripId: string) {
      return options.repository.reopenTrip(tripId, agencyId);
    },
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd Voyage-Server && npx vitest run tests/itineraryService.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/itineraryService.ts tests/itineraryService.test.ts && git commit -m "feat(itinerary): look up an itinerary's trip and reopen trips in the service"
```

---

### Task 5: Hand-edit request schemas

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itinerarySchemas.ts` (append)
- Test: `Voyage-Server/tests/itineraryManualEditSchemas.test.ts`

- [x] **Step 1: Write the failing test**

Create `Voyage-Server/tests/itineraryManualEditSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  manualDayRenameSchema,
  manualStopCreateSchema,
  manualStopMoveSchema,
  manualStopPatchSchema
} from "../src/modules/itineraries/itinerarySchemas";

describe("hand-edit schemas", () => {
  it("accepts a custom stop with just a type and a trimmed title", () => {
    expect(manualStopCreateSchema.parse({ type: "NOTE", title: "  Coffee break " })).toEqual({
      type: "NOTE",
      title: "Coffee break"
    });
  });

  it("rejects place fields, so a hand edit can't change which place a stop points to", () => {
    expect(manualStopCreateSchema.safeParse({ type: "ACTIVITY", title: "Museum", placeName: "Museo" }).success).toBe(false);
    expect(
      manualStopPatchSchema.safeParse({ placeSnapshotId: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(false);
  });

  it("accepts a patch that clears a field, and refuses an empty patch or a blank title", () => {
    expect(manualStopPatchSchema.parse({ description: "" })).toEqual({ description: "" });
    expect(manualStopPatchSchema.safeParse({}).success).toBe(false);
    expect(manualStopPatchSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("needs a real day id to move a stop", () => {
    expect(manualStopMoveSchema.safeParse({ toDayId: "day-2" }).success).toBe(false);
    expect(
      manualStopMoveSchema.parse({ toDayId: "22222222-2222-4222-8222-222222222222", toSortOrder: 1 })
    ).toEqual({ toDayId: "22222222-2222-4222-8222-222222222222", toSortOrder: 1 });
  });

  it("trims a day title and refuses a blank one", () => {
    expect(manualDayRenameSchema.parse({ title: " Old town " })).toEqual({ title: "Old town" });
    expect(manualDayRenameSchema.safeParse({ title: " " }).success).toBe(false);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/itineraryManualEditSchemas.test.ts`
Expected: FAIL, the schemas are undefined.

- [x] **Step 3: Add the schemas**

Append to `Voyage-Server/src/modules/itineraries/itinerarySchemas.ts`:

```ts
// ── Hand edits from the Itineraries page ─────────────────────────────────────
// Strict on purpose: place fields (placeName, placeSnapshotId, cityContext,
// routeFromPrevious) are rejected, so a hand edit never changes which place a stop
// points to. That stays with the agent, which checks the new place. An empty string
// clears an optional field.
export const manualStopCreateSchema = z
  .object({
    type: itineraryItemTypeSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    startTime: z.string().trim().max(20).optional(),
    endTime: z.string().trim().max(20).optional(),
    clientNotes: z.string().trim().max(2000).optional(),
    staffNotes: z.string().trim().max(2000).optional()
  })
  .strict();

export const manualStopPatchSchema = manualStopCreateSchema
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Send at least one field to change.");

export const manualDayRenameSchema = z
  .object({
    title: z.string().trim().min(1).max(200)
  })
  .strict();

export const manualStopMoveSchema = z
  .object({
    toDayId: z.string().uuid(),
    // The stop's 1-based position among the day's other stops; left out, it goes last.
    toSortOrder: z.number().int().positive().optional()
  })
  .strict();
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Server && npx vitest run tests/itineraryManualEditSchemas.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/itinerarySchemas.ts tests/itineraryManualEditSchemas.test.ts && git commit -m "feat(itinerary): add strict schemas for hand edits"
```

---

### Task 6: Routes: hand edits, reopen, trip access

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts` (whole file below)
- Test: `Voyage-Server/tests/itineraryEditRoutes.test.ts`

- [x] **Step 1: Write the failing test**

Create `Voyage-Server/tests/itineraryEditRoutes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const ITINERARY_ID = "22222222-2222-4222-8222-222222222222";
const DAY_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_DAY_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TRIP_ID = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
  requireVerifiedAgencyMember: vi.fn(),
  requireTripAccess: vi.fn(),
  getItineraryTripId: vi.fn(),
  getItinerary: vi.fn(),
  updateDay: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  moveItem: vi.fn(),
  replaceDraft: vi.fn(),
  approveTrip: vi.fn(),
  reopenTrip: vi.fn(),
  createPlaceSession: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: {
    requireVerifiedAgencyMember: mocks.requireVerifiedAgencyMember,
    requireTripAccess: mocks.requireTripAccess
  }
}));
vi.mock("../src/modules/itineraries/itineraryService", () => ({
  itineraryService: {
    getItineraryTripId: mocks.getItineraryTripId,
    getItinerary: mocks.getItinerary,
    updateDay: mocks.updateDay,
    addItem: mocks.addItem,
    updateItem: mocks.updateItem,
    removeItem: mocks.removeItem,
    moveItem: mocks.moveItem,
    replaceDraft: mocks.replaceDraft,
    approveTrip: mocks.approveTrip,
    reopenTrip: mocks.reopenTrip
  }
}));
vi.mock("../src/services/places/placeServices", () => ({
  createPlaceSession: mocks.createPlaceSession,
  getPlaceRefreshScheduler: vi.fn(() => "scheduler")
}));
vi.mock("../src/modules/weather/weatherService", () => ({ itineraryWeatherService: {} }));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { itineraryRoutes } from "../src/modules/itineraries/itineraryRoutes";

const staffUser = {
  id: "user-staff",
  role: "USER",
  status: "ACTIVE",
  accountType: "AGENCY_USER",
  displayName: "Staff User",
  memberships: []
};
const itinerary = { id: ITINERARY_ID, status: "NEEDS_REVIEW", days: [] };
const base = `/agencies/${AGENCY_ID}/itineraries`;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = staffUser as any;
    next();
  });
  app.use("/agencies/:agencyId/itineraries", itineraryRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const notAssigned = () => new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVerifiedAgencyMember.mockResolvedValue({
    agency: { id: AGENCY_ID, status: "VERIFIED" },
    membership: { role: "STAFF", status: "ACTIVE" }
  });
  mocks.requireTripAccess.mockResolvedValue({});
  mocks.getItineraryTripId.mockResolvedValue(TRIP_ID);
  mocks.getItinerary.mockResolvedValue(itinerary);
  mocks.createPlaceSession.mockResolvedValue("session");
  for (const edit of [mocks.updateDay, mocks.addItem, mocks.updateItem, mocks.removeItem, mocks.moveItem]) {
    edit.mockResolvedValue({});
  }
});

describe("PATCH /:itineraryId/days/:dayId", () => {
  it("renames the day and answers with the itinerary as GET reads it", async () => {
    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "  Old town walk " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itinerary });
    expect(mocks.requireTripAccess).toHaveBeenCalledWith(staffUser, AGENCY_ID, TRIP_ID);
    expect(mocks.updateDay).toHaveBeenCalledWith(AGENCY_ID, { itineraryId: ITINERARY_ID, dayId: DAY_ID, title: "Old town walk" });
    expect(mocks.getItinerary).toHaveBeenCalledWith(AGENCY_ID, ITINERARY_ID, { session: "session", scheduler: "scheduler" });
  });

  it("refuses staff who aren't assigned to the trip", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "Old town" });

    expect(res.status).toBe(404);
    expect(mocks.updateDay).not.toHaveBeenCalled();
  });

  it("passes the lock through as 409 ITINERARY_LOCKED", async () => {
    mocks.updateDay.mockRejectedValue(
      new ApiError(409, "ITINERARY_LOCKED", "This itinerary is approved. Reopen it to make changes.")
    );

    const res = await request(createApp()).patch(`${base}/${ITINERARY_ID}/days/${DAY_ID}`).send({ title: "Old town" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITINERARY_LOCKED");
  });
});

describe("POST /:itineraryId/days/:dayId/items", () => {
  it("adds a custom stop", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/days/${DAY_ID}/items`)
      .send({ type: "NOTE", title: "Coffee break", startTime: "3:00 PM" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ itinerary });
    expect(mocks.addItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      dayId: DAY_ID,
      item: { type: "NOTE", title: "Coffee break", startTime: "3:00 PM" }
    });
  });

  it("rejects place fields before checking access", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/days/${DAY_ID}/items`)
      .send({ type: "ACTIVITY", title: "Museum", placeName: "Museo" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.requireTripAccess).not.toHaveBeenCalled();
    expect(mocks.addItem).not.toHaveBeenCalled();
  });
});

describe("PATCH /:itineraryId/items/:itemId", () => {
  it("sends only the fields in the request", async () => {
    const res = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`)
      .send({ startTime: "10:00 AM", description: "" });

    expect(res.status).toBe(200);
    expect(mocks.updateItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      itemId: ITEM_ID,
      item: { startTime: "10:00 AM", description: "" }
    });
  });

  it("rejects an empty patch and a place change", async () => {
    const empty = await request(createApp()).patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`).send({});
    const place = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`)
      .send({ placeSnapshotId: ITEM_ID });

    expect(empty.status).toBe(400);
    expect(place.status).toBe(400);
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /:itineraryId/items/:itemId", () => {
  it("deletes the stop", async () => {
    const res = await request(createApp()).delete(`${base}/${ITINERARY_ID}/items/${ITEM_ID}`);

    expect(res.status).toBe(200);
    expect(mocks.removeItem).toHaveBeenCalledWith(AGENCY_ID, { itineraryId: ITINERARY_ID, itemId: ITEM_ID });
  });
});

describe("POST /:itineraryId/items/:itemId/move", () => {
  it("moves the stop to the given day and position", async () => {
    const res = await request(createApp())
      .post(`${base}/${ITINERARY_ID}/items/${ITEM_ID}/move`)
      .send({ toDayId: OTHER_DAY_ID, toSortOrder: 1 });

    expect(res.status).toBe(200);
    expect(mocks.moveItem).toHaveBeenCalledWith(AGENCY_ID, {
      itineraryId: ITINERARY_ID,
      itemId: ITEM_ID,
      toDayId: OTHER_DAY_ID,
      toSortOrder: 1
    });
  });
});

describe("POST /trips/:tripId/reopen", () => {
  it("checks trip access, then reopens", async () => {
    const reopened = { trip: { id: TRIP_ID, status: "IN_REVIEW" }, itinerary: { id: ITINERARY_ID, status: "NEEDS_REVIEW" } };
    mocks.reopenTrip.mockResolvedValue(reopened);

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/reopen`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(reopened);
    expect(mocks.requireTripAccess).toHaveBeenCalledWith(staffUser, AGENCY_ID, TRIP_ID);
    expect(mocks.reopenTrip).toHaveBeenCalledWith(AGENCY_ID, TRIP_ID);
  });

  it("refuses staff who aren't assigned to the trip", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/reopen`);

    expect(res.status).toBe(404);
    expect(mocks.reopenTrip).not.toHaveBeenCalled();
  });
});

describe("trip access on existing routes", () => {
  it("approve now needs trip access", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/approve`);

    expect(res.status).toBe(404);
    expect(mocks.approveTrip).not.toHaveBeenCalled();
  });

  it("the full replace now needs trip access", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp())
      .patch(`${base}/${ITINERARY_ID}`)
      .send({ title: "Cebu", days: [{ dayNumber: 1, title: "Arrival", items: [] }] });

    expect(res.status).toBe(404);
    expect(mocks.replaceDraft).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/itineraryEditRoutes.test.ts`
Expected: FAIL. The new routes answer 404 `NOT_FOUND`, and approve / replace run without a trip check.

- [x] **Step 3: Replace the routes file**

Replace the contents of `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts` with:

```ts
import type { Request } from "express";
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { idParamsSchema } from "../../http/requestSchemas";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import {
  manualDayRenameSchema,
  manualStopCreateSchema,
  manualStopMoveSchema,
  manualStopPatchSchema,
  replaceItinerarySchema
} from "./itinerarySchemas";
import { createPlaceSession, getPlaceRefreshScheduler } from "../../services/places/placeServices";
import { itineraryService } from "./itineraryService";
import { itineraryWeatherService } from "../weather/weatherService";

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

export const itineraryRoutes = Router({ mergeParams: true });
const agencyIdParamsSchema = idParamsSchema("agencyId");
const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
const itineraryDayParamsSchema = idParamsSchema("agencyId", "itineraryId", "dayId");
const itineraryItemParamsSchema = idParamsSchema("agencyId", "itineraryId", "itemId");
const tripIdParamsSchema = idParamsSchema("agencyId", "tripId");

/**
 * Changing, approving or reopening an itinerary acts on one trip. Owners and admins
 * may do it for any trip in the agency; staff only for trips assigned to them
 * (anything else is a 404, so trips can't be probed).
 */
async function requireItineraryTripAccess(request: Request, agencyId: string, itineraryId: string) {
  const tripId = await itineraryService.getItineraryTripId(agencyId, itineraryId);
  await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
}

/**
 * The authorized single-itinerary read: a request-scoped session puts this agency's
 * place warnings on the response and starts a bounded refresh. Hand edits answer
 * with the same read, so the page can replace its copy with the response.
 */
async function readItinerary(agencyId: string, itineraryId: string) {
  return itineraryService.getItinerary(agencyId, itineraryId, {
    session: await createPlaceSession(agencyId),
    scheduler: getPlaceRefreshScheduler()
  });
}

itineraryRoutes.use(requireAuth);
itineraryRoutes.use(async (request, _response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    // Store resolved UUID on request so all downstream handlers use the real ID
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/", async (request, response, next) => {
  try {
    const { agencyId } = agencyIdParamsSchema.parse(request.params);
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      agencyId
    );
    const role = access.membership!.role;
    const trips = await itineraryService.listTripsForUser(access.agency.id, {
      role,
      userId: request.authUser!.id
    });
    response.json({ trips });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.get("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

// GET /agencies/:agencyId/itineraries/:itineraryId/weather — per-day forecast or
// typical weather. Same membership rule as the itinerary read above.
itineraryRoutes.get("/:itineraryId/weather", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const weather = await itineraryWeatherService.forAgencyItinerary(agencyId, itineraryId);
    response.json({ weather });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId } = itineraryIdParamsSchema.parse(request.params);
    const input = replaceItinerarySchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    const itinerary = await itineraryService.replaceDraft(
      agencyId,
      itineraryId,
      input
    );
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

// ── Hand edits from the Itineraries page ─────────────────────────────────────
// Allowed while the itinerary is a draft or in review; an approved one answers
// 409 ITINERARY_LOCKED until the trip is reopened. None of these take a place
// session: the schemas refuse place fields, so there is no place to check.

itineraryRoutes.patch("/:itineraryId/days/:dayId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, dayId } = itineraryDayParamsSchema.parse(request.params);
    const { title } = manualDayRenameSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.updateDay(agencyId, { itineraryId, dayId, title });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/:itineraryId/days/:dayId/items", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, dayId } = itineraryDayParamsSchema.parse(request.params);
    const item = manualStopCreateSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.addItem(agencyId, { itineraryId, dayId, item });
    response.status(201).json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId/items/:itemId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    const item = manualStopPatchSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.updateItem(agencyId, { itineraryId, itemId, item });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.delete("/:itineraryId/items/:itemId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.removeItem(agencyId, { itineraryId, itemId });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/:itineraryId/items/:itemId/move", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { itineraryId, itemId } = itineraryItemParamsSchema.parse(request.params);
    const target = manualStopMoveSchema.parse(request.body);
    await requireItineraryTripAccess(request, agencyId, itineraryId);
    await itineraryService.moveItem(agencyId, { itineraryId, itemId, ...target });
    response.json({ itinerary: await readItinerary(agencyId, itineraryId) });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.delete("/trips/:tripId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.deleteTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.post("/trips/:tripId/approve", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.approveTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

// Undo an approval so the trip can be changed again: it goes back to review and
// needs approving again. A trip that isn't approved comes back unchanged.
itineraryRoutes.post("/trips/:tripId/reopen", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.reopenTrip(agencyId, tripId);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
```

- [x] **Step 4: Run the new and the existing route tests**

Run: `cd Voyage-Server && npx vitest run tests/itineraryEditRoutes.test.ts tests/weatherRoutes.test.ts tests/routes.test.ts`
Expected: PASS. `weatherRoutes.test.ts` mocks `itineraryService` as `{}`; it only calls the weather route, so the new imports are fine.

- [x] **Step 5: Check the types**

Run: `cd Voyage-Server && npx tsc --noEmit`
Expected: no new errors.

- [x] **Step 6: Commit**

```bash
cd Voyage-Server && git add src/modules/itineraries/itineraryRoutes.ts tests/itineraryEditRoutes.test.ts && git commit -m "feat(itinerary): add hand-edit and reopen routes behind trip access"
```

---

### Task 7: Reuse follows the lock

**Files:**
- Modify: `Voyage-Server/src/modules/ratedHistory/ratedHistoryErrors.ts`, `ratedHistoryService.ts`, `ratedHistoryRepository.ts`, `ratedHistoryRoutes.ts`
- Test: `Voyage-Server/tests/ratedHistoryService.test.ts`, `Voyage-Server/tests/ratedHistoryRoutes.test.ts`, `Voyage-Server/tests/ratedHistoryInsertLock.test.ts`

- [x] **Step 1: Write the failing tests**

(a) In `Voyage-Server/tests/ratedHistoryService.test.ts`, add `ItineraryLockedError` to the import from `../src/modules/ratedHistory/ratedHistoryErrors`. In `FakeDepsOpts.targetItinerary`'s type, add `status?: string;`. Append at the end of the file:

```ts
// ── Approval lock ────────────────────────────────────────────────────────────

describe("approval lock", () => {
  it("refuses to insert into an approved itinerary and writes nothing", async () => {
    const source = makeSource();
    const insertImpl = vi.fn(async () => ({ itineraryId: TARGET_ITIN_ID, newVersion: 6 }));
    const deps = makeDeps({
      source,
      insertImpl,
      targetItinerary: {
        id: TARGET_ITIN_ID,
        tripId: TARGET_TRIP_ID,
        version: 5,
        status: "APPROVED_INTERNAL",
        trip: { startDate: null },
        days: [{ id: "td-1", dayNumber: 1 }]
      }
    });
    const svc = createRatedHistoryService(deps);

    await expect(
      svc.insertFromRated({
        callerAgencyId: AGENCY_A,
        callerUserId: USER_OWNER,
        callerRole: "OWNER",
        targetTripId: TARGET_TRIP_ID,
        sourceTripId: SOURCE_TRIP_ID,
        selection: { kind: "day", dayIds: [source.days[0].dayId] },
        target: { itineraryId: TARGET_ITIN_ID, dayIndex: 0 },
        ifMatchVersion: 5
      })
    ).rejects.toBeInstanceOf(ItineraryLockedError);
    expect(insertImpl).not.toHaveBeenCalled();
  });
});
```

(b) In `Voyage-Server/tests/ratedHistoryRoutes.test.ts`, add `ItineraryLockedError` to the import from `../src/modules/ratedHistory/ratedHistoryErrors`, and add right after test `"21. stale ifMatchVersion → 409 stale_version with expected/actual"`:

```ts
  it("21b. approved target itinerary → 409 itinerary_locked", async () => {
    mockInsertFromRated.mockRejectedValue(new ItineraryLockedError());

    const app = createApp();
    const res = await request(app)
      .post(`/trips/${TARGET_TRIP_ID}/itinerary/insert-from-rated`)
      .set("Cookie", `voyage_session=${SESSION_TOKEN}`)
      .send(dayInsertBody({ ifMatchVersion: 1 }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("itinerary_locked");
  });
```

(c) Create `Voyage-Server/tests/ratedHistoryInsertLock.test.ts`. It covers the race where the trip is approved between the service's check and the write:

```ts
import { describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({ itinerary: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("../src/db/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
}));

import { insertItemsTransactional } from "../src/modules/ratedHistory/ratedHistoryRepository";
import { ItineraryLockedError } from "../src/modules/ratedHistory/ratedHistoryErrors";

describe("insertItemsTransactional", () => {
  it("refuses an itinerary that was approved before the write", async () => {
    tx.itinerary.findUnique.mockResolvedValue({ id: "itin-1", version: 3, status: "APPROVED_INTERNAL" });

    await expect(
      insertItemsTransactional({
        targetItineraryId: "itin-1",
        ifMatchVersion: 3,
        insertions: { mode: "items", targetDayId: "day-1", items: [] }
      })
    ).rejects.toBeInstanceOf(ItineraryLockedError);
    expect(tx.itinerary.update).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `cd Voyage-Server && npx vitest run tests/ratedHistoryService.test.ts tests/ratedHistoryRoutes.test.ts tests/ratedHistoryInsertLock.test.ts`
Expected: FAIL. `ItineraryLockedError` isn't exported, so all three files fail to import it.

- [x] **Step 3: Add the error**

In `Voyage-Server/src/modules/ratedHistory/ratedHistoryErrors.ts`, add to the header comment's list:

```ts
 *   ItineraryLockedError     → 409 (error: "itinerary_locked")
```

and add after `StaleVersionError`:

```ts
/** The target itinerary is approved. It takes no copies until the trip is reopened. */
export class ItineraryLockedError extends Error {
  readonly httpStatus = 409 as const;

  constructor() {
    super("The target itinerary is approved. Reopen the trip to add to it.");
    this.name = "ItineraryLockedError";
  }
}
```

- [x] **Step 4: Check the status in the service**

In `Voyage-Server/src/modules/ratedHistory/ratedHistoryService.ts`:

- add `ItineraryLockedError` to the existing import from `./ratedHistoryErrors.js`;
- in `type TargetItineraryRow`, add `status?: string;` after `version: number;`;
- in step "3d. Load target itinerary", add `status: true,` to the `select` after `version: true,`;
- right after the block

```ts
    if (targetItinerary.tripId !== targetTripId) {
      throw new MalformedSelectionError(
        "target itinerary does not belong to target trip"
      );
    }
```

add:

```ts
    // The same lock as every other edit: approval freezes the itinerary until the
    // trip is reopened.
    if (targetItinerary.status === "APPROVED_INTERNAL") {
      throw new ItineraryLockedError();
    }
```

(The check is on `APPROVED_INTERNAL` itself, not `!isItineraryEditable(...)`: the service tests' default target row has no `status`, and that must stay insertable.)

- [x] **Step 5: Check it again inside the write**

In `Voyage-Server/src/modules/ratedHistory/ratedHistoryRepository.ts`:

- change the error import to `import { ItineraryLockedError, StaleVersionError, SourceNotFoundError } from "./ratedHistoryErrors.js";`;
- in `insertItemsTransactional`, change the version re-fetch `select: { id: true, version: true },` to `select: { id: true, version: true, status: true },`;
- right after `if (!current) { throw new SourceNotFoundError("missing"); }`, add:

```ts
      // Approved between the service's check and this write: refuse it.
      if (current.status === "APPROVED_INTERNAL") {
        throw new ItineraryLockedError();
      }
```

The `catch` at the end re-throws anything that isn't a Prisma P2003, so the error reaches the route unchanged.

- [x] **Step 6: Map it in the routes**

In `Voyage-Server/src/modules/ratedHistory/ratedHistoryRoutes.ts`, add `ItineraryLockedError` to the error import, and in `handleServiceError` add before the `StaleVersionError` branch:

```ts
  if (err instanceof ItineraryLockedError) {
    response.status(409).json({ error: "itinerary_locked" });
    return;
  }
```

- [x] **Step 7: Run the tests to verify they pass**

Run: `cd Voyage-Server && npx vitest run tests/ratedHistoryService.test.ts tests/ratedHistoryRoutes.test.ts tests/ratedHistoryInsertLock.test.ts tests/ratedHistoryRepository.union.test.ts`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
cd Voyage-Server && git add src/modules/ratedHistory tests/ratedHistoryService.test.ts tests/ratedHistoryRoutes.test.ts tests/ratedHistoryInsertLock.test.ts && git commit -m "fix(reuse): refuse to insert into an approved itinerary"
```

---

### Task 8: The agent works from the live itinerary

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentContextBuilder.ts`
- Modify: `Voyage-Server/src/modules/agent/agentOrchestrator.ts` (~line 191 and ~line 231)
- Test: `Voyage-Server/tests/agentLiveItinerary.test.ts`, `Voyage-Server/tests/agentOrchestrator.test.ts`

- [x] **Step 1: Write the failing unit test**

Create `Voyage-Server/tests/agentLiveItinerary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ITINERARY_LOCKED_NOTICE, withLiveItinerary } from "../src/modules/agent/agentContextBuilder";

const snapshot = {
  prompt: "Active itinerary draft context",
  itinerary: { id: "itin-1", days: [{ id: "day-1", items: [{ id: "s1", title: "Old title" }] }] }
};

describe("withLiveItinerary", () => {
  it("leaves a run with no active itinerary alone", () => {
    expect(withLiveItinerary(null, { id: "itin-1", days: [] })).toBeNull();
  });

  it("keeps the thread's snapshot when the live itinerary can't be read", () => {
    expect(withLiveItinerary(snapshot, null)).toBe(snapshot);
  });

  it("swaps in the live itinerary for one in review", () => {
    const live = { id: "itin-1", status: "NEEDS_REVIEW", days: [{ id: "day-1", items: [{ id: "s1", title: "Edited by hand" }] }] };

    expect(withLiveItinerary(snapshot, live)).toEqual({ prompt: snapshot.prompt, itinerary: live });
  });

  it("tells the agent an approved itinerary is locked", () => {
    const live = { id: "itin-1", status: "APPROVED_INTERNAL", days: [] };

    const result = withLiveItinerary(snapshot, live);

    expect(result?.itinerary).toBe(live);
    expect(result?.prompt).toContain(ITINERARY_LOCKED_NOTICE);
    expect(ITINERARY_LOCKED_NOTICE).toContain("Reopen for edits");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/agentLiveItinerary.test.ts`
Expected: FAIL, `withLiveItinerary` is not exported.

- [x] **Step 3: Add the helper**

In `Voyage-Server/src/modules/agent/agentContextBuilder.ts`, add right after `buildActiveItineraryContext`:

```ts
export const ITINERARY_LOCKED_NOTICE = [
  "This itinerary is APPROVED and locked. Do not call any itinerary edit tool: every edit will be refused.",
  "If the user asks for a change, tell them an owner, an admin or the trip's assigned staff member must click \"Reopen for edits\" on the Itineraries page first, then ask again."
].join("\n");

/**
 * Swap the thread's last stored snapshot for the live itinerary. Staff can edit an
 * itinerary by hand between runs, so the snapshot in the thread's tool events can be
 * out of date. With no live copy (gone, or not readable) the snapshot stays.
 */
export function withLiveItinerary(
  context: { prompt: string; itinerary: Record<string, unknown> } | null,
  live: unknown
) {
  if (!context) return null;
  const itinerary = extractItineraryFromToolOutput(live);
  if (!itinerary) return context;
  const locked = itinerary.status === "APPROVED_INTERNAL";
  return {
    prompt: locked ? `${context.prompt}\n${ITINERARY_LOCKED_NOTICE}` : context.prompt,
    itinerary
  };
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Server && npx vitest run tests/agentLiveItinerary.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Write the failing orchestrator test**

Append to the end of `Voyage-Server/tests/agentOrchestrator.test.ts`:

```ts
describe("live itinerary at run start", () => {
  function threadWithSnapshot() {
    return {
      messages: [{ role: "USER", content: "Move lunch later." }],
      events: [
        {
          type: "tool.completed",
          payload: {
            name: "create_itinerary",
            output: {
              itinerary: {
                id: "itinerary-live",
                days: [{ id: "day-1", dayNumber: 1, title: "Day 1", items: [{ id: "item-1", sortOrder: 1, title: "Old lunch spot" }] }]
              }
            }
          }
        }
      ]
    } as any;
  }

  function liveItinerary(status: string) {
    return {
      id: "itinerary-live",
      status,
      days: [{ id: "day-1", dayNumber: 1, title: "Day 1", items: [{ id: "item-1", sortOrder: 1, title: "Edited by hand" }] }]
    };
  }

  async function runWith(status: string) {
    const { service } = createFakeAgentService();
    service.getThread = async () => threadWithSnapshot();
    const prompts: string[] = [];
    const modelProvider: ModelProvider = {
      async complete(input) {
        prompts.push(input.messages.map((message) => message.content).join("\n"));
        return { content: "Done." };
      }
    };
    const loadCurrentItinerary = vi.fn(async () => liveItinerary(status));
    const orchestrator = createAgentOrchestrator({
      modelProvider,
      agentService: service,
      toolRegistry: createAgentToolRegistry([]),
      loadCurrentItinerary
    });

    await orchestrator.run(createRunInput());

    return { prompts: prompts.join("\n"), loadCurrentItinerary };
  }

  it("shows the agent the itinerary as stored now, not the thread's last snapshot", async () => {
    const { prompts, loadCurrentItinerary } = await runWith("NEEDS_REVIEW");

    expect(loadCurrentItinerary).toHaveBeenCalledWith({
      agencyId: "agency-1",
      userId: "user-1",
      itineraryId: "itinerary-live"
    });
    expect(prompts).toContain("title = Edited by hand");
    expect(prompts).not.toContain("title = Old lunch spot");
  });

  it("tells the agent an approved itinerary is locked", async () => {
    const { prompts } = await runWith("APPROVED_INTERNAL");

    expect(prompts).toContain("Reopen for edits");
  });
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `cd Voyage-Server && npx vitest run tests/agentOrchestrator.test.ts -t "live itinerary at run start"`
Expected: FAIL. The prompt still lists "Old lunch spot", and `loadCurrentItinerary` isn't called at run start.

- [x] **Step 7: Refresh the active itinerary at run start**

In `Voyage-Server/src/modules/agent/agentOrchestrator.ts`:

(a) Add `withLiveItinerary,` to the existing import list from `"./agentContextBuilder"` (next to `buildActiveItineraryContext,`).

(b) Right after the end of the `currentPlaceAdvisoryBlock` function (just before `try {` and `const thread = await options.agentService.getThread(...)`), add:

```ts
        /**
         * The thread's last itinerary tool event can be out of date: staff may have
         * edited the itinerary by hand since. Re-read it under the run's own
         * authorization so the agent works from, and never overwrites, the live copy.
         */
        async function refreshActiveItinerary(
          context: { prompt: string; itinerary: Record<string, unknown> } | null
        ) {
          const itineraryId = context?.itinerary?.id;
          if (!context || typeof itineraryId !== "string" || !options.loadCurrentItinerary) return context;
          try {
            const live = await options.loadCurrentItinerary({
              agencyId: input.agencyId,
              userId: input.userId,
              itineraryId
            });
            return withLiveItinerary(context, live);
          } catch (error) {
            console.error("[Agent] Failed to load the live itinerary; using the thread's snapshot.", error);
            return context;
          }
        }
```

(c) Replace

```ts
          activeItineraryContext = buildActiveItineraryContext(thread);
```

with

```ts
          activeItineraryContext = await refreshActiveItinerary(buildActiveItineraryContext(thread));
```

- [x] **Step 8: Run the agent tests to verify they pass**

Run: `cd Voyage-Server && npx vitest run tests/agentOrchestrator.test.ts tests/agentLiveItinerary.test.ts`
Expected: PASS, apart from orchestrator tests that already failed in Task 0.

- [x] **Step 9: Commit**

```bash
cd Voyage-Server && git add src/modules/agent/agentContextBuilder.ts src/modules/agent/agentOrchestrator.ts tests/agentLiveItinerary.test.ts tests/agentOrchestrator.test.ts && git commit -m "feat(agent): work from the live itinerary and respect the approval lock"
```

---

### Task 9: Server check

- [x] **Step 1: Run the whole server suite and the build**

```bash
cd Voyage-Server && npx vitest run 2>&1 | tail -40
```

```bash
cd Voyage-Server && npm run build
```

Expected: the build succeeds; the only failing tests are the ones listed in Task 0. Fix any new failure before going on.

---

### Task 10: Client edit API

**Files:**
- Create: `Voyage-Client/app/lib/api/itineraryEditing.js`
- Modify: `Voyage-Client/app/lib/api/index.js`
- Test: `Voyage-Client/tests/itinerary-editing-api.test.js`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/itinerary-editing-api.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "../app/lib/api/client.js";
import {
  addItineraryStop,
  deleteItineraryStop,
  moveItineraryStop,
  renameItineraryDay,
  reopenClientTrip,
  updateItineraryStop,
} from "../app/lib/api/itineraryEditing.js";

const body = { itinerary: { id: "itin-1", days: [] } };

describe("itinerary editing API", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  function lastRequest() {
    const [url, options] = fetchMock.mock.calls.at(-1);
    return { url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined };
  }

  const itineraryPath = `${API_URL}/agencies/ag-1/itineraries/itin-1`;

  it("renames a day", async () => {
    await expect(renameItineraryDay("ag-1", "itin-1", "day-1", "Old town")).resolves.toEqual(body);
    expect(lastRequest()).toEqual({ url: `${itineraryPath}/days/day-1`, method: "PATCH", body: { title: "Old town" } });
  });

  it("adds a stop to a day", async () => {
    await addItineraryStop("ag-1", "itin-1", "day-1", { type: "NOTE", title: "Coffee" });
    expect(lastRequest()).toEqual({ url: `${itineraryPath}/days/day-1/items`, method: "POST", body: { type: "NOTE", title: "Coffee" } });
  });

  it("updates a stop", async () => {
    await updateItineraryStop("ag-1", "itin-1", "s1", { startTime: "9:00 AM" });
    expect(lastRequest()).toEqual({ url: `${itineraryPath}/items/s1`, method: "PATCH", body: { startTime: "9:00 AM" } });
  });

  it("deletes a stop", async () => {
    await deleteItineraryStop("ag-1", "itin-1", "s1");
    expect(lastRequest()).toEqual({ url: `${itineraryPath}/items/s1`, method: "DELETE", body: undefined });
  });

  it("moves a stop", async () => {
    await moveItineraryStop("ag-1", "itin-1", "s1", { toDayId: "day-2" });
    expect(lastRequest()).toEqual({ url: `${itineraryPath}/items/s1/move`, method: "POST", body: { toDayId: "day-2" } });
  });

  it("reopens a trip", async () => {
    await reopenClientTrip("ag-1", "t1");
    expect(lastRequest()).toEqual({ url: `${API_URL}/agencies/ag-1/itineraries/trips/t1/reopen`, method: "POST", body: undefined });
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-editing-api.test.js`
Expected: FAIL, the module doesn't exist.

- [x] **Step 3: Write the module**

Create `Voyage-Client/app/lib/api/itineraryEditing.js`:

```js
/**
 * Hand edits to a saved itinerary on the Itineraries page, and reopening an approved
 * trip. Every edit answers with the whole itinerary, in the same `{ itinerary }`
 * shape as fetchItineraryDraft. The server refuses edits to an approved itinerary
 * with 409 ITINERARY_LOCKED.
 */
import { fetchApi } from "./client.js";

function itineraryPath(agencyId, itineraryId) {
  return `/agencies/${agencyId}/itineraries/${itineraryId}`;
}

export async function renameItineraryDay(agencyId, itineraryId, dayId, title) {
  return fetchApi(`${itineraryPath(agencyId, itineraryId)}/days/${dayId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function addItineraryStop(agencyId, itineraryId, dayId, stop) {
  return fetchApi(`${itineraryPath(agencyId, itineraryId)}/days/${dayId}/items`, {
    method: "POST",
    body: JSON.stringify(stop),
  });
}

export async function updateItineraryStop(agencyId, itineraryId, itemId, patch) {
  return fetchApi(`${itineraryPath(agencyId, itineraryId)}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteItineraryStop(agencyId, itineraryId, itemId) {
  return fetchApi(`${itineraryPath(agencyId, itineraryId)}/items/${itemId}`, {
    method: "DELETE",
  });
}

// `target` is { toDayId, toSortOrder? }: the stop's 1-based position among the day's
// other stops, or the end of the day when left out.
export async function moveItineraryStop(agencyId, itineraryId, itemId, target) {
  return fetchApi(`${itineraryPath(agencyId, itineraryId)}/items/${itemId}/move`, {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export async function reopenClientTrip(agencyId, tripId) {
  return fetchApi(`/agencies/${agencyId}/itineraries/trips/${tripId}/reopen`, {
    method: "POST",
  });
}
```

In `Voyage-Client/app/lib/api/index.js`, add after the `// Agency` export block:

```js
// Hand edits to a saved itinerary, and reopening an approved trip
export {
  renameItineraryDay,
  addItineraryStop,
  updateItineraryStop,
  deleteItineraryStop,
  moveItineraryStop,
  reopenClientTrip,
} from "./itineraryEditing.js";
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-editing-api.test.js`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
cd Voyage-Client && git add app/lib/api/itineraryEditing.js app/lib/api/index.js tests/itinerary-editing-api.test.js && git commit -m "feat(itinerary): add API calls for hand edits and reopening a trip"
```

---

### Task 11: Client editing rules and form helpers

**Files:**
- Create: `Voyage-Client/app/lib/trip-dashboard/itineraryEditing.js`
- Test: `Voyage-Client/tests/itinerary-editing-helpers.test.js`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/itinerary-editing-helpers.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  describeEditError,
  emptyStopForm,
  isItineraryLocked,
  otherDayOptions,
  shouldReloadAfterError,
  stopDisplayTitle,
  stopFormFromItem,
  stopMoveOptions,
  stopPatchFromForm,
  stopPayloadFromForm,
  validateStopForm,
} from "../app/lib/trip-dashboard/itineraryEditing.js";

const lunch = { id: "s2", type: "MEAL", title: "Lunch", startTime: "12:00 PM", endTime: null, description: "Noodles", clientNotes: null, staffNotes: "Call ahead" };
const days = [
  { id: "day-1", dayNumber: 1, title: "Arrival", items: [{ id: "s1" }, lunch] },
  { id: "day-2", dayNumber: 2, title: "", items: [] },
];

describe("isItineraryLocked", () => {
  it("locks when either the trip label or the itinerary status says approved", () => {
    expect(isItineraryLocked({ approvalStatus: "Approved", itineraryStatus: "NEEDS_REVIEW" })).toBe(true);
    expect(isItineraryLocked({ approvalStatus: "In review", itineraryStatus: "APPROVED_INTERNAL" })).toBe(true);
    expect(isItineraryLocked({ approvalStatus: "In review", itineraryStatus: "NEEDS_REVIEW" })).toBe(false);
  });
});

describe("stop forms", () => {
  it("fills a form from a stop, with empty strings for missing fields", () => {
    expect(stopFormFromItem(lunch)).toEqual({
      type: "MEAL",
      title: "Lunch",
      startTime: "12:00 PM",
      endTime: "",
      description: "Noodles",
      clientNotes: "",
      staffNotes: "Call ahead",
    });
  });

  it("falls back to Activity for a type the form doesn't offer", () => {
    expect(stopFormFromItem({ type: "SOMETHING_NEW", title: "x" }).type).toBe("ACTIVITY");
  });

  it("needs a title and keeps fields within the server's limits", () => {
    expect(validateStopForm({ ...emptyStopForm(), title: "  " })).toEqual({ title: "Add a title." });
    expect(validateStopForm({ ...emptyStopForm(), title: "x", startTime: "1".repeat(21) })).toEqual({
      startTime: "Keep this under 20 characters.",
    });
    expect(validateStopForm({ ...emptyStopForm(), title: "Museum" })).toEqual({});
  });

  it("builds a new stop without empty fields", () => {
    expect(stopPayloadFromForm({ ...emptyStopForm(), type: "NOTE", title: " Coffee ", startTime: "3:00 PM " })).toEqual({
      type: "NOTE",
      title: "Coffee",
      startTime: "3:00 PM",
    });
  });

  it("sends only what changed, with a cleared field as an empty string", () => {
    const form = { ...stopFormFromItem(lunch), startTime: "1:00 PM", description: "" };
    expect(stopPatchFromForm(form, lunch)).toEqual({ startTime: "1:00 PM", description: "" });
    expect(stopPatchFromForm(stopFormFromItem(lunch), lunch)).toEqual({});
  });
});

describe("moves", () => {
  it("offers up and down only where they make sense", () => {
    expect(stopMoveOptions(days, 0, 0)).toMatchObject({ canMoveUp: false, canMoveDown: true });
    expect(stopMoveOptions(days, 0, 1)).toMatchObject({ canMoveUp: true, canMoveDown: false });
  });

  it("lists the other days by number and title", () => {
    expect(otherDayOptions(days, 0)).toEqual([{ id: "day-2", label: "Day 2" }]);
    expect(otherDayOptions(days, 1)).toEqual([{ id: "day-1", label: "Day 1: Arrival" }]);
  });
});

describe("stopDisplayTitle", () => {
  it("prefers the stop's title, then its place", () => {
    expect(stopDisplayTitle(lunch)).toBe("Lunch");
    expect(stopDisplayTitle({ placeSnapshot: { name: "Museo" } })).toBe("Museo");
    expect(stopDisplayTitle(null)).toBe("this stop");
  });
});

describe("edit errors", () => {
  it("explains a lock and asks for a reload", () => {
    const error = { status: 409, code: "ITINERARY_LOCKED" };
    expect(describeEditError(error)).toMatch(/approved/i);
    expect(shouldReloadAfterError(error)).toBe(true);
  });

  it("asks for a reload when the stop is gone", () => {
    expect(shouldReloadAfterError({ status: 404, code: "ITINERARY_NOT_FOUND" })).toBe(true);
  });

  it("keeps the dialog for a network failure", () => {
    const error = { status: 0, code: "NETWORK_ERROR" };
    expect(describeEditError(error)).toMatch(/couldn't reach the server/i);
    expect(shouldReloadAfterError(error)).toBe(false);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-editing-helpers.test.js`
Expected: FAIL, the module doesn't exist.

- [x] **Step 3: Write the helpers**

Create `Voyage-Client/app/lib/trip-dashboard/itineraryEditing.js`:

```js
// Rules and form helpers for editing a saved itinerary by hand on the Itineraries
// page. The server enforces the same lock; these only decide what the page offers.

export const STOP_TYPE_OPTIONS = [
  { value: "ACTIVITY", label: "Activity" },
  { value: "MEAL", label: "Meal" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "CHECK_IN", label: "Check-in" },
  { value: "CHECK_OUT", label: "Check-out" },
  { value: "FREE_TIME", label: "Free time" },
  { value: "NOTE", label: "Note" },
];

// The server's limits (manualStopCreateSchema).
const STOP_LIMITS = { title: 200, startTime: 20, endTime: 20, description: 2000, clientNotes: 2000, staffNotes: 2000 };
const OPTIONAL_FIELDS = ["startTime", "endTime", "description", "clientNotes", "staffNotes"];

/**
 * Approved trips are locked until someone reopens them. Either signal locks: the trip
 * label changes first (Approve is optimistic), the itinerary status on the next load.
 */
export function isItineraryLocked({ approvalStatus, itineraryStatus } = {}) {
  return approvalStatus === "Approved" || itineraryStatus === "APPROVED_INTERNAL";
}

export function emptyStopForm() {
  return { type: "ACTIVITY", title: "", startTime: "", endTime: "", description: "", clientNotes: "", staffNotes: "" };
}

export function stopFormFromItem(item) {
  const form = emptyStopForm();
  if (!item) return form;
  const knownType = STOP_TYPE_OPTIONS.some((option) => option.value === item.type);
  return {
    type: knownType ? item.type : form.type,
    title: item.title ?? "",
    startTime: item.startTime ?? "",
    endTime: item.endTime ?? "",
    description: item.description ?? "",
    clientNotes: item.clientNotes ?? "",
    staffNotes: item.staffNotes ?? "",
  };
}

/** Field errors keyed by field name. An empty object means the form can be sent. */
export function validateStopForm(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = "Add a title.";
  for (const [field, max] of Object.entries(STOP_LIMITS)) {
    if (form[field].trim().length > max) errors[field] = `Keep this under ${max} characters.`;
  }
  return errors;
}

/** The request body for a new stop: trimmed, with empty optional fields left out. */
export function stopPayloadFromForm(form) {
  const payload = { type: form.type, title: form.title.trim() };
  for (const field of OPTIONAL_FIELDS) {
    const value = form[field].trim();
    if (value) payload[field] = value;
  }
  return payload;
}

/**
 * Only the fields that changed, so an edit never rewrites what the user didn't touch.
 * A cleared field is sent as "", which the server stores as empty.
 */
export function stopPatchFromForm(form, item) {
  const before = stopFormFromItem(item);
  const patch = {};
  for (const field of Object.keys(before)) {
    const value = field === "type" ? form.type : form[field].trim();
    if (value !== before[field]) patch[field] = value;
  }
  return patch;
}

export function dayLabel(day) {
  return day?.title ? `Day ${day.dayNumber}: ${day.title}` : `Day ${day?.dayNumber}`;
}

/** Every day except `days[dayIndex]`, as the "Move to another day" choices. */
export function otherDayOptions(days, dayIndex) {
  return days
    .filter((day, index) => index !== dayIndex && day?.id)
    .map((day) => ({ id: day.id, label: dayLabel(day) }));
}

/** What the stop menu offers for the stop at `itemIndex` of `days[dayIndex]`. */
export function stopMoveOptions(days, dayIndex, itemIndex) {
  const count = days[dayIndex]?.items?.length ?? 0;
  return {
    canMoveUp: itemIndex > 0,
    canMoveDown: itemIndex < count - 1,
    otherDays: otherDayOptions(days, dayIndex),
  };
}

export function stopDisplayTitle(item) {
  return item?.title || item?.placeSnapshot?.name || item?.placeName || "this stop";
}

/** A short, plain message for a failed edit. */
export function describeEditError(error) {
  if (error?.code === "ITINERARY_LOCKED") {
    return "This trip is approved, so it can't be changed. Reopen it to make changes.";
  }
  if (error?.status === 404) {
    return "That part of the itinerary no longer exists. The latest version has been loaded.";
  }
  if (error?.code === "VALIDATION_ERROR") return "Some fields aren't valid. Check them and try again.";
  if (error?.code === "NETWORK_ERROR") return "Couldn't reach the server. Check your connection and try again.";
  return "Couldn't save your change. Try again.";
}

/** After a lock or a missing stop the page is out of date and should reload. */
export function shouldReloadAfterError(error) {
  return error?.code === "ITINERARY_LOCKED" || error?.status === 404;
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-editing-helpers.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
cd Voyage-Client && git add app/lib/trip-dashboard/itineraryEditing.js tests/itinerary-editing-helpers.test.js && git commit -m "feat(itinerary): add the lock rule and stop form helpers"
```

---

### Task 12: The editor hook

**Files:**
- Create: `Voyage-Client/app/hooks/useItineraryEditor.js`
- Test: `Voyage-Client/tests/use-itinerary-editor.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/use-itinerary-editor.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  addItineraryStop: vi.fn(),
  updateItineraryStop: vi.fn(),
  deleteItineraryStop: vi.fn(),
  moveItineraryStop: vi.fn(),
  renameItineraryDay: vi.fn(),
}));
vi.mock("../app/lib/api/itineraryEditing.js", () => api);

import { useItineraryEditor } from "../app/hooks/useItineraryEditor.js";
import { emptyStopForm, stopFormFromItem } from "../app/lib/trip-dashboard/itineraryEditing.js";

const museum = { id: "s1", type: "ACTIVITY", title: "Museum" };
const lunch = { id: "s2", type: "MEAL", title: "Lunch" };
const day1 = { id: "day-1", dayNumber: 1, title: "Arrival", items: [museum, lunch] };
const updated = { itinerary: { id: "itin-1", days: [] } };

function setup(overrides = {}) {
  const onItineraryChange = vi.fn();
  const reload = vi.fn();
  const hook = renderHook((props) => useItineraryEditor(props), {
    initialProps: { agencyId: "ag-1", itineraryId: "itin-1", canEdit: true, onItineraryChange, reload, ...overrides },
  });
  return { ...hook, onItineraryChange, reload };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(api).forEach((fn) => fn.mockResolvedValue(updated));
});

describe("useItineraryEditor", () => {
  it("adds a custom stop, hands over the new itinerary and closes the dialog", async () => {
    const { result, onItineraryChange } = setup();
    act(() => result.current.openAddStop(day1));
    expect(result.current.dialog).toMatchObject({ kind: "addStop", day: day1 });

    let outcome;
    await act(async () => {
      outcome = await result.current.submitStop({ ...emptyStopForm(), type: "NOTE", title: " Coffee " });
    });

    expect(api.addItineraryStop).toHaveBeenCalledWith("ag-1", "itin-1", "day-1", { type: "NOTE", title: "Coffee" });
    expect(onItineraryChange).toHaveBeenCalledWith(updated);
    expect(outcome).toEqual({ ok: true });
    expect(result.current.dialog).toBeNull();
  });

  it("sends only the changed fields when editing a stop", async () => {
    const { result } = setup();
    act(() => result.current.openEditStop(day1, museum));

    await act(async () => {
      await result.current.submitStop({ ...stopFormFromItem(museum), startTime: "9:00 AM" });
    });

    expect(api.updateItineraryStop).toHaveBeenCalledWith("ag-1", "itin-1", "s1", { startTime: "9:00 AM" });
  });

  it("closes without a request when nothing changed", async () => {
    const { result } = setup();
    act(() => result.current.openEditStop(day1, museum));

    await act(async () => {
      await result.current.submitStop(stopFormFromItem(museum));
    });

    expect(api.updateItineraryStop).not.toHaveBeenCalled();
    expect(result.current.dialog).toBeNull();
  });

  it("keeps the dialog open with the message when the save fails for another reason", async () => {
    api.updateItineraryStop.mockRejectedValue(Object.assign(new Error("offline"), { status: 0, code: "NETWORK_ERROR" }));
    const { result, reload } = setup();
    act(() => result.current.openEditStop(day1, museum));

    let outcome;
    await act(async () => {
      outcome = await result.current.submitStop({ ...stopFormFromItem(museum), title: "Art museum" });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/couldn't reach the server/i);
    expect(result.current.dialog).toMatchObject({ kind: "editStop" });
    expect(reload).not.toHaveBeenCalled();
  });

  it("closes, explains and reloads when the trip was approved meanwhile", async () => {
    api.deleteItineraryStop.mockRejectedValue(Object.assign(new Error("locked"), { status: 409, code: "ITINERARY_LOCKED" }));
    const { result, reload } = setup();
    act(() => result.current.openDeleteStop(day1, lunch));

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(reload).toHaveBeenCalledOnce();
    expect(result.current.dialog).toBeNull();
    expect(result.current.notice).toMatch(/approved/i);
  });

  it("moves a stop by sending its new position", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.moveStopBy(day1, 0, 1);
    });
    expect(api.moveItineraryStop).toHaveBeenLastCalledWith("ag-1", "itin-1", "s1", { toDayId: "day-1", toSortOrder: 2 });

    await act(async () => {
      await result.current.moveStopBy(day1, 1, -1);
    });
    expect(api.moveItineraryStop).toHaveBeenLastCalledWith("ag-1", "itin-1", "s2", { toDayId: "day-1", toSortOrder: 1 });
  });

  it("moves a stop to the end of another day", async () => {
    const { result } = setup();
    act(() => result.current.openMoveStop(day1, lunch));

    await act(async () => {
      await result.current.submitMove("day-2");
    });

    expect(api.moveItineraryStop).toHaveBeenCalledWith("ag-1", "itin-1", "s2", { toDayId: "day-2" });
  });

  it("renames a day with a trimmed title", async () => {
    const { result } = setup();
    act(() => result.current.openRenameDay(day1));

    await act(async () => {
      await result.current.submitRenameDay("  Old town ");
    });

    expect(api.renameItineraryDay).toHaveBeenCalledWith("ag-1", "itin-1", "day-1", "Old town");
  });

  it("does nothing while editing is off", async () => {
    const { result } = setup({ canEdit: false });
    act(() => result.current.openAddStop(day1));

    await act(async () => {
      await result.current.moveStopBy(day1, 0, 1);
    });

    expect(result.current.dialog).toBeNull();
    expect(api.moveItineraryStop).not.toHaveBeenCalled();
  });

  it("closes an open dialog when the page switches itinerary", () => {
    const { result, rerender, onItineraryChange, reload } = setup();
    act(() => result.current.openAddStop(day1));

    rerender({ agencyId: "ag-1", itineraryId: "itin-2", canEdit: true, onItineraryChange, reload });

    expect(result.current.dialog).toBeNull();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/use-itinerary-editor.test.jsx`
Expected: FAIL, the hook doesn't exist.

- [x] **Step 3: Write the hook**

Create `Voyage-Client/app/hooks/useItineraryEditor.js`:

```js
// Hand edits to one saved itinerary on the Itineraries page: which dialog is open,
// and the request behind each action. Every action resolves to { ok: true } or
// { ok: false, message } so a dialog can show the problem in place.
import { useCallback, useEffect, useState } from "react";
import {
  addItineraryStop,
  deleteItineraryStop,
  moveItineraryStop,
  renameItineraryDay,
  updateItineraryStop,
} from "../lib/api/itineraryEditing.js";
import {
  describeEditError,
  shouldReloadAfterError,
  stopPatchFromForm,
  stopPayloadFromForm,
} from "../lib/trip-dashboard/itineraryEditing.js";

const NOTHING_OPEN = { ok: false, message: "" };

export function useItineraryEditor({ agencyId, itineraryId, canEdit, onItineraryChange, reload }) {
  // null, or { kind: "editStop" | "addStop" | "moveStop" | "deleteStop" | "renameDay", day, item? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState("");

  // Another trip starts with nothing open.
  useEffect(() => {
    setDialog(null);
    setNotice("");
  }, [itineraryId]);

  // The server answers every edit with the whole itinerary. A lock or a stop that is
  // gone means this page is out of date: close the dialog, say why, and reload.
  const send = useCallback(
    async (request) => {
      try {
        onItineraryChange(await request());
        return { ok: true };
      } catch (error) {
        const message = describeEditError(error);
        if (shouldReloadAfterError(error)) {
          setDialog(null);
          setNotice(message);
          reload();
        }
        return { ok: false, message };
      }
    },
    [onItineraryChange, reload],
  );

  const sendAndClose = useCallback(
    async (request) => {
      const result = await send(request);
      if (result.ok) setDialog(null);
      return result;
    },
    [send],
  );

  const open = useCallback(
    (next) => {
      if (!canEdit) return;
      setNotice("");
      setDialog(next);
    },
    [canEdit],
  );
  const openEditStop = useCallback((day, item) => open({ kind: "editStop", day, item }), [open]);
  const openAddStop = useCallback((day) => open({ kind: "addStop", day }), [open]);
  const openMoveStop = useCallback((day, item) => open({ kind: "moveStop", day, item }), [open]);
  const openDeleteStop = useCallback((day, item) => open({ kind: "deleteStop", day, item }), [open]);
  const openRenameDay = useCallback((day) => open({ kind: "renameDay", day }), [open]);
  const closeDialog = useCallback(() => setDialog(null), []);
  const dismissNotice = useCallback(() => setNotice(""), []);

  const submitStop = useCallback(
    async (form) => {
      if (dialog?.kind === "addStop") {
        return sendAndClose(() => addItineraryStop(agencyId, itineraryId, dialog.day.id, stopPayloadFromForm(form)));
      }
      if (dialog?.kind !== "editStop") return NOTHING_OPEN;
      const patch = stopPatchFromForm(form, dialog.item);
      if (Object.keys(patch).length === 0) {
        setDialog(null);
        return { ok: true };
      }
      return sendAndClose(() => updateItineraryStop(agencyId, itineraryId, dialog.item.id, patch));
    },
    [agencyId, itineraryId, dialog, sendAndClose],
  );

  const submitMove = useCallback(
    async (toDayId) => {
      if (dialog?.kind !== "moveStop") return NOTHING_OPEN;
      return sendAndClose(() => moveItineraryStop(agencyId, itineraryId, dialog.item.id, { toDayId }));
    },
    [agencyId, itineraryId, dialog, sendAndClose],
  );

  const confirmDelete = useCallback(async () => {
    if (dialog?.kind !== "deleteStop") return NOTHING_OPEN;
    return sendAndClose(() => deleteItineraryStop(agencyId, itineraryId, dialog.item.id));
  }, [agencyId, itineraryId, dialog, sendAndClose]);

  const submitRenameDay = useCallback(
    async (title) => {
      if (dialog?.kind !== "renameDay") return NOTHING_OPEN;
      return sendAndClose(() => renameItineraryDay(agencyId, itineraryId, dialog.day.id, title.trim()));
    },
    [agencyId, itineraryId, dialog, sendAndClose],
  );

  // Up and down have no dialog, so a failure shows as the notice. The server's
  // toSortOrder is the stop's 1-based position among the day's other stops.
  const moveStopBy = useCallback(
    async (day, itemIndex, delta) => {
      const item = day?.items?.[itemIndex];
      if (!canEdit || !item) return NOTHING_OPEN;
      const result = await send(() =>
        moveItineraryStop(agencyId, itineraryId, item.id, { toDayId: day.id, toSortOrder: itemIndex + 1 + delta }),
      );
      setNotice(result.ok ? "" : result.message);
      return result;
    },
    [agencyId, itineraryId, canEdit, send],
  );

  return {
    canEdit,
    dialog,
    notice,
    dismissNotice,
    closeDialog,
    openEditStop,
    openAddStop,
    openMoveStop,
    openDeleteStop,
    openRenameDay,
    submitStop,
    submitMove,
    confirmDelete,
    submitRenameDay,
    moveStopBy,
  };
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/use-itinerary-editor.test.jsx`
Expected: PASS (10 tests).

- [x] **Step 5: Commit**

```bash
cd Voyage-Client && git add app/hooks/useItineraryEditor.js tests/use-itinerary-editor.test.jsx && git commit -m "feat(itinerary): add the editor hook behind the hand-edit dialogs"
```

---

### Task 13: Icons and the stop menu

**Files:**
- Modify: `Voyage-Client/app/components/icons/index.js` (append)
- Create: `Voyage-Client/app/components/trip-dashboard/itinerary-edit/StopActionsMenu.jsx`
- Test: `Voyage-Client/tests/stop-actions-menu.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/stop-actions-menu.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// components/icons/index.js contains JSX in a .js file, which vitest cannot parse.
vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});

import StopActionsMenu from "../app/components/trip-dashboard/itinerary-edit/StopActionsMenu.jsx";

function renderMenu(props = {}) {
  const handlers = { onEdit: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onMoveToDay: vi.fn(), onDelete: vi.fn() };
  render(<StopActionsMenu stopTitle="Museum" canMoveUp canMoveDown canMoveToDay {...handlers} {...props} />);
  return { handlers, trigger: screen.getByRole("button", { name: "Actions for Museum" }) };
}

describe("StopActionsMenu", () => {
  it("names its button after the stop and starts closed", () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists only the moves that make sense", () => {
    const { trigger } = renderMenu({ canMoveUp: false, canMoveToDay: false });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit details",
      "Move down",
      "Delete stop",
    ]);
  });

  it("focuses the first item and moves with the arrow keys, wrapping at the ends", () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(items.at(-1)).toHaveFocus();
  });

  it("closes on Escape and gives focus back to its button", () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("runs the chosen action, closes, and gives focus back to its button", () => {
    const { trigger, handlers } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete stop" }));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes when the user clicks elsewhere", () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/stop-actions-menu.test.jsx`
Expected: FAIL, the component doesn't exist.

- [x] **Step 3: Add the two icons**

Append to `Voyage-Client/app/components/icons/index.js`:

```jsx
export function MoreIcon(props) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

export function PencilIcon(props) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
```

- [x] **Step 4: Write the menu**

Create `Voyage-Client/app/components/trip-dashboard/itinerary-edit/StopActionsMenu.jsx`:

```jsx
"use client";
// The ⋯ menu on a stop card: Edit details, Move up, Move down, Move to another day,
// Delete stop. A menu button pattern: arrows move between items, Escape closes, and
// focus goes back to the button so the dialog an action opens can return it there.
import { useEffect, useId, useRef, useState } from "react";
import { MoreIcon } from "../../icons/index.js";

const TRIGGER =
  "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border/20 bg-surface-elevated text-text-soft transition-colors duration-150 hover:border-border/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";
const ITEM =
  "flex w-full items-center rounded-md px-3 py-2 text-left text-[0.85rem] font-semibold transition-colors duration-150 hover:bg-surface focus:bg-surface focus:outline-none";

export default function StopActionsMenu({
  stopTitle,
  canMoveUp = false,
  canMoveDown = false,
  canMoveToDay = false,
  onEdit,
  onMoveUp,
  onMoveDown,
  onMoveToDay,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const actions = [
    { key: "edit", label: "Edit details", run: onEdit },
    canMoveUp && { key: "up", label: "Move up", run: onMoveUp },
    canMoveDown && { key: "down", label: "Move down", run: onMoveDown },
    canMoveToDay && { key: "day", label: "Move to another day", run: onMoveToDay },
    { key: "delete", label: "Delete stop", run: onDelete, danger: true },
  ].filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const closeOnOutsidePress = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    return () => document.removeEventListener("mousedown", closeOnOutsidePress);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleMenuKeyDown = (event) => {
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement);
    const focusAt = (next) => items[(next + items.length) % items.length]?.focus();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={TRIGGER}
        aria-label={`Actions for ${stopTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon width={16} height={16} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${stopTitle}`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-border/20 bg-surface-elevated p-1 shadow-strong"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`${ITEM} ${action.danger ? "text-status-danger" : "text-text-primary"}`}
              onClick={() => {
                close();
                action.run?.();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [x] **Step 5: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/stop-actions-menu.test.jsx`
Expected: PASS (6 tests).

- [x] **Step 6: Commit**

```bash
cd Voyage-Client && git add app/components/icons/index.js app/components/trip-dashboard/itinerary-edit/StopActionsMenu.jsx tests/stop-actions-menu.test.jsx && git commit -m "feat(itinerary): add the stop actions menu"
```

---

### Task 14: Bottom-sheet modal and the stop form

**Files:**
- Modify: `Voyage-Client/app/components/ui/Modal.jsx` (side variant panel, ~line 108)
- Create: `Voyage-Client/app/components/trip-dashboard/itinerary-edit/StopEditDialog.jsx`
- Test: `Voyage-Client/tests/stop-edit-dialog.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/stop-edit-dialog.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Modal from "../app/components/ui/Modal.jsx";
import StopEditDialog from "../app/components/trip-dashboard/itinerary-edit/StopEditDialog.jsx";

const lunch = { id: "s1", type: "MEAL", title: "Lunch", startTime: "12:00 PM", endTime: null, description: "Noodles", clientNotes: null, staffNotes: "Call ahead" };

describe("side Modal", () => {
  it("is a bottom sheet on phones and a right-hand panel from sm up", () => {
    render(<Modal open variant="side" title="Edit stop" onClose={() => {}}>Body</Modal>);
    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("bottom-0");
    expect(panel.className).toContain("rounded-t-[20px]");
    expect(panel.className).toContain("sm:right-0");
    expect(panel.className).toContain("sm:w-[480px]");
  });
});

describe("StopEditDialog", () => {
  it("opens filled with the stop's details", () => {
    render(<StopEditDialog open mode="edit" item={lunch} dayLabel="Day 1: Arrival" onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Edit stop" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Type")).toHaveValue("MEAL");
    expect(screen.getByLabelText("Start time")).toHaveValue("12:00 PM");
    expect(screen.getByLabelText("Staff notes")).toHaveValue("Call ahead");
  });

  it("won't add a stop without a title", async () => {
    const onSubmit = vi.fn();
    render(<StopEditDialog open mode="add" dayLabel="Day 1: Arrival" onSubmit={onSubmit} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Add a stop to Day 1: Arrival" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));

    expect(await screen.findByText("Add a title.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the form and shows the message when saving fails", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, message: "Couldn't save your change. Try again." });
    render(<StopEditDialog open mode="edit" item={lunch} dayLabel="Day 1: Arrival" onSubmit={onSubmit} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "1:00 PM" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Lunch", startTime: "1:00 PM" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your change. Try again.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/stop-edit-dialog.test.jsx`
Expected: FAIL. `StopEditDialog` doesn't exist, and the side panel has no `bottom-0`.

- [x] **Step 3: Make the side Modal a bottom sheet below `sm`**

In `Voyage-Client/app/components/ui/Modal.jsx`, in the side variant, replace the panel's className

```jsx
          className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] flex flex-col bg-surface-elevated border-l border-border/20 shadow-strong overflow-hidden [animation:slide-in-from-right_0.25s_ease_both] focus:outline-none"
```

with

```jsx
          // Below sm the panel is a bottom sheet, so a form opens over the phone's map
          // instead of covering the whole screen; from sm up it slides in from the right.
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[20px] border-t border-border/20 bg-surface-elevated shadow-strong focus:outline-none sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[480px] sm:rounded-none sm:border-t-0 sm:border-l sm:[animation:slide-in-from-right_0.25s_ease_both]"
```

No other component uses the side variant today (`grep -rn 'variant="side"' app` finds nothing), so nothing else changes.

- [x] **Step 4: Write the stop form**

Create `Voyage-Client/app/components/trip-dashboard/itinerary-edit/StopEditDialog.jsx`:

```jsx
"use client";
// The form behind "Edit details" and "Add stop". The place a stop points to isn't
// editable here: swapping places stays with the agent, which checks the new place.
import { useEffect, useId, useState } from "react";
import Modal from "../../ui/Modal.jsx";
import {
  STOP_TYPE_OPTIONS,
  emptyStopForm,
  stopFormFromItem,
  validateStopForm,
} from "../../../lib/trip-dashboard/itineraryEditing.js";

// 16px text on phones stops iOS zooming into the field.
const INPUT =
  "w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-base text-text-primary placeholder:text-text-soft focus:border-secondary focus:outline-none aria-invalid:border-status-danger/60 sm:text-sm";
const CANCEL =
  "rounded-lg border border-border/20 px-4 py-2 text-sm font-semibold text-text-muted hover:bg-border/10 disabled:opacity-60";
const SAVE =
  "rounded-lg bg-secondary-strong px-4 py-2 text-sm font-semibold text-on-secondary-strong hover:opacity-90 disabled:cursor-wait disabled:opacity-60";

function Field({ id, label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8rem] font-semibold text-text-primary">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="m-0 text-[0.8rem] text-status-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-[0.75rem] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export default function StopEditDialog({ open, mode = "edit", item = null, dayLabel = "", onSubmit, onClose }) {
  const baseId = useId();
  const [form, setForm] = useState(() => (item ? stopFormFromItem(item) : emptyStopForm()));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // A fresh form each time the dialog opens, filled from the stop it opened on.
  useEffect(() => {
    if (!open) return;
    setForm(item ? stopFormFromItem(item) : emptyStopForm());
    setErrors({});
    setSaving(false);
    setSubmitError("");
  }, [open, item]);

  const fieldId = (name) => `${baseId}-${name}`;
  const setField = (name) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const textField = (name, label, { hint, multiline = false, placeholder } = {}) => {
    const id = fieldId(name);
    const Tag = multiline ? "textarea" : "input";
    const describedBy = errors[name] ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <Field id={id} label={label} hint={hint} error={errors[name]}>
        <Tag
          id={id}
          className={INPUT}
          value={form[name]}
          onChange={setField(name)}
          placeholder={placeholder}
          aria-invalid={errors[name] ? "true" : undefined}
          aria-describedby={describedBy}
          {...(multiline ? { rows: 3 } : { type: "text" })}
        />
      </Field>
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const found = validateStopForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setSubmitError("");
    const result = await onSubmit(form);
    if (!result?.ok) {
      setSaving(false);
      setSubmitError(result?.message || "Couldn't save your change. Try again.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} variant="side" title={mode === "add" ? `Add a stop to ${dayLabel}` : "Edit stop"}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {textField("title", "Title")}
        <Field id={fieldId("type")} label="Type">
          <select id={fieldId("type")} className={INPUT} value={form.type} onChange={setField("type")}>
            {STOP_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {textField("startTime", "Start time", { placeholder: "9:00 AM" })}
          {textField("endTime", "End time", { placeholder: "11:00 AM" })}
        </div>
        {textField("description", "Description", { multiline: true })}
        {textField("clientNotes", "Notes for the client", { multiline: true, hint: "Shown on the shared itinerary." })}
        {textField("staffNotes", "Staff notes", { multiline: true, hint: "Only your agency sees these." })}
        {submitError ? (
          <p role="alert" className="m-0 rounded-lg bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
            {submitError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5 border-t border-border/10 pt-4">
          <button type="button" className={CANCEL} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className={SAVE} disabled={saving}>
            {saving ? "Saving…" : mode === "add" ? "Add stop" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [x] **Step 5: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/stop-edit-dialog.test.jsx`
Expected: PASS (4 tests).

- [x] **Step 6: Commit**

```bash
cd Voyage-Client && git add app/components/ui/Modal.jsx app/components/trip-dashboard/itinerary-edit/StopEditDialog.jsx tests/stop-edit-dialog.test.jsx && git commit -m "feat(itinerary): add the stop form as a side panel and phone bottom sheet"
```

---

### Task 15: Move, rename, confirm, day buttons and the dialog host

**Files:**
- Create in `Voyage-Client/app/components/trip-dashboard/itinerary-edit/`: `ConfirmActionDialog.jsx`, `MoveStopDialog.jsx`, `RenameDayDialog.jsx`, `DayEditActions.jsx`, `ItineraryEditDialogs.jsx`
- Test: `Voyage-Client/tests/itinerary-edit-dialogs.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/itinerary-edit-dialogs.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});

import ConfirmActionDialog from "../app/components/trip-dashboard/itinerary-edit/ConfirmActionDialog.jsx";
import MoveStopDialog from "../app/components/trip-dashboard/itinerary-edit/MoveStopDialog.jsx";
import RenameDayDialog from "../app/components/trip-dashboard/itinerary-edit/RenameDayDialog.jsx";
import DayEditActions from "../app/components/trip-dashboard/itinerary-edit/DayEditActions.jsx";
import ItineraryEditDialogs from "../app/components/trip-dashboard/itinerary-edit/ItineraryEditDialogs.jsx";

const lunch = { id: "s2", title: "Lunch" };
const days = [
  { id: "day-1", dayNumber: 1, title: "Arrival", items: [lunch] },
  { id: "day-2", dayNumber: 2, title: "Old town", items: [] },
  { id: "day-3", dayNumber: 3, title: "", items: [] },
];

describe("ConfirmActionDialog", () => {
  it("shows the busy label, then the error, and stays open when the action fails", async () => {
    let finish;
    const onConfirm = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(
      <ConfirmActionDialog open title="Delete this stop?" body="Gone for good." confirmLabel="Delete stop" busyLabel="Deleting…" tone="danger" onConfirm={onConfirm} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete stop" }));
    expect(await screen.findByRole("button", { name: "Deleting…" })).toBeDisabled();

    finish({ ok: false, message: "Couldn't save your change. Try again." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your change. Try again.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("MoveStopDialog", () => {
  it("starts on the first other day and sends the one the user picks", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <MoveStopDialog open stopTitle="Lunch" days={[{ id: "day-2", label: "Day 2: Old town" }, { id: "day-3", label: "Day 3" }]} onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    expect(screen.getByRole("radio", { name: "Day 2: Old town" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Day 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Move stop" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("day-3"));
  });
});

describe("RenameDayDialog", () => {
  it("opens with the current title and refuses a blank one", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<RenameDayDialog open day={days[0]} onSubmit={onSubmit} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Day title");
    expect(screen.getByRole("heading", { name: "Rename day 1" })).toBeInTheDocument();
    expect(input).toHaveValue("Arrival");

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Add a title.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Old town walk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Old town walk"));
  });
});

describe("DayEditActions", () => {
  it("adds a stop, and offers Rename day only when given a handler", () => {
    const onAddStop = vi.fn();
    const onRenameDay = vi.fn();
    const { rerender } = render(<DayEditActions dayNumber={2} onAddStop={onAddStop} />);
    expect(screen.queryByRole("button", { name: "Rename day 2" })).toBeNull();

    rerender(<DayEditActions dayNumber={2} onAddStop={onAddStop} onRenameDay={onRenameDay} />);
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename day 2" }));
    expect(onAddStop).toHaveBeenCalledOnce();
    expect(onRenameDay).toHaveBeenCalledOnce();
  });
});

describe("ItineraryEditDialogs", () => {
  const editorWith = (overrides) => ({
    dialog: null,
    notice: "",
    dismissNotice: vi.fn(),
    closeDialog: vi.fn(),
    submitStop: vi.fn(),
    submitMove: vi.fn(),
    confirmDelete: vi.fn(),
    submitRenameDay: vi.fn(),
    ...overrides,
  });

  it("asks before deleting, naming the stop and its day", () => {
    render(<ItineraryEditDialogs editor={editorWith({ dialog: { kind: "deleteStop", day: days[0], item: lunch } })} days={days} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/"Lunch" will be removed from Day 1: Arrival/)).toBeInTheDocument();
  });

  it("offers every other day as a move target", () => {
    render(<ItineraryEditDialogs editor={editorWith({ dialog: { kind: "moveStop", day: days[0], item: lunch } })} days={days} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.closest("label").textContent)).toEqual(["Day 2: Old town", "Day 3"]);
  });

  it("shows the notice with a way to dismiss it", () => {
    const editor = editorWith({ notice: "This trip is approved, so it can't be changed. Reopen it to make changes." });
    render(<ItineraryEditDialogs editor={editor} days={days} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This trip is approved");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(editor.dismissNotice).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-edit-dialogs.test.jsx`
Expected: FAIL, the components don't exist.

- [x] **Step 3: Write `ConfirmActionDialog.jsx`**

```jsx
"use client";
// A yes/no question whose "yes" can fail: the error shows in place and the dialog
// stays open. Used for Delete stop and Reopen for edits.
import { useEffect, useState } from "react";
import Modal from "../../ui/Modal.jsx";

const CANCEL =
  "rounded-lg border border-border/20 px-4 py-2 text-sm font-semibold text-text-muted hover:bg-border/10 disabled:opacity-60";
const CONFIRM = {
  danger:
    "rounded-lg border border-status-danger/40 px-4 py-2 text-sm font-semibold text-status-danger hover:bg-status-danger/10 disabled:cursor-wait disabled:opacity-60",
  default:
    "rounded-lg bg-secondary-strong px-4 py-2 text-sm font-semibold text-on-secondary-strong hover:opacity-90 disabled:cursor-wait disabled:opacity-60",
};

export default function ConfirmActionDialog({ open, title, body, confirmLabel, busyLabel, tone = "default", onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError("");
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    setError("");
    const result = await onConfirm();
    if (!result?.ok) {
      setBusy(false);
      setError(result?.message || "Something went wrong. Try again.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="m-0 text-sm leading-relaxed text-text-muted">{body}</p>
      {error ? (
        <p role="alert" className="mb-0 mt-3 rounded-lg bg-status-danger/10 px-3 py-2 text-sm text-status-danger">{error}</p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2.5">
        <button type="button" className={CANCEL} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={CONFIRM[tone] ?? CONFIRM.default} onClick={handleConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
```

- [x] **Step 4: Write `MoveStopDialog.jsx`**

```jsx
"use client";
// "Move to another day": pick a day; the stop goes to the end of it.
import { useEffect, useId, useState } from "react";
import Modal from "../../ui/Modal.jsx";

const CANCEL =
  "rounded-lg border border-border/20 px-4 py-2 text-sm font-semibold text-text-muted hover:bg-border/10 disabled:opacity-60";
const SUBMIT =
  "rounded-lg bg-secondary-strong px-4 py-2 text-sm font-semibold text-on-secondary-strong hover:opacity-90 disabled:cursor-wait disabled:opacity-60";

export default function MoveStopDialog({ open, stopTitle, days, onSubmit, onClose }) {
  const groupName = useId();
  const [toDayId, setToDayId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // `days` must be memoized by the caller, or this would reset the choice on every render.
  useEffect(() => {
    if (!open) return;
    setToDayId(days[0]?.id ?? "");
    setBusy(false);
    setError("");
  }, [open, days]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!toDayId) return;
    setBusy(true);
    setError("");
    const result = await onSubmit(toDayId);
    if (!result?.ok) {
      setBusy(false);
      setError(result?.message || "Couldn't move this stop. Try again.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Move "${stopTitle}"`} size="sm">
      <form onSubmit={handleSubmit}>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[0.8rem] font-semibold text-text-primary">Move to</legend>
          {days.map((day) => (
            <label
              key={day.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/20 px-3 py-2.5 text-sm text-text-primary has-[:checked]:border-secondary/60 has-[:checked]:bg-secondary/10"
            >
              <input type="radio" name={groupName} value={day.id} checked={toDayId === day.id} onChange={() => setToDayId(day.id)} />
              {day.label}
            </label>
          ))}
        </fieldset>
        <p className="mb-0 mt-3 text-[0.8rem] text-text-muted">The stop goes to the end of that day.</p>
        {error ? (
          <p role="alert" className="mb-0 mt-3 rounded-lg bg-status-danger/10 px-3 py-2 text-sm text-status-danger">{error}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className={CANCEL} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={SUBMIT} disabled={busy || !toDayId}>{busy ? "Moving…" : "Move stop"}</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [x] **Step 5: Write `RenameDayDialog.jsx`**

```jsx
"use client";
import { useEffect, useId, useState } from "react";
import Modal from "../../ui/Modal.jsx";

const INPUT =
  "w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-base text-text-primary focus:border-secondary focus:outline-none aria-invalid:border-status-danger/60 sm:text-sm";
const CANCEL =
  "rounded-lg border border-border/20 px-4 py-2 text-sm font-semibold text-text-muted hover:bg-border/10 disabled:opacity-60";
const SAVE =
  "rounded-lg bg-secondary-strong px-4 py-2 text-sm font-semibold text-on-secondary-strong hover:opacity-90 disabled:cursor-wait disabled:opacity-60";

export default function RenameDayDialog({ open, day, onSubmit, onClose }) {
  const inputId = useId();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(day?.title ?? "");
    setError("");
    setBusy(false);
  }, [open, day]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Add a title.");
      return;
    }
    if (trimmed.length > 200) {
      setError("Keep this under 200 characters.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await onSubmit(trimmed);
    if (!result?.ok) {
      setBusy(false);
      setError(result?.message || "Couldn't save your change. Try again.");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Rename day ${day?.dayNumber ?? ""}`} size="sm">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[0.8rem] font-semibold text-text-primary">Day title</label>
        <input
          id={inputId}
          type="text"
          className={INPUT}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError("");
          }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        {error ? <p id={`${inputId}-error`} className="m-0 text-[0.8rem] text-status-danger">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" className={CANCEL} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={SAVE} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [x] **Step 6: Write `DayEditActions.jsx`**

```jsx
"use client";
// The buttons under a day's stops. Rename day appears only where the day's title has
// no pencil of its own (the phone list); the desktop day view puts it by the title.
import { PencilIcon, PlusIcon } from "../../icons/index.js";

const BUTTON =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-dashed border-border/40 px-3 text-[0.85rem] font-semibold text-text-muted transition-colors duration-150 hover:border-secondary/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

export default function DayEditActions({ dayNumber, onAddStop, onRenameDay = null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} onClick={onAddStop}>
        <PlusIcon width={14} height={14} aria-hidden="true" />
        Add stop
      </button>
      {onRenameDay ? (
        <button type="button" className={BUTTON} onClick={onRenameDay} aria-label={`Rename day ${dayNumber}`}>
          <PencilIcon width={14} height={14} aria-hidden="true" />
          Rename day
        </button>
      ) : null}
    </div>
  );
}
```

- [x] **Step 7: Write `ItineraryEditDialogs.jsx`**

```jsx
"use client";
// Every dialog behind the stop menus and day buttons, plus the notice for edits that
// had no dialog of their own (Move up / Move down) or that the server refused.
import { useMemo } from "react";
import StopEditDialog from "./StopEditDialog.jsx";
import MoveStopDialog from "./MoveStopDialog.jsx";
import RenameDayDialog from "./RenameDayDialog.jsx";
import ConfirmActionDialog from "./ConfirmActionDialog.jsx";
import { dayLabel, otherDayOptions, stopDisplayTitle } from "../../../lib/trip-dashboard/itineraryEditing.js";

export default function ItineraryEditDialogs({ editor, days }) {
  const { dialog } = editor;
  const stopTitle = stopDisplayTitle(dialog?.item);
  const moveDays = useMemo(
    () => (dialog?.kind === "moveStop" ? otherDayOptions(days, days.findIndex((day) => day.id === dialog.day.id)) : []),
    [dialog, days],
  );

  return (
    <>
      <StopEditDialog
        open={dialog?.kind === "editStop" || dialog?.kind === "addStop"}
        mode={dialog?.kind === "addStop" ? "add" : "edit"}
        item={dialog?.kind === "editStop" ? dialog.item : null}
        dayLabel={dialog?.day ? dayLabel(dialog.day) : ""}
        onSubmit={editor.submitStop}
        onClose={editor.closeDialog}
      />
      <MoveStopDialog
        open={dialog?.kind === "moveStop"}
        stopTitle={stopTitle}
        days={moveDays}
        onSubmit={editor.submitMove}
        onClose={editor.closeDialog}
      />
      <RenameDayDialog
        open={dialog?.kind === "renameDay"}
        day={dialog?.kind === "renameDay" ? dialog.day : null}
        onSubmit={editor.submitRenameDay}
        onClose={editor.closeDialog}
      />
      <ConfirmActionDialog
        open={dialog?.kind === "deleteStop"}
        title="Delete this stop?"
        body={dialog?.kind === "deleteStop" ? `"${stopTitle}" will be removed from ${dayLabel(dialog.day)}. This can't be undone.` : ""}
        confirmLabel="Delete stop"
        busyLabel="Deleting…"
        tone="danger"
        onConfirm={editor.confirmDelete}
        onClose={editor.closeDialog}
      />
      {editor.notice ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-[90] flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-border/20 bg-surface-elevated px-4 py-3 text-sm text-text-primary shadow-strong"
        >
          <span className="flex-1">{editor.notice}</span>
          <button type="button" onClick={editor.dismissNotice} className="text-[0.8rem] font-semibold text-text-muted hover:text-text-primary">
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
```

- [x] **Step 8: Run it to verify it passes**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-edit-dialogs.test.jsx`
Expected: PASS (8 tests).

- [x] **Step 9: Commit**

```bash
cd Voyage-Client && git add app/components/trip-dashboard/itinerary-edit tests/itinerary-edit-dialogs.test.jsx && git commit -m "feat(itinerary): add the move, rename and confirm dialogs"
```

---

### Task 16: Edit controls in the day view and the phone card

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ItineraryDayView.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/mobile/CompactPlaceCard.jsx`
- Test: `Voyage-Client/tests/itinerary-day-view-editing.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/itinerary-day-view-editing.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/components/trip-dashboard/pages/CommentsPanel.jsx", () => ({ default: () => null }));

import ItineraryDayView from "../app/components/trip-dashboard/pages/ItineraryDayView.jsx";
import CompactPlaceCard from "../app/components/trip-dashboard/mobile/CompactPlaceCard.jsx";

const days = [
  { id: "day-1", dayNumber: 1, title: "Arrival", items: [{ id: "s1", title: "Museum", type: "ACTIVITY" }, { id: "s2", title: "Lunch", type: "MEAL" }] },
  { id: "day-2", dayNumber: 2, title: "Old town", items: [] },
];

const editorStub = (overrides = {}) => ({
  canEdit: true,
  openEditStop: vi.fn(),
  openAddStop: vi.fn(),
  openMoveStop: vi.fn(),
  openDeleteStop: vi.fn(),
  openRenameDay: vi.fn(),
  moveStopBy: vi.fn(),
  ...overrides,
});

function renderDayView(editor) {
  return render(
    <ItineraryDayView
      agencyId="ag-1"
      selectedTripId="t1"
      selectedItineraryId="itin-1"
      fullItinerary={{ id: "itin-1", days }}
      safeDays={days}
      selectedDay={days[0]}
      selectedDayIndex={0}
      selectedDayMapItems={[]}
      activeStopIndex={-1}
      setActiveStopIndex={vi.fn()}
      tripStart={null}
      isLoadingItinerary={false}
      itineraryError={null}
      showCommentsPanel={false}
      setShowCommentsPanel={vi.fn()}
      theme="light"
      editor={editor}
    />,
  );
}

describe("ItineraryDayView edit controls", () => {
  it("shows none without an editor, or when editing is off", () => {
    const { rerender } = renderDayView(undefined);
    expect(screen.queryByRole("button", { name: "Actions for Museum" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add stop" })).toBeNull();

    rerender(
      <ItineraryDayView
        agencyId="ag-1" selectedTripId="t1" selectedItineraryId="itin-1" fullItinerary={{ id: "itin-1", days }}
        safeDays={days} selectedDay={days[0]} selectedDayIndex={0} selectedDayMapItems={[]} activeStopIndex={-1}
        setActiveStopIndex={vi.fn()} tripStart={null} isLoadingItinerary={false} itineraryError={null}
        showCommentsPanel={false} setShowCommentsPanel={vi.fn()} theme="light" editor={editorStub({ canEdit: false })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rename day 1" })).toBeNull();
  });

  it("gives each stop a menu wired to that stop", () => {
    const editor = editorStub();
    renderDayView(editor);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Lunch" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit details",
      "Move up",
      "Move to another day",
      "Delete stop",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(editor.moveStopBy).toHaveBeenCalledWith(days[0], 1, -1);
  });

  it("adds a stop and renames the day", () => {
    const editor = editorStub();
    renderDayView(editor);

    fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename day 1" }));
    expect(editor.openAddStop).toHaveBeenCalledWith(days[0]);
    expect(editor.openRenameDay).toHaveBeenCalledWith(days[0]);
  });
});

describe("CompactPlaceCard actions", () => {
  it("puts the menu beside the card's button, not inside it", () => {
    render(<CompactPlaceCard item={days[0].items[0]} onSelect={vi.fn()} actions={<button type="button">Actions</button>} />);
    const card = screen.getByRole("button", { name: /Museum/ });
    expect(card).not.toContainElement(screen.getByRole("button", { name: "Actions" }));
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-day-view-editing.test.jsx`
Expected: FAIL. There's no "Actions for Lunch" button, no "Add stop", and the card ignores `actions`.

- [x] **Step 3: Add the controls to `ItineraryDayView.jsx`**

(a) Change the icon import and add three imports:

```jsx
import { BuildingIcon, PencilIcon } from "../../icons/index.js";
import StopActionsMenu from "../itinerary-edit/StopActionsMenu.jsx";
import DayEditActions from "../itinerary-edit/DayEditActions.jsx";
import { stopMoveOptions } from "../../../lib/trip-dashboard/itineraryEditing.js";
```

(b) Add `editor = null,` to the props, after `dayWeather = null,`. Add above the component:

```jsx
const ICON_BUTTON =
  "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border/20 bg-surface-elevated text-text-soft transition-colors duration-150 hover:border-border/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";
```

and as the first line inside `if (fullItinerary && safeDays.length > 0) {`:

```jsx
    // Hand edits: the page passes an editor, and it says whether this trip is unlocked.
    const canEdit = Boolean(editor?.canEdit);
```

(c) Wrap the day title in a row with the pencil. Keep the `<h4>` line exactly as it is (the typography guard reads it):

```jsx
              <div className="flex items-center gap-2">
                <h4 className="m-0 font-sans text-[22px] font-semibold leading-snug tracking-[-0.015em] text-text-primary">{selectedDay.title}</h4>
                {canEdit && (
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    onClick={() => editor.openRenameDay(selectedDay)}
                    aria-label={`Rename day ${selectedDay.dayNumber}`}
                    title="Rename day"
                  >
                    <PencilIcon width={14} height={14} aria-hidden="true" />
                  </button>
                )}
              </div>
```

(d) In the stops `.map((item, iIdx) => {`, add before `return (`:

```jsx
                  const moves = canEdit ? stopMoveOptions(safeDays, selectedDayIndex, iIdx) : null;
```

change the card's key from ``key={`${selectedDay.dayNumber}-${iIdx}`}`` to

```jsx
                      key={item.id ?? `${selectedDay.dayNumber}-${iIdx}`}
```

(keyed by id, a moved card keeps its DOM node, so focus stays with the moved stop's menu button), and replace the "Time badge + type" row's place-type block

```jsx
                        {placeType && (
                          <span className="text-[0.65rem] font-bold tracking-widest uppercase text-text-soft">
                            {placeType}
                          </span>
                        )}
```

with

```jsx
                        <div className="flex items-center gap-2">
                          {placeType && (
                            <span className="text-[0.65rem] font-bold tracking-widest uppercase text-text-soft">
                              {placeType}
                            </span>
                          )}
                          {moves && (
                            <StopActionsMenu
                              stopTitle={item.title || placeName}
                              canMoveUp={moves.canMoveUp}
                              canMoveDown={moves.canMoveDown}
                              canMoveToDay={moves.otherDays.length > 0}
                              onEdit={() => editor.openEditStop(selectedDay, item)}
                              onMoveUp={() => editor.moveStopBy(selectedDay, iIdx, -1)}
                              onMoveDown={() => editor.moveStopBy(selectedDay, iIdx, 1)}
                              onMoveToDay={() => editor.openMoveStop(selectedDay, item)}
                              onDelete={() => editor.openDeleteStop(selectedDay, item)}
                            />
                          )}
                        </div>
```

(e) Right after the closing `</div>` of the `<div className="flex flex-col gap-3">` stops list, add:

```jsx
              {canEdit && (
                <DayEditActions dayNumber={selectedDay.dayNumber} onAddStop={() => editor.openAddStop(selectedDay)} />
              )}
```

- [x] **Step 4: Let `CompactPlaceCard.jsx` take an actions slot**

(a) Change the signature to:

```jsx
export default function CompactPlaceCard({
  item,
  isSelected = false,
  onSelect,
  // Optional controls (the stop menu). They sit beside the card's button, never
  // inside it: a button can't contain another button.
  actions = null,
}) {
```

(b) Change `return (` to `const card = (`, and add `${actions ? "pr-12" : ""}` to the end of the button's className template, so the text doesn't run under the menu:

```jsx
      className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-2xl border transition-all duration-200 backdrop-blur-md ${
        isSelected
          ? "ring-2 ring-secondary/35 border-secondary/30 bg-[rgba(255,255,255,0.10)] shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
          : "border-white/10 bg-[rgba(255,255,255,0.06)] shadow-[0_14px_30px_rgba(15,23,42,0.12)] hover:border-white/15 hover:bg-[rgba(255,255,255,0.09)]"
      } ${actions ? "pr-12" : ""}`}
```

(c) After the closing `);` of `card`, add:

```jsx
  if (!actions) return card;
  return (
    <div className="relative">
      {card}
      <div className="absolute right-2 top-2">{actions}</div>
    </div>
  );
```

- [x] **Step 5: Run the new test and the guards that read these files**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-day-view-editing.test.jsx tests/accessibility-integrations.test.jsx tests/heading-typography.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
cd Voyage-Client && git add app/components/trip-dashboard/pages/ItineraryDayView.jsx app/components/trip-dashboard/mobile/CompactPlaceCard.jsx tests/itinerary-day-view-editing.test.jsx && git commit -m "feat(itinerary): add stop menus, Add stop and Rename day to the day views"
```

---

### Task 17: Reopen for edits in the header

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ItineraryHeader.jsx`
- Test: `Voyage-Client/tests/itinerary-header.test.jsx`

- [x] **Step 1: Write the failing tests**

Add inside `describe("ItineraryHeader", ...)` in `Voyage-Client/tests/itinerary-header.test.jsx`:

```jsx
  it("offers Reopen for edits when the page passes a handler", () => {
    const approved = { id: "t1", approvalStatus: "Approved" };
    const onReopen = vi.fn();
    renderHeader({ selectedTrip: approved, onReopen });

    fireEvent.click(screen.getByRole("button", { name: "Reopen for edits" }));

    expect(onReopen).toHaveBeenCalledOnce();
  });

  it("has no Reopen for edits button for a trip in review", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: "Reopen for edits" })).toBeNull();
  });
```

- [x] **Step 2: Run them to verify the first fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-header.test.jsx`
Expected: FAIL on "offers Reopen for edits when the page passes a handler".

- [x] **Step 3: Add the props and the button**

In `Voyage-Client/app/components/trip-dashboard/pages/ItineraryHeader.jsx`:

(a) Add to the props, after `isApproving = false,`:

```jsx
  // Reopen shows only when the page passes a handler (the trip is approved).
  onReopen = null,
  // Approved trips are locked, so the page hides Reuse for them.
  canReuse = true,
```

(b) Change the Reuse launcher condition from

```jsx
                {agencyId && currentTrip && targetItineraryId && currentVersion !== null && (
```

to

```jsx
                {canReuse && agencyId && currentTrip && targetItineraryId && currentVersion !== null && (
```

(c) Add right after the `{onApprove ? (...) : null}` block:

```jsx
            {onReopen ? (
              <button
                type="button"
                onClick={onReopen}
                className="inline-flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg border border-border/30 bg-surface-elevated px-4 text-[0.85rem] font-semibold text-text-primary transition-[background-color,border-color,scale] duration-150 ease-out hover:border-border/50 hover:bg-surface active:scale-[0.97] motion-reduce:transition-none"
              >
                Reopen for edits
              </button>
            ) : null}
```

- [x] **Step 4: Run them to verify they pass**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/itinerary-header.test.jsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
cd Voyage-Client && git add app/components/trip-dashboard/pages/ItineraryHeader.jsx tests/itinerary-header.test.jsx && git commit -m "feat(itinerary): add Reopen for edits to the itinerary header"
```

---

### Task 18: Wire it into the Itineraries page

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx`
- Modify: `Voyage-Client/tests/client-itinerary-reuse-insert.test.jsx` (fixture)
- Test: `Voyage-Client/tests/client-itinerary-editing.test.jsx`

- [x] **Step 1: Write the failing test**

Create `Voyage-Client/tests/client-itinerary-editing.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  approveClientTrip: vi.fn(),
  fetchItineraryDraft: vi.fn(),
  getUnreadCommentCount: vi.fn(async () => ({ count: 0 })),
  getUnreadCommentCountsByTrip: vi.fn(async () => ({ counts: [] })),
  fetchItineraryWeather: vi.fn(async () => ({ weather: { provider: null, attribution: null, days: [] } })),
}));
const editApi = vi.hoisted(() => ({
  reopenClientTrip: vi.fn(),
  addItineraryStop: vi.fn(),
  updateItineraryStop: vi.fn(),
  deleteItineraryStop: vi.fn(),
  moveItineraryStop: vi.fn(),
  renameItineraryDay: vi.fn(),
}));
// The day view is stubbed; what the page hands it is what this test checks.
const dayView = vi.hoisted(() => ({ props: null }));

vi.mock("../app/lib/api/index.js", () => api);
vi.mock("../app/lib/api/itineraryEditing.js", () => editApi);
vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});
vi.mock("../app/components/ui/index.js", () => ({
  Spinner: () => null,
  EmptyState: ({ title }) => <p>{title}</p>,
  StatusBadge: ({ children }) => <span>{children}</span>,
}));
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/components/trip-dashboard/itinerary/ShareDialog.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/pages/CommentsPanel.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/pages/ItineraryDayView.jsx", () => ({
  default: (props) => {
    dayView.props = props;
    return null;
  },
}));
vi.mock("../app/components/trip-dashboard/mobile/MobileGlassSheet.jsx", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../app/components/ratedHistory/entryPoints/ReuseLauncher.jsx", () => ({
  default: () => <span data-testid="reuse-launcher" />,
}));
vi.mock("../app/lib/pdfExport.js", () => ({ generateItineraryPdf: vi.fn(), titleToFilename: vi.fn((s) => s) }));
vi.mock("../app/components/theme/ThemeProvider.jsx", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../app/lib/formatters.js", () => ({
  formatDayCardDate: () => "",
  getItemTimeLabel: () => "",
  getSavedStatusClass: () => "approved",
}));

import ClientItineraryPage from "../app/components/trip-dashboard/pages/ClientItineraryPage.jsx";

const inReviewTrip = { id: "t1", clientName: "Alice", approvalStatus: "In review", destination: "Tokyo", itineraryId: "iter-1", isSaved: true };
const approvedTrip = { id: "t2", clientName: "Alice", approvalStatus: "Approved", destination: "Lisbon", itineraryId: "iter-2", isSaved: true };

let statuses;

beforeEach(() => {
  vi.clearAllMocks();
  dayView.props = null;
  statuses = { "iter-1": "NEEDS_REVIEW", "iter-2": "APPROVED_INTERNAL" };
  api.fetchItineraryDraft.mockImplementation(async (_agencyId, id) => ({
    itinerary: { id, status: statuses[id], version: 3, days: [{ id: `${id}-day-1`, dayNumber: 1, title: "Arrival", items: [] }] },
  }));
  editApi.reopenClientTrip.mockImplementation(async () => {
    statuses["iter-2"] = "NEEDS_REVIEW";
    return {};
  });
});

describe("hand edits on the Itineraries page", () => {
  it("lets staff edit a trip in review, with Reuse and no Reopen", async () => {
    render(<ClientItineraryPage agencyTrips={[inReviewTrip]} agencyId="agency-1" />);

    await waitFor(() => expect(dayView.props?.editor?.canEdit).toBe(true));
    expect(screen.getByTestId("reuse-launcher")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen for edits" })).toBeNull();
  });

  it("locks an approved trip and reopens it after confirmation", async () => {
    const onTripStatusChange = vi.fn();
    const { rerender } = render(
      <ClientItineraryPage agencyTrips={[approvedTrip]} agencyId="agency-1" onTripStatusChange={onTripStatusChange} />,
    );

    await waitFor(() => expect(dayView.props?.fullItinerary?.id).toBe("iter-2"));
    expect(dayView.props.editor.canEdit).toBe(false);
    expect(screen.queryByTestId("reuse-launcher")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reopen for edits" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/needs approval again/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen for edits" }));

    await waitFor(() => expect(editApi.reopenClientTrip).toHaveBeenCalledWith("agency-1", "t2"));
    await waitFor(() => expect(onTripStatusChange).toHaveBeenCalledWith("t2", "In review"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The parent (HomePage) relabels the trip; then the page unlocks.
    rerender(
      <ClientItineraryPage agencyTrips={[{ ...approvedTrip, approvalStatus: "In review" }]} agencyId="agency-1" onTripStatusChange={onTripStatusChange} />,
    );
    await waitFor(() => expect(dayView.props?.editor?.canEdit).toBe(true));
  });

  it("keeps the trip locked and says so when reopening fails", async () => {
    editApi.reopenClientTrip.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const onTripStatusChange = vi.fn();
    render(<ClientItineraryPage agencyTrips={[approvedTrip]} agencyId="agency-1" onTripStatusChange={onTripStatusChange} />);

    await waitFor(() => expect(dayView.props?.fullItinerary?.id).toBe("iter-2"));
    fireEvent.click(screen.getByRole("button", { name: "Reopen for edits" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen for edits" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't reopen this trip. Try again.");
    expect(onTripStatusChange).not.toHaveBeenCalled();
    expect(dayView.props.editor.canEdit).toBe(false);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/client-itinerary-editing.test.jsx`
Expected: FAIL. `dayView.props.editor` is undefined, and there's no Reopen button.

- [x] **Step 3: Wire up the page**

In `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx`:

(a) Add imports after `import ItineraryDayView from "./ItineraryDayView.jsx";` (by direct path: the page tests mock `lib/api/index.js` with a fixed list):

```jsx
import ItineraryEditDialogs from "../itinerary-edit/ItineraryEditDialogs.jsx";
import ConfirmActionDialog from "../itinerary-edit/ConfirmActionDialog.jsx";
import StopActionsMenu from "../itinerary-edit/StopActionsMenu.jsx";
import DayEditActions from "../itinerary-edit/DayEditActions.jsx";
import { useItineraryEditor } from "../../../hooks/useItineraryEditor.js";
import { reopenClientTrip } from "../../../lib/api/itineraryEditing.js";
import {
  isItineraryLocked,
  stopDisplayTitle,
  stopMoveOptions,
} from "../../../lib/trip-dashboard/itineraryEditing.js";
```

(b) Add state after `const [approvingTripId, setApprovingTripId] = useState(null);`:

```jsx
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
```

(c) Replace the whole `handleReuseInserted` function and the comment above it with:

```jsx
  // Re-read the stored itinerary: after a Reuse insert, or after an edit the server
  // refused (the trip was approved meanwhile, or the stop is gone). The load effect
  // bumps requestSequenceRef on every selection change, so a reload that lands after
  // the selection moved on is dropped the same way a stale load is.
  const reloadItinerary = useCallback(() => {
    if (!agencyId || !selectedItineraryId || isTutorialItinerary) return;
    const requestId = requestSequenceRef.current;
    fetchItineraryDraft(agencyId, selectedItineraryId)
      .then((res) => {
        if (requestSequenceRef.current !== requestId) return;
        setFullItinerary(normalizeItineraryResponse(res));
      })
      .catch((err) => {
        // Keep what is on screen; the next load of this trip corrects it.
        console.error(err);
      });
  }, [agencyId, selectedItineraryId, isTutorialItinerary]);

  // A Reuse insert returns the server's insert result, not an itinerary: it names itself
  // `itineraryId` and carries no `version`. Show its days at once but keep this itinerary's id and
  // version (the PDF gate, the Reuse launcher and the weather all key off them), then reload the
  // canonical itinerary.
  const handleReuseInserted = (updatedItinerary) => {
    if (!updatedItinerary) return;
    setFullItinerary((prev) => ({
      ...prev,
      ...updatedItinerary,
      id: prev?.id ?? updatedItinerary.id ?? updatedItinerary.itineraryId,
    }));
    reloadItinerary();
  };
```

(d) In the "Reset per-trip UI state when trip changes" effect, add `setReopenConfirmOpen(false);`.

(e) Right after `const pdfLoading = ...;` (before `handleCipSnapChange`, so every hook runs before the phone layout's early return), add:

```jsx
  // Hand edits need this trip's own itinerary on screen, a real agency (not the
  // tour's sample data) and an unlocked trip. The server enforces the same lock.
  const isLocked = isItineraryLocked({
    approvalStatus: selectedTrip?.approvalStatus,
    itineraryStatus: fullItinerary?.status,
  });
  const canEditItinerary = Boolean(agencyId && fullItinerary && itineraryIsCurrent && !isTutorialItinerary && !isLocked);
  // An edit's response replaces the itinerary, unless the user moved to another trip meanwhile.
  const handleEditedItinerary = useCallback(
    (response) => {
      const next = normalizeItineraryResponse(response);
      if (next && String(next.id) === String(selectedItineraryId)) setFullItinerary(next);
    },
    [selectedItineraryId],
  );
  const editor = useItineraryEditor({
    agencyId,
    itineraryId: selectedItineraryId,
    canEdit: canEditItinerary,
    onItineraryChange: handleEditedItinerary,
    reload: reloadItinerary,
  });

  const closeReopenConfirm = useCallback(() => setReopenConfirmOpen(false), []);
  // Not optimistic: the trip only unlocks once the server has reopened it.
  const handleReopenTrip = useCallback(async () => {
    if (!selectedTrip || !agencyId) return { ok: false, message: "" };
    const trip = selectedTrip;
    const itineraryId = selectedItineraryId;
    try {
      await reopenClientTrip(agencyId, trip.id);
    } catch (err) {
      console.error(err);
      return { ok: false, message: "Couldn't reopen this trip. Try again." };
    }
    onTripStatusChange?.(trip.id, "In review");
    setFullItinerary((prev) =>
      prev && String(prev.id) === String(itineraryId) ? { ...prev, status: "NEEDS_REVIEW" } : prev,
    );
    setReopenConfirmOpen(false);
    return { ok: true };
  }, [agencyId, onTripStatusChange, selectedItineraryId, selectedTrip]);
```

(f) Phone layout: replace the stops map inside `{selectedDay ? (<> ... </>)`

```jsx
                        {(selectedDay.items || []).map((item, iIdx) => {
                          return (
                            <CompactPlaceCard
                              key={`${selectedDay.dayNumber}-${iIdx}`}
                              item={item}
                              isSelected={activeStopIndex === iIdx}
                              onSelect={() => {
                                setActiveStopIndex(iIdx);
                                setSelectedPlaceId(item.__placeEntityId);
                              }}
                            />
                          );
                        })}
```

with

```jsx
                        {(selectedDay.items || []).map((item, iIdx) => {
                          const moves = editor.canEdit ? stopMoveOptions(safeDays, selectedDayIndex, iIdx) : null;
                          return (
                            <CompactPlaceCard
                              key={item.id ?? `${selectedDay.dayNumber}-${iIdx}`}
                              item={item}
                              isSelected={activeStopIndex === iIdx}
                              onSelect={() => {
                                setActiveStopIndex(iIdx);
                                setSelectedPlaceId(item.__placeEntityId);
                              }}
                              actions={
                                moves ? (
                                  <StopActionsMenu
                                    stopTitle={stopDisplayTitle(item)}
                                    canMoveUp={moves.canMoveUp}
                                    canMoveDown={moves.canMoveDown}
                                    canMoveToDay={moves.otherDays.length > 0}
                                    onEdit={() => editor.openEditStop(selectedDay, item)}
                                    onMoveUp={() => editor.moveStopBy(selectedDay, iIdx, -1)}
                                    onMoveDown={() => editor.moveStopBy(selectedDay, iIdx, 1)}
                                    onMoveToDay={() => editor.openMoveStop(selectedDay, item)}
                                    onDelete={() => editor.openDeleteStop(selectedDay, item)}
                                  />
                                ) : null
                              }
                            />
                          );
                        })}
                        {editor.canEdit ? (
                          <DayEditActions
                            dayNumber={selectedDay.dayNumber}
                            onAddStop={() => editor.openAddStop(selectedDay)}
                            onRenameDay={() => editor.openRenameDay(selectedDay)}
                          />
                        ) : null}
```

and right after the phone layout's `<ShareDialog ... />`, add:

```jsx
        <ItineraryEditDialogs editor={editor} days={safeDays} />
```

(g) Desktop layout: add to the `<ItineraryHeader` props, after `isApproving={...}`:

```jsx
              onReopen={selectedTrip?.approvalStatus === "Approved" && !isTutorialItinerary ? () => setReopenConfirmOpen(true) : null}
              canReuse={!isLocked}
```

add `editor={editor}` to `<ItineraryDayView`, and after the desktop `<ShareDialog ... />`, add:

```jsx
      <ItineraryEditDialogs editor={editor} days={safeDays} />
      <ConfirmActionDialog
        open={reopenConfirmOpen}
        title="Reopen this trip for edits?"
        body="It goes back to In review and needs approval again. Share links show each change as soon as you save it."
        confirmLabel="Reopen for edits"
        busyLabel="Reopening…"
        onConfirm={handleReopenTrip}
        onClose={closeReopenConfirm}
      />
```

- [x] **Step 4: Update the Reuse page test's fixture**

Reuse is now hidden on approved trips, and `tests/client-itinerary-reuse-insert.test.jsx` inserts into an approved one. In that file, change

```jsx
const trip = { id: "t1", clientName: "Garcia", approvalStatus: "Approved", destination: "Baguio", itineraryId: "iter-1", isSaved: true };
```

to

```jsx
// In review: Reuse is hidden on approved trips, which are locked until reopened.
const trip = { id: "t1", clientName: "Garcia", approvalStatus: "In review", destination: "Baguio", itineraryId: "iter-1", isSaved: true };
```

- [x] **Step 5: Run the page tests**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/client-itinerary-editing.test.jsx tests/client-itinerary-approve.test.jsx tests/client-itinerary-pdf.test.jsx tests/client-itinerary-reuse-insert.test.jsx tests/client-itinerary-weather.test.jsx tests/client-itinerary-page.test.jsx tests/heading-typography.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
cd Voyage-Client && git add app/components/trip-dashboard/pages/ClientItineraryPage.jsx tests/client-itinerary-editing.test.jsx tests/client-itinerary-reuse-insert.test.jsx && git commit -m "feat(itinerary): edit saved itineraries by hand and reopen approved trips"
```

---

### Task 19: A plain message when Reuse hits a locked itinerary

**Files:**
- Modify: `Voyage-Client/app/components/ratedHistory/hooks/useReuseDrop.js` (`case 409`, ~line 486)
- Modify: `Voyage-Client/app/components/ratedHistory/entryPoints/ReuseSlashCommand.jsx` (`errorReasonFor`, and its call)
- Test: `Voyage-Client/tests/useReuseDrop.smoke.test.jsx`, `Voyage-Client/tests/reuseSlashCommand.behaviour.test.jsx`

- [x] **Step 1: Write the failing tests**

(a) In `Voyage-Client/tests/useReuseDrop.smoke.test.jsx`, add right after the test `"409 stale_version → calls onStaleVersion"`:

```jsx
  it("409 itinerary_locked → explains the lock without refreshing", async () => {
    const onStaleVersion = vi.fn();
    const onError = vi.fn();
    fetchSpy.mockResolvedValueOnce({
      status: 409,
      json: async () => ({ error: "itinerary_locked" }),
    });

    const apiRef = { current: null };
    const { container } = render(
      <Probe apiRef={apiRef} onError={onError} onStaleVersion={onStaleVersion} onInserted={vi.fn()} />
    );
    setupDayLayout(container);

    const surface = container.querySelector("[data-testid='surface']");
    const dt = createMockDataTransfer({ kind: "day", sourceTripId: "trip-src", dayIds: ["d1"] });

    await act(async () => {
      fireDropAt(surface, { dataTransfer: dt, clientX: 100, clientY: 0 });
    });

    expect(onStaleVersion).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("itinerary_locked", expect.stringMatching(/approved/i));
  });
```

(b) In `Voyage-Client/tests/reuseSlashCommand.behaviour.test.jsx`, add right after test `"6. fetch throws (network error) → SYSTEM_VISIBLE recap with error content"`:

```jsx
  it("6b. approved itinerary (409 itinerary_locked) → says to reopen it", async () => {
    const onSystemVisibleMessage = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({ status: 409, json: async () => ({ error: "itinerary_locked" }) });

    renderSlash({
      composerInput: "/reuse",
      onSystemVisibleMessage,
      targetItinerary: { id: "itin-1", days: [] },
    });

    fireEvent.click(screen.getByTestId("reuse-slash-option-reuse"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-picker-confirm-no-note"));
    });

    await waitFor(() => {
      expect(onSystemVisibleMessage).toHaveBeenCalledTimes(1);
    });
    expect(onSystemVisibleMessage.mock.calls[0][0].content).toMatch(/approved.*reopen/i);
  });
```

- [x] **Step 2: Run them to verify they fail**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/useReuseDrop.smoke.test.jsx tests/reuseSlashCommand.behaviour.test.jsx`
Expected: FAIL. The drop reports `stale_version` and calls `onStaleVersion`; the slash command says "itinerary changed elsewhere".

- [x] **Step 3: Handle the lock in `useReuseDrop.js`**

At the top of `case 409: {`, add:

```js
          // Approved: reloading won't help until someone reopens the trip.
          if (data?.error === "itinerary_locked" || data?.error?.code === "itinerary_locked") {
            emitToast(
              "This itinerary is approved. Reopen it to add stops.",
              "itinerary_locked",
              cbError
            );
            return;
          }
```

- [x] **Step 4: Handle the lock in `ReuseSlashCommand.jsx`**

Change the call from

```jsx
      const reason = errorReasonFor(res.status);
```

to

```jsx
      const reason = errorReasonFor(res.status, data?.error);
```

change `function errorReasonFor(status) {` to `function errorReasonFor(status, code) {`, and its `case 409:` to:

```jsx
    case 409:
      return code === "itinerary_locked"
        ? "this itinerary is approved, reopen it to make changes."
        : "itinerary changed elsewhere — please refresh.";
```

- [x] **Step 5: Run them to verify they pass**

Run: `cd Voyage-Client && npx vitest run --pool=threads tests/useReuseDrop.smoke.test.jsx tests/useReuseDrop.behaviour.test.jsx tests/reuseSlashCommand.behaviour.test.jsx tests/reuseSlashCommand.smoke.test.jsx`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
cd Voyage-Client && git add app/components/ratedHistory tests/useReuseDrop.smoke.test.jsx tests/reuseSlashCommand.behaviour.test.jsx && git commit -m "fix(reuse): explain a locked itinerary instead of asking for a refresh"
```

---

### Task 20: Full check and hands-on QA

- [x] **Step 1: Run both suites and the client build**

```bash
cd Voyage-Server && npx vitest run 2>&1 | tail -40
```

```bash
cd Voyage-Client && npx vitest run --pool=threads 2>&1 | tail -40
```

```bash
cd Voyage-Client && npm run build
```

Expected: only the failures recorded in Task 0. The client build succeeds.

- [ ] **Step 2: Hands-on QA**

Restart the backend first: OneDrive breaks `tsx watch`, so it may still be serving old routes. If the client looks stale, stop it, delete `.next/dev` and start it again. No migration is needed (the statuses already exist).

1. Owner, a trip **In review**: ⋯ menu on every stop; Edit details saves and the card updates; clearing a description shows the place's address again; Move up / Move down reorder and keep focus on the moved stop's ⋯; Move to another day puts it at the end of that day; Delete asks first; Add stop adds a stop with no photo; the pencil renames the day and the day strip updates.
2. Moving a stop with a map route: the map leaves that leg out instead of drawing it wrong.
3. Approve: the ⋯ menus, Add stop, the pencil and Reuse disappear; "Reopen for edits" appears. Reopen, confirm, and the controls come back with the status "In review".
4. Two tabs: approve in one, then save an edit in the other. The edit panel closes, the notice says the trip is approved, and the page reloads locked.
5. Staff assigned to the trip can edit and reopen. A staff member not assigned to it doesn't see the trip.
6. Agent chat on a saved trip in review: "move lunch to 1 pm" works and keeps any hand edits. On an approved trip the agent says to use Reopen for edits.
7. Phone width (375px): the ⋯ menu sits beside each card; the edit panel is a bottom sheet over the map; Add stop and Rename day sit under the list.
8. The share link and the PDF show the edited itinerary.
9. Keyboard only: Tab to ⋯, Enter opens, arrows move, Escape closes and focus returns; inside a dialog, Tab stays in the dialog, and Escape closes it and returns focus to ⋯.
10. Dark mode: the menu, panel, sheet and notice are legible.

#### Results (2026-10-05)

Step 1: both suites match the Task 0 baseline. Server: 1160 passed, with the 11 known stale failures (webSearchProvider 4, agentOrchestrator 4, agentLogger 1, modelProvider 2), and `npm run build` passes. Client: the same 8 stale files fail (7 can't load `icons/index.js`, plus 1 agent-command-center-places test), and `npm run build` passes.

Step 2 ran in the in-app browser, against an isolated local agency ("QA Itinerary Edits") with an owner, an assigned staff member and an unassigned one. The trip was a clone of "2-Day Coastal Escape" with straight-line stored routes. The backend was restarted first.

| # | Check | Result |
|---|---|---|
| 1 | Edit, clear description, up/down, other day, delete, add, rename | Pass. Up/down keep focus on the moved stop's ⋯. A new stop is placed by its start time (the existing `addItem` rule). |
| 2 | Stale routes | Pass. A move, delete or add clears exactly the stops whose previous stop changed. With none left, the map asks for a live route. |
| 3 | Approve, then Reopen | Pass |
| 4 | Two tabs | **Failed, then fixed (client 65511b1).** The edit was refused and the notice shown, but the header kept "In review" and Approve with no Reopen. The header now follows an approved itinerary. |
| 5 | Staff access | Pass, through the API. Assigned staff: list, edit, reopen (409 while approved). Unassigned staff: hidden from the list, 404 on edit, approve and reopen. Place fields are rejected. |
| 6 | Agent | **Not run.** Needs a live model call on a thread tied to the trip. The `agentLiveItinerary` and orchestrator tests cover it. |
| 7 | 375px | **Failed, then fixed (client 16ffcc2).** The phone card showed the place's name, so an edited title never appeared. It now shows the stop's title, as desktop does. The sheet, the ⋯ beside cards, and Add stop / Rename day under the list all pass. |
| 8 | Share link and PDF | Share link passes: rename, custom stop, moved stop and client note show, and staff notes stay hidden. The PDF was not downloaded; it is built from the same itinerary the page shows. |
| 9 | Keyboard | Pass. The menu arrows and End work; Tab stays inside dialogs; Escape returns focus to ⋯. |
| 10 | Dark mode | Pass for the menu, panel, sheet and notice. |

Minors found (A–C fixed in client 52f0e92; D–F open):
- A. Fixed. When the control that had focus disappears, focus used to fall back to `<body>`. Now a deleted or moved-away stop sends focus to the next stop's ⋯, else the previous one's, else the day's Add stop. Reopen leaves focus on the client's name, as Approve does.
- B. Fixed. A failed Add stop, Save or Rename used to leave focus on the button. Now focus goes to the first invalid field, after its message renders.
- C. Fixed. Edit stop and Rename day used to open on Close. Now they open on their title field, through Modal's new `initialFocusRef`.
- D. In dark mode, form-field borders are 1.45:1 against the panel (below 3:1). This comes from the shared `--color-border` token, which about 12 other forms use too.
- E (older than this feature). `GET /itineraries/:id` checks only agency membership, so unassigned staff can read a trip's itinerary by its id.
- F (older than this feature). Hand edits don't bump `Itinerary.version`; only full replaces and day add/remove do.
- G. Fixed (server da1cde2, 2026-10-06), found in a code review after QA. Task 2's rule compared each stop's *immediately* previous stop, but a stored route starts at the previous stop *with map coordinates*. Custom stops are skipped, as in the agent's `findPreviousMappedItem`. So adding, deleting or moving a custom stop cleared a valid route, and moving a place away from behind a custom stop kept a stale one. `routeStaleness.ts` now keys on the previous stop on the map and owns `readDayOrders` / `clearStaleRoutes`. Reuse inserting into the middle of a day now clears stale routes too.
