# Capstone Remaining Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last four capstone panel items: rename "Command Center" to "Planner" (23), a role-aware first-run walkthrough (new), "Make another option" for a client's trip (16), a display-only pricing page and usage card (15), and minimum system requirements (14).

**Architecture:** Four independent parts, done in order because the tour text names the Planner and the options button. Part 1 is client-only (tour data, overlay, hook). Part 2 adds one server endpoint that copies a trip in a transaction, plus two small "trip thread with no itinerary events" fallbacks (workspace bootstrap and agent context), then the client button, tab labels and a flash notice. Part 3 adds one read-only owner endpoint and one shared client price file that feeds both the landing Pricing section and the Settings card. Part 4 adds one shared requirements file that feeds a Settings panel and a browser banner. Parts 3 and 4 also write the manuscript text under `Voyage-Server/docs/capstone/`.

**Tech Stack:** Voyage-Server: Express, Prisma, TypeScript, Vitest + supertest. Voyage-Client: Next.js 16, React 19, Tailwind v4, Vitest + Testing Library (jsdom).

**Decisions (approved in chat 2026-10-12, no separate spec):**
- 23: the label becomes **Planner**. The internal tab id `command-center` stays, so deep links keep working.
- Walkthrough: **one role-aware tour** (option A). Welcome card = **centred coach card with section chips** (option A). Dashboard steps for agency members (Needs you, Calendar, then Insights for owners or My work for staff), Planner, Itineraries, Admin for super admins, then where to replay it in Settings. Agency members start on Dashboard, everyone else on Planner. "Seen it" is stored **in the browser, per account** (`voyage-tour-completed-v3:<userId>`).
- 16: **option B**, options are sibling trips for the same client. "Make another option" copies the trip and opens the copy in the Planner. Trips to the same place get "Option N ·" tab labels.
- 15: the panel means *what an agency pays to use Voyage*. **Display only**: no payments, no plan stored, no limits enforced. Prices = cost-plus floor checked against competitor ceiling, per agency per month with team-member and itinerary allowances, 14-day free trial. Landing Pricing section + owner-only Settings "Plan and usage" card.
- 14: **system requirements**: manuscript tables, a Settings panel, and an unsupported-browser banner.

**Small changes from the chat design, found while reading the code (tell the user in the hand-off):**
1. The copied option starts **In review** (trip `IN_REVIEW`, itinerary `NEEDS_REVIEW`), not Draft. The Itineraries page only lists saved trips (in review or approved), so a Draft copy could never be approved there. In review is still unlocked, so the agent and hand edits can change it.
2. Tab labels keep the **destination** as the base ("Option 1 · Baguio City"), not the trip title. Saved trips are titled "{Client} itinerary", so the title says nothing new under a client heading.
3. The "Another option" control sits in the header's status line next to "New trip", not in the action button row. The row's 920px container breakpoint is measured for the current buttons (see the comment at the top of `ItineraryHeader.jsx`).
4. Firefox's minimum is **128**, not 111: the client uses Tailwind v4, which needs `@property` (Firefox 128).
5. The browser banner is mounted once in the root layout, so it also covers the landing page and client share links.

**Branch:** both repos are on `feat/capstone-panel-fixes` (unmerged). Do **not** create or switch branches without the user's direct yes. Suggest `feat/capstone-remaining` off `staging` in both repos and wait for the answer.

**Commits:** never add a `Co-Authored-By` line. Commit each task right away (GitHub Desktop stashes uncommitted files on branch switches).

**Model routing (lead-developer-orchestrator):** Haiku for Tasks 1, 3, 17. Sonnet for every other task. Opus for every spec and quality review.

**Test baselines (must not get worse):**
- Server: 11 known stale failures (agentLogger 1, agentOrchestrator 4, modelProvider 2, webSearchProvider 4).
- Client: 1 stale failure (agent-command-center-places) and 6 files that fail to load because `app/components/icons/index.js` has JSX in a `.js` file (login-page, prototype-flow, prototype-mobile, client-itinerary-page, home-page, rich-itinerary-message).

**Commands:**
- Server, from `Voyage-Server`: `npx vitest run <file>`, `npm test`, `npm run build`.
- Client, from `Voyage-Client`: `npx vitest run <file>`, `npm test`, `npm run build`.

---

## File map

**Part 1 — Planner rename and walkthrough (client)**
- Modify `app/components/trip-dashboard/layout/DashboardSidebar.jsx` — sidebar label.
- Modify `app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx` — "Open in Planner".
- Modify `app/components/trip-dashboard/pages/ClientItineraryPage.jsx` — empty-state text.
- Modify comments in `OwnerOverview.jsx`, `StaffMyWork.jsx`, `HomePage.jsx`, `DashboardHeader.jsx`, `app/lib/deepLinks.js`.
- Rewrite `app/components/trip-dashboard/tutorial/tutorialContent.js` — step data + `buildTourSteps` + `tourStorageKey`.
- Modify `app/components/trip-dashboard/tutorial/FirstUseTutorial.jsx` — centred welcome card, chips, `nextLabel`, no stale spotlight.
- Modify `OwnerOverview.jsx`, `StaffMyWork.jsx`, `app/components/admin/AdminTopBar.jsx` — tour markers.
- Rewrite `app/hooks/useTourFlow.js` — per-account flag, role steps.
- Modify `HomePage.jsx`, `pages/SettingsPage.jsx` — wiring.
- Tests: new `tests/tutorial-steps.test.js`, `tests/first-use-tutorial.test.jsx`, `tests/use-tour-flow.test.jsx`; update `dashboard-rail`, `home-page-dashboard-tab`, `home-page-traveler-needs`, `trip-slide-over-focus`, `client-itinerary-page`, `admin-page` tests.

**Part 2 — Another option (server + client)**
- Server: modify `src/modules/itineraries/itineraryTypes.ts`, `itineraryRepository.ts`, `itineraryService.ts`, `itineraryRoutes.ts`; `src/modules/workspace/workspaceService.ts`; `src/modules/agent/agentContextBuilder.ts`, `agentOrchestrator.ts`, `agentFactory.ts`.
- Server tests: new `tests/itineraryDuplicateTrip.test.ts`, `tests/agentTripItineraryContext.test.ts`; update `tests/itineraryEditRoutes.test.ts`, `tests/workspaceService.test.ts`.
- Client: new `app/lib/trip-dashboard/portfolioTrips.js`, `app/components/trip-dashboard/layout/FlashNotice.jsx`; modify `app/lib/trip-dashboard/savedItineraries.js`, `app/lib/api/agency.js`, `app/lib/api/index.js`, `ItineraryHeader.jsx`, `ClientItineraryPage.jsx`, `HomePage.jsx`.
- Client tests: new `tests/trip-tab-labels.test.js`, `tests/portfolio-trips.test.js`, `tests/flash-notice.test.jsx`, `tests/client-itinerary-options.test.jsx`; update `tests/itinerary-header.test.jsx`.

**Part 3 — Pricing (server + client + docs)**
- Server: new `src/modules/dashboard/planUsageService.ts`; modify `dashboardRoutes.ts`; new tests `tests/planUsage.test.ts`, `tests/planUsageRoutes.test.ts`.
- Client: new `app/lib/pricing/plans.js`, `app/components/landing/PricingSection.jsx`, `app/components/settings/PlanUsageCard.jsx`; modify `landingContent.js`, `LandingPage.jsx`, `app/lib/api/agency.js`, `app/lib/api/index.js`, `SettingsPage.jsx`.
- Client tests: new `tests/pricing-plans.test.js`, `tests/landing-pricing.test.jsx`, `tests/plan-usage-card.test.jsx`, `tests/settings-plan-and-requirements.test.jsx`; update `landing-content`, `landing-hero`, `landing-page`, `landing-sections` tests.
- Docs: new `Voyage-Server/docs/capstone/pricing-and-costing.md`.

**Part 4 — System requirements (client + docs)**
- Client: new `app/lib/systemRequirements.js`, `app/components/system/UnsupportedBrowserBanner.jsx`, `app/components/settings/SystemRequirementsTable.jsx`; modify `app/layout.jsx`, `SettingsPage.jsx`.
- Client tests: new `tests/system-requirements.test.js`, `tests/unsupported-browser-banner.test.jsx`; extend `tests/settings-plan-and-requirements.test.jsx`.
- Docs: new `Voyage-Server/docs/capstone/system-requirements.md`.

---

# Part 1 — Planner rename and walkthrough

### Task 1: Rename "Command Center" to "Planner" (Haiku)

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/layout/DashboardSidebar.jsx:119`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx:711`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx:962`
- Modify (comments only): `OwnerOverview.jsx:21`, `StaffMyWork.jsx:22`, `HomePage.jsx:457` and `:859`, `layout/DashboardHeader.jsx:14`, `app/lib/deepLinks.js:8` and `:32`
- Test: `tests/dashboard-rail.test.jsx:176`, `tests/home-page-dashboard-tab.test.jsx:110-147`, `tests/trip-slide-over-focus.test.jsx:280`, `tests/client-itinerary-page.test.jsx:187`, and test titles in `tests/deep-links.test.js`, `tests/dashboard-reply-refresh.test.jsx:98`, `tests/prototype-flow.test.jsx:86`, the comment in `tests/theme-safe-classes.test.js:65`

- [ ] **Step 1: Change the assertions to the new name (they fail)**

In `tests/dashboard-rail.test.jsx:176` change the list to:

```js
    for (const name of ["Dashboard", "Planner", "Itineraries", "Settings"]) {
```

In `tests/home-page-dashboard-tab.test.jsx:147`:

```js
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute("aria-current", "page");
```

and rename the test titles at lines 110, 128, 135 and 141 by replacing "Command Center" with "Planner" (for example `"shows no Planner header content on the Dashboard"`, `"falls back to the Planner when the user has no agency workspace"`).

In `tests/trip-slide-over-focus.test.jsx:280`:

```js
  const footerButton = () => screen.getByRole("button", { name: /Open in Planner/ });
```

In `tests/client-itinerary-page.test.jsx:187` (this file doesn't load today because of the icons file, but keep it correct):

```js
    expect(screen.getByText("Saved itineraries will appear here after approval from the Planner.")).toBeInTheDocument();
```

In `tests/deep-links.test.js`, `tests/dashboard-reply-refresh.test.jsx:98` and `tests/prototype-flow.test.jsx:86`, replace "Command Center"/"command center" with "Planner" in the test titles only. In `tests/theme-safe-classes.test.js:65` change the comment to `// The Planner's look is frozen until the colour sweep is signed off.`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/dashboard-rail.test.jsx tests/home-page-dashboard-tab.test.jsx tests/trip-slide-over-focus.test.jsx`
Expected: FAIL, no element named "Planner" / "Open in Planner".

- [ ] **Step 3: Rename the labels**

`DashboardSidebar.jsx:119`:

```js
    { tab: "command-center", label: "Planner", icon: ICONS.commandCenter },
```

`TripSlideOver.jsx:711`: replace the text `Open in Command Center →` with `Open in Planner →`.

`ClientItineraryPage.jsx:962`:

```jsx
              Saved itineraries will appear here after approval from the Planner.
```

In the comment lines listed under **Files**, replace "Command Center" with "Planner" (for example `deepLinks.js:8` becomes ` * - anything else: the Planner.`). Leave identifiers such as `openInCommandCenter` and `ICONS.commandCenter` alone; they are internal names.

- [ ] **Step 4: Run the tests and confirm only the tour copy is left**

Run: `npx vitest run tests/dashboard-rail.test.jsx tests/home-page-dashboard-tab.test.jsx tests/trip-slide-over-focus.test.jsx tests/deep-links.test.js`
Expected: PASS.

Run: `grep -rn "Command Center" app tests`
Expected: only `app/components/trip-dashboard/tutorial/tutorialContent.js` (rewritten in Task 2).

- [ ] **Step 5: Commit (client)**

```bash
git add app tests
git commit -m "feat: rename Command Center to Planner"
```

---

### Task 2: Role-aware tour steps (Sonnet)

**Files:**
- Rewrite: `Voyage-Client/app/components/trip-dashboard/tutorial/tutorialContent.js`
- Test: `Voyage-Client/tests/tutorial-steps.test.js` (new)

`useTourFlow.js` still imports `VOYAGE_TOUR_STORAGE_KEY`, so this task keeps that export unchanged. Task 5 removes it.

- [ ] **Step 1: Write the failing test**

Create `tests/tutorial-steps.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildTourSteps, tourStorageKey } from "../app/components/trip-dashboard/tutorial/tutorialContent.js";

const member = (role, extra = {}) => ({
  id: "u1",
  displayName: "Ana Cruz",
  accountType: "AGENCY_USER",
  memberships: [{ agencyId: "a1", role, status: "ACTIVE" }],
  ...extra,
});
const personal = { id: "p1", displayName: "Lee", accountType: "PERSONAL", memberships: [] };
const ids = (steps) => steps.map((step) => step.id);

describe("buildTourSteps", () => {
  it("opens with a centred welcome card that names the person and lists their sections", () => {
    const [welcome] = buildTourSteps({ user: member("OWNER"), agencyId: "a1" });

    expect(welcome).toMatchObject({
      id: "welcome",
      target: null,
      centered: true,
      tab: "dashboard",
      title: "Welcome to Voyage, Ana",
      nextLabel: "Start tour",
    });
    expect(welcome.chips).toEqual(["Dashboard", "Planner", "Itineraries", "Settings"]);
  });

  it("falls back to a plain welcome when there is no name", () => {
    const [welcome] = buildTourSteps({ user: member("OWNER", { displayName: "  " }), agencyId: "a1" });
    expect(welcome.title).toBe("Welcome to Voyage");
  });

  it("shows owners Insights and staff My work, after Needs you and the calendar", () => {
    const owner = ids(buildTourSteps({ user: member("OWNER"), agencyId: "a1" }));
    const staff = ids(buildTourSteps({ user: member("STAFF"), agencyId: "a1" }));

    expect(owner.slice(0, 4)).toEqual(["welcome", "dashboard-needs-you", "dashboard-calendar", "dashboard-insights"]);
    expect(owner).not.toContain("dashboard-my-work");
    expect(staff.slice(0, 4)).toEqual(["welcome", "dashboard-needs-you", "dashboard-calendar", "dashboard-my-work"]);
    expect(staff).not.toContain("dashboard-insights");
  });

  it("treats an agency admin like the owner", () => {
    expect(ids(buildTourSteps({ user: member("ADMIN"), agencyId: "a1" }))).toContain("dashboard-insights");
  });

  it("gives personal accounts no Dashboard, starts them on the Planner and names their settings page", () => {
    const steps = buildTourSteps({ user: personal, agencyId: null });

    expect(steps[0].tab).toBe("command-center");
    expect(steps.some((step) => step.section === "Dashboard")).toBe(false);
    expect(steps[0].chips).toEqual(["Planner", "Itineraries", "My account"]);
    expect(steps.at(-1).title).toBe("Replay the tour from My account");
  });

  it("adds the Admin step only for super admins", () => {
    const admin = buildTourSteps({ user: member("OWNER", { role: "SUPER_ADMIN" }), agencyId: "a1" });
    const owner = buildTourSteps({ user: member("OWNER"), agencyId: "a1" });

    expect(ids(admin)).toContain("admin-sections");
    expect(admin[0].chips).toEqual(["Dashboard", "Planner", "Itineraries", "Admin", "Settings"]);
    expect(ids(owner)).not.toContain("admin-sections");
  });

  it("has 14 steps for agency members, 11 for personal accounts and 12 for a super admin without an agency", () => {
    expect(buildTourSteps({ user: member("OWNER"), agencyId: "a1" })).toHaveLength(14);
    expect(buildTourSteps({ user: member("STAFF"), agencyId: "a1" })).toHaveLength(14);
    expect(buildTourSteps({ user: personal, agencyId: null })).toHaveLength(11);
    expect(
      buildTourSteps({ user: { id: "s1", displayName: "Root", role: "SUPER_ADMIN", memberships: [] }, agencyId: null }),
    ).toHaveLength(12);
  });

  it("points every step after the welcome card at a real control", () => {
    const steps = buildTourSteps({ user: member("OWNER", { role: "SUPER_ADMIN" }), agencyId: "a1" });
    for (const step of steps.slice(1)) {
      expect(typeof step.target).toBe("string");
      expect(step.bullets.length).toBeGreaterThan(0);
    }
  });

  it("never says Command Center", () => {
    const steps = buildTourSteps({ user: member("OWNER", { role: "SUPER_ADMIN" }), agencyId: "a1" });
    expect(JSON.stringify(steps)).not.toMatch(/command center/i);
  });

  it("builds a generic tour when nothing is known yet", () => {
    const steps = buildTourSteps();
    expect(steps[0].title).toBe("Welcome to Voyage");
    expect(steps[0].tab).toBe("command-center");
  });
});

describe("tourStorageKey", () => {
  it("scopes the flag to the account", () => {
    expect(tourStorageKey("u1")).toBe("voyage-tour-completed-v3:u1");
    expect(tourStorageKey(null)).toBe("voyage-tour-completed-v3:anonymous");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/tutorial-steps.test.js`
Expected: FAIL, `buildTourSteps is not a function`.

- [ ] **Step 3: Rewrite the step data**

Replace the whole of `app/components/trip-dashboard/tutorial/tutorialContent.js` with:

```js
// Step data for the first-run tour. buildTourSteps picks the steps for one person:
// agency members get the Dashboard, super admins get Admin, everyone gets the Planner,
// Itineraries and where to replay the tour.

// Still read by useTourFlow until Task 5 of the 2026-10-12 plan switches it to tourStorageKey.
export const VOYAGE_TOUR_STORAGE_KEY = "voyage-tour-completed-v2";

const TOUR_STORAGE_PREFIX = "voyage-tour-completed-v3";

/** The "seen the tour" flag, per account, so a new account on a shared browser still gets the tour. */
export function tourStorageKey(userId) {
  return `${TOUR_STORAGE_PREFIX}:${userId || "anonymous"}`;
}

// `audience` limits a Dashboard step to owners (and admins) or to staff.
const DASHBOARD_STEPS = [
  {
    id: "dashboard-needs-you",
    section: "Dashboard",
    tab: "dashboard",
    target: "dashboard-needs-you",
    placement: "bottom",
    compactPlacement: "bottom",
    title: "Start with what needs you",
    description: "Needs you lists the trips waiting on you: replies to send, plans to approve and trips leaving soon.",
    bullets: ["Each row says what to do next.", "Click a row to act on that trip."],
  },
  {
    id: "dashboard-calendar",
    section: "Dashboard",
    tab: "dashboard",
    target: "dashboard-calendar",
    placement: "top",
    compactPlacement: "top",
    title: "See trips by date",
    description: "The calendar shows every trip on the days it runs, so busy weeks stand out.",
    bullets: ["Click a day to see its trips.", "Open a trip from the day to see its details."],
  },
  {
    id: "dashboard-insights",
    audience: "owner",
    section: "Dashboard",
    tab: "dashboard",
    target: "dashboard-side",
    placement: "left",
    compactPlacement: "top",
    title: "Track how the agency is doing",
    description: "Insights shows how trips move from draft to approved, your key numbers and client ratings.",
    bullets: ["Switch the period to compare 7, 30 or 90 days.", "Ratings come from clients after their trip."],
  },
  {
    id: "dashboard-my-work",
    audience: "staff",
    section: "Dashboard",
    tab: "dashboard",
    target: "dashboard-side",
    placement: "left",
    compactPlacement: "top",
    title: "Pick up your own trips",
    description: "My work shows the trips assigned to you, starting with the one to continue next.",
    bullets: ["Continue opens the trip in the Planner.", "Your recent trips are listed below it."],
  },
];

const PLANNER_STEPS = [
  {
    id: "new-itinerary",
    section: "Planner",
    tab: "command-center",
    target: "new-itinerary",
    placement: "bottom",
    title: "Create a new itinerary",
    description: "Start a fresh trip draft from the Planner header when a new client inquiry comes in.",
    bullets: ["Voyage creates a draft you can refine before approval.", "Each draft gets its own chat with the agent."],
  },
  {
    id: "client-switcher",
    section: "Planner",
    tab: "command-center",
    target: "client-switcher",
    placement: "bottom",
    title: "Switch between trips",
    description: "Jump between live trips and drafts from one control. The chat, itinerary and map follow the trip you pick.",
    bullets: ["Open the menu to move to another trip.", "Drafts and saved trips are listed together."],
  },
  {
    id: "workspace",
    section: "Planner",
    tab: "command-center",
    target: "workspace-chat",
    placement: "right",
    title: "Plan with the agent",
    description: "Chat with Voyage here. Ask for a plan, then refine it in plain words.",
    bullets: ["Send changes through the composer at the bottom.", "Each step the agent takes shows above its reply."],
  },
  {
    id: "map-context",
    section: "Planner",
    tab: "command-center",
    target: "workspace-map",
    placement: "left",
    compactPlacement: "bottom",
    title: "Follow the plan on the map",
    description: "The map shows the stops and routes of the trip you're planning.",
    bullets: ["Pins show where each stop is.", "The map updates as the agent adds stops."],
  },
];

const ITINERARY_STEPS = [
  {
    id: "client-directory",
    section: "Itineraries",
    tab: "itineraries",
    target: "cip-client-directory",
    placement: "right",
    title: "Browse your clients",
    description: "The client list shows every traveler with a saved itinerary. Search by name or pick a client to load their trips.",
    bullets: ["Search filters the list as you type.", "Picking a client opens their saved itineraries."],
  },
  {
    id: "client-workspace",
    section: "Itineraries",
    tab: "itineraries",
    target: "cip-workspace",
    placement: "left",
    title: "Review saved itineraries",
    description: "The workspace shows the client's itinerary day by day, next to a map of every stop.",
    bullets: ["Days are on the left, the map on the right.", "Hover a stop to find it on the map."],
  },
  {
    id: "trip-selector",
    section: "Itineraries",
    tab: "itineraries",
    target: "cip-trip-selector",
    placement: "bottom",
    title: "Compare options for a client",
    description: "When a client has more than one saved itinerary, each gets a tab. Trips to the same place are numbered as options.",
    bullets: ["Each tab loads its own days and map.", "Use Another option to copy a trip as a starting point."],
  },
  {
    id: "day-strip",
    section: "Itineraries",
    tab: "itineraries",
    target: "cip-day-strip",
    placement: "bottom",
    title: "Go through the trip by day",
    description: "The day strip moves through the trip one day at a time and updates the stops and the map together.",
    bullets: ["Click a day to focus its stops and pins.", "Use it to check pacing and where the client stays."],
  },
  {
    id: "itinerary-actions",
    section: "Itineraries",
    tab: "itineraries",
    target: "cip-actions",
    placement: "bottom",
    title: "Share, discuss and export",
    description: "Open client comments, send a share link, download a PDF or print the itinerary from here.",
    bullets: ["Comments shows client replies with an unread count.", "PDF downloads a copy; Print sends it to your printer."],
  },
];

const ADMIN_STEPS = [
  {
    id: "admin-sections",
    section: "Admin",
    tab: "admin",
    target: "admin-sections",
    placement: "bottom",
    title: "Run the platform",
    description: "Admin is where you approve new agencies and look after accounts, usage and problem reports.",
    bullets: ["Agencies lists applications waiting for review.", "Reports collects the problems people send in."],
  },
];

// No tab: the sidebar's settings button is visible from every tab.
function replayStep(pageName) {
  return {
    id: "replay-help",
    section: pageName,
    target: "settings-replay",
    placement: "right",
    title: `Replay the tour from ${pageName}`,
    description: `${pageName} keeps this tour, so you can walk through it again whenever you need to.`,
    bullets: [`Open ${pageName} from the sidebar.`, "Use Replay tutorial to start it again."],
  };
}

function firstName(user) {
  const name = String(user?.displayName ?? "").trim();
  return name ? name.split(/\s+/)[0] : "";
}

/** The tour for one person: a welcome card, then the steps for their role, in tab order. */
export function buildTourSteps({ user = null, agencyId = null } = {}) {
  const isPersonal = user?.accountType === "PERSONAL";
  const hasDashboard = !isPersonal && Boolean(agencyId);
  const membership = Array.isArray(user?.memberships)
    ? user.memberships.find((entry) => entry?.agencyId === agencyId) ?? null
    : null;
  const audience = membership?.role === "STAFF" ? "staff" : "owner";

  const body = [
    ...(hasDashboard ? DASHBOARD_STEPS.filter((step) => !step.audience || step.audience === audience) : []),
    ...PLANNER_STEPS,
    ...ITINERARY_STEPS,
    ...(user?.role === "SUPER_ADMIN" ? ADMIN_STEPS : []),
    replayStep(isPersonal ? "My account" : "Settings"),
  ];

  const name = firstName(user);
  const welcome = {
    id: "welcome",
    section: null,
    tab: hasDashboard ? "dashboard" : "command-center",
    target: null,
    centered: true,
    title: name ? `Welcome to Voyage, ${name}` : "Welcome to Voyage",
    description: "A quick look at where things live. Skip it any time, and replay it later.",
    bullets: [],
    chips: [...new Set(body.map((step) => step.section))],
    nextLabel: "Start tour",
  };

  return [welcome, ...body];
}

// The generic tour, for callers that don't know the person yet.
export const voyageTourSteps = buildTourSteps();

export const voyageTourHelpBullets = [
  "The tour opens once per account. Replay it here any time.",
  "It highlights real controls on the Dashboard, Planner and Itineraries.",
  "Voyage switches tabs for you as the tour moves on.",
];
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/tutorial-steps.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/trip-dashboard/tutorial/tutorialContent.js tests/tutorial-steps.test.js
git commit -m "feat: build the first-run tour per role, with a welcome card"
```

---

### Task 3: Tour markers on the Dashboard and Admin (Haiku)

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx:92-109`
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx:95-113`
- Modify: `Voyage-Client/app/components/admin/AdminTopBar.jsx:15`
- Test: `Voyage-Client/tests/home-page-dashboard-tab.test.jsx`, `Voyage-Client/tests/admin-page.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `tests/home-page-dashboard-tab.test.jsx`:

```js
  it.each([
    ["OWNER", "dashboard-side", "Insights"],
    ["STAFF", "dashboard-side", "My work"],
  ])("marks the %s dashboard's sections for the tour", (role) => {
    const { container } = render(<HomePage user={agencyUser(role)} initialTab="dashboard" />);

    const needsYou = container.querySelector('[data-tour-target="dashboard-needs-you"]');
    expect(needsYou).toContainElement(screen.getByRole("heading", { name: "Needs you today" }));
    expect(container.querySelector('[data-tour-target="dashboard-calendar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tour-target="dashboard-side"]')).toBeInTheDocument();
    for (const target of ["dashboard-needs-you", "dashboard-calendar", "dashboard-side"]) {
      expect(container.querySelectorAll(`[data-tour-target="${target}"]`)).toHaveLength(1);
    }
  });
```

Append to `tests/admin-page.test.jsx`:

```js
  it("marks the section switcher for the tour", () => {
    const { container } = render(<AdminPage />);
    const marker = container.querySelector('[data-tour-target="admin-sections"]');
    expect(marker).toContainElement(screen.getByRole("tab", { name: "Agencies" }));
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/home-page-dashboard-tab.test.jsx tests/admin-page.test.jsx`
Expected: FAIL, the markers are null.

- [ ] **Step 3: Add the markers**

In `OwnerOverview.jsx`, replace the grid block (lines 92–109) with:

```jsx
      <div className={DASHBOARD_GRID_CLASS}>
        <div className="min-w-0 space-y-5">
          {/* Tour markers wrap whole sections so the spotlight has a box even while data loads. */}
          <div data-tour-target="dashboard-needs-you">
            {data ? <NeedsYouList ref={needsYouRef} items={needsYou} onAction={handleNeedsYouAction} /> : isLoading ? <NeedsYouSkeleton /> : null}
          </div>
          <div data-tour-target="dashboard-calendar">
            <AgencyCalendar agencyId={agencyId} onOpenTrip={openSlideOver} refreshKey={calendarRefreshKey} />
          </div>
        </div>
        {/* self-start keeps the marker as tall as the column, not the whole grid row. */}
        <div data-tour-target="dashboard-side" className="min-w-0 self-start">
          {data ? (
            <InsightsColumn
              data={data}
              period={period}
              onPeriodChange={setPeriod}
              isFetching={isFetching}
              agencyId={agencyId}
              onOpenViewedTrip={openSlideOver}
            />
          ) : isLoading ? (
            <SideColumnSkeleton label="Loading insights" />
          ) : null}
        </div>
      </div>
```

In `StaffMyWork.jsx`, replace the grid block (lines 95–113) with:

```jsx
      <div className={DASHBOARD_GRID_CLASS}>
        <div className="min-w-0 space-y-5">
          {/* Tour markers wrap whole sections so the spotlight has a box even while data loads. */}
          <div data-tour-target="dashboard-needs-you">
            {data ? <NeedsYouList ref={needsYouRef} items={needsYou} onAction={handleNeedsYouAction} /> : isLoading ? <NeedsYouSkeleton /> : null}
          </div>
          <div data-tour-target="dashboard-calendar">
            <AgencyCalendar agencyId={agencyId} onOpenTrip={openTripSlide} refreshKey={calendarRefreshKey} />
          </div>
        </div>
        {/* self-start keeps the marker as tall as the column, not the whole grid row. */}
        <div data-tour-target="dashboard-side" className="min-w-0 self-start">
          {data ? (
            <MyWorkColumn
              hero={data.hero ?? null}
              recent={data.secondaryRecent ?? []}
              pipeline={data.pipeline ?? null}
              agencyId={agencyId}
              onOpenTrip={openTrip}
              onOpenItineraries={onOpenItineraries}
              recentViews={data.recentViews}
              onOpenViewedTrip={openTripSlide}
            />
          ) : isLoading ? (
            <SideColumnSkeleton label="Loading your work" />
          ) : null}
        </div>
      </div>
```

In `AdminTopBar.jsx`, add the marker to the existing tabs wrapper (line 15):

```jsx
      <div data-tour-target="admin-sections" className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/home-page-dashboard-tab.test.jsx tests/admin-page.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add "app/agency/[agencyId]/components/dashboard/OwnerOverview.jsx" "app/agency/[agencyId]/components/dashboard/StaffMyWork.jsx" app/components/admin/AdminTopBar.jsx tests/home-page-dashboard-tab.test.jsx tests/admin-page.test.jsx
git commit -m "feat: mark the dashboard and admin sections for the tour"
```

---

### Task 4: Welcome card support in the tour overlay (Sonnet)

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/tutorial/FirstUseTutorial.jsx`
- Test: `Voyage-Client/tests/first-use-tutorial.test.jsx` (new)

The overlay keeps the last step's spotlight when a step has no target, because the measuring effect returns early (`if (!open || !activeStep?.target) return`). Going Back to the welcome card would leave the previous spotlight on screen. This task fixes that and adds the centred card.

- [ ] **Step 1: Write the failing test**

Create `tests/first-use-tutorial.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstUseTutorial from "../app/components/trip-dashboard/tutorial/FirstUseTutorial.jsx";

const steps = [
  {
    id: "welcome",
    target: null,
    centered: true,
    title: "Welcome to Voyage, Ana",
    description: "A quick look at where things live.",
    bullets: [],
    chips: ["Dashboard", "Planner"],
    nextLabel: "Start tour",
  },
  {
    id: "needs",
    target: "needs",
    placement: "bottom",
    title: "Start with what needs you",
    description: "Needs you lists the trips waiting on you.",
    bullets: ["Click a row to act on that trip."],
  },
];

// jsdom has no layout: give tour targets a real box and everything else none.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect() {
    return this.dataset?.tourTarget
      ? { top: 100, left: 100, width: 200, height: 80, right: 300, bottom: 180, x: 100, y: 100 }
      : { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderTour() {
  return render(
    <>
      <div data-tour-target="needs">Needs you</div>
      <FirstUseTutorial open steps={steps} onClose={vi.fn()} onStepChange={vi.fn()} />
    </>,
  );
}

const spotlight = () => document.querySelector("[data-tour-spotlight]");

describe("FirstUseTutorial welcome card", () => {
  it("shows the welcome card with its section chips and a Start tour button", () => {
    renderTour();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Welcome to Voyage, Ana")).toBeInTheDocument();
    const chips = within(dialog).getByRole("list", { name: "What the tour covers" });
    expect(within(chips).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Dashboard", "Planner"]);
    expect(within(dialog).getByRole("button", { name: "Start tour" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("centres the card in the window", () => {
    renderTour();
    // jsdom's window is 1024 x 768; the card is 370 wide and estimated 310 tall.
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "327px", top: "229px" });
  });

  it("has no spotlight on the welcome card", () => {
    renderTour();
    expect(spotlight()).toHaveAttribute("data-tour-spotlight", "none");
    expect(spotlight()).toHaveStyle({ display: "none" });
  });

  it("spotlights the next step's target, and clears it again on Back", async () => {
    renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    await waitFor(() => expect(spotlight()).not.toHaveStyle({ display: "none" }));
    expect(spotlight()).toHaveAttribute("data-tour-spotlight", "needs");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(spotlight()).toHaveStyle({ display: "none" }));
  });

  it("keeps bullets for normal steps", async () => {
    renderTour();
    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    expect(await screen.findByText("Click a row to act on that trip.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/first-use-tutorial.test.jsx`
Expected: FAIL (no chips list, button reads "Next", spotlight attribute missing).

- [ ] **Step 3: Implement**

In `FirstUseTutorial.jsx`:

(a) At the top of `getCoachPosition`, before `const placement = step?.placement;`, add:

```js
  // A step with nothing to point at (the welcome card) sits in the middle of the window.
  if (step?.centered) {
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const top = Math.max(VIEWPORT_PADDING, (viewportHeight - ESTIMATED_CARD_HEIGHT) / 2);
    if (isCompact) {
      return { left: VIEWPORT_PADDING, right: VIEWPORT_PADDING, top };
    }
    const width = Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_PADDING * 2);
    return { left: Math.max(VIEWPORT_PADDING, (viewportWidth - width) / 2), top, width };
  }
```

(b) Replace the start of the measuring effect (line 325 onward)

```js
  useEffect(() => {
    if (!open || !activeStep?.target) {
      return undefined;
    }
```

with:

```js
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    if (!activeStep?.target) {
      // No target (the welcome card): drop the previous step's spotlight.
      setTargetRect(null);
      return undefined;
    }
```

(c) On the spotlight element, make the attribute always present:

```jsx
        data-tour-spotlight={activeStep.target ?? "none"}
```

(d) Replace the bullets `<ul>` block (the `activeStep.bullets.map` list) with:

```jsx
        {activeStep.chips?.length ? (
          <ul aria-label="What the tour covers" className="mt-4 flex flex-wrap gap-1.5 max-[820px]:mt-3">
            {activeStep.chips.map((chip) => (
              <li key={chip} className="rounded-pill bg-white/8 px-2.5 py-1 text-xs font-semibold text-white/85">
                {chip}
              </li>
            ))}
          </ul>
        ) : null}

        {activeStep.bullets?.length ? (
          <ul className="mt-4 space-y-2 max-[820px]:mt-3 max-[820px]:space-y-1.5">
            {activeStep.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2 text-sm leading-6 text-white/72 max-[820px]:text-[0.78rem] max-[820px]:leading-5">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-secondary max-[820px]:mt-[7px] max-[820px]:h-1 max-[820px]:w-1" aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
```

(e) In the Next button, replace the text `Next` with `{activeStep.nextLabel ?? "Next"}`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/first-use-tutorial.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/trip-dashboard/tutorial/FirstUseTutorial.jsx tests/first-use-tutorial.test.jsx
git commit -m "feat: centred welcome card with section chips in the tour overlay"
```

---

### Task 5: Per-account "seen it" flag and role steps wiring (Sonnet)

**Files:**
- Rewrite: `Voyage-Client/app/hooks/useTourFlow.js`
- Modify: `Voyage-Client/app/components/trip-dashboard/tutorial/tutorialContent.js` (drop `VOYAGE_TOUR_STORAGE_KEY`)
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx:295`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/SettingsPage.jsx`
- Test: `Voyage-Client/tests/use-tour-flow.test.jsx` (new); update `tests/home-page-dashboard-tab.test.jsx:94-97`, `tests/home-page-traveler-needs.test.jsx:94`

- [ ] **Step 1: Write the failing test**

Create `tests/use-tour-flow.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTourFlow } from "../app/hooks/useTourFlow.js";
import { tourStorageKey } from "../app/components/trip-dashboard/tutorial/tutorialContent.js";

const cipTourState = { hasSelectedClient: false, hasMultipleTrips: false, hasItineraryDays: false };
const owner = {
  id: "u-owner",
  displayName: "Ana",
  accountType: "AGENCY_USER",
  memberships: [{ agencyId: "a1", role: "OWNER", status: "ACTIVE" }],
};

function setup(user = owner, agencyId = "a1") {
  const setActiveTab = vi.fn();
  const setIsSidebarOpen = vi.fn();
  const hook = renderHook(() => useTourFlow({ user, agencyId, cipTourState, setActiveTab, setIsSidebarOpen }));
  return { ...hook, setActiveTab, setIsSidebarOpen };
}

beforeEach(() => {
  localStorage.clear();
});

describe("useTourFlow", () => {
  it("opens with the person's own tour when their account hasn't seen it", () => {
    const { result } = setup();
    expect(result.current.isFirstUseTutorialOpen).toBe(true);
    expect(result.current.activeTourSteps[0]).toMatchObject({ id: "welcome", tab: "dashboard" });
    expect(result.current.activeTourSteps.map((step) => step.id)).toContain("dashboard-insights");
  });

  it("stays closed when this account has seen it", () => {
    localStorage.setItem(tourStorageKey("u-owner"), "true");
    expect(setup().result.current.isFirstUseTutorialOpen).toBe(false);
  });

  it("still opens for a new account on a browser where someone else finished it", () => {
    localStorage.setItem(tourStorageKey("someone-else"), "true");
    expect(setup().result.current.isFirstUseTutorialOpen).toBe(true);
  });

  it("shows the new tour once to people who finished the old one", () => {
    localStorage.setItem("voyage-tour-completed-v2", "true");
    expect(setup().result.current.isFirstUseTutorialOpen).toBe(true);
  });

  it("waits until the account is known", () => {
    expect(setup(null, null).result.current.isFirstUseTutorialOpen).toBe(false);
  });

  it("remembers closing for this account only", () => {
    const { result } = setup();
    act(() => result.current.closeFirstUseTutorial());

    expect(result.current.isFirstUseTutorialOpen).toBe(false);
    expect(localStorage.getItem(tourStorageKey("u-owner"))).toBe("true");
    expect(localStorage.getItem(tourStorageKey("someone-else"))).toBeNull();
  });

  it("replays from the welcome card", () => {
    const { result } = setup();
    act(() => result.current.closeFirstUseTutorial());
    act(() => result.current.replayFirstUseTutorial());

    expect(result.current.isFirstUseTutorialOpen).toBe(true);
    expect(result.current.activeTourSteps[0].id).toBe("welcome");
  });

  it("moves to each step's tab and opens the sidebar for the replay step", () => {
    const { result, setActiveTab, setIsSidebarOpen } = setup();

    act(() => result.current.handleFirstUseTutorialStepChange({ tab: "dashboard", target: null }));
    const updater = setActiveTab.mock.calls[0][0];
    expect(updater("command-center")).toBe("dashboard");

    act(() => result.current.handleFirstUseTutorialStepChange({ target: "settings-replay" }));
    expect(setIsSidebarOpen).toHaveBeenCalledWith(true);
  });

  it("gives a personal account the Planner start", () => {
    const { result } = setup({ id: "p1", displayName: "Lee", accountType: "PERSONAL", memberships: [] }, null);
    expect(result.current.activeTourSteps[0].tab).toBe("command-center");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/use-tour-flow.test.jsx`
Expected: FAIL (the hook ignores `agencyId`, reads the shared v2 key, and starts on the old step list).

- [ ] **Step 3: Rewrite the hook**

Replace the whole of `app/hooks/useTourFlow.js` with:

```js
// First-run tour: opens once per account, uses the steps for the person's role,
// and moves tabs, mobile panes and the sidebar as the tour advances.
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTourSteps, tourStorageKey } from "../components/trip-dashboard/tutorial/tutorialContent.js";

function hasSeenTour(userId) {
  try {
    return localStorage.getItem(tourStorageKey(userId)) === "true";
  } catch {
    return false;
  }
}

function rememberTourSeen(userId) {
  try {
    localStorage.setItem(tourStorageKey(userId), "true");
  } catch {
    // Storage blocked (private mode): the tour may show again next time.
  }
}

// Steps whose target only exists with real Itineraries data are dropped when it's missing.
function filterForItineraries(steps, cipTourState) {
  if (!cipTourState.hasSelectedClient) return steps;
  return steps.filter((step) => {
    if (step.target === "cip-trip-selector") return cipTourState.hasMultipleTrips;
    if (step.target === "cip-day-strip") return cipTourState.hasItineraryDays;
    return true;
  });
}

export function useTourFlow({ user, agencyId, cipTourState, setActiveTab, setIsSidebarOpen }) {
  const tourSteps = useMemo(() => buildTourSteps({ user, agencyId }), [user, agencyId]);
  const [isFirstUseTutorialOpen, setIsFirstUseTutorialOpen] = useState(false);
  const [activeTourSteps, setActiveTourSteps] = useState(tourSteps);
  const [tourMobilePaneOverride, setTourMobilePaneOverride] = useState(null);
  const [tourGlassSheetSnap, setTourGlassSheetSnap] = useState(null);
  const userId = user?.id ?? null;

  const visibleTourSteps = useMemo(() => filterForItineraries(tourSteps, cipTourState), [tourSteps, cipTourState]);

  // Decide once per account, not again when the profile object changes.
  useEffect(() => {
    if (!userId || hasSeenTour(userId)) return;
    setActiveTourSteps(tourSteps);
    setIsFirstUseTutorialOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const closeFirstUseTutorial = useCallback(() => {
    if (userId) rememberTourSeen(userId);
    setIsFirstUseTutorialOpen(false);
    setTourMobilePaneOverride(null);
    setTourGlassSheetSnap(null);
  }, [userId]);

  // The welcome step carries the start tab, so the step change below moves there.
  const replayFirstUseTutorial = useCallback(() => {
    setActiveTourSteps(filterForItineraries(tourSteps, cipTourState));
    setIsFirstUseTutorialOpen(true);
  }, [cipTourState, tourSteps]);

  const handleFirstUseTutorialStepChange = useCallback((step) => {
    if (step?.tab) {
      setActiveTab((current) => (current === step.tab ? current : step.tab));
    }
    if (step?.target === "cip-client-directory") {
      setTourMobilePaneOverride("list");
    } else if (
      step?.target === "cip-workspace" ||
      step?.target === "cip-trip-selector" ||
      step?.target === "cip-day-strip" ||
      step?.target === "cip-actions"
    ) {
      setTourMobilePaneOverride("detail");
    } else {
      setTourMobilePaneOverride(null);
    }
    if (step?.target === "workspace-chat") {
      setTourGlassSheetSnap("half");
    } else if (step?.target === "workspace-map") {
      setTourGlassSheetSnap("peek");
    } else {
      setTourGlassSheetSnap(null);
    }
    if (step?.target === "settings-replay") {
      setIsSidebarOpen(true);
    }
  }, [setActiveTab, setIsSidebarOpen]);

  return {
    isFirstUseTutorialOpen,
    activeTourSteps,
    tourMobilePaneOverride,
    tourGlassSheetSnap,
    visibleTourSteps,
    closeFirstUseTutorial,
    replayFirstUseTutorial,
    handleFirstUseTutorialStepChange,
  };
}
```

In `tutorialContent.js`, delete the two lines:

```js
// Still read by useTourFlow until Task 5 of the 2026-10-12 plan switches it to tourStorageKey.
export const VOYAGE_TOUR_STORAGE_KEY = "voyage-tour-completed-v2";
```

In `HomePage.jsx:295` pass the agency:

```js
  } = useTourFlow({ user, agencyId, cipTourState, setActiveTab, setIsSidebarOpen });
```

In `SettingsPage.jsx`:
- Change the import on line 3 to `import { buildTourSteps, voyageTourHelpBullets } from "../tutorial/tutorialContent.js";`
- After `const isPersonal = ...` add:

```js
  // The quick reference lists this person's own tour, minus the welcome card.
  const tourSteps = useMemo(
    () => buildTourSteps({ user, agencyId: agency?.id ?? null }).filter((step) => step.target),
    [user, agency?.id],
  );
```

- Replace `voyageTourSteps.length` with `tourSteps.length` and `voyageTourSteps.map(` with `tourSteps.map(`.
- Change the tutorial Panel description to `"Replay the walkthrough any time, or use the quick reference below to find where each action lives."`

- [ ] **Step 4: Point the HomePage tests at the new flag**

In `tests/home-page-dashboard-tab.test.jsx`, add to the imports:

```js
import { tourStorageKey } from "../app/components/trip-dashboard/tutorial/tutorialContent.js";
```

and replace the `beforeEach` body (lines 94–97) with:

```js
beforeEach(() => {
  localStorage.clear();
  // Every account these tests sign in with has already seen the tour.
  for (const id of ["user-owner", "user-staff", "user-new"]) localStorage.setItem(tourStorageKey(id), "true");
});
```

In `tests/home-page-traveler-needs.test.jsx`, add the same import and replace line 94 with:

```js
  localStorage.setItem(tourStorageKey("user-owner"), "true");
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/use-tour-flow.test.jsx tests/tutorial-steps.test.js tests/home-page-dashboard-tab.test.jsx tests/home-page-traveler-needs.test.jsx tests/settings-team.test.jsx tests/dashboard-rail.test.jsx`
Expected: PASS.

Run: `grep -rn "VOYAGE_TOUR_STORAGE_KEY\|voyage-tour-completed-v2" app tests`
Expected: only the test in `tests/use-tour-flow.test.jsx` that checks the old flag is ignored.

- [ ] **Step 6: Commit (client)**

```bash
git add app/hooks/useTourFlow.js app/components/trip-dashboard/tutorial/tutorialContent.js app/components/trip-dashboard/HomePage.jsx app/components/trip-dashboard/pages/SettingsPage.jsx tests/use-tour-flow.test.jsx tests/home-page-dashboard-tab.test.jsx tests/home-page-traveler-needs.test.jsx
git commit -m "feat: show the role tour once per account and list it in Settings"
```

---

# Part 2 — Another option for a client

### Task 6: Server — copy a trip as another option (Sonnet)

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryTypes.ts` (the `ItineraryRepository` type, after `reopenTrip`)
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRepository.ts` (add two methods after `reopenTrip`)
- Modify: `Voyage-Server/src/modules/itineraries/itineraryService.ts` (add two methods after `reopenTrip`)
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts` (new route after `/trips/:tripId/reopen`)
- Test: `Voyage-Server/tests/itineraryDuplicateTrip.test.ts` (new), `Voyage-Server/tests/itineraryEditRoutes.test.ts`

The copy starts **In review** (trip `IN_REVIEW`, itinerary `NEEDS_REVIEW`). That puts it on the Itineraries page right away, and `isItineraryEditable` in `itineraryLock.ts` allows edits to `NEEDS_REVIEW`. Shares, comments, ratings and chat history are not copied. Stops reuse the same `placeSnapshotId`, so no Google calls are made.

- [ ] **Step 1: Write the failing repository test**

Create `tests/itineraryDuplicateTrip.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { createPrismaItineraryRepository } from "../src/modules/itineraries/itineraryRepository";

const AGENCY = "agency-1";
const START = new Date("2026-11-01T00:00:00.000Z");
const END = new Date("2026-11-03T00:00:00.000Z");

function sourceTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    agencyId: AGENCY,
    createdByUserId: "owner-1",
    assignedOrganizerUserId: "staff-1",
    title: "Garcia itinerary",
    destinationSummary: "Baguio City",
    clientName: "Garcia",
    startDate: START,
    endDate: END,
    travelerCount: 4,
    budgetLevel: "Mid-range",
    status: "APPROVED_INTERNAL",
    itineraries: [
      {
        id: "itin-1",
        title: "Baguio weekend",
        summary: "Pines and food",
        status: "APPROVED_INTERNAL",
        version: 3,
        days: [
          {
            id: "day-1",
            dayNumber: 1,
            date: START,
            title: "Arrival",
            summary: null,
            items: [
              {
                id: "item-1", sortOrder: 1, type: "ACTIVITY", title: "Mines View Park", description: "Lookout",
                startTime: "09:00", endTime: "10:00", placeSnapshotId: "snap-1", routeFromPrevious: null,
                staffNotes: "Go early", clientNotes: "Bring a jacket", placeSnapshot: null
              },
              {
                id: "item-2", sortOrder: 2, type: "MEAL", title: "Good Taste", description: null,
                startTime: "12:00", endTime: null, placeSnapshotId: "snap-2", routeFromPrevious: { polyline: "abc" },
                staffNotes: null, clientNotes: null, placeSnapshot: null
              }
            ]
          }
        ]
      }
    ],
    agentThreads: [{ travelerNeeds: { needs: ["WHEELCHAIR"], notes: null } }],
    ...overrides
  };
}

function fakeClient(source: ReturnType<typeof sourceTrip> | null) {
  const calls: Record<string, any> = {};
  const client: any = {
    async $transaction(fn: (tx: unknown) => unknown) {
      return fn(client);
    },
    clientTrip: {
      async findFirst({ where }: any) {
        return source && where.id === source.id && where.agencyId === source.agencyId ? source : null;
      },
      async create({ data }: any) {
        calls.trip = data;
        return { id: "trip-2", ...data, createdAt: new Date(), updatedAt: new Date() };
      }
    },
    itinerary: {
      async create(args: any) {
        calls.itinerary = args;
        return { id: "itin-2", status: args.data.status, version: 1 };
      },
      async findFirst(args: any) {
        calls.latest = args;
        return { id: "itin-9" };
      }
    },
    agentThread: {
      async create(args: any) {
        calls.thread = args;
        return { id: "thread-2", tripId: args.data.tripId, title: args.data.title, travelerNeeds: args.data.travelerNeeds ?? null, createdAt: new Date() };
      }
    }
  };
  return { client, calls };
}

const duplicate = (client: any, tripId = "trip-1") =>
  createPrismaItineraryRepository(client).duplicateTrip({ tripId, agencyId: AGENCY, createdByUserId: "staff-9" });

describe("duplicateTrip", () => {
  it("creates a new in-review trip for the same client, made by whoever copied it", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.trip).toEqual({
      agencyId: AGENCY,
      createdByUserId: "staff-9",
      assignedOrganizerUserId: "staff-1",
      title: "Garcia itinerary",
      destinationSummary: "Baguio City",
      clientName: "Garcia",
      startDate: START,
      endDate: END,
      travelerCount: 4,
      budgetLevel: "Mid-range",
      status: "IN_REVIEW"
    });
    expect(result.trip.id).toBe("trip-2");
  });

  it("copies every day and stop into an itinerary that can still be edited", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.itinerary.data).toMatchObject({
      agencyId: AGENCY,
      tripId: "trip-2",
      createdByUserId: "staff-9",
      title: "Baguio weekend",
      summary: "Pines and food",
      status: "NEEDS_REVIEW"
    });
    const [day] = calls.itinerary.data.days.create;
    expect(day).toMatchObject({ dayNumber: 1, date: START, title: "Arrival", summary: null });
    expect(day.items.create).toEqual([
      {
        sortOrder: 1, type: "ACTIVITY", title: "Mines View Park", description: "Lookout", startTime: "09:00",
        endTime: "10:00", placeSnapshotId: "snap-1", routeFromPrevious: undefined, staffNotes: "Go early",
        clientNotes: "Bring a jacket"
      },
      {
        sortOrder: 2, type: "MEAL", title: "Good Taste", description: null, startTime: "12:00", endTime: null,
        placeSnapshotId: "snap-2", routeFromPrevious: { polyline: "abc" }, staffNotes: null, clientNotes: null
      }
    ]);
    expect(result.itinerary).toEqual({ id: "itin-2", status: "NEEDS_REVIEW", version: 1 });
  });

  it("gives the copy a fresh chat with the same traveler needs", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const result = await duplicate(client);

    expect(calls.thread.data).toEqual({
      agencyId: AGENCY,
      tripId: "trip-2",
      createdByUserId: "staff-9",
      title: "Garcia (another option)",
      travelerNeeds: { needs: ["WHEELCHAIR"], notes: null }
    });
    expect(result.thread.id).toBe("thread-2");
  });

  it("leaves traveler needs off when the trip's chat had none", async () => {
    const { client, calls } = fakeClient(sourceTrip({ agentThreads: [] }));
    await duplicate(client);
    expect(calls.thread.data).not.toHaveProperty("travelerNeeds");
  });

  it("names the chat after the trip when there is no client name", async () => {
    const { client, calls } = fakeClient(sourceTrip({ clientName: null }));
    await duplicate(client);
    expect(calls.thread.data.title).toBe("Garcia itinerary (another option)");
  });

  it("refuses a trip from another agency", async () => {
    const { client } = fakeClient(sourceTrip());
    await expect(duplicate(client, "trip-other")).rejects.toMatchObject({ statusCode: 404, code: "TRIP_NOT_FOUND" });
  });

  it("refuses a trip with no itinerary yet", async () => {
    const { client } = fakeClient(sourceTrip({ itineraries: [] }));
    await expect(duplicate(client)).rejects.toMatchObject({ statusCode: 409, code: "ITINERARY_REQUIRED" });
  });
});

describe("findTripLatestItineraryId", () => {
  it("returns the trip's newest itinerary in the agency", async () => {
    const { client, calls } = fakeClient(sourceTrip());
    const id = await createPrismaItineraryRepository(client).findTripLatestItineraryId("trip-1", AGENCY);

    expect(id).toBe("itin-9");
    expect(calls.latest).toEqual({
      where: { tripId: "trip-1", agencyId: AGENCY },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
  });
});
```

- [ ] **Step 2: Write the failing route test**

In `tests/itineraryEditRoutes.test.ts`:
- add `duplicateTrip: vi.fn(),` to the `mocks` object, and `duplicateTrip: mocks.duplicateTrip` to the mocked `itineraryService`;
- append:

```ts
describe("POST /trips/:tripId/duplicate", () => {
  it("checks trip access, then copies the trip for the signed-in user", async () => {
    const copied = { trip: { id: "trip-2" }, itinerary: { id: "itin-2", status: "NEEDS_REVIEW", version: 1 }, thread: { id: "thread-2" } };
    mocks.duplicateTrip.mockResolvedValue(copied);

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/duplicate`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(copied);
    expect(mocks.requireTripAccess).toHaveBeenCalledWith(staffUser, AGENCY_ID, TRIP_ID);
    expect(mocks.duplicateTrip).toHaveBeenCalledWith(AGENCY_ID, TRIP_ID, "user-staff");
  });

  it("refuses staff who aren't assigned to the trip", async () => {
    mocks.requireTripAccess.mockRejectedValue(notAssigned());

    const res = await request(createApp()).post(`${base}/trips/${TRIP_ID}/duplicate`);

    expect(res.status).toBe(404);
    expect(mocks.duplicateTrip).not.toHaveBeenCalled();
  });

  it("rejects a malformed trip id", async () => {
    const res = await request(createApp()).post(`${base}/trips/not-a-uuid/duplicate`);
    expect(res.status).toBe(400);
    expect(mocks.duplicateTrip).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both and see them fail**

Run: `npx vitest run tests/itineraryDuplicateTrip.test.ts tests/itineraryEditRoutes.test.ts`
Expected: FAIL (`duplicateTrip is not a function`; the route answers 404).

- [ ] **Step 4: Implement**

In `itineraryTypes.ts`, add inside `ItineraryRepository` after `reopenTrip(...)`:

```ts
  /**
   * Copy a trip as another option for the same client: a new trip and itinerary with the
   * same days and stops, in review (still editable), and a fresh chat carrying the trip's
   * traveler needs. Shares, comments, ratings and chat history stay with the original.
   */
  duplicateTrip(data: {
    tripId: string;
    agencyId: string;
    createdByUserId: string;
  }): Promise<{
    trip: ClientTripRecord;
    itinerary: { id: string; status: string; version: number };
    thread: { id: string; tripId: string | null; title: string; travelerNeeds: unknown; createdAt: Date };
  }>;
  /** The id of the trip's newest itinerary, or null when it has none. */
  findTripLatestItineraryId(tripId: string, agencyId: string): Promise<string | null>;
```

In `itineraryRepository.ts`, add after `reopenTrip`:

```ts
    async duplicateTrip({ tripId, agencyId, createdByUserId }) {
      return client.$transaction(async (tx) => {
        const source = await tx.clientTrip.findFirst({
          where: { id: tripId, agencyId },
          include: {
            itineraries: { orderBy: { createdAt: "desc" as const }, take: 1, include: includeItineraryDetails() },
            agentThreads: { orderBy: { createdAt: "desc" as const }, take: 1, select: { travelerNeeds: true } }
          }
        });
        if (!source) {
          throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
        }
        const sourceItinerary = source.itineraries[0];
        if (!sourceItinerary) {
          throw new ApiError(409, "ITINERARY_REQUIRED", "This trip has no itinerary to copy yet.");
        }

        const trip = await tx.clientTrip.create({
          data: {
            agencyId,
            createdByUserId,
            assignedOrganizerUserId: source.assignedOrganizerUserId,
            title: source.title,
            destinationSummary: source.destinationSummary,
            clientName: source.clientName,
            startDate: source.startDate,
            endDate: source.endDate,
            travelerCount: source.travelerCount,
            budgetLevel: source.budgetLevel,
            // In review, like a saved draft: listed on the Itineraries page, editable until approved.
            status: "IN_REVIEW"
          }
        });

        const itinerary = await tx.itinerary.create({
          data: {
            agencyId,
            tripId: trip.id,
            createdByUserId,
            title: sourceItinerary.title,
            summary: sourceItinerary.summary,
            status: "NEEDS_REVIEW",
            days: {
              create: sourceItinerary.days.map((day) => ({
                dayNumber: day.dayNumber,
                date: day.date,
                title: day.title,
                summary: day.summary,
                items: {
                  // Same place snapshots, so the copy costs no new Google lookups.
                  create: day.items.map((item) => ({
                    sortOrder: item.sortOrder,
                    type: item.type,
                    title: item.title,
                    description: item.description,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    placeSnapshotId: item.placeSnapshotId,
                    routeFromPrevious:
                      item.routeFromPrevious === null ? undefined : (item.routeFromPrevious as Prisma.InputJsonValue),
                    staffNotes: item.staffNotes,
                    clientNotes: item.clientNotes
                  }))
                }
              }))
            }
          },
          select: { id: true, status: true, version: true }
        });

        const travelerNeeds = source.agentThreads[0]?.travelerNeeds;
        const thread = await tx.agentThread.create({
          data: {
            agencyId,
            tripId: trip.id,
            createdByUserId,
            title: `${source.clientName ?? source.title} (another option)`,
            ...(travelerNeeds ? { travelerNeeds: travelerNeeds as Prisma.InputJsonValue } : {})
          },
          select: { id: true, tripId: true, title: true, travelerNeeds: true, createdAt: true }
        });

        return { trip: trip as unknown as ClientTripRecord, itinerary, thread };
      });
    },

    async findTripLatestItineraryId(tripId, agencyId) {
      const row = await client.itinerary.findFirst({
        where: { tripId, agencyId },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      return row?.id ?? null;
    },
```

In `itineraryService.ts`, add after `reopenTrip`:

```ts
    async duplicateTrip(agencyId: string, tripId: string, userId: string) {
      return options.repository.duplicateTrip({ tripId, agencyId, createdByUserId: userId });
    },

    async findTripLatestItineraryId(agencyId: string, tripId: string) {
      return options.repository.findTripLatestItineraryId(tripId, agencyId);
    },
```

In `itineraryRoutes.ts`, add after the `/trips/:tripId/reopen` route:

```ts
// Copy a trip as another option for the same client: a new trip in review with the same
// days and stops, and a fresh Planner chat. Same access rule as changing the trip.
itineraryRoutes.post("/trips/:tripId/duplicate", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const { tripId } = tripIdParamsSchema.parse(request.params);
    await agencyAccessService.requireTripAccess(request.authUser!, agencyId, tripId);
    const result = await itineraryService.duplicateTrip(agencyId, tripId, request.authUser!.id);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run tests/itineraryDuplicateTrip.test.ts tests/itineraryEditRoutes.test.ts tests/itineraryService.test.ts tests/authenticatedValidation.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit (server)**

```bash
git add src/modules/itineraries tests/itineraryDuplicateTrip.test.ts tests/itineraryEditRoutes.test.ts
git commit -m "feat: copy a trip as another option for the same client"
```

---

### Task 7: Server — a copy's fresh chat works on its trip's itinerary (Sonnet)

**Files:**
- Modify: `Voyage-Server/src/modules/workspace/workspaceService.ts` (trip select at ~line 64; the `threads` mapping at ~line 170; the `TripSummary` type if it lists fields)
- Modify: `Voyage-Server/src/modules/agent/agentContextBuilder.ts:99-133`
- Modify: `Voyage-Server/src/modules/agent/agentOrchestrator.ts` (options type ~line 134; run body ~lines 250–277)
- Modify: `Voyage-Server/src/modules/agent/agentFactory.ts` (after `loadCurrentItinerary`, ~line 215)
- Test: `Voyage-Server/tests/workspaceService.test.ts`, `Voyage-Server/tests/agentTripItineraryContext.test.ts` (new)

A thread finds its itinerary through its own `itinerary.created`/`itinerary.updated` and `tool.completed` events. A copied option's chat has none yet. Without this task the Planner shows no itinerary for the copy after a reload, and "make this cheaper" makes the agent start a new itinerary instead of editing the copy.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `tests/workspaceService.test.ts`:

```ts
  it("points a trip's chat with no itinerary events at the trip's newest itinerary", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([
      { id: "trip-2", itineraries: [{ id: "itin-2", status: "NEEDS_REVIEW", version: 1 }] }
    ]);
    threadFindManyMock.mockResolvedValue([
      { id: "t2", agencyId: "a1", tripId: "trip-2", title: "Garcia (another option)", status: "ACTIVE", createdByUserId: "u1", createdAt: new Date(), updatedAt: new Date(), travelerNeeds: null }
    ]);
    runEventFindManyMock.mockResolvedValue([]);
    itineraryFindManyMock.mockResolvedValue([
      { id: "itin-2", tripId: "trip-2", title: "Baguio weekend", summary: null, status: "NEEDS_REVIEW", version: 1, updatedAt: new Date() }
    ]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads[0].itineraryId).toBe("itin-2");
    expect(result.itinerarySummaries["itin-2"]).toBeDefined();
  });

  it("keeps the itinerary named by the chat's own events", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([{ id: "trip-1", itineraries: [{ id: "itin-new", status: "DRAFT", version: 1 }] }]);
    threadFindManyMock.mockResolvedValue([
      { id: "t1", agencyId: "a1", tripId: "trip-1", title: "Plan", status: "ACTIVE", createdByUserId: "u1", createdAt: new Date(), updatedAt: new Date(), travelerNeeds: null }
    ]);
    runEventFindManyMock.mockResolvedValue([{ threadId: "t1", payload: { itineraryId: "itin-old" } }]);
    itineraryFindManyMock.mockResolvedValue([]);

    const result = await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(result.threads[0].itineraryId).toBe("itin-old");
  });

  it("asks for each trip's creation time, so options can be numbered in order", async () => {
    resetMocks();
    tripFindManyMock.mockResolvedValue([]);
    threadFindManyMock.mockResolvedValue([]);

    await getBootstrap("a1", { role: "OWNER", userId: "owner-1" });

    expect(tripFindManyMock.mock.calls[0][0].select.createdAt).toBe(true);
  });
```

Create `tests/agentTripItineraryContext.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ITINERARY_LOCKED_NOTICE, buildTripItineraryContext } from "../src/modules/agent/agentContextBuilder";

describe("buildTripItineraryContext", () => {
  it("makes the trip's live itinerary the one the agent edits", () => {
    const live = { id: "itin-2", status: "NEEDS_REVIEW", days: [{ id: "d1", items: [] }] };
    const context = buildTripItineraryContext(live);

    expect(context?.itinerary).toBe(live);
    expect(context?.prompt).toContain("Active itinerary draft context");
    expect(context?.prompt).not.toContain(ITINERARY_LOCKED_NOTICE);
  });

  it("tells the agent an approved itinerary is locked", () => {
    const context = buildTripItineraryContext({ id: "itin-2", status: "APPROVED_INTERNAL", days: [] });
    expect(context?.prompt).toContain(ITINERARY_LOCKED_NOTICE);
  });

  it("returns nothing when there is no readable itinerary", () => {
    expect(buildTripItineraryContext(null)).toBeNull();
    expect(buildTripItineraryContext({ id: "itin-2" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/workspaceService.test.ts tests/agentTripItineraryContext.test.ts`
Expected: FAIL (`itineraryId` is null; `buildTripItineraryContext` is not exported).

- [ ] **Step 3: Implement the workspace fallback**

In `workspaceService.ts`, add `createdAt: true,` to the `clientTrip.findMany` select (next to `updatedAt: true`). If the file declares a `TripSummary` type that lists fields, add `createdAt: Date;` to it.

Replace the `threads` mapping at the end of `getBootstrap` with:

```ts
  // A chat with no itinerary events of its own (a copied option's fresh chat) works on
  // its trip's newest itinerary. Those ids are already in `itinerarySummaries`.
  const tripLatestItinerary = new Map(trips.map((t) => [t.id, t.itineraries[0]?.id ?? null]));

  const threads: ThreadSummary[] = rawThreads.map((t) => ({
    ...t,
    itineraryId: threadItineraryMap.get(t.id) ?? (t.tripId ? tripLatestItinerary.get(t.tripId) ?? null : null),
  }));
```

- [ ] **Step 4: Implement the agent fallback**

In `agentContextBuilder.ts`, add above `buildActiveItineraryContext`:

```ts
const ACTIVE_ITINERARY_PROMPT = [
  "Active itinerary draft context",
  "The user may ask to modify this draft. Prefer the granular tools (update_itinerary_item, add_itinerary_item, remove_itinerary_item, move_itinerary_item, add/update/remove_itinerary_day) so changes stream as discrete events.",
  "Reserve update_itinerary (full replacement) for explicit wholesale-rewrite requests."
].join("\n");
```

and inside `buildActiveItineraryContext` replace the inline `prompt: [ ... ].join("\n"),` with `prompt: ACTIVE_ITINERARY_PROMPT,`.

Add after `withLiveItinerary`:

```ts
/**
 * A trip's chat with no itinerary tool events yet (a copied option's fresh chat) works on
 * the trip's newest itinerary, read live under the run's own authorization.
 */
export function buildTripItineraryContext(live: unknown) {
  const itinerary = extractItineraryFromToolOutput(live);
  if (!itinerary) return null;
  return withLiveItinerary({ prompt: ACTIVE_ITINERARY_PROMPT, itinerary }, live);
}
```

In `agentOrchestrator.ts`:
- add `buildTripItineraryContext,` to the import from `./agentContextBuilder`;
- add to the options type, after `loadCurrentItinerary`:

```ts
  /**
   * Reads a trip's newest itinerary under the run's own authorization, for a trip's chat
   * that has no itinerary tool events yet (a copied option's fresh chat).
   */
  loadTripItinerary?: (input: { agencyId: string | null; userId: string; tripId: string }) => Promise<unknown>;
```

- add next to `refreshActiveItinerary`:

```ts
        async function loadTripItineraryContext(tripId: string | null) {
          if (!tripId || !options.loadTripItinerary) return null;
          try {
            return buildTripItineraryContext(
              await options.loadTripItinerary({ agencyId: input.agencyId, userId: input.userId, tripId })
            );
          } catch (error) {
            console.error("[Agent] Failed to load the trip's itinerary; starting without one.", error);
            return null;
          }
        }
```

- replace `activeItineraryContext = await refreshActiveItinerary(buildActiveItineraryContext(thread));` with:

```ts
          const eventContext = buildActiveItineraryContext(thread);
          activeItineraryContext = eventContext
            ? await refreshActiveItinerary(eventContext)
            : await loadTripItineraryContext((thread as { tripId?: string | null }).tripId ?? null);
```

In `agentFactory.ts`, add after the `loadCurrentItinerary` option:

```ts
    // A copied option's fresh chat has no itinerary events: read its trip's newest itinerary.
    // Personal threads have no trips.
    loadTripItinerary: async ({ agencyId, tripId }) => {
      if (!agencyId) return null;
      try {
        const itineraryId = await itineraryService.findTripLatestItineraryId(agencyId, tripId);
        return itineraryId ? await itineraryService.getItinerary(agencyId, itineraryId) : null;
      } catch {
        return null;
      }
    },
```

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run tests/workspaceService.test.ts tests/agentTripItineraryContext.test.ts tests/agentRuntimeContext.test.ts`
Expected: PASS.

Run: `npx vitest run tests/agentOrchestrator.test.ts`
Expected: the same 4 known stale failures as the baseline, no new ones.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit (server)**

```bash
git add src/modules/workspace/workspaceService.ts src/modules/agent tests/workspaceService.test.ts tests/agentTripItineraryContext.test.ts
git commit -m "feat: a copied option's chat works on its trip's itinerary"
```

---

### Task 8: Client — trip rows, option tab labels and the API call (Sonnet)

**Files:**
- Create: `Voyage-Client/app/lib/trip-dashboard/portfolioTrips.js`
- Modify: `Voyage-Client/app/lib/trip-dashboard/savedItineraries.js` (append `buildTripTabLabels`)
- Modify: `Voyage-Client/app/lib/api/agency.js`, `Voyage-Client/app/lib/api/index.js`
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx` (the two trip mappings at ~lines 340–356 and ~588–600)
- Test: `Voyage-Client/tests/portfolio-trips.test.js`, `Voyage-Client/tests/trip-tab-labels.test.js` (both new)

`toPortfolioTrip` gets its own file, not `savedItineraries.js`: the Itineraries page tests mock `formatters.js` with a short export list, and `savedItineraries.js` is imported by that page.

- [ ] **Step 1: Write the failing tests**

Create `tests/portfolio-trips.test.js`:

```js
import { describe, expect, it } from "vitest";
import { toPortfolioTrip } from "../app/lib/trip-dashboard/portfolioTrips.js";

describe("toPortfolioTrip", () => {
  it("keeps what the Itineraries page and the Planner need, including when the trip was made", () => {
    const row = toPortfolioTrip({
      id: "trip-2",
      clientName: "Garcia",
      title: "Garcia itinerary",
      destinationSummary: "Baguio City",
      startDate: null,
      endDate: null,
      status: "IN_REVIEW",
      createdAt: "2026-10-12T02:00:00.000Z",
      itineraries: [{ id: "itin-2", status: "NEEDS_REVIEW", version: 1 }],
    });

    expect(row).toMatchObject({
      id: "trip-2",
      clientName: "Garcia",
      destination: "Baguio City",
      status: "active",
      approvalStatus: "In review",
      itineraryId: "itin-2",
      itineraryVersion: 1,
      createdAt: "2026-10-12T02:00:00.000Z",
    });
  });

  it("falls back to the title for the destination and marks archived trips", () => {
    const row = toPortfolioTrip({ id: "t", title: "Weekend", status: "ARCHIVED", itineraries: [] });
    expect(row).toMatchObject({ destination: "Weekend", status: "archived", itineraryId: null, createdAt: null });
  });
});
```

Create `tests/trip-tab-labels.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildTripTabLabels } from "../app/lib/trip-dashboard/savedItineraries.js";

describe("buildTripTabLabels", () => {
  it("keeps the destination when a client has one trip there", () => {
    const labels = buildTripTabLabels([
      { id: "a", destination: "Tokyo" },
      { id: "b", destination: "Lisbon" },
    ]);
    expect(labels.get("a")).toBe("Tokyo");
    expect(labels.get("b")).toBe("Lisbon");
  });

  it("numbers trips to the same place as options, oldest first", () => {
    const labels = buildTripTabLabels([
      { id: "new", destination: "Baguio City", createdAt: "2026-10-12T02:00:00Z" },
      { id: "tokyo", destination: "Tokyo", createdAt: "2026-10-05T00:00:00Z" },
      { id: "old", destination: "baguio city ", createdAt: "2026-10-01T00:00:00Z" },
    ]);
    expect(labels.get("old")).toBe("Option 1 · baguio city");
    expect(labels.get("new")).toBe("Option 2 · Baguio City");
    expect(labels.get("tokyo")).toBe("Tokyo");
  });

  it("uses list order (newest first) when creation times are missing", () => {
    const labels = buildTripTabLabels([
      { id: "second", destination: "Baguio City" },
      { id: "first", destination: "Baguio City" },
    ]);
    expect(labels.get("first")).toBe("Option 1 · Baguio City");
    expect(labels.get("second")).toBe("Option 2 · Baguio City");
  });

  it("names trips without a destination", () => {
    expect(buildTripTabLabels([{ id: "x" }]).get("x")).toBe("Unnamed Trip");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/portfolio-trips.test.js tests/trip-tab-labels.test.js`
Expected: FAIL (module not found; `buildTripTabLabels` is not a function).

- [ ] **Step 3: Implement**

Create `app/lib/trip-dashboard/portfolioTrips.js`:

```js
import { formatTripDates, mapTripStatus } from "../formatters.js";

/** One agency trip row (workspace bootstrap or GET /itineraries) as the Itineraries page and the Planner use it. */
export function toPortfolioTrip(trip) {
  const firstItinerary = Array.isArray(trip?.itineraries) ? trip.itineraries[0] : null;
  return {
    id: trip.id,
    clientName: trip.clientName ?? null,
    destination: trip.destinationSummary ?? trip.title,
    travelWindow: formatTripDates(trip.startDate, trip.endDate),
    status: trip.status?.toLowerCase() === "archived" ? "archived" : "active",
    approvalStatus: mapTripStatus(trip.status),
    itineraryId: firstItinerary?.id ?? null,
    itineraryVersion: firstItinerary?.version ?? null,
    createdAt: trip.createdAt ?? null,
  };
}
```

Append to `app/lib/trip-dashboard/savedItineraries.js`:

```js
function createdTime(trip) {
  const time = Date.parse(trip?.createdAt ?? "");
  return Number.isNaN(time) ? null : time;
}

/**
 * Tab labels for one client's trips. Trips to the same place are alternatives, so they
 * are numbered as options in the order they were made: "Option 1 · Baguio City".
 */
export function buildTripTabLabels(trips = []) {
  const list = Array.isArray(trips) ? trips : [];
  const groups = new Map();
  list.forEach((trip, index) => {
    const key = normalizeText(trip?.destination).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ trip, index });
  });

  const labels = new Map();
  for (const members of groups.values()) {
    const ordered = [...members].sort((a, b) => {
      const timeA = createdTime(a.trip);
      const timeB = createdTime(b.trip);
      if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;
      // Trip lists come newest first, so a later position is an older trip.
      return b.index - a.index;
    });
    ordered.forEach(({ trip }, position) => {
      const base = normalizeText(trip?.destination) || "Unnamed Trip";
      labels.set(trip.id, members.length > 1 ? `Option ${position + 1} · ${base}` : base);
    });
  }
  return labels;
}
```

(`normalizeText` is already defined in `savedItineraries.js`. Check it trims; if it doesn't, wrap the destination in `.trim()` in both places above.)

Append to `app/lib/api/agency.js`:

```js
// Copy a trip as another option for the same client. Answers { trip, itinerary, thread }.
export async function duplicateClientTrip(agencyId, tripId) {
  return fetchApi(`/agencies/${agencyId}/itineraries/trips/${tripId}/duplicate`, {
    method: "POST",
  });
}
```

and add `duplicateClientTrip,` to the `// Agency` export block in `app/lib/api/index.js`.

In `HomePage.jsx`, import the helper:

```js
import { toPortfolioTrip } from "../../lib/trip-dashboard/portfolioTrips.js";
```

Replace the bootstrap effect body's `setFetchedTrips(bootstrapTrips.map((t) => { ... }))` with `setFetchedTrips(bootstrapTrips.map(toPortfolioTrip));`. In the `listAgencyTrips(agencyId).then((r) => { ... })` block, replace the inline `trips.map((t) => { ... })` with `trips.map(toPortfolioTrip)`. Leave the personal-itineraries mapping alone (it has no client or trip rows).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/portfolio-trips.test.js tests/trip-tab-labels.test.js tests/home-page-dashboard-tab.test.jsx tests/client-itinerary-approve.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add app/lib/trip-dashboard/portfolioTrips.js app/lib/trip-dashboard/savedItineraries.js app/lib/api/agency.js app/lib/api/index.js app/components/trip-dashboard/HomePage.jsx tests/portfolio-trips.test.js tests/trip-tab-labels.test.js
git commit -m "feat: number a client's trips to the same place as options"
```

---

### Task 9: Client — "Another option" button, tabs and Planner hand-off (Sonnet)

**Files:**
- Create: `Voyage-Client/app/components/trip-dashboard/layout/FlashNotice.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ItineraryHeader.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx` (props, both trip-tab renders at ~lines 680–695 and ~875–898, the `ItineraryHeader` props at ~line 849)
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`
- Test: `Voyage-Client/tests/itinerary-header.test.jsx`, `Voyage-Client/tests/flash-notice.test.jsx` (new), `Voyage-Client/tests/client-itinerary-options.test.jsx` (new)

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `tests/itinerary-header.test.jsx`:

```jsx
  it("offers Another option when the page passes a handler", () => {
    const onMakeOption = vi.fn();
    renderHeader({ onMakeOption });

    fireEvent.click(screen.getByRole("button", { name: "Make another option for Danang" }));
    expect(onMakeOption).toHaveBeenCalledOnce();
  });

  it("has no Another option without a handler", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: /another option/i })).not.toBeInTheDocument();
  });

  it("shows the copy in progress and blocks a second click", () => {
    renderHeader({ onMakeOption: vi.fn(), isMakingOption: true });
    const button = screen.getByRole("button", { name: "Make another option for Danang" });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Copying…");
  });
```

Create `tests/flash-notice.test.jsx`:

```jsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FlashNotice from "../app/components/trip-dashboard/layout/FlashNotice.jsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FlashNotice", () => {
  it("announces the message and clears it after six seconds", () => {
    const onDone = vi.fn();
    render(<FlashNotice message="New option created." onDone={onDone} />);

    expect(screen.getByRole("status")).toHaveTextContent("New option created.");
    act(() => vi.advanceTimersByTime(5999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("keeps an empty live region mounted when there is nothing to say", () => {
    render(<FlashNotice message="" onDone={vi.fn()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
```

Create `tests/client-itinerary-options.test.jsx`. Copy **every `vi.mock(...)` call and the `approveClientTripMock` declaration** from the top of `tests/client-itinerary-approve.test.jsx` (lines 1–113, up to and including the `vi.mock("../app/lib/api/index.js", ...)` block) unchanged, then add:

```jsx
// Two Baguio trips are options; Tokyo is a different trip.
const baguioOld = { id: "t1", clientName: "Alice", approvalStatus: "In review", destination: "Baguio City", itineraryId: "iter-1", isSaved: true, createdAt: "2026-10-01T00:00:00Z" };
const baguioNew = { id: "t3", clientName: "Alice", approvalStatus: "In review", destination: "Baguio City", itineraryId: "iter-3", isSaved: true, createdAt: "2026-10-12T02:00:00Z" };
const tokyo = { id: "t2", clientName: "Alice", approvalStatus: "Approved", destination: "Tokyo", itineraryId: "iter-2", isSaved: true, createdAt: "2026-10-05T00:00:00Z" };

describe("Options on ClientItineraryPage", () => {
  it("numbers trips to the same place as options", async () => {
    render(<ClientItineraryPage agencyTrips={[baguioNew, tokyo, baguioOld]} agencyId="agency-1" />);

    expect((await screen.findAllByRole("button", { name: "Option 1 · Baguio City" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Option 2 · Baguio City" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Tokyo" }).length).toBeGreaterThan(0);
  });

  it("copies the selected trip from Another option", async () => {
    const onDuplicateTrip = vi.fn();
    render(<ClientItineraryPage agencyTrips={[baguioNew, tokyo, baguioOld]} agencyId="agency-1" onDuplicateTrip={onDuplicateTrip} />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Option 1 · Baguio City" }))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Make another option for Alice" })[0]);

    expect(onDuplicateTrip).toHaveBeenCalledWith("t1");
  });

  it("has no Another option when the page can't copy", async () => {
    render(<ClientItineraryPage agencyTrips={[baguioOld]} agencyId="agency-1" />);
    await screen.findAllByText("Alice");
    expect(screen.queryByRole("button", { name: /another option/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/itinerary-header.test.jsx tests/flash-notice.test.jsx tests/client-itinerary-options.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement the header control**

In `ItineraryHeader.jsx`, add two props after `onAddTripForClient,`:

```js
  // "Another option" shows only when the page passes a handler (a real, saved trip).
  onMakeOption = null,
  isMakingOption = false,
```

and right after the `onAddTripForClient ? (...) : null` block in the status line, add:

```jsx
              {onMakeOption ? (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onMakeOption}
                    disabled={isMakingOption}
                    aria-label={`Make another option for ${selectedClient.name}`}
                    title="Copy this trip as the starting point for another option"
                    className="inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded-md bg-transparent font-semibold text-secondary-strong underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60"
                  >
                    {isMakingOption ? "Copying…" : "Another option"}
                  </button>
                </>
              ) : null}
```

- [ ] **Step 4: Implement the page wiring**

In `ClientItineraryPage.jsx`:
- add `onDuplicateTrip = null,` and `isDuplicatingTrip = false,` to the props;
- import `buildTripTabLabels` next to the existing `savedItineraries.js` import;
- after `selectedClient` is known, add:

```js
  const tripTabLabels = useMemo(() => buildTripTabLabels(selectedClient?.trips ?? []), [selectedClient]);
```

- in **both** trip-tab renders, replace `{t.destination || "Unnamed Trip"}` with `{tripTabLabels.get(t.id) ?? (t.destination || "Unnamed Trip")}`;
- in the `<ItineraryHeader ...>` props add:

```jsx
              onMakeOption={
                onDuplicateTrip && selectedTrip?.id && selectedItineraryId && !isTutorialItinerary
                  ? () => onDuplicateTrip(selectedTrip.id)
                  : null
              }
              isMakingOption={isDuplicatingTrip}
```

(If the variable holding the selected trip has another name in this file, use that; it is the trip the header already receives as `selectedTrip`.)

Create `app/components/trip-dashboard/layout/FlashNotice.jsx`:

```jsx
"use client";

import { useEffect } from "react";

/** A short message pinned to the top of the dashboard that clears itself. The live region stays mounted. */
export default function FlashNotice({ message, onDone, durationMs = 6000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => onDone?.(), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onDone, durationMs]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[160] flex justify-center px-4">
      {message ? (
        <p className="m-0 max-w-[560px] rounded-pill bg-sidebar px-4 py-2 text-sm font-semibold text-white shadow-strong">
          {message}
        </p>
      ) : null}
    </div>
  );
}
```

In `HomePage.jsx`:
- add `duplicateClientTrip,` to the `../../lib/api/index.js` import;
- import `normalizeTravelerNeeds` from `../../lib/accessibility/travelerNeeds.js` and `FlashNotice` from `./layout/FlashNotice.jsx`;
- add state near the other `useState` calls:

```js
  const [isMakingOption, setIsMakingOption] = useState(false);
  const [flashNotice, setFlashNotice] = useState("");
  const clearFlashNotice = useCallback(() => setFlashNotice(""), []);
```

- add the handler after `handleNewItinerary`:

```js
  // Copy a saved trip as another option, then open the copy in the Planner to adjust it.
  const handleMakeOption = useCallback(async (tripId) => {
    if (!agencyId || !tripId || isMakingOption) return;
    setIsMakingOption(true);
    try {
      const { trip, itinerary, thread } = await duplicateClientTrip(agencyId, tripId);
      const listed = await listAgencyTrips(agencyId).catch(() => null);
      if (Array.isArray(listed?.trips)) setFetchedTrips(listed.trips.map(toPortfolioTrip));
      // Seed the copy's chat so the Planner hydrates it instead of creating another thread.
      setTripStates((previous) => ({
        ...previous,
        [trip.id]: {
          threadId: thread.id,
          messages: [],
          itinerary: { id: itinerary.id },
          loaded: false,
          createdAt: thread.createdAt ?? null,
          travelerNeeds: normalizeTravelerNeeds(thread.travelerNeeds),
        },
      }));
      explicitContextRef.current = true;
      setActiveTab("command-center");
      setActiveContext(createPlanningContext("trip", trip.id));
      setFlashNotice("New option created. Adjust it here, then approve it on the Itineraries page.");
    } catch (error) {
      console.error("Failed to copy the trip", error);
      setFlashNotice("Couldn't copy this trip. Try again.");
    } finally {
      setIsMakingOption(false);
    }
  }, [agencyId, isMakingOption, setTripStates, setActiveContext, createPlanningContext]);
```

- render the notice right after `<FirstUseTutorial ... />`:

```jsx
      <FlashNotice message={flashNotice} onDone={clearFlashNotice} />
```

- pass the handler to the Itineraries page (personal accounts have no agency trips, so only when there is an agency):

```jsx
              onDuplicateTrip={agencyId && !isPersonal ? handleMakeOption : null}
              isDuplicatingTrip={isMakingOption}
```

The notice's live region is always mounted, so HomePage now has a second `role="status"`. In `tests/home-page.test.jsx:794-795` (the file doesn't load today because of the icons file, but keep it correct), replace both `screen.getByRole("status")` with `screen.getByText(/No client trips available/).closest('[role="status"]')`.

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run tests/itinerary-header.test.jsx tests/flash-notice.test.jsx tests/client-itinerary-options.test.jsx tests/client-itinerary-approve.test.jsx tests/client-itinerary-weather.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit (client)**

```bash
git add app/components/trip-dashboard tests/itinerary-header.test.jsx tests/flash-notice.test.jsx tests/client-itinerary-options.test.jsx
git commit -m "feat: make another option for a client from the Itineraries page"
```

---

# Part 3 — Pricing (display only)

**The numbers (used in Tasks 11–14).** Exchange rate ₱61 per US$ (mid-2026 rates were ₱60.6–61.8; recheck before the defense).

| Tier | Price / month | Team members | New itineraries / month | Cost floor | Margin |
|---|---|---|---|---|---|
| Starter | ₱2,990 | 2 | 15 | ₱2,190 | 27% |
| Pro | ₱6,990 | 5 | 40 | ₱5,440 | 22% |
| Agency | ₱16,990 | 15 | 100 | ₱13,240 | 22% |

Cost floor = allowance × ₱130 per itinerary + ₱240 share of fixed hosting. The working is in Task 14.

### Task 10: Server — this month's usage for the plan card (Sonnet)

**Files:**
- Create: `Voyage-Server/src/modules/dashboard/planUsageService.ts`
- Modify: `Voyage-Server/src/modules/dashboard/dashboardRoutes.ts`
- Test: `Voyage-Server/tests/planUsage.test.ts`, `Voyage-Server/tests/planUsageRoutes.test.ts` (both new)

- [ ] **Step 1: Write the failing tests**

Create `tests/planUsage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/prisma", () => ({ prisma: {} }));

import { getPlanUsage, manilaMonthRange } from "../src/modules/dashboard/planUsageService";

describe("manilaMonthRange", () => {
  it("covers the Manila calendar month", () => {
    const { start, end } = manilaMonthRange(new Date("2026-10-12T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });

  it("rolls over at Manila midnight, not UTC midnight", () => {
    // 1 November 01:00 in Manila is still 31 October in UTC.
    const { start } = manilaMonthRange(new Date("2026-10-31T17:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
});

describe("getPlanUsage", () => {
  it("counts this month's itineraries and agent requests, and active members", async () => {
    const client: any = {
      itinerary: { count: vi.fn().mockResolvedValue(12) },
      agentRun: { count: vi.fn().mockResolvedValue(85) },
      agencyMembership: { count: vi.fn().mockResolvedValue(3) }
    };

    const usage = await getPlanUsage("agency-1", new Date("2026-10-12T00:00:00.000Z"), client);

    const createdAt = { gte: new Date("2026-09-30T16:00:00.000Z"), lt: new Date("2026-10-31T16:00:00.000Z") };
    expect(client.itinerary.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", createdAt } });
    expect(client.agentRun.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", createdAt } });
    expect(client.agencyMembership.count).toHaveBeenCalledWith({ where: { agencyId: "agency-1", status: "ACTIVE" } });
    expect(usage).toEqual({
      periodStart: "2026-09-30T16:00:00.000Z",
      periodEnd: "2026-10-31T16:00:00.000Z",
      itinerariesCreated: 12,
      agentRequests: 85,
      activeMembers: 3
    });
  });
});
```

Create `tests/planUsageRoutes.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireAgencyOwner: vi.fn(),
  getPlanUsage: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireAgencyOwner: mocks.requireAgencyOwner, requireVerifiedAgencyMember: vi.fn() }
}));
vi.mock("../src/modules/dashboard/dashboardService", () => ({ dashboardService: { getDashboard: vi.fn() } }));
vi.mock("../src/modules/dashboard/calendarService", () => ({ calendarService: { getCalendar: vi.fn() } }));
vi.mock("../src/modules/dashboard/planUsageService", () => ({ getPlanUsage: mocks.getPlanUsage }));

import { ApiError, errorHandler, notFoundHandler } from "../src/http/errors";
import { dashboardRoutes } from "../src/modules/dashboard/dashboardRoutes";

const owner = { id: "user-owner", role: "USER", status: "ACTIVE", accountType: "AGENCY_USER", displayName: "Owner", memberships: [] };
const usage = { periodStart: "2026-09-30T16:00:00.000Z", periodEnd: "2026-10-31T16:00:00.000Z", itinerariesCreated: 12, agentRequests: 85, activeMembers: 3 };

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
  mocks.requireAgencyOwner.mockResolvedValue({ agency: { id: AGENCY_ID }, membership: { role: "OWNER", status: "ACTIVE" } });
  mocks.getPlanUsage.mockResolvedValue(usage);
});

describe("GET /agencies/:agencyId/dashboard/plan-usage", () => {
  it("answers the owner with this month's usage", async () => {
    const res = await request(createApp(owner)).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usage });
    expect(mocks.requireAgencyOwner).toHaveBeenCalledWith(owner, AGENCY_ID);
    expect(mocks.getPlanUsage).toHaveBeenCalledWith(AGENCY_ID);
  });

  it("refuses anyone who isn't the owner", async () => {
    mocks.requireAgencyOwner.mockRejectedValue(new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can perform this action."));

    const res = await request(createApp(owner)).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);

    expect(res.status).toBe(403);
    expect(mocks.getPlanUsage).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    const res = await request(createApp()).get(`/agencies/${AGENCY_ID}/dashboard/plan-usage`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/planUsage.test.ts tests/planUsageRoutes.test.ts`
Expected: FAIL (module not found; route 404).

- [ ] **Step 3: Implement**

Create `src/modules/dashboard/planUsageService.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Manila has no daylight saving, so a fixed +8 hours finds its month boundaries.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Manila calendar month containing `now`, as UTC instants: [start, end). */
export function manilaMonthRange(now: Date) {
  const local = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - MANILA_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - MANILA_OFFSET_MS)
  };
}

export type PlanUsage = {
  periodStart: string;
  periodEnd: string;
  itinerariesCreated: number;
  agentRequests: number;
  activeMembers: number;
};

/**
 * This month's usage for the owner's "Plan and usage" card. Read-only counts: Voyage
 * stores no plan and enforces no limit (the prices are display only).
 */
export async function getPlanUsage(
  agencyId: string,
  now: Date = new Date(),
  client: PrismaClient = prisma
): Promise<PlanUsage> {
  const { start, end } = manilaMonthRange(now);
  const createdAt = { gte: start, lt: end };
  const [itinerariesCreated, agentRequests, activeMembers] = await Promise.all([
    client.itinerary.count({ where: { agencyId, createdAt } }),
    client.agentRun.count({ where: { agencyId, createdAt } }),
    client.agencyMembership.count({ where: { agencyId, status: "ACTIVE" } })
  ]);
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    itinerariesCreated,
    agentRequests,
    activeMembers
  };
}
```

In `dashboardRoutes.ts`, add `import { getPlanUsage } from "./planUsageService";`, add a line to the header comment:

```ts
 * GET /plan-usage — this month's usage for the owner's "Plan and usage" card in Settings.
 *   Owners only. Display only: no plan is stored or enforced.
```

and append the route:

```ts
dashboardRoutes.get("/plan-usage", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId ?? "");
    if (!agencyId) {
      throw new ApiError(400, "AGENCY_ID_REQUIRED", "agencyId is required.");
    }

    const access = await agencyAccessService.requireAgencyOwner(request.authUser!, agencyId);
    response.json({ usage: await getPlanUsage(access.agency.id) });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run the tests and the build**

Run: `npx vitest run tests/planUsage.test.ts tests/planUsageRoutes.test.ts tests/dashboardCalendarRoutes.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit (server)**

```bash
git add src/modules/dashboard tests/planUsage.test.ts tests/planUsageRoutes.test.ts
git commit -m "feat: owner endpoint for this month's plan usage"
```

---

### Task 11: Client — the shared price list (Sonnet)

**Files:**
- Create: `Voyage-Client/app/lib/pricing/plans.js`
- Modify: `Voyage-Client/app/lib/api/agency.js`, `Voyage-Client/app/lib/api/index.js`
- Test: `Voyage-Client/tests/pricing-plans.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/pricing-plans.test.js`:

```js
import { describe, expect, it } from "vitest";
import { FREE_TRIAL_DAYS, PLANS, formatPeso, suggestPlan } from "../app/lib/pricing/plans.js";

describe("price list", () => {
  it("has three tiers, cheapest first, matching the costing doc", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyPrice, plan.teamMembers, plan.itinerariesPerMonth])).toEqual([
      ["starter", 2990, 2, 15],
      ["pro", 6990, 5, 40],
      ["agency", 16990, 15, 100],
    ]);
    expect(PLANS.filter((plan) => plan.featured).map((plan) => plan.id)).toEqual(["pro"]);
    expect(FREE_TRIAL_DAYS).toBe(14);
  });

  it("formats pesos without centavos", () => {
    expect(formatPeso(2990)).toBe("₱2,990");
    expect(formatPeso(16990)).toBe("₱16,990");
  });
});

describe("suggestPlan", () => {
  it("picks the cheapest tier that covers both members and itineraries", () => {
    expect(suggestPlan({ itineraries: 0, members: 1 }).id).toBe("starter");
    expect(suggestPlan({ itineraries: 15, members: 2 }).id).toBe("starter");
    expect(suggestPlan({ itineraries: 16, members: 2 }).id).toBe("pro");
    expect(suggestPlan({ itineraries: 3, members: 6 }).id).toBe("agency");
  });

  it("returns null when usage is above every tier", () => {
    expect(suggestPlan({ itineraries: 101, members: 3 })).toBeNull();
    expect(suggestPlan({ itineraries: 1, members: 16 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/pricing-plans.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `app/lib/pricing/plans.js`:

```js
/**
 * Voyage's price list (capstone panel item 15). Display only: nothing is charged, stored
 * or enforced. The landing page shows these tiers and Settings compares this month's
 * usage against them. The costing behind each price is in
 * Voyage-Server/docs/capstone/pricing-and-costing.md; change both together.
 */
export const FREE_TRIAL_DAYS = 14;

/** Every tier has the whole product; tiers differ only in team size and monthly itineraries. */
export const PLAN_INCLUDES = [
  "the AI planning agent",
  "maps and routes",
  "share links and client comments",
  "PDF and print",
  "weather and accessibility notes",
  "post-trip ratings",
];

export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 2990,
    teamMembers: 2,
    itinerariesPerMonth: 15,
    summary: "For a solo agent or a two-person shop.",
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 6990,
    teamMembers: 5,
    itinerariesPerMonth: 40,
    summary: "For a growing agency team.",
    featured: true,
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPrice: 16990,
    teamMembers: 15,
    itinerariesPerMonth: 100,
    summary: "For established agencies with many planners.",
  },
];

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

export function formatPeso(amount) {
  return PESO.format(amount);
}

/** The cheapest tier whose team size and monthly itineraries cover this usage, or null when none does. */
export function suggestPlan({ itineraries = 0, members = 0 } = {}) {
  return PLANS.find((plan) => plan.teamMembers >= members && plan.itinerariesPerMonth >= itineraries) ?? null;
}
```

Append to `app/lib/api/agency.js`:

```js
// This month's usage for the owner's "Plan and usage" card. Answers { usage }.
export async function fetchPlanUsage(agencyId) {
  return fetchApi(`/agencies/${agencyId}/dashboard/plan-usage`);
}
```

and add `fetchPlanUsage,` to the `// Agency` export block in `app/lib/api/index.js`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/pricing-plans.test.js`
Expected: PASS. (If `formatPeso` prints "PHP 2,990" on this Node, the ICU data is reduced; switch the formatter to `` `₱${amount.toLocaleString("en-US")}` `` and rerun.)

- [ ] **Step 5: Commit (client)**

```bash
git add app/lib/pricing/plans.js app/lib/api/agency.js app/lib/api/index.js tests/pricing-plans.test.js
git commit -m "feat: shared display-only price list"
```

---

### Task 12: Client — landing Pricing section (Sonnet)

**Files:**
- Create: `Voyage-Client/app/components/landing/PricingSection.jsx`
- Modify: `Voyage-Client/app/components/landing/landingContent.js:3-8` (nav)
- Modify: `Voyage-Client/app/components/landing/LandingPage.jsx` (between `<ForAgencies />` and `<Faq />`)
- Test: `Voyage-Client/tests/landing-pricing.test.jsx` (new); update `tests/landing-content.test.js`, `tests/landing-hero.test.jsx`, `tests/landing-page.test.jsx`, `tests/landing-sections.test.jsx`

This reverses the 2026-10-10 "no pricing on the landing page" decision, at the user's request on 2026-10-12. The price numbers stay out of `landingContent.js`; they come from `app/lib/pricing/plans.js`.

- [ ] **Step 1: Write and update the tests**

Create `tests/landing-pricing.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PricingSection from "../app/components/landing/PricingSection.jsx";

describe("PricingSection", () => {
  it("shows three tiers with monthly peso prices, team size and itinerary allowance", () => {
    render(<PricingSection onStartPlanning={vi.fn()} />);

    const section = screen.getByRole("region", { name: "Pricing" });
    const tiers = within(section).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(tiers).toEqual(["Starter", "Pro", "Agency"]);
    expect(within(section).getByText("₱2,990")).toBeInTheDocument();
    expect(within(section).getByText("₱6,990")).toBeInTheDocument();
    expect(within(section).getByText("₱16,990")).toBeInTheDocument();
    expect(within(section).getByText("Up to 5 team members")).toBeInTheDocument();
    expect(within(section).getByText("40 new itineraries a month")).toBeInTheDocument();
    expect(within(section).getByText(/14-day free trial/)).toBeInTheDocument();
  });

  it("starts every free trial through the normal sign-up", () => {
    const onStartPlanning = vi.fn();
    render(<PricingSection onStartPlanning={onStartPlanning} />);

    for (const button of screen.getAllByRole("button", { name: "Start free trial" })) fireEvent.click(button);
    expect(onStartPlanning).toHaveBeenCalledTimes(3);
  });
});
```

In `tests/landing-content.test.js`, replace the `"never mentions pricing"` test with:

```js
  it("keeps prices out of the landing copy (they live in lib/pricing/plans.js)", () => {
    expect(JSON.stringify(content)).not.toMatch(/₱/);
  });
```

and change the nav test's `sectionIds` to `["what-it-does", "how-it-works", "for-agencies", "pricing", "faq"]`.

In `tests/landing-hero.test.jsx`, rename the first test to `"links to every section"`, change the expected hrefs to `["#what-it-does", "#how-it-works", "#for-agencies", "#pricing", "#faq"]`, and delete the line `expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();`.

In `tests/landing-page.test.jsx`, rename the first test to `"has one h1 and every section, in the approved order"`, change the expected ids to `["sample-trip", "after-the-plan", "what-it-does", "how-it-works", "for-agencies", "pricing", "faq"]`, delete the two no-pricing assertions, and add:

```jsx
  it("starts the free trial from the Pricing section through sign-up", () => {
    const { onStartPlanning } = renderPage();
    for (const button of screen.getAllByRole("button", { name: "Start free trial" })) fireEvent.click(button);
    expect(onStartPlanning).toHaveBeenCalledTimes(3);
  });
```

In `tests/landing-sections.test.jsx:65`, delete `expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();` (the footer lists the nav, which now has Pricing).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/landing-pricing.test.jsx tests/landing-content.test.js tests/landing-hero.test.jsx tests/landing-page.test.jsx tests/landing-sections.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/landing/PricingSection.jsx`:

```jsx
"use client";

import { FREE_TRIAL_DAYS, PLAN_INCLUDES, PLANS, formatPeso } from "../../lib/pricing/plans.js";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./landingClasses.js";

const SECTION = "mx-auto w-full max-w-[1220px] scroll-mt-24 px-4 pb-24";

/** Display-only prices. Every button starts the free trial through the normal sign-up. */
export default function PricingSection({ onStartPlanning }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={SECTION}>
      <h2 id="pricing-title" className="m-0 font-sans text-2xl font-semibold text-text-primary md:text-3xl">
        Pricing
      </h2>
      <p className="m-0 mt-2 max-w-2xl text-base leading-relaxed text-text-muted">
        One monthly price per agency, starting with a {FREE_TRIAL_DAYS}-day free trial. Every plan has the whole
        planner; plans differ only in team size and new itineraries a month.
      </p>
      <ul className="m-0 mt-6 grid list-none gap-4 p-0 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li
            key={plan.id}
            className={`flex flex-col rounded-xl border bg-surface p-6 ${plan.featured ? "border-secondary-strong" : "border-border/15"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 font-sans text-lg font-semibold text-text-primary">{plan.name}</h3>
              {plan.featured ? (
                <span className="rounded-pill bg-secondary/10 px-2.5 py-0.5 text-xs font-semibold text-secondary-strong">
                  Most agencies
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-1 text-sm text-text-muted">{plan.summary}</p>
            <p className="m-0 mt-4">
              <span className="text-3xl font-semibold text-text-primary">{formatPeso(plan.monthlyPrice)}</span>
              <span className="text-sm text-text-muted"> / month</span>
            </p>
            <ul className="m-0 mt-4 list-none space-y-1.5 p-0 text-sm text-text-primary">
              <li>Up to {plan.teamMembers} team members</li>
              <li>{plan.itinerariesPerMonth} new itineraries a month</li>
            </ul>
            <button
              type="button"
              onClick={onStartPlanning}
              className={`mt-6 w-full ${plan.featured ? PRIMARY_BUTTON : SECONDARY_BUTTON}`}
            >
              Start free trial
            </button>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-4 text-sm leading-relaxed text-text-muted">
        Every plan includes {PLAN_INCLUDES.join(", ")}. Prices are in Philippine pesos.
      </p>
    </section>
  );
}
```

In `landingContent.js`, add `{ label: "Pricing", href: "#pricing" },` to `LANDING_NAV` between "For agencies" and "FAQ".

In `LandingPage.jsx`, import `PricingSection from "./PricingSection.jsx"` and render `<PricingSection onStartPlanning={onStartPlanning} />` between `<ForAgencies />` and `<Faq />`.

- [ ] **Step 4: Run the landing tests**

Run: `npx vitest run tests/landing-pricing.test.jsx tests/landing-content.test.js tests/landing-hero.test.jsx tests/landing-page.test.jsx tests/landing-sections.test.jsx tests/landing-classes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/landing tests/landing-pricing.test.jsx tests/landing-content.test.js tests/landing-hero.test.jsx tests/landing-page.test.jsx tests/landing-sections.test.jsx
git commit -m "feat: landing Pricing section with a 14-day free trial"
```

---

### Task 13: Client — "Plan and usage" card in Settings (Sonnet)

**Files:**
- Create: `Voyage-Client/app/components/settings/PlanUsageCard.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/SettingsPage.jsx`
- Test: `Voyage-Client/tests/plan-usage-card.test.jsx`, `Voyage-Client/tests/settings-plan-and-requirements.test.jsx` (both new)

- [ ] **Step 1: Write the failing tests**

Create `tests/plan-usage-card.test.jsx`:

```jsx
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchPlanUsage: vi.fn() }));
vi.mock("../app/lib/api/agency.js", () => api);

import PlanUsageCard from "../app/components/settings/PlanUsageCard.jsx";

const usage = (overrides = {}) => ({
  usage: {
    periodStart: "2026-09-30T16:00:00.000Z",
    periodEnd: "2026-10-31T16:00:00.000Z",
    itinerariesCreated: 18,
    agentRequests: 85,
    activeMembers: 3,
    ...overrides,
  },
});

beforeEach(() => {
  api.fetchPlanUsage.mockReset();
});

describe("PlanUsageCard", () => {
  it("says the agency is on the free pilot and shows this month's usage", async () => {
    api.fetchPlanUsage.mockResolvedValue(usage());
    render(<PlanUsageCard agencyId="agency-1" />);

    expect(await screen.findByText("18")).toBeInTheDocument();
    expect(screen.getByText(/free during the pilot/i)).toBeInTheDocument();
    expect(screen.getByText("Itineraries created")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(api.fetchPlanUsage).toHaveBeenCalledWith("agency-1");
  });

  it("names the cheapest plan that covers this month", async () => {
    api.fetchPlanUsage.mockResolvedValue(usage());
    render(<PlanUsageCard agencyId="agency-1" />);

    expect(await screen.findByText("At this month's usage, Pro (₱6,990 a month) covers you.")).toBeInTheDocument();
    const plans = screen.getByRole("list", { name: "Plans" });
    expect(within(plans).getAllByRole("listitem")).toHaveLength(3);
    expect(within(plans).getByText(/Pro/).closest("li")).toHaveAttribute("aria-current", "true");
  });

  it("points heavy usage to a custom plan", async () => {
    api.fetchPlanUsage.mockResolvedValue(usage({ itinerariesCreated: 140 }));
    render(<PlanUsageCard agencyId="agency-1" />);

    expect(await screen.findByText(/above every plan/i)).toBeInTheDocument();
  });

  it("says so when usage can't load", async () => {
    api.fetchPlanUsage.mockRejectedValue(new Error("offline"));
    render(<PlanUsageCard agencyId="agency-1" />);

    expect(await screen.findByText("Couldn't load this month's usage. Try again later.")).toBeInTheDocument();
  });
});
```

Create `tests/settings-plan-and-requirements.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/team/TeamPage.jsx", () => ({ default: () => null }));
vi.mock("../app/components/settings/DangerZoneCard.jsx", () => ({ default: () => null }));
vi.mock("../app/components/settings/PlanUsageCard.jsx", () => ({
  default: ({ agencyId }) => <div data-testid="plan-usage" data-agency={agencyId} />,
}));
vi.mock("../app/lib/api/support.js", () => ({ createProblemReport: vi.fn() }));

import SettingsPage from "../app/components/trip-dashboard/pages/SettingsPage.jsx";

const agency = { id: "agency-1", name: "Sunline Travel", status: "VERIFIED" };

function renderSettings(role, user = { id: "u1", displayName: "Maria", accountType: "AGENCY_USER" }) {
  return render(
    <SettingsPage
      user={user}
      agency={role ? agency : null}
      membership={role ? { role, status: "ACTIVE" } : null}
      logout={vi.fn()}
      onUpdateProfile={vi.fn()}
      onUpdateAgency={vi.fn()}
      onReplayTutorial={vi.fn()}
    />,
  );
}

describe("Settings plan card", () => {
  it("shows Plan and usage to the owner", () => {
    renderSettings("OWNER");
    expect(screen.getByRole("heading", { name: "Plan and usage" })).toBeInTheDocument();
    expect(screen.getByTestId("plan-usage")).toHaveAttribute("data-agency", "agency-1");
  });

  it.each(["ADMIN", "STAFF"])("hides it from %s members", (role) => {
    renderSettings(role);
    expect(screen.queryByRole("heading", { name: "Plan and usage" })).not.toBeInTheDocument();
  });

  it("hides it from personal accounts", () => {
    renderSettings(null, { id: "p1", displayName: "Lee", accountType: "PERSONAL" });
    expect(screen.queryByRole("heading", { name: "Plan and usage" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/plan-usage-card.test.jsx tests/settings-plan-and-requirements.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/settings/PlanUsageCard.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";
import { fetchPlanUsage } from "../../lib/api/agency.js";
import { PLANS, formatPeso, suggestPlan } from "../../lib/pricing/plans.js";

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-text-soft">{label}</p>
      <p className="m-0 mt-1 text-2xl font-semibold text-text-primary">{value}</p>
    </div>
  );
}

/** This month's usage next to the price list. Display only: the agency pays nothing during the pilot. */
export default function PlanUsageCard({ agencyId }) {
  const [state, setState] = useState({ status: "loading", usage: null });

  useEffect(() => {
    let cancelled = false;
    fetchPlanUsage(agencyId)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", usage: result?.usage ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", usage: null });
      });
    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  if (state.status === "loading") {
    return <p role="status" className="m-0 text-sm text-text-soft">Loading this month's usage…</p>;
  }
  if (state.status === "error" || !state.usage) {
    return <p role="status" className="m-0 text-sm text-text-soft">Couldn't load this month's usage. Try again later.</p>;
  }

  const { itinerariesCreated, agentRequests, activeMembers } = state.usage;
  const fit = suggestPlan({ itineraries: itinerariesCreated, members: activeMembers });

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm leading-6 text-text-soft">
        Your agency is on the Voyage pilot, free during the pilot. Here is this month's use and the plan that would cover it.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Itineraries created" value={itinerariesCreated} />
        <Stat label="Agent requests" value={agentRequests} />
        <Stat label="Team members" value={activeMembers} />
      </div>
      <p className="m-0 text-sm font-semibold text-text-primary">
        {fit
          ? `At this month's usage, ${fit.name} (${formatPeso(fit.monthlyPrice)} a month) covers you.`
          : "This month's usage is above every plan. Contact us for a custom plan."}
      </p>
      <ul aria-label="Plans" className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isFit = fit?.id === plan.id;
          return (
            <li
              key={plan.id}
              aria-current={isFit ? "true" : undefined}
              className={`rounded-2xl border px-3.5 py-3 text-sm ${isFit ? "border-secondary bg-secondary/8" : "border-border bg-background"}`}
            >
              <p className="m-0 font-semibold text-text-primary">
                {plan.name} · {formatPeso(plan.monthlyPrice)} a month
              </p>
              <p className="m-0 mt-1 text-text-soft">
                Up to {plan.teamMembers} team members, {plan.itinerariesPerMonth} new itineraries a month
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

In `SettingsPage.jsx`, import `PlanUsageCard from "../../settings/PlanUsageCard.jsx"` and add, right before the Team `section` (`{!isPersonal && agency?.id ? (<section ref={teamRef} ...`):

```jsx
        {!isPersonal && membership?.role === "OWNER" && agency?.id ? (
          <Panel
            eyebrow="Plan"
            title="Plan and usage"
            description="What Voyage would cost your agency, based on this month's real use."
            className="xl:col-span-2"
          >
            <PlanUsageCard agencyId={agency.id} />
          </Panel>
        ) : null}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/plan-usage-card.test.jsx tests/settings-plan-and-requirements.test.jsx tests/settings-team.test.jsx tests/settings-status-colors.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/settings/PlanUsageCard.jsx app/components/trip-dashboard/pages/SettingsPage.jsx tests/plan-usage-card.test.jsx tests/settings-plan-and-requirements.test.jsx
git commit -m "feat: owner Plan and usage card in Settings"
```

---

### Task 14: Manuscript — pricing and costing (Sonnet)

**Files:**
- Create: `Voyage-Server/docs/capstone/pricing-and-costing.md`

- [ ] **Step 1: Write the document**

Create `docs/capstone/pricing-and-costing.md` with exactly this content:

````markdown
# Voyage Pricing and Costing

Answer to capstone panel item 15: what an agency pays to use Voyage, and why.

Voyage is sold per agency, per month. Every plan has the whole product; plans differ only in team size and how many new itineraries the agency makes a month. New agencies get a 14-day free trial. During the pilot, agencies use Voyage free; the app shows the prices (landing page) and each owner's monthly usage against them (Settings › Plan and usage), but takes no payment.

Prices were set from both sides:

- **Floor (cost-plus):** what one agency costs to serve, so no plan loses money.
- **Ceiling (market):** what agencies pay for comparable tools, so Voyage stays cheaper.

All figures use **₱61 = US$1** (mid-2026 rates were ₱60.6–61.8).

## 1. Variable cost per itinerary

Assumptions: a 3-day itinerary with 15 stops, built in one agent run, then changed in 3 follow-up requests. The token count comes from a measured full planning run (about 344,000 tokens).

| Item | Assumption | US$ |
|---|---|---|
| Gemini 3 Flash, first plan | ~330k input tokens at $0.50/M + ~15k output tokens at $3.00/M | 0.21 |
| Gemini 3 Flash, 3 follow-up edits | 3 × (60k input + 4k output) | 0.13 |
| Google Places Text Search (Enterprise) | 2 searches per stop × 15 stops × $35/1,000 | 1.05 |
| Google Place Details (Enterprise) | 1 per stop × 15 × $20/1,000 | 0.30 |
| Google Place Photos | 1 per stop × 15 × $7/1,000; then served from Cloudinary | 0.11 |
| Google Compute Routes (Essentials) | 12 legs × $5/1,000 | 0.06 |
| Web search (Serper) | ~5 queries × $1/1,000 | 0.01 |
| Email (Resend) | ~6 emails × $0.90/1,000 | 0.01 |
| **Total** | | **1.88 (₱115)** |

With a 10% allowance for retries and re-plans: **₱130 per itinerary**.

Google Maps, not the AI model, is the largest cost. Google's free monthly allowances (1,000 Enterprise calls per SKU, 10,000 Essentials route calls) and reused place snapshots lower the real cost at pilot scale; they are left out to keep the floor conservative. A copied option ("Another option") reuses its original's places and costs almost nothing.

## 2. Fixed monthly cost

| Service | Plan | US$ / month |
|---|---|---|
| Railway (API server + PostgreSQL) | Pro, $20 plus ~$10 usage | 30 |
| Vercel (web client) | Pro, 1 seat | 20 |
| Resend (email) | Pro, 50,000 emails | 20 |
| Cloudinary (images) | Free plan | 0 |
| Domain | ~$12 a year | 1 |
| Serper (web search) | $50 credit pack lasting ~6 months | 8 |
| **Total** | | **79 (₱4,800)** |

Shared across a target of 20 paying agencies: **₱240 per agency per month**.

## 3. Cost floor per plan

Floor = monthly itinerary allowance × ₱130 + ₱240.

| Plan | Team members | Itineraries / month | Floor | Price | Margin |
|---|---|---|---|---|---|
| Starter | 2 | 15 | ₱2,190 | ₱2,990 | 27% |
| Pro | 5 | 40 | ₱5,440 | ₱6,990 | 22% |
| Agency | 15 | 100 | ₱13,240 | ₱16,990 | 22% |

Margin = (price − floor) ÷ price. Even if an agency uses its whole allowance, every plan stays above cost.

## 4. Market ceiling

| Tool | Pricing | 2 people | 5 people | 15 people |
|---|---|---|---|---|
| Travefy (Core, annual) | $39 first seat + $20 each extra | ₱3,599 | ₱7,259 | ₱19,459 |
| Tern | $49 per seat per month | ₱5,978 | ₱14,945 | ₱44,835 |
| **Voyage** | per agency | **₱2,990** | **₱6,990** | **₱16,990** |

Voyage is cheaper than both at every team size, and includes the AI agent and maps, which Tern sells as an add-on ($19+ a month per advisor).

## 5. Free trial

A 14-day trial with no allowance limit. A trial agency that builds 10 itineraries costs about ₱1,300, the acquisition cost of one paying Starter agency's first half-month.

## 6. Limits of this costing

- Prices are display only. Voyage has no payment processing, no stored plan and no usage cap; adding them (for example PayMongo checkout) is future work.
- Third-party prices change; recheck Google Maps Platform, Gemini API, Railway, Vercel, Resend and Serper pricing pages and the exchange rate before quoting these numbers.
- The app records AI cost per run, but Gemini runs currently record $0 (the model's price is missing from the cost table), so the AI figures above come from token counts × list price.

## Sources

- Gemini 3 Flash pricing (aggregator citing Google): https://anotherwrapper.com/llm-pricing/gemini-3-flash-preview
- Google Places API pricing: https://openplacesapi.com/blog/google-places-api-pricing and https://www.woosmap.com/blog/google-places-api-pricing
- Google Routes API pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Railway plans: https://docs.railway.com/pricing/plans
- Vercel Pro: https://makerkit.dev/blog/tutorials/vercel-cost
- Resend pricing: https://www.resend.com/pricing.md
- Serper pricing: https://apiserpent.com/blog/serper-pricing-credits-explained
- Travefy pricing: https://travefy.com/pricing
- Tern pricing: https://tern.travel/pricing and https://help.tern.travel/en/articles/15292346-tern-pro
- USD/PHP rate: https://www.ofx.com/en-au/exchange-rates/usd-to-php/
````

- [ ] **Step 2: Check the numbers match the code**

Run (from `Voyage-Client`): `npx vitest run tests/pricing-plans.test.js`
Expected: PASS, and the three prices, team sizes and allowances in the test equal the tables above.

- [ ] **Step 3: Commit (server)**

```bash
git add docs/capstone/pricing-and-costing.md
git commit -m "docs: pricing and costing for the capstone manuscript"
```

---

# Part 4 — System requirements

### Task 15: Client — requirements data and browser check (Sonnet)

**Files:**
- Create: `Voyage-Client/app/lib/systemRequirements.js`
- Test: `Voyage-Client/tests/system-requirements.test.js` (new)

The real floor comes from the client's own stack: Next.js 16 targets Chrome/Edge 111 and Safari 16.4, and Tailwind v4 needs `@property` (Firefox 128, Safari 16.4) and `color-mix()` (Chrome 111). The check tests those two features directly instead of reading the browser's name.

- [ ] **Step 1: Write the failing test**

Create `tests/system-requirements.test.js`:

```js
import { describe, expect, it } from "vitest";
import { CLIENT_REQUIREMENTS, isBrowserSupported } from "../app/lib/systemRequirements.js";

const modernCss = { supports: (property, value) => property === "color" && value.startsWith("color-mix("), registerProperty: () => {} };

describe("isBrowserSupported", () => {
  it("accepts a browser with @property and color-mix()", () => {
    expect(isBrowserSupported({ CSS: modernCss })).toBe(true);
  });

  it("rejects a browser without @property (Firefox before 128, Safari before 16.4)", () => {
    expect(isBrowserSupported({ CSS: { supports: modernCss.supports } })).toBe(false);
  });

  it("rejects a browser without color-mix() (Chrome before 111)", () => {
    expect(isBrowserSupported({ CSS: { supports: () => false, registerProperty: () => {} } })).toBe(false);
  });

  it("rejects a browser with no CSS object at all", () => {
    expect(isBrowserSupported({})).toBe(false);
    expect(isBrowserSupported(undefined)).toBe(false);
  });
});

describe("CLIENT_REQUIREMENTS", () => {
  it("lists browser, device, memory, internet and browser settings, each with a minimum and a recommendation", () => {
    expect(CLIENT_REQUIREMENTS.map((row) => row.label)).toEqual(["Browser", "Device", "Memory", "Internet", "Browser settings"]);
    for (const row of CLIENT_REQUIREMENTS) {
      expect(row.minimum).toBeTruthy();
      expect(row.recommended).toBeTruthy();
    }
    expect(CLIENT_REQUIREMENTS[0].minimum).toBe("Chrome or Edge 111, Safari 16.4, Firefox 128");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/system-requirements.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `app/lib/systemRequirements.js`:

```js
/**
 * Minimum system requirements (capstone panel item 14). One source for the Settings panel,
 * the unsupported-browser banner and the manuscript table in
 * Voyage-Server/docs/capstone/system-requirements.md; change them together.
 */
export const MINIMUM_BROWSERS = "Chrome or Edge 111, Safari 16.4, Firefox 128";

export const CLIENT_REQUIREMENTS = [
  { label: "Browser", minimum: MINIMUM_BROWSERS, recommended: "The latest version of any of them" },
  {
    label: "Device",
    minimum: "A phone at least 360 px wide, or any laptop or desktop",
    recommended: "A laptop or desktop for planning",
  },
  { label: "Memory", minimum: "4 GB", recommended: "8 GB" },
  { label: "Internet", minimum: "5 Mbps", recommended: "10 Mbps or faster, for maps, photos and live agent replies" },
  { label: "Browser settings", minimum: "JavaScript and cookies on", recommended: "JavaScript and cookies on" },
];

/**
 * True when the browser has the two newest CSS features Voyage's styles rely on:
 * `@property` (CSS.registerProperty: Firefox 128, Safari 16.4) and `color-mix()`
 * (Chrome and Edge 111). Feature checks, not the browser's name, which can lie.
 */
export function isBrowserSupported(env = typeof window === "undefined" ? undefined : window) {
  const css = env?.CSS;
  if (!css || typeof css.supports !== "function") return false;
  return typeof css.registerProperty === "function" && css.supports("color", "color-mix(in srgb, red, blue)");
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/system-requirements.test.js`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add app/lib/systemRequirements.js tests/system-requirements.test.js
git commit -m "feat: shared system requirements and browser check"
```

---

### Task 16: Client — unsupported-browser banner (Sonnet)

**Files:**
- Create: `Voyage-Client/app/components/system/UnsupportedBrowserBanner.jsx`
- Modify: `Voyage-Client/app/layout.jsx` (inside `<ThemeProvider>`, before `{children}`)
- Test: `Voyage-Client/tests/unsupported-browser-banner.test.jsx` (new)

Mounted once in the root layout, so it shows on the landing page, login, dashboard and client share links. A browser old enough to fail to run the app's JavaScript at all won't show it; that is acceptable, since the requirements are also in Settings and the manuscript.

- [ ] **Step 1: Write the failing test**

Create `tests/unsupported-browser-banner.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import UnsupportedBrowserBanner from "../app/components/system/UnsupportedBrowserBanner.jsx";

beforeEach(() => {
  sessionStorage.clear();
});

describe("UnsupportedBrowserBanner", () => {
  it("warns an older browser and names the minimum versions", () => {
    render(<UnsupportedBrowserBanner check={() => false} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Your browser is older than Voyage supports, so some screens may not work.");
    expect(banner).toHaveTextContent("Chrome or Edge 111, Safari 16.4, Firefox 128");
  });

  it("stays hidden in a supported browser", () => {
    render(<UnsupportedBrowserBanner check={() => true} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides for the rest of the session once dismissed", () => {
    const { unmount } = render(<UnsupportedBrowserBanner check={() => false} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss browser warning" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    unmount();
    render(<UnsupportedBrowserBanner check={() => false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unsupported-browser-banner.test.jsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `app/components/system/UnsupportedBrowserBanner.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";
import { MINIMUM_BROWSERS, isBrowserSupported } from "../../lib/systemRequirements.js";

const DISMISSED_KEY = "voyage-old-browser-dismissed";

function wasDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Warns, once per session, when the browser lacks the CSS features Voyage needs. */
export default function UnsupportedBrowserBanner({ check = isBrowserSupported }) {
  const [show, setShow] = useState(false);

  // After mount, so the server render and the first client render match.
  useEffect(() => {
    setShow(!check() && !wasDismissed());
  }, [check]);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage blocked: it hides for this page view only.
    }
    setShow(false);
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[200] flex items-start justify-center gap-3 border-b border-status-warning bg-surface px-4 py-3 text-sm text-text-primary shadow-strong"
    >
      <p className="m-0 max-w-3xl">
        Your browser is older than Voyage supports, so some screens may not work. Voyage needs {MINIMUM_BROWSERS} or newer.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss browser warning"
        className="min-h-11 shrink-0 rounded-pill border border-border px-4 font-semibold text-text-primary hover:border-secondary"
      >
        Dismiss
      </button>
    </div>
  );
}
```

In `app/layout.jsx`, import `UnsupportedBrowserBanner from "./components/system/UnsupportedBrowserBanner.jsx"` and render it first inside `<ThemeProvider>`:

```jsx
        <ThemeProvider>
          <UnsupportedBrowserBanner />
          {children}
        </ThemeProvider>
```

- [ ] **Step 4: Run the test and the build**

Run: `npx vitest run tests/unsupported-browser-banner.test.jsx`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/system/UnsupportedBrowserBanner.jsx app/layout.jsx tests/unsupported-browser-banner.test.jsx
git commit -m "feat: warn browsers older than Voyage supports"
```

---

### Task 17: Client — System requirements panel in Settings (Haiku)

**Files:**
- Create: `Voyage-Client/app/components/settings/SystemRequirementsTable.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/SettingsPage.jsx` (after the "Need help?" Panel)
- Test: `Voyage-Client/tests/settings-plan-and-requirements.test.jsx` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/settings-plan-and-requirements.test.jsx`:

```jsx
describe("Settings system requirements", () => {
  it.each([
    ["an agency member", "STAFF", { id: "u1", displayName: "Maria", accountType: "AGENCY_USER" }],
    ["a personal account", null, { id: "p1", displayName: "Lee", accountType: "PERSONAL" }],
  ])("lists the minimum and recommended setup for %s", (_who, role, user) => {
    renderSettings(role, user);

    expect(screen.getByRole("heading", { name: "System requirements" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "System requirements" });
    expect(table).toHaveTextContent("Chrome or Edge 111, Safari 16.4, Firefox 128");
    expect(screen.getAllByRole("row")).toHaveLength(6); // header + 5 rows
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/settings-plan-and-requirements.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/components/settings/SystemRequirementsTable.jsx`:

```jsx
import { CLIENT_REQUIREMENTS } from "../../lib/systemRequirements.js";

/** The minimum and recommended setup for using Voyage, from the shared requirements list. */
export default function SystemRequirementsTable() {
  return (
    <div className="overflow-x-auto">
      <table aria-label="System requirements" className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-[0.08em] text-text-soft">
            <th scope="col" className="py-2 pr-3 font-semibold"><span className="sr-only">Requirement</span></th>
            <th scope="col" className="py-2 pr-3 font-semibold">Minimum</th>
            <th scope="col" className="py-2 font-semibold">Recommended</th>
          </tr>
        </thead>
        <tbody>
          {CLIENT_REQUIREMENTS.map((row) => (
            <tr key={row.label} className="border-b border-border/60 align-top last:border-0">
              <th scope="row" className="py-2.5 pr-3 font-semibold text-text-primary">{row.label}</th>
              <td className="py-2.5 pr-3 text-text-primary">{row.minimum}</td>
              <td className="py-2.5 text-text-soft">{row.recommended}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

In `SettingsPage.jsx`, import `SystemRequirementsTable from "../../settings/SystemRequirementsTable.jsx"` and add right after the "Need help?" `</Panel>`:

```jsx
        <Panel
          eyebrow="Help"
          title="System requirements"
          description="What you need to use Voyage on a phone or computer."
        >
          <SystemRequirementsTable />
        </Panel>
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/settings-plan-and-requirements.test.jsx tests/settings-team.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit (client)**

```bash
git add app/components/settings/SystemRequirementsTable.jsx app/components/trip-dashboard/pages/SettingsPage.jsx tests/settings-plan-and-requirements.test.jsx
git commit -m "feat: system requirements panel in Settings"
```

---

### Task 18: Manuscript — minimum system requirements (Sonnet)

**Files:**
- Create: `Voyage-Server/docs/capstone/system-requirements.md`

- [ ] **Step 1: Write the document**

Create `docs/capstone/system-requirements.md` with exactly this content:

````markdown
# Voyage Minimum System Requirements

Answer to capstone panel item 14. The client table matches what the app shows in Settings › System requirements (`Voyage-Client/app/lib/systemRequirements.js`).

## Client (people using Voyage)

| | Minimum | Recommended |
|---|---|---|
| Browser | Chrome or Edge 111, Safari 16.4, Firefox 128 | The latest version of any of them |
| Device | A phone at least 360 px wide, or any laptop or desktop | A laptop or desktop for planning |
| Memory | 4 GB | 8 GB |
| Internet | 5 Mbps | 10 Mbps or faster, for maps, photos and live agent replies |
| Browser settings | JavaScript and cookies on | JavaScript and cookies on |

Why these browser versions: the web client is built with Next.js 16, which targets Chrome/Edge 111 and Safari 16.4, and styled with Tailwind CSS v4, which needs CSS `@property` (Firefox 128, Safari 16.4) and `color-mix()` (Chrome 111). Older browsers see a warning banner on every page. Voyage also installs as an app (PWA) on phones and computers that support it.

Travelers who only open a shared itinerary link need the same browser, and no account.

## Server (running Voyage)

| | Minimum | Used in production |
|---|---|---|
| Runtime | Node.js 22.12 | Node.js 22 on Railway |
| Database | PostgreSQL 15 | Railway PostgreSQL |
| Memory | 512 MB for the API server | 1 GB |
| Web client hosting | Any Next.js 16 host | Vercel |

## External services

| Service | Used for | Required |
|---|---|---|
| Google Gemini (Vertex AI) | The planning agent | Yes |
| Google Maps Platform (Places, Routes, Maps JavaScript) | Places, photos, routes and maps | Yes; OpenStreetMap is the fallback for some lookups |
| Resend | Account, approval and trip emails | Yes |
| Cloudinary | Agency logos and cached place photos | Yes |
| Serper | Web search for the agent | Optional |
````

- [ ] **Step 2: Check it matches the code**

Run (from `Voyage-Client`): `npx vitest run tests/system-requirements.test.js`
Expected: PASS, and the client table above has the same five rows and values as `CLIENT_REQUIREMENTS`.

Check the server rows: `grep -n "\"node\"" Voyage-Server/package.json` shows `>=22.12.0`; `grep -n "image:" Voyage-Server/docker-compose.yml` shows `postgres:15-alpine`.

- [ ] **Step 3: Commit (server)**

```bash
git add docs/capstone/system-requirements.md
git commit -m "docs: minimum system requirements for the capstone manuscript"
```

---

# Wrap-up

### Task 19: Full verification and hands-on QA (Sonnet; final review on Opus)

- [ ] **Step 1: Full suites**

Run (server): `npm test`
Expected: only the 11 known stale failures.

Run (client): `npm test`
Expected: only the 1 stale failure and the 6 icons-JSX load failures.

- [ ] **Step 2: Builds**

Run: `npm run build` in both repos.
Expected: both exit 0.

- [ ] **Step 3: Leftover-name check**

Run (client): `grep -rn "Command Center" app tests`
Expected: no matches.

- [ ] **Step 4: Hands-on QA (the user, with the Docker DB running and the backend restarted)**

1. **Tour, owner:** sign in with an owner account that has never seen the tour. The welcome card is centred with chips Dashboard · Planner · Itineraries · Settings. Start tour goes through Needs you, Calendar, Insights, then Planner, Itineraries, Settings. Back to the welcome card leaves no spotlight. Finish, reload: no tour.
2. **Tour, staff and personal:** a staff account sees My work instead of Insights. A personal account starts on the Planner with no Dashboard steps and "My account" in the last step.
3. **Tour, super admin:** sees the Admin step, which switches to the Admin tab.
4. **Tour, shared browser:** sign out, sign in with a new account on the same browser: the tour opens.
5. **Tour, phone width (375 px):** every step's card stays on screen and its target is visible.
6. **Another option:** on the Itineraries page pick a client's trip, click Another option. The Planner opens on the copy with the notice; the itinerary shows the same days and stops. Ask the agent "make day 1 lighter": it edits the copy, not the original and not a new itinerary. Back on Itineraries, the client has "Option 1 · {place}" and "Option 2 · {place}" tabs; the copy is In review with Approve.
7. **Pricing:** the landing page has Pricing in the nav and a Pricing section between For agencies and FAQ; each Start free trial goes to sign-up. Owner Settings shows Plan and usage with real counts and a suggested plan; a staff account doesn't see it.
8. **Requirements:** Settings shows System requirements for every account. Simulate an old browser in DevTools console with `CSS.registerProperty = undefined` then reload: the banner shows; Dismiss hides it until the tab closes.

- [ ] **Step 5: Record the results**

Append a "Results (date)" section to this plan with the suite counts, build status and QA outcome, and commit it on the server.

---

## Results (2026-10-13)

Executed subagent-driven on `feat/capstone-panel-fixes` in both repos (Haiku for Tasks 1, 3, 17; Sonnet for the rest; every task reviewed on Opus, spec then quality, plus a final whole-branch review). All 19 tasks done.

**Final verification (both repos at their last commit):**
- Server `npm test`: 1426 passed, 11 failed. The 11 are exactly the known stale ones (agentLogger 1, agentOrchestrator 4, modelProvider 2, webSearchProvider 4). `npm run build`: exit 0.
- Client `npm test`: 1748 passed, 1 failed (stale agent-command-center-places), plus the 6 files that fail to load because `app/components/icons/index.js` has JSX in a `.js` file. `npm run build`: exit 0.
- `grep -rni "command center" app tests` (client): only the guard test in `tests/tutorial-steps.test.js` that asserts the name is gone.

**Changes beyond the written tasks (from reviews, or decided by the user during execution):**
- Tour: copy matched to the real Dashboard ("Your work", Needs you categories); welcome card centred with CSS so it survives resize and rotation; focus starts on "Start tour"; the spotlight follows targets that change size; a replayed tour starts on the welcome card and closes the mobile sidebar.
- Another option:
  - The copy refuses unsaved or archived trips (409 `TRIP_NOT_SAVED`) and keeps the traveler needs from the chat that has them.
  - Option tabs sit side by side, oldest first.
  - The Planner picker shows the same "Option N · place" labels.
  - There is a phone control.
  - Dashboards refresh after copy, approve, reopen and delete.
- User decisions (2026-10-13):
  - A copied itinerary is titled "{title} (option N)"; numbers never repeat.
  - Each unapproved option of a client with 2+ trips has "Remove option" (confirm dialog).
  - Deleting a trip also deletes its Planner chats (Remove option and Delete client). Delete client's confirm now says what it deletes.
  - The agent's "discard draft" path detaches the chat instead of failing.
- Pricing:
  - Owner card is below Team, says which month it covers, labels the fitting plan "Fits this month", and uses "Messages to the agent".
  - Landing footnote: "Voyage is free during the pilot; billing isn't switched on yet."
- Requirements: the banner is a labelled region and isn't printed. The Settings table fits phones. Settings panel headings use the sans type and readable greys.
- Manuscript docs were checked against official price pages and the code; they now compare at full team sizes, use Tern's annual price, give the 5-agency break-even, and show prices hold at October's ₱62.5 rate.

**Spun off (not done here):** staff per-trip access on agent routes plus `assignedOrganizerUserId` never being written; the star rating focus ring (`ring-[--rating-star]` compiles to invalid CSS); `tests/home-page.test.jsx` still tests the old tour and will need updating once the icons file loads in tests.

**Hands-on QA (for the user; Docker DB running, backend restarted):** steps 1–7 above, plus:
- 6b. After "Another option", the new itinerary's title ends in "(option 2)" on the Itineraries header, the dashboard calendar and the PDF.
- 6c. "Remove option" on the copy: confirm, the tab disappears, focus lands on the client name, and after a reload no "(another option)" draft chat appears in the Planner.
- 8 (replaces the console step). In Firefox, set `about:config` → `layout.css.properties-and-values.enabled` to `false`, clear session storage, reload: the banner shows; Dismiss hides it until the tab closes. Alternatively, test in Firefox 115 ESR or Chrome 109. Safari/iOS older than 16.4 can't run the app at all, so it shows no banner.
- One manual copy on the dev database confirms traveler needs carry over (the needs filter is only covered by mocked tests).
- Demo prep: the tour reopens once for every account (new per-account key), so click through it once on the demo browser. Check the Itineraries header line on the projector laptop (it wraps around 1330–1440 px). Approval is desktop-only.

QA outcome: pending the user's hands-on run.
