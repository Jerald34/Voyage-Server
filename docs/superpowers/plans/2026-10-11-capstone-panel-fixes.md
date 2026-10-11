# Capstone Panel Fixes (items 24, 20, 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three "partly done" rows of the capstone panel form. The agent's live status says what it is doing instead of "Thinking…" (item 24). Agency registration is confirmed by email at every step and the pending screen updates itself (item 20). The itinerary PDF gets a branded timeline layout (item 7).

**Architecture:** Three independent parts. Each part ships on its own and can be merged in any order.
- Part 1 rewrites the client's label helpers and mirrors the summary wording on the server.
- Part 2 adds four branded emails plus a small `agencyNotifications` module that the agency service calls after each decision is saved. On the client, a polling hook refreshes the status screen and the "Report a problem" modal replaces a dead `mailto:`.
- Part 3 adds an image loader for the PDF and rewrites `pdfExport.js` into the layout the user picked (mockup A).

**Tech Stack:** Next.js 16 / React client (Vitest + Testing Library, jsdom), Express + Prisma + TypeScript server (Vitest), jsPDF 4, nodemailer/Resend email.

---

## Decisions (approved in chat 2026-10-11)

No separate spec. These are the approved decisions.

### Item 24: "Thinking?" (better term). Option A: say what stage the agent is at.

- **Live label priority:**
  1. A RUNNING agent task's own label (unchanged).
  2. "Writing the reply…" while reply text is streaming.
  3. If the latest entry is a tool: that tool's plain label.
  4. If the latest entry is a thought: "Choosing the next step…".
  5. If nothing has happened yet: "Reading your request…".
- **"Writing the reply…" detection:** `useAgentRunStream` clears `assistantMessage` on every `tool.started`. So a non-empty `assistantMessage` always means text arrived after the last tool started.
- **Every tool gets two labels:** a present-tense live label and a past-tense row label (table in Task 1).
  - Unknown tools say "Working on it…" / "Finished a step". A raw tool name is never shown.
  - The progress-tracking tools (`add_agent_task`, `update_agent_task`, `list_agent_tasks`, `record_agent_task`) never set the label, never get a row, and are not counted in summaries. The task rows already show their effect.
- **Summary wording, kept identical on client and server:**
  - "Thought for Xs" becomes "Replied in Xs".
  - "Worked for Xs" becomes "Finished in Xs".
  - "Added N items" becomes "Added N stop(s)", singular for 1.
  - "Asked for your input", "Researched N places" and "Built itinerary" stay.
- **Saved history:** old saved runs keep their stored text. The client rewrites the three old phrases when it shows a finished bubble, so existing demo threads read the new way.
- **Top-bar run pill:** "Agent streaming" becomes "Working".

### Item 20: Confirmation or registration approval. Option B: full confirmation loop.

- **Owner emails:**
  - "We received your application" when the agency registers.
  - "Your agency is approved", with an "Open your workspace" button.
  - "Your application wasn't approved", with the admin's reason.
- **Admin email:** every active SUPER_ADMIN gets "New agency waiting for review", with a "Review agency" button linking to the admin tab.
- **Sending rules:** emails go out after the database change is saved. A failed lookup or send is logged and never fails or undoes the registration, approval or rejection.
- **Pending screen:** it re-reads `/auth/me` every 30 seconds and when the tab regains focus. Once the agency is VERIFIED, the app opens.
- **Contact support:** "Contact Support" and "Resubmit Application" (which only opened `mailto:support@voyageagency.com`) become one "Contact support" button. It opens the existing Report a problem modal, prefilled with category Other and subject "Agency application: {name}". For a suspended agency the subject is "Suspended agency: {name}".
- **Out of scope:** suspend and reinstate emails, and a real resubmit flow.

### Item 7: Report layout must be updated. Option A: branded timeline.

- **Brand row:**
  - Voyage-branded PDFs use the Voyage wordmark (`/email/voyage-logo.png`, the emails' file).
  - An agency prints its name in terracotta caps, with its logo before the name when the caller passes `logoUrl`. Only the public share page can do that today: the signed-in session doesn't carry the agency logo, so in-app PDFs print the agency name only.
  - If the wordmark can't load, "VOYAGE" prints as text.
- **Meta line:** date range • travelers • "Prepared for {client}".
- **"At a glance" table:** for trips of 2+ days, with columns Day / Date / Plan / Stops / Weather. The Weather column appears only when some day has weather, and uses the short `compactText`.
- **Day sections:**
  - Each day opens with a navy bar: "Day N  ·  Thu, Oct 8, 2026  —  {day title}".
  - Its weather line sits directly under the bar.
- **Stops:**
  - Time column on the left.
  - Title, then the stop's weather on its own line (it used to be appended to the time).
  - Description, place name (skipped when it equals the title), address, closure and accessibility.
  - A 26×19.5 mm photo on the right when one loads.
- **Footer on every page:** "{Agency}  ·  Planned with Voyage" (or "Planned with Voyage") on the left, "Page N of M" on the right.
- **Unchanged:**
  - Staff notes, agency overlays and the traveler's own needs never print.
  - Closure and accessibility lines are measured before the page-break check.
  - The Open-Meteo credit prints once.
- **Photos:**
  - They come from the stored snapshot photo (`getSnapshotPhotoUrl`).
  - Cloudinary URLs are rewritten to a 320×240 JPEG.
  - Each image is fetched with CORS, then cropped or fitted on a canvas.
  - Any failure (CORS, 404, 6 s timeout, no canvas) prints that stop without a photo.
- **Date parsing:** dates are read as calendar days in local time ("2026-10-08" is Oct 8 everywhere), which fixes a west-of-UTC off-by-one.

---

## Before you start

- **Branches:** never create or switch a branch without the user's explicit yes (memory `feedback_no_unasked_branches`). On 2026-10-11 the server is on `staging` and the client is on `feat/landing-page-redesign` (14 unpushed commits). Ask the user which branch each part should go on before Task 1.
- **Baselines:**
  - Server: `npm test` has 11 known stale failures (memory `project_voyage_known_test_failures`); `npm run build` is green.
  - Client: `npm test` has 8 known failing files; `npm run build` is green.
  - "Suite = baseline" means no new failures beyond those.
- **OneDrive:** the backend's `tsx watch` misses edits. Restart the server before any manual check (memory `project_voyage_onedrive_tsx_watch`).
- **Commits:** never add a `Co-Authored-By` line.
- **Commands:**
  - Server commands run from `Voyage-Server/`; client commands run from `Voyage-Client/`.
  - Single test files run with `npx vitest run <file>`.
  - The client suite uses `--pool=threads`, already in `npm test`.

## File map

**Part 1: status wording**
- Modify `Voyage-Client/app/components/agent/process-bubble/processBubbleLabels.js`: the label tables, phase-aware `activeLabelFor`, `toolToDoneLabel`, `isTrackingTool` and `modernizeSummaryLabel`.
- Modify `Voyage-Client/app/components/agent/process-bubble/ProcessBubble.jsx`: past-tense rows, tracking tools hidden, old summaries rewritten.
- Modify `Voyage-Client/app/components/trip-dashboard/command-center/AgentCommandCenter.jsx`: passes `writingReply`.
- Modify `Voyage-Client/app/lib/formatters.js`: "Working" pill.
- Modify `Voyage-Server/src/modules/agent/agentService.ts`: server summary wording.
- Tests:
  - `Voyage-Client/tests/process-bubble-labels.test.js` (rewrite)
  - `process-bubble-task-row.test.jsx`, `process-bubble.test.jsx` (update)
  - `agent-live-label.test.jsx`, `run-status-label.test.js` (new)
  - `Voyage-Server/tests/agentService.test.ts` (add)

**Part 2: registration confirmation**
- Modify `Voyage-Server/src/services/email.ts`: four new emails.
- Modify `Voyage-Server/src/modules/agencies/agencyTypes.ts` and `agencyRepository.ts`: `listActiveSuperAdmins`.
- Create `Voyage-Server/src/modules/agencies/agencyNotifications.ts`: who gets which email, with failures contained.
- Modify `Voyage-Server/src/modules/agencies/agencyService.ts`: calls the notifier and wires the singleton.
- Modify `Voyage-Client/app/lib/deepLinks.js`: `tab=admin` and `resolveVisibleTab`.
- Modify `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`: uses `resolveVisibleTab`.
- Modify `Voyage-Client/app/components/settings/ReportProblemModal.jsx`: `initialCategory` and `initialSubject`.
- Create `Voyage-Client/app/hooks/useAgencyStatusPolling.js`.
- Modify `Voyage-Client/app/components/agency-status/AgencyStatusScreen.jsx`: copy, support modal, no `mailto:`.
- Modify `Voyage-Client/app/page.jsx`: polls while the agency isn't verified.
- Tests:
  - Server: `agencyApplicationEmails.test.ts`, `agencyRepository.test.ts`, `agencyNotifications.test.ts` (new); `agencyService.test.ts` (add).
  - Client: `deep-links.test.js`, `report-problem-modal.test.jsx`, `page-handoff.test.jsx` (add); `use-agency-status-polling.test.jsx`, `agency-status-screen.test.jsx` (new).

**Part 3: branded PDF**
- Create `Voyage-Client/app/lib/pdfImages.js`: Cloudinary thumbnail URLs, the CORS image loader and a concurrency-limited batch loader.
- Rewrite `Voyage-Client/app/lib/pdfExport.js` into layout A.
- Modify `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx`, `HomePage.jsx` and `app/itinerary/view/[token]/page.jsx`: pass `agencyName`, `clientName` and `logoUrl`.
- Tests:
  - New: `pdf-images.test.js`, `pdf-layout.test.js`.
  - Updated: `pdf-weather.test.js`, `pdf-accessibility.test.js`, `pdf-place-status.test.js` (fakes gain `setPage`; one wording change).
  - Added cases: `client-itinerary-pdf.test.jsx`, `share-page-pdf.test.jsx`.

---

# Part 1: Agent status wording (item 24)

### Task 1: Label helpers say what the agent is doing

**Files:**
- Modify: `Voyage-Client/app/components/agent/process-bubble/processBubbleLabels.js` (whole file)
- Test: `Voyage-Client/tests/process-bubble-labels.test.js` (rewrite), `Voyage-Client/tests/process-bubble-task-row.test.jsx:118-135`

- [ ] **Step 1: Write the failing tests.** Replace the whole of `tests/process-bubble-labels.test.js` with:

```js
import { describe, expect, it } from "vitest";
import {
  activeLabelFor,
  isTrackingTool,
  modernizeSummaryLabel,
  summarize,
  toolToActiveLabel,
  toolToDoneLabel,
} from "../app/components/agent/process-bubble/processBubbleLabels.js";

const AGENT_TOOLS = [
  "plan_itinerary", "create_itinerary", "update_itinerary", "delete_itinerary",
  "add_itinerary_day", "update_itinerary_day", "remove_itinerary_day",
  "add_itinerary_item", "update_itinerary_item", "remove_itinerary_item", "move_itinerary_item",
  "search_google_places", "search_nearby_google_places", "get_google_place_details", "get_google_place_photos",
  "place_insights", "map_pinpoint", "estimate_route", "route_logistics", "weather_forecast", "web_search", "ask_user",
];

describe("toolToActiveLabel", () => {
  it.each([
    ["plan_itinerary", "Planning the days…"],
    ["add_itinerary_item", "Adding a stop…"],
    ["update_itinerary_item", "Updating a stop…"],
    ["move_itinerary_item", "Moving a stop…"],
    ["remove_itinerary_day", "Removing a day…"],
    ["search_google_places", "Searching for places…"],
    ["search_nearby_google_places", "Finding places nearby…"],
    ["get_google_place_details", "Looking up place details…"],
    ["get_google_place_photos", "Getting photos…"],
    ["estimate_route", "Checking travel time…"],
    ["map_pinpoint", "Pinning it on the map…"],
    ["weather_forecast", "Checking the weather…"],
    ["web_search", "Searching the web…"],
    ["ask_user", "Preparing a question…"],
  ])("labels %s as %s", (name, label) => {
    expect(toolToActiveLabel(name)).toBe(label);
  });

  it("gives every agent tool a written label, never its raw name", () => {
    for (const name of AGENT_TOOLS) {
      expect(toolToActiveLabel(name)).not.toBe("Working on it…");
      expect(toolToActiveLabel(name)).not.toMatch(/_/);
    }
  });

  it('says "Working on it…" for a tool it does not know', () => {
    expect(toolToActiveLabel("some_unknown_tool")).toBe("Working on it…");
  });
});

describe("toolToDoneLabel", () => {
  it("uses the past tense for the step list", () => {
    expect(toolToDoneLabel("add_itinerary_item")).toBe("Added a stop");
    expect(toolToDoneLabel("search_google_places")).toBe("Searched for places");
    expect(toolToDoneLabel("ask_user")).toBe("Asked a question");
    expect(toolToDoneLabel("some_unknown_tool")).toBe("Finished a step");
  });
});

describe("isTrackingTool", () => {
  it("knows the agent's progress-tracking tools", () => {
    for (const name of ["add_agent_task", "update_agent_task", "list_agent_tasks", "record_agent_task"]) {
      expect(isTrackingTool(name)).toBe(true);
    }
    expect(isTrackingTool("add_itinerary_item")).toBe(false);
  });
});

describe("activeLabelFor", () => {
  it("says it is reading the request before anything has happened", () => {
    expect(activeLabelFor([])).toBe("Reading your request…");
  });

  it("names the latest tool", () => {
    const timeline = [
      { id: "1", kind: "tool", name: "search_google_places" },
      { id: "2", kind: "tool", name: "add_itinerary_item" },
    ];
    expect(activeLabelFor(timeline)).toBe("Adding a stop…");
  });

  it("says it is choosing the next step when the latest entry is a thought", () => {
    const timeline = [
      { id: "1", kind: "tool", name: "search_google_places" },
      { id: "t1", kind: "thought", text: "Burnham Park first" },
    ];
    expect(activeLabelFor(timeline)).toBe("Choosing the next step…");
  });

  it("says it is writing once reply text streams in", () => {
    const timeline = [{ id: "1", kind: "tool", name: "add_itinerary_item" }];
    expect(activeLabelFor(timeline, { writingReply: true })).toBe("Writing the reply…");
  });

  it("lets a running task's own label win over everything", () => {
    const timeline = [
      { id: "1", kind: "tool", name: "add_itinerary_item" },
      { id: "k1", kind: "task", status: "RUNNING", label: "Researching cafés" },
    ];
    expect(activeLabelFor(timeline, { writingReply: true })).toBe("Researching cafés");
  });

  it("skips progress-tracking tools", () => {
    const timeline = [
      { id: "1", kind: "tool", name: "search_google_places" },
      { id: "2", kind: "tool", name: "record_agent_task" },
    ];
    expect(activeLabelFor(timeline)).toBe("Searching for places…");
    expect(activeLabelFor([{ id: "1", kind: "tool", name: "add_agent_task" }])).toBe("Reading your request…");
  });
});

describe("summarize", () => {
  const tools = (...names) => names.map((name, index) => ({ kind: "tool", id: String(index), name }));

  it("returns 'Built itinerary · Xs' for three or more stops added", () => {
    expect(summarize(tools("add_itinerary_item", "add_itinerary_item", "add_itinerary_item"), 2300)).toBe("Built itinerary · 2.3s");
  });

  it("counts stops, singular and plural", () => {
    expect(summarize(tools("add_itinerary_item", "add_itinerary_item"), 1100)).toBe("Added 2 stops · 1.1s");
    expect(summarize(tools("add_itinerary_item"), 900)).toBe("Added 1 stop · 0.9s");
  });

  it("returns 'Researched N places · Xs' when any map_pinpoint is present", () => {
    expect(summarize(tools("plan_itinerary", "map_pinpoint", "add_itinerary_item", "add_itinerary_item"), 2300)).toBe("Researched 4 places · 2.3s");
  });

  it("returns 'Replied in Xs' when the run only reasoned", () => {
    expect(summarize([{ kind: "thought", id: "t1", text: "Considering route" }], 1800)).toBe("Replied in 1.8s");
  });

  it("returns 'Finished in Xs' for a mix of other tools", () => {
    expect(summarize(tools("web_search", "estimate_route"), 3000)).toBe("Finished in 3.0s");
  });

  it("does not count progress-tracking tools", () => {
    expect(summarize(tools("record_agent_task"), 1200)).toBe("Replied in 1.2s");
    expect(summarize(tools("record_agent_task", "add_itinerary_item"), 1200)).toBe("Added 1 stop · 1.2s");
  });

  it("summarizes a run that asked as asking for input", () => {
    expect(summarize(tools("add_itinerary_item", "ask_user"), 1400)).toBe("Asked for your input · 1.4s");
  });

  it("handles zero durationMs", () => {
    expect(summarize(tools("add_itinerary_item"), 0)).toContain("0.0s");
  });
});

describe("modernizeSummaryLabel", () => {
  it("rewrites summaries saved before the new wording", () => {
    expect(modernizeSummaryLabel("Thought for 1.2s")).toBe("Replied in 1.2s");
    expect(modernizeSummaryLabel("Worked for 4.0s")).toBe("Finished in 4.0s");
    expect(modernizeSummaryLabel("Added 2 items · 1.1s")).toBe("Added 2 stops · 1.1s");
    expect(modernizeSummaryLabel("Added 1 items · 1.1s")).toBe("Added 1 stop · 1.1s");
  });

  it("leaves current wording and non-strings alone", () => {
    expect(modernizeSummaryLabel("Built itinerary · 2.3s")).toBe("Built itinerary · 2.3s");
    expect(modernizeSummaryLabel(undefined)).toBeUndefined();
  });
});
```

In `tests/process-bubble-task-row.test.jsx`, replace the two `activeLabelFor` tests at lines 118-135 with:

```jsx
  it("activeLabelFor falls back to tool label when no RUNNING task", () => {
    const timeline = [
      { id: "t1", kind: "tool", name: "add_itinerary_item" },
      { id: "t2", kind: "task", status: "COMPLETED", label: "Phase 1" },
    ];

    const result = activeLabelFor(timeline);
    expect(result).toBe("Adding a stop…");
  });

  it("activeLabelFor says it is choosing the next step when only thoughts are present", () => {
    const timeline = [
      { id: "t1", kind: "thought", text: "Considering options" },
    ];

    const result = activeLabelFor(timeline);
    expect(result).toBe("Choosing the next step…");
  });
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/process-bubble-labels.test.js tests/process-bubble-task-row.test.jsx`
Expected: FAIL. `isTrackingTool`, `toolToDoneLabel` and `modernizeSummaryLabel` are not exported, and the old labels ("Planning itinerary…", "Thinking…") don't match.

- [ ] **Step 3: Replace `app/components/agent/process-bubble/processBubbleLabels.js` with:**

```js
// Label helpers for ProcessBubble component.
// See: docs/superpowers/specs/2026-05-23-agent-process-bubble-design.md §3
// Wording (capstone panel item 24, 2026-10-11): always say what the agent is doing.
// The server mirrors summarize() in Voyage-Server/src/modules/agent/agentService.ts.

// [label while it runs, past-tense row in the step list]
const TOOL_LABELS = {
  plan_itinerary: ["Planning the days…", "Planned the days"],
  create_itinerary: ["Creating the itinerary…", "Created the itinerary"],
  update_itinerary: ["Updating the itinerary…", "Updated the itinerary"],
  delete_itinerary: ["Deleting the itinerary…", "Deleted the itinerary"],
  add_itinerary_day: ["Adding a day…", "Added a day"],
  update_itinerary_day: ["Updating a day…", "Updated a day"],
  remove_itinerary_day: ["Removing a day…", "Removed a day"],
  add_itinerary_item: ["Adding a stop…", "Added a stop"],
  update_itinerary_item: ["Updating a stop…", "Updated a stop"],
  remove_itinerary_item: ["Removing a stop…", "Removed a stop"],
  move_itinerary_item: ["Moving a stop…", "Moved a stop"],
  search_google_places: ["Searching for places…", "Searched for places"],
  search_nearby_google_places: ["Finding places nearby…", "Found places nearby"],
  get_google_place_details: ["Looking up place details…", "Looked up place details"],
  get_google_place_photos: ["Getting photos…", "Got photos"],
  place_insights: ["Reading up on a place…", "Read up on a place"],
  map_pinpoint: ["Pinning it on the map…", "Pinned it on the map"],
  estimate_route: ["Checking travel time…", "Checked travel time"],
  route_logistics: ["Working out the route…", "Worked out the route"],
  weather_forecast: ["Checking the weather…", "Checked the weather"],
  web_search: ["Searching the web…", "Searched the web"],
  ask_user: ["Preparing a question…", "Asked a question"],
};

const UNKNOWN_TOOL_LABELS = ["Working on it…", "Finished a step"];

// The agent's bookkeeping tools. The task rows already show their effect, so they
// never name the live label, never get a row and never count in a summary.
const TRACKING_TOOL_NAMES = new Set(["add_agent_task", "update_agent_task", "list_agent_tasks", "record_agent_task"]);

const READING_LABEL = "Reading your request…";
const CHOOSING_LABEL = "Choosing the next step…";
const WRITING_LABEL = "Writing the reply…";

export function isTrackingTool(name) {
  return TRACKING_TOOL_NAMES.has(name);
}

/** The label shown while a tool runs. Unknown tools never show their raw name. */
export function toolToActiveLabel(name) {
  return (TOOL_LABELS[name] ?? UNKNOWN_TOOL_LABELS)[0];
}

/** The past-tense row for a tool in the step list. */
export function toolToDoneLabel(name) {
  return (TOOL_LABELS[name] ?? UNKNOWN_TOOL_LABELS)[1];
}

function countStops(count) {
  return `${count} ${count === 1 ? "stop" : "stops"}`;
}

/**
 * Returns the done-state summary string for the process bubble header.
 *
 * Scenarios (in priority order), progress-tracking tools not counted:
 *  1. No tools → "Replied in Xs"
 *  2. Any ask_user → "Asked for your input · Xs"
 *  3. Any map_pinpoint → "Researched N places · Xs"
 *  4. All add_itinerary_item, n >= 3 → "Built itinerary · Xs"
 *  5. All add_itinerary_item, n < 3 → "Added N stop(s) · Xs"
 *  6. Anything else → "Finished in Xs"
 */
export function summarize(timeline, durationMs) {
  const durationStr = (Number(durationMs ?? 0) / 1000).toFixed(1) + "s";

  const toolEntries = Array.isArray(timeline)
    ? timeline.filter((entry) => entry.kind === "tool" && !isTrackingTool(entry.name))
    : [];

  if (toolEntries.length === 0) {
    return `Replied in ${durationStr}`;
  }

  // Matches the server's summary for a run that ended by asking the user.
  if (toolEntries.some((entry) => entry.name === "ask_user")) {
    return `Asked for your input · ${durationStr}`;
  }

  if (toolEntries.some((entry) => entry.name === "map_pinpoint")) {
    return `Researched ${toolEntries.length} places · ${durationStr}`;
  }

  if (toolEntries.every((entry) => entry.name === "add_itinerary_item")) {
    if (toolEntries.length >= 3) {
      return `Built itinerary · ${durationStr}`;
    }
    return `Added ${countStops(toolEntries.length)} · ${durationStr}`;
  }

  return `Finished in ${durationStr}`;
}

/**
 * Returns the active header label during a live streaming run.
 *
 * Priority:
 *  1. Last RUNNING task label (task phases name the run)
 *  2. "Writing the reply…" while reply text streams (writingReply)
 *  3. The latest entry: a tool names itself, a thought means "Choosing the next step…"
 *  4. "Reading your request…" before anything has happened
 */
export function activeLabelFor(timeline, { writingReply = false } = {}) {
  const entries = Array.isArray(timeline) ? timeline : [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === "task" && entry.status === "RUNNING") {
      return entry.label;
    }
  }

  if (writingReply) return WRITING_LABEL;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === "thought") return CHOOSING_LABEL;
    if (entry.kind === "tool" && !isTrackingTool(entry.name)) return toolToActiveLabel(entry.name);
  }

  return READING_LABEL;
}

/** Saved runs from before 2026-10-11 carry the old summaries; show them in the new wording. */
export function modernizeSummaryLabel(label) {
  if (typeof label !== "string") return label;
  return label
    .replace(/^Thought for /, "Replied in ")
    .replace(/^Worked for /, "Finished in ")
    .replace(/^Added (\d+) items? · /, (_match, count) => `Added ${countStops(Number(count))} · `);
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/process-bubble-labels.test.js tests/process-bubble-task-row.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/agent/process-bubble/processBubbleLabels.js tests/process-bubble-labels.test.js tests/process-bubble-task-row.test.jsx
git commit -m "feat(agent): say what the agent is doing instead of Thinking"
```

### Task 2: Step list rows in plain past tense; old summaries reworded

**Files:**
- Modify: `Voyage-Client/app/components/agent/process-bubble/ProcessBubble.jsx:1-16` (imports and helper), `:70-93` (grouping), `:116-125` (header label), `:192-195` (tool row)
- Test: `Voyage-Client/tests/process-bubble.test.jsx`

- [ ] **Step 1: Write the failing tests.**

In `tests/process-bubble.test.jsx`:
- Replace every `"Thinking…"` with `"Reading your request…"`. There are three places: lines 22, 24 and 153/156.
- Change lines 56-57 to:

```jsx
    // Tool row content: the past-tense label
    expect(screen.getByText("Added a stop")).toBeInTheDocument();
```

Then append:

```jsx
describe("ProcessBubble — wording", () => {
  it("hides the agent's progress-tracking tools from the step list", () => {
    const timeline = [
      { id: "t1", kind: "tool", name: "record_agent_task" },
      { id: "t2", kind: "tool", name: "search_google_places" },
    ];
    renderBubble({ status: "done", activeLabel: "Finished in 1.0s", timeline, defaultOpen: true });

    expect(screen.getByText("Searched for places")).toBeInTheDocument();
    expect(screen.queryByText(/record agent task/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Finished a step")).not.toBeInTheDocument();
  });

  it("shows a saved run's old summary in the new wording", () => {
    renderBubble({ status: "done", activeLabel: "Thought for 1.2s", timeline: [] });

    expect(screen.getByText("Replied in 1.2s")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/process-bubble.test.jsx`
Expected: FAIL. The rows still read "Add Itinerary Item" and "Search Google Places", and the old "Thought for 1.2s" is shown.

- [ ] **Step 3: Implement.** In `ProcessBubble.jsx`:

Replace the private `humanizeToolName` helper (lines 8-15) with an import. Put it after the `styles` import:

```jsx
import { isTrackingTool, modernizeSummaryLabel, toolToDoneLabel } from "./processBubbleLabels.js";
```

Replace `const safeTimeline = Array.isArray(timeline) ? timeline : [];` with:

```jsx
  // The agent's progress-tracking tools show up as task rows already; hide their tool rows.
  const safeTimeline = (Array.isArray(timeline) ? timeline : []).filter(
    (entry) => !(entry.kind === "tool" && isTrackingTool(entry.name)),
  );
  // Saved runs from before the 2026-10-11 wording still carry "Thought for …" and similar.
  const headerLabel = status === "done" ? modernizeSummaryLabel(activeLabel) : activeLabel;
```

Change the coalescing comment line `// N identical rows; this collapses them into "Add Itinerary Item ×N".` to `// N identical rows; this collapses them into "Added a stop ×N".`

In the header label `<span aria-live="polite" …>`, change `{activeLabel}` to `{headerLabel}`.

In the tool row, change `<span>{humanizeToolName(entry.name)}</span>` to `<span>{toolToDoneLabel(entry.name)}</span>`.

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/process-bubble.test.jsx tests/process-bubble-task-row.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/agent/process-bubble/ProcessBubble.jsx tests/process-bubble.test.jsx
git commit -m "feat(agent): plain past-tense step rows and reworded saved summaries"
```

### Task 3: The live bubble says when the reply is being written

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/command-center/AgentCommandCenter.jsx:108-169` (the `liveProcess` memo)
- Test: `Voyage-Client/tests/agent-live-label.test.jsx` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/agent-live-label.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentCommandCenter from "../app/components/trip-dashboard/command-center/AgentCommandCenter.jsx";

// jsdom has no ResizeObserver (useElementHeight) and no scrollIntoView.
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderLive({ assistantMessage = "", toolCalls = [], thoughtEntries = [] } = {}) {
  return render(
    <AgentCommandCenter
      messages={[{ id: "u-1", role: "user", content: "Plan two days in Baguio" }]}
      isStreaming
      assistantMessage={assistantMessage}
      toolCalls={toolCalls}
      thoughtEntries={thoughtEntries}
      dispatchAgentMessage={vi.fn()}
      composerInput=""
      setComposerInput={vi.fn()}
      isSending={false}
      agentError=""
      user={{ displayName: "Jerald" }}
    />,
  );
}

describe("live agent status label", () => {
  it("says it is reading the request before anything happens", () => {
    renderLive();
    expect(screen.getByText("Reading your request…")).toBeInTheDocument();
  });

  it("names the running tool in plain words", () => {
    renderLive({ toolCalls: [{ name: "search_google_places", status: "Running" }] });
    expect(screen.getByText("Searching for places…")).toBeInTheDocument();
  });

  it("says it is choosing the next step while it reasons", () => {
    renderLive({
      toolCalls: [{ name: "search_google_places", status: "Completed" }],
      thoughtEntries: [{ id: "th-1", text: "Burnham Park first", precedingToolCount: 1 }],
    });
    expect(screen.getByText("Choosing the next step…")).toBeInTheDocument();
  });

  it("says it is writing once the reply text streams in", () => {
    renderLive({ toolCalls: [{ name: "add_itinerary_item", status: "Completed" }], assistantMessage: "Here is your plan" });
    expect(screen.getByText("Writing the reply…")).toBeInTheDocument();
  });

  it("never says Thinking", () => {
    renderLive();
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agent-live-label.test.jsx`
Expected: FAIL on "says it is writing once the reply text streams in": it shows "Adding a stop…". The other cases already pass after Task 1.

- [ ] **Step 3: Implement.** In `AgentCommandCenter.jsx`, add this line just above `const liveProcess = useMemo(() => {`:

```jsx
  // useAgentRunStream clears the reply text on every tool.started, so any text
  // here arrived after the latest tool: the agent is writing its reply.
  const writingReply = typeof assistantMessage === "string" && assistantMessage.trim().length > 0;
```

Inside the memo, change `const activeLabel = activeLabelFor(timeline);` to:

```jsx
    const activeLabel = activeLabelFor(timeline, { writingReply });
```

Add `writingReply` to the memo's dependency list:

```jsx
  }, [isStreaming, toolCalls, thoughtEntries, tasks, tasksTouchedThisRun, openStates, writingReply]);
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/agent-live-label.test.jsx tests/composer-height-padding.test.jsx tests/ask-user-history.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/trip-dashboard/command-center/AgentCommandCenter.jsx tests/agent-live-label.test.jsx
git commit -m "feat(agent): show Writing the reply while the answer streams"
```

### Task 4: Top-bar pill says "Working"

**Files:**
- Modify: `Voyage-Client/app/lib/formatters.js:139-145`
- Test: `Voyage-Client/tests/run-status-label.test.js` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/run-status-label.test.js`:

```js
import { describe, expect, it } from "vitest";
import { getRunStatusLabel } from "../app/lib/formatters.js";

describe("getRunStatusLabel", () => {
  it('says "Working" while a run is in progress', () => {
    expect(getRunStatusLabel("running", null)).toBe("Working");
    expect(getRunStatusLabel("in_progress", null)).toBe("Working");
  });

  it("keeps the idle, ready and error labels", () => {
    expect(getRunStatusLabel("completed", null)).toBe("Idle");
    expect(getRunStatusLabel("idle", null)).toBe("Ready");
    expect(getRunStatusLabel("running", new Error("stream failed"))).toBe("Needs attention");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/run-status-label.test.js`
Expected: FAIL. It received "Agent streaming".

- [ ] **Step 3: Implement.** In `app/lib/formatters.js` `getRunStatusLabel`, change `return "Agent streaming";` to `return "Working";`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run tests/run-status-label.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/lib/formatters.js tests/run-status-label.test.js
git commit -m "feat(agent): call the run pill Working instead of Agent streaming"
```

### Task 5: Server summaries use the same wording

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentService.ts:66-99` (`summarizeTimeline`)
- Test: `Voyage-Server/tests/agentService.test.ts` (append a describe)

- [ ] **Step 1: Write the failing tests.** Append to `tests/agentService.test.ts`. It already imports `createAgentService` and has `createMemoryRepository`.

```ts
describe("process summary wording", () => {
  async function finishRunWith(events: Array<{ type: string; payload: Record<string, unknown> }>) {
    const repository = createMemoryRepository();
    const service = createAgentService({ repository });
    const thread = await service.createThread("agency-1", "user-1", { title: "Baguio" });
    const { run } = await service.appendUserMessageAndCreateRun("agency-1", thread.id, "user-1", "Plan Baguio");
    for (const event of events) {
      await service.recordRunEvent(run, event as never);
    }
    const result = await service.completeRun(run.id, "Done.");
    return (result.message.metadata as any).process.activeLabel as string;
  }

  const tool = (name: string) => [
    { type: "tool.started", payload: { name, input: {} } },
    { type: "tool.completed", payload: { name, output: {} } }
  ];

  it("says Replied in for a run that only reasoned", async () => {
    await expect(finishRunWith([{ type: "thought.delta", payload: { delta: "Considering the route" } }])).resolves.toMatch(/^Replied in /);
  });

  it("counts stops, singular and plural", async () => {
    await expect(finishRunWith([...tool("add_itinerary_item")])).resolves.toMatch(/^Added 1 stop · /);
    await expect(finishRunWith([...tool("add_itinerary_item"), ...tool("add_itinerary_item")])).resolves.toMatch(/^Added 2 stops · /);
  });

  it("says Finished in for a mix of other tools", async () => {
    await expect(finishRunWith([...tool("web_search"), ...tool("estimate_route")])).resolves.toMatch(/^Finished in /);
  });

  it("does not count progress-tracking tools", async () => {
    await expect(finishRunWith([...tool("record_agent_task"), ...tool("add_itinerary_item")])).resolves.toMatch(/^Added 1 stop · /);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agentService.test.ts -t "process summary wording"`
Expected: FAIL. It received "Thought for …", "Added 1 items …" and "Worked for …".

- [ ] **Step 3: Implement.** In `src/modules/agent/agentService.ts`, replace `summarizeTimeline` (lines 66-99) with:

```ts
// The agent's bookkeeping tools; the client hides them too (processBubbleLabels.js).
const TRACKING_TOOL_NAMES = new Set(["add_agent_task", "update_agent_task", "list_agent_tasks", "record_agent_task"]);

function countStops(count: number): string {
  return `${count} ${count === 1 ? "stop" : "stops"}`;
}

// Wording mirrors summarize() in Voyage-Client/app/components/agent/process-bubble/processBubbleLabels.js.
function summarizeTimeline(
  timeline: ProcessTimelineEntry[],
  durationMs: number | null,
  endedWithQuestions = false
): string {
  const durationStr =
    durationMs != null ? (durationMs / 1000).toFixed(1) + "s" : "-";

  const toolEntries = timeline.filter(
    (e): e is { id: string; kind: "tool"; name: string } => e.kind === "tool" && !TRACKING_TOOL_NAMES.has(e.name)
  );

  if (toolEntries.length === 0) {
    return `Replied in ${durationStr}`;
  }

  // Only when the run really ended with questions; a failed ask_user call does not count.
  if (endedWithQuestions && toolEntries.some((e) => e.name === ASK_USER_TOOL_NAME)) {
    return `Asked for your input · ${durationStr}`;
  }

  const hasMapPinpoint = toolEntries.some((e) => e.name === "map_pinpoint");
  if (hasMapPinpoint) {
    return `Researched ${toolEntries.length} places · ${durationStr}`;
  }

  const allAddItem = toolEntries.every((e) => e.name === "add_itinerary_item");
  if (allAddItem) {
    if (toolEntries.length >= 3) {
      return `Built itinerary · ${durationStr}`;
    }
    return `Added ${countStops(toolEntries.length)} · ${durationStr}`;
  }

  return `Finished in ${durationStr}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/agentService.test.ts`
Expected: PASS, including the existing "Asked for your input" tests.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/agent/agentService.ts tests/agentService.test.ts
git commit -m "feat(agent): match the client's run summary wording"
```

---

# Part 2: Registration confirmation loop (item 20)

### Task 6: Four registration emails

**Files:**
- Modify: `Voyage-Server/src/services/email.ts`: payload types after `AgencyInvitationEmailPayload` (line 23); four functions after `sendAgencyInvitationEmail`, at the end of the file.
- Test: `Voyage-Server/tests/agencyApplicationEmails.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/agencyApplicationEmails.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mailMocks = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  const createTransport = vi.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mailMocks.createTransport
  }
}));

const malicious = `<img src=x onerror="alert(1)">&"'`;

async function loadEmailService() {
  vi.resetModules();
  return import("../src/services/email");
}

function lastMail(): { to?: string; subject?: string; html?: string; text?: string } {
  return mailMocks.sendMail.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.EMAIL_FROM = "Voyage <no-reply@example.com>";
  delete process.env.RESEND_API_KEY;
});

describe("agency registration emails", () => {
  it("confirms a new application to its owner", async () => {
    const { sendAgencyApplicationReceivedEmail } = await loadEmailService();

    await sendAgencyApplicationReceivedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      statusUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.to).toBe("owner@hillside.test");
    expect(mail.subject).toBe("We received your application for Hillside Travel");
    expect(mail.html).toContain("1–2 business days");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1"');
    expect(mail.text).toContain("https://app.test/?authenticated=1");
  });

  it("tells the owner their agency is approved, with a link to the workspace", async () => {
    const { sendAgencyApprovedEmail } = await loadEmailService();

    await sendAgencyApprovedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      workspaceUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.subject).toBe("Hillside Travel is approved on Voyage");
    expect(mail.html).toContain("Open your workspace");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1"');
    expect(mail.text).toContain("Open your workspace: https://app.test/?authenticated=1");
  });

  it("tells the owner why the application wasn't approved", async () => {
    const { sendAgencyRejectedEmail } = await loadEmailService();

    await sendAgencyRejectedEmail({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      reason: "Business permit missing",
      statusUrl: "https://app.test/?authenticated=1"
    });

    const mail = lastMail();
    expect(mail.subject).toBe("Update on your Voyage application for Hillside Travel");
    expect(mail.html).toContain("Business permit missing");
    expect(mail.text).toContain("Reason: Business permit missing");
    expect(mail.html).toContain("Contact support");
  });

  it("alerts a super admin to a new application", async () => {
    const { sendNewAgencyApplicationEmail } = await loadEmailService();

    await sendNewAgencyApplicationEmail({
      to: "admin@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: "Baguio, Philippines",
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });

    const mail = lastMail();
    expect(mail.to).toBe("admin@voyage.test");
    expect(mail.subject).toBe("New agency waiting for review: Hillside Travel");
    expect(mail.html).toContain("owner@hillside.test");
    expect(mail.html).toContain("Baguio, Philippines");
    expect(mail.html).toContain('href="https://app.test/?authenticated=1&amp;tab=admin"');
    expect(mail.text).toContain("Ana (owner@hillside.test) registered Hillside Travel in Baguio, Philippines.");
  });

  it("leaves out the location when the application gave none", async () => {
    const { sendNewAgencyApplicationEmail } = await loadEmailService();

    await sendNewAgencyApplicationEmail({
      to: "admin@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: null,
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });

    expect(lastMail().text).toContain("Ana (owner@hillside.test) registered Hillside Travel.");
  });

  it("escapes names and reasons in HTML while leaving text unescaped", async () => {
    const email = await loadEmailService();
    const sends = [
      () => email.sendAgencyApplicationReceivedEmail({ to: "o@x.test", displayName: malicious, agencyName: malicious, statusUrl: "https://app.test/" }),
      () => email.sendAgencyApprovedEmail({ to: "o@x.test", displayName: malicious, agencyName: malicious, workspaceUrl: "https://app.test/" }),
      () => email.sendAgencyRejectedEmail({ to: "o@x.test", displayName: "Ana", agencyName: malicious, reason: malicious, statusUrl: "https://app.test/" }),
      () => email.sendNewAgencyApplicationEmail({ to: "a@x.test", agencyName: malicious, ownerName: malicious, ownerEmail: "o@x.test", location: malicious, reviewUrl: "https://app.test/" })
    ];

    for (const send of sends) {
      await send();
      const mail = lastMail();
      expect(mail.html).not.toContain("<img src=x");
      expect(mail.html).toContain("&lt;img");
      expect(mail.text).toContain(malicious);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agencyApplicationEmails.test.ts`
Expected: FAIL. `sendAgencyApplicationReceivedEmail` and the others are not functions.

- [ ] **Step 3: Implement.** In `src/services/email.ts`, add the payload types after `AgencyInvitationEmailPayload`:

```ts
export type AgencyApplicationReceivedEmailPayload = {
  to: string;
  displayName: string;
  agencyName: string;
  statusUrl: string;
};

export type AgencyApprovedEmailPayload = {
  to: string;
  displayName: string;
  agencyName: string;
  workspaceUrl: string;
};

export type AgencyRejectedEmailPayload = {
  to: string;
  displayName: string;
  agencyName: string;
  reason: string;
  statusUrl: string;
};

export type NewAgencyApplicationEmailPayload = {
  to: string;
  agencyName: string;
  ownerName: string;
  ownerEmail: string;
  /** "City, Country", or null when the application gave neither. */
  location: string | null;
  reviewUrl: string;
};
```

Append these functions at the end of the file:

```ts
// The pending screen promises the same review time (AgencyStatusScreen.jsx).
const AGENCY_REVIEW_TIME = "1–2 business days";

export async function sendAgencyApplicationReceivedEmail(payload: AgencyApplicationReceivedEmailPayload) {
  const subject = `We received your application for ${payload.agencyName}`;
  const agencyName = escapeHtmlText(payload.agencyName);
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: `We review new agencies within ${AGENCY_REVIEW_TIME} and will email you when it's done.`,
      recipient: payload.to,
      headingHtml: "We received your application",
      bodyHtml:
        paragraph(`Hi ${escapeHtmlText(payload.displayName)},`) +
        paragraph(
          `Thanks for registering <strong>${agencyName}</strong> on Voyage. Our team reviews every new agency before it can plan trips, usually within ${AGENCY_REVIEW_TIME}.`
        ) +
        paragraph(
          `We&rsquo;ll email <strong>${escapeHtmlText(payload.to)}</strong> as soon as it&rsquo;s reviewed. You can also sign in any time to check its status.`
        ),
      action: { label: "Check application status", url: payload.statusUrl },
      noticeHtml:
        "You&rsquo;re receiving this because you registered an agency on Voyage. If that wasn&rsquo;t you, you can ignore this email."
    }),
    text: renderText([
      `Hi ${payload.displayName},`,
      "",
      `Thanks for registering ${payload.agencyName} on Voyage. Our team reviews every new agency before it can plan trips, usually within ${AGENCY_REVIEW_TIME}.`,
      "",
      `We'll email ${payload.to} as soon as it's reviewed. Check its status any time: ${payload.statusUrl}`
    ]),
    logMessage: "Agency application email delivery skipped because no provider is configured."
  });
}

export async function sendAgencyApprovedEmail(payload: AgencyApprovedEmailPayload) {
  const subject = `${payload.agencyName} is approved on Voyage`;
  const agencyName = escapeHtmlText(payload.agencyName);
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: "Your agency workspace is ready. Sign in to start planning client trips.",
      recipient: payload.to,
      headingHtml: "Your agency is approved",
      bodyHtml:
        paragraph(`Hi ${escapeHtmlText(payload.displayName)},`) +
        paragraph(
          `Good news: <strong>${agencyName}</strong> has been approved. Your workspace is ready, so you and your team can start planning client trips.`
        ),
      action: { label: "Open your workspace", url: payload.workspaceUrl },
      noticeHtml: `You&rsquo;re receiving this because you registered ${agencyName} on Voyage.`
    }),
    text: renderText([
      `Hi ${payload.displayName},`,
      "",
      `Good news: ${payload.agencyName} has been approved. Your workspace is ready, so you and your team can start planning client trips.`,
      "",
      `Open your workspace: ${payload.workspaceUrl}`
    ]),
    logMessage: "Agency approval email delivery skipped because no provider is configured."
  });
}

export async function sendAgencyRejectedEmail(payload: AgencyRejectedEmailPayload) {
  const subject = `Update on your Voyage application for ${payload.agencyName}`;
  const agencyName = escapeHtmlText(payload.agencyName);
  const reason = payload.reason.trim();
  const nextStep = "If you think this is a mistake, or you've fixed the issue, sign in and choose Contact support to reach our team.";
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: "Your agency application wasn't approved. See why and what you can do next.",
      recipient: payload.to,
      headingHtml: "Your application wasn&rsquo;t approved",
      bodyHtml:
        paragraph(`Hi ${escapeHtmlText(payload.displayName)},`) +
        paragraph(`We reviewed <strong>${agencyName}</strong> and couldn&rsquo;t approve it this time.`) +
        (reason ? paragraph(`<strong>Reason:</strong> ${escapeHtmlText(reason)}`) : "") +
        paragraph(escapeHtmlText(nextStep)),
      action: { label: "View your application", url: payload.statusUrl },
      noticeHtml: `You&rsquo;re receiving this because you registered ${agencyName} on Voyage.`
    }),
    text: renderText([
      `Hi ${payload.displayName},`,
      "",
      `We reviewed ${payload.agencyName} and couldn't approve it this time.`,
      ...(reason ? ["", `Reason: ${reason}`] : []),
      "",
      nextStep,
      "",
      `View your application: ${payload.statusUrl}`
    ]),
    logMessage: "Agency rejection email delivery skipped because no provider is configured."
  });
}

export async function sendNewAgencyApplicationEmail(payload: NewAgencyApplicationEmailPayload) {
  const subject = `New agency waiting for review: ${payload.agencyName}`;
  const agencyName = escapeHtmlText(payload.agencyName);
  const whereHtml = payload.location ? ` in ${escapeHtmlText(payload.location)}` : "";
  const whereText = payload.location ? ` in ${payload.location}` : "";
  await sendMail({
    to: payload.to,
    subject,
    html: renderEmail({
      subject,
      preheader: `${payload.ownerName} registered ${payload.agencyName}. Review it in the admin Agencies tab.`,
      recipient: payload.to,
      headingHtml: "New agency waiting for review",
      bodyHtml:
        paragraph("Hi,") +
        paragraph(
          `<strong>${escapeHtmlText(payload.ownerName)}</strong> (${escapeHtmlText(payload.ownerEmail)}) registered <strong>${agencyName}</strong>${whereHtml}.`
        ) +
        paragraph("It&rsquo;s waiting in the admin Agencies tab for your approval."),
      action: { label: "Review agency", url: payload.reviewUrl },
      noticeHtml: "You&rsquo;re receiving this because you&rsquo;re a Voyage super admin."
    }),
    text: renderText([
      "Hi,",
      "",
      `${payload.ownerName} (${payload.ownerEmail}) registered ${payload.agencyName}${whereText}.`,
      "",
      `Review it in the admin Agencies tab: ${payload.reviewUrl}`
    ]),
    logMessage: "New agency alert email delivery skipped because no provider is configured."
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/agencyApplicationEmails.test.ts tests/emailSecurity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/services/email.ts tests/agencyApplicationEmails.test.ts
git commit -m "feat(email): agency application received, approved, rejected and admin alert emails"
```

### Task 7: The repository can list the super admins to alert

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyTypes.ts`: the `AgencyRepository` type, after `findUserById`.
- Modify: `Voyage-Server/src/modules/agencies/agencyRepository.ts`: after `findUserById`.
- Test: `Voyage-Server/tests/agencyRepository.test.ts` (new)

- [ ] **Step 1: Write the failing test.** Create `tests/agencyRepository.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPrismaAgencyRepository } from "../src/modules/agencies/agencyRepository";

describe("agency repository: listActiveSuperAdmins", () => {
  it("lists active super admins with only the fields an email needs", async () => {
    const admins = [{ id: "admin-1", email: "admin@voyage.test", displayName: "Ada" }];
    const findMany = vi.fn().mockResolvedValue(admins);
    const repository = createPrismaAgencyRepository({ user: { findMany } } as never);

    await expect(repository.listActiveSuperAdmins()).resolves.toEqual(admins);
    expect(findMany).toHaveBeenCalledWith({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      select: { id: true, email: true, displayName: true }
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agencyRepository.test.ts`
Expected: FAIL. `repository.listActiveSuperAdmins is not a function`.

- [ ] **Step 3: Implement.** In `agencyTypes.ts`, inside `AgencyRepository` after `findUserById(...)`:

```ts
  listActiveSuperAdmins(): Promise<Array<{ id: string; email: string; displayName: string }>>;
```

In `agencyRepository.ts`, after the `findUserById` method:

```ts
    async listActiveSuperAdmins() {
      return client.user.findMany({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
        select: { id: true, email: true, displayName: true }
      });
    },
```

- [ ] **Step 4: Run the test, then the build, to verify they pass.**

Run: `npx vitest run tests/agencyRepository.test.ts && npm run build`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/agencies/agencyTypes.ts src/modules/agencies/agencyRepository.ts tests/agencyRepository.test.ts
git commit -m "feat(agencies): list active super admins for review alerts"
```

### Task 8: Notifier decides who gets which email and contains failures

**Files:**
- Create: `Voyage-Server/src/modules/agencies/agencyNotifications.ts`
- Test: `Voyage-Server/tests/agencyNotifications.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/agencyNotifications.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgencyNotifier } from "../src/modules/agencies/agencyNotifications";

const agency = {
  id: "agency-1",
  name: "Hillside Travel",
  status: "PENDING_REVIEW" as const,
  ownerUserId: "owner-1",
  submittedAt: new Date("2026-10-11T00:00:00.000Z"),
  verifiedAt: null,
  verifiedByAdminUserId: null,
  rejectedAt: null,
  rejectedByAdminUserId: null,
  rejectionReason: null as string | null,
  suspendedAt: null,
  suspendedByAdminUserId: null,
  suspensionReason: null,
  businessPhone: "639001112222",
  businessEmail: "hello@hillside.test",
  country: "Philippines",
  city: "Baguio",
  ownerUser: { id: "owner-1", email: "owner@hillside.test", displayName: "Ana" }
};

function setup(overrides: { agency?: typeof agency | null; admins?: Array<{ id: string; email: string; displayName: string }> } = {}) {
  const repository = {
    findAgencyByIdWithOwner: vi.fn().mockResolvedValue(overrides.agency === undefined ? agency : overrides.agency),
    listActiveSuperAdmins: vi.fn().mockResolvedValue(
      overrides.admins ?? [
        { id: "admin-1", email: "ada@voyage.test", displayName: "Ada" },
        { id: "admin-2", email: "ben@voyage.test", displayName: "Ben" }
      ]
    )
  };
  const emailSender = {
    sendAgencyApplicationReceivedEmail: vi.fn().mockResolvedValue(undefined),
    sendAgencyApprovedEmail: vi.fn().mockResolvedValue(undefined),
    sendAgencyRejectedEmail: vi.fn().mockResolvedValue(undefined),
    sendNewAgencyApplicationEmail: vi.fn().mockResolvedValue(undefined)
  };
  const logError = vi.fn();
  const notifier = createAgencyNotifier({ repository, emailSender, appOrigin: "https://app.test/", logError });
  return { notifier, repository, emailSender, logError };
}

beforeEach(() => {
  agency.rejectionReason = null;
});

describe("agency notifier", () => {
  it("confirms a new application to the owner and alerts every super admin", async () => {
    const { notifier, emailSender } = setup();

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendAgencyApplicationReceivedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      statusUrl: "https://app.test/?authenticated=1"
    });
    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledTimes(2);
    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledWith({
      to: "ada@voyage.test",
      agencyName: "Hillside Travel",
      ownerName: "Ana",
      ownerEmail: "owner@hillside.test",
      location: "Baguio, Philippines",
      reviewUrl: "https://app.test/?authenticated=1&tab=admin"
    });
  });

  it("tells the owner about an approval", async () => {
    const { notifier, emailSender } = setup();

    await notifier.agencyApproved("agency-1");

    expect(emailSender.sendAgencyApprovedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      workspaceUrl: "https://app.test/?authenticated=1"
    });
  });

  it("tells the owner about a rejection, with the saved reason", async () => {
    agency.rejectionReason = "Business permit missing";
    const { notifier, emailSender } = setup();

    await notifier.agencyRejected("agency-1");

    expect(emailSender.sendAgencyRejectedEmail).toHaveBeenCalledWith({
      to: "owner@hillside.test",
      displayName: "Ana",
      agencyName: "Hillside Travel",
      reason: "Business permit missing",
      statusUrl: "https://app.test/?authenticated=1"
    });
  });

  it("still alerts the admins when the owner's email fails, and logs the failure", async () => {
    const { notifier, emailSender, logError } = setup();
    emailSender.sendAgencyApplicationReceivedEmail.mockRejectedValueOnce(new Error("Resend down"));

    await expect(notifier.applicationSubmitted("agency-1")).resolves.toBeUndefined();

    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      "[agencyNotifications] application received email failed",
      expect.objectContaining({ agencyId: "agency-1" })
    );
  });

  it("never throws when the lookup fails", async () => {
    const { notifier, repository, emailSender, logError } = setup();
    repository.findAgencyByIdWithOwner.mockRejectedValueOnce(new Error("db down"));

    await expect(notifier.agencyApproved("agency-1")).resolves.toBeUndefined();

    expect(emailSender.sendAgencyApprovedEmail).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("[agencyNotifications] agency lookup failed", expect.objectContaining({ agencyId: "agency-1" }));
  });

  it("sends nothing for an agency that no longer exists", async () => {
    const { notifier, emailSender } = setup({ agency: null });

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendAgencyApplicationReceivedEmail).not.toHaveBeenCalled();
    expect(emailSender.sendNewAgencyApplicationEmail).not.toHaveBeenCalled();
  });

  it("leaves the location out when the application has no city or country", async () => {
    const { notifier, emailSender } = setup({ agency: { ...agency, city: null as never, country: "  " } });

    await notifier.applicationSubmitted("agency-1");

    expect(emailSender.sendNewAgencyApplicationEmail).toHaveBeenCalledWith(expect.objectContaining({ location: null }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agencyNotifications.test.ts`
Expected: FAIL. Cannot find module `../src/modules/agencies/agencyNotifications`.

- [ ] **Step 3: Implement.** Create `src/modules/agencies/agencyNotifications.ts`:

```ts
import { env } from "../../config/env";
import {
  sendAgencyApplicationReceivedEmail,
  sendAgencyApprovedEmail,
  sendAgencyRejectedEmail,
  sendNewAgencyApplicationEmail
} from "../../services/email";
import type { AgencyRepository, AgencyWithOwner } from "./agencyTypes";

/**
 * Emails people about agency registration (capstone panel item 20).
 * Every method resolves: a failed lookup or send is logged, never thrown,
 * so it can't fail or undo the decision it reports.
 */
export type AgencyNotifier = {
  applicationSubmitted(agencyId: string): Promise<void>;
  agencyApproved(agencyId: string): Promise<void>;
  agencyRejected(agencyId: string): Promise<void>;
};

export const noopAgencyNotifier: AgencyNotifier = {
  async applicationSubmitted() {},
  async agencyApproved() {},
  async agencyRejected() {}
};

export type AgencyEmailSender = {
  sendAgencyApplicationReceivedEmail: typeof sendAgencyApplicationReceivedEmail;
  sendAgencyApprovedEmail: typeof sendAgencyApprovedEmail;
  sendAgencyRejectedEmail: typeof sendAgencyRejectedEmail;
  sendNewAgencyApplicationEmail: typeof sendNewAgencyApplicationEmail;
};

const defaultEmailSender: AgencyEmailSender = {
  sendAgencyApplicationReceivedEmail,
  sendAgencyApprovedEmail,
  sendAgencyRejectedEmail,
  sendNewAgencyApplicationEmail
};

type LogError = (message: string, details: Record<string, unknown>) => void;

export function createAgencyNotifier(options: {
  repository: Pick<AgencyRepository, "findAgencyByIdWithOwner" | "listActiveSuperAdmins">;
  emailSender?: AgencyEmailSender;
  appOrigin?: string;
  logError?: LogError;
}): AgencyNotifier {
  const emailSender = options.emailSender ?? defaultEmailSender;
  const origin = (options.appOrigin ?? env.APP_ORIGIN).replace(/\/+$/, "");
  const logError: LogError = options.logError ?? ((message, details) => console.error(message, details));
  // `/?authenticated=1` opens the signed-in app: the status screen while pending, the workspace once approved.
  const appUrl = `${origin}/?authenticated=1`;
  const adminUrl = `${origin}/?authenticated=1&tab=admin`;

  async function attempt<T>(step: string, agencyId: string, work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      logError(`[agencyNotifications] ${step} failed`, { agencyId, error });
      return null;
    }
  }

  function loadAgency(agencyId: string): Promise<AgencyWithOwner | null> {
    return attempt("agency lookup", agencyId, () => options.repository.findAgencyByIdWithOwner(agencyId));
  }

  return {
    async applicationSubmitted(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;

      await attempt("application received email", agencyId, () =>
        emailSender.sendAgencyApplicationReceivedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          statusUrl: appUrl
        })
      );

      const admins = (await attempt("super admin lookup", agencyId, () => options.repository.listActiveSuperAdmins())) ?? [];
      const location =
        [agency.city, agency.country].filter((part): part is string => Boolean(part?.trim())).join(", ") || null;
      await Promise.all(
        admins.map((admin) =>
          attempt("new application alert", agencyId, () =>
            emailSender.sendNewAgencyApplicationEmail({
              to: admin.email,
              agencyName: agency.name,
              ownerName: agency.ownerUser.displayName,
              ownerEmail: agency.ownerUser.email,
              location,
              reviewUrl: adminUrl
            })
          )
        )
      );
    },

    async agencyApproved(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;
      await attempt("approval email", agencyId, () =>
        emailSender.sendAgencyApprovedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          workspaceUrl: appUrl
        })
      );
    },

    async agencyRejected(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;
      await attempt("rejection email", agencyId, () =>
        emailSender.sendAgencyRejectedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          reason: agency.rejectionReason ?? "",
          statusUrl: appUrl
        })
      );
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run tests/agencyNotifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/agencies/agencyNotifications.ts tests/agencyNotifications.test.ts
git commit -m "feat(agencies): notifier for registration emails that never blocks a decision"
```

### Task 9: The agency service notifies after each saved decision

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyService.ts`: imports at line 1-4; `createAgencyService` signature at line 68; end of `createAgencyApplication` (~line 111); end of `approveAgency` and `rejectAgency`; the singleton at line 288.
- Test: `Voyage-Server/tests/agencyService.test.ts` (append)

- [ ] **Step 1: Write the failing tests.** In `tests/agencyService.test.ts`, change the first import to `import { describe, expect, it, vi } from "vitest";`, then append:

```ts
describe("registration notifications", () => {
  const application = {
    name: "Hillside Travel",
    businessPhone: "639001112222",
    businessEmail: "hello@hillside.test",
    country: "Philippines",
    city: "Baguio"
  };
  const admin = () => createUser({ id: "admin-1", role: "SUPER_ADMIN" });

  function createNotifiedService() {
    const repository = createMemoryAgencyRepository();
    const notifier = {
      applicationSubmitted: vi.fn(async (_agencyId: string) => {}),
      agencyApproved: vi.fn(async (_agencyId: string) => {}),
      agencyRejected: vi.fn(async (_agencyId: string) => {})
    };
    const service = createAgencyService({
      repository,
      now: () => new Date("2026-04-27T12:00:00.000Z"),
      notifier
    });
    return { service, repository, notifier };
  }

  it("announces a new application after it is saved", async () => {
    const { service, repository, notifier } = createNotifiedService();
    notifier.applicationSubmitted.mockImplementation(async (agencyId) => {
      expect(repository.memberships.some((membership) => membership.agencyId === agencyId)).toBe(true);
    });

    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), application);

    expect(notifier.applicationSubmitted).toHaveBeenCalledWith(agency.id);
  });

  it("announces an approval after it is saved", async () => {
    const { service, repository, notifier } = createNotifiedService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), application);
    let statusWhenNotified: string | undefined;
    notifier.agencyApproved.mockImplementation(async (agencyId) => {
      statusWhenNotified = repository.agencies.find((candidate) => candidate.id === agencyId)?.status;
    });

    await service.approveAgency(admin(), agency.id);

    expect(notifier.agencyApproved).toHaveBeenCalledWith(agency.id);
    expect(statusWhenNotified).toBe("VERIFIED");
  });

  it("announces a rejection after its reason is saved", async () => {
    const { service, repository, notifier } = createNotifiedService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), application);
    let reasonWhenNotified: string | null | undefined;
    notifier.agencyRejected.mockImplementation(async (agencyId) => {
      reasonWhenNotified = repository.agencies.find((candidate) => candidate.id === agencyId)?.rejectionReason;
    });

    await service.rejectAgency(admin(), agency.id, { reason: "Business permit missing" });

    expect(notifier.agencyRejected).toHaveBeenCalledWith(agency.id);
    expect(reasonWhenNotified).toBe("Business permit missing");
  });

  it("sends no registration email for a suspension", async () => {
    const { service, notifier } = createNotifiedService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), application);
    await service.approveAgency(admin(), agency.id);
    notifier.agencyApproved.mockClear();

    await service.suspendAgency(admin(), agency.id, { reason: "Chargebacks" });

    expect(notifier.agencyApproved).not.toHaveBeenCalled();
    expect(notifier.agencyRejected).not.toHaveBeenCalled();
  });

  it("still works with no notifier", async () => {
    const { service } = createService();
    const agency = await service.createAgencyApplication(createUser({ id: "owner-1" }), application);
    await expect(service.approveAgency(admin(), agency.id)).resolves.toMatchObject({ status: "VERIFIED" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agencyService.test.ts -t "registration notifications"`
Expected: FAIL. The notifier is never called.

- [ ] **Step 3: Implement.** In `agencyService.ts`:

Add after the `createPrismaAgencyRepository` import:

```ts
import { createAgencyNotifier, noopAgencyNotifier, type AgencyNotifier } from "./agencyNotifications";
```

Change the factory signature and add the notifier:

```ts
export function createAgencyService(options: { repository: AgencyRepository; now?: () => Date; notifier?: AgencyNotifier }) {
  const now = options.now ?? (() => new Date());
  // Emails about registration. Called only after the change is saved; it never throws.
  const notifier = options.notifier ?? noopAgencyNotifier;
```

In `createAgencyApplication`, just before `return agency;`:

```ts
      await notifier.applicationSubmitted(agency.id);
```

In `approveAgency`, just before `return agency;`:

```ts
      await notifier.agencyApproved(agencyId);
```

In `rejectAgency`, just before `return agency;`:

```ts
      await notifier.agencyRejected(agencyId);
```

Replace the singleton on the last line with:

```ts
const prismaAgencyRepository = createPrismaAgencyRepository();
export const agencyService = createAgencyService({
  repository: prismaAgencyRepository,
  notifier: createAgencyNotifier({ repository: prismaAgencyRepository })
});
```

- [ ] **Step 4: Run the tests and the build to verify they pass.**

Run: `npx vitest run tests/agencyService.test.ts tests/agencyNotifications.test.ts && npm run build`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/agencies/agencyService.ts tests/agencyService.test.ts
git commit -m "feat(agencies): email owners and admins about registration decisions"
```

### Task 10: Admin links open the Admin tab; others can't land on it

**Files:**
- Modify: `Voyage-Client/app/lib/deepLinks.js`
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx:455-459` (`currentTab`)
- Test: `Voyage-Client/tests/deep-links.test.js` (append)

- [ ] **Step 1: Write the failing tests.** Change the import in `tests/deep-links.test.js` to `import { resolveInitialView, resolveVisibleTab } from "../app/lib/deepLinks.js";` and append:

```js
describe("admin links", () => {
  it("opens the Admin tab for tab=admin (the new-agency alert email)", () => {
    expect(view("authenticated=1&tab=admin")).toEqual({ initialTab: "admin", showJoinedNotice: false, settingsSection: null });
  });
});

describe("resolveVisibleTab", () => {
  const admin = { role: "SUPER_ADMIN" };
  const member = { role: "USER" };

  it("shows the Admin tab to super admins only", () => {
    expect(resolveVisibleTab({ activeTab: "admin", user: admin, isPersonal: false, agencyId: "a1" })).toBe("admin");
    expect(resolveVisibleTab({ activeTab: "admin", user: member, isPersonal: false, agencyId: "a1" })).toBe("command-center");
  });

  it("sends users without an agency workspace from the dashboard to the Command Center", () => {
    expect(resolveVisibleTab({ activeTab: "dashboard", user: member, isPersonal: true, agencyId: null })).toBe("command-center");
    expect(resolveVisibleTab({ activeTab: "dashboard", user: member, isPersonal: false, agencyId: null })).toBe("command-center");
    expect(resolveVisibleTab({ activeTab: "dashboard", user: member, isPersonal: false, agencyId: "a1" })).toBe("dashboard");
  });

  it("keeps the requested tab until the user has loaded", () => {
    expect(resolveVisibleTab({ activeTab: "admin", user: null, isPersonal: false, agencyId: null })).toBe("admin");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/deep-links.test.js`
Expected: FAIL. `tab=admin` resolves to command-center, and `resolveVisibleTab` is not a function.

- [ ] **Step 3: Implement.** In `app/lib/deepLinks.js`, add a doc bullet ` * - \`tab=admin\` (new-agency alert email): the Admin tab, for super admins.` above the "anything else" line. Replace the body of `resolveInitialView` with:

```js
export function resolveInitialView(searchParams) {
  const tab = searchParams.get("tab");
  const invited = searchParams.get("invited") === "1";

  if (tab === "team" && invited) {
    return { initialTab: "dashboard", showJoinedNotice: true, settingsSection: null };
  }
  if (tab === "team") {
    return { initialTab: "settings", showJoinedNotice: false, settingsSection: "team" };
  }
  if (tab === "admin") {
    return { initialTab: "admin", showJoinedNotice: false, settingsSection: null };
  }
  return { initialTab: "command-center", showJoinedNotice: false, settingsSection: null };
}

/**
 * The tab the main area actually shows. Users without an agency workspace have
 * no dashboard, and only super admins have the Admin tab: anyone else who opens
 * an admin link lands on the Command Center instead of an empty page.
 */
export function resolveVisibleTab({ activeTab, user, isPersonal, agencyId }) {
  if (!user) return activeTab;
  if (activeTab === "dashboard" && (isPersonal || !agencyId)) return "command-center";
  if (activeTab === "admin" && user.role !== "SUPER_ADMIN") return "command-center";
  return activeTab;
}
```

In `HomePage.jsx`, add `import { resolveVisibleTab } from "../../lib/deepLinks.js";` with the other `../../lib` imports. Then replace

```jsx
  const currentTab = activeTab === "dashboard" && user && (isPersonal || !agencyId)
    ? "command-center"
    : activeTab;
```

with

```jsx
  const currentTab = resolveVisibleTab({ activeTab, user, isPersonal, agencyId });
```

Also update the comment above it: append " Only super admins see the Admin tab."

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/deep-links.test.js tests/page-handoff.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/lib/deepLinks.js app/components/trip-dashboard/HomePage.jsx tests/deep-links.test.js
git commit -m "feat(admin): admin links open the Admin tab for super admins only"
```

### Task 11: Report a problem can start prefilled

**Files:**
- Modify: `Voyage-Client/app/components/settings/ReportProblemModal.jsx:4-6`
- Test: `Voyage-Client/tests/report-problem-modal.test.jsx` (append)

- [ ] **Step 1: Write the failing test.** Append inside the `describe("ReportProblemModal", …)` block:

```jsx
  it("starts from the category and subject it is given", () => {
    render(
      <ReportProblemModal
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
        initialCategory="OTHER"
        initialSubject="Agency application: Hillside Travel"
      />,
    );
    expect(screen.getByLabelText(/category/i)).toHaveValue("OTHER");
    expect(screen.getByLabelText(/subject/i)).toHaveValue("Agency application: Hillside Travel");
  });
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/report-problem-modal.test.jsx`
Expected: FAIL. It shows "BUG" and an empty subject.

- [ ] **Step 3: Implement.** Change the top of the component to:

```jsx
export default function ReportProblemModal({ open, onClose, onSubmit, initialCategory = "BUG", initialSubject = "" }) {
  const [category, setCategory] = useState(initialCategory);
  const [subject, setSubject] = useState(initialSubject);
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run tests/report-problem-modal.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/settings/ReportProblemModal.jsx tests/report-problem-modal.test.jsx
git commit -m "feat(support): let Report a problem open with a category and subject"
```

### Task 12: Hook that re-reads the user while an agency waits

**Files:**
- Create: `Voyage-Client/app/hooks/useAgencyStatusPolling.js`
- Test: `Voyage-Client/tests/use-agency-status-polling.test.jsx` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/use-agency-status-polling.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../app/lib/api/index.js", () => api);

import useAgencyStatusPolling, { AGENCY_STATUS_POLL_MS } from "../app/hooks/useAgencyStatusPolling.js";

beforeEach(() => {
  vi.useFakeTimers();
  api.fetchApi.mockReset();
  api.fetchApi.mockResolvedValue({ user: { id: "user-1" } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgencyStatusPolling", () => {
  it("re-reads the user every 30 seconds while enabled", async () => {
    const onUser = vi.fn();
    renderHook(() => useAgencyStatusPolling({ enabled: true, onUser }));
    expect(api.fetchApi).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENCY_STATUS_POLL_MS);
    });

    expect(api.fetchApi).toHaveBeenCalledWith("/auth/me");
    expect(onUser).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("checks right away when the window regains focus", async () => {
    const onUser = vi.fn();
    renderHook(() => useAgencyStatusPolling({ enabled: true, onUser }));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.fetchApi).toHaveBeenCalledTimes(1);
    expect(onUser).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("does nothing while disabled", async () => {
    renderHook(() => useAgencyStatusPolling({ enabled: false, onUser: vi.fn() }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENCY_STATUS_POLL_MS * 3);
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.fetchApi).not.toHaveBeenCalled();
  });

  it("keeps polling after a failed read", async () => {
    api.fetchApi.mockRejectedValueOnce(new Error("offline"));
    const onUser = vi.fn();
    renderHook(() => useAgencyStatusPolling({ enabled: true, onUser }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENCY_STATUS_POLL_MS);
    });
    expect(onUser).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENCY_STATUS_POLL_MS);
    });
    expect(onUser).toHaveBeenCalledTimes(1);
  });

  it("stops when unmounted", async () => {
    const { unmount } = renderHook(() => useAgencyStatusPolling({ enabled: true, onUser: vi.fn() }));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENCY_STATUS_POLL_MS * 2);
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.fetchApi).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/use-agency-status-polling.test.jsx`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement.** Create `app/hooks/useAgencyStatusPolling.js`:

```js
"use client";

import { useEffect, useRef } from "react";
import { fetchApi } from "../lib/api/index.js";

export const AGENCY_STATUS_POLL_MS = 30_000;

/**
 * While an agency waits for review, re-reads the signed-in user every 30 seconds
 * and whenever the tab comes back into view, and hands the fresh user to `onUser`
 * (capstone panel item 20: the pending screen updates by itself). A failed read
 * is ignored; the next check tries again.
 */
export default function useAgencyStatusPolling({ enabled, onUser, intervalMs = AGENCY_STATUS_POLL_MS }) {
  const onUserRef = useRef(onUser);
  useEffect(() => {
    onUserRef.current = onUser;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let inFlight = false;

    async function check() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const data = await fetchApi("/auth/me");
        if (!cancelled && data?.user) onUserRef.current?.(data.user);
      } catch {
        // Network blip or an expired session: keep the current screen; the next check retries.
      } finally {
        inFlight = false;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") check();
    }

    const timer = setInterval(check, intervalMs);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, intervalMs]);
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run tests/use-agency-status-polling.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/hooks/useAgencyStatusPolling.js tests/use-agency-status-polling.test.jsx
git commit -m "feat(agency-status): hook that re-checks a pending agency's status"
```

### Task 13: Status screen promises the email and opens Report a problem

**Files:**
- Modify: `Voyage-Client/app/components/agency-status/AgencyStatusScreen.jsx`: imports (lines 1-3), state, description (lines 111-119), action button (lines 151-162), and the modal before the closing card `</div>`.
- Test: `Voyage-Client/tests/agency-status-screen.test.jsx` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/agency-status-screen.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const support = vi.hoisted(() => ({ createProblemReport: vi.fn() }));
vi.mock("../app/lib/api/support.js", () => support);
vi.mock("../app/components/theme/ThemeToggle", () => ({ default: () => null }));

import AgencyStatusScreen from "../app/components/agency-status/AgencyStatusScreen.jsx";

const user = { email: "owner@hillside.test" };
const agency = (overrides = {}) => ({ id: "agency-1", name: "Hillside Travel", status: "PENDING_REVIEW", ...overrides });

beforeEach(() => {
  support.createProblemReport.mockReset();
  support.createProblemReport.mockResolvedValue({});
});

describe("AgencyStatusScreen", () => {
  it("tells a pending owner where the email will go and that the page updates itself", () => {
    render(<AgencyStatusScreen agency={agency()} user={user} onLogout={vi.fn()} />);

    expect(screen.getByText("owner@hillside.test", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/this page updates by itself/i)).toBeInTheDocument();
  });

  it("opens Report a problem, prefilled for the application, instead of an email link", async () => {
    render(<AgencyStatusScreen agency={agency()} user={user} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(screen.getByLabelText(/subject/i)).toHaveValue("Agency application: Hillside Travel");
    fireEvent.change(screen.getByLabelText(/details/i), { target: { value: "Any update?" } });
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() =>
      expect(support.createProblemReport).toHaveBeenCalledWith(
        expect.objectContaining({ category: "OTHER", subject: "Agency application: Hillside Travel", message: "Any update?" }),
      ),
    );
    expect(await screen.findByText(/report sent/i)).toBeInTheDocument();
  });

  it("offers support, not a fake resubmit, to a rejected agency, and shows the reason", () => {
    render(
      <AgencyStatusScreen agency={agency({ status: "REJECTED", rejectionReason: "Business permit missing" })} user={user} onLogout={vi.fn()} />,
    );

    expect(screen.getByText(/Business permit missing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resubmit/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact support" })).toBeInTheDocument();
  });

  it("prefills a suspended agency's subject", () => {
    render(<AgencyStatusScreen agency={agency({ status: "SUSPENDED" })} user={user} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(screen.getByLabelText(/subject/i)).toHaveValue("Suspended agency: Hillside Travel");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/agency-status-screen.test.jsx`
Expected: FAIL. There is no "Contact support" button (the label is "Contact Support" or "Resubmit Application") and no email in the copy.

- [ ] **Step 3: Implement.** In `AgencyStatusScreen.jsx`:

Imports (replace line 3's single import block):

```jsx
import { useState } from "react";
import ThemeToggle from "../theme/ThemeToggle";
import ReportProblemModal from "../settings/ReportProblemModal.jsx";
import { createProblemReport } from "../../lib/api/support.js";
```

After the `reason` constant, add:

```jsx
  const [supportOpen, setSupportOpen] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const agencyLabel = agency.name || "my agency";
  const supportSubject = isSuspended ? `Suspended agency: ${agencyLabel}` : `Agency application: ${agencyLabel}`;
```

Replace the description block (the `<p className="text-text-muted text-base leading-relaxed mb-6">…</p>`) with:

```jsx
        {/* Description */}
        <p className="text-text-muted text-base leading-relaxed mb-6">
          {isPending && (
            <>
              We&apos;re reviewing your agency registration, usually within 1–2 business days. We&apos;ll email{" "}
              {user?.email ? <strong className="text-text-primary">{user.email}</strong> : "you"} when it&apos;s done, and
              this page updates by itself.
            </>
          )}
          {isRejected &&
            "Your agency registration wasn't approved. Check the reason below, then contact support if you'd like us to take another look."}
          {isSuspended &&
            "Your agency account has been suspended by an administrator. Contact support for help or to appeal this decision."}
        </p>
```

Replace the `{/* Action CTA */}` button with:

```jsx
        {/* Action CTA */}
        <button
          type="button"
          className="w-full py-3 rounded-pill font-bold text-sm bg-secondary text-white hover:opacity-90 transition-opacity mb-3"
          onClick={() => setSupportOpen(true)}
        >
          Contact support
        </button>
        {reportSent && (
          <p role="status" className="text-sm text-text-muted mb-3">
            Report sent. We&apos;ll reply by email.
          </p>
        )}
```

Just before the card's closing `</div>` (after the Sign out button), add:

```jsx
        <ReportProblemModal
          open={supportOpen}
          onClose={() => setSupportOpen(false)}
          onSubmit={async (payload) => {
            await createProblemReport(payload);
            setReportSent(true);
          }}
          initialCategory="OTHER"
          initialSubject={supportSubject}
        />
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/agency-status-screen.test.jsx tests/report-problem-modal.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/agency-status/AgencyStatusScreen.jsx tests/agency-status-screen.test.jsx
git commit -m "feat(agency-status): promise the decision email and contact support in-app"
```

### Task 14: The pending screen opens the app once approved

**Files:**
- Modify: `Voyage-Client/app/page.jsx`: imports (line 3, after line 10), and the hook call before the `if (agencyStatus && …)` early return (~line 139).
- Test: `Voyage-Client/tests/page-handoff.test.jsx` (append; add `screen` and `act` imports and a ThemeToggle mock)

- [ ] **Step 1: Write the failing test.** In `tests/page-handoff.test.jsx`:
- Change the imports at the top to `import { act, render, screen, waitFor } from "@testing-library/react";`. Remove the separate `waitFor` import line.
- Add next to the other `vi.mock` calls:

```jsx
vi.mock("../app/components/theme/ThemeToggle", () => ({
  default: () => null,
}));
```

Append:

```jsx
describe("agency review screen refresh", () => {
  beforeEach(() => {
    mockState.searchParamsAuthenticated = "1";
    mockState.prototypeState = landingPrototypeState();
  });

  it("leaves the review screen by itself once the agency is approved", async () => {
    const agency = { id: "agency-1", name: "Hillside Travel", status: "PENDING_REVIEW" };
    const pendingUser = { id: "user-1", email: "owner@hillside.test", accountType: "AGENCY_USER", memberships: [{ agency }] };
    const approvedUser = { ...pendingUser, memberships: [{ agency: { ...agency, status: "VERIFIED" } }] };
    mockState.fetchApi.mockResolvedValueOnce({ user: pendingUser }).mockResolvedValueOnce({ user: approvedUser });

    render(<Page />);
    expect(await screen.findByText("Application Under Review")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.queryByText("Application Under Review")).not.toBeInTheDocument());
    expect(mockState.fetchApi).toHaveBeenLastCalledWith("/auth/me");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/page-handoff.test.jsx -t "agency review screen refresh"`
Expected: FAIL. The review screen stays, because nothing re-reads `/auth/me`.

- [ ] **Step 3: Implement.** In `app/page.jsx`:
- Change `import { Suspense, useEffect, useState } from "react";` to `import { Suspense, useCallback, useEffect, useState } from "react";`.
- Add `import useAgencyStatusPolling from "./hooks/useAgencyStatusPolling.js";` after the `deepLinks` import.

Just above `// Show agency status screen for non-verified agencies`, add:

```jsx
  // While the agency waits (or is rejected/suspended), re-read the user so an
  // approval opens the app without a manual refresh.
  const handlePolledUser = useCallback((freshUser) => {
    localStorage.setItem("voyage-user", JSON.stringify(freshUser));
    setUser(freshUser);
    const agency = freshUser?.memberships?.[0]?.agency;
    if (agency) setAgencyStatus(agency);
  }, []);
  useAgencyStatusPolling({
    enabled: Boolean(agencyStatus) && agencyStatus.status !== "VERIFIED",
    onUser: handlePolledUser,
  });
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/page-handoff.test.jsx tests/use-agency-status-polling.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/page.jsx tests/page-handoff.test.jsx
git commit -m "feat(agency-status): open the workspace as soon as the agency is approved"
```

---

# Part 3: Branded timeline PDF (item 7)

### Task 15: Image loader for the PDF

**Files:**
- Create: `Voyage-Client/app/lib/pdfImages.js`
- Test: `Voyage-Client/tests/pdf-images.test.js` (new)

- [ ] **Step 1: Write the failing tests.** Create `tests/pdf-images.test.js`:

```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPdfImage, loadPdfImages, pdfPhotoUrl } from "../app/lib/pdfImages.js";

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
});

/** Fakes the browser pieces jsdom lacks: fetch, createImageBitmap and a 2D canvas. */
function fakeBrowser({ bitmapWidth = 800, bitmapHeight = 400, ok = true } = {}) {
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const bitmap = { width: bitmapWidth, height: bitmapHeight, close: vi.fn() };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, blob: async () => new Blob(["img"]) })));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context);
  HTMLCanvasElement.prototype.toDataURL = vi.fn((type) => `data:${type};base64,AAAA`);
  return { context, bitmap };
}

describe("pdfPhotoUrl", () => {
  it("asks Cloudinary for a small JPEG", () => {
    expect(pdfPhotoUrl("https://res.cloudinary.com/demo/image/upload/v17/places/burnham.png")).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_320,h_240,q_auto,f_jpg/v17/places/burnham.png",
    );
  });

  it("leaves other URLs alone", () => {
    expect(pdfPhotoUrl("https://example.com/photo.jpg")).toBe("https://example.com/photo.jpg");
  });
});

describe("loadPdfImage", () => {
  it("returns null without a URL", async () => {
    await expect(loadPdfImage("")).resolves.toBeNull();
  });

  it("returns null when the browser can't decode images", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(loadPdfImage("https://example.com/a.jpg")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the download fails", async () => {
    fakeBrowser({ ok: false });
    await expect(loadPdfImage("https://example.com/a.jpg")).resolves.toBeNull();
  });

  it("crops a photo to cover the frame and returns a JPEG", async () => {
    const { context, bitmap } = fakeBrowser({ bitmapWidth: 800, bitmapHeight: 400 });

    const image = await loadPdfImage("https://example.com/a.jpg", { width: 320, height: 240, fit: "cover", format: "jpeg" });

    expect(image).toEqual({ dataUrl: "data:image/jpeg;base64,AAAA", width: 320, height: 240, format: "JPEG" });
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = context.drawImage.mock.calls[0];
    expect(sw).toBeCloseTo(533.33, 1);
    expect(sx).toBeCloseTo(133.33, 1);
    expect([sy, sh, dx, dy, dw, dh]).toEqual([0, 400, 0, 0, 320, 240]);
    expect(context.fillRect).toHaveBeenCalled(); // white under the JPEG
    expect(bitmap.close).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("https://example.com/a.jpg", expect.objectContaining({ mode: "cors", credentials: "omit" }));
  });

  it("fits a logo inside the frame without upscaling and keeps PNG transparency", async () => {
    const { context } = fakeBrowser({ bitmapWidth: 480, bitmapHeight: 157 });

    const image = await loadPdfImage("/email/voyage-logo.png", { width: 600, height: 200, fit: "contain", format: "png" });

    expect(image).toEqual({ dataUrl: "data:image/png;base64,AAAA", width: 480, height: 157, format: "PNG" });
    expect(context.fillRect).not.toHaveBeenCalled();
  });
});

describe("loadPdfImages", () => {
  it("loads each distinct URL once and maps failures to null", async () => {
    const load = vi.fn(async (url) => (url.includes("bad") ? null : { dataUrl: url }));

    const images = await loadPdfImages(["a.jpg", "bad.jpg", "a.jpg", "", null], { load, options: { fit: "cover" } });

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith("a.jpg", { fit: "cover" });
    expect(images.get("a.jpg")).toEqual({ dataUrl: "a.jpg" });
    expect(images.get("bad.jpg")).toBeNull();
  });

  it("never runs more loads at once than the limit", async () => {
    let running = 0;
    let peak = 0;
    const load = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return null;
    });

    await loadPdfImages(Array.from({ length: 10 }, (_, index) => `${index}.jpg`), { load, concurrency: 3 });

    expect(load).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run tests/pdf-images.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement.** Create `app/lib/pdfImages.js`:

```js
/**
 * Images for the itinerary PDF (capstone panel item 7). jsPDF needs image data,
 * not URLs, so each image is downloaded, cropped or fitted on a canvas and
 * returned as a data URL. Any failure (CORS, 404, timeout, no canvas) gives
 * null, and the PDF prints that spot without an image.
 */

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/** Asks Cloudinary for a 320×240 JPEG instead of the full upload; other URLs pass through. */
export function pdfPhotoUrl(url) {
  const match = CLOUDINARY_UPLOAD.exec(String(url ?? ""));
  if (!match) return url;
  return `${match[1]}c_fill,w_320,h_240,q_auto,f_jpg/${match[2]}`;
}

/**
 * Draws `bitmap` into `canvas`. "cover" crops to the frame's shape; "contain"
 * fits inside the frame without upscaling. JPEGs get a white background so
 * transparent pixels don't turn black.
 */
function drawToCanvas(canvas, bitmap, { width, height, fit, format }) {
  const context = canvas.getContext("2d");
  if (!context) return null;

  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  let dw = width;
  let dh = height;
  if (fit === "cover") {
    const frameRatio = width / height;
    if (sw / sh > frameRatio) {
      sw = sh * frameRatio;
      sx = (bitmap.width - sw) / 2;
    } else {
      sh = sw / frameRatio;
      sy = (bitmap.height - sh) / 2;
    }
  } else {
    const scale = Math.min(width / sw, height / sh, 1);
    dw = Math.max(1, Math.round(sw * scale));
    dh = Math.max(1, Math.round(sh * scale));
  }

  canvas.width = dw;
  canvas.height = dh;
  const isPng = format === "png";
  if (!isPng) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, dw, dh);
  }
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh);
  return {
    dataUrl: canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.82),
    width: dw,
    height: dh,
    format: isPng ? "PNG" : "JPEG",
  };
}

/**
 * @param {string} url
 * @param {{ width?: number, height?: number, fit?: "cover"|"contain", format?: "jpeg"|"png", timeoutMs?: number }} [options]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, format: "JPEG"|"PNG" } | null>}
 */
export async function loadPdfImage(url, { width = 320, height = 240, fit = "cover", format = "jpeg", timeoutMs = 6000 } = {}) {
  if (!url || typeof fetch !== "function" || typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return null;
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller?.signal });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      return drawToCanvas(document.createElement("canvas"), bitmap, { width, height, fit, format });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads each distinct URL once, at most `concurrency` at a time.
 * @returns {Promise<Map<string, object|null>>}
 */
export async function loadPdfImages(urls, { load = loadPdfImage, concurrency = 6, options = {} } = {}) {
  const unique = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))];
  const results = new Map();
  let next = 0;

  async function worker() {
    while (next < unique.length) {
      const url = unique[next];
      next += 1;
      results.set(url, await load(url, options));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run tests/pdf-images.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/lib/pdfImages.js tests/pdf-images.test.js
git commit -m "feat(pdf): load small photos and logos for the itinerary PDF"
```

### Task 16: Branded timeline layout

**Files:**
- Rewrite: `Voyage-Client/app/lib/pdfExport.js`
- Test: `Voyage-Client/tests/pdf-layout.test.js` (new)
- Update fakes: `tests/pdf-weather.test.js`, `tests/pdf-accessibility.test.js`, `tests/pdf-place-status.test.js`. Each `FakeDoc` gets `setPage() {}`, and one wording change in `pdf-weather`.

- [ ] **Step 1: Write the failing tests.** Create `tests/pdf-layout.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { instance: null };

class FakeDoc {
  constructor() {
    this.entries = [];
    this.images = [];
    this.pages = 1;
    this.currentPage = 1;
    this.internal = {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
      getNumberOfPages: () => this.pages,
    };
  }
  setFontSize() {}
  setFont() {}
  setTextColor() {}
  setFillColor() {}
  setDrawColor() {}
  setLineWidth() {}
  circle() {}
  line() {}
  rect() {}
  roundedRect() {}
  addImage(dataUrl, format, x, y, width, height) {
    this.images.push({ dataUrl, format, x, y, width, height, page: this.currentPage });
  }
  addPage() {
    this.pages += 1;
    this.currentPage = this.pages;
  }
  setPage(page) {
    this.currentPage = page;
  }
  splitTextToSize(text, width) {
    const value = String(text ?? "");
    if (!value) return [];
    const perLine = Math.max(1, Math.floor(width / 2.2));
    const lines = [];
    for (let index = 0; index < value.length; index += perLine) lines.push(value.slice(index, index + perLine));
    return lines;
  }
  text(value, x, y) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      this.entries.push({ text: String(entry), x, y, page: this.currentPage });
    }
  }
  output() {
    return "blob";
  }
}

class FakeJsPDF {
  constructor() {
    const doc = new FakeDoc();
    state.instance = doc;
    return doc;
  }
}

vi.mock("jspdf", () => ({ jsPDF: FakeJsPDF, default: FakeJsPDF }));

const texts = () => state.instance.entries.map((entry) => entry.text);
const photo = (name) => ({ dataUrl: `data:image/jpeg;base64,${name}`, width: 320, height: 240, format: "JPEG" });
const voyageLogo = { dataUrl: "data:image/png;base64,voyage", width: 480, height: 157, format: "PNG" };
const CLOUDINARY = "https://res.cloudinary.com/demo/image/upload/v1/places/burnham.jpg";
const CLOUDINARY_SMALL = "https://res.cloudinary.com/demo/image/upload/c_fill,w_320,h_240,q_auto,f_jpg/v1/places/burnham.jpg";

/** A loadImages stand-in: answers from `images`, records what was asked. */
function recordingLoader(images = {}) {
  const calls = [];
  const loadImages = async (urls, options) => {
    calls.push({ urls, options });
    return new Map(urls.map((url) => [url, images[url] ?? null]));
  };
  return { loadImages, calls };
}

function stop(overrides = {}) {
  return {
    id: "s1",
    title: "Burnham Park",
    startTime: "09:00",
    endTime: "10:30",
    placeSnapshot: { name: "Burnham Park", formattedAddress: "Baguio" },
    ...overrides,
  };
}

function day(overrides = {}) {
  return { id: "d1", dayNumber: 1, title: "Arrival", date: null, summary: "", items: [stop()], ...overrides };
}

let generateItineraryPdf;

beforeEach(async () => {
  state.instance = null;
  vi.resetModules();
  ({ generateItineraryPdf } = await import("../app/lib/pdfExport.js"));
});

describe("itinerary PDF: branded timeline", () => {
  it("prints who the trip is for next to the dates and travelers", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({
      title: "Baguio getaway",
      dateRange: "Oct 8 – Oct 10",
      travelerCount: 4,
      clientName: "Reyes family",
      days: [day()],
      loadImages,
    });

    expect(texts()).toContain("Oct 8 – Oct 10   •   4 travelers   •   Prepared for Reyes family");
  });

  it("puts the date and the day's plan in the day bar", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({ title: "Trip", days: [day({ date: "2026-10-08" })], loadImages });

    expect(texts()).toContain("Day 1  ·  Thu, Oct 8, 2026  —  Arrival");
  });

  it("adds an at-a-glance table for trips longer than a day", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({
      title: "Trip",
      days: [
        day({ items: [stop(), stop({ id: "s2" })] }),
        day({ id: "d2", dayNumber: 2, title: "Old town", date: "2026-10-09", items: [stop({ id: "s3" })] }),
      ],
      loadImages,
    });

    const printed = texts();
    expect(printed).toContain("At a glance");
    expect(printed).toContain("Oct 9");
    expect(printed).toContain("Old town");
    expect(printed.indexOf("At a glance")).toBeLessThan(printed.indexOf("Day 1  —  Arrival"));
    expect(printed).not.toContain("Weather");
  });

  it("skips the table for a one-day trip", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({ title: "Trip", days: [day()], loadImages });

    expect(texts()).not.toContain("At a glance");
  });

  it("adds a weather column when a day has weather", async () => {
    const { loadImages } = recordingLoader();
    const weatherEntry = {
      status: "OK",
      weather: { kind: "FORECAST", condition: "RAIN", temperatureMinC: 16.2, temperatureMaxC: 23.4, precipitationProbabilityPct: 85 },
    };
    await generateItineraryPdf({ title: "Trip", days: [day({ weatherEntry }), day({ id: "d2", dayNumber: 2 })], loadImages });

    expect(texts()).toContain("Weather");
    expect(texts().some((text) => text.startsWith("16–23°C"))).toBe(true);
  });

  it("numbers every page as N of M and brands each footer", async () => {
    const { loadImages } = recordingLoader();
    const days = Array.from({ length: 6 }, (_, index) =>
      day({ id: `d${index + 1}`, dayNumber: index + 1, items: Array.from({ length: 5 }, (_, s) => stop({ id: `s${index}-${s}` })) }),
    );
    await generateItineraryPdf({ title: "Trip", agencyName: "Island Hops Travel", days, loadImages });

    const pages = state.instance.pages;
    expect(pages).toBeGreaterThan(1);
    for (let page = 1; page <= pages; page += 1) {
      const onPage = state.instance.entries.filter((entry) => entry.page === page).map((entry) => entry.text);
      expect(onPage).toContain(`Page ${page} of ${pages}`);
      expect(onPage).toContain("Island Hops Travel  ·  Planned with Voyage");
    }
  });

  it("prints each stop's photo beside it, from a small Cloudinary copy", async () => {
    const { loadImages, calls } = recordingLoader({ [CLOUDINARY_SMALL]: photo("burnham") });
    await generateItineraryPdf({
      title: "Trip",
      days: [day({ items: [stop({ placeSnapshot: { name: "Burnham Park", metadata: { primaryPhotoUrl: CLOUDINARY } } })] })],
      loadImages,
    });

    expect(calls[1]).toEqual({ urls: [CLOUDINARY_SMALL], options: expect.objectContaining({ fit: "cover", format: "jpeg" }) });
    const drawn = state.instance.images.find((image) => image.dataUrl === "data:image/jpeg;base64,burnham");
    expect(drawn).toMatchObject({ format: "JPEG", width: 26, height: 19.5 });
    expect(drawn.x).toBe(210 - 20 - 26);
  });

  it("prints the stop without a photo when the photo can't load", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({
      title: "Trip",
      days: [day({ items: [stop({ placeSnapshot: { name: "Burnham Park", metadata: { primaryPhotoUrl: CLOUDINARY } } })] })],
      loadImages,
    });

    expect(state.instance.images.filter((image) => image.format === "JPEG")).toHaveLength(0);
    expect(texts()).toContain("Burnham Park");
  });

  it("uses the Voyage wordmark for a Voyage-branded PDF", async () => {
    const { loadImages, calls } = recordingLoader({ "/email/voyage-logo.png": voyageLogo });
    await generateItineraryPdf({ title: "Trip", agencyName: "Voyage", days: [day()], loadImages });

    expect(calls[0].urls).toEqual(["/email/voyage-logo.png"]);
    expect(state.instance.images.some((image) => image.dataUrl === voyageLogo.dataUrl)).toBe(true);
    expect(texts()).not.toContain("VOYAGE");
  });

  it("falls back to the Voyage name when the wordmark can't load", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({ title: "Trip", days: [day()], loadImages });

    expect(texts()).toContain("VOYAGE");
  });

  it("uses an agency's own logo and name when it has a logo", async () => {
    const logoUrl = "https://cdn.example.com/hillside.png";
    const { loadImages, calls } = recordingLoader({ [logoUrl]: { ...voyageLogo, dataUrl: "data:image/png;base64,hillside" } });
    await generateItineraryPdf({ title: "Trip", agencyName: "Island Hops Travel", logoUrl, days: [day()], loadImages });

    expect(calls[0].urls).toEqual([logoUrl]);
    expect(state.instance.images.some((image) => image.dataUrl === "data:image/png;base64,hillside")).toBe(true);
    expect(texts()).toContain("ISLAND HOPS TRAVEL");
  });

  it("prints an agency's name with no logo request when it has no logo", async () => {
    const { loadImages, calls } = recordingLoader();
    await generateItineraryPdf({ title: "Trip", agencyName: "Island Hops Travel", days: [day()], loadImages });

    expect(calls[0].urls).toEqual([]);
    expect(texts()).toContain("ISLAND HOPS TRAVEL");
  });

  it("doesn't repeat the place name when it matches the stop's title", async () => {
    const { loadImages } = recordingLoader();
    await generateItineraryPdf({
      title: "Trip",
      days: [day({ items: [stop(), stop({ id: "s2", title: "Lunch", placeSnapshot: { name: "Bayview", formattedAddress: "1 Bay St" } })] })],
      loadImages,
    });

    expect(texts().filter((text) => text === "Burnham Park")).toHaveLength(1);
    expect(texts()).toContain("Lunch");
    expect(texts()).toContain("Bayview");
  });
});
```

Update the existing fakes so the new exporter can number pages. In each of `tests/pdf-weather.test.js`, `tests/pdf-accessibility.test.js` and `tests/pdf-place-status.test.js`, add this method to `class FakeDoc`, next to `addPage()`:

```js
  setPage() {}
```

In `tests/pdf-weather.test.js`, the last test ("prints the timed forecast and each stop's weather…"): the stop's weather now has its own line under the title instead of following the time. Replace its expectation

```js
    expect(printed).toContain("2:00 PM – 4:30 PM  ·  Storms likely (up to 99% chance of rain)");
```

with

```js
    expect(printed).toContain("2:00 PM – 4:30 PM");
    expect(printed).toContain("Storms likely (up to 99% chance of rain)");
    expect(printed).not.toContain("4:30 PM  ·  Storms");
```

Also rename that test to `"prints the timed forecast and each stop's weather under its title"`.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/pdf-layout.test.js tests/pdf-weather.test.js`
Expected: FAIL. There is no "Prepared for", no "At a glance", no "Page 1 of N", and `loadImages` is ignored.

- [ ] **Step 3: Implement.** Replace `app/lib/pdfExport.js` with:

```js
import jsPDF from "jspdf";
import { describeDayWeather, describeStopWeather } from "./weather/weatherDisplay.js";
import { getAccessibilityBadges, getAccessibilityPdfText } from "./accessibility/placeAccessibility.js";
import { getSnapshotPhotoUrl } from "./trip-dashboard/richItinerary.js";
import { loadPdfImages, pdfPhotoUrl } from "./pdfImages.js";

/** Voyage's wordmark: the file the emails use, so the PDF and the inbox match. */
export const VOYAGE_LOGO_PATH = "/email/voyage-logo.png";

// Brand colours (docs/brand/logo/kit/GUIDELINES.md) as jsPDF RGB triples.
const NAVY = [34, 56, 67];
const TERRACOTTA = [215, 122, 97];
const MUTED = [90, 110, 120];
const SOFT = [140, 155, 165];
const WEATHER_BLUE = [70, 110, 140];
const HAIRLINE = [220, 228, 232];
const WHITE = [255, 255, 255];
const CLOSURE_AMBER = [146, 64, 14];

// Layout in mm on A4 portrait (210 × 297).
const MARGIN = 20;
const CONTENT_BOTTOM_GAP = 28; // content stops 28mm above the edge; the footer sits below it
const TIME_COLUMN_WIDTH = 22;
const STOP_TEXT_OFFSET = 26; // a stop's text starts this far right of the margin
const PHOTO_WIDTH = 26;
const PHOTO_HEIGHT = 19.5;
const PHOTO_GAP = 4;
const LOGO_HEIGHT = 9;
const LOGO_MAX_WIDTH = 45;
const STOP_GAP = 5;

/**
 * Provider-only closure text for an exported document. Agency overlays are
 * deliberately not consulted here: an export is a client-facing artifact.
 */
function getProviderClosureLabel(businessStatus) {
  if (businessStatus === "CLOSED_PERMANENTLY") return "Permanently closed";
  if (businessStatus === "CLOSED_TEMPORARILY") return "Temporarily closed";
  return "";
}

// Same status logic as the on-screen badges: a caution is amber (matching the closure line),
// an unchecked-in-practice place is neutral grey, confirmed features are green.
const PDF_ACCESSIBILITY_COLORS = { warning: [146, 64, 14], unverified: [130, 150, 160], positive: [21, 94, 67] };

function getAccessibilityPdfColor(snapshot) {
  const badges = getAccessibilityBadges(snapshot);
  if (badges.some((badge) => badge.tone === "warning")) return PDF_ACCESSIBILITY_COLORS.warning;
  if (badges.length > 0 && badges.every((badge) => badge.key === "unverified")) return PDF_ACCESSIBILITY_COLORS.unverified;
  return PDF_ACCESSIBILITY_COLORS.positive;
}

function isVoyageBrand(agencyName) {
  const name = String(agencyName ?? "").trim();
  return name === "" || name === "Voyage";
}

function stopPhotoUrl(item) {
  const url = getSnapshotPhotoUrl(item?.placeSnapshot);
  return url ? pdfPhotoUrl(url) : "";
}

function defaultLoadImages(urls, options) {
  return loadPdfImages(urls, { options });
}

/**
 * Generates the branded itinerary PDF (capstone panel item 7, layout A).
 * @param {Object} params
 * @param {string} params.title          - Trip title
 * @param {string} [params.summary]      - Itinerary summary paragraph
 * @param {string} [params.dateRange]    - Formatted date range string
 * @param {number} [params.travelerCount]
 * @param {Array}  params.days           - Day objects ({ dayNumber, title, date, summary, items, weatherEntry })
 * @param {string} [params.agencyName]   - Brand; empty or "Voyage" means Voyage's own brand
 * @param {string} [params.clientName]   - Printed as "Prepared for …"
 * @param {string} [params.logoUrl]      - The agency's logo; without one an agency prints its name only
 * @param {Function} [params.loadImages] - (urls, options) => Promise<Map<url, image|null>>; tests inject one
 * @returns {Promise<jsPDF>} The document; the caller saves or prints it
 */
export async function generateItineraryPdf({
  title,
  summary,
  dateRange,
  travelerCount,
  days,
  agencyName,
  clientName,
  logoUrl,
  loadImages = defaultLoadImages,
}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210
  const pageHeight = doc.internal.pageSize.getHeight(); // 297
  const contentWidth = pageWidth - MARGIN * 2; // 170
  const voyageBrand = isVoyageBrand(agencyName);
  const brandName = voyageBrand ? "Voyage" : String(agencyName).trim();
  const safeDays = Array.isArray(days) ? days : [];
  const itemsOf = (day) => (Array.isArray(day?.items) ? day.items : []);

  // Images load before drawing; any that fail come back null and print as nothing.
  const logoSource = logoUrl || (voyageBrand ? VOYAGE_LOGO_PATH : "");
  const [logos, photos] = await Promise.all([
    loadImages(logoSource ? [logoSource] : [], { width: 600, height: 200, fit: "contain", format: "png" }),
    loadImages(
      safeDays.flatMap((day) => itemsOf(day).map(stopPhotoUrl)).filter(Boolean),
      { width: 320, height: 240, fit: "cover", format: "jpeg" },
    ),
  ]);
  const logo = logoSource ? logos.get(logoSource) ?? null : null;

  let y = MARGIN;

  /* ── helpers ──────────────────────────────────────────────── */

  function checkPageBreak(needed) {
    if (y + needed > pageHeight - CONTENT_BOTTOM_GAP) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function setStyle(fontSize, fontStyle, color) {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(...color);
  }

  // splitTextToSize measures at the current font, so every measurement sets the font it is drawn in.
  function measure(text, fontSize, fontStyle, width) {
    const value = String(text ?? "");
    if (!value) return [];
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", fontStyle);
    return doc.splitTextToSize(value, width);
  }

  function oneLine(text, fontSize, fontStyle, width) {
    const lines = measure(text, fontSize, fontStyle, width);
    if (lines.length <= 1) return lines[0] ?? "";
    return `${String(lines[0]).trimEnd()}…`;
  }

  function drawRule(color) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
  }

  function writeWrapped(text, fontSize, fontStyle, color, lineHeightMm, extraBottom = 0) {
    const lines = measure(text, fontSize, fontStyle, contentWidth);
    const blockHeight = lines.length * lineHeightMm + extraBottom;
    checkPageBreak(blockHeight);
    setStyle(fontSize, fontStyle, color);
    doc.text(lines, MARGIN, y);
    y += blockHeight;
  }

  /* ── At a glance: one row per day ─────────────────────────── */

  function drawAtAGlance() {
    const weatherByDay = safeDays.map((day) => describeDayWeather(day?.weatherEntry));
    const showWeather = weatherByDay.some(Boolean);
    // Column x offsets from the margin.
    const cols = showWeather
      ? { day: 0, date: 12, plan: 34, stops: 104, weather: 120 }
      : { day: 0, date: 12, plan: 34, stops: 150 };
    const planWidth = cols.stops - cols.plan - 4;
    const weatherWidth = showWeather ? contentWidth - cols.weather : 0;

    checkPageBreak(12 + 5.5 * Math.min(safeDays.length, 3));
    setStyle(11, "bold", NAVY);
    doc.text("At a glance", MARGIN, y);
    y += 6;

    setStyle(8, "bold", SOFT);
    doc.text("Day", MARGIN + cols.day, y);
    doc.text("Date", MARGIN + cols.date, y);
    doc.text("Plan", MARGIN + cols.plan, y);
    doc.text("Stops", MARGIN + cols.stops, y);
    if (showWeather) doc.text("Weather", MARGIN + cols.weather, y);
    y += 2;
    drawRule(HAIRLINE);
    y += 4.5;

    safeDays.forEach((day, index) => {
      checkPageBreak(5.5);
      const plan = oneLine(day?.title, 8.5, "normal", planWidth);
      const weatherCell = showWeather && weatherByDay[index]
        ? oneLine(weatherByDay[index].compactText || weatherByDay[index].label, 8.5, "normal", weatherWidth)
        : "";
      const shortDate = formatShortDate(day?.date);

      setStyle(8.5, "bold", NAVY);
      doc.text(String(day?.dayNumber || index + 1), MARGIN + cols.day, y);
      setStyle(8.5, "normal", MUTED);
      if (shortDate) doc.text(shortDate, MARGIN + cols.date, y);
      if (plan) doc.text(plan, MARGIN + cols.plan, y);
      doc.text(String(itemsOf(day).length), MARGIN + cols.stops, y);
      if (weatherCell) doc.text(weatherCell, MARGIN + cols.weather, y);
      y += 5.5;
    });
  }

  /* ── One stop: time column, text, photo on the right ───────── */

  function drawStop(day, item) {
    const snapshot = item?.placeSnapshot;
    const timeLabel = buildTimeLabel(item);
    // The stop's weather only exists when the day has hourly timing for its time slot.
    const stopWeather = timeLabel ? describeStopWeather(day?.weatherEntry, item?.id)?.pdfText ?? "" : "";
    const photo = photos.get(stopPhotoUrl(item)) ?? null;
    const textX = MARGIN + STOP_TEXT_OFFSET;
    const textWidth = contentWidth - STOP_TEXT_OFFSET - (photo ? PHOTO_WIDTH + PHOTO_GAP : 0);
    const title = item?.title || "Activity";
    const placeName = snapshot?.name && snapshot.name !== title ? snapshot.name : "";

    const timeLines = measure(timeLabel, 8.5, "normal", TIME_COLUMN_WIDTH);
    const titleLines = measure(title, 10.5, "bold", textWidth);
    const weatherLines = measure(stopWeather, 8.5, "normal", textWidth);
    const descLines = measure(item?.description, 9.5, "normal", textWidth);
    const placeLines = measure(placeName, 9, "bold", textWidth);
    const addrLines = measure(snapshot?.formattedAddress, 8.5, "normal", textWidth);
    // Provider closure only. Staff notes and agency overlays are internal and
    // must never reach an exported client document.
    const closureLines = measure(getProviderClosureLabel(snapshot?.businessStatus), 8.5, "bold", textWidth);
    // Public provider data only. The traveler's own needs never reach an export.
    const accessibilityLines = measure(getAccessibilityPdfText(snapshot), 8.5, "normal", textWidth);

    const textHeight =
      titleLines.length * 5.5 +
      (weatherLines.length ? weatherLines.length * 4 + 1 : 0) +
      (descLines.length ? descLines.length * 4.5 + 1 : 0) +
      placeLines.length * 4.5 +
      (addrLines.length ? addrLines.length * 4 + 1 : 0) +
      (closureLines.length ? closureLines.length * 4 + 1 : 0) +
      (accessibilityLines.length ? accessibilityLines.length * 4 + 1 : 0);
    const blockHeight = Math.max(textHeight, timeLines.length * 4, photo ? PHOTO_HEIGHT + 1 : 0);
    // Every line is counted BEFORE the page-break check: a line drawn but not
    // measured is exactly how an item overflows the bottom of a page.
    checkPageBreak(blockHeight + STOP_GAP);

    const top = y;
    if (timeLines.length > 0) {
      setStyle(8.5, "normal", SOFT);
      doc.text(timeLines, MARGIN, top);
    }
    doc.setFillColor(...TERRACOTTA);
    doc.circle(textX - 3, top - 1.4, 1.1, "F");
    if (photo) {
      doc.addImage(photo.dataUrl, photo.format, pageWidth - MARGIN - PHOTO_WIDTH, top - 3.5, PHOTO_WIDTH, PHOTO_HEIGHT);
    }

    setStyle(10.5, "bold", NAVY);
    doc.text(titleLines, textX, y);
    y += titleLines.length * 5.5;

    if (weatherLines.length > 0) {
      setStyle(8.5, "normal", WEATHER_BLUE);
      doc.text(weatherLines, textX, y);
      y += weatherLines.length * 4 + 1;
    }
    if (descLines.length > 0) {
      setStyle(9.5, "normal", [70, 90, 100]);
      doc.text(descLines, textX, y);
      y += descLines.length * 4.5 + 1;
    }
    if (placeLines.length > 0) {
      setStyle(9, "bold", [100, 120, 130]);
      doc.text(placeLines, textX, y);
      y += placeLines.length * 4.5;
    }
    if (addrLines.length > 0) {
      setStyle(8.5, "normal", SOFT);
      doc.text(addrLines, textX, y);
      y += addrLines.length * 4 + 1;
    }
    if (closureLines.length > 0) {
      setStyle(8.5, "bold", CLOSURE_AMBER);
      doc.text(closureLines, textX, y);
      y += closureLines.length * 4 + 1;
    }
    if (accessibilityLines.length > 0) {
      setStyle(8.5, "normal", getAccessibilityPdfColor(snapshot));
      doc.text(accessibilityLines, textX, y);
      y += accessibilityLines.length * 4 + 1;
    }

    y = Math.max(y, top + blockHeight) + STOP_GAP;
  }

  /* ── Page 1 header ────────────────────────────────────────── */

  // Brand row: the logo, then the agency's name. The Voyage wordmark already reads "Voyage".
  let brandX = MARGIN;
  if (logo) {
    const logoWidth = Math.min(LOGO_MAX_WIDTH, (LOGO_HEIGHT * logo.width) / logo.height);
    doc.addImage(logo.dataUrl, logo.format, MARGIN, y - 6, logoWidth, LOGO_HEIGHT);
    brandX += logoWidth + 4;
  }
  if (!(voyageBrand && logo)) {
    setStyle(10, "bold", TERRACOTTA);
    doc.text(brandName.toUpperCase(), brandX, y);
  }
  y += logo ? 12 : 7;

  // Trip title
  const titleLines = measure(title || "Itinerary", 26, "bold", contentWidth);
  setStyle(26, "bold", NAVY);
  doc.text(titleLines, MARGIN, y);
  y += titleLines.length * 10 + 4;

  // Thin accent line under title
  doc.setDrawColor(...TERRACOTTA);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, MARGIN + 40, y);
  doc.setLineWidth(0.2);
  y += 8;

  // Meta row: dates, travelers and who the trip is for
  const metaParts = [];
  if (dateRange) metaParts.push(dateRange);
  if (travelerCount) metaParts.push(`${travelerCount} ${travelerCount === 1 ? "traveler" : "travelers"}`);
  const client = String(clientName ?? "").trim();
  if (client) metaParts.push(`Prepared for ${client}`);
  if (metaParts.length > 0) {
    const metaLines = measure(metaParts.join("   •   "), 10, "normal", contentWidth);
    setStyle(10, "normal", MUTED);
    doc.text(metaLines, MARGIN, y);
    y += metaLines.length * 5 + 3;
  }

  // Summary paragraph
  if (summary) {
    y += 3;
    writeWrapped(summary, 10.5, "normal", [60, 80, 90], 5.5, 6);
  }

  if (safeDays.length >= 2) {
    y += 2;
    drawAtAGlance();
  }

  // Separator before days
  y += 4;
  drawRule([200, 210, 215]);
  y += 8;

  /* ── Day-by-day content ───────────────────────────────────── */

  safeDays.forEach((day, di) => {
    const dayDate = formatLongDate(day?.date);
    const dayTitle = String(day?.title ?? "").trim();
    let dayLabel = `Day ${day?.dayNumber || di + 1}`;
    if (dayDate) dayLabel += `  ·  ${dayDate}`;
    if (dayTitle) dayLabel += `  —  ${dayTitle}`;
    const labelLines = measure(dayLabel, 11, "bold", contentWidth - 8);
    const weatherLines = measure(describeDayWeather(day?.weatherEntry)?.pdfText ?? "", 8.5, "normal", contentWidth);
    const barHeight = 3 + labelLines.length * 5;
    // The bar, its weather line and room for a first stop move to a new page together.
    checkPageBreak(barHeight + 5 + weatherLines.length * 4.5 + 16);

    doc.setFillColor(...NAVY);
    doc.roundedRect(MARGIN, y, contentWidth, barHeight, 1.5, 1.5, "F");
    setStyle(11, "bold", WHITE);
    doc.text(labelLines, MARGIN + 4, y + 5.2);
    y += barHeight + 5;

    // Day weather (forecast or typical), right under the bar
    if (weatherLines.length > 0) {
      setStyle(8.5, "normal", WEATHER_BLUE);
      doc.text(weatherLines, MARGIN, y);
      y += weatherLines.length * 4.5;
    }

    if (day?.summary) {
      y += 1;
      writeWrapped(day.summary, 9.5, "italic", [100, 120, 130], 4.8, 4);
    }
    y += 3;

    itemsOf(day).forEach((item) => drawStop(day, item));
    y += 4;
  });

  // Open-Meteo's free API is CC-BY 4.0: credit it when any day shows weather.
  if (safeDays.some((day) => describeDayWeather(day?.weatherEntry))) {
    checkPageBreak(8);
    y += 2;
    setStyle(7.5, "normal", [150, 160, 170]);
    doc.text("Weather data by Open-Meteo.com", MARGIN, y);
    y += 4;
  }

  /* ── Footer on every page: brand left, "Page N of M" right ─── */

  const pageCount = doc.internal.getNumberOfPages();
  const footerBrand = voyageBrand ? "Planned with Voyage" : `${brandName}  ·  Planned with Voyage`;
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, pageHeight - 15, pageWidth - MARGIN, pageHeight - 15);
    setStyle(8, "normal", [160, 160, 160]);
    doc.text(footerBrand, MARGIN, pageHeight - 10);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 10, { align: "right" });
  }

  return doc;
}

/* ── internal helpers ──────────────────────────────────────── */

/** Reads "2026-10-08" (or an ISO timestamp) as that calendar day in local time, so no time zone shifts it. */
function parsePdfDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Thu, Oct 8, 2026" */
function formatLongDate(value) {
  const date = parsePdfDate(value);
  return date ? date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";
}

/** "Oct 8" */
function formatShortDate(value) {
  const date = parsePdfDate(value);
  return date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

function buildTimeLabel(item) {
  const fmt = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    const hour = parseInt(h, 10);
    if (isNaN(hour)) return t;
    const ampm = hour >= 12 ? "PM" : "AM";
    return `${hour % 12 || 12}:${m} ${ampm}`;
  };

  // Support both {startTime, endTime} and {time} shapes
  if (item.startTime && item.endTime) return `${fmt(item.startTime)} – ${fmt(item.endTime)}`;
  if (item.startTime) return fmt(item.startTime);
  if (item.endTime) return `Ends ${fmt(item.endTime)}`;
  if (typeof item.time === "string" && item.time.trim()) return item.time;
  return "";
}

/**
 * Converts a trip title to a safe filename slug.
 * e.g. "Tokyo Adventure!" → "tokyo-adventure-itinerary.pdf"
 */
export function titleToFilename(title) {
  const slug = (title || "itinerary")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug}-itinerary.pdf`;
}
```

- [ ] **Step 4: Run all PDF tests to verify they pass.**

Run: `npx vitest run tests/pdf-layout.test.js tests/pdf-weather.test.js tests/pdf-accessibility.test.js tests/pdf-place-status.test.js tests/pdf-images.test.js tests/use-itinerary-pdf.test.jsx`
Expected: PASS.

If a guard test in `pdf-accessibility.test.js` fails:
- The "inside the bottom margin" test mirrors a 28 mm bottom gap, 4 mm accessibility lines, then 1 + 5 mm. Keep `CONTENT_BOTTOM_GAP`, that line height and `STOP_GAP` as written; don't edit the test.
- The "counts the extra line" test needs `accessibilityLines` counted in `textHeight`. It is.

- [ ] **Step 5: Commit.**

```bash
git add app/lib/pdfExport.js tests/pdf-layout.test.js tests/pdf-weather.test.js tests/pdf-accessibility.test.js tests/pdf-place-status.test.js
git commit -m "feat(pdf): branded timeline layout with overview, photos and page numbers"
```

### Task 17: Pass the agency, client and logo into the PDF

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientItineraryPage.jsx:75-83` (props) and `:427-440` (`pdfInput`)
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx:894-896` (pass `agencyName`)
- Modify: `Voyage-Client/app/itinerary/view/[token]/page.jsx:457-471` (`pdfInput`)
- Test: `Voyage-Client/tests/client-itinerary-pdf.test.jsx`, `Voyage-Client/tests/share-page-pdf.test.jsx` (append)

- [ ] **Step 1: Write the failing tests.** Append inside the `describe("dashboard itinerary PDF", …)` block of `tests/client-itinerary-pdf.test.jsx`:

```jsx
  it("brands the PDF with the agency and names the client", async () => {
    render(<ClientItineraryPage agencyTrips={[trip]} agencyId="agency-1" agencyName="Island Hops Travel" />);

    await waitFor(
      () =>
        expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(
          expect.objectContaining({ agencyName: "Island Hops Travel", clientName: "Garcia" }),
        ),
      { timeout: 5000 },
    );
  });

  it("falls back to Voyage branding without an agency name", async () => {
    render(<ClientItineraryPage agencyTrips={[trip]} agencyId="agency-1" />);

    await waitFor(
      () => expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(expect.objectContaining({ agencyName: "Voyage" })),
      { timeout: 5000 },
    );
  });
```

Append inside `describe("public share PDF", …)` of `tests/share-page-pdf.test.jsx`:

```jsx
  it("passes the agency's logo and the client's name to the PDF", async () => {
    api.fetchPublicItinerary.mockResolvedValue(
      share({ type: "agency", name: "Island Hops Travel", logoUrl: "https://cdn.example.com/hops.png" }),
    );
    render(<PublicItineraryPage />);
    await readyButton();

    expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: "https://cdn.example.com/hops.png", clientName: "Garcia" }),
    );
  });

  it("sends no logo for a personal share", async () => {
    api.fetchPublicItinerary.mockResolvedValue(share({ type: "personal", displayName: "Ana" }));
    render(<PublicItineraryPage />);
    await readyButton();

    expect(pdfExport.generateItineraryPdf).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: null }));
  });
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run tests/client-itinerary-pdf.test.jsx tests/share-page-pdf.test.jsx`
Expected: FAIL. `agencyName` is always "Voyage", and there is no `clientName` or `logoUrl`.

- [ ] **Step 3: Implement.**

In `ClientItineraryPage.jsx`, add the prop to the signature after `onTripStatusChange,`:

```jsx
  // The signed-in agency's name, printed on the PDF; Voyage's own brand when missing.
  agencyName = null,
```

In `pdfInput`, replace `agencyName: "Voyage",` with:

```jsx
            agencyName: agencyName || "Voyage",
            clientName: selectedTrip?.clientName ?? null,
```

Then add `agencyName, selectedTrip?.clientName` to that `useMemo` dependency list.

In `HomePage.jsx`, add a prop to `<ClientItineraryPage`, after `agencyId={agencyId}`:

```jsx
              agencyName={activeAgency?.name ?? null}
```

In `app/itinerary/view/[token]/page.jsx`, in `pdfInput`, after `agencyName: agencyBrand || "Voyage",` add:

```jsx
      // The share header's logo and the client the agency shared it with.
      logoUrl: data.brand?.type === "agency" ? data.brand.logoUrl ?? null : null,
      clientName: data.share?.clientName ?? null,
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `npx vitest run tests/client-itinerary-pdf.test.jsx tests/share-page-pdf.test.jsx tests/client-itinerary-reuse-insert.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/components/trip-dashboard/pages/ClientItineraryPage.jsx app/components/trip-dashboard/HomePage.jsx "app/itinerary/view/[token]/page.jsx" tests/client-itinerary-pdf.test.jsx tests/share-page-pdf.test.jsx
git commit -m "feat(pdf): print the agency, its logo and the client on the itinerary PDF"
```

---

### Task 18: Full verification and hands-on QA

- [ ] **Step 1: Server suite and build.** From `Voyage-Server/`:

Run: `npm test` then `npm run build`
Expected: only the 11 known stale failures; tsc clean.

- [ ] **Step 2: Client suite and build.** From `Voyage-Client/`:

Run: `npm test` then `npm run build`
Expected: only the 8 known failing files; `next build` green.

- [ ] **Step 3: Hands-on checks.** Restart the backend first (OneDrive). Use the in-app browser where possible.

1. Command Center:
   - Send "Plan 2 days in Baguio". The bubble reads "Reading your request…", then "Choosing the next step…", "Planning the days…", "Adding a stop…" and "Writing the reply…".
   - "Thinking" never appears.
   - Expand the steps: rows read "Added a stop ×N", with no "Record Agent Task".
   - The top-bar pill says "Working".
2. Reload the thread. An older message saved as "Thought for …" now reads "Replied in …".
3. Register a new agency with an email you can read:
   - "We received your application" arrives.
   - Each super admin gets "New agency waiting for review", and its button opens the Admin tab.
   - With no email provider configured, the server logs "…delivery skipped…" and registration still succeeds.
4. Keep the pending screen open and approve the agency from another browser. Within 30 s, or on refocusing the tab, the workspace opens. The approval email arrives.
5. Reject another test agency with a reason:
   - The email shows the reason.
   - The status screen shows it and has "Contact support", with no "Resubmit".
   - "Contact support" opens Report a problem prefilled with "Agency application: …". Sending it shows "Report sent".
6. Download the PDF of a trip that has dates, weather, photos and 2+ days. Check:
   - Brand row, "Prepared for …" and the At a glance table.
   - Navy day bars with the weather line under them.
   - Time column, stop weather line and photos on the right.
   - "Page N of M" on every page.
   - The photos appear. If none do, check the console for CORS errors on `res.cloudinary.com`.
7. Print the same PDF. It matches the download.
8. Open the public share link of an agency trip and download its PDF. The agency's name shows (with its logo if the agency uploaded one), and the client name is printed.
9. Open the PDF on a phone (iOS share sheet). It still hands off within the tap.

- [ ] **Step 4: Record the results.** Note pass/fail per check under a "Results" heading in this plan and commit the plan. Then tell the user what was verified and what wasn't.

---

## Self-review (done while writing)

**Decision coverage:**

| Decision | Tasks |
|---|---|
| 24: live label | 1, 3 |
| 24: tool table, rows, tracking tools | 1, 2 |
| 24: summaries (client and server) | 1, 5 |
| 24: old history | 1, 2 |
| 24: pill | 4 |
| 20: four emails | 6 |
| 20: admins | 7, 8 |
| 20: after-save, never-throw | 8, 9 |
| 20: admin link | 10 |
| 20: polling | 12, 14 |
| 20: support modal | 11, 13 |
| 7: images | 15 |
| 7: layout (brand, meta, glance, bars, stops, footer, dates) | 16 |
| 7: inputs | 17 |

**Type and name consistency:**
- `activeLabelFor(timeline, { writingReply })`, `toolToDoneLabel`, `isTrackingTool` and `modernizeSummaryLabel`: Task 1 defines them; Tasks 2-3 use them.
- `AgencyNotifier.applicationSubmitted`, `agencyApproved` and `agencyRejected`: Task 8 defines them; Task 9 calls them and fakes them in tests.
- Email payload field names match between Tasks 6 and 8: `statusUrl`, `workspaceUrl`, `reviewUrl`, `location`, `ownerName` and `ownerEmail`.
- `loadImages(urls, options)` returns a `Map` in both `defaultLoadImages` and the test loader.
- `pdfPhotoUrl` and `VOYAGE_LOGO_PATH` match between Tasks 15-16 and their tests.

**Known limits, accepted:**
- In-app PDFs show the agency name without its logo, because `/auth/me` has no logo URL. Share PDFs use the share's `brand.logoUrl`. That URL is built by `publicShareService.buildLogoUrl`, which hard-codes `storage.googleapis.com` and may 404 on S3-style storage. If it does, the name still prints.
- Google Places photo URLs that aren't cached to Cloudinary may fail CORS and print without a photo.
- "Researched N places" still counts every non-tracking tool, which is the existing behaviour.
