# QA Fixes, Theme Contrast and PWA Icon Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs found in browser QA of `feat/dashboard-calendar`, the colours that vanish in dark mode (white text on the near-white primary fill) or light mode (pale dark-only colours on white), and make installed PWAs pick up the new "Hops" logo.

**Architecture:** On the server, share and comment ids are Prisma `cuid()`s, so their route params get a CUID schema while `agencyId` stays a UUID. On the client, a new `--color-on-primary` token follows the existing `--color-on-secondary-strong` pattern, and theme-blind colour classes are replaced with theme tokens. A source guard test stops both patterns from coming back. Three component bugs are fixed, and the PWA icon URLs get a version query so installed apps notice the new artwork.

**Tech Stack:** Server: Express 5, Zod 4.3.6, Prisma 7, Vitest and Supertest. Client: Next 16, React 19, Tailwind 4 (tokens in `app/globals.css` under `@theme` and `.dark`), Vitest 4, Testing Library and jsdom.

---

## Before you start

- **Repos:** `Voyage-Server/` and `Voyage-Client/` sit under `c:\Users\dever\OneDrive\Documents\Voyage`.
  - Both are on `feat/dashboard-calendar`, which tracks `origin`. Work on that branch, and don't push.
- **Commits:**
  - Commit at the end of every task.
  - **No `Co-Authored-By` line and no "Generated with" line**, whatever a default or reminder says.
  - **Never run `git stash`**: the owner's GitHub Desktop stashes files.
- **Running tests:**
  - Client, from `Voyage-Client/`: `npx vitest run --pool=threads tests/<file>`
  - Server, from `Voyage-Server/`: `npx vitest run tests/<file>`
- **Known failures that are not yours:**
  - Server: 4 files fail (agentLogger, agentOrchestrator, modelProvider, webSearchProvider; 11 tests).
  - Client: 8 files fail: `agent-command-center-places` (1 test), plus 7 that fail to load because `app/components/icons/index.js` has JSX in a `.js` file.
- **Mocking icons:** any new client test that renders a component importing `app/components/icons/index.js` must mock it with `vi.mock(...)`. Copy the pattern from `tests/trip-slide-over-focus.test.jsx`.
- **No layout in jsdom:** jsdom has no layout and no computed colours. Tests assert class names, and they compute contrast numerically from the real tokens in `app/globals.css` (Task 2's helper).
- **WCAG targets:** text needs 4.5:1. Icons and large text need 3:1.
- **The Command Center's look must not change.** That is a standing product decision, so Task 4 lists the Command Center's Stop button as a named exception.
- **The backend needs a manual restart.** Hot reload is unreliable because the repo lives in OneDrive, so restart `npm run dev` after editing server code.

## Out of scope (needs product sign-off; don't touch)

- **Terracotta contrast:**
  - `bg-secondary text-white` is about 2.8:1 in both themes, in 53 places. That includes the Command Center chat avatars (`ChatMessage.jsx:128`) and the Save buttons.
  - `text-secondary` used as text is 2.6–3.2:1 in light mode, in 123 places, e.g. the itinerary "DAY 1" chips and time chips.
- **`--color-text-soft`:** 3.4–3.8:1 in both themes (table headers, emails, Settings labels).
- **The Command Center Stop button**: `ChatInput.jsx:135`, `text-red-400`.
- **The Google Maps "Satellite" control.** Google renders it.

## File map

**Server (`Voyage-Server/`)**

| File | Change |
|---|---|
| `src/http/requestSchemas.ts` | Add `cuidSchema` |
| `src/modules/shares/shareSchemas.ts` | `shareId` and `commentId` params use `cuidSchema` |
| `tests/authenticatedValidation.test.ts` | Use real CUID share and comment ids; add a regression test |

**Client (`Voyage-Client/`)**

| File | Change |
|---|---|
| `tests/helpers/themeTokens.js` (new) | Token resolution and WCAG helpers, moved out of `dashboard-contrast.test.jsx` |
| `tests/dashboard-contrast.test.jsx` | Import the helpers |
| `app/globals.css` | `--color-on-primary` (light `#ffffff`, dark `#111416`) |
| `tests/theme-tokens.test.js` (new) | Numeric contrast for the token pairs this plan uses |
| `tests/theme-safe-classes.test.js` (new) | Source guard: no `bg-primary` with `text-white`, no pale palette text outside `dark:` |
| `app/components/admin/SegmentedControl.jsx` | Active pill and badge colours |
| `app/components/trip-dashboard/command-center/ClientSwitcher.jsx` | Initials avatars |
| `app/components/agent/chat/AgentMessageList.jsx`, `app/components/agent/layout/AgentReviewBar.jsx`, `app/components/agent/layout/AgentThreadRail.jsx` | Same one-word fix (not rendered anywhere, kept consistent for the guard) |
| `app/components/trip-dashboard/pages/SettingsPage.jsx`, `app/components/settings/ReportProblemModal.jsx` | Status, success and error colours |
| `app/components/trip-dashboard/pages/ClientList.jsx` | Avatars, selected name, delete icon |
| `app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx` | Comment-load error and partial-failure states |
| `app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx` | Height cap and scrolling list |
| `app/components/trip-dashboard/layout/DashboardHeader.jsx` | "Save to Client" label wrapper |
| `app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx` | Compact empty state |
| `app/agency/[agencyId]/components/dashboard/widgets/WorklistRow.jsx` | Tone labels in words |
| `public/manifest.json`, `app/layout.jsx`, `public/sw.js` | Versioned icon URLs, `id`, cache bump, no missing screenshots |
| Tests | `segmented-control`, `client-switcher-avatars` (new), `settings-status-colors` (new), `report-problem-modal`, `client-list-contrast` (new), `trip-slide-over-comments` (new), `calendar-day-popover`, `dashboard-rail`, `dashboard-insights-widgets`, `dashboard-worklist-row`, `pwa-icons` (new) |

---

### Task 1: Accept CUID share and comment ids in share routes (server)

**Why:** `ItineraryShare` and `ItineraryComment` use `@default(cuid())`; every other model uses UUIDs. Since `8028b1f` (2026-06-10), `shareIdParamsSchema` and `commentIdParamsSchema` require UUIDs. So these three routes return `400 VALIDATION_ERROR` for every real id:
- `GET /agencies/:agencyId/shares/:shareId/comments`, which loads the trip slide-over's comments
- `DELETE /agencies/:agencyId/shares/:shareId` (revoke)
- `POST /agencies/:agencyId/shares/comments/:commentId/reply`

The tests passed because they used UUIDs as share and comment ids.

**Files:**
- Modify: `Voyage-Server/src/http/requestSchemas.ts:25`
- Modify: `Voyage-Server/src/modules/shares/shareSchemas.ts:1-10, 53-57`
- Test: `Voyage-Server/tests/authenticatedValidation.test.ts`

- [ ] **Step 1: Switch the test ids to real CUIDs and add the regression tests**

In `tests/authenticatedValidation.test.ts`, replace:

```ts
const VALID_SHARE_ID = "55555555-5555-4555-8555-555555555555";
const VALID_COMMENT_ID = "66666666-6666-4666-8666-666666666666";
```

with:

```ts
// ItineraryShare and ItineraryComment ids are Prisma cuid()s, not UUIDs.
const VALID_SHARE_ID = "cmpsm6sn00000eohoyq6shdqz";
const VALID_COMMENT_ID = "cmpt0a1b20003eohoq8r7s6tu";
```

In the test `"rejects invalid share filters, share IDs, comment IDs, and expiresAt before service calls"`, rename the two bad share and comment ids so they describe the new rule. Replace:

```ts
    const revokeResponse = await request(app).delete(
      `/agencies/${VALID_AGENCY_ID}/shares/not-a-uuid`
    );
    const replyResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/shares/comments/not-a-uuid/reply`)
      .send({ content: "Thanks" });
```

with:

```ts
    const revokeResponse = await request(app).delete(
      `/agencies/${VALID_AGENCY_ID}/shares/not-a-cuid`
    );
    const replyResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/shares/comments/not-a-cuid/reply`)
      .send({ content: "Thanks" });
```

Directly after the test `"accepts a valid share revoke request despite the merged agencyId param"` (it ends with `expect(mockRevokeShare).toHaveBeenCalledWith(VALID_AGENCY_ID, VALID_SHARE_ID);` and `});`), add:

```ts
  // Regression: share and comment ids are cuid()s. A UUID-only param schema
  // turned every comments, revoke and reply request into a 400.
  it("accepts cuid share and comment ids on the comments, revoke and reply routes", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/shares",
      router: shareRoutes,
      authUser: agencyUser
    });

    const commentsResponse = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/shares/${VALID_SHARE_ID}/comments`
    );
    const revokeResponse = await request(app).delete(
      `/agencies/${VALID_AGENCY_ID}/shares/${VALID_SHARE_ID}`
    );
    const replyResponse = await request(app)
      .post(`/agencies/${VALID_AGENCY_ID}/shares/comments/${VALID_COMMENT_ID}/reply`)
      .send({ content: "Thanks" });

    expect(commentsResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(replyResponse.status).toBe(200);
    expect(mockListComments).toHaveBeenCalledWith(VALID_AGENCY_ID, VALID_SHARE_ID);
    expect(mockRevokeShare).toHaveBeenCalledWith(VALID_AGENCY_ID, VALID_SHARE_ID);
    expect(mockReplyToComment).toHaveBeenCalledWith(VALID_AGENCY_ID, VALID_COMMENT_ID, "Thanks");
  });

  it("rejects a share id that is not a cuid, such as a UUID", async () => {
    const app = createRouteApp({
      mountPath: "/agencies/:agencyId/shares",
      router: shareRoutes,
      authUser: agencyUser
    });

    const response = await request(app).get(
      `/agencies/${VALID_AGENCY_ID}/shares/${VALID_ITINERARY_ID}/comments`
    );

    expectValidationError(response);
    expect(mockListComments).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/authenticatedValidation.test.ts`

Expected: these 2 tests FAIL, both with `expected 400 to be 200`:
- "accepts a valid share revoke request despite the merged agencyId param"
- "accepts cuid share and comment ids on the comments, revoke and reply routes"

Every other test passes, including "rejects a share id that is not a cuid, such as a UUID".

- [ ] **Step 3: Add the CUID schema**

In `src/http/requestSchemas.ts`, replace:

```ts
export const uuidSchema = z.string().uuid();
```

with:

```ts
export const uuidSchema = z.string().uuid();
/** Ids of models declared with Prisma `@default(cuid())` (ItineraryShare, ItineraryComment). */
export const cuidSchema = z.cuid();
```

- [ ] **Step 4: Use it for the share and comment params**

In `src/modules/shares/shareSchemas.ts`, replace the import block:

```ts
import {
  futureIsoDateTimeSchema,
  idParamsSchema,
  longTextSchema,
  normalizedNameSchema,
  nullableTextSchema,
  optionalTextSchema,
  uuidSchema
} from "../../http/requestSchemas";
```

with:

```ts
import {
  cuidSchema,
  futureIsoDateTimeSchema,
  idParamsSchema,
  longTextSchema,
  normalizedNameSchema,
  nullableTextSchema,
  optionalTextSchema,
  uuidSchema
} from "../../http/requestSchemas";
```

and replace:

```ts
// Mounted under `/agencies/:agencyId/shares` with a mergeParams router, so
// `req.params` also carries `agencyId`; include it or strict parsing rejects it.
export const shareIdParamsSchema = idParamsSchema("agencyId", "shareId");
export const commentIdParamsSchema = idParamsSchema("agencyId", "commentId");
export const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
```

with:

```ts
// Mounted under `/agencies/:agencyId/shares` with a mergeParams router, so
// `req.params` also carries `agencyId`; include it or strict parsing rejects it.
// Share and comment ids are Prisma cuid()s, unlike the UUID agency id.
export const shareIdParamsSchema = z.object({ agencyId: uuidSchema, shareId: cuidSchema }).strict();
export const commentIdParamsSchema = z.object({ agencyId: uuidSchema, commentId: cuidSchema }).strict();
export const itineraryIdParamsSchema = idParamsSchema("agencyId", "itineraryId");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/authenticatedValidation.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Type-check**

Run: `npm run build`
Expected: `tsc` exits 0 with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/http/requestSchemas.ts src/modules/shares/shareSchemas.ts tests/authenticatedValidation.test.ts
git commit -m "fix(shares): accept cuid share and comment ids in route params" -m "ItineraryShare and ItineraryComment ids are Prisma cuid()s, but the strict param schemas required UUIDs, so loading comments, revoking a share and replying to a comment all returned 400. agencyId stays a UUID."
```

---

### Task 2: Share the theme-token contrast helpers (client)

**Why:** Tasks 3 and 4 check contrast numerically against the real tokens, and `tests/dashboard-contrast.test.jsx` already has that code. Move it into a helper module so the new tests reuse it. Behaviour doesn't change.

**Files:**
- Create: `Voyage-Client/tests/helpers/themeTokens.js`
- Modify: `Voyage-Client/tests/dashboard-contrast.test.jsx`

- [ ] **Step 1: Record the current result**

Run: `npx vitest run --pool=threads tests/dashboard-contrast.test.jsx`
Expected: PASS. Note the number of passing tests.

- [ ] **Step 2: Create the helper module**

Create `tests/helpers/themeTokens.js`:

```js
// Resolves the real colour tokens in app/globals.css so tests can check WCAG
// contrast numerically. jsdom has no layout and no computed colours.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

/** The declarations inside the first `<selector> { ... }` block of globals.css. */
export function declarations(selector) {
  const open = css.indexOf(`${selector} {`) + selector.length + 2;
  let depth = 1;
  let end = open;
  while (depth > 0) {
    if (css[end] === "{") depth += 1;
    if (css[end] === "}") depth -= 1;
    end += 1;
  }
  return Object.fromEntries([...css.slice(open, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LIGHT_TOKENS = { ...declarations("@theme"), ...declarations(":root") };
export const THEMES = { light: LIGHT_TOKENS, dark: { ...LIGHT_TOKENS, ...declarations(".dark") } };

/** A CSS colour expression -> [r, g, b, a]. Handles hex, rgb()/rgba() with var() channels, var() and color-mix(..., N%, transparent). */
export function resolve(expression, tokens) {
  const value = expression.trim();
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*transparent\)$/.exec(value);
  if (mix) {
    const [r, g, b, a] = resolve(mix[1], tokens);
    return [r, g, b, a * (Number(mix[2]) / 100)];
  }
  const single = /^var\((--[\w-]+)\)$/.exec(value);
  if (single) return resolve(tokens[single[1]], tokens);
  if (value.startsWith("#")) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    return [r, g, b, 1];
  }
  const substituted = value.replace(/var\((--[\w-]+)\)/g, (_, name) => tokens[name]);
  const [channels, alpha] = substituted.replace(/^rgba?\(|\)$/g, "").split("/");
  const numbers = channels.split(/[\s,]+/).filter(Boolean).map(Number);
  return [numbers[0], numbers[1], numbers[2], alpha !== undefined ? Number(alpha) : (numbers[3] ?? 1)];
}

/** Paints a translucent [r, g, b, a] over an opaque [r, g, b]. */
export const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];

function luminance([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrastRatio(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 3: Point `dashboard-contrast.test.jsx` at the helper**

In `tests/dashboard-contrast.test.jsx`:

1. Delete the first two import lines:

```js
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
```

2. Add this line after the `import { describe, expect, it, vi } from "vitest";` line:

```js
import { THEMES, contrastRatio, over, resolve } from "./helpers/themeTokens.js";
```

3. Delete the whole block that starts at the comment `// ---- Numeric WCAG contrast, resolved from the real tokens in globals.css ----` and ends with the closing `}` of `function contrastRatio(foreground, background) { ... }`. The block holds `const css`, `declarations`, `LIGHT_TOKENS`, `THEMES`, `resolve`, `over`, `luminance` and `contrastRatio`, and it sits directly above the `surfaceUnderChip` doc comment. Keep `styleValue`, `chipColor`, `chipDot` and everything from `surfaceUnderChip` down.

- [ ] **Step 4: Verify nothing changed**

Run: `npx vitest run --pool=threads tests/dashboard-contrast.test.jsx`
Expected: PASS with the same number of tests as in Step 1.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/themeTokens.js tests/dashboard-contrast.test.jsx
git commit -m "test: share the theme token contrast helpers"
```

---

### Task 3: Add an on-primary text colour so primary fills stay readable in dark mode

**Why:** `--color-primary` is navy in light mode and near-white (`oklch(0.94…)`) in dark mode. Every `bg-primary text-white` therefore becomes white on white in dark mode, at 1.19:1. Where it shows up:
- the Admin section tabs (Agencies/Usage/Reports), the status filters and the Usage toggles, all one component: `SegmentedControl`;
- the "NA" initials in the "New agent thread" pill and every avatar in its menu: `ClientSwitcher`.

Terracotta already solves this with `--color-on-secondary-strong`, so this task does the same for primary. The Reports badge inside `SegmentedControl` (`bg-secondary text-white`, 2.4:1 in dark) moves to the strong terracotta pair that `PeriodSwitcher` already uses.

Contrast (verified against `globals.css`):

| Pair | Light | Dark |
|---|---|---|
| on-primary on primary | 12.25:1 | 15.56:1 |
| on-secondary-strong on secondary-strong | 5.2:1 | 7.39:1 |

**Files:**
- Modify: `Voyage-Client/app/globals.css` (`@theme` block near line 30; `.dark` block near line 112)
- Modify: `Voyage-Client/app/components/admin/SegmentedControl.jsx:44,49`
- Modify: `Voyage-Client/app/components/trip-dashboard/command-center/ClientSwitcher.jsx:87,140`
- Modify: `Voyage-Client/app/components/agent/chat/AgentMessageList.jsx:98`, `Voyage-Client/app/components/agent/layout/AgentReviewBar.jsx:20`, `Voyage-Client/app/components/agent/layout/AgentThreadRail.jsx:20`
- Create: `Voyage-Client/tests/theme-tokens.test.js`, `Voyage-Client/tests/theme-safe-classes.test.js`, `Voyage-Client/tests/client-switcher-avatars.test.jsx`
- Modify: `Voyage-Client/tests/segmented-control.test.jsx`

- [ ] **Step 1: Write the token test**

Create `tests/theme-tokens.test.js`:

```js
import { describe, expect, it } from "vitest";
import { THEMES, contrastRatio, resolve } from "./helpers/themeTokens.js";

describe.each(["light", "dark"])("%s theme", (theme) => {
  const tokens = THEMES[theme];

  it.each([
    ["--color-on-primary", "rgb(var(--color-primary-rgb))"],
    ["--color-on-secondary-strong", "var(--color-secondary-strong)"],
  ])("%s reaches 4.5:1 on its fill", (textToken, fill) => {
    expect(tokens[textToken], `${textToken} is defined`).toBeDefined();
    expect(contrastRatio(resolve(`var(${textToken})`, tokens), resolve(fill, tokens))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Write the source guard test**

Create `tests/theme-safe-classes.test.js`:

```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir = join(ROOT, "app")) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
  });
}

/** Every source line's class-like tokens, each split into its variants (`dark`, `hover`) and utility. */
function* classLines() {
  for (const file of sourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, text] of lines.entries()) {
      const tokens = text
        .split(/[\s"'`{}]+/)
        .filter(Boolean)
        .map((token) => {
          const parts = token.split(":");
          return { token, variants: parts.slice(0, -1), utility: parts.at(-1) };
        });
      yield { where: `${rel}:${index + 1}`, rel, tokens };
    }
  }
}

describe("theme-safe colour classes", () => {
  // --color-primary is navy in light mode and near-white in dark mode, so plain
  // white text on it disappears in dark mode. Use text-on-primary.
  it("never puts plain white text on a primary fill", () => {
    const offenders = [];
    for (const { where, tokens } of classLines()) {
      const plain = new Set(tokens.filter((t) => t.variants.length === 0).map((t) => t.utility));
      if (plain.has("bg-primary") && plain.has("text-white")) offenders.push(where);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the component tests**

In `tests/segmented-control.test.jsx`, add these two tests inside the existing `describe("SegmentedControl", ...)` block, after the `"renders a badge when provided"` test:

```jsx
  it("fills the active segment with the theme-aware text colour, never plain white", () => {
    render(<SegmentedControl options={opts} value="a" onChange={() => {}} ariaLabel="x" />);
    const active = screen.getByRole("tab", { name: "Alpha" });
    expect(active.className).toContain("bg-primary");
    expect(active.className).toContain("text-on-primary");
    expect(active.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });

  it("draws the badge in the strong terracotta pair, readable in both themes", () => {
    render(<SegmentedControl options={[{ value: "a", label: "Alpha", badge: 3 }]} value="a" onChange={() => {}} ariaLabel="x" />);
    const badge = screen.getByText("3");
    expect(badge.className).toContain("bg-secondary-strong");
    expect(badge.className).toContain("text-on-secondary-strong");
    expect(badge.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });
```

Create `tests/client-switcher-avatars.test.jsx`:

```jsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ClientSwitcher from "../app/components/trip-dashboard/command-center/ClientSwitcher.jsx";

function renderSwitcher() {
  return render(
    <ClientSwitcher
      isClientMenuOpen
      setIsClientMenuOpen={() => {}}
      clientMenuRef={{ current: null }}
      hasOptions
      activeTripClientName="Alice Reyes"
      activeTripInitials="AR"
      activeTripOrganizerInitials=""
      clientMenuEmptyTitle=""
      clientMenuEmptyBody=""
      safeOptions={[
        { type: "trip", id: "t1", clientName: "Bea Cruz", label: "Bea Cruz", destination: "Tokyo", threadId: "thr-1" },
      ]}
      activeOption={{ type: "trip", id: "t2" }}
      getInitials={() => "BC"}
      onPlanningOptionChange={() => {}}
      deletingThreadId={null}
    />,
  );
}

describe("ClientSwitcher initials avatars", () => {
  it.each([
    ["the trigger", "AR"],
    ["the menu", "BC"],
  ])("in %s use the theme-aware text colour on the primary fill", (_, initials) => {
    renderSwitcher();
    const avatar = screen.getByText(initials);
    expect(avatar.className).toContain("bg-primary");
    expect(avatar.className).toContain("text-on-primary");
    expect(avatar.className).not.toMatch(/(^|\s)text-white(\s|$)/);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/theme-tokens.test.js tests/theme-safe-classes.test.js tests/segmented-control.test.jsx tests/client-switcher-avatars.test.jsx`

Expected FAILs:
- **theme-tokens:** the two `--color-on-primary` cases, at "--color-on-primary is defined". The `--color-on-secondary-strong` cases already pass.
- **theme-safe-classes:** the offenders list has 6 entries:
  - `app/components/admin/SegmentedControl.jsx:44`
  - `app/components/agent/chat/AgentMessageList.jsx:98`
  - `app/components/agent/layout/AgentReviewBar.jsx:20`
  - `app/components/agent/layout/AgentThreadRail.jsx:20`
  - `app/components/trip-dashboard/command-center/ClientSwitcher.jsx:87`
  - `app/components/trip-dashboard/command-center/ClientSwitcher.jsx:140`
- **segmented-control:** the 2 new tests.
- **client-switcher-avatars:** both cases.

- [ ] **Step 5: Add the token**

In `app/globals.css`, inside `@theme`, replace:

```css
  --color-secondary-strong: #ad5238;
  --color-on-secondary-strong: #ffffff;
```

with:

```css
  --color-secondary-strong: #ad5238;
  --color-on-secondary-strong: #ffffff;

  /* Text on a primary fill. Primary flips from navy (light) to near-white
     (dark), so plain white text on it vanishes in dark mode. */
  --color-on-primary: #ffffff;
```

Inside `.dark`, replace:

```css
  --color-secondary-strong: #e0906f;
  --color-on-secondary-strong: #111416;
```

with:

```css
  --color-secondary-strong: #e0906f;
  --color-on-secondary-strong: #111416;
  --color-on-primary: #111416;
```

- [ ] **Step 6: Use it**

`app/components/admin/SegmentedControl.jsx`, active pill (line 44). Replace:

```jsx
              active ? "bg-primary text-white shadow-soft" : "text-text-muted hover:text-text-primary"
```

with:

```jsx
              active ? "bg-primary text-on-primary shadow-soft" : "text-text-muted hover:text-text-primary"
```

Same file, the badge (line 49). Replace:

```jsx
              <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-pill bg-secondary px-1 text-[10px] font-bold leading-[18px] text-white">
```

with:

```jsx
              <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-pill bg-secondary-strong px-1 text-[10px] font-bold leading-[18px] text-on-secondary-strong">
```

`app/components/trip-dashboard/command-center/ClientSwitcher.jsx` line 87. Replace:

```jsx
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-[10px] font-bold max-[900px]:w-5 max-[900px]:h-5 max-[900px]:text-[8px]">
```

with:

```jsx
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-on-primary text-[10px] font-bold max-[900px]:w-5 max-[900px]:h-5 max-[900px]:text-[8px]">
```

Line 140. Replace:

```jsx
                    <span className="inline-flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-full bg-primary text-white text-[11px] font-bold" aria-hidden="true">
```

with:

```jsx
                    <span className="inline-flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-full bg-primary text-on-primary text-[11px] font-bold" aria-hidden="true">
```

Nothing renders the three `app/components/agent/*` files, but keep them consistent so the guard has no exceptions. On the reported line of each file, change only `bg-primary text-white` to `bg-primary text-on-primary`:
- `app/components/agent/chat/AgentMessageList.jsx:98`: `'bg-primary text-white rounded-br-[4px]'` becomes `'bg-primary text-on-primary rounded-br-[4px]'`
- `app/components/agent/layout/AgentReviewBar.jsx:20`: `... bg-primary text-white hover:-translate-y-px` becomes `... bg-primary text-on-primary hover:-translate-y-px`
- `app/components/agent/layout/AgentThreadRail.jsx:20`: `... bg-primary text-white border-0 ...` becomes `... bg-primary text-on-primary border-0 ...`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/theme-tokens.test.js tests/theme-safe-classes.test.js tests/segmented-control.test.jsx tests/client-switcher-avatars.test.jsx tests/client-switcher-rename.test.jsx`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
git add app/globals.css app/components/admin/SegmentedControl.jsx app/components/trip-dashboard/command-center/ClientSwitcher.jsx app/components/agent/chat/AgentMessageList.jsx app/components/agent/layout/AgentReviewBar.jsx app/components/agent/layout/AgentThreadRail.jsx tests/theme-tokens.test.js tests/theme-safe-classes.test.js tests/segmented-control.test.jsx tests/client-switcher-avatars.test.jsx
git commit -m "fix(theme): keep text on primary fills readable in dark mode" -m "Primary turns near-white in dark mode, so the admin tabs, filters and the agent-thread initials were white on white (1.19:1). Add --color-on-primary (white / #111416) and a guard test against bg-primary with text-white."
```

---

### Task 4: Use theme status colours in Settings and the report modal

**Why:** Several colours were chosen for dark mode only (`text-emerald-400`, `text-amber-400`, `text-slate-300`, `text-red-400`, `border-white/10`), so they are unreadable on light surfaces. The ACTIVE and VERIFIED pills measure 1.67:1 in light mode. The theme's `status-*` tokens change with the theme.

Use an **8%** tint, not 10%: `status-warning` text drops to 4.48:1 on a 10% tint in light mode.

Contrast at 8% (verified):

| Status text | Light | Dark |
|---|---|---|
| success | 4.9:1 | 7.6:1 |
| warning | 4.62:1 | 6.56:1 |
| danger | 5.66:1 | 5.48:1 |
| neutral (`text-text-muted` on `bg-text-primary/5`) | 6.3:1 | 6.13:1 |

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/SettingsPage.jsx:25-34, 342, 394, 518`
- Modify: `Voyage-Client/app/components/settings/ReportProblemModal.jsx:63`
- Modify: `Voyage-Client/tests/theme-tokens.test.js`, `Voyage-Client/tests/theme-safe-classes.test.js`, `Voyage-Client/tests/report-problem-modal.test.jsx`
- Create: `Voyage-Client/tests/settings-status-colors.test.jsx`

- [ ] **Step 1: Pin the tint strength in the token test**

In `tests/theme-tokens.test.js`, change the import line to:

```js
import { THEMES, contrastRatio, over, resolve } from "./helpers/themeTokens.js";
```

Inside the `describe.each(...)` callback, after the existing `it.each`, add:

```js
  it.each(["--color-status-success", "--color-status-warning", "--color-status-danger"])(
    "%s text reaches 4.5:1 on an 8%% tint of itself over the surface",
    (token) => {
      const surface = resolve("rgb(var(--color-surface-rgb))", tokens);
      const [r, g, b] = resolve(`var(${token})`, tokens);
      const tint = over([r, g, b, 0.08], surface);
      expect(contrastRatio([r, g, b], tint)).toBeGreaterThanOrEqual(4.5);
    },
  );
```

These pass immediately, because the tokens already exist. They pin the 8% the pills use.

- [ ] **Step 2: Add the pale-text guard**

In `tests/theme-safe-classes.test.js`, add this inside `describe("theme-safe colour classes", ...)`, after the first `it`:

```js
  // Tailwind's 50–400 shades are pale: fine on dark surfaces, unreadable on
  // light ones. Unless the class is dark-only (`dark:`), use a theme token.
  const PALE_TEXT = /^text-(red|rose|emerald|green|amber|yellow|orange|sky|blue|slate|gray|zinc|neutral)-(50|100|200|300|400)(\/\d+)?$/;
  // The Command Center's look is frozen until the colour sweep is signed off.
  const PALE_TEXT_ALLOWED = new Set(["app/components/trip-dashboard/command-center/ChatInput.jsx"]);

  it("never uses a pale palette text colour outside dark mode", () => {
    const offenders = [];
    for (const { where, rel, tokens } of classLines()) {
      if (PALE_TEXT_ALLOWED.has(rel)) continue;
      for (const { token, variants, utility } of tokens) {
        if (PALE_TEXT.test(utility) && !variants.includes("dark")) offenders.push(`${where} ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 3: Write the Settings and modal tests**

Create `tests/settings-status-colors.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/team/TeamPage.jsx", () => ({ default: () => null }));
vi.mock("../app/lib/api/support.js", () => ({ createProblemReport: vi.fn() }));

import SettingsPage from "../app/components/trip-dashboard/pages/SettingsPage.jsx";

function renderSettings({ userStatus, agencyStatus }) {
  return render(
    <SettingsPage
      user={{ id: "u1", displayName: "Maria", email: "maria@example.test", accountType: "AGENCY_USER", status: userStatus }}
      agency={{ id: "agency-1", name: "Sunline Travel", status: agencyStatus }}
      membership={{ role: "STAFF", status: "ACTIVE" }}
      logout={vi.fn()}
      onUpdateProfile={vi.fn()}
      onUpdateAgency={vi.fn()}
      onReplayTutorial={vi.fn()}
    />,
  );
}

/** Each status pill sits just before its label. */
const pillFor = (label) => screen.getByText(label).previousElementSibling;

/** Dark-only Tailwind palette classes that wash out on a light surface. */
const DARK_ONLY = /(^|\s)(text|bg|border)-(emerald|amber|slate|red)-\d+|(^|\s)border-white\//;

describe("Settings status pills", () => {
  it.each([
    ["ACTIVE", "VERIFIED", ["bg-status-success/8", "text-status-success", "border-status-success/30"]],
    ["PENDING", "INVITED", ["bg-status-warning/8", "text-status-warning", "border-status-warning/30"]],
    ["SUSPENDED", "REJECTED", ["bg-text-primary/5", "text-text-muted", "border-border/20"]],
  ])("colour %s / %s with theme tokens", (userStatus, agencyStatus, classes) => {
    renderSettings({ userStatus, agencyStatus });

    for (const label of ["Account status", "Agency status"]) {
      const pill = pillFor(label);
      for (const name of classes) expect(pill.className, `${label}: ${name}`).toContain(name);
      expect(pill.className, label).not.toMatch(DARK_ONLY);
    }
  });
});
```

In `tests/report-problem-modal.test.jsx`, add inside `describe("ReportProblemModal", ...)`:

```jsx
  it("shows validation errors in the theme's danger colour", () => {
    render(<ReportProblemModal open onClose={() => {}} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("text-status-danger");
    expect(alert.className).not.toContain("text-red-400");
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/theme-safe-classes.test.js tests/settings-status-colors.test.jsx tests/report-problem-modal.test.jsx tests/theme-tokens.test.js`

Expected FAILs:
- **theme-safe-classes** ("pale palette"): 7 offenders:
  - `app/components/settings/ReportProblemModal.jsx:63 text-red-400`
  - `SettingsPage.jsx:28 text-emerald-400`
  - `SettingsPage.jsx:31 text-amber-400`
  - `SettingsPage.jsx:33 text-slate-300`
  - `SettingsPage.jsx:342 text-red-400`
  - `SettingsPage.jsx:394 text-red-400`
  - `SettingsPage.jsx:518 text-emerald-400`
- **settings-status-colors:** all 3 cases.
- **report-problem-modal:** the new test.

theme-tokens passes.

- [ ] **Step 5: Fix SettingsPage**

In `app/components/trip-dashboard/pages/SettingsPage.jsx`, replace `getStatusClass`:

```js
function getStatusClass(status) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "VERIFIED") {
    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
  if (normalized === "PENDING" || normalized === "INVITED") {
    return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  }
  return "bg-slate-500/15 text-slate-300 border-white/10";
}
```

with:

```js
// Theme tokens, so the pills read in light and dark mode. An 8% tint keeps
// every status colour at 4.5:1 (warning drops below it at 10%).
function getStatusClass(status) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "VERIFIED") {
    return "bg-status-success/8 text-status-success border-status-success/30";
  }
  if (normalized === "PENDING" || normalized === "INVITED") {
    return "bg-status-warning/8 text-status-warning border-status-warning/30";
  }
  return "bg-text-primary/5 text-text-muted border-border/20";
}
```

Line 342. Replace:

```jsx
            {profileError ? <p className="text-sm font-medium text-red-400" role="alert">{profileError}</p> : null}
```

with:

```jsx
            {profileError ? <p className="text-sm font-medium text-status-danger" role="alert">{profileError}</p> : null}
```

Line 394. Replace:

```jsx
            {workspaceError ? <p className="text-sm font-medium text-red-400" role="alert">{workspaceError}</p> : null}
```

with:

```jsx
            {workspaceError ? <p className="text-sm font-medium text-status-danger" role="alert">{workspaceError}</p> : null}
```

Line 518. Replace:

```jsx
              <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400" role="status">
```

with:

```jsx
              <p className="rounded-2xl border border-status-success/30 bg-status-success/8 px-4 py-3 text-sm text-status-success" role="status">
```

- [ ] **Step 6: Fix ReportProblemModal**

In `app/components/settings/ReportProblemModal.jsx` line 63, replace:

```jsx
          {error && <p className="text-sm font-medium text-red-400" role="alert">{error}</p>}
```

with:

```jsx
          {error && <p className="text-sm font-medium text-status-danger" role="alert">{error}</p>}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/theme-safe-classes.test.js tests/settings-status-colors.test.jsx tests/report-problem-modal.test.jsx tests/theme-tokens.test.js tests/settings-team.test.jsx`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
git add app/components/trip-dashboard/pages/SettingsPage.jsx app/components/settings/ReportProblemModal.jsx tests/theme-tokens.test.js tests/theme-safe-classes.test.js tests/settings-status-colors.test.jsx tests/report-problem-modal.test.jsx
git commit -m "fix(settings): use theme status colours for pills, notices and errors" -m "The status pills, success notice and error text used dark-only Tailwind shades (emerald/amber/red-400, slate-300), unreadable in light mode (1.67:1). Switch to the status-* tokens with an 8% tint and guard against pale palette text outside dark:."
```

---

### Task 5: Make the client list readable in light mode

**Why:** The Itineraries client list (`ClientList.jsx`) was styled for a dark selected row. In light mode:
- the unselected avatars are white on a pale pink tint (`bg-secondary/40 text-white`), at 1.66:1;
- the selected row's delete icon is `text-white/60` on the pink row tint, at 1.18:1, almost invisible;
- the selected name is light terracotta, at 2.82:1.

Even the strong terracotta reaches only 4.25:1 on that tint, so the name moves to the body colour; the row tint, border and filled avatar still mark the selection.

Contrast (verified):

| Element | Light | Dark |
|---|---|---|
| Body-colour initials on `bg-secondary/15` | 10.54:1 (9.43:1 on row hover) | 11.05:1 |
| Selected avatar, strong pair | 5.2:1 | 7.39:1 |
| Selected name, body colour on the row tint | 10.01:1 | 10.01:1 |
| Delete icon, `text-text-muted` on the row tint (needs 3:1) | 5.62:1 | 4.89:1 |

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/ClientList.jsx:71-72, 85-86, 116-120`
- Create: `Voyage-Client/tests/client-list-contrast.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/client-list-contrast.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/icons/index.js", () => ({
  SearchIcon: () => null,
  TrashIcon: () => null,
  UsersIcon: () => null,
}));

import ClientList from "../app/components/trip-dashboard/pages/ClientList.jsx";

const clients = [
  { id: "c1", name: "Elen Cruz", trips: [{ id: "t1" }] },
  { id: "c2", name: "Tenz Reyes", trips: [] },
];

function renderList() {
  return render(
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
}

const WHITE_TEXT = /(^|\s)(hover:)?text-white(\/\d+)?(\s|$)/;
const LIGHT_TERRACOTTA_TEXT = /(^|\s)text-secondary(\/\d+)?(\s|$)/;

describe("ClientList contrast", () => {
  it("draws the selected client's initials in the paired text colour on the strong terracotta", () => {
    renderList();
    const avatar = screen.getByText("EC");
    expect(avatar.className).toContain("bg-secondary-strong");
    expect(avatar.className).toContain("text-on-secondary-strong");
    expect(avatar.className).not.toMatch(WHITE_TEXT);
  });

  it("draws other clients' initials in the body colour on a light tint", () => {
    renderList();
    const avatar = screen.getByText("TR");
    expect(avatar.className).toContain("bg-secondary/15");
    expect(avatar.className).toContain("text-text-primary");
    expect(avatar.className).not.toMatch(WHITE_TEXT);
  });

  it("keeps the selected client's name in the body colour", () => {
    renderList();
    const name = screen.getByText("Elen Cruz");
    expect(name.className).toContain("text-text-primary");
    expect(name.className).toContain("font-black");
    expect(name.className).not.toMatch(LIGHT_TERRACOTTA_TEXT);
  });

  it("gives every delete button a visible icon colour and a themed danger hover", () => {
    renderList();
    const buttons = screen.getAllByTitle("Delete client record");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toContain("text-text-muted");
      expect(button.className).toContain("hover:text-status-danger");
      expect(button.className).toContain("hover:bg-status-danger/10");
      expect(button.className).not.toMatch(WHITE_TEXT);
      expect(button.className).not.toMatch(/#(fef2f2|dc2626)/);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads tests/client-list-contrast.test.jsx`
Expected: all 4 tests FAIL, because the classes are still `bg-secondary text-white`, `bg-secondary/40 text-white`, `text-secondary font-black`, and `text-white/60` / `hover:text-[#dc2626]`.

- [ ] **Step 3: Fix the avatar**

In `app/components/trip-dashboard/pages/ClientList.jsx`, replace:

```jsx
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-[0.85rem] shadow-[0_4px_10px_rgba(0,0,0,0.1)] transition-all duration-200 ${isSelected ? "bg-secondary text-white" : "bg-secondary/40 text-white"
                      }`}>
```

with:

```jsx
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-[0.85rem] shadow-[0_4px_10px_rgba(0,0,0,0.1)] transition-all duration-200 ${isSelected ? "bg-secondary-strong text-on-secondary-strong" : "bg-secondary/15 text-text-primary"
                      }`}>
```

- [ ] **Step 4: Fix the name**

Replace:

```jsx
                    <strong className={`block text-[0.95rem] font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-200 ${isSelected ? "text-secondary font-black" : "text-text-primary"
                      }`}>
```

with:

```jsx
                    <strong className={`block text-[0.95rem] tracking-tight whitespace-nowrap overflow-hidden text-ellipsis text-text-primary ${isSelected ? "font-black" : "font-bold"
                      }`}>
```

- [ ] **Step 5: Fix the delete button**

Replace:

```jsx
                    className={`border-none w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-200 flex-shrink-0 mr-1 ${isSelected
                      ? "bg-transparent text-white/60 hover:bg-white/15 hover:text-white"
                      : "bg-transparent text-text-soft hover:bg-[#fef2f2] hover:text-[#dc2626] hover:scale-110"
                      }`}
```

with:

```jsx
                    className="border-none w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-200 flex-shrink-0 mr-1 bg-transparent text-text-muted hover:bg-status-danger/10 hover:text-status-danger hover:scale-110"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/client-list-contrast.test.jsx tests/theme-safe-classes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/trip-dashboard/pages/ClientList.jsx tests/client-list-contrast.test.jsx
git commit -m "fix(itineraries): make client list avatars, names and delete icons readable in light mode" -m "Avatars were white on a pale terracotta tint (1.66:1), the selected row's delete icon white on its tint (1.18:1) and the selected name light terracotta (2.82:1). Use body-colour initials, the strong terracotta pair for the selected avatar, and a muted icon with a themed danger hover."
```

---

### Task 6: Show comment-load failures in the trip slide-over

**Why:** `fetchComments` in `TripSlideOver.jsx` catches each share's request with `.catch(() => [])`. A failed request therefore looks like "No comments yet", and the existing error box with its Retry button never appears. That is how Task 1's 400 went unnoticed.

The new behaviour:

| Comment requests | What the panel shows |
|---|---|
| All fail | "Couldn't load comments." with Retry |
| Some fail | The comments that loaded, plus "Some comments couldn't load." with Retry |
| The share list itself fails | "Couldn't load comments." with Retry |

Danger text on a 10% danger tint is 5.46:1 (light) and 5.32:1 (dark).

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx` (state near line 278, `fetchComments` near line 350, error/empty markup near lines 549–577, new `LoadAlert` component above `export default function TripSlideOver`)
- Create: `Voyage-Client/tests/trip-slide-over-comments.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/trip-slide-over-comments.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("../app/components/icons/index.js", () => ({
  ChatIcon: () => null,
  CloseIcon: () => null,
  ReplyIcon: () => null,
}));

vi.mock("../app/lib/api/client.js", () => ({
  API_URL: "/api",
  fetchApi: (...args) => mocks.fetchApi(...args),
}));

import TripSlideOver from "../app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx";

const comment = (shareId) => ({
  id: `c-${shareId}`,
  content: `Comment on ${shareId}`,
  status: "PENDING",
  authorName: "Ana",
  createdAt: "2026-10-02T02:00:00.000Z",
});

/** Two shares. `failing` lists share ids whose comment request rejects; `sharesFail` rejects the share list. */
function serve({ failing = [], sharesFail = false } = {}) {
  mocks.fetchApi.mockImplementation((path) => {
    const match = /\/shares\/([^/]+)\/comments$/.exec(String(path));
    if (match) {
      if (failing.includes(match[1])) return Promise.reject(new Error("Request validation failed."));
      return Promise.resolve({ comments: [comment(match[1])] });
    }
    if (sharesFail) return Promise.reject(new Error("Request validation failed."));
    return Promise.resolve({ shares: [{ id: "s-1" }, { id: "s-2" }] });
  });
}

function renderPanel() {
  return render(<TripSlideOver isOpen onClose={() => {}} agencyId="agency-1" tripId="t-1" tripTitle="Kyoto" />);
}

beforeEach(() => {
  mocks.fetchApi.mockReset();
});

describe("TripSlideOver comment loading", () => {
  it("shows every share's comments when all requests succeed", async () => {
    serve();
    renderPanel();
    expect(await screen.findByText("Comment on s-1")).toBeInTheDocument();
    expect(screen.getByText("Comment on s-2")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an error with Retry, not an empty inbox, when every comment request fails", async () => {
    serve({ failing: ["s-1", "s-2"] });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load comments.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No comments yet")).not.toBeInTheDocument();
  });

  it("keeps what loaded and says some comments are missing when only some requests fail", async () => {
    serve({ failing: ["s-2"] });
    renderPanel();
    expect(await screen.findByText("Comment on s-1")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Some comments couldn't load.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No comments yet")).not.toBeInTheDocument();
  });

  it("reports an error when the share list itself fails", async () => {
    serve({ sharesFail: true });
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load comments.");
  });

  it("loads again when Retry is pressed", async () => {
    serve({ failing: ["s-1", "s-2"] });
    renderPanel();
    const alert = await screen.findByRole("alert");

    serve();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Comment on s-1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx`

Expected:
- "shows every share's comments…" PASSES.
- The other 4 FAIL: `findByRole("alert")` times out, or no alert is present. Today the error box has no `role="alert"`, a failure shows "No comments yet", and the share-list error says "Request validation failed.".

- [ ] **Step 3: Add the shared alert component**

In `TripSlideOver.jsx`, directly above the doc comment that starts `` /** `returnFocusRef` (optional) names where focus goes on close…`` (the one above `export default function TripSlideOver(`), add:

```jsx
// ─── Load failure notice ─────────────────────────────────────────────────────

function LoadAlert({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="rounded-[12px] bg-status-danger/10 border border-status-danger/20 px-4 py-3 text-sm text-status-danger flex items-center gap-2"
    >
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="font-bold underline hover:no-underline">
        Retry
      </button>
    </div>
  );
}

```

- [ ] **Step 4: Track partial failures**

Replace:

```jsx
  const [error, setError] = useState(null);
  const closeButtonRef = useRef(null);
```

with:

```jsx
  const [error, setError] = useState(null);
  // Some shares' comments failed to load; the rest are shown.
  const [partialError, setPartialError] = useState(false);
  const closeButtonRef = useRef(null);
```

Replace the whole `fetchComments` callback:

```jsx
  const fetchComments = useCallback(async () => {
    if (!agencyId || !tripId) return;
    setLoading(true);
    setError(null);
    try {
      const sharesRes = await listTripShares(agencyId, tripId);
      const shares = Array.isArray(sharesRes?.shares) ? sharesRes.shares : [];

      const commentArrays = await Promise.all(
        shares.map((share) =>
          listShareComments(agencyId, share.id)
            .then((r) =>
              Array.isArray(r?.comments)
                ? r.comments.map((c) => ({ ...c, shareId: share.id }))
                : [],
            )
            .catch(() => []),
        ),
      );
      setComments(commentArrays.flat());
    } catch (err) {
      setError(err?.message || "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [agencyId, tripId]);
```

with:

```jsx
  const fetchComments = useCallback(async () => {
    if (!agencyId || !tripId) return;
    setLoading(true);
    setError(null);
    setPartialError(false);
    try {
      const sharesRes = await listTripShares(agencyId, tripId);
      const shares = Array.isArray(sharesRes?.shares) ? sharesRes.shares : [];

      // allSettled, not a per-request catch: a failed request must not pass
      // for a share with no comments.
      const results = await Promise.allSettled(
        shares.map((share) => listShareComments(agencyId, share.id)),
      );
      const loaded = results.flatMap((result, index) =>
        result.status === "fulfilled" && Array.isArray(result.value?.comments)
          ? result.value.comments.map((c) => ({ ...c, shareId: shares[index].id }))
          : [],
      );
      const failed = results.filter((result) => result.status === "rejected").length;

      if (failed > 0 && failed === results.length) {
        setComments([]);
        setError("Couldn't load comments.");
      } else {
        setComments(loaded);
        setPartialError(failed > 0);
      }
    } catch {
      setComments([]);
      setError("Couldn't load comments.");
    } finally {
      setLoading(false);
    }
  }, [agencyId, tripId]);
```

- [ ] **Step 5: Render the alerts and hide the empty state on partial failure**

Replace:

```jsx
          {/* Error */}
          {!loading && error && (
            <div className="rounded-[12px] bg-status-danger/10 border border-status-danger/20 px-4 py-3 text-sm text-status-danger flex items-center gap-2">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={fetchComments}
                className="font-bold underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && grouped.length === 0 && (
```

with:

```jsx
          {/* Error */}
          {!loading && error && <LoadAlert message={error} onRetry={fetchComments} />}

          {/* Some shares' comments failed; what loaded is listed below */}
          {!loading && !error && partialError && (
            <LoadAlert message="Some comments couldn't load." onRetry={fetchComments} />
          )}

          {/* Empty state */}
          {!loading && !error && !partialError && grouped.length === 0 && (
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/trip-slide-over-comments.test.jsx tests/trip-slide-over-focus.test.jsx`
Expected: PASS (both files; the focus tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/TripSlideOver.jsx" tests/trip-slide-over-comments.test.jsx
git commit -m "fix(dashboard): show comment load failures in the trip slide-over" -m "Each share's comment request was caught as an empty list, so a failure read as 'No comments yet' and the Retry box never showed. Use allSettled: everything failed -> error with Retry; some failed -> the loaded comments plus a Retry notice."
```

---

### Task 7: Keep long day popovers inside the calendar card

**Why:** `CalendarDayPopover`'s `place()` moves the floating popover up to fit inside the calendar card, but nothing limits its height. A day with 8 or more items (e.g. 2026-05-29 in QA) runs past the bottom of the card and the frame.

The fix:
- Cap the floating variant at the card's height. `max-h-[calc(100%-8px)]` works because the popover is absolutely positioned inside `section.relative` in `AgencyCalendar.jsx`, so the percentage resolves against the card.
- Keep the header fixed and let the item list scroll.
- Leave the inline (phone) variant uncapped, because it grows with the page.

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx:93-96, 104, 127`
- Modify: `Voyage-Client/tests/calendar-day-popover.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tests/calendar-day-popover.test.jsx`, add inside `describe("CalendarDayPopover", ...)`:

```jsx
  it("caps the floating popover at the card's height and scrolls its list", () => {
    render(
      <CalendarDayPopover
        cell={cellFor([kyoto, osaka], "2026-10-08")}
        todayKey="2026-10-03"
        anchorEl={document.createElement("button")}
        containerEl={document.createElement("div")}
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100%-8px)]");
    expect(dialog.className).toContain("flex-col");
    const list = within(dialog).getByRole("list");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("min-h-0");
  });

  it("lets the inline popover grow with the page", () => {
    render(
      <CalendarDayPopover
        cell={cellFor([kyoto], "2026-10-08")}
        todayKey="2026-10-03"
        anchorEl={null}
        containerEl={null}
        inline
        onClose={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog").className).not.toContain("max-h-");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads tests/calendar-day-popover.test.jsx`
Expected: "caps the floating popover…" FAILS (no `max-h-[calc(100%-8px)]`). "lets the inline popover grow…" PASSES; it guards the inline variant.

- [ ] **Step 3: Cap the floating popover**

In `CalendarDayPopover.jsx`, replace:

```jsx
      className={
        inline
          ? "frame-tile mt-3 rounded-[16px] p-3"
          : "frame-popover frame-pop-in absolute z-30 w-[260px] rounded-[16px] p-3"
      }
```

with:

```jsx
      className={
        inline
          ? "frame-tile mt-3 rounded-[16px] p-3"
          : // Capped at the calendar card (its positioned parent) so place() can always fit it; the list scrolls.
            "frame-popover frame-pop-in absolute z-30 flex max-h-[calc(100%-8px)] w-[260px] flex-col rounded-[16px] p-3"
      }
```

Keep the header from shrinking. Replace:

```jsx
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={titleId}
```

with:

```jsx
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={titleId}
```

Make the list the scrolling part. Replace:

```jsx
        <ul className="mt-2 divide-y divide-[color:var(--frame-border)]">
```

with:

```jsx
        <ul className="mt-2 min-h-0 flex-1 divide-y divide-[color:var(--frame-border)] overflow-y-auto overscroll-contain">
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/calendar-day-popover.test.jsx tests/agency-calendar.test.jsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/CalendarDayPopover.jsx" tests/calendar-day-popover.test.jsx
git commit -m "fix(dashboard): keep long day popovers inside the calendar card" -m "A busy day ran the floating popover past the bottom of the card. Cap it at the card's height and scroll the item list under a fixed header; the inline phone variant still grows with the page."
```

---

### Task 8: Keep the space in "Save to Client"

**Why:** The header button is `inline-flex`, and its label is `Save<span> to Client</span>`. That makes the bare "Save" text and the `<span>` two separate flex items, and a flex item drops its leading space. So the button renders as "Saveto Client". Wrapping the label in one `<span>` keeps it a single inline run.

jsdom has no layout, so the test pins the structure: one label child.

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/layout/DashboardHeader.jsx:111`
- Modify: `Voyage-Client/tests/dashboard-rail.test.jsx`

- [ ] **Step 1: Write the failing test**

In `tests/dashboard-rail.test.jsx`, add inside `describe("DashboardHeader", ...)`:

```jsx
  it("gives the flex Save button a single label child, so “Save to Client” keeps its space", () => {
    render(
      <DashboardHeader
        variant="full"
        activeTab="command-center"
        isSidebarOpen={false}
        setIsSidebarOpen={() => {}}
        isClientMenuOpen={false}
        setIsClientMenuOpen={() => {}}
        clientMenuRef={{ current: null }}
        safeOptions={[]}
        getInitials={() => ""}
        canApproveDraft
        onApproveDraft={() => {}}
      />,
    );

    const save = screen.getByRole("button", { name: "Save to Client" });
    // A bare "Save" text node beside a <span> makes two flex items, and a flex
    // item drops its leading space, which rendered "Saveto Client".
    expect(save.childNodes).toHaveLength(1);
    expect(save.firstChild.textContent).toBe("Save to Client");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx`
Expected: the new test FAILS with `expected [ …(2) ] to have a length of 1 but got 2`.

- [ ] **Step 3: Wrap the label**

In `DashboardHeader.jsx`, replace:

```jsx
                Save<span className="max-[900px]:hidden"> to Client</span>
```

with:

```jsx
                {/* One inline label: as two flex items, "to Client" would lose its leading space. */}
                <span>
                  Save<span className="max-[900px]:hidden"> to Client</span>
                </span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-rail.test.jsx tests/home-page-dashboard-tab.test.jsx`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/layout/DashboardHeader.jsx tests/dashboard-rail.test.jsx
git commit -m "fix(header): keep the space in Save to Client" -m "The flex button split 'Save' and ' to Client' into two flex items, which drops the leading space. Wrap the label in one span."
```

---

### Task 9: Use the compact empty state for "Latest reviews"

**Why:** The Insights column is narrow. `RatingsPanel` renders the full-size `EmptyState`, whose heading is a faux-bold serif with large padding. `EmptyState` already has a `compact` variant made for this column.

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx:49`
- Modify: `Voyage-Client/tests/dashboard-insights-widgets.test.jsx`

- [ ] **Step 1: Write the failing test**

In `tests/dashboard-insights-widgets.test.jsx`, add inside `describe("RatingsPanel", ...)`, after `"explains when reviews will appear"`:

```jsx
  it("uses the compact empty state in the narrow Insights column", () => {
    render(<RatingsPanel reviews={[]} />);
    const heading = screen.getByText("Reviews appear after trips complete.");
    expect(heading.className).toContain("font-sans");
    expect(heading.className).not.toContain("font-extrabold");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads tests/dashboard-insights-widgets.test.jsx`
Expected: the new test FAILS (the heading has `font-extrabold`, not `font-sans`).

- [ ] **Step 3: Pass `compact`**

In `RatingsPanel.jsx`, replace:

```jsx
          <EmptyState variant="ratings" />
```

with:

```jsx
          <EmptyState variant="ratings" compact />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-insights-widgets.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/RatingsPanel.jsx" tests/dashboard-insights-widgets.test.jsx
git commit -m "fix(dashboard): use the compact empty state for Latest reviews"
```

---

### Task 10: Read Needs-you tones aloud as words

**Why:** `WorklistRow` puts the raw tone key (`info`, `warning`, `danger`, `success`) in an sr-only span, so screen readers announce "warning" before each row. The tones come from `needsYouItems.js`:

| Tone | Used for | New label |
|---|---|---|
| `danger` | low-rated trips | "Urgent" |
| `warning` | expiring shares, stuck drafts | "Needs attention" |
| `success` | trips starting soon | "Coming up" |
| `info` | unread comments, viewed-not-replied | none; the title says it all |

**Files:**
- Modify: `Voyage-Client/app/agency/[agencyId]/components/dashboard/widgets/WorklistRow.jsx:9-10, 17-29, 92`
- Modify: `Voyage-Client/tests/dashboard-worklist-row.test.jsx:26-31, 69-73`

- [ ] **Step 1: Update the tests**

In `tests/dashboard-worklist-row.test.jsx`, replace:

```jsx
  it("includes a screen-reader status label paired with the tone color (not color-only)", () => {
    const { container } = renderRow({ tone: "warning" });
    const srLabel = container.querySelector(".sr-only");
    expect(srLabel).toBeTruthy();
    expect(srLabel.textContent.toLowerCase()).toContain("warning");
  });
```

with:

```jsx
  it.each([
    ["warning", "Needs attention"],
    ["danger", "Urgent"],
    ["success", "Coming up"],
  ])("names the %s tone for screen readers in words (“%s”), not the raw key", (tone, label) => {
    const { container } = renderRow({ tone });
    expect(container.querySelector(".sr-only").textContent).toBe(label);
  });

  it("adds no tone label to plain info rows", () => {
    const { container } = renderRow({ tone: "info" });
    expect(container.querySelector(".sr-only")).toBeNull();
  });
```

and replace:

```jsx
  it("shows the row's kind as an icon, keeping the tone label for screen readers", () => {
    const { container } = renderRow({ kind: "unreadComments" });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".sr-only").textContent).toBe("info");
  });
```

with:

```jsx
  it("shows the row's kind as an icon, keeping the tone label for screen readers", () => {
    const { container } = renderRow({ kind: "unreadComments", tone: "warning" });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".sr-only").textContent).toBe("Needs attention");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-row.test.jsx`
Expected FAILs:
- the 3 `it.each` cases (they get "warning", "danger" or "success");
- "adds no tone label…" (it gets a span reading "info");
- "shows the row's kind as an icon…" (it gets "warning").

- [ ] **Step 3: Map tones to words**

In `WorklistRow.jsx`, replace the doc-comment bullet:

```js
 * - Leading badge: the row's kind as an icon on a tone-tinted circle, plus an
 *   sr-only tone label, so the meaning never rests on colour alone.
```

with:

```js
 * - Leading badge: the row's kind as an icon on a tone-tinted circle, plus an
 *   sr-only label for tones that carry meaning (info rows need none), so the
 *   meaning never rests on colour alone.
```

After the `TONE_DOT_CLASS` object (the block that ends with `danger: "bg-status-danger",` and `};`), add:

```js
/** What a tone means, read by screen readers. Info rows get no label. */
const TONE_LABEL = {
  success: "Coming up",
  warning: "Needs attention",
  danger: "Urgent",
};
```

Replace:

```jsx
        <span className="sr-only">{tone}</span>
```

with:

```jsx
        {TONE_LABEL[tone] ? <span className="sr-only">{TONE_LABEL[tone]}</span> : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/dashboard-worklist-row.test.jsx tests/dashboard-worklist-context.test.js`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add "app/agency/[agencyId]/components/dashboard/widgets/WorklistRow.jsx" tests/dashboard-worklist-row.test.jsx
git commit -m "fix(dashboard): read Needs-you tones aloud as words" -m "Screen readers announced the raw tone key ('warning', 'info') before each row. Say 'Urgent', 'Needs attention' or 'Coming up', and nothing for info rows."
```

---

### Task 11: Version the PWA icon URLs so installed apps pick up the new logo

**Why:** Commit `4b35ff8` replaced the icon images (they are live in production) but kept the same URLs, and `manifest.json` did not change at all. As a result:
- iOS snapshots `apple-touch-icon` at "Add to Home Screen", and Safari can reuse the cached copy when the app is re-added.
- Chrome and Android only refresh an installed icon when the manifest changes. When they re-fetch the icons, the service worker (cache-first for images) can serve the old ones.

Adding `?v=2` to every icon URL changes the manifest and bypasses old caches. Two related changes:
- An explicit `"id": "/"` pins the app identity. Chrome already derives it from `start_url` `/`, so existing installs stay the same app.
- The manifest lists two screenshots that don't exist (404), so they are removed.

**Files:**
- Modify: `Voyage-Client/public/manifest.json`
- Modify: `Voyage-Client/app/layout.jsx:32-42`
- Modify: `Voyage-Client/public/sw.js:1`
- Create: `Voyage-Client/tests/pwa-icons.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/pwa-icons.test.js`:

```js
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Plus_Jakarta_Sans: () => ({ variable: "font-sans" }),
  DM_Serif_Display: () => ({ variable: "font-serif" }),
}));
vi.mock("../app/components/theme/ThemeProvider", () => ({ default: ({ children }) => children }));

import { metadata } from "../app/layout.jsx";

const publicFile = (path) => fileURLToPath(new URL(`../public${path}`, import.meta.url));
const manifest = JSON.parse(readFileSync(publicFile("/manifest.json"), "utf8"));

/** Bump (here, in public/manifest.json and in app/layout.jsx) whenever the icon artwork changes. */
const ICON_VERSION = "?v=2";

const withoutQuery = (url) => url.split("?")[0];

describe("PWA icons", () => {
  it("pins the app id, so installs stay the same app", () => {
    expect(manifest.id).toBe("/");
  });

  it("versions every manifest icon URL, so installed apps notice new artwork", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.endsWith(ICON_VERSION), icon.src).toBe(true);
      expect(existsSync(publicFile(withoutQuery(icon.src))), icon.src).toBe(true);
    }
  });

  it("uses the same versioned URLs for the page's icon links", () => {
    const urls = [
      ...metadata.icons.icon.map((icon) => icon.url),
      ...metadata.icons.apple.map((icon) => icon.url),
      metadata.icons.shortcut,
    ];
    for (const url of urls) {
      expect(url.endsWith(ICON_VERSION), url).toBe(true);
      expect(existsSync(publicFile(withoutQuery(url))), url).toBe(true);
    }
  });

  it("lists only screenshots that exist", () => {
    for (const shot of manifest.screenshots ?? []) {
      expect(existsSync(publicFile(withoutQuery(shot.src))), shot.src).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --pool=threads tests/pwa-icons.test.js`

Expected FAILs:
- "pins the app id": `manifest.id` is undefined.
- "versions every manifest icon URL" and "uses the same versioned URLs": no `?v=2`.
- "lists only screenshots that exist": `/icons/screenshot-mobile.png` is missing.

If the file fails to *load* instead, read the error. `app/layout.jsx` should only need the two mocks above; add a `vi.mock` for any other import that pulls in browser-only code.

- [ ] **Step 3: Update the manifest**

Replace the whole of `public/manifest.json` with:

```json
{
  "id": "/",
  "name": "Voyage Planner",
  "short_name": "Voyage",
  "description": "Intelligent itinerary-first travel planning for travel professionals.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#eff1f3",
  "theme_color": "#223843",
  "categories": ["travel", "productivity", "business"],
  "prefer_related_applications": false,
  "icons": [
    {
      "src": "/icons/icon-192.png?v=2",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png?v=2",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-192.png?v=2",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-maskable-512.png?v=2",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icon.svg?v=2",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

- [ ] **Step 4: Update the page's icon links**

In `app/layout.jsx`, replace:

```jsx
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png",
  },
```

with:

```jsx
  // `?v=` must match public/manifest.json. Bump both when the icon artwork
  // changes, or installed apps and iOS keep showing the old icon.
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/icons/icon-192.png?v=2",
  },
```

- [ ] **Step 5: Bump the service worker cache**

In `public/sw.js`, replace:

```js
const CACHE_VERSION = 'v6';
```

with:

```js
const CACHE_VERSION = 'v7';
```

The bump makes the new worker delete the old caches when it activates. That includes the stale-while-revalidate copy of `manifest.json`, so the browser's next manifest check gets the new one straight away.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads tests/pwa-icons.test.js tests/service-worker-routing.test.js`
Expected: PASS (both files).

- [ ] **Step 7: Commit**

```bash
git add public/manifest.json app/layout.jsx public/sw.js tests/pwa-icons.test.js
git commit -m "fix(pwa): version icon URLs so installed apps pick up the new logo" -m "The Hops icons replaced the old files under the same URLs and the manifest was unchanged, so installed apps never saw an update. Add ?v=2 to every icon URL, pin the manifest id to '/', drop the two screenshots that 404, and bump the service worker cache to v7."
```

---

### Task 12: Verify everything

**Files:** none (verification only; commit only if a fix is needed).

- [ ] **Step 1: Full client test suite**

Run (in `Voyage-Client/`): `npx vitest run --pool=threads`
Expected: only the 8 baseline files fail: `agent-command-center-places` (1 test), plus the 7 that fail to load from `app/components/icons/index.js`. Every new and changed test file passes.

- [ ] **Step 2: Client production build**

Run: `npx next build`
Expected: the build completes with no errors. Next 16 keeps dev output in `.next/dev`, so this doesn't disturb a running `next dev`.

- [ ] **Step 3: Full server test suite and type-check**

Run (in `Voyage-Server/`): `npx vitest run`, then `npm run build`
Expected: only the 4 baseline files fail; `tsc` exits 0.

- [ ] **Step 4: Browser check (owner account, light and dark)**

Restart the backend dev server first; hot reload is unreliable in OneDrive. Then on `http://localhost:3000`:

1. **Admin:** the active tab (Agencies) and the active filter (All) read clearly in dark mode, as dark text on a light pill. A Reports badge, if one is shown, is readable in both themes.
2. **Command Center header:** in dark mode, the "New agent thread" pill shows readable initials, and so does every avatar in its dropdown. The button reads "Save to Client" with a space.
3. **Settings:** the ACTIVE and VERIFIED pills are readable in light mode.
4. **Itineraries:** in light mode, the client avatars, the selected client's name and the selected row's delete icon are all clearly visible.
5. **Dashboard:**
   - Open a calendar day that has a comment, then press "Reply" or "Open trip". The slide-over lists the comments, and the Network tab shows `GET …/shares/<cuid>/comments` returning 200.
   - Go back to May 2026 and open May 29. The popover stays inside the calendar card, and its list scrolls.
6. **Optional automated scan:** with the QA Chrome running on `--remote-debugging-port=9333` and signed in, run `node themescan.mjs` then `node summarize.mjs` in the session scratchpad's `qa/` folder. Nothing should be below 3:1 apart from the out-of-scope Command Center items (chat avatars, Stop button).

- [ ] **Step 5: PWA (after the branch is merged and deployed)**

- **iPhone:** remove the Home Screen app, then add it again from Safari (Share → Add to Home Screen). It shows the new "Hops" icon.
- **Android:** open the installed app. Within about a day Chrome offers an icon update; uninstalling and reinstalling is the fastest route.
