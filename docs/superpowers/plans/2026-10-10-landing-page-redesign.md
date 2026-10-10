# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public `/` landing page so it explains what Voyage does by showing a real AI-planned trip, rendered with the app's own components, instead of placeholder art. The new page has no pricing section.

**Architecture:** `LandingPage.jsx` becomes a thin composition of focused section components in `app/components/landing/`. The sample trip is a frozen JSON fixture of real agent output (the "2-Day Baguio Itinerary" and its Open-Meteo forecast) in the public share-page shape. The landing page feeds it to the real share-page components: `ShareStopCard`, `StopWeatherTag`, `WeatherChip`, `DayWeatherSummary`, `StopNumberBadge`, `AskUserPanel`, `ShareQRCode`, `ProposalRating` and `useItineraryPdf`. Nothing on the landing page calls the API.
- The map is Leaflet (already in `package.json`, currently unused) with CARTO raster tiles. It loads only when its section scrolls into view.
- The PDF demo code-splits jsPDF behind `next/dynamic`.

**Tech Stack:** Next.js 16 App Router (client components), React 19, Tailwind v4 tokens from `app/globals.css`, Vitest 4 + Testing Library + jsdom, `react-leaflet@5` / `leaflet@1.9`, `qrcode.react`, jsPDF via the existing `useItineraryPdf` hook.

**Repo / branch:** Every code change is in `Voyage-Client`. This plan lives in `Voyage-Server/docs/superpowers/plans/` with the other plans. **Before Task 1, ask the user which branch to work on.** The client is currently on `feat/ask-user-tool`. Never create or switch branches without a direct yes. Run all commands from `Voyage-Client/`.

**Baseline:** 8 client test files already fail for stale reasons (see memory `project_voyage_known_test_failures`). `tests/landing-page.test.jsx` is one of them: it asserts an older landing page ("Plan smarter trips…", "For Travelers"). Task 15 rewrites it. Don't treat the other 7 as regressions.

---

## Design decisions (approved in chat, 2026-10-09 → 2026-10-10)

1. **No pricing.** Remove the "Pricing" nav item and the `#pricing` section. Don't add any price copy or pricing FAQ.
2. **No fake imagery.** No illustrated UI, gradient placeholder tiles or screenshots. Every product visual is a real app component rendering real data.
3. **Page order:** header → **A** split hero (copy + compact live sample trip) → **B** annotated full sample trip (`#sample-trip`, with 5 callouts + map) → **"After the plan"** tabs → What Voyage does → How it works → For agencies → FAQ → final CTA → footer.
4. **Sample data:** the real "2-Day Baguio Itinerary" (Lakbay agency, dated 9–10 Oct 2026) and its forecast, exported 2026-10-10. Day 2 has a live forecast (afternoon rain 1–2 PM, so the indoor stops sit in the wet hours). Day 1 shows no weather because its date had passed at export; don't invent any. Three raw Google types ("Premise", "Route", "Sublocality Level 2") were cleared so no raw type label shows. Staff-only fields were dropped. Day 2 is the default day everywhere.
5. **"After the plan" tabs:** Asks first · Share link · Client feedback · PDF and print · Approve and lock.
   - **Asks first** uses the real `ask_user` questions Voyage asked for a Mayon Volcano trip (Transport, Pace).
   - **Share link** shows the URL plus a scannable QR. The URL is `NEXT_PUBLIC_LANDING_SAMPLE_SHARE_URL` when set (a real production share, see the release checklist), else `<origin>/#sample-trip`.
   - **Client feedback** is the real stop card plus `ProposalRating` in a new `demo` mode, so nothing is sent.
   - **PDF and print** builds the real PDF of the sample trip in the browser.
   - **Approve and lock** walks Draft → Needs review → Approved (locked) → Reopen for edits.
6. **No invented social proof.** The local DB has no client comments or `TripReview`s, so there are no testimonials. "Reuse top-rated stops" and the team calendar appear only as text feature tiles.
7. **Map:** Leaflet + CARTO tiles (Voyager in light mode, Dark Matter in dark mode), the same day colours as the app (`lib/trip-dashboard/dayColors.js`), numbered pins matching the stop badges. Lazy: it mounts on scroll-in via `IntersectionObserver`, and the chunk loads with `next/dynamic({ ssr: false })`. Wheel zoom is off so the page scrolls normally.
8. **CTAs:**
   - "Start planning" goes to `/login?mode=register` (the login page already honours `mode=register`).
   - "Log in" goes to `/login`.
   - "Watch the demo" opens the existing `VideoModal`, which this plan makes a proper dialog.
9. **Type rule:** serif (`font-serif font-normal`) only on the one `<h1>`. Every other heading uses `font-sans font-semibold`, because `globals.css` defaults h1–h4 to the serif and a bold serif gets faked. Task 16 enforces this with `tests/heading-typography.test.js`.
10. **Contrast:** filled buttons use `bg-secondary-strong text-on-secondary-strong`: 5.2:1 in light mode (#ad5238 / white) and about 7:1 in dark mode (#e0906f / #111416). Never white on `bg-secondary`, which is 3.07:1 light and 2.50:1 dark. Overlines use `text-secondary-strong`, never `text-text-soft` (3.07:1).
11. **Touch targets:** every interactive control is at least 44px tall (`min-h-11` / `h-11`).

## File structure

| File | Responsibility |
|---|---|
| `tests/helpers/iconsMock.js` (new) | Inert stand-ins for every export of `app/components/icons/index.js`, which has JSX in a `.js` file that Vitest can't parse |
| `app/components/landing/sample/sampleTrip.json` (new) | Frozen real sample trip + forecast (public share shape) |
| `app/components/landing/sample/sampleTrip.js` (new) | Reads the fixture: days, weather map, map stops, PDF input, ask_user questions, sample share URL |
| `app/itinerary/view/[token]/components/stopDisplay.jsx` (new) | `formatTimeRange` + `itemTypeIcon`, moved out of the share page so the landing page reuses them |
| `app/itinerary/view/[token]/components/ShareStopCard.jsx` (modify) | Add a `compact` prop for the hero |
| `app/components/trip-dashboard/command-center/AnswerPairs.jsx` (new) | The answered-questions list, moved out of `ChatMessage.jsx` |
| `app/components/trip-dashboard/command-center/AskUserPanel.jsx` (modify) | `focusOnMount` prop; dismiss link only when `onDismiss` is given |
| `app/itinerary/view/[token]/components/ProposalRating.jsx` (modify) | `demo` prop: save locally, never POST |
| `app/components/trip-dashboard/itinerary/ShareLinkResult.jsx` (new) | The "Share link ready" view (URL, Copy, QR), extracted from `ShareLinkPanel` |
| `app/components/landing/landingContent.js` (new) | All landing copy as data (nav, callouts, tabs, features, steps, audiences, FAQ) |
| `app/components/landing/landingClasses.js` (new) | Shared button class strings |
| `app/components/landing/SampleDay.jsx` (new) | `SampleDayHeader` + `SampleDayView` (a day of real stop cards) |
| `app/hooks/useInView.js` (new) | One-shot "has this element come near the viewport" hook |
| `app/components/landing/SampleTripMap.jsx` (new) | The Leaflet map (client-only) |
| `app/components/landing/LazySampleTripMap.jsx` (new) | Mounts the map on scroll-in via `next/dynamic` |
| `app/components/landing/LandingHeader.jsx` (new) | Sticky pill header |
| `app/components/landing/LandingHero.jsx` (new) | Design A hero |
| `app/components/landing/SampleTripSection.jsx` (new) | Design B annotated sample + map |
| `app/components/landing/after-the-plan/*.jsx` (new) | `AfterThePlanTabs` + 5 demo panels |
| `app/components/landing/LandingSections.jsx` (new) | What it does, How it works, For agencies, FAQ, final CTA, footer |
| `app/components/landing/VideoModal.jsx` (modify) | Dialog semantics, focus move/trap/restore |
| `app/components/landing/LandingPage.jsx` (rewrite) | Composition only |
| `app/page.jsx:170` (modify) | Wire `onStartPlanning` → `/login?mode=register` |
| `scripts/capture-landing-sample.mjs` (new) | Re-capture the fixture from any public share (for the production QR) |

---

### Task 1: Icons test mock

**Files:**
- Create: `tests/helpers/iconsMock.js`

- [ ] **Step 1: Create the helper**

```js
// app/components/icons/index.js has JSX in a .js file, which Vitest can't parse.
// Tests mock it with inert components:
//   vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
const NAMES = [
  "SearchIcon", "CloseIcon", "CheckIcon", "ReplyIcon", "ChatIcon", "MapPinIcon", "ArrowLeftIcon", "TrashIcon",
  "DownloadIcon", "PrinterIcon", "ShareIcon", "SettingsIcon", "UserIcon", "MailIcon", "LockIcon", "ShieldIcon",
  "HomeIcon", "PhoneIcon", "GlobeIcon", "ChevronDownIcon", "EyeIcon", "EyeOffIcon", "BuildingIcon", "PlusIcon",
  "CalendarIcon", "StarIcon", "PlaneIcon", "HotelIcon", "ForkKnifeIcon", "CarIcon", "ListIcon", "MapIcon",
  "SparkleIcon", "UsersIcon", "UserGroupIcon", "ZapIcon", "CommentIcon", "BookmarkIcon", "LinkIcon", "RefreshIcon",
  "CheckCircleIcon", "ChevronLeftIcon", "ArrowRightIcon", "PresenterIcon", "SortIcon", "MoreIcon", "PencilIcon",
];

const iconsMock = Object.fromEntries(NAMES.map((name) => [name, () => null]));

export default iconsMock;
```

- [ ] **Step 2: Check the list is complete**

Run: `grep -oE "export (function|const) [A-Za-z]+Icon" app/components/icons/index.js | wc -l`
Expected: `47`, the length of `NAMES`. If the count differs, add the missing names.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/iconsMock.js
git commit -m "test: shared inert icons mock for component tests"
```

---

### Task 2: Sample trip fixture and reader

**Files:**
- Create: `app/components/landing/sample/sampleTrip.json` (copy of `Voyage-Server/docs/superpowers/plans/assets/2026-10-10-landing-sample-trip.json`)
- Create: `app/components/landing/sample/sampleTrip.js`
- Test: `tests/landing-sample-trip.test.js`

- [ ] **Step 1: Copy the fixture**

Run: `mkdir -p app/components/landing/sample && cp ../Voyage-Server/docs/superpowers/plans/assets/2026-10-10-landing-sample-trip.json app/components/landing/sample/sampleTrip.json`
Expected: the file exists and is about 19 KB. Its top-level keys are `_source, brand, trip, itinerary, weather`.

- [ ] **Step 2: Write the failing test**

```js
// tests/landing-sample-trip.test.js
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SAMPLE_ASK_USER_QUESTIONS,
  SAMPLE_DAYS,
  SAMPLE_DAY_OPTIONS,
  SAMPLE_DEFAULT_DAY,
  SAMPLE_PDF_INPUT,
  SAMPLE_TRIP,
  getSampleDay,
  getSampleDayWeather,
  getSampleMapStops,
  getSampleShareUrl,
} from "../app/components/landing/sample/sampleTrip.js";
import { describeDayWeather, describeStopWeather } from "../app/lib/weather/weatherDisplay.js";

afterEach(() => vi.unstubAllEnvs());

describe("landing sample trip", () => {
  it("is the real 2-day Baguio trip with day 2 as the default", () => {
    expect(SAMPLE_TRIP.itinerary.title).toBe("2-Day Baguio Itinerary");
    expect(SAMPLE_DAYS.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(SAMPLE_DEFAULT_DAY).toBe(2);
    expect(SAMPLE_DAY_OPTIONS).toEqual([
      { value: "1", label: "Day 1" },
      { value: "2", label: "Day 2" },
    ]);
  });

  it("carries day 2's real forecast and per-stop outlooks", () => {
    const day2 = getSampleDay(2);
    const entry = getSampleDayWeather(day2);
    expect(describeDayWeather(entry).label).toBe("Afternoon rain, 1–2 PM");
    const mall = day2.items.find((item) => item.title === "SM City Baguio");
    expect(describeStopWeather(entry, mall.id).label).toBe("Rain likely");
  });

  it("shows no weather for day 1 rather than inventing any", () => {
    expect(describeDayWeather(getSampleDayWeather(getSampleDay(1)))).toBeNull();
  });

  it("holds no staff-only or private fields", () => {
    const text = JSON.stringify(SAMPLE_TRIP);
    for (const key of ["staffNotes", "createdByUserId", "agencyId", "clientEmail", "placeAdvisory"]) {
      expect(text).not.toContain(key);
    }
  });

  it("lists map stops with coordinates, numbered within their day", () => {
    const stops = getSampleMapStops();
    expect(stops).toHaveLength(8); // Good Shepherd Convent has no saved location
    expect(stops.find((s) => s.title === "Good Shepherd Convent")).toBeUndefined();
    expect(stops.find((s) => s.title === "SM City Baguio")).toMatchObject({ dayNumber: 2, stopNumber: 4 });
    expect(stops[0].color).toEqual({ fill: "#B4532A", border: "#7C2D12" });
  });

  it("builds the PDF input the share page would, with weather attached", () => {
    expect(SAMPLE_PDF_INPUT.title).toBe("2-Day Baguio Itinerary");
    expect(SAMPLE_PDF_INPUT.agencyName).toBe("Lakbay");
    expect(SAMPLE_PDF_INPUT.days[1].weatherEntry.status).toBe("OK");
  });

  it("uses the real ask_user questions", () => {
    expect(SAMPLE_ASK_USER_QUESTIONS.map((q) => q.header)).toEqual(["Transport", "Pace"]);
  });

  it("points the share link at the configured production share, else this page's sample", () => {
    expect(getSampleShareUrl("https://voyage.test")).toBe("https://voyage.test/#sample-trip");
    vi.stubEnv("NEXT_PUBLIC_LANDING_SAMPLE_SHARE_URL", "https://voyage.test/itinerary/view/abc123");
    expect(getSampleShareUrl("https://voyage.test")).toBe("https://voyage.test/itinerary/view/abc123");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/landing-sample-trip.test.js --pool=threads`
Expected: FAIL, "Failed to resolve import ../app/components/landing/sample/sampleTrip.js".

- [ ] **Step 4: Implement**

```js
// app/components/landing/sample/sampleTrip.js
import sample from "./sampleTrip.json";
import { attachWeatherToDays, buildWeatherByDayId } from "../../../lib/weather/weatherDisplay.js";
import { formatDateRange } from "../../../lib/formatters.js";
import { getDayColor } from "../../../lib/trip-dashboard/dayColors.js";

/**
 * The landing page's sample trip: real Voyage output, frozen (see sampleTrip.json's
 * `_source`). Everything here is derived from it with the app's own helpers, so the
 * landing page shows exactly what the share page would.
 */
export const SAMPLE_TRIP = sample;
export const SAMPLE_DAYS = sample.itinerary.days;
export const SAMPLE_WEATHER_BY_DAY_ID = buildWeatherByDayId(sample.weather);
export const SAMPLE_WEATHER_ATTRIBUTION = sample.weather?.attribution ?? null;

/** Day 2 has a live forecast, so the first thing a visitor sees has weather on it. */
export const SAMPLE_DEFAULT_DAY = 2;

export const SAMPLE_DAY_OPTIONS = SAMPLE_DAYS.map((day) => ({
  value: String(day.dayNumber),
  label: `Day ${day.dayNumber}`,
}));

export function getSampleDay(dayNumber) {
  return SAMPLE_DAYS.find((day) => day.dayNumber === Number(dayNumber)) ?? SAMPLE_DAYS[0];
}

export function getSampleDayWeather(day) {
  return SAMPLE_WEATHER_BY_DAY_ID.get(day?.id) ?? null;
}

/** Stops with a saved location, numbered within their day like the share page's pins. */
export function getSampleMapStops() {
  return SAMPLE_DAYS.flatMap((day) =>
    day.items.map((item, index) => ({
      id: item.id,
      title: item.title,
      dayNumber: day.dayNumber,
      stopNumber: index + 1,
      lat: item.placeSnapshot?.latitude,
      lng: item.placeSnapshot?.longitude,
      color: getDayColor(day.dayNumber),
    })),
  ).filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
}

/** generateItineraryPdf's input, built the way the share page builds it. Module-level, so it is stable. */
export const SAMPLE_PDF_INPUT = {
  title: sample.itinerary.title,
  summary: sample.itinerary.summary,
  dateRange: formatDateRange(sample.trip.startDate, sample.trip.endDate),
  travelerCount: sample.trip.travelerCount,
  days: attachWeatherToDays(SAMPLE_DAYS, SAMPLE_WEATHER_BY_DAY_ID),
  agencyName: sample.brand?.name || "Voyage",
};

/** The ask_user questions Voyage really asked an agent planning a Mayon Volcano day trip (2026-10-08). */
export const SAMPLE_ASK_USER_QUESTIONS = [
  {
    id: "q1",
    header: "Transport",
    question: "How will the travelers get around?",
    multiSelect: false,
    options: [
      { label: "Private car", description: "Most stops per day" },
      { label: "Public transit", description: "Fewer stops, station-friendly" },
      { label: "Walking" },
      { label: "A mix" },
    ],
  },
  {
    id: "q2",
    header: "Pace",
    question: "What kind of pace are you looking for?",
    multiSelect: false,
    options: [
      { label: "Relaxed", description: "Fewer stops, more leisure time" },
      { label: "Moderate", description: "A good balance of activities and free time" },
      { label: "Packed", description: "As many activities as possible" },
    ],
  },
];

/** A real production share of this trip when configured (release checklist), else this page's sample. */
export function getSampleShareUrl(origin) {
  return process.env.NEXT_PUBLIC_LANDING_SAMPLE_SHARE_URL || `${origin}/#sample-trip`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/landing-sample-trip.test.js --pool=threads`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/landing/sample tests/landing-sample-trip.test.js
git commit -m "feat(landing): real Baguio sample trip fixture and reader"
```

---

### Task 3: Share the stop helpers; compact stop card

**Files:**
- Create: `app/itinerary/view/[token]/components/stopDisplay.jsx`
- Modify: `app/itinerary/view/[token]/page.jsx` (delete `formatTime` + `formatTimeRange` at about lines 65–80 and `itemTypeIcon` at about lines 99–115; trim the icon import at lines 19–31)
- Modify: `app/itinerary/view/[token]/components/ShareStopCard.jsx`
- Test: `tests/share-stop-display.test.jsx` (new), `tests/share-stop-card.test.jsx` (add one test)

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/share-stop-display.test.jsx
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => ({
  PlaneIcon: () => <span>plane</span>,
  HotelIcon: () => <span>hotel</span>,
  ForkKnifeIcon: () => <span>fork</span>,
  CarIcon: () => <span>car</span>,
  MapPinIcon: () => <span>pin</span>,
}));

import { render, screen } from "@testing-library/react";
import { formatTimeRange, itemTypeIcon } from "../app/itinerary/view/[token]/components/stopDisplay.jsx";

describe("stop display helpers", () => {
  it("formats a time range the way the share page shows it", () => {
    expect(formatTimeRange("09:00", "10:30")).toBe("9:00 AM – 10:30 AM");
    expect(formatTimeRange("13:30", null)).toBe("1:30 PM");
    expect(formatTimeRange(null, "12:00")).toBe("Until 12:00 PM");
    expect(formatTimeRange(null, null)).toBe("");
  });

  it("picks an icon by stop type, falling back to a map pin", () => {
    render(<>{itemTypeIcon("FLIGHT")}{itemTypeIcon("dining")}{itemTypeIcon("MEAL")}</>);
    expect(screen.getByText("plane")).toBeInTheDocument();
    expect(screen.getByText("fork")).toBeInTheDocument();
    expect(screen.getByText("pin")).toBeInTheDocument();
  });
});
```

Add to `tests/share-stop-card.test.jsx`, inside `describe("ShareStopCard", …)`:

```jsx
  it("drops the description, address and notes when compact", () => {
    render(<ShareStopCard item={item} timeLabel="8:00 AM – 10:00 AM" compact />);

    expect(screen.getByText("Kiyomizu-dera", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("8:00 AM – 10:00 AM")).toBeInTheDocument();
    expect(screen.queryByText("Arrive early for the wooden stage.")).not.toBeInTheDocument();
    expect(screen.queryByText("1 Chome-294 Kiyomizu, Kyoto")).not.toBeInTheDocument();
    expect(screen.queryByText("Wear comfy shoes.")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/share-stop-display.test.jsx tests/share-stop-card.test.jsx --pool=threads`
Expected: FAIL. The new file fails to resolve `stopDisplay.jsx`; the compact test fails because the description is still rendered.

- [ ] **Step 3: Create `stopDisplay.jsx`**

```jsx
// app/itinerary/view/[token]/components/stopDisplay.jsx
import { PlaneIcon, HotelIcon, ForkKnifeIcon, CarIcon, MapPinIcon } from "../../../../components/icons/index.js";

/** "13:30" → "1:30 PM". Anything unparseable is shown as written. */
function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  if (isNaN(hour)) return timeStr;
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

/** A stop's time pill text, shared by the share page and the landing page's sample trip. */
export function formatTimeRange(start, end) {
  if (start && end) return `${formatTime(start)} – ${formatTime(end)}`;
  if (start) return formatTime(start);
  if (end) return `Until ${formatTime(end)}`;
  return "";
}

/** The tile icon a stop card shows when its place has no photo. */
export function itemTypeIcon(type) {
  switch (type?.toUpperCase()) {
    case "FLIGHT":
      return <PlaneIcon width={16} height={16} />;
    case "HOTEL":
    case "ACCOMMODATION":
      return <HotelIcon width={16} height={16} />;
    case "RESTAURANT":
    case "DINING":
      return <ForkKnifeIcon width={16} height={16} />;
    case "TRANSPORT":
    case "TRANSFER":
      return <CarIcon width={16} height={16} />;
    default:
      return <MapPinIcon width={16} height={16} />;
  }
}
```

- [ ] **Step 4: Point the share page at it**

In `app/itinerary/view/[token]/page.jsx`:
1. Delete the local `function formatTime(timeStr) { … }`, `function formatTimeRange(start, end) { … }` and `function itemTypeIcon(type) { … }`.
2. Remove `PlaneIcon,`, `HotelIcon,`, `ForkKnifeIcon,` and `CarIcon,` from the `../../../components/icons/index.js` import. Keep `MapPinIcon`, which `MapPinLink` still uses at about line 132.
3. Add after the `ShareStopCard` import:

```jsx
import { formatTimeRange, itemTypeIcon } from "./components/stopDisplay.jsx";
```

- [ ] **Step 5: Add `compact` to `ShareStopCard`**

In `app/itinerary/view/[token]/components/ShareStopCard.jsx`, change the signature and the doc comment's last sentence:

```jsx
 * like the dashboard's card titles), rating, then details. `actions` sit beside the title; `children` holds the
 * stop's comment form and comments. `compact` keeps only the header row, photo, title and rating (landing hero).
 */
export default function ShareStopCard({ item, isActive = false, timeLabel = "", icon = null, actions = null, dayWeather = null, dayNumber = null, stopNumber = null, compact = false, onHoverChange, children }) {
```

Then wrap the four detail blocks (description, place name/address, `AccessibilityBadges`, client notes) so they render only when not compact:

```jsx
      {!compact && item.description ? <p className="m-0 text-[0.85rem] leading-relaxed text-text-muted">{item.description}</p> : null}

      {!compact && snapshot?.name ? (
```

```jsx
      {compact ? null : <AccessibilityBadges snapshot={snapshot} />}

      {!compact && item.clientNotes ? (
```

- [ ] **Step 6: Run the share tests**

Run: `npx vitest run tests/share-stop-display.test.jsx tests/share-stop-card.test.jsx tests/share-page-layout.test.jsx tests/share-page-weather.test.jsx tests/share-page-accessibility.test.jsx --pool=threads`
Expected: PASS. The share page renders exactly as before.

- [ ] **Step 7: Commit**

```bash
git add "app/itinerary/view/[token]/components/stopDisplay.jsx" "app/itinerary/view/[token]/page.jsx" "app/itinerary/view/[token]/components/ShareStopCard.jsx" tests/share-stop-display.test.jsx tests/share-stop-card.test.jsx
git commit -m "refactor(share): share stop time/icon helpers; compact ShareStopCard"
```

---

### Task 4: AskUserPanel for the landing page; extract AnswerPairs

**Files:**
- Modify: `app/components/trip-dashboard/command-center/AskUserPanel.jsx`
- Create: `app/components/trip-dashboard/command-center/AnswerPairs.jsx`
- Modify: `app/components/trip-dashboard/command-center/ChatMessage.jsx:9,108-120`
- Test: `tests/ask-user-panel.test.jsx` (add two tests)

- [ ] **Step 1: Write the failing tests**

Append inside `describe("AskUserPanel", …)` in `tests/ask-user-panel.test.jsx`:

```jsx
  it("leaves focus alone on mount when focusOnMount is false (landing page demo)", () => {
    renderPanel({ focusOnMount: false });

    expect(document.body).toHaveFocus();
  });

  it("still moves focus to the next question's options after Next when focusOnMount is false", () => {
    renderPanel({ focusOnMount: false });

    fireEvent.click(screen.getByRole("radio", { name: /Private car/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("checkbox", { name: "Food" })).toHaveFocus();
  });

  it("hides the plain-reply link when there is no onDismiss", () => {
    render(<AskUserPanel questions={questions} onSubmit={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Type a normal reply instead" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ask-user-panel.test.jsx --pool=threads`
Expected: FAIL. The first test sees the radio focused, and the third finds the dismiss button.

- [ ] **Step 3: Implement**

In `AskUserPanel.jsx`, add the prop, extend the doc comment, and use the prop in the mount decision:

```jsx
/**
 * The composer while the agent waits on ask_user questions: one question at a time,
 * radio rows (checkboxes for multi-select), a free-text "Something else", and a way
 * back to the normal text box. Calls onSubmit(draft) once every question is answered.
 * `focusOnMount={false}` never takes focus on mount (the landing page shows it in
 * passing); `onDismiss` omitted hides the plain-reply link.
 */
export default function AskUserPanel({ questions, onSubmit, onDismiss, error = "", containerClassName = "", initialDraft = null, focusOnMount = true }) {
```

```jsx
      focusPlanRef.current = { step, focus: !isMount || (focusOnMount && (!active || active === document.body)) };
```

Wrap the "Type a normal reply instead" `<button …>…</button>` in `{onDismiss ? ( … ) : null}`. The sibling `<div className="ml-auto …">` keeps Back/Next on the right.

- [ ] **Step 4: Extract AnswerPairs**

```jsx
// app/components/trip-dashboard/command-center/AnswerPairs.jsx
import { Fragment } from "react";
import { answerText } from "../../../lib/agent/askUser.js";

/** An answer to the agent's ask_user questions: each header beside its answer. */
export default function AnswerPairs({ answers }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-1">
      {answers.items.map((item) => (
        <Fragment key={item.questionId}>
          <dt className="text-xs font-medium text-text-muted">{item.header}</dt>
          <dd className="m-0 min-w-0 font-medium">{answerText(item)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
```

In `ChatMessage.jsx`:
- Delete the local `function AnswerPairs` and the comment above it.
- Change line 9 to `import { getAnswers, getAskUser } from "../../../lib/agent/askUser.js";`.
- Add `import AnswerPairs from "./AnswerPairs.jsx";` after the `RichItineraryMessage` import.

- [ ] **Step 5: Run the ask_user tests**

Run: `npx vitest run tests/ask-user-panel.test.jsx tests/ask-user-history.test.jsx tests/ask-user-dispatch.test.jsx --pool=threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/trip-dashboard/command-center/AskUserPanel.jsx app/components/trip-dashboard/command-center/AnswerPairs.jsx app/components/trip-dashboard/command-center/ChatMessage.jsx tests/ask-user-panel.test.jsx
git commit -m "feat(agent): AskUserPanel focusOnMount + optional dismiss; extract AnswerPairs"
```

---

### Task 5: ProposalRating demo mode

**Files:**
- Modify: `app/itinerary/view/[token]/components/ProposalRating.jsx:116-190`
- Test: `tests/proposal-rating-demo.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/proposal-rating-demo.test.jsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ProposalRating from "../app/itinerary/view/[token]/components/ProposalRating.jsx";

afterEach(() => vi.restoreAllMocks());

describe("ProposalRating demo mode", () => {
  it("saves the rating locally and never calls the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ProposalRating token="sample" demo />);

    fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit rating" }));

    expect(await screen.findByLabelText("4 out of 5 stars")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/proposal-rating-demo.test.jsx --pool=threads`
Expected: FAIL. `fetch` is called (or rejects in jsdom), so no "4 out of 5 stars".

- [ ] **Step 3: Implement**

Add `demo = false` to the props, with a doc line:

```jsx
/** `demo` (landing page): the rating is kept on the page and never sent. */
export default function ProposalRating({
  token,
  initialRating = null,
  initialComment = null,
  initialRatedAt = null,
  demo = false,
}) {
```

Add this helper above `async function handleSubmit`, and replace the `fetch … if (!res.ok) { … throw err; }` block in `handleSubmit` with `const data = await sendRating(selectedRating, commentText.trim());`. Keep the `setSavedRating(data.rating)` lines that follow.

```jsx
  /* ── send (or, in demo mode, keep) the rating ── */
  async function sendRating(rating, comment) {
    if (demo) return { rating, comment: comment || null, ratedAt: new Date().toISOString() };
    const res = await fetch(`${API_URL}/shared/${token}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, ...(comment ? { comment } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error?.message || "Request failed");
      err.code = data.error?.code || "UNKNOWN_ERROR";
      err.status = res.status;
      throw err;
    }
    return data;
  }
```

- [ ] **Step 4: Run the rating and share tests**

Run: `npx vitest run tests/proposal-rating-demo.test.jsx tests/share-page-layout.test.jsx tests/share-page-accessibility.test.jsx --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/itinerary/view/[token]/components/ProposalRating.jsx" tests/proposal-rating-demo.test.jsx
git commit -m "feat(share): ProposalRating demo mode that never posts"
```

---

### Task 6: Extract ShareLinkResult

**Files:**
- Create: `app/components/trip-dashboard/itinerary/ShareLinkResult.jsx`
- Modify: `app/components/trip-dashboard/itinerary/ShareLinkPanel.jsx`
- Test: `tests/share-link-result.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/share-link-result.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }) => <svg data-testid="qr" data-value={value} />,
  QRCodeCanvas: () => null,
}));

import ShareLinkResult from "../app/components/trip-dashboard/itinerary/ShareLinkResult.jsx";

const URL = "https://voyage.test/itinerary/view/abc123";

describe("ShareLinkResult", () => {
  it("shows the link and a QR code for the same link", () => {
    render(<ShareLinkResult shareUrl={URL} tripTitle="2-Day Baguio" />);

    expect(screen.getByRole("heading", { name: "Share Link Ready" })).toBeInTheDocument();
    expect(screen.getByText(URL)).toBeInTheDocument();
    expect(screen.getByTestId("qr")).toHaveAttribute("data-value", URL);
  });

  it("copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareLinkResult shareUrl={URL} tripTitle="2-Day Baguio" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(URL);
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("offers another link only when the caller can make one", () => {
    const { rerender } = render(<ShareLinkResult shareUrl={URL} tripTitle="t" />);
    expect(screen.queryByRole("button", { name: "Generate another link" })).not.toBeInTheDocument();

    const onGenerateAnother = vi.fn();
    rerender(<ShareLinkResult shareUrl={URL} tripTitle="t" onGenerateAnother={onGenerateAnother} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate another link" }));
    expect(onGenerateAnother).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/share-link-result.test.jsx --pool=threads`
Expected: FAIL, the import doesn't resolve.

- [ ] **Step 3: Create `ShareLinkResult.jsx`**

The markup is `ShareLinkPanel`'s `dialogState === "result"` branch, moved unchanged. The one change: "Generate another link" renders only with `onGenerateAnother`.

```jsx
"use client";

import { useState } from "react";
import { CheckIcon, LinkIcon } from "../../icons/index.js";
import ShareQRCode from "./ShareQRCode.jsx";

/** A ready share link: the URL with Copy, its QR code, and (in the app) a way to make another. */
export default function ShareLinkResult({ shareUrl, tripTitle, onGenerateAnother }) {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopyUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  return (
    <section className="mb-1">
      <h3 className="m-0 mb-3.5 text-[13px] font-bold tracking-[0.01em] text-text-primary">
        Share Link Ready
      </h3>

      <div className="
        flex items-center gap-2.5
        px-3.5 py-2.5 mb-[18px]
        rounded-md bg-background border border-border/30
        sm:flex-row flex-col sm:items-center items-stretch
      ">
        <span
          className="flex-1 min-w-0 text-[12.5px] text-text-muted whitespace-nowrap overflow-hidden text-ellipsis font-mono"
          title={shareUrl}
        >
          {shareUrl}
        </span>
        <button
          type="button"
          className={`
            shrink-0 inline-flex items-center gap-1.5
            px-3 py-1.5
            rounded-[10px] border text-[12px] font-bold
            cursor-pointer whitespace-nowrap
            transition-[background,border-color,color] duration-150
            sm:justify-start justify-center
            ${copySuccess
              ? "bg-status-success/10 border-status-success/40 text-status-success"
              : "bg-surface-elevated border-border/30 text-text-muted hover:bg-surface hover:border-border/50"
            }
          `}
          onClick={handleCopyUrl}
          aria-label="Copy link"
        >
          {copySuccess ? (
            <>
              <CheckIcon width={13} height={13} strokeWidth={3} />
              Copied!
            </>
          ) : (
            <>
              <LinkIcon width={13} height={13} strokeWidth={2} />
              Copy
            </>
          )}
        </button>
      </div>

      <ShareQRCode shareUrl={shareUrl} tripTitle={tripTitle} />

      {onGenerateAnother ? (
        <button
          type="button"
          className="
            block mx-auto px-3 py-1.5
            border-0 bg-transparent
            text-text-soft text-[13px] font-semibold
            underline underline-offset-[3px]
            cursor-pointer
            hover:text-primary
            transition-colors duration-150
          "
          onClick={onGenerateAnother}
        >
          Generate another link
        </button>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Use it in ShareLinkPanel**

In `ShareLinkPanel.jsx`:
- Replace the whole `if (dialogState === "result") { return ( <section …> … </section> ); }` block with:

```jsx
  if (dialogState === "result") {
    return <ShareLinkResult shareUrl={shareUrl} tripTitle={tripTitle} onGenerateAnother={handleBack} />;
  }
```

- Delete `const [copySuccess, setCopySuccess] = useState(false);` and the whole `handleCopyUrl` function.
- Change the imports to:

```jsx
import { useState } from "react";
import { createItineraryShare } from "../../../lib/api/index.js";
import { LinkIcon } from "../../icons/index.js";
import { Spinner } from "../../ui/index.js";
import ShareLinkResult from "./ShareLinkResult.jsx";
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/share-link-result.test.jsx tests/client-itinerary-page.test.jsx --pool=threads`
Expected: `share-link-result` PASSES. `client-itinerary-page` has the same result as on the baseline branch.

- [ ] **Step 6: Commit**

```bash
git add app/components/trip-dashboard/itinerary/ShareLinkResult.jsx app/components/trip-dashboard/itinerary/ShareLinkPanel.jsx tests/share-link-result.test.jsx
git commit -m "refactor(share): extract ShareLinkResult from ShareLinkPanel"
```

---

### Task 7: Landing copy and button classes

**Files:**
- Create: `app/components/landing/landingContent.js`
- Create: `app/components/landing/landingClasses.js`
- Test: `tests/landing-content.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
// tests/landing-content.test.js
import { describe, expect, it } from "vitest";
import * as content from "../app/components/landing/landingContent.js";

describe("landing copy", () => {
  it("never mentions pricing", () => {
    expect(JSON.stringify(content)).not.toMatch(/pric/i);
  });

  it("links the nav to sections that exist", () => {
    const sectionIds = ["what-it-does", "how-it-works", "for-agencies", "faq"];
    expect(content.LANDING_NAV.map((link) => link.href)).toEqual(sectionIds.map((id) => `#${id}`));
  });

  it("has the five 'after the plan' tabs in order", () => {
    expect(content.AFTER_THE_PLAN_TABS.map((tab) => tab.id)).toEqual(["ask", "share", "feedback", "pdf", "approve"]);
  });

  it("keeps the sample-trip callouts to five", () => {
    expect(content.SAMPLE_CALLOUTS).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-content.test.js --pool=threads`
Expected: FAIL, the import doesn't resolve.

- [ ] **Step 3: Implement**

```js
// app/components/landing/landingContent.js
/** All landing-page copy. Data only (no JSX), so it's easy to test and edit. */

export const LANDING_NAV = [
  { label: "What it does", href: "#what-it-does" },
  { label: "How it works", href: "#how-it-works" },
  { label: "For agencies", href: "#for-agencies" },
  { label: "FAQ", href: "#faq" },
];

export const HERO = {
  overline: "AI itinerary planning for travel agencies",
  title: "Plan client trips in minutes, not hours",
  body: "Describe a trip in chat. Voyage builds a day-by-day plan with real places, opening checks and weather for every stop, ready to share as a branded link, PDF or print.",
  sampleNote: "The sample trip here is real Voyage output. Rain was forecast, so it put the views first and the indoor stops in the wet hours.",
};

export const SAMPLE_SECTION = {
  title: "A real trip, planned by Voyage",
  body: "Two days in Baguio by private car. The stops, times, notes and forecast are the AI's own output.",
};

export const SAMPLE_CALLOUTS = [
  { title: "Weather for every stop", body: "An hourly forecast for each stop, not one guess for the whole day." },
  { title: "Planned around the rain", body: "Viewpoints before 11 AM. The mall lands in the hour rain is most likely." },
  { title: "Real places, checked", body: "Photos, ratings and addresses come from Google, and closed places get flagged before your client sees them." },
  { title: "Notes your client reads", body: "Each stop carries a short note written for the traveller." },
  { title: "Matches the map", body: "Stop numbers use the same day colour as the pins on the map." },
];

export const AFTER_THE_PLAN = {
  overline: "After the plan",
  title: "From draft to a client who said yes",
  body: "The same trip, through the rest of Voyage. Everything here is the real interface, and nothing you do here is sent anywhere.",
};

export const AFTER_THE_PLAN_TABS = [
  {
    id: "ask",
    label: "Asks first",
    title: "Asks before it guesses",
    body: "When a brief leaves out something that changes the plan, Voyage asks. These are the real questions it asked an agent planning a Mayon Volcano day trip.",
  },
  {
    id: "share",
    label: "Share link",
    title: "One link for your client",
    body: "No app and no login for them. Add the client's name or an expiry date if you like, and revoke the link any time.",
  },
  {
    id: "feedback",
    label: "Client feedback",
    title: "Your client comments and rates",
    body: "Clients can comment on any stop and rate the proposal, and you can reply from Voyage. Try the rating: this one is a demo, so nothing is sent.",
  },
  {
    id: "pdf",
    label: "PDF and print",
    title: "PDF and print from the same trip",
    body: "The PDF is built in the browser from the itinerary, with times, client notes and each day's weather. Print sends that same PDF to the printer. These buttons make the real PDF of the Baguio trip.",
  },
  {
    id: "approve",
    label: "Approve and lock",
    title: "Nothing goes out without sign-off",
    body: "Agents send trips for review. Approving locks the itinerary, so it can't change after your client has seen it. Reopen it on purpose to edit.",
  },
];

/** `icon` names a key in LandingSections' FEATURE_ICONS map. */
export const FEATURES = [
  { icon: "chat", title: "Plan by chat", body: "Describe the trip. The AI drafts it and asks when something's missing." },
  { icon: "place", title: "Real places, checked", body: "Every stop is a real place, with its opening status checked." },
  { icon: "weather", title: "Weather per stop", body: "Hourly forecasts for dated trips, and typical weather for far-off dates." },
  { icon: "map", title: "A map for each day", body: "Colour-coded pins and routes, one colour per day." },
  { icon: "share", title: "Share, PDF and print", body: "A branded link your client can comment on and rate." },
  { icon: "lock", title: "Approve and lock", body: "Sign off before it goes out. Editing reopens it on purpose." },
  { icon: "star", title: "Reuse top-rated stops", body: "Pull stops from past trips your clients rated 4 or higher." },
  { icon: "calendar", title: "Team calendar", body: "Every departure, assignment and approval in one view." },
];

export const STEPS = [
  { title: "Brief", body: "Paste the client's request or type it in your own words." },
  { title: "Draft", body: "Get a mapped, checked day-by-day plan in a few minutes." },
  { title: "Refine", body: "Change it by chat or by hand, and reuse stops clients loved." },
  { title: "Share", body: "Approve it, then send a link, a PDF or a printout." },
];

export const AUDIENCES = [
  {
    title: "For agency owners",
    body: "A calendar of every departure, who's assigned, what's waiting for your approval, and how clients rated each trip.",
  },
  {
    title: "For agents",
    body: "Plan in one workspace: chat with the AI, edit stops by hand, reuse what worked, and send it for review.",
  },
];

export const FAQS = [
  {
    question: "Can I change what the AI plans?",
    answer: "Yes. Ask in chat (\"swap the museum for a café\") or edit any stop by hand: times, notes and order. Approved trips stay locked until you reopen them.",
  },
  {
    question: "What does my client see?",
    answer: "A branded web page with each day, the map, photos, your notes and the weather. They can comment on any stop, rate the proposal, and download or print a PDF. They don't need an account.",
  },
  {
    question: "Where does the weather come from?",
    answer: "Open-Meteo. Dated trips inside the forecast window get an hourly forecast for every stop. Trips further out show typical weather for those dates from past years, labelled as typical.",
  },
  {
    question: "Can my whole team use it?",
    answer: "Yes. Owners invite agents, assign trips and approve itineraries before they reach a client.",
  },
];

export const FINAL_CTA = {
  title: "Plan your next client trip with Voyage",
  body: "Start with a real request from your inbox. You'll have a draft to review in minutes.",
};
```

```js
// app/components/landing/landingClasses.js
// Filled buttons pair secondary-strong with its on- colour: 5.2:1 light, about 7:1 dark (Design decision 10).
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary";

export const PRIMARY_BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-pill border-0 bg-secondary-strong px-5 text-sm font-semibold text-on-secondary-strong no-underline transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] motion-reduce:transition-none ${FOCUS}`;

export const SECONDARY_BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-pill border border-border/25 bg-transparent px-5 text-sm font-semibold text-text-primary no-underline transition-colors duration-150 hover:bg-secondary/[0.08] ${FOCUS}`;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/landing-content.test.js --pool=threads`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/landingContent.js app/components/landing/landingClasses.js tests/landing-content.test.js
git commit -m "feat(landing): landing copy and shared button classes, no pricing"
```

---

### Task 8: Sample day components

**Files:**
- Create: `app/components/landing/SampleDay.jsx`
- Test: `tests/landing-sample-day.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-sample-day.test.jsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);

import { SampleDayHeader, SampleDayView } from "../app/components/landing/SampleDay.jsx";

describe("SampleDayView", () => {
  it("renders day 2's real stops in order with their numbers, times and weather", () => {
    render(<SampleDayView dayNumber={2} />);

    const stops = within(screen.getByRole("list", { name: "Day 2 stops" })).getAllByRole("listitem");
    expect(stops).toHaveLength(4);
    expect(within(stops[0]).getByText("Mines View Park", { selector: "h3" })).toBeInTheDocument();
    expect(within(stops[0]).getByText("9:00 AM – 10:00 AM")).toBeInTheDocument();
    expect(within(stops[0]).getByText("Likely dry")).toBeInTheDocument();
    expect(within(stops[3]).getByText("SM City Baguio", { selector: "h3" })).toBeInTheDocument();
    expect(within(stops[3]).getByText("Rain likely")).toBeInTheDocument();
    expect(within(stops[3]).getByText("Enjoy some indoor shopping or catch a movie at the mall.")).toBeInTheDocument();
  });

  it("drops notes in compact mode", () => {
    render(<SampleDayView dayNumber={2} compact />);

    expect(screen.queryByText("Enjoy some indoor shopping or catch a movie at the mall.")).not.toBeInTheDocument();
  });

  it("shows day 1 without weather", () => {
    render(<SampleDayView dayNumber={1} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText(/Likely dry|Rain likely/)).not.toBeInTheDocument();
  });
});

describe("SampleDayHeader", () => {
  it("names the day and shows its compact forecast", () => {
    render(<SampleDayHeader dayNumber={2} />);

    expect(screen.getByText("Day 2 · Views & Shopping")).toBeInTheDocument();
    expect(screen.getByText("16–26°C · PM rain")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-sample-day.test.jsx --pool=threads`
Expected: FAIL, the import doesn't resolve.

- [ ] **Step 3: Implement**

```jsx
// app/components/landing/SampleDay.jsx
"use client";

import ShareStopCard from "../../itinerary/view/[token]/components/ShareStopCard.jsx";
import { formatTimeRange, itemTypeIcon } from "../../itinerary/view/[token]/components/stopDisplay.jsx";
import WeatherChip from "../weather/WeatherChip.jsx";
import { getDayColor } from "../../lib/trip-dashboard/dayColors.js";
import { getSampleDay, getSampleDayWeather } from "./sample/sampleTrip.js";

/** "Day 2 · Views & Shopping" with the day's colour dot and its one-line forecast. */
export function SampleDayHeader({ dayNumber }) {
  const day = getSampleDay(dayNumber);
  const color = getDayColor(day.dayNumber);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="m-0 flex items-center gap-2 font-sans text-sm font-semibold text-text-primary">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.fill }} />
        Day {day.dayNumber} · {day.title}
      </p>
      <WeatherChip entry={getSampleDayWeather(day)} />
    </div>
  );
}

/** One day of the sample trip as the share page's real stop cards. */
export function SampleDayView({ dayNumber, compact = false }) {
  const day = getSampleDay(dayNumber);
  const weather = getSampleDayWeather(day);
  return (
    <ol aria-label={`Day ${day.dayNumber} stops`} className="m-0 grid list-none gap-2.5 p-0">
      {day.items.map((item, index) => (
        <li key={item.id}>
          <ShareStopCard
            item={item}
            compact={compact}
            timeLabel={formatTimeRange(item.startTime, item.endTime)}
            dayWeather={weather}
            dayNumber={day.dayNumber}
            stopNumber={index + 1}
            icon={itemTypeIcon(item.type)}
          />
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/landing-sample-day.test.jsx --pool=threads`
Expected: PASS (4 tests). If `16–26°C · PM rain` fails, compare it with `describeDayWeather(entry).compactText` from Task 2's fixture. That string is the source of truth, so fix the test, not the fixture.

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/SampleDay.jsx tests/landing-sample-day.test.jsx
git commit -m "feat(landing): sample day rendered with the real stop cards"
```

---

### Task 9: Lazy Leaflet map

**Files:**
- Create: `app/hooks/useInView.js`
- Create: `app/components/landing/SampleTripMap.jsx`
- Create: `app/components/landing/LazySampleTripMap.jsx`
- Test: `tests/landing-sample-map.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-sample-map.test.jsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet", () => ({ default: { divIcon: (options) => options } }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: ({ url }) => <div data-testid="tiles" data-url={url} />,
  Polyline: ({ pathOptions }) => <div data-testid="route" data-color={pathOptions.color} data-opacity={pathOptions.opacity} />,
  Marker: ({ title, icon }) => <div data-testid="pin" title={title} data-html={icon.html} />,
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicMapStub({ activeDay }) {
      return <div data-testid="lazy-map" data-active-day={activeDay} />;
    },
}));

import SampleTripMap from "../app/components/landing/SampleTripMap.jsx";
import LazySampleTripMap from "../app/components/landing/LazySampleTripMap.jsx";

const realIO = globalThis.IntersectionObserver;
afterEach(() => {
  globalThis.IntersectionObserver = realIO;
});

describe("SampleTripMap", () => {
  it("pins every located stop in its day colour, numbered like its card", () => {
    render(<SampleTripMap activeDay={2} />);

    const pins = screen.getAllByTestId("pin");
    expect(pins).toHaveLength(8);
    const mall = screen.getByTitle("Day 2, stop 4: SM City Baguio");
    expect(mall.dataset.html).toContain("#0F766E");
    expect(mall.dataset.html).toContain(">4<");
  });

  it("draws one route per day and dims the day not shown", () => {
    render(<SampleTripMap activeDay={2} />);

    const routes = screen.getAllByTestId("route");
    expect(routes.map((r) => [r.dataset.color, r.dataset.opacity])).toEqual([
      ["#B4532A", "0.3"],
      ["#0F766E", "0.9"],
    ]);
  });

  it("uses the light CARTO tiles by default", () => {
    render(<SampleTripMap activeDay={2} />);

    expect(screen.getByTestId("tiles").dataset.url).toContain("rastertiles/voyager");
  });
});

describe("LazySampleTripMap", () => {
  it("does not load the map until it nears the viewport", () => {
    let trigger;
    globalThis.IntersectionObserver = class {
      constructor(callback) {
        trigger = callback;
      }
      observe() {}
      disconnect() {}
    };
    render(<LazySampleTripMap activeDay={2} />);
    expect(screen.queryByTestId("lazy-map")).not.toBeInTheDocument();

    act(() => trigger([{ isIntersecting: true }]));
    expect(screen.getByTestId("lazy-map")).toHaveAttribute("data-active-day", "2");
  });

  it("loads straight away where IntersectionObserver is missing", () => {
    delete globalThis.IntersectionObserver;
    render(<LazySampleTripMap activeDay={1} />);

    expect(screen.getByTestId("lazy-map")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-sample-map.test.jsx --pool=threads`
Expected: FAIL, the imports don't resolve.

- [ ] **Step 3: Implement the hook**

```js
// app/hooks/useInView.js
"use client";

import { useEffect, useState } from "react";

/**
 * True once `ref`'s element has come within `rootMargin` of the viewport, and true
 * from then on. Where IntersectionObserver is missing it is true straight away.
 */
export function useInView(ref, { rootMargin = "200px" } = {}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin, inView]);

  return inView;
}
```

- [ ] **Step 4: Implement the map**

```jsx
// app/components/landing/SampleTripMap.jsx
"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import { useTheme } from "../theme/ThemeProvider";
import { getDayColor } from "../../lib/trip-dashboard/dayColors.js";
import { getSampleMapStops } from "./sample/sampleTrip.js";

// CARTO basemaps: free for non-commercial use with attribution. Revisit if Voyage goes commercial (Release checklist).
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const STOPS = getSampleMapStops();
const BOUNDS = STOPS.map((stop) => [stop.lat, stop.lng]);
const DAY_NUMBERS = [...new Set(STOPS.map((stop) => stop.dayNumber))];

/** The stop's number in its day's colour: the same badge StopNumberBadge draws on its card. */
function pinIcon(stop, isActiveDay) {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:${stop.color.fill};border:2px solid ${stop.color.border};color:#fff;font:700 12px/1 'Plus Jakarta Sans',sans-serif;opacity:${isActiveDay ? 1 : 0.45}">${stop.stopNumber}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** The sample trip on a real map. Client-only: load it through LazySampleTripMap. */
export default function SampleTripMap({ activeDay }) {
  const { theme } = useTheme();
  return (
    <MapContainer bounds={BOUNDS} boundsOptions={{ padding: [28, 28] }} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer url={theme === "dark" ? TILES.dark : TILES.light} attribution={ATTRIBUTION} />
      {DAY_NUMBERS.map((dayNumber) => (
        <Polyline
          key={dayNumber}
          positions={STOPS.filter((stop) => stop.dayNumber === dayNumber).map((stop) => [stop.lat, stop.lng])}
          pathOptions={{ color: getDayColor(dayNumber).fill, weight: 3, dashArray: "6 6", opacity: dayNumber === activeDay ? 0.9 : 0.3 }}
        />
      ))}
      {STOPS.map((stop) => (
        <Marker
          key={stop.id}
          position={[stop.lat, stop.lng]}
          icon={pinIcon(stop, stop.dayNumber === activeDay)}
          title={`Day ${stop.dayNumber}, stop ${stop.stopNumber}: ${stop.title}`}
          keyboard={false}
        />
      ))}
    </MapContainer>
  );
}
```

```jsx
// app/components/landing/LazySampleTripMap.jsx
"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { useInView } from "../../hooks/useInView.js";

const SampleTripMap = dynamic(() => import("./SampleTripMap.jsx"), { ssr: false });

/** Reserves the map's space and only loads Leaflet and its tiles when the section is near. */
export default function LazySampleTripMap({ activeDay }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <figure className="m-0 grid gap-2">
      <div
        ref={ref}
        className="relative isolate h-[300px] overflow-hidden rounded-xl border border-border/15 bg-surface lg:h-[340px]"
      >
        {inView ? <SampleTripMap activeDay={activeDay} /> : null}
      </div>
      <figcaption className="text-[12px] leading-snug text-text-muted">
        Each pin is a stop, numbered and coloured like its card. Day {activeDay} is highlighted.
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/landing-sample-map.test.jsx --pool=threads`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useInView.js app/components/landing/SampleTripMap.jsx app/components/landing/LazySampleTripMap.jsx tests/landing-sample-map.test.jsx
git commit -m "feat(landing): lazy Leaflet map of the sample trip in day colours"
```

---

### Task 10: Header and hero (design A)

**Files:**
- Create: `app/components/landing/LandingHeader.jsx`
- Create: `app/components/landing/LandingHero.jsx`
- Test: `tests/landing-hero.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-hero.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);

import LandingHeader from "../app/components/landing/LandingHeader.jsx";
import LandingHero from "../app/components/landing/LandingHero.jsx";

describe("LandingHeader", () => {
  it("links to every section and has no pricing", () => {
    render(<LandingHeader onLogin={vi.fn()} onStartPlanning={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Landing" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "#what-it-does",
      "#how-it-works",
      "#for-agencies",
      "#faq",
    ]);
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();
  });

  it("sends Log in and Start planning to their handlers", () => {
    const onLogin = vi.fn();
    const onStartPlanning = vi.fn();
    render(<LandingHeader onLogin={onLogin} onStartPlanning={onStartPlanning} />);

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    fireEvent.click(screen.getByRole("button", { name: "Start planning" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onStartPlanning).toHaveBeenCalledTimes(1);
  });
});

describe("LandingHero", () => {
  it("leads with the one serif h1 and the real sample trip on day 2", () => {
    render(<LandingHero onStartPlanning={vi.fn()} onWatchDemo={vi.fn()} />);

    const h1 = screen.getByRole("heading", { level: 1, name: "Plan client trips in minutes, not hours" });
    expect(h1.className).toContain("font-serif");
    expect(h1.className).toContain("font-normal");
    expect(screen.getByRole("radio", { name: "Day 2" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Mines View Park", { selector: "h3" })).toBeInTheDocument();
  });

  it("switches the sample to day 1", () => {
    render(<LandingHero onStartPlanning={vi.fn()} onWatchDemo={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Day 1" }));
    expect(screen.getByText("Baguio Botanical Garden", { selector: "h3" })).toBeInTheDocument();
  });

  it("starts planning and opens the demo", () => {
    const onStartPlanning = vi.fn();
    const onWatchDemo = vi.fn();
    render(<LandingHero onStartPlanning={onStartPlanning} onWatchDemo={onWatchDemo} />);

    fireEvent.click(screen.getByRole("button", { name: "Start planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Watch the demo" }));
    expect(onStartPlanning).toHaveBeenCalledTimes(1);
    expect(onWatchDemo).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-hero.test.jsx --pool=threads`
Expected: FAIL, the imports don't resolve.

- [ ] **Step 3: Implement the header**

```jsx
// app/components/landing/LandingHeader.jsx
"use client";

import ThemeToggle from "../theme/ThemeToggle";
import VoyageLogo from "../brand/VoyageLogo";
import { LANDING_NAV } from "./landingContent.js";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./landingClasses.js";

export default function LandingHeader({ onLogin, onStartPlanning }) {
  return (
    <header className="sticky top-3 z-50 mx-auto w-full max-w-[1220px] px-4">
      <div className="flex items-center justify-between gap-3 rounded-pill border border-border/[0.12] bg-surface/85 px-4 py-2 shadow-soft backdrop-blur-md sm:px-6">
        <a href="#top" aria-label="Voyage home" className="shrink-0 text-text-primary no-underline">
          <VoyageLogo className="h-9 w-auto" />
        </a>
        <nav aria-label="Landing" className="hidden md:block">
          <ul className="m-0 flex list-none items-center gap-1 p-0">
            {LANDING_NAV.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center rounded-pill px-3 text-sm font-semibold text-text-muted no-underline transition-colors duration-150 hover:bg-secondary/[0.08] hover:text-text-primary"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden sm:block">
            <ThemeToggle />
          </span>
          <button type="button" onClick={onLogin} className={`${SECONDARY_BUTTON} px-4`}>
            Log in
          </button>
          <button type="button" onClick={onStartPlanning} className={`${PRIMARY_BUTTON} px-4`}>
            Start planning
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Implement the hero**

```jsx
// app/components/landing/LandingHero.jsx
"use client";

import { useState } from "react";
import SegmentedControl from "../admin/SegmentedControl.jsx";
import { ArrowRightIcon, SparkleIcon } from "../icons/index.js";
import { SampleDayHeader, SampleDayView } from "./SampleDay.jsx";
import { SAMPLE_DAY_OPTIONS, SAMPLE_DEFAULT_DAY, SAMPLE_TRIP } from "./sample/sampleTrip.js";
import { HERO } from "./landingContent.js";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./landingClasses.js";

function PlayIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

/** Design A: the pitch beside a compact, live view of the real sample trip. */
export default function LandingHero({ onStartPlanning, onWatchDemo }) {
  const [day, setDay] = useState(String(SAMPLE_DEFAULT_DAY));

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="mx-auto grid w-full max-w-[1220px] gap-10 px-4 pb-20 pt-14 md:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start"
    >
      <div className="lg:pt-8">
        <p className="m-0 text-[13px] font-semibold text-secondary-strong">{HERO.overline}</p>
        <h1
          id="landing-hero-title"
          className="mt-3 font-serif text-4xl font-normal leading-[1.08] tracking-tight text-text-primary md:text-5xl lg:text-[3.4rem]"
        >
          {HERO.title}
        </h1>
        <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-text-muted">{HERO.body}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" onClick={onStartPlanning} className={PRIMARY_BUTTON}>
            Start planning
            <ArrowRightIcon width={16} height={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={onWatchDemo} className={SECONDARY_BUTTON}>
            <PlayIcon />
            Watch the demo
          </button>
        </div>
        <p className="mt-6 flex max-w-[52ch] gap-2 text-sm leading-relaxed text-text-muted">
          <SparkleIcon width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-secondary-strong" />
          {HERO.sampleNote}
        </p>
      </div>

      <div className="grid gap-3 rounded-[22px] border border-border/15 bg-surface p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 font-sans text-[15px] font-semibold text-text-primary">{SAMPLE_TRIP.itinerary.title}</p>
          <SegmentedControl as="radio" size="sm" ariaLabel="Sample trip day" options={SAMPLE_DAY_OPTIONS} value={day} onChange={setDay} />
        </div>
        <SampleDayHeader dayNumber={day} />
        <SampleDayView dayNumber={day} compact />
        <a href="#sample-trip" className="justify-self-start text-sm font-semibold text-secondary-strong underline-offset-2 hover:underline">
          See the full trip, map and notes
        </a>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/landing-hero.test.jsx --pool=threads`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/landing/LandingHeader.jsx app/components/landing/LandingHero.jsx tests/landing-hero.test.jsx
git commit -m "feat(landing): header and split hero with the live sample trip"
```

---

### Task 11: Annotated sample section (design B)

**Files:**
- Create: `app/components/landing/SampleTripSection.jsx`
- Test: `tests/landing-sample-section.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-sample-section.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
vi.mock("../app/components/landing/LazySampleTripMap.jsx", () => ({
  default: ({ activeDay }) => <div data-testid="map" data-active-day={activeDay} />,
}));

import SampleTripSection from "../app/components/landing/SampleTripSection.jsx";

describe("SampleTripSection", () => {
  it("is the #sample-trip anchor with a sans h2", () => {
    const { container } = render(<SampleTripSection />);

    expect(container.querySelector("section#sample-trip")).not.toBeNull();
    const h2 = screen.getByRole("heading", { level: 2, name: "A real trip, planned by Voyage" });
    expect(h2.className).toContain("font-sans");
  });

  it("shows day 2's real forecast summary, full stop cards, five callouts and the map", () => {
    render(<SampleTripSection />);

    expect(screen.getByText(/Forecast: Afternoon rain, 1–2 PM/)).toBeInTheDocument();
    expect(screen.getByText("Put outdoor stops before 11 AM.")).toBeInTheDocument();
    expect(screen.getByText("Enjoy panoramic views of the Cordillera mountains.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "What this sample shows" })).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByTestId("map")).toHaveAttribute("data-active-day", "2");
  });

  it("switches the cards and the map to day 1", () => {
    render(<SampleTripSection />);

    fireEvent.click(screen.getByRole("radio", { name: "Day 1" }));
    expect(screen.getByText("Baguio Botanical Garden", { selector: "h3" })).toBeInTheDocument();
    expect(screen.queryByText(/Forecast:/)).not.toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-active-day", "1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-sample-section.test.jsx --pool=threads`
Expected: FAIL, the import doesn't resolve.

- [ ] **Step 3: Implement**

```jsx
// app/components/landing/SampleTripSection.jsx
"use client";

import { useState } from "react";
import SegmentedControl from "../admin/SegmentedControl.jsx";
import DayWeatherSummary from "../weather/DayWeatherSummary.jsx";
import LazySampleTripMap from "./LazySampleTripMap.jsx";
import { SampleDayHeader, SampleDayView } from "./SampleDay.jsx";
import {
  SAMPLE_DAY_OPTIONS,
  SAMPLE_DEFAULT_DAY,
  SAMPLE_WEATHER_ATTRIBUTION,
  getSampleDay,
  getSampleDayWeather,
} from "./sample/sampleTrip.js";
import { SAMPLE_CALLOUTS, SAMPLE_SECTION } from "./landingContent.js";

/** Design B: the full sample trip, numbered notes on what it shows, and its map. */
export default function SampleTripSection() {
  const [day, setDay] = useState(String(SAMPLE_DEFAULT_DAY));
  const weather = getSampleDayWeather(getSampleDay(day));

  return (
    <section id="sample-trip" aria-labelledby="sample-trip-title" className="mx-auto w-full max-w-[1220px] scroll-mt-24 px-4 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="sample-trip-title" className="m-0 font-sans text-2xl font-semibold text-text-primary md:text-3xl">
            {SAMPLE_SECTION.title}
          </h2>
          <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-text-muted">{SAMPLE_SECTION.body}</p>
        </div>
        <SegmentedControl as="radio" size="sm" ariaLabel="Day shown in the sample trip" options={SAMPLE_DAY_OPTIONS} value={day} onChange={setDay} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="grid content-start gap-3">
          <SampleDayHeader dayNumber={day} />
          <DayWeatherSummary entry={weather} attribution={SAMPLE_WEATHER_ATTRIBUTION} />
          <SampleDayView dayNumber={day} />
        </div>
        <div className="grid content-start gap-6">
          <ol aria-label="What this sample shows" className="m-0 grid list-none gap-4 p-0">
            {SAMPLE_CALLOUTS.map((callout, index) => (
              <li key={callout.title} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-on-primary">
                  {index + 1}
                </span>
                <div>
                  <h3 className="m-0 font-sans text-[15px] font-semibold text-text-primary">{callout.title}</h3>
                  <p className="m-0 mt-1 text-sm leading-relaxed text-text-muted">{callout.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <LazySampleTripMap activeDay={Number(day)} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/landing-sample-section.test.jsx --pool=threads`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/SampleTripSection.jsx tests/landing-sample-section.test.jsx
git commit -m "feat(landing): annotated full sample trip with callouts and map"
```

---

### Task 12: "After the plan" tabs and demos

**Files:**
- Create: `app/components/landing/after-the-plan/AskFirstDemo.jsx`
- Create: `app/components/landing/after-the-plan/ShareLinkDemo.jsx`
- Create: `app/components/landing/after-the-plan/ClientFeedbackDemo.jsx`
- Create: `app/components/landing/after-the-plan/SamplePdfDemo.jsx`
- Create: `app/components/landing/after-the-plan/ApprovalDemo.jsx`
- Create: `app/components/landing/after-the-plan/AfterThePlanTabs.jsx`
- Test: `tests/landing-after-the-plan.test.jsx` (new), `tests/landing-sample-pdf.test.jsx` (new)

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/landing-after-the-plan.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }) => <svg data-testid="qr" data-value={value} />,
  QRCodeCanvas: () => null,
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function PdfDemoStub() {
      return <div data-testid="pdf-demo" />;
    },
}));

import AfterThePlanTabs from "../app/components/landing/after-the-plan/AfterThePlanTabs.jsx";

describe("AfterThePlanTabs", () => {
  it("opens on Asks first with the real questions and leaves focus alone", () => {
    render(<AfterThePlanTabs />);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Asks first",
      "Share link",
      "Client feedback",
      "PDF and print",
      "Approve and lock",
    ]);
    expect(screen.getByRole("tab", { name: "Asks first" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "How will the travelers get around?" })).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it("answers both questions and shows them as the agent would receive them", () => {
    render(<AfterThePlanTabs />);

    fireEvent.click(screen.getByRole("radio", { name: /A mix/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: /Packed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));

    expect(screen.getByText("A mix")).toBeInTheDocument();
    expect(screen.getByText("Packed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try it again" }));
    expect(screen.getByRole("group", { name: "How will the travelers get around?" })).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys", () => {
    render(<AfterThePlanTabs />);

    const first = screen.getByRole("tab", { name: "Asks first" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });

    const share = screen.getByRole("tab", { name: "Share link" });
    expect(share).toHaveAttribute("aria-selected", "true");
    expect(share).toHaveFocus();
    expect(screen.getByTestId("qr").dataset.value).toBe(`${window.location.origin}/#sample-trip`);

    fireEvent.keyDown(share, { key: "End" });
    expect(screen.getByRole("tab", { name: "Approve and lock" })).toHaveFocus();
  });

  it("rates the proposal without sending anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AfterThePlanTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Client feedback" }));
    expect(screen.getByText("Mines View Park", { selector: "h3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit rating" }));

    expect(await screen.findByLabelText("5 out of 5 stars")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("walks a trip through review, approval and reopening", () => {
    render(<AfterThePlanTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Approve and lock" }));
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Locked. Approved itineraries can't be edited.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reopen for edits" }));
    expect(screen.getByText("Editable by the assigned agent.")).toBeInTheDocument();
  });

  it("loads the PDF demo only when its tab opens", () => {
    render(<AfterThePlanTabs />);

    expect(screen.queryByTestId("pdf-demo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "PDF and print" }));
    expect(screen.getByTestId("pdf-demo")).toBeInTheDocument();
  });
});
```

```jsx
// tests/landing-sample-pdf.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
const pdf = vi.hoisted(() => ({ status: "ready", canDownload: true, download: vi.fn(), print: vi.fn(), fallbackUrl: null }));
vi.mock("../app/hooks/useItineraryPdf.js", () => ({ useItineraryPdf: vi.fn(() => pdf) }));

import SamplePdfDemo from "../app/components/landing/after-the-plan/SamplePdfDemo.jsx";
import { useItineraryPdf } from "../app/hooks/useItineraryPdf.js";
import { SAMPLE_PDF_INPUT } from "../app/components/landing/sample/sampleTrip.js";

describe("SamplePdfDemo", () => {
  it("builds the real PDF of the sample trip and downloads or prints it", () => {
    render(<SamplePdfDemo />);

    expect(useItineraryPdf).toHaveBeenCalledWith(SAMPLE_PDF_INPUT);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(pdf.download).toHaveBeenCalledTimes(1);
    expect(pdf.print).toHaveBeenCalledTimes(1);
  });

  it("quotes the PDF's real weather lines for day 2", () => {
    render(<SamplePdfDemo />);

    expect(
      screen.getByText("Weather forecast: Afternoon rain, 1–2 PM, 16–26°C, dry until 11 AM, about 4 mm of rain"),
    ).toBeInTheDocument();
    expect(screen.getByText("1:30 PM SM City Baguio · Rain likely (up to 94% chance of rain)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/landing-after-the-plan.test.jsx tests/landing-sample-pdf.test.jsx --pool=threads`
Expected: FAIL, the imports don't resolve.

- [ ] **Step 3: Implement the five demos**

```jsx
// app/components/landing/after-the-plan/AskFirstDemo.jsx
"use client";

import { useState } from "react";
import AskUserPanel from "../../trip-dashboard/command-center/AskUserPanel.jsx";
import AnswerPairs from "../../trip-dashboard/command-center/AnswerPairs.jsx";
import { buildAnswer } from "../../../lib/agent/askUser.js";
import { SAMPLE_ASK_USER_QUESTIONS } from "../sample/sampleTrip.js";
import { SECONDARY_BUTTON } from "../landingClasses.js";

const PENDING = { messageId: "landing-sample", questions: SAMPLE_ASK_USER_QUESTIONS };

/** The real question panel. Answers show the way the chat shows them; nothing is sent. */
export default function AskFirstDemo() {
  const [answers, setAnswers] = useState(null);
  const [round, setRound] = useState(0);

  if (answers) {
    return (
      <div className="grid gap-3 rounded-[18px] border border-border/15 bg-surface p-4">
        <div className="justify-self-end rounded-[18px] bg-secondary/15 px-4 py-3 text-sm text-text-primary">
          <AnswerPairs answers={answers} />
        </div>
        <p className="m-0 text-sm text-text-muted">With these answers, Voyage would draft the itinerary.</p>
        <button
          type="button"
          className={`${SECONDARY_BUTTON} justify-self-start`}
          onClick={() => {
            setAnswers(null);
            setRound((current) => current + 1);
          }}
        >
          Try it again
        </button>
      </div>
    );
  }

  return (
    <AskUserPanel
      key={round}
      questions={SAMPLE_ASK_USER_QUESTIONS}
      focusOnMount={false}
      containerClassName="mt-0 pt-0"
      onSubmit={(draft) => setAnswers(buildAnswer(PENDING, draft).display)}
    />
  );
}
```

```jsx
// app/components/landing/after-the-plan/ShareLinkDemo.jsx
"use client";

import ShareLinkResult from "../../trip-dashboard/itinerary/ShareLinkResult.jsx";
import { SAMPLE_TRIP, getSampleShareUrl } from "../sample/sampleTrip.js";

/** The app's "Share link ready" view for the sample trip. Mounted only after a tab click, so `window` exists. */
export default function ShareLinkDemo() {
  const shareUrl = getSampleShareUrl(window.location.origin);
  return (
    <div className="rounded-[18px] border border-border/15 bg-surface p-4">
      <ShareLinkResult shareUrl={shareUrl} tripTitle={SAMPLE_TRIP.itinerary.title} />
    </div>
  );
}
```

```jsx
// app/components/landing/after-the-plan/ClientFeedbackDemo.jsx
"use client";

import ShareStopCard from "../../../itinerary/view/[token]/components/ShareStopCard.jsx";
import ProposalRating from "../../../itinerary/view/[token]/components/ProposalRating.jsx";
import { formatTimeRange, itemTypeIcon } from "../../../itinerary/view/[token]/components/stopDisplay.jsx";
import { getSampleDay, getSampleDayWeather } from "../sample/sampleTrip.js";

const DAY = getSampleDay(2);
const STOP = DAY.items[0];

/** What the client sees: a stop as on their share page, and the proposal rating (demo: nothing is sent). */
export default function ClientFeedbackDemo() {
  return (
    <div className="grid gap-4">
      <ShareStopCard
        item={STOP}
        timeLabel={formatTimeRange(STOP.startTime, STOP.endTime)}
        dayWeather={getSampleDayWeather(DAY)}
        dayNumber={DAY.dayNumber}
        stopNumber={1}
        icon={itemTypeIcon(STOP.type)}
      />
      <ProposalRating token="landing-sample" demo />
    </div>
  );
}
```

```jsx
// app/components/landing/after-the-plan/SamplePdfDemo.jsx
"use client";

import { useItineraryPdf } from "../../../hooks/useItineraryPdf.js";
import PdfDeliveryNotice from "../../ui/PdfDeliveryNotice";
import { DownloadIcon, PrinterIcon } from "../../icons/index.js";
import { formatTimeRange } from "../../../itinerary/view/[token]/components/stopDisplay.jsx";
import { describeDayWeather, describeStopWeather } from "../../../lib/weather/weatherDisplay.js";
import { SAMPLE_PDF_INPUT, getSampleDay, getSampleDayWeather } from "../sample/sampleTrip.js";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../landingClasses.js";

const DAY = getSampleDay(2);
const ENTRY = getSampleDayWeather(DAY);
const DAY_LINE = describeDayWeather(ENTRY)?.pdfText ?? "";
const STOP_LINES = DAY.items.map((item) => {
  const weather = describeStopWeather(ENTRY, item.id)?.pdfText;
  const time = formatTimeRange(item.startTime, null);
  return `${time} ${item.title}${weather ? ` · ${weather}` : ""}`;
});

/** Builds the real PDF of the sample trip (jsPDF loads with this chunk) and quotes what it says. */
export default function SamplePdfDemo() {
  const pdf = useItineraryPdf(SAMPLE_PDF_INPUT);
  const isPreparing = !pdf.canDownload && pdf.status !== "error";

  return (
    <div className="grid gap-4 rounded-[18px] border border-border/15 bg-surface p-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={pdf.download} disabled={!pdf.canDownload} className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}>
          <DownloadIcon width={14} height={14} aria-hidden="true" />
          {isPreparing ? "Preparing PDF…" : "Download PDF"}
        </button>
        <button type="button" onClick={pdf.print} disabled={!pdf.canDownload} className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}>
          <PrinterIcon width={14} height={14} aria-hidden="true" />
          Print
        </button>
      </div>
      <PdfDeliveryNotice status={pdf.status} fallbackUrl={pdf.fallbackUrl} />
      <div className="grid gap-1 rounded-md border border-border/15 bg-background px-4 py-3">
        <p className="m-0 text-[12px] font-semibold text-text-muted">What the PDF says for day 2</p>
        <p className="m-0 text-sm font-semibold text-text-primary">Day 2 · {DAY.title}</p>
        <p className="m-0 text-sm text-text-muted">{DAY_LINE}</p>
        {STOP_LINES.map((line) => (
          <p key={line} className="m-0 text-sm text-text-muted">{line}</p>
        ))}
      </div>
    </div>
  );
}
```

> If Step 4 shows a different string for `STOP_LINES` or `DAY_LINE`, the helpers are the source of truth. Update the test's expected text from the rendered output, not the component.

```jsx
// app/components/landing/after-the-plan/ApprovalDemo.jsx
"use client";

import { useState } from "react";
import StatusBadge from "../../ui/StatusBadge.jsx";
import { SAMPLE_TRIP } from "../sample/sampleTrip.js";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../landingClasses.js";

const STAGES = [
  { label: "Draft", variant: "draft", note: "Editable by the assigned agent.", action: "Send for review" },
  { label: "Needs review", variant: "pending", note: "Waiting for an owner to approve.", action: "Approve" },
  { label: "Approved", variant: "approved", note: "Locked. Approved itineraries can't be edited.", action: "Reopen for edits" },
];

/** The approval lifecycle with the app's status badges; local state only. */
export default function ApprovalDemo() {
  const [stage, setStage] = useState(0);
  const current = STAGES[stage];
  const isLocked = stage === STAGES.length - 1;

  return (
    <div className="grid gap-4 rounded-[18px] border border-border/15 bg-surface p-4">
      <ol aria-label="Approval steps" className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
        {STAGES.map((item, index) => (
          <li key={item.label} className={index <= stage ? "" : "opacity-45"} aria-current={index === stage ? "step" : undefined}>
            <StatusBadge variant={item.variant} size="md">{item.label}</StatusBadge>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/15 p-3">
        <div>
          <p className="m-0 text-sm font-semibold text-text-primary">{SAMPLE_TRIP.itinerary.title}</p>
          <p className="m-0 text-sm text-text-muted" aria-live="polite">{current.note}</p>
        </div>
        <button
          type="button"
          className={isLocked ? SECONDARY_BUTTON : PRIMARY_BUTTON}
          onClick={() => setStage((value) => (value + 1) % STAGES.length)}
        >
          {current.action}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement the tabs**

```jsx
// app/components/landing/after-the-plan/AfterThePlanTabs.jsx
"use client";

import { useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import AskFirstDemo from "./AskFirstDemo.jsx";
import ShareLinkDemo from "./ShareLinkDemo.jsx";
import ClientFeedbackDemo from "./ClientFeedbackDemo.jsx";
import ApprovalDemo from "./ApprovalDemo.jsx";
import { AFTER_THE_PLAN, AFTER_THE_PLAN_TABS } from "../landingContent.js";

// jsPDF only loads once someone opens the PDF tab.
const SamplePdfDemo = dynamic(() => import("./SamplePdfDemo.jsx"), { ssr: false });

const DEMOS = { ask: AskFirstDemo, share: ShareLinkDemo, feedback: ClientFeedbackDemo, pdf: SamplePdfDemo, approve: ApprovalDemo };
const IDS = AFTER_THE_PLAN_TABS.map((tab) => tab.id);

/** WAI-ARIA tabs (automatic activation, roving tabindex) over five live demos. */
export default function AfterThePlanTabs() {
  const [active, setActive] = useState(IDS[0]);
  const tabRefs = useRef({});
  const baseId = useId();
  const tab = AFTER_THE_PLAN_TABS.find((item) => item.id === active);
  const Demo = DEMOS[active];

  function select(id) {
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  function handleKeyDown(event) {
    const index = IDS.indexOf(active);
    const next = {
      ArrowRight: IDS[(index + 1) % IDS.length],
      ArrowLeft: IDS[(index - 1 + IDS.length) % IDS.length],
      Home: IDS[0],
      End: IDS[IDS.length - 1],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    select(next);
  }

  return (
    <section id="after-the-plan" aria-labelledby={`${baseId}-title`} className="mx-auto w-full max-w-[1220px] scroll-mt-24 px-4 pb-24">
      <p className="m-0 text-[13px] font-semibold text-secondary-strong">{AFTER_THE_PLAN.overline}</p>
      <h2 id={`${baseId}-title`} className="m-0 mt-2 font-sans text-2xl font-semibold text-text-primary md:text-3xl">
        {AFTER_THE_PLAN.title}
      </h2>
      <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-text-muted">{AFTER_THE_PLAN.body}</p>

      <div role="tablist" aria-label="Voyage after the plan" onKeyDown={handleKeyDown} className="mt-6 flex gap-1 overflow-x-auto border-b border-border/15">
        {AFTER_THE_PLAN_TABS.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              className={`-mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap border-0 border-b-2 bg-transparent px-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${
                selected ? "border-secondary-strong text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${active}`}
        tabIndex={0}
        className="grid gap-6 pt-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
      >
        <div>
          <h3 className="m-0 font-sans text-lg font-semibold text-text-primary">{tab.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{tab.body}</p>
        </div>
        <Demo key={active} />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run tests/landing-after-the-plan.test.jsx tests/landing-sample-pdf.test.jsx --pool=threads`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/landing/after-the-plan tests/landing-after-the-plan.test.jsx tests/landing-sample-pdf.test.jsx
git commit -m "feat(landing): 'after the plan' tabs with real ask, share, feedback, PDF and approval demos"
```

---

### Task 13: Lower sections and footer

**Files:**
- Create: `app/components/landing/LandingSections.jsx`
- Test: `tests/landing-sections.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-sections.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);

import { Faq, FinalCta, ForAgencies, HowItWorks, LandingFooter, WhatItDoes } from "../app/components/landing/LandingSections.jsx";

describe("landing lower sections", () => {
  it("anchors each section the nav links to, with sans h2s", () => {
    const { container } = render(
      <>
        <WhatItDoes />
        <HowItWorks />
        <ForAgencies />
        <Faq />
      </>,
    );

    for (const id of ["what-it-does", "how-it-works", "for-agencies", "faq"]) {
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
    for (const h2 of screen.getAllByRole("heading", { level: 2 })) {
      expect(h2.className).toContain("font-sans");
    }
  });

  it("lists eight features, four steps and two audiences", () => {
    render(
      <>
        <WhatItDoes />
        <HowItWorks />
        <ForAgencies />
      </>,
    );

    expect(within(screen.getByRole("list", { name: "Features" })).getAllByRole("listitem")).toHaveLength(8);
    expect(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "For agency owners" })).toBeInTheDocument();
  });

  it("puts each answer behind its question in a native disclosure", () => {
    render(<Faq />);

    const summary = screen.getByText("What does my client see?");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).toHaveTextContent(/They don't need an account/);
  });

  it("routes the final CTA and footer actions", () => {
    const onStartPlanning = vi.fn();
    const onLogin = vi.fn();
    render(
      <>
        <FinalCta onStartPlanning={onStartPlanning} />
        <LandingFooter onLogin={onLogin} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(onStartPlanning).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-sections.test.jsx --pool=threads`
Expected: FAIL, the import doesn't resolve.

- [ ] **Step 3: Implement**

```jsx
// app/components/landing/LandingSections.jsx
"use client";

import VoyageLogo from "../brand/VoyageLogo";
import WeatherIcon from "../weather/WeatherIcon.jsx";
import { ArrowRightIcon, CalendarIcon, ChatIcon, LockIcon, MapIcon, MapPinIcon, ShareIcon, StarIcon } from "../icons/index.js";
import { AUDIENCES, FAQS, FEATURES, FINAL_CTA, LANDING_NAV, STEPS } from "./landingContent.js";
import { PRIMARY_BUTTON } from "./landingClasses.js";

const FEATURE_ICONS = {
  chat: <ChatIcon width={18} height={18} />,
  place: <MapPinIcon width={18} height={18} />,
  weather: <WeatherIcon condition="RAIN" size={18} />,
  map: <MapIcon width={18} height={18} />,
  share: <ShareIcon width={18} height={18} />,
  lock: <LockIcon width={18} height={18} />,
  star: <StarIcon width={18} height={18} />,
  calendar: <CalendarIcon width={18} height={18} />,
};

const SECTION = "mx-auto w-full max-w-[1220px] scroll-mt-24 px-4 pb-24";
const H2 = "m-0 font-sans text-2xl font-semibold text-text-primary md:text-3xl";

export function WhatItDoes() {
  return (
    <section id="what-it-does" aria-labelledby="what-it-does-title" className={SECTION}>
      <h2 id="what-it-does-title" className={H2}>What Voyage does</h2>
      <ul aria-label="Features" className="m-0 mt-6 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="rounded-xl border border-border/15 bg-surface p-5">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary/10 text-secondary-strong">
              {FEATURE_ICONS[feature.icon]}
            </span>
            <h3 className="m-0 mt-3 font-sans text-[15px] font-semibold text-text-primary">{feature.title}</h3>
            <p className="m-0 mt-1 text-sm leading-relaxed text-text-muted">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className={SECTION}>
      <h2 id="how-it-works-title" className={H2}>How it works</h2>
      <ol aria-label="Steps" className="m-0 mt-6 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-strong text-sm font-bold text-on-secondary-strong">
              {index + 1}
            </span>
            <h3 className="m-0 mt-3 font-sans text-[15px] font-semibold text-text-primary">{step.title}</h3>
            <p className="m-0 mt-1 text-sm leading-relaxed text-text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ForAgencies() {
  return (
    <section id="for-agencies" aria-labelledby="for-agencies-title" className={SECTION}>
      <h2 id="for-agencies-title" className={H2}>Built for agencies</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {AUDIENCES.map((audience) => (
          <div key={audience.title} className="rounded-xl border border-border/15 bg-surface p-6">
            <h3 className="m-0 font-sans text-lg font-semibold text-text-primary">{audience.title}</h3>
            <p className="m-0 mt-2 text-sm leading-relaxed text-text-muted">{audience.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={SECTION}>
      <h2 id="faq-title" className={H2}>Questions</h2>
      <div className="mt-6 divide-y divide-border/15 rounded-xl border border-border/15 bg-surface">
        {FAQS.map((faq) => (
          <details key={faq.question} className="group px-5">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
              {faq.question}
              <span aria-hidden="true" className="text-text-muted transition-transform duration-150 group-open:rotate-45 motion-reduce:transition-none">+</span>
            </summary>
            <p className="m-0 pb-5 text-sm leading-relaxed text-text-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta({ onStartPlanning }) {
  return (
    <section aria-labelledby="final-cta-title" className="w-full bg-sidebar px-4 py-20 md:py-24">
      <div className="mx-auto flex max-w-[1220px] flex-col items-center gap-5 text-center">
        <h2 id="final-cta-title" className="m-0 font-sans text-2xl font-semibold text-white md:text-3xl">{FINAL_CTA.title}</h2>
        <p className="m-0 max-w-[48ch] text-base leading-relaxed text-white/75">{FINAL_CTA.body}</p>
        <button type="button" onClick={onStartPlanning} className={PRIMARY_BUTTON}>
          Start planning
          <ArrowRightIcon width={16} height={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function LandingFooter({ onLogin }) {
  return (
    <footer className="w-full border-t border-border/15 bg-surface px-4 py-8">
      <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-4">
        <VoyageLogo className="h-8 w-auto text-text-primary" />
        <nav aria-label="Footer">
          <ul className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
            {LANDING_NAV.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="inline-flex min-h-11 items-center px-2 text-sm text-text-muted no-underline hover:text-text-primary">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <button type="button" onClick={onLogin} className="inline-flex min-h-11 cursor-pointer items-center border-0 bg-transparent px-2 text-sm text-text-muted hover:text-text-primary">
                Log in
              </button>
            </li>
          </ul>
        </nav>
        <p className="m-0 w-full text-[12px] text-text-muted sm:w-auto">© {new Date().getFullYear()} Voyage</p>
      </div>
    </footer>
  );
}
```

> `text-white/75` on `bg-sidebar` is at least 7:1 in both themes (#223843 light, #0d1013 dark).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/landing-sections.test.jsx --pool=threads`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/LandingSections.jsx tests/landing-sections.test.jsx
git commit -m "feat(landing): what it does, how it works, agencies, FAQ, CTA and footer"
```

---

### Task 14: Make VideoModal a real dialog

**Files:**
- Modify: `app/components/landing/VideoModal.jsx`
- Test: `tests/landing-video-modal.test.jsx` (new)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/landing-video-modal.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import VideoModal from "../app/components/landing/VideoModal.jsx";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Watch the demo</button>
      <VideoModal isOpen={open} onClose={() => setOpen(false)} videoUrl="https://video.test/demo.mp4" />
    </>
  );
}

describe("VideoModal", () => {
  it("is a labelled modal dialog that takes focus and gives it back", () => {
    window.HTMLMediaElement.prototype.pause = vi.fn();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Watch the demo" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Voyage demo video" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close video" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the dialog", () => {
    window.HTMLMediaElement.prototype.pause = vi.fn();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the demo" }));

    const close = screen.getByRole("button", { name: "Close video" });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.querySelector("video")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-video-modal.test.jsx --pool=threads`
Expected: FAIL, no `dialog` role.

- [ ] **Step 3: Implement**

Replace `app/components/landing/VideoModal.jsx` with:

```jsx
"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** The demo video in a modal dialog: focus moves in, stays in, and returns to the trigger. */
export default function VideoModal({ isOpen, onClose, videoUrl }) {
  const videoRef = useRef(null);
  const closeRef = useRef(null);
  // Callers pass a fresh arrow each render; keep the effect tied to isOpen alone so a
  // parent re-render never resets the video or bounces focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const returnTo = document.activeElement;
    closeRef.current?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Two stops: the close button and the video's controls.
      const stops = [closeRef.current, videoRef.current].filter(Boolean);
      const index = stops.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.shiftKey ? (index <= 0 ? stops.length - 1 : index - 1) : (index + 1) % stops.length;
      stops[next].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    const video = videoRef.current;

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Voyage demo video"
        className="relative w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute -top-12 right-0 grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <video ref={videoRef} src={videoUrl} controls autoPlay playsInline tabIndex={0} className="aspect-video w-full rounded-lg bg-black" />
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/landing-video-modal.test.jsx --pool=threads`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/landing/VideoModal.jsx tests/landing-video-modal.test.jsx
git commit -m "fix(landing): demo video is a modal dialog with focus in, trapped and restored"
```

---

### Task 15: Compose the page and wire the CTAs

**Files:**
- Rewrite: `app/components/landing/LandingPage.jsx`
- Modify: `app/page.jsx:170`
- Rewrite: `tests/landing-page.test.jsx`

- [ ] **Step 1: Rewrite the stale test**

```jsx
// tests/landing-page.test.jsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../app/components/icons/index.js", async () => (await import("./helpers/iconsMock.js")).default);
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null, QRCodeCanvas: () => null }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub() {
      return <div data-testid="dynamic-stub" />;
    },
}));

import LandingPage from "../app/components/landing/LandingPage.jsx";

function renderPage() {
  const onLogin = vi.fn();
  const onStartPlanning = vi.fn();
  const utils = render(<LandingPage onLogin={onLogin} onStartPlanning={onStartPlanning} />);
  return { ...utils, onLogin, onStartPlanning };
}

describe("landing page", () => {
  it("has one h1 and every section, in the approved order, with no pricing", () => {
    const { container } = renderPage();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const ids = [...container.querySelectorAll("main section[id]")].map((s) => s.id);
    expect(ids).toEqual(["sample-trip", "after-the-plan", "what-it-does", "how-it-works", "for-agencies", "faq"]);
    expect(container.textContent).not.toMatch(/pricing/i);
    expect(container.querySelector("#pricing")).toBeNull();
  });

  it("shows the real sample trip in the hero and the annotated section", () => {
    renderPage();

    expect(screen.getAllByText("Mines View Park", { selector: "h3" })).toHaveLength(2);
  });

  it("sends every Start planning to sign-up and Log in to login", () => {
    const { onLogin, onStartPlanning } = renderPage();

    for (const button of screen.getAllByRole("button", { name: /Start planning/ })) fireEvent.click(button);
    for (const button of screen.getAllByRole("button", { name: "Log in" })) fireEvent.click(button);
    expect(onStartPlanning).toHaveBeenCalledTimes(3); // header, hero, final CTA
    expect(onLogin).toHaveBeenCalledTimes(2); // header, footer
  });

  it("opens the demo video", () => {
    window.HTMLMediaElement.prototype.pause = vi.fn();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Watch the demo" }));
    expect(screen.getByRole("dialog", { name: "Voyage demo video" })).toBeInTheDocument();
  });

  it("offers a skip link to the main content", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/landing-page.test.jsx --pool=threads`
Expected: FAIL. The old `LandingPage` has 'Pricing' and no `onStartPlanning`.

- [ ] **Step 3: Rewrite `LandingPage.jsx`**

```jsx
"use client";

import { useState } from "react";
import LandingHeader from "./LandingHeader.jsx";
import LandingHero from "./LandingHero.jsx";
import SampleTripSection from "./SampleTripSection.jsx";
import AfterThePlanTabs from "./after-the-plan/AfterThePlanTabs.jsx";
import { Faq, FinalCta, ForAgencies, HowItWorks, LandingFooter, WhatItDoes } from "./LandingSections.jsx";
import VideoModal from "./VideoModal.jsx";

const DEMO_VIDEO_URL = "https://res.cloudinary.com/dseh3ykul/video/upload/v1779104257/voyage-client-promo-review_yrrfzh.mp4";

/** The public `/` page: the pitch, a real sample trip, what happens after the plan, and the rest. */
export default function LandingPage({ onLogin, onStartPlanning }) {
  const [isVideoOpen, setIsVideoOpen] = useState(false);

  return (
    <div id="top" className="flex min-h-screen flex-col overflow-x-hidden bg-background font-sans text-text-primary">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-pill focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-soft"
      >
        Skip to content
      </a>
      <LandingHeader onLogin={onLogin} onStartPlanning={onStartPlanning} />
      <main id="main" className="flex-1">
        <LandingHero onStartPlanning={onStartPlanning} onWatchDemo={() => setIsVideoOpen(true)} />
        <SampleTripSection />
        <AfterThePlanTabs />
        <WhatItDoes />
        <HowItWorks />
        <ForAgencies />
        <Faq />
        <FinalCta onStartPlanning={onStartPlanning} />
      </main>
      <LandingFooter onLogin={onLogin} />
      <VideoModal isOpen={isVideoOpen} onClose={() => setIsVideoOpen(false)} videoUrl={DEMO_VIDEO_URL} />
    </div>
  );
}
```

> The section-order test reads `main section[id]`. The hero and final CTA have no `id`, so the expected list starts at `sample-trip`.

- [ ] **Step 4: Wire `page.jsx`**

Replace line 170 of `app/page.jsx`:

```jsx
    return <LandingPage onLogin={() => router.push("/login")} onStartPlanning={() => router.push("/login?mode=register")} />;
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/landing-page.test.jsx --pool=threads`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/components/landing/LandingPage.jsx app/page.jsx tests/landing-page.test.jsx
git commit -m "feat(landing): compose the redesigned landing page; Start planning goes to sign-up"
```

---

### Task 16: Guard the type rule on the landing page

**Files:**
- Modify: `tests/heading-typography.test.js` (`SCOPED_FILES` and `EXPECTED`)

- [ ] **Step 1: Add the landing files**

Append to `SCOPED_FILES`:

```js
  "app/components/landing/LandingHero.jsx",
  "app/components/landing/SampleTripSection.jsx",
  "app/components/landing/LandingSections.jsx",
  "app/components/landing/after-the-plan/AfterThePlanTabs.jsx",
```

Append to `EXPECTED`:

```js
  ["app/components/landing/LandingHero.jsx", "{HERO.title}", "serif"],
  ["app/components/landing/SampleTripSection.jsx", "{SAMPLE_SECTION.title}", "sans"],
  ["app/components/landing/SampleTripSection.jsx", "{callout.title}", "sans"],
  ["app/components/landing/LandingSections.jsx", "What Voyage does", "sans"],
  ["app/components/landing/LandingSections.jsx", "{feature.title}", "sans"],
  ["app/components/landing/after-the-plan/AfterThePlanTabs.jsx", "{AFTER_THE_PLAN.title}", "sans"],
  ["app/components/landing/after-the-plan/AfterThePlanTabs.jsx", "{tab.title}", "sans"],
```

- [ ] **Step 2: Run the guard**

Run: `npx vitest run tests/heading-typography.test.js --pool=threads`
Expected: PASS. A failure here means a heading uses serif + bold or sans without `font-sans`. Fix the component, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/heading-typography.test.js
git commit -m "test: hold the landing page to the serif-only-for-h1 type rule"
```

---

### Task 17: Fixture re-capture script

The production QR should open the same trip the landing page shows, so this script rebuilds the fixture from any public share. It uses only the unauthenticated share endpoints.

**Files:**
- Create: `scripts/capture-landing-sample.mjs`

- [ ] **Step 1: Write the script**

```js
// scripts/capture-landing-sample.mjs
// Rebuilds the landing page's sample trip from a public share link.
//   node scripts/capture-landing-sample.mjs <apiBase> <shareToken>
// <apiBase> is the backend origin the share page calls (local: http://localhost:4000).
// Only the public, unauthenticated share endpoints are read.
import { writeFileSync } from "node:fs";
import { getReadablePlaceType } from "../app/lib/trip-dashboard/richItinerary.js";

const [apiBase, token] = process.argv.slice(2);
if (!apiBase || !token) {
  console.error("Usage: node scripts/capture-landing-sample.mjs <apiBase> <shareToken>");
  process.exit(1);
}

async function getJson(path) {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
}

// Google's structural types read as nonsense to a traveller ("Sublocality Level 2").
const RAW_TYPE = /^(Premise|Route|Establishment|Point Of Interest|Street Address|Political)$|Level \d|Sublocality|Locality|Administrative Area/;
const SNAPSHOT_KEYS = ["id", "provider", "providerPlaceId", "name", "formattedAddress", "latitude", "longitude", "rating", "websiteUrl", "phoneNumber", "businessStatus", "businessStatusCheckedAt"];
const METADATA_KEYS = ["types", "photoUrls", "googleTypes", "accessibility", "primaryPhotoUrl", "userRatingCount"];
const ITEM_KEYS = ["id", "sortOrder", "type", "title", "description", "startTime", "endTime", "clientNotes"];
const pick = (source, keys) => Object.fromEntries(keys.filter((key) => key in (source ?? {})).map((key) => [key, source[key]]));

function cleanSnapshot(snapshot) {
  if (!snapshot) return null;
  const out = pick(snapshot, SNAPSHOT_KEYS);
  out.metadata = pick(snapshot.metadata, METADATA_KEYS);
  if (RAW_TYPE.test(getReadablePlaceType(snapshot) || "")) {
    out.metadata.types = [];
    out.metadata.googleTypes = [];
  }
  return out;
}

const share = await getJson(`/shared/${token}`);
const { weather } = await getJson(`/shared/${token}/weather`);
const days = share.itinerary.days;
const dates = days.map((day) => day.date).filter(Boolean).sort();

const fixture = {
  _source: `Real Voyage output: "${share.itinerary.title}" (${share.brand?.name ?? "Voyage"}) and its forecast, captured ${new Date().toISOString().slice(0, 10)} from share ${token}. Edits: raw Google place types cleared; private fields dropped.`,
  brand: pick(share.brand, ["type", "name", "logoUrl"]),
  trip: { title: share.itinerary.title, startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null, travelerCount: share.trip?.travelerCount ?? null },
  itinerary: {
    id: share.itinerary.id,
    title: share.itinerary.title,
    summary: share.itinerary.summary,
    version: share.itinerary.version,
    days: days.map((day) => ({
      ...pick(day, ["id", "dayNumber", "date", "title", "summary"]),
      items: day.items.map((item) => ({ ...pick(item, ITEM_KEYS), placeSnapshot: cleanSnapshot(item.placeSnapshot) })),
    })),
  },
  weather,
};

const text = JSON.stringify(fixture, null, 2);
if (/clientEmail|clientName|staffNotes|createdByUserId/.test(text)) throw new Error("Refusing to write: a private field leaked into the fixture.");
writeFileSync(new URL("../app/components/landing/sample/sampleTrip.json", import.meta.url), `${text}\n`);
console.log(`Wrote ${days.length} days, ${days.reduce((n, d) => n + d.items.length, 0)} stops.`);
```

- [ ] **Step 2: Smoke-test against the local share that already exists**

With the local backend running, run: `node scripts/capture-landing-sample.mjs http://localhost:4000 bszKS3gQ7JiX && git diff --stat app/components/landing/sample/sampleTrip.json`
Expected: "Wrote 3 days, … stops." and a changed fixture (the Da Nang trip). Then **restore the Baguio fixture**: `git checkout app/components/landing/sample/sampleTrip.json`. This step only proves the script works. The sample doesn't change until the release checklist.

- [ ] **Step 3: Commit**

```bash
git add scripts/capture-landing-sample.mjs
git commit -m "chore(landing): script to re-capture the sample trip from a public share"
```

---

### Task 18: Full verification and browser QA

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: every new test file passes, and the failing set is the baseline's 8 known stale files minus `landing-page.test.jsx`, which now passes. Any other failure is a regression: fix it before going on.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: the build succeeds with no new warnings. Code splitting (`leaflet` on scroll-in, `jspdf` on the PDF tab) is checked in the browser's network panel in Step 3, items 2 and 4.

- [ ] **Step 3: Browser QA** (`preview_start` the `voyage-client` config, signed out, at `/`)

Check each and screenshot as evidence:
1. **1440×900 light.** The hero sits beside the compact Baguio card (day 2 selected, "16–26°C · PM rain" chip). Photos load from Cloudinary.
2. **Scroll to `#sample-trip`.** The network panel shows the Leaflet chunk and CARTO tiles requested only now. 8 numbered pins in terracotta/teal, the day 2 route solid and day 1 faint, attribution visible. Wheel-scrolling over the map scrolls the page.
3. **Day toggle.** Day 1 in the section switches the cards, hides the forecast summary, and highlights day 1 on the map.
4. **After the plan.**
   - Answer both questions → answer pairs → "Try it again".
   - Share link → QR scans (phone camera) to `<origin>/#sample-trip`.
   - Client feedback → rating saves with no network request.
   - PDF → the jsPDF chunk loads only on this tab, Download gives a 2-day Baguio PDF, and Print opens the print dialog.
   - Approve → lock → reopen.
5. **Keyboard only.**
   - Skip link → main.
   - Tab order: header → hero → day radios → tabs (arrow keys) → panel → FAQ (Enter toggles).
   - Watch the demo: focus goes to Close, Tab stays inside, Esc closes and returns focus to the trigger.
6. **Dark mode** (ThemeToggle). All text readable; buttons are #e0906f with dark text; the map switches to the dark tiles.
7. **375×812.** No horizontal scroll, the nav hides, the hero card stacks under the copy, the tabs scroll sideways, and every button is ≥44px.
8. **`prefers-reduced-motion: reduce`.** No button scale, and the FAQ "+" doesn't animate.
9. **No "pricing"** anywhere on the page (`get_page_text` + search).
10. **Console clean.** No React key/hydration warnings.

- [ ] **Step 4: Reset the viewport and report**

Reset `resize_window` to `desktop`. Report results with the screenshots. Don't push, and leave merging to the user.

---

## Release checklist (human, after merge, outward-facing, so not done by agents)

1. **Make the QR open a real client view.** Production currently deploys an old `origin/main` (memory `project_voyage_prod_deploy_state`), so first make sure prod has the current share page. Then:
   - In production Voyage, plan a dated trip a few weeks out (so every day has a forecast), approve it, and generate a share link with no expiry.
   - Set `NEXT_PUBLIC_LANDING_SAMPLE_SHARE_URL=https://voyage.smurfing.dev/itinerary/view/<token>` in Vercel and redeploy.
   - Run `node scripts/capture-landing-sample.mjs <prod API origin> <token>` so the landing sample is the same trip, check the diff, and commit.
2. **Map tiles.** CARTO basemaps are free for non-commercial use. If Voyage becomes a commercial product, move to a paid CARTO plan or another tile provider. Only `TILES` in `SampleTripMap.jsx` changes.

## Out of scope (follow-ups)

- The live share page also shows raw Google types such as "Sublocality Level 2" to clients. It should filter them the way `capture-landing-sample.mjs` does.
- Privacy, Terms and Contact pages don't exist, so the footer doesn't link to them yet.
- A mobile menu for the header nav (the footer carries the links on phones).
- Real testimonials once clients leave `TripReview`s with `consentToTestimonial`.
