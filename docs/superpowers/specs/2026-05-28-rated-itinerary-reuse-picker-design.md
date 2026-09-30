# Rated Itinerary Reuse Picker — Design

**Date:** 2026-05-28
**Status:** Draft — pending review
**Companion specs (deferred):**
- Dashboard calendar widget (capacity / navigation / deadlines layers)
- Agent RAG over rated history (`search_rated_history` tool + auto-hint)

## 1. Summary

Let agency staff reuse content from past, field-tested itineraries when building a new draft. The source pool is the agency's own trips with a `TripReview.rating ≥ 4`. Staff can pull a single stop, a whole day, or a multi-day segment, dragging from a picker panel into the current draft. Three entry points open the same picker: a button in the internal itinerary editor, a button on the client itinerary page, and a `/reuse` slash command in the agent thread. Server is authoritative for date re-anchoring and item ID generation.

This is the first of three related specs. A dashboard calendar and agent-side RAG retrieval are scoped to follow-up specs.

## 2. Goals & non-goals

**Goals**
- Surface the agency's rated history as a usable library, not just a KPI.
- Three frictionless entry points; one picker component behind them.
- Server-authoritative correctness for date re-anchoring and ID generation.
- Privacy: client-identifying notes do not leak across trips.

**Non-goals (out of scope for this spec)**
- Agent RAG over rated history. Deferred.
- Calendar view of trip dates. Deferred.
- Cross-agency reuse, public template gallery, or marketplace.
- Reuse driven by proposal-rating (only `TripReview` counts).
- Internal peer / owner ratings, per-item ratings.
- Analytics on reused items (which items are reused most often).
- Whole-trip-clone shortcut from the dashboard.
- Re-fetching `PlaceSnapshot` against Google Maps on reuse.

## 3. User flow

1. Staff opens the picker via one of:
   - "Reuse from rated trips" button in the itinerary editor toolbar.
   - Same button on the client itinerary page (internal staff view).
   - `/reuse` slash command in the agent thread composer.
2. Picker panel slides in (~440px wide, full height). Filters at the top (destination, duration, season). Destination is pre-filled from the current trip's `destinationSummary`; a "Show all rated" toggle clears it.
3. Body lists past trips matching filters: title · destination · day count · trip dates · rating (★N/5). Clicking a trip expands it inline into day-by-day structure.
4. Each item row and day header has a drag handle (`⋮⋮`). A "Select range" toggle on day headers enables multi-day segment drag.
5. Staff drags onto the current draft. Drop zones light up: between days, between items, or on a day header.
6. On drop, client fires `POST /trips/:tripId/itinerary/insert-from-rated`. Server validates same-agency, copies items into the target itinerary, generates new IDs, re-anchors `ItineraryDay.date` to the new trip's `startDate + dayOffset`, returns the updated itinerary.
7. Slash variant: picker confirms via "Add to this trip" buttons (no drop target when the canvas is not visible). On confirm, server applies the same insertion endpoint and posts a `SYSTEM_VISIBLE` recap into the thread. The agent does not auto-respond.

## 4. Architecture

**Approach: standalone `ratedHistory` module.** Mirrors the precedent of the agency-dashboard spec (single-purpose read-side composition layer rather than bolting onto existing modules). Future RAG spec plugs into the same module.

### 4.1 Server layout

```
Voyage-Server/src/modules/ratedHistory/
  ratedHistory.routes.ts        # 3 routes (see §5)
  ratedHistory.service.ts       # query + insertion logic
  ratedHistory.repo.ts          # Prisma access
  ratedHistory.types.ts         # request/response DTOs
  ratedHistory.errors.ts        # typed errors (NotFound, SameAgencyViolation, …)
  __tests__/
    ratedHistory.service.test.ts       # unit
    ratedHistory.routes.test.ts        # integration
    insertionReanchor.test.ts          # date math + ID generation
```

### 4.2 Client layout

```
Voyage-Client/app/components/ratedHistory/
  RatedHistoryPicker.jsx        # side-panel container, owns filter state
  RatedTripList.jsx             # list of trip summaries with rating + meta
  RatedTripExpanded.jsx         # day-by-day expansion inside a list row
  RatedDayCard.jsx              # day header + items, with drag handle and range toggle
  RatedItemRow.jsx              # item row with drag handle
  hooks/useRatedHistory.js      # SWR-style fetch hook, agency-scoped cache
  hooks/useReuseDrop.js         # drop-target logic for editor surfaces
  entryPoints/
    ReuseButton.jsx             # editor + client-itinerary-page button
    ReuseSlashCommand.jsx       # composer interceptor + inline picker for agent thread
```

## 5. Endpoints

All three are under the standard authenticated agency-member middleware. Insertion additionally requires write access on the target trip (existing role gates).

### 5.1 `GET /agencies/:id/rated-history`

Paginated trip summaries. Filters by `TripReview.rating ≥ 4` for the agency.

**Query parameters**
- `destination?: string` — case-insensitive substring match on `ClientTrip.destinationSummary`
- `durationDays?: number` — exact match on `endDate - startDate + 1`
- `season?: 'spring' | 'summer' | 'fall' | 'winter'` — derived from `startDate` (northern hemisphere defaults; documented in service)
- `page?: number` (default 1), `pageSize?: number` (default 20, max 50)

**Response**
```ts
{
  trips: Array<{
    tripId: string;
    title: string;
    destinationSummary: string | null;
    dayCount: number;
    startDate: string | null;   // ISO
    endDate: string | null;
    rating: number;             // latest TripReview.rating (we use one review per trip)
    ratedAt: string;            // ISO
  }>;
  hasMore: boolean;
  nextPage: number | null;
}
```

### 5.2 `GET /agencies/:id/rated-history/:tripId`

Full itinerary structure to render in the expanded picker. Source itinerary selection: prefer `Itinerary.status = APPROVED_INTERNAL` (most recent if multiple); fall back to the most recent itinerary of any status if none approved.

**Response**
```ts
{
  trip: {
    tripId: string;
    title: string;
    destinationSummary: string | null;
    dayCount: number;
    startDate: string | null;
    endDate: string | null;
    rating: number;
  };
  itinerary: {
    itineraryId: string;
    title: string;
    summary: string | null;
    days: Array<{
      dayId: string;
      dayNumber: number;
      date: string | null;
      title: string;
      summary: string | null;
      items: Array<{
        itemId: string;
        sortOrder: number;
        type: ItineraryItemType;
        title: string;
        description: string | null;
        startTime: string | null;
        endTime: string | null;
        place: {
          name: string;
          formattedAddress: string | null;
          latitude: number | null;
          longitude: number | null;
        } | null;
        staffNotes: string | null;
        // clientNotes intentionally omitted (PII)
      }>;
    }>;
  };
}
```

### 5.3 `POST /trips/:tripId/itinerary/insert-from-rated`

Server-authoritative insertion. Validates same-agency on both source and target.

**Request**
```ts
{
  sourceTripId: string;
  selection:
    | { kind: 'item';    itemIds: string[] }     // one or more item IDs from same source day
    | { kind: 'day';     dayIds: string[] }       // one or more day IDs (each becomes a new day)
    | { kind: 'segment'; dayIds: string[] };      // consecutive days; preserves source order
  target: {
    itineraryId: string;
    dayIndex: number;       // 0-based; for kind='item', target day index in target itinerary
    position?: number;      // for kind='item': sortOrder slot within the target day
    // for kind='day' / 'segment': inserts new days at dayIndex (existing days shift)
  };
  ifMatchVersion: number;    // Itinerary.version for optimistic concurrency
}
```

**Selection validation rules** (server-side, fail with 400 on violation):
- `kind=item`: all `itemIds` must belong to the same source `ItineraryDay`.
- `kind=segment`: all `dayIds` must belong to the source itinerary and form a consecutive `dayNumber` range.
- `kind=day`: no ordering constraint; each day in `dayIds` is inserted as a new contiguous day starting at `target.dayIndex`.

**Response**: full updated itinerary (same shape as §5.2 `itinerary`).

**Status codes**
- `200` — success. If target trip has no `startDate`, response includes `missingStartDateAdvisory: true` (insertion proceeds; date fields on new days are null).
- `400` — malformed selection (e.g., mixed days in `kind=item`, non-consecutive `kind=segment`)
- `403` — source or target not in caller's agency
- `404` — source trip / itinerary / day / item not found
- `409` — `ifMatchVersion` mismatch; client refetches and retries
- `410` — source trip was deleted between list and insert

## 6. Data model

**No new Prisma models or columns.** All required data lives in existing schema: `TripReview`, `ClientTrip`, `Itinerary`, `ItineraryDay`, `ItineraryItem`, `PlaceSnapshot`.

### 6.1 Source itinerary selection rule

```
SELECT Itinerary
WHERE tripId = :sourceTripId
ORDER BY (status = 'APPROVED_INTERNAL') DESC, updatedAt DESC
LIMIT 1
```

Documented in `ratedHistory.service.ts`. If a rated trip has no itinerary, the trip is excluded from list results.

### 6.2 Copy semantics per item

| Field | On copy |
|---|---|
| `id`, `itineraryDayId` | Regenerated (new UUID) |
| `sortOrder` | Reassigned based on target slot |
| `type`, `title`, `description`, `startTime`, `endTime` | Preserved |
| `placeSnapshotId` | Reused (snapshot is canonical by `(provider, providerPlaceId)`; not re-fetched in v1) |
| `routeFromPrevious` | Cleared (geometry depended on the prior stop in the source trip) |
| `staffNotes` | Preserved |
| `clientNotes` | Cleared (PII) |

### 6.3 Copy semantics per day

| Field | On copy |
|---|---|
| `id` | Regenerated |
| `dayNumber` | Reassigned based on target position (and downstream days renumber) |
| `date` | Re-anchored: `targetItinerary.trip.startDate + (newDayNumber - 1)` days; null if target trip has no `startDate` |
| `title`, `summary` | Preserved |
| `items` | Each item copied per §6.2 |

### 6.4 Concurrency

`Itinerary.version` is incremented on insertion. Clients pass `ifMatchVersion`; mismatch → 409. Matches the existing optimistic-concurrency pattern used elsewhere on `Itinerary`.

## 7. UI surfaces

### 7.1 Picker panel structure

- Width: 440px on desktop (matches existing `ItineraryDraftPanel` width); full-width drawer on mobile.
- Header: title ("Rated history"), close button, filter chips (destination, duration, season), search input.
- Body (scrolling): `RatedTripList` — each row shows title · destination · day count · `MMM YYYY` trip month · ★N/5. Click expands to `RatedTripExpanded`.
- Expanded trip: vertical day list. Each day header has `⋮⋮` handle + "Select range" toggle. Each item row has `⋮⋮` handle.
- Empty state: "No rated trips yet. Once travelers rate trips ≥4★, those itineraries appear here for reuse."
- Footer: count of available trips, "Close" action.

### 7.2 Drag affordances

| Surface | Picker placement | Draft placement | Drag works? |
|---|---|---|---|
| Agent canvas page ([Voyage-Client/app/components/agent/itinerary/ItineraryCanvas.jsx](Voyage-Client/app/components/agent/itinerary/ItineraryCanvas.jsx)) | Slides in from right edge over the canvas | Canvas is page-style vertical stack; reflows left or scrolls under panel | Yes — drag from picker into canvas |
| Trip dashboard draft panel ([Voyage-Client/app/components/trip-dashboard/itinerary/ItineraryDraftPanel.jsx](Voyage-Client/app/components/trip-dashboard/itinerary/ItineraryDraftPanel.jsx)) | Docks to right edge | Draft panel docks to left edge; its own header-drag is suppressed while picker is open (shows "Pinned while picker open" hint) | Yes — drag from picker into docked panel; panel returns to floating position on close |
| Agent thread `/reuse` slash | Floating sheet anchored above composer | If canvas is visible in split-view: drag works as Agent canvas row | Yes if canvas visible; otherwise click-confirm |

Drop zones in the draft:
- Between two days → 4px `--accent-soft` highlight bar; insert as new day at that index
- Between two items in a day → 4px highlight; insert at that `sortOrder` slot
- On day header → highlight; append to end of that day (item drags only)
- Whole-day or segment drag suppresses item-row highlights; only between-day zones are valid

Drag interaction:
1. Mouse-down on `⋮⋮` → cursor `grabbing`, ghost at 4° rotation + soft shadow
2. Mouse-move → valid drop zones light up; invalid stay flat
3. Mouse-up on valid → drop animation, 1.2s `--accent-soft` highlight on inserted items, POST `/trips/:tripId/itinerary/insert-from-rated` fires
4. Mouse-up on invalid → ghost springs back

### 7.3 Entry points

- **Editor button**: `<ReuseButton>` in the itinerary editor toolbar. Label "Reuse from rated trips". Small badge shows count of available rated trips (or "0" when empty pool — button still visible but disabled with tooltip).
- **Client itinerary page button**: same `<ReuseButton>`, placed in the page actions row near other staff-only controls.
- **Agent thread slash**: `<ReuseSlashCommand>` intercepts the composer's textarea. `/` opens an autocomplete dropdown; selecting `reuse` opens the picker as a floating sheet above the composer. An optional comment field accompanies the slash for staff notes (saved as part of the system-visible recap).

### 7.4 Slash-command behavior

- Slash is parsed only at message start (or via autocomplete). Mid-message slashes (e.g., `"Use this plan /reuse"`) are NOT triggered and pass through as plain text to the agent.
- On confirm of selections in the picker, server applies insertion and posts a `SYSTEM_VISIBLE` agent message into the thread:
  > **Added to itinerary:** Day 3 from *Tokyo Family Spring 2025* (4 stops). Anchored to your trip as Day 5.
- The agent does NOT auto-respond. The recap is context the user can refer to in their next message. Keeps the orchestrator's one-tool-per-response contract intact and avoids paying for an extra agent run on every reuse.

## 8. Edge cases & error handling

| Case | Behavior |
|---|---|
| Empty pool (no rated trips for the agency) | Button visible but disabled with tooltip "No rated trips yet"; panel still openable, shows empty state copy |
| Source trip deleted between list-load and insert | Server `410 Gone`; client toast "That trip was removed — please pick another" and refreshes list |
| Source trip belongs to a different agency | Server `403`; should not happen via UI |
| Target trip has no `startDate` | Server allows insertion; `date` fields on new days are null; advisory field in response triggers toast "Trip has no start date — added days don't have dates yet" |
| Multi-day segment exceeds target trip's day count | Insertion proceeds (days append); `endDate` is NOT auto-extended; advisory toast "Trip now has N days — update end date if needed" |
| Concurrent edit on target itinerary | `409` on version mismatch; client refetches and prompts user to retry |
| Source itinerary has zero days (corrupt data) | Trip excluded from list results upstream; if reached directly via URL, `404` |
| `PlaceSnapshot` referenced by source item was soft-deleted | Reuse the snapshot row regardless (snapshots are not user-deletable in current schema); if hard-deleted, copy item with `placeSnapshotId = null` |
| Slash command typed mid-message | Treated as plain text; agent receives full message including the `/reuse` substring |

## 9. Testing

### 9.1 Unit (server)

- Source-itinerary selection rule: APPROVED_INTERNAL preferred; fallback when none; null when zero itineraries
- Date re-anchoring: targetStart + dayOffset; null targetStart → null dates
- Selection validation: `kind=item` requires same source day; `kind=segment` requires consecutive `dayNumber`s
- ID regeneration: new UUIDs for all copied days and items; no collisions
- PII strip on copy: `clientNotes` null in copied items; `staffNotes` retained
- `routeFromPrevious` cleared in all copies
- Role/agency gating: source and target both validated against caller's agency

### 9.2 Integration (server)

- `GET /agencies/:id/rated-history` — filter combinations, pagination, exclusion of trips without itineraries
- `GET /agencies/:id/rated-history/:tripId` — PII stripping confirmed; APPROVED_INTERNAL preferred
- `POST /trips/:tripId/itinerary/insert-from-rated` — happy path for each `kind`; 400 malformed; 403 cross-agency; 409 stale version; 410 deleted source; 422 no start date

### 9.3 Component (client)

- `RatedHistoryPicker` opens / closes / resets filters
- `RatedTripList` filter chips and search input
- `RatedTripExpanded` expand / collapse with day list
- Drag of: item, whole day, multi-day segment
- Drop zone highlighting: between-day, between-item, day-header; invalid zones do not highlight
- Drop animation + 1.2s highlight on inserted items
- Empty state copy and disabled-button tooltip when pool is empty
- Slash command interception in the composer; mid-message slash passes through

### 9.4 A11y

- Keyboard-only flow: focus moves into the panel on open; items reachable via Tab; "Move to…" menu opens a list of `Day N · position M` options; focus returns to trigger on close
- Drag has full keyboard fallback via the "Move to…" menu
- ARIA: picker is `role="dialog"` with `aria-modal="true"`; rows are `role="listitem"`; drag handles labeled `aria-label="Drag {item title}"`
- Screen-reader announcement on successful insert: "Added Day 3 from Tokyo Family Spring 2025 to your draft as Day 5"

## 10. Visual / motion notes

- Reuse the agency-dashboard design tokens. `--accent-soft` for highlight bars and inserted-item afterglow.
- Picker slide-in: 320ms `cubic-bezier(0.4, 0, 0.2, 1)` from the right edge.
- Drop zone fade-in: 120ms; fade-out: 80ms.
- Ghost rotation: 4°; soft shadow `0 16px 32px rgba(0,0,0,0.18)`.
- Inserted-item highlight: 1.2s ease-out fade from `--accent-soft` to transparent.
- Picker docking transition on the trip-dashboard surface: 240ms.

## 11. Open questions

1. **PlaceSnapshot freshness** — should we re-fetch snapshots older than 90 days on reuse? v1: no (reuse as-is). Decision deferred to a future freshness-policy spec.
2. **Picker memory** — should the picker remember the last-opened source trip across sessions? v1: no.
3. **Agent-assist on reuse** — when the user confirms a slash insertion, should the picker offer a checkbox "Ask agent to review and fill gaps"? v1: no — agent-side integration is the next spec.
4. **Bulk reuse from multiple source trips** — picker currently expands one trip at a time. Multi-trip cherry-picking before a single insertion? v1: one-trip-at-a-time; multi-source can land later if it proves needed.
5. **Reuse from non-approved itineraries** — if a rated trip's only itinerary is a `DRAFT` (rare but possible), should it still appear? v1: yes, with a small "Draft" badge in the list. Reconsider after first usage signals.

## 12. Deferred to follow-up specs

- **Calendar widget** (separate spec). Three-layer toggles: capacity, navigation, deadlines. Embedded on the dashboard page. Both roles see whole agency by default; staff has a "mine only" filter.
- **Agent RAG over rated history** (separate spec). New `search_rated_history` tool (returns whole itinerary), plus a lightweight auto-hint in the system prompt ("Your agency has N rated trips to {destination}"). Uses RAG/embeddings — likely pgvector on Postgres.
- Analytics: how often each item / day / segment is reused.
- Whole-trip-clone shortcut from the dashboard ("Start from a rated trip" card).
- Re-fetching PlaceSnapshot on reuse.
- Multi-source cherry-picking before insertion.
