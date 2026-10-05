# Share Link: Map Theme, Design Alignment and Mobile PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public share link (`/itinerary/view/[token]`) follow light/dark mode on its map, look like the current in-app design, and download its PDF on mobile web and installed PWAs. The in-app itinerary PDF gets the same download fix. The in-app Itineraries tab loses its empty top bar, gets one roomier header, and follows the dashboard's type rule.

**Architecture:** The map reads the app theme from `ThemeProvider` when a page doesn't pass one, and keeps the one cloud map ID in both themes. PDF export splits into three parts. `lib/pdfDelivery.js` picks how a device should receive a file: share sheet, download link, or new tab. `hooks/useItineraryPdf.js` builds the PDF before the tap, so the click handler can hand the file over synchronously. The share page and the in-app page both use that hook. The share page's header, stop cards, mobile switcher, map frame and colours move onto existing app pieces: `VoyageLogo`, `SegmentedControl`, the `--frame-*` glass tokens, the `ItineraryDayView` card look, and the contrast-safe colour tokens. On the Itineraries tab, the app bar uses the Dashboard tab's compact variant, and the workspace header absorbs the separate Approve row. Headings follow the dashboard's type rule (serif only for a page's main title), and a source guard keeps it that way.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Tailwind v4 (`@theme` tokens in `app/globals.css`), `@vis.gl/react-google-maps` 1.8.3, jsPDF 4.2.1, Vitest 4 + Testing Library (jsdom).

**Repo / branch:** All code changes are in `Voyage-Client`, on `fix/share-link-theme-pdf` (branched from `staging`). This plan file lives in `Voyage-Server/docs/superpowers/plans/` on the same-named branch, next to the other recent plans.

---

## Investigation findings (2026-10-05)

Checked in the built-in browser against the running dev servers. The share page was fed mock itinerary data (no real share token was used), at 1280×800 and 375×812 (mobile emulation), in light and dark.

### 1. The map ignores dark mode on the share link (confirmed)

- `app/itinerary/view/[token]/page.jsx:934` renders `<ItineraryLiveMap …>` without a `theme` prop, so it defaults to `theme = "light"` (`ItineraryLiveMap.jsx:375`). Toggling dark mode turned the page dark, but the map stayed light (screenshot evidence).
- `ItineraryDraftPanel.jsx` and the desktop `ClientItineraryPage` path have the same gap. `HomePage`, `ItineraryDayView` and the mobile `ClientItineraryPage` pass `theme` explicitly.
- The dark branch swaps in `mapId="dark_map_id_placeholder"` (`ItineraryLiveMap.jsx:468`). That isn't a real map ID, so any cloud styling on the real ID can't apply in dark mode. Probe maps created in the page showed that the app's real `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` with `colorScheme: "DARK"` renders a proper dark map. So the fix is one map ID for both themes, with only the colour scheme changing.
- `@vis.gl/react-google-maps` 1.8.3 recreates the map when `colorScheme` or `mapId` changes (cache key `mapId:renderingType:colorScheme`), so switching themes at runtime works once the prop flows.

### 2. The PDF download fails on mobile and in PWAs (cause narrowed; real-device confirmation pending)

- On mobile emulation the button is tappable: `elementFromPoint` at its centre is the button. The tap runs `handleDownloadPdf`, and jsPDF generated `kyoto-autumn-escape-itinerary.pdf`. So "not clickable" means "nothing happens", not a covered button.
- The delivery mechanism is the problem. `doc.save()` (jsPDF's bundled FileSaver) creates a detached `<a download href="blob:…">` and fires a synthetic click from `setTimeout(…, 0)` after an `await`. iOS home-screen web apps don't support that kind of download, Safari only honours it inside the tap's activation, and in-app browsers (Messenger, Instagram, Gmail) don't support blob downloads at all. Desktop and Android Chrome generally work.
- `handleDownloadPdf` swallows failures (`console.error` only), so users get no feedback.
- `ClientItineraryPage.jsx:359-377` (the in-app staff PDF, used from the installed PWA) has the same `doc.save()` path.
- **Not verified on a real device:** there is no WebKit or phone here. The device checks in Task 12 close this gap.

### 3. The share page doesn't match the current design (confirmed)

| Finding | Where | Current app pattern |
|---|---|---|
| Trip title wraps to 3 lines ("Kyoto / Autumn / Escape"): the global `h1 { max-width: 12ch }` (`globals.css:317-320`) caps it at ~168px in a ~505px column | `page.jsx:678` | headings sized per component |
| Stop titles are faux-bold: `h3` inherits DM Serif Display (400 only), and `font-semibold` makes the browser synthesise bold (computed `font-synthesis: weight`) | `page.jsx:808` | dashboard card titles: Plus Jakarta Sans semibold (`font-sans font-semibold`); serif only for a page's main title (Design decision 6) |
| Solid navy `bg-sidebar text-white` header with a serif text wordmark | `page.jsx:641-645` | glass frame (`--frame-panel`, `--frame-border`) + `VoyageLogo` ("Hops") |
| Full-strength `border-border` (100% navy in light mode) on dividers, buttons and the timeline | many | hairlines `border-border/10`–`/20` |
| White text on light terracotta (`bg-secondary text-white`, ~2.8:1) on the day pill, Continue, Send and Submit rating | `page.jsx:187,264,730`, `ProposalRating.jsx:315` | `bg-secondary-strong text-on-secondary-strong` |
| Raw hex/rgba colours (`#c46a51`, `#2a7a4f`, `#16a34a`, `rgba(215,122,97,…)`, `red-500`); `ProposalRating` falls back to `#9ca3af` through `var(--text-muted)`, which doesn't exist | `page.jsx` (14 lines), `ProposalRating.jsx:59,103` | `status-*`, `secondary-strong`, `text-soft` tokens |
| Timeline list with dots, unlike the in-app stop cards (time pill, place type, photo, rating) | `page.jsx:776-871` | `ItineraryDayView.jsx:106-172` card |
| Hand-rolled underline tabs for Itinerary/Map on mobile | `page.jsx:648-663` | `components/admin/SegmentedControl.jsx` |
| Edge-to-edge map with a hard left border | `page.jsx:931-945` | `ItineraryDayView.jsx:181-196`: inset, rounded, hairline, `shadow-soft` |
| The shared PDF says "VOYAGE" even when the page shows the agency's brand | `page.jsx:587` | agency-branded share/PDF |

### 4. The in-app Itineraries tab wastes its top bar and fakes bold titles (confirmed)

From the user's dark-mode screenshot of the Itineraries tab, checked against the code:

| Finding | Where | Fix |
|---|---|---|
| The 84px top bar is empty. The Itineraries tab gets the `full` bar, but `showCenterActions` is false there, so the bar holds only the agent's "Ready" pill. No agent runs on this tab. | `HomePage.jsx:678`, `DashboardHeader.jsx:47` | the compact variant, as on the Dashboard tab (Task 9) |
| The workspace header is crowded. The name is cut to "Dana…", the "Saved itineraries" badge wraps to two lines, and "New trip for Da…" truncates. The status shows twice: an uppercase badge, plus a separate "Status: In review" row that only holds Approve. | `ItineraryHeader.jsx:49-139`, `ClientItineraryPage.jsx:739-765` | one header with Approve inside it (Task 10) |
| The day title fakes bold: the `h4` inherits DM Serif Display and asks for `font-extrabold` | `ItineraryDayView.jsx:80` | Plus Jakarta Sans semibold (Task 11) |
| Stop titles and the "Client Directory" heading are serif, while the dashboard uses sans | `ItineraryDayView.jsx:141`, `ClientList.jsx:35` | sans semibold (Task 11) |
| The same fake bold elsewhere: photo-placeholder initials, the share dialog's section heading, the trip slide-over and funnel stage titles | `ItineraryDayView.jsx:136`, `CompactPlaceCard.jsx:39`, `ShareDialog.jsx:182`, `TripSlideOver.jsx:571`, `FunnelStageDetailPanel.jsx:137` | sans semibold (Task 11) |
| "1 saved itineraries" | `ClientList.jsx:92`, `ClientItineraryPage.jsx:472` | singular/plural helper (Task 10) |

## Design decisions (1–5 lead developer; 6–8 confirmed with the user on 2026-10-05)

1. **Reference = the in-app itinerary view + dashboard glass frame**, not a new visual direction. The page reuses `VoyageLogo`, `SegmentedControl`, `--frame-*`, the `ItineraryDayView` card anatomy, and the contrast-safe tokens.
2. **The agency brand leads.** The page is client-facing, so the agency name/logo stays the header's main element. The Voyage logo appears only as the no-brand fallback and in "Powered by".
3. **All days stay on one scrolling page** (no in-app day strip). A client reads the whole proposal top to bottom and comments inline; a day picker would hide the other days' comments.
4. **The PDF on iPhone/iPad opens the share sheet** ("Save to Files", "Print", "Books"…). That is the only path that works both in Safari and from the home-screen app. Android and desktop keep a normal download. If the device refuses, an "Open the PDF" link appears.
5. **The shared PDF carries the agency's brand name** when the share has one, matching the page header.
6. **Type follows the dashboard (the user picked option A from mockups).**
   - DM Serif Display, at its only weight (400), is reserved for a page's main title: the client name in the Itineraries workspace, the trip title on the share page, dialog titles, and the empty-state title shown when nothing is selected.
   - Every other heading uses Plus Jakarta Sans semibold (`font-sans font-semibold tracking-normal`): 15px for panel, section and card titles, 22px for day titles.
   - Nothing asks the serif for a bold weight again.
7. **The Itineraries tab has no top bar on desktop, like the Dashboard tab (the user picked option A).** Its bar held only the agent's "Ready" pill. Phones keep the 48px bar with the menu button and the logo.
8. **The workspace header is the page header (the user approved the mockup).**
   - Line 1 is the client name in the serif, at 28px.
   - Line 2 holds a status dot with its label, the saved count ("1 saved itinerary"), and a "New trip" text button.
   - On the right: Reuse, Comments, Share and PDF, then Approve. Approve is the only filled button and shows only while the trip is in review.
   - The "Saved itineraries" badge, the uppercase status badge and the separate "Status: In review" row are removed.
   - When the header is under 720px wide, the actions drop their labels (container query) and keep icons, tooltips and aria-labels.
   - Open Comments uses `bg-secondary-strong text-on-secondary-strong`.

## Execution and model routing (lead-developer-orchestrator)

**Mode:** subagent-driven, one fresh implementer per task, spec-compliance review then code-quality review before moving on.

| Task | Depends on | Can run in parallel with | Implementer model | Why |
|---|---|---|---|---|
| 1 Map follows theme | — | 2 | sonnet | small, well-specified, 1 file |
| 2 `pdfDelivery.js` | — | 1 | sonnet | platform logic, fully specified with tests |
| 3 `useItineraryPdf` hook | 2 | — | sonnet | async state, specified |
| 4 Share page PDF button | 3 | 5 | sonnet | edits `page.jsx` |
| 5 In-app PDF wiring | 3 | 4 | sonnet | edits `ClientItineraryPage.jsx` only |
| 6 Share header + Powered by | 4 | — | sonnet + frontend skills | edits `page.jsx` |
| 7 Stop cards, switcher, map frame, title | 6 | — | sonnet + frontend skills | edits `page.jsx` |
| 8 Colour tokens + guard | 7 | — | haiku | mechanical find/replace with a guard test |
| 9 Itineraries tab hides the empty bar | — | 1–8 | haiku | one helper and two small edits, test given |
| 10 Itineraries workspace header | 5 | 9 | sonnet + frontend skills | 5 source files, layout and behaviour |
| 11 Heading type rule + guard | 8, 10 | 9 | haiku (escalate to sonnet if the guard lists a file outside its table) | class swaps driven by a guard test |
| 12 Verify, review, QA | all | — | opus (review) + lead (QA) | whole-change review |

Tasks 4, 6, 7, 8 and 11 all edit `app/itinerary/view/[token]/page.jsx`. Tasks 5, 10 and 11 all edit `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`. Run each group strictly in order and never in parallel. Line numbers in Tasks 10 and 11 are from `staging`; earlier tasks shift them, so find each edit by its quoted text.

**Frontend skills for Tasks 6–8, 10 and 11:** the implementer must use `ui-ux-pro-max`, `frontend-design` and `emil-design-eng` (per lead-developer-orchestrator), but within the decisions above. These tasks align the pages with the existing design; they don't invent a new one.

**Known baseline (not regressions):** 8 client test files fail on `staging`. 7 can't load because `app/components/icons/index.js` has JSX in a `.js` file (e.g. `tests/client-itinerary-page.test.jsx`), and `agent-command-center-places` has 1 stale test. Any test that renders a component importing `icons/index.js` must `vi.mock` that module, as the existing share-page tests do. A Proxy-based icon mock needs a `has` trap as well as `get`: vitest checks `name in module` before it reads an export. (The Proxy in `tests/accessibility-integrations.test.jsx` lacks it and only passes because that suite never renders an icon.)

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx` | modify | `getMapAppearance(theme)`; fall back to `useTheme()` when no `theme` prop |
| `app/lib/pdfDelivery.js` | create | choose and run the hand-off (share sheet / download link / new tab); env injected for tests |
| `app/hooks/useItineraryPdf.js` | create | build the PDF `File` ahead of the tap; synchronous `download()`; fallback link URL |
| `app/itinerary/view/[token]/components/PdfDownloadButton.jsx` | create | share-page PDF button, preparing/error states, fallback link |
| `app/itinerary/view/[token]/components/ShareHeader.jsx` | create | glass header with agency/personal/Voyage brand (sans brand name); `PoweredByVoyage` footer |
| `app/itinerary/view/[token]/components/ShareStopCard.jsx` | create | in-app-style stop card for the share page (sans title) |
| `app/itinerary/view/[token]/page.jsx` | modify | use the pieces above; title/day/map-frame layout; sans day and section titles; colour tokens |
| `app/itinerary/view/[token]/components/ProposalRating.jsx` | modify | colour tokens; sans heading |
| `app/components/trip-dashboard/pages/ClientItineraryPage.jsx` | modify | in-app PDF via `useItineraryPdf`; Approve handler passed to the header; status row removed; count wording; sans mobile heading |
| `app/components/trip-dashboard/layout/DashboardHeader.jsx` | modify | `headerVariantForTab(tab)`: compact for the Dashboard and Itineraries tabs |
| `app/components/trip-dashboard/HomePage.jsx` | modify | picks the bar with `headerVariantForTab`; drops the itineraries-only switcher filter |
| `app/components/trip-dashboard/pages/ItineraryHeader.jsx` | modify | name line, status/count/New trip line, actions + Approve, container-query labels |
| `app/components/ratedHistory/entryPoints/ReuseButton.jsx` | modify | label follows the header's width in `clientItinerary` mode |
| `app/lib/trip-dashboard/savedItineraries.js` | modify | `formatSavedItineraryCount(count)` |
| `app/components/trip-dashboard/pages/ClientList.jsx` | modify | count wording; sans panel heading |
| `app/components/trip-dashboard/pages/ItineraryDayView.jsx` | modify | sans day and stop titles; placeholder initial |
| `app/components/trip-dashboard/mobile/CompactPlaceCard.jsx` | modify | placeholder initial |
| `app/components/trip-dashboard/itinerary/ShareDialog.jsx` | modify | sans section heading |
| `app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx` | modify | sans title |
| `app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx` | modify | sans title |
| `tests/itinerary-live-map-theme.test.jsx` | create | map theme tests |
| `tests/pdf-delivery.test.js` | create | delivery strategy tests |
| `tests/use-itinerary-pdf.test.jsx` | create | hook tests |
| `tests/share-page-pdf.test.jsx` | create | share page PDF behaviour |
| `tests/client-itinerary-pdf.test.jsx` | create | in-app PDF behaviour |
| `tests/share-header.test.jsx` | create | header/brand/footer |
| `tests/share-stop-card.test.jsx` | create | stop card |
| `tests/share-page-layout.test.jsx` | create | title cap, mobile switcher |
| `tests/share-page-design-tokens.test.js` | create | colour guard for the share route folder |
| `tests/share-page-weather.test.jsx`, `tests/share-page-accessibility.test.jsx` | modify | PDF mock returns a fake doc |
| `tests/dashboard-rail.test.jsx` | modify | bar variant per tab |
| `tests/saved-itinerary-count.test.js` | create | count wording |
| `tests/client-list.test.jsx` | create | count wording in the client list |
| `tests/itinerary-header.test.jsx` | create | header layout, status dot, Approve, Comments state, label collapse |
| `tests/reuseButton.smoke.test.jsx` | modify | label rule per mode |
| `tests/client-itinerary-approve.test.jsx` | modify | Approve lives in the header |
| `tests/heading-typography.test.js` | create | no bold serif; per-heading font table |

All commands below run from `Voyage-Client/`.

---

### Task 0: Branch

`fix/share-link-theme-pdf` was created from `staging` on 2026-10-05 in both repos. Voyage-Server holds this plan. Voyage-Client holds one unrelated commit already: "Needs you today" collapses to one line when empty.

- [ ] **Step 1: Switch to the branch in Voyage-Client**

```bash
git switch fix/share-link-theme-pdf
```

Expected: `Switched to branch 'fix/share-link-theme-pdf'` and a clean `git status`.

---

### Task 1: The map follows the app theme

**Files:**
- Modify: `app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx` (imports at 3-10, `EMPTY_MAP_CENTER` at 27, props at 365-378, `isDark` at 383, map props at 468-469)
- Test: `tests/itinerary-live-map-theme.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/itinerary-live-map-theme.test.jsx`:

```jsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const captured = vi.hoisted(() => ({ mapProps: [] }));

// Record the props the real <Map> would get; nothing inside it renders in jsdom.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }) => children,
  Map: (props) => {
    captured.mapProps.push(props);
    return null;
  },
  AdvancedMarker: () => null,
  Pin: () => null,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

import ThemeProvider from "../app/components/theme/ThemeProvider.jsx";
import ItineraryLiveMap, { getMapAppearance } from "../app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  captured.mapProps.length = 0;
});

describe("map appearance", () => {
  it("keeps the cloud map ID in dark mode and only switches the colour scheme", () => {
    const light = getMapAppearance("light");
    const dark = getMapAppearance("dark");

    expect(dark.mapId).toBe(light.mapId);
    expect(dark.mapId).not.toMatch(/placeholder/);
    expect(light).toMatchObject({ isDark: false, colorScheme: "LIGHT" });
    expect(dark).toMatchObject({ isDark: true, colorScheme: "DARK" });
  });

  it("follows the app theme when the page passes no theme (public share link)", async () => {
    localStorage.setItem("voyage-theme", "dark");

    render(
      <ThemeProvider>
        <ItineraryLiveMap items={[]} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(captured.mapProps.at(-1)?.colorScheme).toBe("DARK"));
    expect(captured.mapProps.at(-1).mapId).toBe(getMapAppearance("dark").mapId);
  });

  it("lets an explicit theme prop win over the app theme", async () => {
    localStorage.setItem("voyage-theme", "dark");

    render(
      <ThemeProvider>
        <ItineraryLiveMap items={[]} theme="light" />
      </ThemeProvider>,
    );

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(captured.mapProps.at(-1).colorScheme).toBe("LIGHT");
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/itinerary-live-map-theme.test.jsx --pool=threads`
Expected: FAIL. The first test fails with `getMapAppearance is not a function`. The second times out waiting for `"DARK"`, because the last `colorScheme` is `"LIGHT"`.

- [ ] **Step 3: Implement**

In `ItineraryLiveMap.jsx`, add the theme import after the `react` import (line 3):

```js
import { useTheme } from "../../theme/ThemeProvider.jsx";
```

Add this helper directly after `const EMPTY_MAP_CENTER = { lat: 0, lng: 0 };`:

```js
/**
 * One cloud map ID for both themes; only the colour scheme changes. Dark mode
 * used to swap in a placeholder map ID, which dropped the cloud styling.
 */
export function getMapAppearance(theme) {
  const isDark = theme === "dark";
  return { isDark, mapId: MAP_ID, colorScheme: isDark ? "DARK" : "LIGHT" };
}
```

In the component signature, replace `  theme = "light",` with:

```js
  theme: themeProp,
```

Replace `  const isDark = theme === "dark";` with:

```js
  // Pages that pass no theme (the public share link) follow the app theme.
  const { theme: appTheme } = useTheme();
  const { isDark, mapId, colorScheme } = getMapAppearance(themeProp ?? appTheme);
```

In the `<GoogleMap>` props, replace:

```jsx
          mapId={isDark ? "dark_map_id_placeholder" : MAP_ID}
          colorScheme={isDark ? "DARK" : "LIGHT"}
```

with:

```jsx
          mapId={mapId}
          colorScheme={colorScheme}
```

- [ ] **Step 4: Run the new and existing map tests**

Run: `npx vitest run tests/itinerary-live-map-theme.test.jsx tests/itinerary-live-map.test.jsx --pool=threads`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx tests/itinerary-live-map-theme.test.jsx
git commit -m "fix(map): follow the app theme when a page passes none and keep the cloud map ID in dark mode"
```

---

### Task 2: Pick the right PDF hand-off for the device

**Files:**
- Create: `app/lib/pdfDelivery.js`
- Test: `tests/pdf-delivery.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/pdf-delivery.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { choosePdfDelivery, deliverPdf, isAppleMobile } from "../app/lib/pdfDelivery.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const file = new File(["%PDF-1.7"], "kyoto-itinerary.pdf", { type: "application/pdf" });

function fakeEnv({
  userAgent = MAC_SAFARI,
  platform = "MacIntel",
  maxTouchPoints = 0,
  share,
  canShare,
  anchorSupportsDownload = true,
  openResult = {},
} = {}) {
  const link = { click: vi.fn(), remove: vi.fn(), style: {} };
  if (anchorSupportsDownload) link.download = "";
  const env = {
    navigator: { userAgent, platform, maxTouchPoints, share, canShare },
    document: { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } },
    window: { open: vi.fn(() => openResult), setTimeout: vi.fn() },
    URL: { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() },
  };
  return { env, link };
}

const shareable = () => ({ share: vi.fn(async () => {}), canShare: vi.fn(() => true) });

describe("isAppleMobile", () => {
  it("recognises iPhone and iPadOS (which reports a desktop Mac user agent)", () => {
    expect(isAppleMobile({ userAgent: IPHONE })).toBe(true);
    expect(isAppleMobile({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("choosePdfDelivery", () => {
  it("uses the share sheet on iPhone/iPad, the only path that also works from the home-screen app", () => {
    const { env } = fakeEnv({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, ...shareable() });
    expect(choosePdfDelivery(env, file)).toBe("share");
  });

  it("opens the PDF in a tab on iOS without file sharing (iOS 14 and older, in-app browsers)", () => {
    const { env } = fakeEnv({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 });
    expect(choosePdfDelivery(env, file)).toBe("open");
  });

  it("downloads on Android and desktop, even where sharing is available", () => {
    expect(choosePdfDelivery(fakeEnv({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5, ...shareable() }).env, file)).toBe("download");
    expect(choosePdfDelivery(fakeEnv().env, file)).toBe("download");
  });

  it("falls back to sharing, then to a tab, when links cannot download", () => {
    expect(choosePdfDelivery(fakeEnv({ anchorSupportsDownload: false, ...shareable() }).env, file)).toBe("share");
    expect(choosePdfDelivery(fakeEnv({ anchorSupportsDownload: false }).env, file)).toBe("open");
  });

  it("treats a canShare that throws as no sharing", () => {
    const { env } = fakeEnv({
      userAgent: IPHONE,
      platform: "iPhone",
      maxTouchPoints: 5,
      share: vi.fn(),
      canShare: vi.fn(() => {
        throw new TypeError("files not supported");
      }),
    });
    expect(choosePdfDelivery(env, file)).toBe("open");
  });
});

describe("deliverPdf", () => {
  const iphone = (overrides = {}) =>
    fakeEnv({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, ...shareable(), ...overrides });

  it("calls the share sheet before returning, inside the tap's activation", async () => {
    const { env } = iphone();
    const pending = deliverPdf(file, { title: "Kyoto" }, env);

    expect(env.navigator.share).toHaveBeenCalledWith({ files: [file], title: "Kyoto" });
    await expect(pending).resolves.toBe("shared");
  });

  it("reports a dismissed share sheet as cancelled and a refused one as failed", async () => {
    const abort = Object.assign(new Error("dismissed"), { name: "AbortError" });
    const refused = Object.assign(new Error("no activation"), { name: "NotAllowedError" });

    await expect(deliverPdf(file, {}, iphone({ share: vi.fn(async () => { throw abort; }) }).env)).resolves.toBe("cancelled");
    await expect(deliverPdf(file, {}, iphone({ share: vi.fn(async () => { throw refused; }) }).env)).resolves.toBe("failed");
  });

  it("downloads through an attached link and frees the blob URL later", async () => {
    const { env, link } = fakeEnv({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5, ...shareable() });

    await expect(deliverPdf(file, {}, env)).resolves.toBe("downloaded");

    expect(env.navigator.share).not.toHaveBeenCalled();
    expect(env.document.body.appendChild).toHaveBeenCalledWith(link);
    expect(link).toMatchObject({ href: "blob:pdf", download: "kyoto-itinerary.pdf" });
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(env.window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    env.window.setTimeout.mock.calls[0][0]();
    expect(env.URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
  });

  it("opens the PDF in a new tab and reports a blocked tab as failed", async () => {
    const { env } = fakeEnv({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 });
    await expect(deliverPdf(file, {}, env)).resolves.toBe("opened");
    expect(env.window.open).toHaveBeenCalledWith("blob:pdf", "_blank");

    const blocked = fakeEnv({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, openResult: null });
    await expect(deliverPdf(file, {}, blocked.env)).resolves.toBe("failed");
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/pdf-delivery.test.js --pool=threads`
Expected: FAIL with `Failed to resolve import "../app/lib/pdfDelivery.js"`.

- [ ] **Step 3: Implement**

Create `app/lib/pdfDelivery.js`:

```js
/**
 * Hands a ready PDF to the device in a way that device supports.
 *
 * jsPDF's doc.save() clicks a detached <a download href="blob:…"> on a timer.
 * Desktop and Android honour that. iOS ignores it in home-screen apps and only
 * honours it in Safari inside the tap's own activation, and in-app browsers
 * never download blobs. iPhone/iPad therefore get the share sheet ("Save to
 * Files", "Print"…), which works in Safari and from the home screen.
 *
 * Call deliverPdf synchronously from the click handler, with no await before it:
 * navigator.share and window.open both need the tap's activation.
 */

const REVOKE_AFTER_MS = 60_000;

/** iPhone, iPod and iPad, including iPadOS, which reports a desktop Mac user agent. */
export function isAppleMobile(nav) {
  if (/iPad|iPhone|iPod/.test(String(nav?.userAgent ?? ""))) return true;
  return nav?.platform === "MacIntel" && Number(nav?.maxTouchPoints) > 1;
}

function canShareFile(nav, file) {
  if (typeof nav?.share !== "function" || typeof nav?.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

function supportsDownloadAttribute(doc) {
  return "download" in doc.createElement("a");
}

/** @returns {"share" | "download" | "open"} */
export function choosePdfDelivery(env, file) {
  const shareable = canShareFile(env.navigator, file);
  if (isAppleMobile(env.navigator)) return shareable ? "share" : "open";
  if (supportsDownloadAttribute(env.document)) return "download";
  return shareable ? "share" : "open";
}

function browserEnv() {
  return { navigator: window.navigator, document: window.document, window, URL: window.URL };
}

/**
 * @param {File} file
 * @param {{ title?: string }} [options]
 * @returns {Promise<"shared" | "cancelled" | "downloaded" | "opened" | "failed">}
 */
export function deliverPdf(file, { title = "" } = {}, env = browserEnv()) {
  const strategy = choosePdfDelivery(env, file);

  if (strategy === "share") {
    return env.navigator.share({ files: [file], title }).then(
      () => "shared",
      (error) => (error?.name === "AbortError" ? "cancelled" : "failed"),
    );
  }

  const url = env.URL.createObjectURL(file);
  env.window.setTimeout(() => env.URL.revokeObjectURL(url), REVOKE_AFTER_MS);

  if (strategy === "download") {
    const link = env.document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    link.style.display = "none";
    // Attached, because Firefox ignores clicks on detached links.
    env.document.body.appendChild(link);
    link.click();
    link.remove();
    return Promise.resolve("downloaded");
  }

  // No "noopener" feature: with it, window.open always returns null and a blocked tab can't be detected.
  const tab = env.window.open(url, "_blank");
  return Promise.resolve(tab ? "opened" : "failed");
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run tests/pdf-delivery.test.js --pool=threads`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/pdfDelivery.js tests/pdf-delivery.test.js
git commit -m "feat(pdf): hand PDFs to the device via share sheet, download link or new tab"
```

---

### Task 3: Build the PDF before the tap

**Files:**
- Create: `app/hooks/useItineraryPdf.js`
- Test: `tests/use-itinerary-pdf.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/use-itinerary-pdf.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const delivery = vi.hoisted(() => ({ deliverPdf: vi.fn() }));
const pdfExport = vi.hoisted(() => ({
  generateItineraryPdf: vi.fn(async () => ({ output: () => new Blob(["%PDF-1.7"], { type: "application/pdf" }) })),
  titleToFilename: vi.fn((title) => `${title}.pdf`),
}));

vi.mock("../app/lib/pdfDelivery.js", () => delivery);
vi.mock("../app/lib/pdfExport.js", () => pdfExport);

import { useItineraryPdf } from "../app/hooks/useItineraryPdf.js";

// Stable reference: a new object would rebuild the PDF on every render.
const INPUT = { title: "Kyoto", days: [] };
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fallback");
  URL.revokeObjectURL = vi.fn();
  delivery.deliverPdf.mockReset();
  pdfExport.generateItineraryPdf.mockClear();
});

afterEach(() => {
  // Unmount first: Vitest runs afterEach hooks in reverse, so setup.js's cleanup
  // would otherwise run after jsdom's (missing) revokeObjectURL is restored.
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

describe("useItineraryPdf", () => {
  it("does nothing until there is an itinerary", () => {
    const { result } = renderHook(() => useItineraryPdf(null));

    act(() => result.current.download());

    expect(result.current).toMatchObject({ status: "idle", canDownload: false });
    expect(pdfExport.generateItineraryPdf).not.toHaveBeenCalled();
    expect(delivery.deliverPdf).not.toHaveBeenCalled();
  });

  it("builds the PDF before the tap", async () => {
    const { result } = renderHook(() => useItineraryPdf(INPUT));

    expect(result.current.canDownload).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ canDownload: true, filename: "Kyoto.pdf" });
    expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(INPUT);
  });

  it("hands the file over synchronously when tapped", async () => {
    delivery.deliverPdf.mockResolvedValue("downloaded");
    const { result } = renderHook(() => useItineraryPdf(INPUT));
    await waitFor(() => expect(result.current.canDownload).toBe(true));

    act(() => result.current.download());

    expect(delivery.deliverPdf).toHaveBeenCalledTimes(1);
    const [file, options] = delivery.deliverPdf.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({ name: "Kyoto.pdf", type: "application/pdf" });
    expect(options).toEqual({ title: "Kyoto" });
  });

  it("offers a plain link when the device refuses the hand-off", async () => {
    delivery.deliverPdf.mockResolvedValue("failed");
    const { result } = renderHook(() => useItineraryPdf(INPUT));
    await waitFor(() => expect(result.current.canDownload).toBe(true));

    act(() => result.current.download());

    await waitFor(() => expect(result.current.fallbackUrl).toBe("blob:fallback"));
  });

  it("reports a build failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pdfExport.generateItineraryPdf.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useItineraryPdf(INPUT));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.canDownload).toBe(false);
  });

  it("never keeps the previous itinerary's file while the next one builds", async () => {
    const { result, rerender } = renderHook(({ input }) => useItineraryPdf(input), { initialProps: { input: INPUT } });
    await waitFor(() => expect(result.current.canDownload).toBe(true));

    rerender({ input: { title: "Cebu", days: [] } });

    expect(result.current.canDownload).toBe(false);
    await waitFor(() => expect(result.current.filename).toBe("Cebu.pdf"));
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/use-itinerary-pdf.test.jsx --pool=threads`
Expected: FAIL with `Failed to resolve import "../app/hooks/useItineraryPdf.js"`.

- [ ] **Step 3: Implement**

Create `app/hooks/useItineraryPdf.js`:

```js
"use client";

import { useCallback, useEffect, useState } from "react";
import { generateItineraryPdf, titleToFilename } from "../lib/pdfExport.js";
import { deliverPdf } from "../lib/pdfDelivery.js";

/**
 * Builds the itinerary PDF as soon as its content is known, so a tap can hand
 * the file to the device synchronously (lib/pdfDelivery.js explains why iOS
 * needs that).
 *
 * @param {object|null} input generateItineraryPdf's argument; null until the
 *   itinerary has loaded. Memoize it: a new object rebuilds the PDF.
 * @returns {{ status: "idle"|"preparing"|"ready"|"error", canDownload: boolean,
 *   download: () => void, fallbackUrl: string|null, filename: string|null }}
 */
export function useItineraryPdf(input) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [fallbackUrl, setFallbackUrl] = useState(null);

  useEffect(() => {
    // A rebuild must never leave the previous itinerary's file downloadable.
    setFile(null);
    setFallbackUrl(null);
    if (!input) {
      setStatus("idle");
      return undefined;
    }

    let cancelled = false;
    setStatus("preparing");
    // Next tick, so the page paints before jsPDF's synchronous layout work.
    const timer = setTimeout(async () => {
      try {
        const doc = await generateItineraryPdf(input);
        const blob = doc.output("blob");
        const next = new File([blob], titleToFilename(input.title), { type: "application/pdf" });
        if (cancelled) return;
        setFile(next);
        setStatus("ready");
      } catch (error) {
        console.error("PDF export failed:", error);
        if (!cancelled) setStatus("error");
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input]);

  // Release the fallback link's object URL when it is replaced or the page unmounts.
  useEffect(() => {
    if (!fallbackUrl) return undefined;
    return () => URL.revokeObjectURL(fallbackUrl);
  }, [fallbackUrl]);

  const download = useCallback(() => {
    if (!file) return;
    setFallbackUrl(null);
    // No await before deliverPdf: the share sheet needs the tap's activation.
    deliverPdf(file, { title: input?.title ?? "" }).then((outcome) => {
      if (outcome === "failed") setFallbackUrl(URL.createObjectURL(file));
    });
  }, [file, input]);

  return { status, canDownload: Boolean(file), download, fallbackUrl, filename: file?.name ?? null };
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run tests/use-itinerary-pdf.test.jsx --pool=threads`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useItineraryPdf.js tests/use-itinerary-pdf.test.jsx
git commit -m "feat(pdf): build the itinerary PDF before the tap so the hand-off stays in the gesture"
```

---

### Task 4: Share page PDF button

**Files:**
- Create: `app/itinerary/view/[token]/components/PdfDownloadButton.jsx`
- Modify: `app/itinerary/view/[token]/page.jsx` (import at 9, `pdfLoading` state at 333, new memo after `hasVisibleWeather` at 440-443, `handleDownloadPdf` at 574-595, button at 698-719)
- Modify: `tests/share-page-weather.test.jsx:24`, `tests/share-page-accessibility.test.jsx:24`
- Test: `tests/share-page-pdf.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/share-page-pdf.test.jsx`:

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  fetchPublicItinerary: vi.fn(),
  listPublicComments: vi.fn(async () => ({ comments: [] })),
  postPublicComment: vi.fn(),
  // Never settles: arriving weather would rebuild the PDF mid-test.
  fetchSharedItineraryWeather: vi.fn(() => new Promise(() => {})),
}));
const delivery = vi.hoisted(() => ({ deliverPdf: vi.fn(async () => "downloaded") }));
const pdfExport = vi.hoisted(() => ({
  generateItineraryPdf: vi.fn(async () => ({ output: () => new Blob(["%PDF-1.7"], { type: "application/pdf" }) })),
  titleToFilename: vi.fn((title) => `${title}.pdf`),
}));

vi.mock("../app/lib/api/index.js", () => api);
vi.mock("../app/lib/pdfDelivery.js", () => delivery);
vi.mock("../app/lib/pdfExport.js", () => pdfExport);
// components/icons/index.js contains JSX in a .js file, which vitest cannot parse.
vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  return {
    PlaneIcon: Icon, HotelIcon: Icon, ForkKnifeIcon: Icon, CarIcon: Icon, MapPinIcon: Icon, ChatIcon: Icon,
    UserIcon: Icon, CheckIcon: Icon, CalendarIcon: Icon, UsersIcon: Icon, ListIcon: Icon, MapIcon: Icon, CloseIcon: Icon,
  };
});
vi.mock("../app/components/theme/ThemeToggle", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "share-token-12" }) }));
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/itinerary/view/[token]/components/ProposalRating.jsx", () => ({ default: () => null }));

import PublicItineraryPage from "../app/itinerary/view/[token]/page.jsx";

function share(brand) {
  return {
    share: { token: "share-token-12", clientName: "Garcia", expiresAt: null },
    brand,
    trip: { id: "trip-1", title: "Baguio Weekend", startDate: null, endDate: null, travelerCount: 2, destinationSummary: "Baguio City" },
    itinerary: { id: "iter-1", title: "Baguio Weekend", summary: null, version: 3, days: [] },
    creator: { id: "user-1", displayName: "Agent" },
  };
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  localStorage.setItem("voyage_commenter_name", "Tester");
  api.fetchPublicItinerary.mockResolvedValue(share({ type: "agency", name: "Island Hops Travel", logoUrl: null }));
  delivery.deliverPdf.mockClear();
  pdfExport.generateItineraryPdf.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:fallback");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // Unmount before restoring: the hook revokes its fallback URL on unmount.
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

const PDF_BUTTON = { name: "Download itinerary as PDF" };

async function readyButton() {
  await waitFor(() => expect(screen.getByRole("button", PDF_BUTTON)).toBeEnabled());
  return screen.getByRole("button", PDF_BUTTON);
}

describe("public share PDF", () => {
  it("hands the prepared PDF to the device inside the tap", async () => {
    render(<PublicItineraryPage />);
    const button = await readyButton();

    fireEvent.click(button);

    // Synchronous: no await between the tap and the hand-off.
    expect(delivery.deliverPdf).toHaveBeenCalledTimes(1);
    expect(delivery.deliverPdf.mock.calls[0][0].name).toBe("Baguio Weekend.pdf");
  });

  it("brands the PDF with the agency shown in the page header", async () => {
    render(<PublicItineraryPage />);
    await readyButton();

    expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(expect.objectContaining({ agencyName: "Island Hops Travel" }));
  });

  it("falls back to Voyage branding for personal shares", async () => {
    api.fetchPublicItinerary.mockResolvedValue(share({ type: "personal", displayName: "Ana" }));
    render(<PublicItineraryPage />);
    await readyButton();

    expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(expect.objectContaining({ agencyName: "Voyage" }));
  });

  it("offers a tappable link when the device blocks the hand-off", async () => {
    delivery.deliverPdf.mockResolvedValueOnce("failed");
    render(<PublicItineraryPage />);

    fireEvent.click(await readyButton());

    const link = await screen.findByRole("link", { name: "Open the PDF" });
    expect(link).toHaveAttribute("href", "blob:fallback");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/share-page-pdf.test.jsx --pool=threads`
Expected: FAIL. `deliverPdf` is never called (the page still calls `doc.save`, which the fake doc lacks), and `agencyName` is `"Voyage"` instead of `"Island Hops Travel"`.

- [ ] **Step 3: Create the button component**

Create `app/itinerary/view/[token]/components/PdfDownloadButton.jsx`:

```jsx
"use client";

import Spinner from "../../../../components/ui/Spinner";
import { useItineraryPdf } from "../../../../hooks/useItineraryPdf.js";

/**
 * PDF button for the public share page. The PDF is built when the page loads,
 * so a tap hands a ready file to the device: the share sheet on iPhone/iPad, a
 * download elsewhere. If the device refuses, a plain link is offered instead.
 */
export default function PdfDownloadButton({ input, className = "" }) {
  const pdf = useItineraryPdf(input);
  const isPreparing = !pdf.canDownload && pdf.status !== "error";

  return (
    <div className={`grid justify-items-start gap-2 ${className}`.trim()}>
      <button
        type="button"
        onClick={pdf.download}
        disabled={!pdf.canDownload}
        aria-label="Download itinerary as PDF"
        className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-4 text-[13px] font-semibold text-on-primary shadow-soft transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
      >
        {isPreparing ? (
          <>
            <Spinner size="sm" />
            Preparing PDF…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download PDF
          </>
        )}
      </button>
      <div aria-live="polite" className="text-[12px] leading-[1.5] text-text-muted">
        {pdf.status === "error" ? <p className="m-0">We couldn&apos;t build the PDF. Reload the page to try again.</p> : null}
        {pdf.fallbackUrl ? (
          <p className="m-0">
            Your device didn&apos;t save it automatically.{" "}
            <a href={pdf.fallbackUrl} target="_blank" rel="noopener" className="font-semibold text-secondary-strong underline">
              Open the PDF
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the page**

In `app/itinerary/view/[token]/page.jsx`:

1. Replace `import { generateItineraryPdf, titleToFilename } from "../../../lib/pdfExport.js";` with:

```js
import PdfDownloadButton from "./components/PdfDownloadButton.jsx";
```

2. Delete `  const [pdfLoading, setPdfLoading] = useState(false);`.

3. Directly after the `hasVisibleWeather` `useMemo` (it ends with `[shareWeather.byDayId],\n  );`), add the memo. It must sit above the `if (loading)` early return, like every hook:

```js
  /* ── PDF content (built ahead of the tap by PdfDownloadButton) ── */
  const pdfInput = useMemo(() => {
    if (!data?.itinerary) return null;
    const pdfTrip = data.trip ?? {};
    const agencyBrand = data.brand?.type === "agency" ? data.brand.name : null;
    return {
      title: pdfTrip.title || data.itinerary.title,
      summary: data.itinerary.summary,
      dateRange: formatDateRange(pdfTrip.startDate, pdfTrip.endDate),
      travelerCount: pdfTrip.travelerCount,
      days: attachWeatherToDays(data.itinerary.days, shareWeather.byDayId),
      // The PDF carries the brand the page header shows.
      agencyName: agencyBrand || "Voyage",
    };
  }, [data, shareWeather.byDayId]);
```

4. Delete the whole `/* ── PDF export ── */` block: `async function handleDownloadPdf() { … }` (from `/* ── PDF export ── */` through its closing `}`).

5. Replace the `<button …onClick={handleDownloadPdf}…>…</button>` element (the one with `aria-label="Download itinerary as PDF"`) with:

```jsx
            <PdfDownloadButton input={pdfInput} className="mt-[14px]" />
```

- [ ] **Step 5: Stop the old tests' PDF mock from throwing**

`generateItineraryPdf: vi.fn()` now returns `undefined`, so the hook logs `PDF export failed`. In both `tests/share-page-weather.test.jsx` and `tests/share-page-accessibility.test.jsx`, replace:

```js
vi.mock("../app/lib/pdfExport.js", () => ({ generateItineraryPdf: vi.fn(), titleToFilename: vi.fn((s) => s) }));
```

with:

```js
vi.mock("../app/lib/pdfExport.js", () => ({
  generateItineraryPdf: vi.fn(async () => ({ output: () => new Blob([]) })),
  titleToFilename: vi.fn((s) => s),
}));
```

- [ ] **Step 6: Run the share page tests**

Run: `npx vitest run tests/share-page-pdf.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx --pool=threads`
Expected: PASS (all three files), with no `PDF export failed` in the output.

- [ ] **Step 7: Commit**

```bash
git add "app/itinerary/view/[token]/components/PdfDownloadButton.jsx" "app/itinerary/view/[token]/page.jsx" tests/share-page-pdf.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx
git commit -m "fix(share): download the shared itinerary PDF on iOS, PWAs and mobile browsers"
```

---

### Task 5: In-app itinerary PDF uses the same hand-off

**Files:**
- Modify: `app/components/trip-dashboard/pages/ClientItineraryPage.jsx` (import at 24, `pdfLoading` state at 84, `handleDownloadPdf` at 359-377)
- Test: `tests/client-itinerary-pdf.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/client-itinerary-pdf.test.jsx`. The mocks mirror `tests/client-itinerary-weather.test.jsx`, which already renders this page:

```jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  approveClientTrip: vi.fn(),
  fetchItineraryDraft: vi.fn(async () => ({
    itinerary: {
      id: "iter-1",
      version: 2,
      title: "Baguio weekend",
      days: [{ id: "day-1", dayNumber: 1, title: "Arrival", date: "2026-10-10", items: [] }],
    },
  })),
  getUnreadCommentCount: vi.fn(async () => ({ count: 0 })),
  getUnreadCommentCountsByTrip: vi.fn(async () => ({ counts: [] })),
  // Never settles: arriving weather would rebuild the PDF mid-test.
  fetchItineraryWeather: vi.fn(() => new Promise(() => {})),
}));
const delivery = vi.hoisted(() => ({ deliverPdf: vi.fn(async () => "downloaded") }));

vi.mock("../app/lib/api/index.js", () => api);
vi.mock("../app/lib/pdfDelivery.js", () => delivery);
vi.mock("../app/lib/pdfExport.js", () => ({
  generateItineraryPdf: vi.fn(async () => ({ output: () => new Blob(["%PDF-1.7"], { type: "application/pdf" }) })),
  titleToFilename: vi.fn((title) => `${title}.pdf`),
}));
vi.mock("../app/components/icons/index.js", () => ({
  SearchIcon: () => null, CloseIcon: () => null, CheckIcon: () => null, ReplyIcon: () => null,
  ArrowLeftIcon: () => null, ArrowRightIcon: () => null, PlusIcon: () => null, TrashIcon: () => null,
  ChatIcon: () => null, ShareIcon: () => null, DownloadIcon: () => null, UsersIcon: () => null,
  PencilIcon: () => null, BookmarkIcon: () => null, MapPinIcon: () => null, ChevronDownIcon: () => null,
  ChevronRightIcon: () => null, CheckCircleIcon: () => null, XCircleIcon: () => null, RefreshIcon: () => null,
}));
vi.mock("../app/components/ui/index.js", () => ({
  Spinner: () => null,
  EmptyState: ({ title }) => <p>{title}</p>,
  StatusBadge: ({ children }) => <span>{children}</span>,
}));
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/components/trip-dashboard/itinerary/ItineraryLiveMap.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/itinerary/ShareDialog.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/pages/CommentsPanel.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/pages/ItineraryDayView.jsx", () => ({ default: () => null }));
vi.mock("../app/components/trip-dashboard/mobile/MobileGlassSheet.jsx", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../app/components/trip-dashboard/mobile/CompactPlaceCard.jsx", () => ({ default: () => null }));
vi.mock("../app/components/theme/ThemeProvider.jsx", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../app/lib/formatters.js", () => ({
  formatDayCardDate: () => "Oct 10, 2026 - Oct 11, 2026",
  getItemTimeLabel: () => "",
  getSavedStatusClass: () => "approved",
}));

import ClientItineraryPage from "../app/components/trip-dashboard/pages/ClientItineraryPage.jsx";

const trip = { id: "t1", clientName: "Garcia", approvalStatus: "Approved", destination: "Baguio", itineraryId: "iter-1", isSaved: true };

describe("dashboard itinerary PDF", () => {
  it("hands the prepared PDF to the device inside the tap", async () => {
    render(<ClientItineraryPage agencyTrips={[trip]} agencyId="agency-1" />);

    // Re-query inside waitFor: the header can re-render while the trip loads.
    await waitFor(() => expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    expect(delivery.deliverPdf).toHaveBeenCalledTimes(1);
    const [file, options] = delivery.deliverPdf.mock.calls[0];
    expect(file.name).toBe("Baguio weekend.pdf");
    expect(options).toEqual({ title: "Baguio weekend" });
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/client-itinerary-pdf.test.jsx --pool=threads`
Expected: FAIL. `deliverPdf` is not called, because the page still calls `doc.save()`, which the fake doc lacks.

- [ ] **Step 3: Implement**

In `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`:

1. Replace `import { generateItineraryPdf, titleToFilename } from "../../../lib/pdfExport.js";` with:

```js
import { useItineraryPdf } from "../../../hooks/useItineraryPdf.js";
```

2. Delete `  const [pdfLoading, setPdfLoading] = useState(false);`.

3. Replace the whole `const handleDownloadPdf = async () => { … };` block with:

```js
  // Built ahead of the tap so the hand-off stays inside the gesture (iOS share sheet).
  const pdfInput = useMemo(
    () =>
      fullItinerary
        ? {
            title: tripTitle,
            summary: tripSummary,
            dateRange: tripDateRange,
            travelerCount,
            days: attachWeatherToDays(safeDays, itineraryWeather.byDayId),
            agencyName: "Voyage",
          }
        : null,
    [fullItinerary, tripTitle, tripSummary, tripDateRange, travelerCount, safeDays, itineraryWeather.byDayId],
  );
  const itineraryPdf = useItineraryPdf(pdfInput);
  // Spinner while building; a failed build re-enables the button (the error is logged).
  const pdfLoading = !itineraryPdf.canDownload && itineraryPdf.status !== "error";
  const handleDownloadPdf = itineraryPdf.download;
```

The existing `pdfLoading` / `handleDownloadPdf` uses (mobile button around line 530, `ItineraryHeader` props around line 688) keep working unchanged.

- [ ] **Step 4: Run the in-app tests**

Run: `npx vitest run tests/client-itinerary-pdf.test.jsx tests/client-itinerary-weather.test.jsx tests/client-itinerary-approve.test.jsx --pool=threads`
Expected: PASS (all three files).

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/pages/ClientItineraryPage.jsx tests/client-itinerary-pdf.test.jsx
git commit -m "fix(itinerary): download the dashboard itinerary PDF from the installed app on iOS"
```

---

### Task 6: Glass share header and "Powered by Voyage"

**Required skills:** `ui-ux-pro-max`, `frontend-design`, `emil-design-eng`, applied within the Design decisions above.

**Files:**
- Create: `app/itinerary/view/[token]/components/ShareHeader.jsx`
- Modify: `app/itinerary/view/[token]/page.jsx` (brand node at 603-636, header at 640-645, both "Powered by Voyage" footers at 567-569 and 924-927; remove the `ThemeToggle` import)
- Test: `tests/share-header.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/share-header.test.jsx`:

```jsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../app/components/theme/ThemeToggle", () => ({
  default: () => <button type="button">Toggle theme</button>,
}));

import ShareHeader, { PoweredByVoyage } from "../app/itinerary/view/[token]/components/ShareHeader.jsx";

describe("ShareHeader", () => {
  it("leads with the agency's own brand", () => {
    render(<ShareHeader brand={{ type: "agency", name: "Island Hops Travel", logoUrl: "https://cdn.example/logo.png" }} />);

    expect(screen.getByText("Island Hops Travel")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Island Hops Travel" })).toHaveAttribute("src", "https://cdn.example/logo.png");
    expect(screen.queryByRole("img", { name: "Voyage" })).toBeNull();
  });

  it("sets the agency name like a personal name, in the dashboard's sans (Design decision 6)", () => {
    render(<ShareHeader brand={{ type: "agency", name: "Island Hops Travel", logoUrl: null }} />);
    const name = screen.getByText("Island Hops Travel");

    expect(name.className).toContain("font-semibold");
    expect(name.className).not.toContain("font-serif");
  });

  it("names who shared a personal itinerary", () => {
    render(<ShareHeader brand={{ type: "personal", displayName: "Ana Reyes" }} />);

    expect(screen.getByText("Shared by")).toBeInTheDocument();
    expect(screen.getByText("Ana Reyes")).toBeInTheDocument();
  });

  it("shows the Voyage logo when there is no brand", () => {
    render(<ShareHeader brand={null} />);

    expect(screen.getByRole("img", { name: "Voyage" })).toBeInTheDocument();
  });

  it("sits on the app's glass frame, not a solid navy bar, and keeps the theme toggle", () => {
    const { container } = render(<ShareHeader brand={null} />);
    const header = container.querySelector("header");

    expect(header.className).not.toMatch(/\bbg-sidebar\b/);
    expect(header.className).not.toMatch(/\btext-white\b/);
    expect(header.className).toContain("--frame-panel");
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });
});

describe("PoweredByVoyage", () => {
  it("credits Voyage with the logo", () => {
    render(<PoweredByVoyage />);

    expect(screen.getByText("Powered by")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Voyage" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/share-header.test.jsx --pool=threads`
Expected: FAIL with `Failed to resolve import "../app/itinerary/view/[token]/components/ShareHeader.jsx"`.

- [ ] **Step 3: Create the header**

Create `app/itinerary/view/[token]/components/ShareHeader.jsx`:

```jsx
"use client";

import ThemeToggle from "../../../../components/theme/ThemeToggle";
import VoyageLogo from "../../../../components/brand/VoyageLogo.jsx";

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted";

/**
 * Public share header on the app's glass frame. The page is client-facing, so
 * the agency's own brand leads; the Voyage logo only stands in when there is none.
 */
export default function ShareHeader({ brand }) {
  return (
    <header className="relative z-20 flex flex-shrink-0 items-center justify-between gap-3 border-b border-[color:var(--frame-border)] bg-[var(--frame-panel)] px-6 py-3 text-text-primary backdrop-blur-[16px] max-sm:px-4 max-sm:py-2.5">
      <ShareBrand brand={brand} />
      <span className={`${EYEBROW} max-sm:hidden`}>Shared itinerary</span>
      <ThemeToggle />
    </header>
  );
}

function ShareBrand({ brand }) {
  if (brand?.type === "personal") {
    return (
      <div className="flex min-w-0 flex-col leading-tight">
        <span className={EYEBROW}>Shared by</span>
        <span className="truncate text-[16px] font-semibold max-sm:text-[14px]">{brand.displayName || "Traveler"}</span>
      </div>
    );
  }

  // Legacy responses have no brand; unknown brand types fall through to Voyage.
  const isAgency = !brand || brand.type === "agency";
  if (isAgency && (brand?.name || brand?.logoUrl)) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {brand.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.name || "Agency logo"} className="h-7 w-auto flex-shrink-0 object-contain" />
        ) : null}
        {brand.name ? (
          <span className="truncate text-[16px] font-semibold max-sm:text-[14px]">{brand.name}</span>
        ) : null}
      </div>
    );
  }

  return <VoyageLogo className="h-8 w-auto" />;
}

/** Footer credit, shared by the itinerary and the error states. */
export function PoweredByVoyage({ className = "" }) {
  return (
    <p className={`m-0 flex items-center justify-center gap-2 ${EYEBROW} ${className}`.trim()}>
      <span>Powered by</span>
      <VoyageLogo className="h-5 w-auto text-text-primary" />
    </p>
  );
}
```

- [ ] **Step 4: Use it in the page**

In `app/itinerary/view/[token]/page.jsx`:

1. Replace `import ThemeToggle from "../../../components/theme/ThemeToggle";` with:

```js
import ShareHeader, { PoweredByVoyage } from "./components/ShareHeader.jsx";
```

2. Delete the whole `/* ── brand node for header ── */` block (from `let brandNode;` through the closing `}` of the `else` branch).

3. Replace the header element:

```jsx
      <header className="flex items-center justify-between px-6 py-3 bg-sidebar text-white flex-shrink-0 z-20 max-sm:px-4 max-sm:py-[10px]">
        {brandNode}
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] opacity-70 max-sm:text-[10px]">Shared Itinerary</span>
        <ThemeToggle />
      </header>
```

with:

```jsx
      <ShareHeader brand={brand} />
```

4. In the error state, replace:

```jsx
        <footer className="mt-8">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-soft opacity-60">Powered by Voyage</span>
        </footer>
```

with:

```jsx
        <footer className="mt-8">
          <PoweredByVoyage />
        </footer>
```

5. At the bottom of the itinerary column, replace:

```jsx
          <footer className="pt-8 text-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-soft opacity-60">Powered by Voyage</span>
          </footer>
```

with:

```jsx
          <footer className="pt-8">
            <PoweredByVoyage />
          </footer>
```

- [ ] **Step 5: Run the header and share page tests**

Run: `npx vitest run tests/share-header.test.jsx tests/share-page-pdf.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx --pool=threads`
Expected: PASS (all four files).

- [ ] **Step 6: Commit**

```bash
git add "app/itinerary/view/[token]/components/ShareHeader.jsx" "app/itinerary/view/[token]/page.jsx" tests/share-header.test.jsx
git commit -m "feat(share): glass header with agency brand and Voyage logo credit"
```

---

### Task 7: In-app stop cards, mobile switcher, map frame and title

**Required skills:** `ui-ux-pro-max`, `frontend-design`, `emil-design-eng`, applied within the Design decisions above.

**Files:**
- Create: `app/itinerary/view/[token]/components/ShareStopCard.jsx`
- Modify: `app/itinerary/view/[token]/page.jsx` (helpers near `formatTime` at 65-73; mobile tabs at 647-663; trip header at 677-683; day header and items at 729-871; map panel at 930-945)
- Test: `tests/share-stop-card.test.jsx`, `tests/share-page-layout.test.jsx`

- [ ] **Step 1: Write the failing stop card test**

Create `tests/share-stop-card.test.jsx`:

```jsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// components/icons/index.js contains JSX in a .js file, which vitest cannot parse.
vi.mock("../app/components/icons/index.js", () => ({ MapPinIcon: () => null, ChatIcon: () => null }));

import ShareStopCard from "../app/itinerary/view/[token]/components/ShareStopCard.jsx";

const item = {
  id: "item-1",
  title: "Kiyomizu-dera",
  description: "Arrive early for the wooden stage.",
  clientNotes: "Wear comfy shoes.",
  placeSnapshot: {
    name: "Kiyomizu-dera",
    formattedAddress: "1 Chome-294 Kiyomizu, Kyoto",
    rating: 4.6,
    metadata: { googleTypes: ["buddhist_temple"], primaryPhotoUrl: "https://photos.example/kiyomizu.jpg" },
  },
};

describe("ShareStopCard", () => {
  it("shows the stop the way the in-app itinerary does", () => {
    render(<ShareStopCard item={item} timeLabel="8:00 AM – 10:00 AM" icon={<span>icon</span>} />);

    expect(screen.getByText("8:00 AM – 10:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Buddhist Temple")).toBeInTheDocument();
    expect(screen.getByText("★ 4.6")).toBeInTheDocument();
    expect(screen.getByText("1 Chome-294 Kiyomizu, Kyoto")).toBeInTheDocument();
    expect(screen.getByText("Wear comfy shoes.")).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "https://photos.example/kiyomizu.jpg");
  });

  it("uses the stop type icon when there is no photo", () => {
    const noPhoto = { ...item, placeSnapshot: { ...item.placeSnapshot, metadata: {} } };
    render(<ShareStopCard item={noPhoto} icon={<span>type icon</span>} />);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("type icon")).toBeInTheDocument();
  });

  it("sets the title in the dashboard's sans, never a faked serif bold (Design decision 6)", () => {
    render(<ShareStopCard item={item} />);
    const title = screen.getByRole("heading", { level: 3, name: "Kiyomizu-dera" });

    expect(title.className).toContain("font-sans");
    expect(title.className).toContain("font-semibold");
    expect(title.className).not.toContain("font-serif");
  });

  it("marks the stop the map is pointing at and renders its actions and comments", () => {
    render(
      <ShareStopCard item={item} isActive actions={<button type="button">Comment</button>}>
        <p>A comment</p>
      </ShareStopCard>,
    );

    expect(screen.getByRole("article")).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.getByText("A comment")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing page layout test**

Create `tests/share-page-layout.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  fetchPublicItinerary: vi.fn(),
  listPublicComments: vi.fn(async () => ({ comments: [] })),
  postPublicComment: vi.fn(),
  fetchSharedItineraryWeather: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../app/lib/api/index.js", () => api);
vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  return {
    PlaneIcon: Icon, HotelIcon: Icon, ForkKnifeIcon: Icon, CarIcon: Icon, MapPinIcon: Icon, ChatIcon: Icon,
    UserIcon: Icon, CheckIcon: Icon, CalendarIcon: Icon, UsersIcon: Icon, ListIcon: Icon, MapIcon: Icon, CloseIcon: Icon,
  };
});
vi.mock("../app/components/theme/ThemeToggle", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "share-token-12" }) }));
vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("../app/itinerary/view/[token]/components/ProposalRating.jsx", () => ({ default: () => null }));
vi.mock("../app/lib/pdfExport.js", () => ({
  generateItineraryPdf: vi.fn(async () => ({ output: () => new Blob([]) })),
  titleToFilename: vi.fn((s) => s),
}));

import PublicItineraryPage from "../app/itinerary/view/[token]/page.jsx";

beforeEach(() => {
  localStorage.setItem("voyage_commenter_name", "Tester");
  api.fetchPublicItinerary.mockResolvedValue({
    share: { token: "share-token-12" },
    brand: { type: "agency", name: "Island Hops Travel", logoUrl: null },
    trip: { title: "Kyoto Autumn Escape", startDate: null, endDate: null, travelerCount: 2, destinationSummary: "Kyoto, Japan" },
    itinerary: {
      title: "Kyoto Autumn Escape",
      summary: null,
      version: 1,
      days: [
        {
          id: "day-1",
          dayNumber: 1,
          date: null,
          title: "Eastern Higashiyama",
          summary: null,
          items: [{ id: "item-1", type: "ATTRACTION", title: "Kiyomizu-dera", startTime: "08:00", endTime: "10:00", placeSnapshot: null }],
        },
      ],
    },
  });
});

describe("public share layout", () => {
  it("lets the trip title use the column instead of the global 12ch heading cap", async () => {
    render(<PublicItineraryPage />);

    const title = await screen.findByRole("heading", { level: 1, name: "Kyoto Autumn Escape" });
    expect(title.className).toContain("max-w-none");
  });

  it("switches between itinerary and map with the app's segmented control", async () => {
    render(<PublicItineraryPage />);

    const switcher = await screen.findByRole("tablist", { name: "Itinerary view" });
    const mapTab = screen.getByRole("tab", { name: "Map" });
    expect(screen.getByRole("tab", { name: "Itinerary" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(mapTab);

    expect(mapTab).toHaveAttribute("aria-selected", "true");
    expect(switcher).toBeInTheDocument();
  });

  it("shows each stop as an in-app style card with its time", async () => {
    render(<PublicItineraryPage />);

    expect(await screen.findByRole("article")).toHaveTextContent("Kiyomizu-dera");
    expect(screen.getByText("8:00 AM – 10:00 AM")).toBeInTheDocument();
  });

  it("sets day titles in the dashboard's sans, not a serif (Design decision 6)", async () => {
    render(<PublicItineraryPage />);

    const dayTitle = await screen.findByRole("heading", { level: 2, name: "Eastern Higashiyama" });
    expect(dayTitle.className).toContain("font-sans");
    expect(dayTitle.className).toContain("font-semibold");
    expect(dayTitle.className).not.toContain("font-serif");
  });
});
```

- [ ] **Step 3: Run both tests and check that they fail**

Run: `npx vitest run tests/share-stop-card.test.jsx tests/share-page-layout.test.jsx --pool=threads`
Expected: FAIL. The stop card file doesn't resolve. In the layout test, the title lacks `max-w-none`, there is no `tablist` named "Itinerary view", there is no `article`, and the day title is still `font-serif`.

- [ ] **Step 4: Create the stop card**

Create `app/itinerary/view/[token]/components/ShareStopCard.jsx`:

```jsx
"use client";

import AccessibilityBadges from "../../../../components/accessibility/AccessibilityBadges.jsx";
import { MapPinIcon, ChatIcon } from "../../../../components/icons/index.js";
import { getReadablePlaceType, getSnapshotPhotoUrl } from "../../../../lib/trip-dashboard/richItinerary.js";

/**
 * One stop on the public share page, in the same anatomy as the in-app day view
 * (ItineraryDayView): time pill + place type, photo or type tile, title (sans,
 * like the dashboard's card titles), rating, then details. `actions` sit beside the title; `children` holds the
 * stop's comment form and comments.
 */
export default function ShareStopCard({ item, isActive = false, timeLabel = "", icon = null, actions = null, onHoverChange, children }) {
  const snapshot = item.placeSnapshot ?? null;
  const photoUrl = getSnapshotPhotoUrl(snapshot);
  const placeType = getReadablePlaceType(snapshot);
  const rating = snapshot?.rating ?? snapshot?.metadata?.rating ?? null;

  return (
    <article
      data-active={isActive ? "true" : "false"}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={`grid gap-3 rounded-xl border p-4 transition-[border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none max-[400px]:p-3 ${
        isActive ? "border-secondary/40 bg-secondary/5 shadow-soft" : "border-border/15 bg-surface-elevated"
      }`}
    >
      {timeLabel || placeType ? (
        <div className="flex items-center justify-between gap-2 border-b border-border/10 pb-2">
          {timeLabel ? (
            <span className="rounded-pill bg-secondary/10 px-2.5 py-1 text-[0.72rem] font-bold text-secondary-strong">{timeLabel}</span>
          ) : (
            <span />
          )}
          {placeType ? (
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-text-muted">{placeType}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        {photoUrl ? (
          <img src={photoUrl} alt="" loading="lazy" className="h-16 w-16 flex-shrink-0 rounded-xl object-cover max-[400px]:h-14 max-[400px]:w-14" />
        ) : (
          <div aria-hidden="true" className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-border/10 bg-background text-primary max-[400px]:h-14 max-[400px]:w-14">
            {icon}
          </div>
        )}
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="m-0 font-sans text-[15px] font-semibold leading-snug tracking-normal text-text-primary">{item.title}</h3>
          {rating ? <span className="text-[0.75rem] font-semibold text-text-muted">★ {rating}</span> : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>

      {item.description ? <p className="m-0 text-[0.85rem] leading-relaxed text-text-muted">{item.description}</p> : null}

      {snapshot?.name ? (
        <p className="m-0 flex items-start gap-1.5 text-[0.78rem] leading-snug text-text-muted">
          <MapPinIcon width={12} height={12} className="mt-[2px] flex-shrink-0" />
          <span className="min-w-0">
            <span className="font-semibold text-text-primary">{snapshot.name}</span>
            {snapshot.formattedAddress ? <span className="block">{snapshot.formattedAddress}</span> : null}
          </span>
        </p>
      ) : null}

      <AccessibilityBadges snapshot={snapshot} />

      {item.clientNotes ? (
        <div className="flex items-start gap-1.5 rounded-sm border-l-[3px] border-secondary bg-secondary/[0.06] px-3 py-2 text-[0.78rem] leading-[1.5] text-text-muted">
          <ChatIcon width={12} height={12} className="mt-[2px] flex-shrink-0 text-secondary-strong" />
          <span>{item.clientNotes}</span>
        </div>
      ) : null}

      {children}
    </article>
  );
}
```

- [ ] **Step 5: Rework the page body**

In `app/itinerary/view/[token]/page.jsx`:

1. Add imports below the `PdfDownloadButton` import:

```js
import ShareStopCard from "./components/ShareStopCard.jsx";
import SegmentedControl from "../../../components/admin/SegmentedControl.jsx";
```

2. Add this helper directly after `function formatTime(timeStr) { … }`:

```js
function formatTimeRange(start, end) {
  if (start && end) return `${formatTime(start)} – ${formatTime(end)}`;
  if (start) return formatTime(start);
  if (end) return `Until ${formatTime(end)}`;
  return "";
}

const MOBILE_VIEWS = [
  { value: "itinerary", label: "Itinerary" },
  { value: "map", label: "Map" },
];
```

3. Replace the whole mobile tab toggle block, from `{/* ── mobile tab toggle (hidden on desktop) ── */}` through its closing `</div>` (the one after the "Map" button), with:

```jsx
      {/* ── mobile view switcher (hidden on desktop) ── */}
      <div className="hidden flex-shrink-0 justify-center px-4 py-2 max-sm:flex">
        <SegmentedControl
          ariaLabel="Itinerary view"
          options={MOBILE_VIEWS}
          value={mobileTab}
          onChange={setMobileTab}
          size="sm"
        />
      </div>
```

Don't pass a display class (`grid`, `flex`) to `SegmentedControl`: its root is already `inline-flex`, and two display utilities on one element resolve by stylesheet order, not class order.

4. In the trip header, replace:

```jsx
          <div className="mb-8 pb-6 border-b border-border max-sm:mb-6 max-sm:pb-5">
            <h1 className="font-serif text-[28px] font-normal leading-[1.2] m-0 mb-[6px] text-primary max-sm:text-[22px] max-[400px]:text-[20px]">
```

with:

```jsx
          <div className="mb-8 pb-6 border-b border-border/10 max-sm:mb-6 max-sm:pb-5">
            {/* max-w-none: globals.css caps every h1 at 12ch for the landing hero. */}
            <h1 className="font-serif text-[30px] font-normal leading-[1.15] m-0 mb-[6px] max-w-none text-text-primary max-sm:text-[24px] max-[400px]:text-[22px]">
```

and replace `<p className="text-[15px] text-secondary font-semibold m-0 mb-3">{trip.destinationSummary}</p>` with:

```jsx
              <p className="text-[15px] text-secondary-strong font-semibold m-0 mb-3">{trip.destinationSummary}</p>
```

5. Replace the day header:

```jsx
                <div className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center flex-shrink-0 w-14 h-7 bg-secondary text-white rounded-pill text-[11px] font-bold tracking-[0.04em] uppercase max-[400px]:w-12 max-[400px]:h-6 max-[400px]:text-[10px]">
                    Day {day.dayNumber}
                  </span>
                  <div className="flex flex-col gap-[2px] pt-[2px]">
                    <h2 className="font-serif text-[19px] font-normal leading-[1.3] m-0 text-primary max-[400px]:text-[17px]">{day.title}</h2>
                    {day.date && (
                      <span className="text-[12px] text-text-soft font-medium">{formatDate(day.date)}</span>
                    )}
                    <WeatherChip entry={shareWeather.byDayId.get(day.id)} className="mt-1 self-start" />
                  </div>
                  <div className="ml-auto">
                    <CommentTriggerBtn
                      label={`Comment on Day ${day.dayNumber}`}
                      compact
                      onClick={() => openForm({ type: "day", dayNumber: day.dayNumber, itemId: undefined })}
                    />
                  </div>
                </div>
```

with:

```jsx
                <div className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span className="text-[0.78rem] font-extrabold uppercase tracking-wider text-secondary-strong">
                      Day {day.dayNumber}
                      {day.date ? (
                        <span className="font-semibold normal-case tracking-normal text-text-muted"> · {formatDate(day.date)}</span>
                      ) : null}
                    </span>
                    <h2 className="m-0 font-sans text-[22px] font-semibold leading-snug tracking-[-0.015em] text-text-primary max-[400px]:text-[19px]">{day.title}</h2>
                    {/* justify-self-start: the parent is a grid, where self-start only aligns vertically and the chip would stretch. */}
                    <WeatherChip entry={shareWeather.byDayId.get(day.id)} className="mt-1 justify-self-start" />
                  </div>
                  <CommentTriggerBtn
                    label={`Comment on Day ${day.dayNumber}`}
                    compact
                    onClick={() => openForm({ type: "day", dayNumber: day.dayNumber, itemId: undefined })}
                  />
                </div>
```

6. Replace the day summary paragraph `<p className="m-0 pl-[68px] text-[13px] leading-[1.55] text-text-soft max-sm:pl-0">{day.summary}</p>` with:

```jsx
                  <p className="m-0 text-[13px] leading-[1.55] text-text-muted">{day.summary}</p>
```

7. Replace the whole items list, from `<div className="grid gap-0 pl-6 max-sm:pl-3 max-[400px]:pl-1">` through its closing `</div>` (just before `</section>`), with:

```jsx
                <div className="grid gap-3">
                  {day.items.map((item, idx) => {
                    const globalIdx = mapItems.findIndex(
                      (mi) => mi.__dayNumber === day.dayNumber && mi.__itemIndex === idx
                    );
                    const itemFormDescriptor = { type: "item", dayNumber: day.dayNumber, itemId: item.id };

                    return (
                      <ShareStopCard
                        key={item.id}
                        item={item}
                        isActive={activeIndex === globalIdx}
                        timeLabel={formatTimeRange(item.startTime, item.endTime)}
                        icon={itemTypeIcon(item.type)}
                        onHoverChange={(hovering) => handleHoverItem(hovering ? globalIdx : -1)}
                        actions={
                          <>
                            <MapPinLink placeSnapshot={item.placeSnapshot} />
                            <CommentTriggerBtn
                              label={`Comment on ${item.title}`}
                              compact
                              onClick={() => openForm(itemFormDescriptor)}
                            />
                          </>
                        }
                      >
                        {isFormActive(itemFormDescriptor) && (
                          <CommentForm
                            token={token}
                            dayNumber={day.dayNumber}
                            itemId={item.id}
                            commenterName={commenterName}
                            commenterEmail={commenterEmail}
                            onCancel={closeForm}
                            onPosted={handlePosted}
                            onRefresh={refreshComments}
                          />
                        )}
                        {getItemComments(day.dayNumber, item.id).map((c, i) => (
                          <CommentChip key={i} comment={c} />
                        ))}
                      </ShareStopCard>
                    );
                  })}
                </div>
```

8. Replace the map panel (from `{/* ── right: map panel ── */}` through the closing `</div>` after `<ItineraryLiveMap … />`) with the inset frame `ItineraryDayView` uses:

```jsx
        {/* ── right: map panel, inset like the in-app day view ── */}
        <div
          className={`relative min-h-0 p-3 max-sm:p-0 ${mobileTab === "map" ? "max-sm:flex max-sm:flex-col max-sm:flex-1 max-sm:min-h-0" : "max-sm:hidden"}`}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-border/10 shadow-soft max-sm:flex-1 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none">
            <ItineraryLiveMap
              items={mapItems}
              liveMarkers={[]}
              routeEstimates={[]}
              activeIndex={activeIndex}
              onHoverItem={handleHoverItem}
              selectedPlaceId={selectedPlaceId}
              selectedPlace={selectedPlace}
              onSelectPlace={handleSelectPlace}
              sidebarWidth={0}
            />
          </div>
        </div>
```

9. Remove `ListIcon` and `MapIcon` from the icons import. Keep the other icons: `CalendarIcon` and `UsersIcon` are still used in the trip meta row.

- [ ] **Step 6: Run the new and existing share page tests**

Run: `npx vitest run tests/share-stop-card.test.jsx tests/share-page-layout.test.jsx tests/share-header.test.jsx tests/share-page-pdf.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx --pool=threads`
Expected: PASS (all six files).

- [ ] **Step 7: Commit**

```bash
git add "app/itinerary/view/[token]/components/ShareStopCard.jsx" "app/itinerary/view/[token]/page.jsx" tests/share-stop-card.test.jsx tests/share-page-layout.test.jsx
git commit -m "feat(share): in-app stop cards, segmented view switcher, inset map and full-width title"
```

---

### Task 8: Theme-token colours on the share page, with a guard

**Files:**
- Modify: `app/itinerary/view/[token]/page.jsx` (comment UI, map-pin link, feedback panel)
- Modify: `app/itinerary/view/[token]/components/ProposalRating.jsx:59,103,315`
- Test: `tests/share-page-design-tokens.test.js`

- [ ] **Step 1: Write the failing guard**

Create `tests/share-page-design-tokens.test.js`:

```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom replaces the global URL, so resolve from import.meta.dirname (see theme-safe-classes.test.js).
const ROOT = resolve(import.meta.dirname, "..");
const SHARE_DIR = join(ROOT, "app", "itinerary", "view", "[token]");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
  });
}

function shareLines() {
  return sourceFiles(SHARE_DIR).flatMap((file) => {
    const rel = relative(ROOT, file).split(sep).join("/");
    return readFileSync(file, "utf8")
      .split("\n")
      .map((text, index) => ({ where: `${rel}:${index + 1}`, text }));
  });
}

const hasClass = (text, name) => new RegExp(`(^|[\\s"'\`])${name}($|[\\s"'\`])`).test(text);

describe("public share page colours", () => {
  it("uses theme tokens instead of raw hex or rgba colours", () => {
    const offenders = shareLines()
      .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(text))
      .map(({ where, text }) => `${where}  ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("never puts white text on the light terracotta fill (about 2.8:1)", () => {
    const offenders = shareLines()
      .filter(({ text }) => hasClass(text, "bg-secondary") && hasClass(text, "text-white"))
      .map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it("uses status tokens instead of raw red for errors", () => {
    const offenders = shareLines()
      .filter(({ text }) => /\b(text|border|ring)-red-\d{3}\b/.test(text))
      .map(({ where }) => where);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard and check that it fails**

Run: `npx vitest run tests/share-page-design-tokens.test.js --pool=threads`
Expected: FAIL. All three tests list offenders in `page.jsx` (focus-ring `rgba(…)`, `#c46a51`, `#2a7a4f`, `#16a34a`, `bg-secondary text-white`, `red-500`) and in `ProposalRating.jsx` (`#9ca3af`, `#c46a51`, a focus-ring `rgba(…)`, `bg-secondary text-white`, `red-500`).

- [ ] **Step 3: Replace the colours in `page.jsx`**

Make each replacement exactly (search for the old string):

| # | Old | New |
|---|---|---|
| 1 | `bg-secondary/10 text-secondary no-underline` (MapPinLink) | `bg-secondary/10 text-secondary-strong no-underline` |
| 2 | `bg-primary/[0.04] border border-border border-l-[3px] border-l-secondary rounded-sm` (NamePromptBanner) | `bg-primary/[0.04] border border-border/15 border-l-[3px] border-l-secondary rounded-sm` |
| 3 | `bg-secondary/[0.12] text-secondary mt-px hidden sm:flex` | `bg-secondary/[0.12] text-secondary-strong mt-px hidden sm:flex` |
| 4 | `focus:border-secondary focus:shadow-[0_0_0_3px_rgba(215,122,97,0.12)] ${nameError ? "border-red-500 shadow-[0_0_0_3px_rgba(224,92,92,0.1)]" : "border-border/40"}` | `focus:border-secondary focus:ring-[3px] focus:ring-secondary/15 ${nameError ? "border-status-danger ring-[3px] ring-status-danger/10" : "border-border/40"}` |
| 5 | `<span className="text-[11px] text-red-500 font-medium">Please enter your name</span>` | `<span className="text-[11px] text-status-danger font-medium">Please enter your name</span>` |
| 6 | `box-border transition-all duration-150 focus:border-secondary focus:shadow-[0_0_0_3px_rgba(215,122,97,0.12)]"` (email input) | `box-border transition-all duration-150 focus:border-secondary focus:ring-[3px] focus:ring-secondary/15"` |
| 7 | `bg-secondary text-white border-none rounded-sm text-[13px] font-semibold cursor-pointer whitespace-nowrap flex-shrink-0 transition-all duration-150 hover:bg-[#c46a51] active:scale-97 max-sm:self-start` (Continue) | `bg-secondary-strong text-on-secondary-strong border-none rounded-sm text-[13px] font-semibold cursor-pointer whitespace-nowrap flex-shrink-0 transition-all duration-150 hover:opacity-90 active:scale-97 max-sm:self-start` |
| 8 | `bg-primary/[0.03] border border-border rounded-sm mt-1` (CommentForm) | `bg-primary/[0.03] border border-border/15 rounded-sm mt-1` |
| 9 | `text-[13px] font-semibold text-[#2a7a4f]` | `text-[13px] font-semibold text-status-success` |
| 10 | `className="text-[#2a7a4f] flex-shrink-0"` | `className="text-status-success flex-shrink-0"` |
| 11 | `focus:border-secondary focus:shadow-[0_0_0_3px_rgba(215,122,97,0.1)] disabled:opacity-60` (textarea) | `focus:border-secondary focus:ring-[3px] focus:ring-secondary/10 disabled:opacity-60` |
| 12 | `<p className="m-0 text-[12px] text-red-500 font-medium">Something went wrong. Please try again.</p>` | `<p className="m-0 text-[12px] text-status-danger font-medium">Something went wrong. Please try again.</p>` |
| 13 | `px-[14px] py-[6px] border border-border rounded-sm bg-transparent text-text-soft` (Cancel) | `px-[14px] py-[6px] border border-border/20 rounded-sm bg-transparent text-text-muted` |
| 14 | `bg-secondary text-white border-none rounded-sm text-[12px] font-semibold cursor-pointer transition-all duration-150 hover:enabled:bg-[#c46a51]` (Send) | `bg-secondary-strong text-on-secondary-strong border-none rounded-sm text-[12px] font-semibold cursor-pointer transition-all duration-150 hover:enabled:opacity-90` |
| 15 | `bg-surface-elevated border border-border border-l-[3px] border-l-[#16a34a] rounded-sm` | `bg-surface-elevated border border-border/15 border-l-[3px] border-l-status-success rounded-sm` |
| 16 | `bg-secondary/[0.06] border border-dashed border-secondary/30 rounded-sm` | `bg-secondary/[0.06] border border-dashed border-secondary/40 rounded-sm` |
| 17 | `px-[7px] py-px bg-[#16a34a]/15 text-[#16a34a] rounded-pill` | `px-[7px] py-px bg-status-success/15 text-status-success rounded-pill` |
| 18 | `px-[7px] py-px bg-secondary/[0.12] text-secondary rounded-pill` | `px-[7px] py-px bg-secondary/[0.12] text-secondary-strong rounded-pill` |
| 19 | `mt-2 bg-background border-l-[3px] border-[#16a34a] rounded-sm` | `mt-2 bg-background border-l-[3px] border-status-success rounded-sm` |
| 20 | `text-[10px] font-bold uppercase tracking-[0.04em] text-[#16a34a]` | `text-[10px] font-bold uppercase tracking-[0.04em] text-status-success` |
| 21 | `border border-border rounded-sm bg-transparent text-text-soft text-[12px] font-medium cursor-pointer flex-shrink-0 transition-all duration-150 hover:bg-secondary/[0.08] hover:text-secondary hover:border-secondary/30` (CommentTriggerBtn) | `border border-border/20 rounded-sm bg-transparent text-text-muted text-[12px] font-medium cursor-pointer flex-shrink-0 transition-all duration-150 hover:bg-secondary/[0.08] hover:text-secondary-strong hover:border-secondary/30` |
| 22 | `mt-6 px-5 py-[22px] bg-primary/[0.03] border border-border rounded-md` (General Feedback) | `mt-6 px-5 py-[22px] bg-primary/[0.03] border border-border/15 rounded-md` |

- [ ] **Step 4: Replace the colours in `ProposalRating.jsx`**

1. At both lines 59 and 103, replace `: "var(--text-muted, #9ca3af)",` with:

```js
            : "var(--color-text-soft)",
```

(`--text-muted` is not defined anywhere, so the hex fallback always applied. `--color-text-soft` is the theme token, and it flips in dark mode.)

2. In the Submit rating button (line 315), replace `bg-secondary text-white` with `bg-secondary-strong text-on-secondary-strong`, and `hover:enabled:bg-[#c46a51]` with `hover:enabled:opacity-90`.

3. In the rating comment textarea (line 283), replace `focus:shadow-[0_0_0_3px_rgba(215,122,97,0.1)]` with `focus:ring-[3px] focus:ring-secondary/10`.

4. In both error paragraphs (lines 246 and 296), replace `text-red-500` with `text-status-danger`.

- [ ] **Step 5: Run the guard and every share-related test**

Run: `npx vitest run tests/share-page-design-tokens.test.js tests/share-stop-card.test.jsx tests/share-page-layout.test.jsx tests/share-header.test.jsx tests/share-page-pdf.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx tests/theme-safe-classes.test.js --pool=threads`
Expected: PASS (all eight files). If the guard still lists a line, fix that line the same way. Don't add an exemption.

- [ ] **Step 6: Commit**

```bash
git add "app/itinerary/view/[token]/page.jsx" "app/itinerary/view/[token]/components/ProposalRating.jsx" tests/share-page-design-tokens.test.js
git commit -m "style(share): theme tokens for comments and rating, with a colour guard"
```

---

### Task 9: The Itineraries tab hides its empty top bar

This is Design decision 7. The Dashboard tab already uses the compact bar, which is hidden at 900px and wider and holds only the menu button and logo on phones. The Itineraries tab gets the same bar.

**Files:**
- Modify: `app/components/trip-dashboard/layout/DashboardHeader.jsx` (doc comment and props at 5-47, centre actions at 70)
- Modify: `app/components/trip-dashboard/HomePage.jsx` (import at 38; `<DashboardHeader` props at 677-704)
- Test: `tests/dashboard-rail.test.jsx`

- [ ] **Step 1: Write the failing test**

In `tests/dashboard-rail.test.jsx`, replace `import DashboardHeader from "../app/components/trip-dashboard/layout/DashboardHeader.jsx";` with:

```js
import DashboardHeader, { headerVariantForTab } from "../app/components/trip-dashboard/layout/DashboardHeader.jsx";
```

Then add these tests at the end of `describe("DashboardHeader", () => { … })`:

```jsx
  it.each([
    ["dashboard", "compact"],
    ["itineraries", "compact"],
    ["command-center", "full"],
    ["settings", "full"],
    ["admin", "full"],
  ])("gives the %s tab the %s bar", (tab, variant) => {
    expect(headerVariantForTab(tab)).toBe(variant);
  });

  it("keeps only the phone menu button and the logo in the compact bar, and hides it on desktop", () => {
    render(<DashboardHeader variant="compact" isSidebarOpen={false} setIsSidebarOpen={() => {}} liveStatus="Ready" />);

    expect(screen.getByRole("banner").className).toContain("min-[900px]:hidden");
    expect(screen.getByRole("button", { name: "Toggle menu" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Voyage" })).toBeInTheDocument();
    expect(screen.queryByText("Ready")).toBeNull();
  });
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/dashboard-rail.test.jsx --pool=threads`
Expected: FAIL. The five `headerVariantForTab` cases throw `TypeError: headerVariantForTab is not a function`. The compact-bar test already passes; it pins the behaviour the Itineraries tab now relies on.

- [ ] **Step 3: Add the helper and drop the itineraries special case**

In `app/components/trip-dashboard/layout/DashboardHeader.jsx`, replace the doc comment above `export default function DashboardHeader(`:

```jsx
/**
 * Top bar for the Command Center, Itineraries, Settings and Admin tabs:
 * New Itinerary, the client/trip switcher, "Save to Client" and the agent's
 * live status. The brand and the account live in the rail.
 *
 * `variant="compact"` (Dashboard tab) keeps only the menu button and the
 * logo. It is always rendered and hidden on desktop with CSS, so phones never
 * wait on JS to show the menu button (no pop-in); the Dashboard has its own
 * greeting row there.
 */
```

with:

```jsx
// Tabs whose page draws its own title row. Their bar only shows on phones,
// where it holds the menu button and the logo.
const COMPACT_TABS = new Set(["dashboard", "itineraries"]);

export function headerVariantForTab(tab) {
  return COMPACT_TABS.has(tab) ? "compact" : "full";
}

/**
 * Top bar for the Command Center, Settings and Admin tabs: New Itinerary, the
 * client/trip switcher, "Save to Client" and the agent's live status. The brand
 * and the account live in the rail.
 *
 * `variant="compact"` (the Dashboard and Itineraries tabs, see
 * `headerVariantForTab`) keeps only the menu button and the logo. It is always
 * rendered and hidden on desktop with CSS, so phones never wait on JS to show
 * the menu button (no pop-in); those pages have their own title row there.
 */
```

In the same file:
1. Delete the `  activeTab,` line from the props.
2. Replace:

```jsx
  const isFull = variant === "full";
  const showCenterActions = isFull && activeTab !== "itineraries";
```

with:

```jsx
  const isFull = variant === "full";
```

3. Replace `{showCenterActions && (` with `{isFull && (`.

- [ ] **Step 4: Use the helper in HomePage**

In `app/components/trip-dashboard/HomePage.jsx`:

1. Replace `import DashboardHeader from "./layout/DashboardHeader.jsx";` with:

```js
import DashboardHeader, { headerVariantForTab } from "./layout/DashboardHeader.jsx";
```

2. Replace `variant={currentTab === "dashboard" ? "compact" : "full"}` with:

```jsx
              variant={headerVariantForTab(currentTab)}
```

3. In the same `<DashboardHeader` element, delete the line `activeTab={currentTab}`, the one right after `getInitials={getInitials}`. Leave `DashboardSidebar`'s `activeTab` alone.
4. Replace `safeOptions={currentTab === "itineraries" ? effectivePlanningOptions.filter(o => o.type !== "draft") : effectivePlanningOptions}` with:

```jsx
              safeOptions={effectivePlanningOptions}
```

The filter only ran on the Itineraries tab, which no longer renders the switcher.

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/dashboard-rail.test.jsx --pool=threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/trip-dashboard/layout/DashboardHeader.jsx app/components/trip-dashboard/HomePage.jsx tests/dashboard-rail.test.jsx
git commit -m "feat(itineraries): hide the empty top bar on desktop, like the Dashboard tab"
```

---

### Task 10: One header for the Itineraries workspace

**Required skills:** `ui-ux-pro-max`, `frontend-design`, `emil-design-eng`, applied within Design decision 8 (the user approved its mockup).

**Files:**
- Modify: `app/lib/trip-dashboard/savedItineraries.js` (after `getStableItineraryId`, line 30-33)
- Modify: `app/components/ratedHistory/entryPoints/ReuseButton.jsx`
- Modify: `app/components/trip-dashboard/pages/ItineraryHeader.jsx` (whole file)
- Modify: `app/components/trip-dashboard/pages/ClientItineraryPage.jsx` (`savedItineraries.js` import at 12-18; new `handleApproveTrip` after `handleDeleteClient`; mobile client count at 472; `<ItineraryHeader` props at 682-710; status row at 739-765)
- Modify: `app/components/trip-dashboard/pages/ClientList.jsx` (imports at 3-5; count at 92)
- Test: `tests/saved-itinerary-count.test.js`, `tests/client-list.test.jsx`, `tests/itinerary-header.test.jsx` (create); `tests/reuseButton.smoke.test.jsx`, `tests/client-itinerary-approve.test.jsx` (modify)

- [ ] **Step 1: Write the failing count tests**

Create `tests/saved-itinerary-count.test.js`:

```js
import { describe, expect, it } from "vitest";
import { formatSavedItineraryCount } from "../app/lib/trip-dashboard/savedItineraries.js";

describe("formatSavedItineraryCount", () => {
  it.each([
    [0, "0 saved itineraries"],
    [1, "1 saved itinerary"],
    [2, "2 saved itineraries"],
  ])("counts %i", (count, text) => {
    expect(formatSavedItineraryCount(count)).toBe(text);
  });
});
```

Create `tests/client-list.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// components/icons/index.js contains JSX in a .js file, which vitest cannot parse.
vi.mock("../app/components/icons/index.js", () => ({ SearchIcon: () => null, TrashIcon: () => null, UsersIcon: () => null }));

import ClientList from "../app/components/trip-dashboard/pages/ClientList.jsx";

describe("ClientList", () => {
  it("counts saved itineraries in the singular and the plural", () => {
    const clients = [
      { id: "c1", name: "Elen Cruz", trips: [{ id: "t1" }] },
      { id: "c2", name: "Leo Tan", trips: [{ id: "t2" }, { id: "t3" }] },
    ];
    render(
      <ClientList
        clients={clients}
        filteredClients={clients}
        searchQuery=""
        setSearchQuery={() => {}}
        selectedClientId="c1"
        onSelectClient={() => {}}
        onRequestDeleteClient={() => {}}
      />,
    );

    expect(screen.getByText("1 saved itinerary")).toBeInTheDocument();
    expect(screen.getByText("2 saved itineraries")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing header test**

Create `tests/itinerary-header.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// components/icons/index.js contains JSX in a .js file, which vitest cannot parse.
// A Proxy stubs whichever icon the header imports.
vi.mock("../app/components/icons/index.js", () => {
  const Icon = () => null;
  const isIcon = (name) => typeof name === "string" && name !== "then";
  // vitest checks `name in module` before reading an export, so answer `has` too.
  return new Proxy(
    { __esModule: true },
    {
      get: (target, name) => (name in target ? target[name] : isIcon(name) ? Icon : undefined),
      has: (target, name) => name in target || isIcon(name),
    },
  );
});
// The launcher fetches rated trips; its button has its own test (reuseButton.smoke.test.jsx).
vi.mock("../app/components/ratedHistory/entryPoints/ReuseLauncher.jsx", () => ({ default: () => null }));

import ItineraryHeader from "../app/components/trip-dashboard/pages/ItineraryHeader.jsx";

const inReview = { id: "t1", approvalStatus: "In review" };
const client = { id: "danang", name: "Danang", trips: [inReview] };

function renderHeader(props = {}) {
  const handlers = {
    onBackToList: vi.fn(),
    onAddTripForClient: vi.fn(),
    onToggleComments: vi.fn(),
    onShare: vi.fn(),
    onDownloadPdf: vi.fn(),
  };
  const utils = render(
    <ItineraryHeader
      selectedClient={client}
      selectedTrip={inReview}
      selectedItineraryId="iter-1"
      fullItinerary={{ id: "iter-1", days: [] }}
      unreadCommentCount={0}
      pdfLoading={false}
      showCommentsPanel={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, handlers };
}

describe("ItineraryHeader", () => {
  it("shows the client's full name as the page's serif title, at the font's real weight", () => {
    renderHeader();
    const title = screen.getByRole("heading", { level: 2, name: "Danang" });

    expect(title).toHaveAttribute("title", "Danang");
    expect(title.className).toContain("font-serif");
    expect(title.className).not.toMatch(/font-(semibold|bold|extrabold|black)/);
  });

  it("puts the status, the saved count and New trip on one line under the name", () => {
    const { handlers } = renderHeader();

    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByText("1 saved itinerary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New trip for Danang" }));
    expect(handlers.onAddTripForClient).toHaveBeenCalledWith("Danang");
  });

  it("drops the Saved itineraries badge and the old count", () => {
    renderHeader();

    expect(screen.queryByText("Saved itineraries")).toBeNull();
    expect(screen.queryByText("1 saved")).toBeNull();
  });

  it.each([
    ["In review", "bg-status-warning"],
    ["Approved", "bg-status-success"],
  ])("colours the dot for %s", (approvalStatus, dotClass) => {
    renderHeader({ selectedTrip: { id: "t1", approvalStatus } });

    const dot = screen.getByText(approvalStatus).querySelector('[aria-hidden="true"]');
    expect(dot.className).toContain(dotClass);
  });

  it("offers Approve as the one filled action, inside the actions group", () => {
    const onApprove = vi.fn();
    const { container } = renderHeader({ onApprove });
    const approve = screen.getByRole("button", { name: "Approve" });

    expect(container.querySelector('[data-tour-target="cip-actions"]')).toContainElement(approve);
    expect(approve.className).toContain("bg-secondary-strong");
    expect(approve.className).toContain("text-on-secondary-strong");
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("disables Approve while the request runs", () => {
    renderHeader({ onApprove: vi.fn(), isApproving: true });

    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
  });

  it("shows no Approve without a handler", () => {
    renderHeader({ selectedTrip: { id: "t1", approvalStatus: "Approved" } });

    expect(screen.queryByRole("button", { name: /approv/i })).toBeNull();
  });

  it("marks open Comments with the contrast-safe terracotta", () => {
    renderHeader({ showCommentsPanel: true });
    const comments = screen.getByRole("button", { name: "Comments" });

    expect(comments).toHaveAttribute("aria-pressed", "true");
    expect(comments.className).toContain("bg-secondary-strong");
    expect(comments.className).toContain("text-on-secondary-strong");
    expect(comments.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("drops action labels when the header itself is narrow (container query)", () => {
    const { container } = renderHeader();

    expect(container.querySelector("header").className).toContain("@container");
    for (const label of ["Comments", "Share", "PDF"]) {
      const span = screen.getByText(label);
      expect(span.className).toContain("hidden");
      expect(span.className).toContain("@min-[720px]:inline");
    }
  });
});
```

- [ ] **Step 3: Extend the Reuse button and Approve tests**

Add at the end of `describe("ReuseButton", () => { … })` in `tests/reuseButton.smoke.test.jsx`:

```jsx
  it("lets the itinerary header's width decide whether the label shows", () => {
    render(<ReuseButton onClick={vi.fn()} count={4} mode="clientItinerary" />);
    const label = screen.getByText("Reuse");

    expect(label.className).toContain("hidden");
    expect(label.className).toContain("@min-[720px]:inline");
  });

  it("keeps the viewport rule in the editor", () => {
    render(<ReuseButton onClick={vi.fn()} count={4} mode="editor" />);

    expect(screen.getByText("Reuse").className).toContain("sm:inline");
  });
```

Add at the end of `describe("Approve button on ClientItineraryPage", () => { … })` in `tests/client-itinerary-approve.test.jsx`:

```jsx
  it("puts Approve in the header's actions instead of a separate status row", async () => {
    const { container } = render(
      <ClientItineraryPage agencyTrips={[inReviewTrip]} agencyId="agency-1" onTripStatusChange={vi.fn()} />
    );

    const approve = await screen.findByRole("button", { name: /^approve$/i });
    expect(container.querySelector('[data-tour-target="cip-actions"]')).toContainElement(approve);
    expect(screen.queryByText("Status: In review")).toBeNull();
  });
```

- [ ] **Step 4: Run the tests and check that they fail**

Run: `npx vitest run tests/saved-itinerary-count.test.js tests/client-list.test.jsx tests/itinerary-header.test.jsx tests/reuseButton.smoke.test.jsx tests/client-itinerary-approve.test.jsx --pool=threads`

Expected: FAIL, and the existing cases keep passing, as does "shows no Approve without a handler" (it guards the new behaviour from the start). The new failures:
- `formatSavedItineraryCount is not a function`;
- the client list still says "1 saved itineraries";
- the header is missing several things: a `title` on the name, the "1 saved itinerary" text, `onApprove` support and `@container`. It also still uses `bg-secondary text-white` for open Comments;
- the Reuse label has no `@min-[720px]:inline`;
- Approve still sits in the status row, outside `cip-actions`.

- [ ] **Step 5: Add the count helper**

In `app/lib/trip-dashboard/savedItineraries.js`, directly after the `getStableItineraryId` function, add:

```js

/** "1 saved itinerary", "2 saved itineraries". */
export function formatSavedItineraryCount(count) {
  return `${count} saved ${count === 1 ? "itinerary" : "itineraries"}`;
}
```

It lives here, not in `lib/formatters.js`: the `ClientItineraryPage` tests mock `formatters.js` with a fixed list of exports, and a new export there would be missing from those mocks.

- [ ] **Step 6: Let the Reuse label follow the header**

In `app/components/ratedHistory/entryPoints/ReuseButton.jsx`:

1. After `const badgeLabel = count > 99 ? "99+" : count;` add:

```jsx
  // In the itinerary header the label follows the header's own width, like the
  // buttons beside it (ItineraryHeader is the size container); elsewhere it
  // follows the viewport.
  const inHeader = mode === "clientItinerary";
```

2. In the button's `className`, replace `min-w-[40px] min-h-[40px] px-2 sm:px-3.5 rounded-lg` with:

```jsx
min-w-[40px] min-h-[40px] ${inHeader ? "px-2 @min-[720px]:px-3.5" : "px-2 sm:px-3.5"} rounded-lg
```

3. Replace `<span className="hidden sm:inline">Reuse</span>` with:

```jsx
      <span className={inHeader ? "hidden @min-[720px]:inline" : "hidden sm:inline"}>Reuse</span>
```

- [ ] **Step 7: Rewrite the header**

Replace the whole of `app/components/trip-dashboard/pages/ItineraryHeader.jsx` with:

```jsx
// ItineraryHeader — the workspace's page header: client name, a status and count line, and the trip's actions. Extracted from ClientItineraryPage.jsx.

import { Spinner } from "../../ui/index.js";
import {
  ArrowLeftIcon,
  PlusIcon,
  ChatIcon,
  ShareIcon,
  DownloadIcon,
} from "../../icons/index.js";
import { formatSavedItineraryCount, getSavedStatusLabel } from "../../../lib/trip-dashboard/savedItineraries.js";
import { getSavedStatusClass } from "../../../lib/formatters.js";
import ReuseLauncher from "../../ratedHistory/entryPoints/ReuseLauncher.jsx";

// The header is a size container (`@container`). Under 720px of its own width the
// actions drop their visible label but keep the icon, tooltip and aria-label, so the
// row never wraps or cuts the client's name off. ReuseButton follows the same rule
// in its "clientItinerary" mode.
const ACTION_BUTTON =
  "inline-flex items-center justify-center gap-2 min-w-[40px] min-h-[40px] px-2 @min-[720px]:px-3.5 rounded-lg border text-[0.85rem] font-bold cursor-pointer transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";
const ACTION_IDLE = "bg-surface-elevated text-text-primary border-border/20 hover:bg-surface hover:border-border/40";
const ACTION_LABEL = "hidden @min-[720px]:inline";

// In review waits on the agent, approved is done, anything else is neutral.
function statusDotClass(label) {
  if (/review/i.test(label)) return "bg-status-warning";
  return getSavedStatusClass(label) === "approved" ? "bg-status-success" : "bg-text-soft";
}

export default function ItineraryHeader({
  selectedClient,
  selectedTrip,
  selectedItineraryId,
  fullItinerary,
  unreadCommentCount,
  pdfLoading,
  showCommentsPanel,
  onBackToList,
  onAddTripForClient,
  onToggleComments,
  onShare,
  onDownloadPdf,
  // Approve shows only when the page passes a handler (the trip is in review).
  onApprove = null,
  isApproving = false,
  // Reuse launcher props (optional for Stage 6A)
  agencyId = null,
  currentTrip = null,
  targetItineraryId = null,
  currentVersion = null,
  onReuseInserted = null,
}) {
  const rawStatus = selectedTrip ? getSavedStatusLabel(selectedTrip) : "";
  // Tutorial data stores lowercase labels ("client approved").
  const statusLabel = rawStatus ? rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1) : "";

  return (
    <>
      {/* Back to the client list (single-column layout below lg) */}
      <button
        type="button"
        onClick={onBackToList}
        className="lg:hidden flex items-center gap-2 px-4 py-3 text-sm font-semibold text-text-muted border-b border-border/10 bg-transparent cursor-pointer hover:text-text-primary transition-colors"
      >
        <ArrowLeftIcon width={16} height={16} />
        All clients
      </button>
      <header className="@container flex-shrink-0 border-b border-border/10 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="m-0 truncate font-serif text-[28px] leading-tight" title={selectedClient.name}>
              {selectedClient.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-text-muted">
              {statusLabel ? (
                <>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-text-primary">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusDotClass(statusLabel)}`} />
                    {statusLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span>{formatSavedItineraryCount(selectedClient.trips.length)}</span>
              {onAddTripForClient ? (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onAddTripForClient(selectedClient.name)}
                    aria-label={`New trip for ${selectedClient.name}`}
                    title={`Start a new trip for ${selectedClient.name}`}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded-md bg-transparent font-semibold text-secondary-strong underline-offset-2 hover:underline"
                  >
                    <PlusIcon width={12} height={12} strokeWidth={2.5} aria-hidden="true" />
                    New trip
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div data-tour-target="cip-actions" className="flex flex-shrink-0 items-center gap-2">
            {selectedItineraryId && (
              <>
                {/* Reuse from rated trips — optional launcher for Stage 6A */}
                {agencyId && currentTrip && targetItineraryId && currentVersion !== null && (
                  <ReuseLauncher
                    agencyId={agencyId}
                    currentTrip={currentTrip}
                    targetTripId={currentTrip.tripId}
                    targetItineraryId={targetItineraryId}
                    currentVersion={currentVersion}
                    mode="clientItinerary"
                    onInserted={onReuseInserted || (() => {})}
                  />
                )}

                <button
                  type="button"
                  className={`${ACTION_BUTTON} ${showCommentsPanel ? "bg-secondary-strong text-on-secondary-strong border-secondary-strong" : ACTION_IDLE}`}
                  onClick={onToggleComments}
                  title="View client comments"
                  aria-label="Comments"
                  aria-pressed={showCommentsPanel}
                >
                  <ChatIcon width={14} height={14} aria-hidden="true" />
                  <span className={ACTION_LABEL}>Comments</span>
                  {unreadCommentCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill bg-[#dc2626] text-white text-[0.65rem] font-extrabold leading-none flex-shrink-0">
                      {unreadCommentCount > 99 ? "99+" : unreadCommentCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  className={`${ACTION_BUTTON} ${ACTION_IDLE}`}
                  onClick={onShare}
                  title="Share itinerary"
                  aria-label="Share"
                >
                  <ShareIcon width={14} height={14} aria-hidden="true" />
                  <span className={ACTION_LABEL}>Share</span>
                </button>

                <button
                  type="button"
                  className={`${ACTION_BUTTON} ${ACTION_IDLE} ${pdfLoading ? "opacity-60 cursor-not-allowed pointer-events-none" : ""}`}
                  onClick={onDownloadPdf}
                  disabled={pdfLoading || !fullItinerary}
                  title="Download itinerary as PDF"
                  aria-label="Download PDF"
                >
                  {pdfLoading ? <Spinner size="sm" /> : <DownloadIcon width={14} height={14} aria-hidden="true" />}
                  <span className={ACTION_LABEL}>{pdfLoading ? "Generating..." : "PDF"}</span>
                </button>
              </>
            )}

            {onApprove ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={isApproving}
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-secondary-strong px-4 text-[0.85rem] font-semibold text-on-secondary-strong transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
              >
                {isApproving ? "Approving…" : "Approve"}
              </button>
            ) : null}
          </div>
        </div>
      </header>
    </>
  );
}
```

The header uses only icons and helpers that the existing `ClientItineraryPage` test mocks already export. That's `ArrowLeftIcon`, `PlusIcon`, `ChatIcon`, `ShareIcon` and `DownloadIcon`, plus `getSavedStatusClass` from `formatters.js`. Keep it that way.

- [ ] **Step 8: Wire the page**

In `app/components/trip-dashboard/pages/ClientItineraryPage.jsx`:

1. Add `formatSavedItineraryCount,` as the first name in the `savedItineraries.js` import:

```js
import {
  formatSavedItineraryCount,
  getSavedItineraryTrips,
  getStableItineraryId,
  groupSavedTripsByClient,
  normalizeItineraryResponse,
  resolveSavedPortfolioSelection,
} from "../../../lib/trip-dashboard/savedItineraries.js";
```

2. Directly after the `handleDeleteClient` function, add:

```js
  // Optimistic: the trip shows as approved at once and rolls back if the request fails.
  const handleApproveTrip = async () => {
    if (!selectedTrip) return;
    const trip = selectedTrip;
    const previous = trip.approvalStatus;
    setApprovingTripId(trip.id);
    onTripStatusChange?.(trip.id, "Approved");
    try {
      await approveClientTrip(agencyId, trip.id);
    } catch (err) {
      onTripStatusChange?.(trip.id, previous);
      console.error(err);
    } finally {
      setApprovingTripId(null);
    }
  };
```

3. In the `<ItineraryHeader` element, add these two props directly after `onDownloadPdf={handleDownloadPdf}`:

```jsx
              onApprove={selectedTrip?.approvalStatus === "In review" ? handleApproveTrip : null}
              isApproving={Boolean(selectedTrip) && approvingTripId === selectedTrip.id}
```

4. Delete the whole status row, from `{/* Approve button — shown when selected trip is In review */}` through its closing `)}`:

```jsx
              {/* Approve button — shown when selected trip is In review */}
              {selectedTrip?.approvalStatus === "In review" && (
                <div className="flex items-center gap-3 px-6 py-2 border-b border-border/10 flex-shrink-0">
                  <span className="text-[0.75rem] font-bold text-text-soft uppercase tracking-wide">Status: In review</span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-pill bg-secondary text-white text-xs font-bold h-8 px-3 hover:-translate-y-px transition-transform disabled:opacity-50"
                    disabled={approvingTripId === selectedTrip.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setApprovingTripId(selectedTrip.id);
                      const previous = selectedTrip.approvalStatus;
                      onTripStatusChange?.(selectedTrip.id, "Approved");
                      try {
                        await approveClientTrip(agencyId, selectedTrip.id);
                      } catch (err) {
                        onTripStatusChange?.(selectedTrip.id, previous);
                        console.error(err);
                      } finally {
                        setApprovingTripId(null);
                      }
                    }}
                  >
                    {approvingTripId === selectedTrip.id ? "Approving..." : "Approve"}
                  </button>
                </div>
              )}
```

5. In the mobile client list, replace `<span className="text-[0.75rem] text-text-soft font-semibold">{c.trips.length} saved itineraries</span>` with:

```jsx
                          <span className="text-[0.75rem] text-text-soft font-semibold">{formatSavedItineraryCount(c.trips.length)}</span>
```

- [ ] **Step 9: Use the helper in the client list**

In `app/components/trip-dashboard/pages/ClientList.jsx`:

1. Add below `import { SearchIcon, TrashIcon, UsersIcon } from "../../icons/index.js";`:

```js
import { formatSavedItineraryCount } from "../../../lib/trip-dashboard/savedItineraries.js";
```

2. Replace `{c.trips.length} saved itineraries` with `{formatSavedItineraryCount(c.trips.length)}`.

- [ ] **Step 10: Run the tests**

Run: `npx vitest run tests/saved-itinerary-count.test.js tests/client-list.test.jsx tests/itinerary-header.test.jsx tests/reuseButton.smoke.test.jsx tests/client-itinerary-approve.test.jsx tests/client-itinerary-weather.test.jsx tests/client-itinerary-pdf.test.jsx tests/client-list-contrast.test.jsx --pool=threads`
Expected: PASS (all eight files).

- [ ] **Step 11: Commit**

```bash
git add app/lib/trip-dashboard/savedItineraries.js app/components/ratedHistory/entryPoints/ReuseButton.jsx app/components/trip-dashboard/pages/ItineraryHeader.jsx app/components/trip-dashboard/pages/ClientItineraryPage.jsx app/components/trip-dashboard/pages/ClientList.jsx tests/saved-itinerary-count.test.js tests/client-list.test.jsx tests/itinerary-header.test.jsx tests/reuseButton.smoke.test.jsx tests/client-itinerary-approve.test.jsx
git commit -m "feat(itineraries): one roomier workspace header with Approve inside it"
```

---

### Task 11: Headings follow the dashboard's type rule

**Required skills:** `frontend-design`, `emil-design-eng`. Check the result against Design decision 6.

**Files:**
- Modify: `app/components/trip-dashboard/pages/ClientList.jsx:35`
- Modify: `app/components/trip-dashboard/pages/ClientItineraryPage.jsx:422` (mobile "Client Directory")
- Modify: `app/components/trip-dashboard/pages/ItineraryDayView.jsx:80,136,141`
- Modify: `app/components/trip-dashboard/mobile/CompactPlaceCard.jsx:39`
- Modify: `app/components/trip-dashboard/itinerary/ShareDialog.jsx:182`
- Modify: `app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx:571`
- Modify: `app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx:137`
- Modify: `app/itinerary/view/[token]/page.jsx` (the "General Feedback" heading)
- Modify: `app/itinerary/view/[token]/components/ProposalRating.jsx:213`
- Test: `tests/heading-typography.test.js`

- [ ] **Step 1: Write the failing guard**

Create `tests/heading-typography.test.js`:

```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom replaces the global URL, so resolve from import.meta.dirname (see theme-safe-classes.test.js).
const ROOT = resolve(import.meta.dirname, "..");

// globals.css sets h1–h4 in DM Serif Display, which ships one weight (400); asking it
// for semibold or heavier makes the browser fake the bold. The dashboard's rule
// (Design decision 6): the serif, at 400, only for a page's main title; Plus Jakarta
// Sans semibold for every other heading.
const SHARE_DIR = "app/itinerary/view/[token]";
const SCOPED_FILES = [
  "app/components/trip-dashboard/pages/ClientList.jsx",
  "app/components/trip-dashboard/pages/ClientItineraryPage.jsx",
  "app/components/trip-dashboard/pages/ItineraryHeader.jsx",
  "app/components/trip-dashboard/pages/ItineraryDayView.jsx",
  "app/components/trip-dashboard/mobile/CompactPlaceCard.jsx",
  "app/components/trip-dashboard/itinerary/ShareDialog.jsx",
  "app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx",
  "app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx",
  ...sourceFiles(SHARE_DIR),
];

// [file, heading content as written in the JSX, expected font]
const EXPECTED = [
  ["app/components/trip-dashboard/pages/ClientList.jsx", "Client Directory", "sans"],
  ["app/components/trip-dashboard/pages/ClientItineraryPage.jsx", "Client Directory", "sans"],
  ["app/components/trip-dashboard/pages/ClientItineraryPage.jsx", "{selectedClient.name}", "serif"],
  ["app/components/trip-dashboard/pages/ClientItineraryPage.jsx", "No saved itineraries yet.", "serif"],
  ["app/components/trip-dashboard/pages/ItineraryHeader.jsx", "{selectedClient.name}", "serif"],
  ["app/components/trip-dashboard/pages/ItineraryDayView.jsx", "{selectedDay.title}", "sans"],
  ["app/components/trip-dashboard/pages/ItineraryDayView.jsx", "{item.title || placeName}", "sans"],
  ["app/components/trip-dashboard/itinerary/ShareDialog.jsx", "{tripTitle || \"Itinerary\"}", "serif"],
  ["app/components/trip-dashboard/itinerary/ShareDialog.jsx", "Existing Share Links", "sans"],
  ["app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx", "{tripTitle}", "sans"],
  ["app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx", "{label}", "sans"],
  [`${SHARE_DIR}/page.jsx`, "{trip.title || itinerary.title}", "serif"],
  [`${SHARE_DIR}/page.jsx`, "{day.title}", "sans"],
  [`${SHARE_DIR}/page.jsx`, "General Feedback", "sans"],
  [`${SHARE_DIR}/components/ShareStopCard.jsx`, "{item.title}", "sans"],
  [`${SHARE_DIR}/components/ProposalRating.jsx`, "Rate this proposal", "sans"],
];

const BOLD = /\bfont-(semibold|bold|extrabold|black)\b/;

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(jsx?|tsx?)$/.test(name) ? [rel] : [];
  });
}

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Every <h1>–<h6> element: its tag, its attribute text, and its content on one line.
function headings(rel) {
  return [...read(rel).matchAll(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, tag, attrs, inner]) => ({
    tag,
    attrs,
    text: inner.replace(/\s+/g, " ").trim(),
  }));
}

describe("heading typography", () => {
  it("never asks DM Serif Display for a bold weight", () => {
    const offenders = SCOPED_FILES.flatMap((rel) =>
      read(rel)
        .split("\n")
        .flatMap((line, index) => (/\bfont-serif\b/.test(line) && BOLD.test(line) ? [`${rel}:${index + 1}  ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every bold h1–h4 the sans font, since globals.css makes them serif", () => {
    const offenders = SCOPED_FILES.flatMap((rel) =>
      headings(rel)
        .filter(({ tag, attrs }) => /^h[1-4]$/.test(tag) && BOLD.test(attrs) && !/\bfont-sans\b/.test(attrs))
        .map(({ tag, text }) => `${rel} <${tag}> ${text}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each(EXPECTED)("%s: %s is %s", (rel, text, font) => {
    const matches = headings(rel).filter((heading) => heading.text === text);
    expect(matches.length).toBeGreaterThan(0);
    for (const { attrs } of matches) {
      if (font === "sans") {
        expect(attrs).toMatch(/\bfont-sans\b/);
        expect(attrs).toMatch(/\bfont-semibold\b/);
      } else {
        expect(attrs).toMatch(/\bfont-serif\b/);
        expect(attrs).not.toMatch(BOLD);
      }
    }
  });
});
```

- [ ] **Step 2: Run the guard and check that it fails**

Run: `npx vitest run tests/heading-typography.test.js --pool=threads`

Expected: FAIL in three ways:
- "never asks DM Serif Display for a bold weight" lists the photo placeholder in `ItineraryDayView.jsx` and the one in `CompactPlaceCard.jsx`.
- "gives every bold h1–h4 the sans font" lists four headings:
  - `ItineraryDayView.jsx <h4> {selectedDay.title}`
  - `ShareDialog.jsx <h3> Existing Share Links`
  - `TripSlideOver.jsx <h2> {tripTitle}`
  - `FunnelStageDetailPanel.jsx <h2> {label}`
- Nine rows of the font table fail: both "Client Directory" rows, `{selectedDay.title}`, `{item.title || placeName}`, "Existing Share Links", `{tripTitle}`, `{label}`, "General Feedback" and "Rate this proposal". Tasks 7 and 10 already satisfy the other seven rows.

- [ ] **Step 3: Apply the type rule**

Make each replacement exactly (search for the old string):

| # | File | Old | New |
|---|---|---|---|
| 1 | `ClientList.jsx` | `<h3 className="font-serif text-[1.6rem] text-text-primary m-0 tracking-tight">Client Directory</h3>` | `<h3 className="m-0 font-sans text-[15px] font-semibold tracking-normal text-text-primary">Client Directory</h3>` |
| 2 | `ClientItineraryPage.jsx` | `<h3 className="font-serif text-[1.3rem] text-text-primary m-0 tracking-tight mb-2">Client Directory</h3>` | `<h3 className="m-0 mb-2 font-sans text-[15px] font-semibold tracking-normal text-text-primary">Client Directory</h3>` |
| 3 | `ItineraryDayView.jsx` | `<h4 className="text-[1.5rem] font-extrabold m-0 text-text-primary tracking-tight">{selectedDay.title}</h4>` | `<h4 className="m-0 font-sans text-[22px] font-semibold leading-snug tracking-[-0.015em] text-text-primary">{selectedDay.title}</h4>` |
| 4 | `ItineraryDayView.jsx` | `bg-background text-text-soft text-2xl font-serif font-bold border border-border/10 shadow-inner` | `bg-background text-text-soft text-2xl font-semibold border border-border/10 shadow-inner` |
| 5 | `ItineraryDayView.jsx` | `<h5 className="m-0 text-text-primary text-[1rem] font-serif leading-tight tracking-tight">` | `<h5 className="m-0 font-sans text-[15px] font-semibold leading-snug tracking-normal text-text-primary">` |
| 6 | `CompactPlaceCard.jsx` | `text-text-soft text-lg font-serif font-bold border border-white/10` | `text-text-soft text-lg font-semibold border border-white/10` |
| 7 | `ShareDialog.jsx` | `<h3 className="m-0 mb-3.5 text-[13px] font-bold tracking-[0.01em] text-text-primary">` | `<h3 className="m-0 mb-3.5 font-sans text-[13px] font-semibold tracking-normal text-text-primary">` |
| 8 | `TripSlideOver.jsx` | `<h2 className="text-base font-extrabold text-text-primary truncate">` | `<h2 className="font-sans text-base font-semibold tracking-normal text-text-primary truncate">` |
| 9 | `FunnelStageDetailPanel.jsx` | `className="text-base font-extrabold text-text-primary"` (the `h2` with `id={headingId}`) | `className="font-sans text-base font-semibold tracking-normal text-text-primary"` |
| 10 | `page.jsx` (share) | `<h3 className="font-serif text-[17px] font-normal m-0 text-primary">General Feedback</h3>` | `<h3 className="m-0 font-sans text-[15px] font-semibold tracking-normal text-primary">General Feedback</h3>` |
| 11 | `ProposalRating.jsx` | `<h3 className="font-serif text-[17px] font-normal m-0 text-primary">` | `<h3 className="m-0 font-sans text-[15px] font-semibold tracking-normal text-primary">` |

The photo placeholders (rows 4 and 6) aren't headings, so dropping `font-serif` lets them inherit the body's Plus Jakarta Sans.

- [ ] **Step 4: Run the guard and the tests that render these components**

Run: `npx vitest run tests/heading-typography.test.js tests/client-list.test.jsx tests/client-list-contrast.test.jsx tests/accessibility-integrations.test.jsx tests/dashboard-polish.test.jsx tests/trip-slide-over-comments.test.jsx tests/trip-slide-over-focus.test.jsx tests/itinerary-header.test.jsx tests/share-page-layout.test.jsx tests/share-page-accessibility.test.jsx tests/share-page-weather.test.jsx --pool=threads`
Expected: PASS (all eleven files). If the guard lists a line that isn't in the table, fix it the same way: sans semibold for a section or card title, and the serif at 400 only for a page's main title. Don't add an exemption.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/pages/ClientList.jsx app/components/trip-dashboard/pages/ClientItineraryPage.jsx app/components/trip-dashboard/pages/ItineraryDayView.jsx app/components/trip-dashboard/mobile/CompactPlaceCard.jsx app/components/trip-dashboard/itinerary/ShareDialog.jsx "app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx" "app/agency/[agencyId]/components/dashboard/widgets/FunnelStageDetailPanel.jsx" "app/itinerary/view/[token]/page.jsx" "app/itinerary/view/[token]/components/ProposalRating.jsx" tests/heading-typography.test.js
git commit -m "style(type): dashboard heading rule on the itinerary pages, with a fake-bold guard"
```

---

### Task 12: Verify, review and QA

**Required sub-skills:** `superpowers:verification-before-completion`, `superpowers:requesting-code-review`.

- [ ] **Step 1: Full client test suite**

Run: `npx vitest run --pool=threads`
Expected: only the 8 baseline files fail (7 icon-JSX load failures + `agent-command-center-places`). Every file added or changed in this plan passes. If a different file fails, run the suite on `staging` (`git switch staging`, run, `git switch fix/share-link-theme-pdf`) to tell a regression from the baseline.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully` with no new warnings (the existing `metadataBase` warning is fine).

- [ ] **Step 3: Whole-change review (opus)**

Dispatch a reviewer on `git diff staging...fix/share-link-theme-pdf` with this plan as the spec. Ask it to check:
- the hand-off order (no `await` between tap and `deliverPdf`), blob URL lifetimes, and the iPadOS detection;
- that a rebuild never offers the previous trip's PDF;
- that the share page and comments still work for personal shares (`trip` is `null`);
- on the Itineraries tab:
  - Approve's optimistic update and rollback;
  - the tour's `cip-actions` step;
  - the Reuse label in both modes;
  - that only the Dashboard and Itineraries tabs get the compact bar;
- the Before/After/Why table (`emil-design-eng`) for the UI changes.

Fix every Critical and Important finding, then re-review.

- [ ] **Step 4: Browser QA in the built-in browser pane**

Restart `npm run dev` (OneDrive: hot reload is unreliable). Use a real share link: ask the user to paste one, or ask permission to create one from the Share dialog on a test trip. Check each row and capture a screenshot of each:

| Viewport | Theme | Check |
|---|---|---|
| 1280×800 | light | glass header with agency brand; title on 1–2 lines; stop cards; inset rounded map; PDF button shows "Preparing PDF…" then "Download PDF" |
| 1280×800 | dark | map renders dark tiles; toggling the theme in the header switches the map without a reload, and the map re-fits the stops |
| 375×812 | light | segmented Itinerary/Map switcher; header shows no "Shared itinerary" text and doesn't crowd; cards fit with no horizontal scroll; PDF button is ≥44px tall |
| 375×812 | dark | map tab is dark; comment form, chips and rating are readable |
| any | any | console has no errors; no `dark_map_id_placeholder` in the DOM |

Then check the Itineraries tab. It needs a signed-in agency session. Ask the user to sign in inside the browser pane, and never type their password. Use a client with an In review trip, or ask the user which one to use:

| Viewport | Theme | Check |
|---|---|---|
| 1280×800 | light | no top bar; the Client Directory and the workspace start at the top of the frame; the full client name; the status dot, "1 saved itinerary" and New trip on one line; labelled Reuse, Comments, Share and PDF; Approve as the only filled button |
| 1280×800 | dark | open Comments uses the strong terracotta; the day title and stop titles are in Plus Jakarta Sans; no fake-bold serif anywhere on the page |
| 1100×800 | dark | the actions are icon-only with tooltips; nothing wraps; the name isn't cut off |
| 375×812 | light | 48px bar with the menu button and the logo; the glass sheet is unchanged apart from the sans "Client Directory" and "1 saved itinerary" |
| any | any | the Dashboard tab is unchanged; the Command Center still shows its full bar with New Itinerary and the client switcher |

Don't press Approve on a real trip unless the user says so. It changes the trip's status for the whole agency.

Then reset the viewport to desktop and restore the theme you found.

- [ ] **Step 5: Real-device PDF checks (user)**

This can't run on this machine, which has no WebKit and no phone. Ask the user to tap Download PDF on a deployed preview and report what happens:

| Device | Expected |
|---|---|
| iPhone Safari | share sheet opens with the PDF; "Save to Files" works |
| iPhone home-screen app (dashboard PDF) | same share sheet |
| Android Chrome | PDF downloads (notification / Downloads) |
| Android installed app | PDF downloads |
| Messenger / Instagram in-app browser | known limit: may show "Open the PDF"; open in the browser instead |

- [ ] **Step 6: Report**

Summarise files changed, test results, QA screenshots, the device results, and the follow-ups below.

---

## Out of scope (found during the investigation)

1. **`ThemeProvider` remounts the whole app once after hydration.** It returns `<>{children}</>` before mount and `<ThemeContext.Provider>` after, and a different root element type remounts the subtree. The share page likely fetches `/shared/:token` twice per visit, which could double-count `viewCount`. Fix: always render the Provider. Needs its own tests.
2. **A malformed share token shows "Something Went Wrong".** The server's token schema returns 400, and the page only treats 404 as "Link Not Found". A truncated link copied from a chat app looks like a server outage.
3. **In-app browsers (Messenger, Instagram, Gmail) can't download blob PDFs.** The fallback link helps where a new tab can open. A complete fix is a server-rendered PDF URL (Next route handler with `Content-Disposition: attachment`), which needs proxy-signed IP forwarding and must not count as a share view.
4. **First-time visitors don't follow the system dark mode.** `ThemeProvider` defaults to light and ignores `prefers-color-scheme`.
5. **`ItineraryDraftPanel` doesn't pass `theme` to the map.** Task 1's fallback fixes it with no change there; listed so the reviewer knows it is covered.
6. **The dashboard `EmptyState` default variant still fakes bold** (`text-sm font-extrabold` on an `h3`). `tests/dashboard-polish.test.jsx` pins it on purpose ("leaves the default unchanged"), and the dashboard itself only uses the compact variant. Changing it means updating that test.
7. **Unread-count badges use raw `#dc2626`** in `ItineraryHeader`, `ClientList` and the mobile client list. It reads fine in both themes, but swapping in `bg-status-danger` would drop to about 2.8:1 with white text in dark mode (`#f87171`). It needs its own contrast decision.
8. **Phones have no Approve button on the Itineraries tab.** Approval was desktop-only before this plan and stays that way.
9. **A global guard against fake bold** (`font-synthesis-weight: none` on headings in `globals.css`) would stop this whole class of bug. It changes every remaining serif heading in the app, so do it with a full visual pass.
