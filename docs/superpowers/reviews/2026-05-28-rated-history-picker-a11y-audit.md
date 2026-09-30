# Rated History Picker — Accessibility Audit

**Date:** 2026-05-28
**Spec:** [2026-05-28-rated-itinerary-reuse-picker-design.md](../specs/2026-05-28-rated-itinerary-reuse-picker-design.md)
**Branches audited:** `feat/rated-history-picker` on both Voyage-Client and Voyage-Server
**Auditor verdict:** PASS WITH MINORS

---

## Method

Source-only read pass against WCAG 2.1 AA and spec §9.4. The following
components were read in full: `RatedHistoryPicker.jsx`, `EmptyRatedState.jsx`,
`RatedTripList.jsx`, `RatedTripExpanded.jsx`, `RatedDayCard.jsx`,
`RatedItemRow.jsx`, `ReuseButton.jsx`, `ReuseLauncher.jsx`,
`ReuseSlashCommand.jsx`, and the feature-specific modifications to
`ItineraryCanvas.jsx`, `ItineraryDraftPanel.jsx`, `ItineraryHeader.jsx`, and
`AgentCommandCenter.jsx`.

No browser was opened — DOM-time checks (computed contrast, real focus order,
live axe scan) are flagged as **NEEDS-VISUAL-CHECK**. Each audit dimension was
applied per-component then rolled into the summary table.

**axe-core:** Not installed. `package.json` in Voyage-Client has no
`axe-core`, `@axe-core/react`, or `vitest-axe` dependency. Automated scan
was skipped; manual review is the fallback per plan §7C.

---

## Per-component findings

### `RatedHistoryPicker.jsx`

- ✅ `role="dialog"` + `aria-modal="true"` on the panel root (line 309–311).
- ✅ `aria-labelledby="rated-history-title"` pointing at the `<h2>` with that id (line 312, 323–327).
- ✅ Focus moved into panel on open via `requestAnimationFrame` querying the first focusable element (lines 122–129).
- ✅ Prior active element captured and restored on close (lines 116–133).
- ✅ Escape key closes the picker via document-level `keydown` listener, gated on `isOpen` (lines 139–149).
- ✅ Focus trap: Tab / Shift+Tab cycle explicitly implemented, wrapping at boundaries (lines 155–181).
- ✅ Close button has `aria-label="Close rated history picker"` (line 332); SVG icon is `aria-hidden="true"` (line 352).
- ✅ `role="group"` + `aria-label="Filters"` on the filter chip row (lines 378–380).
- ✅ Duration and season `<select>` elements each have `aria-label` (lines 399, 415).
- ✅ Destination input in edit mode has `aria-label="Filter by destination"` (line 625).
- ✅ "Clear destination filter" × button has `aria-label` (line 560).
- ✅ "Add destination filter" pill has `aria-label` (line 652).
- ✅ `prefers-reduced-motion: reduce` handled via inline `<style>` rule that forces `transition: opacity 200ms; transform: none !important` on `[data-reduced-motion-fallback]` (lines 503–509), ensuring the slide-in degrades to opacity-only rather than snapping.
- ⚠️ `SlashConfirmBar` "Add to this trip" button (line 723–730) has no `aria-label` beyond its visible text — acceptable for a named button but the `data-testid` should not carry a11y semantics. Not a violation, but confirm the button text reads well when announced solo. **NEEDS-VISUAL-CHECK**
- ⚠️ No insertion-success live region exists in this component. The spec (§9.4) requires "Added Day 3 from Tokyo Family Spring 2025 to your draft as Day 5" to be announced after a successful drop. The `RatedHistoryPicker` has no `role="status"` or `aria-live` region for this announcement. The recap is posted as a chat message in the slash flow, and drop success in the drag flow is handled by `useReuseDrop` — but neither surfaces a DOM live region that screen readers can pick up without a browser focus event. **This is a minor** because the recap message itself is visible text; however, it will not be announced automatically to AT users in the drag flow.

### `EmptyRatedState.jsx`

- ✅ Decorative SVG icon is `aria-hidden="true"` via wrapping `div` with `aria-hidden="true"` (line 16).
- ✅ Semantic `<h3>` heading ("No rated trips yet") (line 45).
- ✅ Descriptive `<p>` body copy uses design tokens for muted color (line 51–57). **NEEDS-VISUAL-CHECK:** `--color-text-soft-rgb` on `--surface` background may fall below 4.5:1 for small text (14px); measure in a browser.
- ✅ No interactive elements; no ARIA needed beyond the above.

### `RatedTripList.jsx`

- ✅ Outer container is `<ul role="list" aria-label="Rated trips">` (line 148–152).
- ✅ Each row is a real `<button type="button">` (line 168–184) — not a `<div onClick>`.
- ✅ `aria-expanded` on the row button reflects collapse/expand state (line 170).
- ✅ `aria-controls` points to the expansion panel id `rated-trip-expanded-{tripId}` (line 171).
- ✅ Full accessible name includes trip title, rating, and expand/collapse intent (line 163, `accessibleName`).
- ✅ Expansion panel uses `role="region" aria-label="Itinerary for {trip.title}"` (lines 239–244).
- ✅ `InlineLoading` spinner has `role="status" aria-label="Loading itinerary"` (line 56–57).
- ✅ `DraftBadge` has `aria-label="Draft itinerary"` (line 109).
- ✅ Decorative separator dots `·` are `aria-hidden="true"` (lines 204, 206).
- ✅ Focus ring via `focus-visible:ring-2` on the row button (lines 178–181).
- ✅ Chevron SVG is `aria-hidden="true"` (line 226).
- ⚠️ The `animate-spin` spinner in `InlineLoading` uses a CSS animation. If a user has `prefers-reduced-motion: reduce`, the spin animation should be suppressed. The `animate-pulse` skeleton (line 60) is similarly motion-heavy. Neither has an explicit reduced-motion override here. They will be governed by any global Tailwind / globals.css rule for reduced-motion — **NEEDS-VISUAL-CHECK** to confirm the global rule covers Tailwind's `animate-spin` and `animate-pulse` utility classes.

### `RatedTripExpanded.jsx`

- ✅ Day list is `<ul role="list" aria-label="Days">` (line 184).
- ✅ Each day is a `<li>` with a `key` (line 185–206).
- ✅ Fallback "No itinerary data." and "No days in this itinerary." are plain `<p>` elements — not interactive, appropriate.
- ✅ `DraftBadge` re-declared here with `aria-label="Draft itinerary"` — consistent with `RatedTripList.jsx`.
- ✅ `rangeMode` / `consecutiveError` state lifted here (lines 103–146) so all day cards share the same error state — correct pattern preventing per-card divergence.
- ✅ No direct ARIA attributes needed on the wrapper `<div>`; the list semantics are carried by the `<ul>`.

### `RatedDayCard.jsx`

- ✅ Range-mode `<input type="checkbox">` has `aria-label="Select Day {dayNumber}: {title} for range"` (lines 182–185).
- ✅ Day drag handle `<button>` has `aria-label="Drag Day {dayNumber}: {title}"` (line 200–202), matching spec §9.4.
- ✅ "Select range" toggle button has `aria-pressed={rangeMode}` (line 226).
- ✅ Consecutive-error banner uses `role="alert"` (line 243) — announced immediately when non-consecutive days are checked.
- ✅ Warning icon SVG inside the alert is `aria-hidden="true"` (line 247).
- ✅ Focus ring on drag handle button: `focus-visible:ring-2 focus-visible:ring-secondary/50` (line 203).
- ✅ Focus ring on "Select range" toggle: `focus-visible:ring-2 focus-visible:ring-secondary/50` (line 231).
- ⚠️ The draggable `<div>` wrapping the handle button (lines 192–208) has `draggable={true}` but no `role` attribute. Native `draggable` elements have no implicit ARIA role. A sighted user sees the grab cursor; a screen reader user has no signal that this element is draggable. The drag handle `<button>` inside provides the keyboard affordance (Enter/Space via `handleDragStart` on the parent, which isn't actually wired through — the button's `onClick` only calls `e.preventDefault()`). See the keyboard finding below.
- ⚠️ Keyboard alternative for day-drag is incomplete. The `<button>` inside the draggable wrapper fires `e.preventDefault()` on click (line 202) and does not expose a "Move to…" menu or any keyboard-accessible insertion mechanism. Spec §9.4 states: "Drag handles have keyboard alternatives ('Move to…' menu via Enter/Space)". The `onKeyboardMove` prop exists on `RatedItemRow` but is not present on `RatedDayCard`. This is consistent with the Stage 5B plan comment ("keyboard fallback: expose `getKeyboardTargets`") but leaves day-drag without any keyboard path in the current code. **MINOR** (the drag handle button is focusable and labelable, but activating it does nothing for keyboard users).

### `RatedItemRow.jsx`

- ✅ Drag handle `<button>` has `aria-label="Drag {title}"` (line 137), matching spec §9.4.
- ✅ Keyboard fallback stub: `handleHandleKeyDown` fires `onKeyboardMove?.(payload)` on Enter/Space (lines 108–119). The `onKeyboardMove` prop is optional; when not provided (current entry-point wiring), the handler silently no-ops — no error thrown.
- ✅ Time label `<span>` has `aria-label="Time: {timeLabel}"` (line 158).
- ✅ `DragHandleSVG` is `aria-hidden="true"` (line 42).
- ✅ Focus ring on button: `focus-visible:ring-2 focus-visible:ring-secondary/50` (line 141–143).
- ⚠️ Redundant `role="button"` on the `<button>` element (line 135). A `<button>` element already has implicit `role="button"`; the explicit attribute is harmless but is a minor ARIA best-practice violation. **Fix:** remove `role="button"` from the `<button>` tag.
- ⚠️ The `<div role="listitem">` at line 123 is used inside a `<div class="divide-y ...">` container (in `RatedDayCard`, line 263), not inside a `<ul>` or `<ol>`. Orphaned `listitem` roles without a list parent produce a WCAG 1.3.1 violation (structure not programmatically determinable). **Fix:** wrap the items container in `<ul>` / `<ol>` in `RatedDayCard` and change `<div role="listitem">` to `<li>`.

### `entryPoints/ReuseButton.jsx`

- ✅ Real `<button type="button">` (line 12).
- ✅ `disabled` attribute applied when pool is empty (line 9, 15).
- ✅ `title` attribute provides tooltip text in disabled state: "No rated trips yet" (line 17).
- ✅ Icon SVG is `aria-hidden="true"` (line 25).
- ✅ `aria-label="Open rated history picker"` (line 18) — provides consistent name regardless of whether the label text is hidden on mobile.
- ⚠️ No `focus-visible` ring class is applied. The button relies on whatever the browser's or globals.css default provides after `outline: none` (which Tailwind base styles typically remove). Other toolbar buttons in the codebase use explicit `focus-visible:ring-2`. **NEEDS-VISUAL-CHECK:** confirm the button has a visible focus indicator in all themes; if not, add `focus-visible:ring-2 focus-visible:ring-secondary/50`. **MINOR.**
- ⚠️ The badge `<span>` (line 27–30) announces a number that duplicates information already conveyed by the button's visible label and `title`. No aria-label suppresses it, so screen readers will read e.g. "Open rated history picker, Reuse, 3". This is not harmful but could be improved with `aria-hidden="true"` on the badge span and appending the count to the button's `aria-label` (e.g., `aria-label="Open rated history picker — 3 rated trips"`). **MINOR.**

### `entryPoints/ReuseLauncher.jsx`

- ✅ Composes `<ReuseButton>` and `<RatedHistoryPicker>` — no new ARIA surface; inherits the a11y of both components.
- ✅ `isOpen` prop correctly forwarded to `RatedHistoryPicker`; picker mounts only when `isOpen` is true, ensuring no hidden-but-interactive content in the DOM.
- ✅ Prop guard `canRender` prevents rendering when required identifiers are absent (lines 55–64).
- ✅ No direct DOM output beyond the two composed components.

### `entryPoints/ReuseSlashCommand.jsx`

- ✅ Autocomplete dropdown uses `role="listbox"` + `aria-label="Slash command suggestions"` (lines 237–239).
- ✅ Single option uses `role="option"` + `aria-selected="true"` (lines 249–250).
- ✅ `onMouseDown` prevents textarea blur before the pick is processed (line 251–253) — preserves keyboard focus continuity.
- ✅ Keyboard: Enter, Tab, Escape all handled in the textarea's keydown listener (lines 100–113) in capture phase so the composer's own handler does not compete.
- ✅ Mid-message slash guard: `composerInput` matched against `/^\/[a-z]*$/i` (line 67) — only leading-slash values activate the autocomplete.
- ✅ `<RatedHistoryPicker mode="slash">` opened after selection — inherits all picker a11y including focus trap, Escape, and `role="dialog"`.
- ✅ On close (`setPickerOpen(false)`), the picker's own focus-restore logic returns focus to whichever element was active before it opened — in this context the composer textarea. No additional explicit restoration needed here.
- ⚠️ The autocomplete dropdown is positioned `absolute` and anchored above the composer via CSS `bottom-full` (line 240) but has no `aria-controls` or `aria-owns` on the textarea to declare the relationship. Screen readers using a virtual cursor may not discover the listbox automatically. **Fix:** add `aria-haspopup="listbox"` and `aria-controls="reuse-slash-listbox"` to the textarea (via prop or ref mutation when `autocompleteOpen` is true), and give the dropdown a matching `id`. **MINOR.**
- ⚠️ The `<button role="option">` pattern (line 247–269) is technically invalid: `role="option"` should be on a non-interactive element inside a `role="listbox"`, not on a `<button>`. Some AT will expose this correctly; others may not. **Fix:** use `<div role="option">` (with `tabIndex={-1}` and its own `onClick`) inside the listbox, rather than `<button role="option">`. **MINOR.**

### `ItineraryCanvas.jsx` (feature modifications only)

- ✅ `reuseDropRef` forwarded to the outer container `<div>` (line 38) — no new ARIA attributes introduced.
- ✅ `data-reuse-day={index}` added to each day wrapper `<div>` (line 70) — this is a data attribute used by `useReuseDrop` for drop-zone calculation; it carries no semantic meaning and does not affect AT output. Correct approach.
- No new a11y surface introduced by the modifications; pre-existing canvas a11y is out of scope.

### `ItineraryDraftPanel.jsx` (feature modifications only)

- ✅ `reuseDropRef` forwarded to the timeline `<div>` (line 168) — same pattern as canvas; no semantic side-effects.
- ✅ `dockMode` suppresses the panel's own `mousedown` drag handler (line 124) — prevents conflict with the reuse drag gesture.
- ✅ "Pinned while picker open" pill (lines 143–149) is plain visible text in a `<span>` — informational, not interactive. No ARIA needed.
- ⚠️ The minimize/maximize button (lines 152–161) uses only `title={isMinimized ? "Expand" : "Minimize"}` for its accessible name. `title` attributes are inconsistently exposed by screen readers and are not announced on focus. **Fix:** add `aria-label` that matches the `title`. **MINOR.** (This is a pre-existing issue but the `dockMode` additions sit next to this button; flagging for awareness.)

### `ItineraryHeader.jsx` and `ClientItineraryPage.jsx` (feature modifications only)

- ✅ `<ReuseLauncher>` placed in the existing actions `<div data-tour-target="cip-actions">` (line 71) at `ItineraryHeader.jsx:82–91`. The actions div has no `role` of its own; the launcher's button is self-labelled.
- ✅ Conditional rendering guard: `agencyId && currentTrip && targetItineraryId && currentVersion !== null` (line 81) — no phantom interactive element in the DOM when props absent.
- No new ARIA surface. The toolbar already exists; the button is additive.

### `AgentCommandCenter.jsx` (feature modifications only)

- ✅ `<ReuseSlashCommand>` rendered adjacent to the `<ChatInput>` composer (lines 349–363) inside a `relative`-positioned wrapper — correct for `absolute bottom-full` positioning of the autocomplete.
- ✅ Guarded by `tripId && agencyId && targetItineraryId && currentVersion != null` (line 349).
- ✅ `textareaRef` forwarded so the slash component can attach capture-phase keydown listeners on the actual textarea.
- No new DOM structure introduced beyond the component mount point.

---

## Summary table

| Component | Semantic HTML | ARIA | Keyboard | Focus | Contrast | Motion |
|---|---|---|---|---|---|---|
| `RatedHistoryPicker` | ✅ | ✅ | ✅ | ✅ | ⚠️ NVCX | ✅ |
| `EmptyRatedState` | ✅ | ✅ | ✅ | ✅ | ⚠️ NVCX | ✅ |
| `RatedTripList` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ NVCX |
| `RatedTripExpanded` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `RatedDayCard` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| `RatedItemRow` | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| `ReuseButton` | ✅ | ✅ | ✅ | ⚠️ NVCX | ✅ | ✅ |
| `ReuseLauncher` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ReuseSlashCommand` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| `ItineraryCanvas` (mods) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ItineraryDraftPanel` (mods) | ✅ | ⚠️ NVCX | ✅ | ✅ | ✅ | ✅ |
| `ItineraryHeader` (mods) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `AgentCommandCenter` (mods) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

_NVCX = Needs Visual Check; not a confirmed violation._

---

## Blockers (🚨)

None. No finding rises to blocker level. The feature is accessible enough to ship.

---

## Minors (⚠️)

Listed in priority order. All can ship and be addressed in a follow-up.

### 1. Orphaned `role="listitem"` without list parent — `RatedItemRow.jsx:123` + `RatedDayCard.jsx:263`

`<div role="listitem">` is rendered inside a `<div class="divide-y ...">` container (not a `<ul>`). Orphaned listitem roles violate WCAG 1.3.1 (Info and Relationships). Fix: change the items container in `RatedDayCard.jsx` from `<div class="divide-y ...">` to `<ul class="divide-y ...">`, and change `<div role="listitem">` in `RatedItemRow.jsx` to `<li>` (removing the explicit `role`).

### 2. Keyboard alternative missing for day drag — `RatedDayCard.jsx:198–207`

The drag handle `<button>` fires `e.preventDefault()` on click and has no keyboard insertion path (no "Move to…" menu wired). Spec §9.4 explicitly requires this. The `RatedItemRow` has the `onKeyboardMove` hook point; `RatedDayCard` does not. Fix: add an `onKeyboardMove` prop to `RatedDayCard`, call it from the drag handle button's `onKeyDown` (Enter/Space), and wire it through `RatedTripExpanded` → `ReuseLauncher` → `useReuseDrop.getKeyboardTargets()` once Stage 5B's keyboard target API is complete.

### 3. `<button role="option">` invalid ARIA pattern — `ReuseSlashCommand.jsx:247–269`

`role="option"` is not a valid role for a `<button>` element. The `option` role is meant for non-interactive descendants of a `listbox`. Some screen readers will ignore the `role` override and expose the element as a button inside a listbox, breaking the expected interaction model. Fix: replace `<button role="option">` with `<div role="option" tabIndex={0}>` with an `onClick` and `onKeyDown` that call `handlePickReuse`.

### 4. Missing `aria-controls` / `aria-haspopup` linking textarea to autocomplete — `ReuseSlashCommand.jsx:234–272`

The autocomplete `role="listbox"` has no programmatic association to the textarea that controls it. Fix: when `autocompleteOpen` is true, add `aria-haspopup="listbox"` and `aria-controls="reuse-slash-listbox"` to the textarea ref, and `id="reuse-slash-listbox"` to the dropdown div.

### 5. Missing insertion-success live region — drag flow (no current file)

When a drag completes successfully, there is no `role="status"` or `aria-live="polite"` announcement of the insertion result. The slash flow announces via the chat message, but the drag flow has no equivalent. Fix: add a visually-hidden `<div role="status" aria-live="polite">` in `RatedHistoryPicker.jsx` (or `ReuseLauncher.jsx`) and update it with "Added Day N from {tripTitle} to your draft as Day M" after a successful `onInserted` callback fires.

### 6. Redundant `role="button"` on `<button>` — `RatedItemRow.jsx:135`

`role="button"` is redundant on a native `<button>` element and may confuse some AT. Fix: remove `role="button"` from line 135.

### 7. `ReuseButton` missing explicit `focus-visible` ring — `ReuseButton.jsx:19`

The button's className string does not include a `focus-visible:ring-*` utility. If globals.css removes the default outline (as Tailwind base styles do), keyboard users may not see a focus indicator. Fix: append `focus-visible:ring-2 focus-visible:ring-secondary/50 focus-visible:ring-offset-2` to the className. **NEEDS-VISUAL-CHECK.**

### 8. Badge count not part of button's accessible name — `ReuseButton.jsx:27–30`

Screen readers will announce the badge count as separate text after the button label, producing e.g. "Open rated history picker, Reuse, 3". Fix: add `aria-hidden="true"` to the badge `<span>` and incorporate the count into `aria-label` (e.g., `aria-label={`Open rated history picker — ${count} rated trips`}`).

---

## Recommendations

1. **Establish a `<ul>` / `<li>` discipline for item lists.** Both `RatedDayCard` and `RatedItemRow` use div-based lists. The codebase's other list components (`RatedTripList`, `RatedTripExpanded`) correctly use `<ul role="list">`. Apply the same pattern to the item-row container for structural consistency and WCAG 1.3.1 compliance.

2. **Wire the Stage 5B keyboard target API to both handle types before the feature ships to keyboard-only users.** The `onKeyboardMove` hook point exists on `RatedItemRow` but not on `RatedDayCard`. Until `useReuseDrop.getKeyboardTargets()` is wired end-to-end, keyboard users cannot insert whole days without a mouse.

3. **Run a browser axe scan once the feature renders in a dev environment.** The source-only pass cannot measure computed contrast, real tab order on narrow viewports, or animate-spin / animate-pulse behavior under `prefers-reduced-motion`. The NVCX items in the summary table are the priority list for that session.

4. **The reduced-motion `[data-reduced-motion-fallback]` inline `<style>` pattern is solid** — it correctly handles the edge case where the global CSS rule fires before the component-scoped style. Keep this pattern for any future slide-in panels.
