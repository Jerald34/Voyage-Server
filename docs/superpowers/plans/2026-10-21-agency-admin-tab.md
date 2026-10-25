# Agency Admin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agency owners and admins a dedicated "Agency" sidebar tab (Overview · Team · Profile · Plan and usage) and move the agency tools out of Settings.

**Architecture:** Client-only change in `Voyage-Client`. The new tab is a sibling of the platform Admin tab in `HomePage.jsx`. It reuses `AdminTopBar` and `SegmentedControl`, the existing `TeamPage`, `PlanUsageCard` and `DangerZoneCard`, and a new `AgencyDetailsForm` extracted from `SettingsPage`. The Overview's rules are pure functions in `app/lib/agency-admin/`. No server or schema changes: every number comes from endpoints that already exist.

**Tech Stack:** Next.js (app router, client components), React 19, Tailwind v4 tokens from `globals.css`, Vitest 4 + React Testing Library + jsdom.

**Branch:** Do not create or switch branches. Ask the user which branch to work on. The user manages branches in GitHub Desktop. Commit messages carry no `Co-Authored-By` line.

---

## Design decisions (approved in chat 2026-10-21)

1. **Placement (option A):** a new "Agency" item in the sidebar rail, after Itineraries. Only ACTIVE `OWNER` or `ADMIN` members of an agency workspace see it. Staff and personal accounts never do. The platform "Admin" tab stays super-admin only and is unchanged.
2. **Sections:** Overview, Team, Profile, Plan and usage. Plan and usage is owner-only, because `GET /agencies/:id/dashboard/plan-usage` is `requireAgencyOwner`.
3. **Overview (option A): status, numbers, needs attention.**
   - **Status:** a pill for `agency.status` (VERIFIED → "Verified", PENDING_REVIEW → "Pending review", SUSPENDED → "Suspended", REJECTED → "Rejected"), plus "Owner: <name>" taken from the team list. There is no approval date, because the client has no `verifiedAt` and we add no server change for it.
   - **Owner tiles:** Team members, Itineraries this month, Messages to the agent, Plan that fits ("Custom" when no plan fits).
   - **Admin tiles:** Team members, Pending invitations.
   - **Needs attention rows**, each with a button that opens the section that fixes it:
     - pending invitations → Team;
     - owner only: required agency details missing (business phone, city or country, the fields the form requires) → Profile;
     - owner only: this month's itineraries at 80% or more of the fitting plan's limit, or above every plan → Plan and usage.
   - When there are no rows, the list says "Nothing needs your attention right now."
4. **Profile:** the agency details form. Owners can edit it; admins see it read-only, as today. The Danger zone (transfer ownership, delete agency) sits at the bottom, owner only.
5. **Settings becomes personal for managers.** For an ACTIVE owner or admin, Settings drops Agency details, Team, Plan and usage and Danger zone. A small "Agency" panel with an "Open Agency" button takes their place. **Staff Settings is unchanged:** read-only agency details plus the read-only Team list. Staff keep seeing their teammates, and this is the only way they can.
6. **Deep links:**
   - `?tab=agency` opens the Agency tab.
   - `?tab=team` (no `invited=1`) opens Agency → Team for managers. Everyone else falls back to Settings, scrolled to Team, as today.
   - `?tab=team&invited=1` is unchanged (it opens the Dashboard with the joined notice).
7. **Legacy route:** `/agency/[agencyId]/settings` redirects to `/?authenticated=1&tab=agency`, and the old `AgencySettingsPage` component is deleted.
8. **Type rule:** the agency name in the top bar is the page's main title, so it uses the serif (AdminTopBar already does this). Every other heading uses `font-sans font-semibold tracking-normal`: 15px for card titles.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/lib/agency-admin/roles.js` | create | `canManageAgency(membership)`: ACTIVE owner or admin |
| `app/lib/agency-admin/overview.js` | create | Pure Overview rules: status labels, missing details, plan percent, attention rows |
| `app/components/settings/settingsFields.jsx` | create | `Panel`, `Field`, `TextInputField`, `getFieldClass`, `getStatusClass`, `formatReadOnlyValue`, moved out of SettingsPage |
| `app/components/settings/AgencyDetailsForm.jsx` | create | Agency profile form (state, validation, save), moved out of SettingsPage |
| `app/components/agency-admin/AgencyOverview.jsx` | create | Fetches team, invitations and usage, then renders status, tiles and attention rows |
| `app/components/agency-admin/AgencyAdminPage.jsx` | create | Top bar, section tabs, role gating, renders each section |
| `app/lib/deepLinks.js` | modify | `tab=agency`, `tab=team` → agency, `resolveVisibleTab` gating |
| `app/components/trip-dashboard/pages/SettingsPage.jsx` | modify | Use extracted pieces; managers get the "Open Agency" panel |
| `app/components/trip-dashboard/layout/DashboardSidebar.jsx` | modify | "Agency" rail item + icon |
| `app/components/trip-dashboard/HomePage.jsx` | modify | Render `AgencyAdminPage`, pass membership to `resolveVisibleTab`, wire `onOpenAgency` |
| `app/agency/[agencyId]/settings/page.jsx` | modify | Redirect to `/?authenticated=1&tab=agency` |
| `app/components/settings/AgencySettingsPage.jsx` | delete | Superseded by the Agency tab |
| `tests/agency-admin-rules.test.js` | create | roles + overview rules |
| `tests/agency-details-form.test.jsx` | create | Form behaviour (incl. the moved normalisation test) |
| `tests/agency-overview.test.jsx` | create | Overview rendering per role |
| `tests/agency-admin-page.test.jsx` | create | Tabs, gating, section switching |
| `tests/deep-links.test.js`, `tests/dashboard-rail.test.jsx`, `tests/settings-team.test.jsx`, `tests/settings-plan-and-requirements.test.jsx`, `tests/home-page.test.jsx`, `tests/agency-invite-landing.test.jsx` | modify | Follow the moves |

All paths below are relative to `Voyage-Client/`. Run one test file with `npx vitest run tests/<file>`; run everything with `npm test`.

---

### Task 0: Record the test baseline

- [ ] **Step 1: Run the full suite before touching anything**

Run: `npm test 2>&1 | tail -40`

Write down which test files fail. Those are pre-existing failures. Later tasks must not add new ones, and the final check (Task 9) compares against this list.

---

### Task 1: Role and Overview rules

**Files:**
- Create: `app/lib/agency-admin/roles.js`
- Create: `app/lib/agency-admin/overview.js`
- Test: `tests/agency-admin-rules.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/agency-admin-rules.test.js
import { describe, expect, it } from "vitest";
import { canManageAgency } from "../app/lib/agency-admin/roles.js";
import {
  NEAR_LIMIT_PERCENT,
  agencyStatusLabel,
  buildAttentionItems,
  missingAgencyDetails,
  planUsagePercent,
} from "../app/lib/agency-admin/overview.js";
import { PLANS } from "../app/lib/pricing/plans.js";

const starter = PLANS.find((plan) => plan.id === "starter");
const complete = { businessPhone: "639001112222", city: "Baguio", country: "Philippines" };

describe("canManageAgency", () => {
  it.each([
    [{ role: "OWNER", status: "ACTIVE" }, true],
    [{ role: "ADMIN", status: "ACTIVE" }, true],
    [{ role: "STAFF", status: "ACTIVE" }, false],
    [{ role: "OWNER", status: "PENDING" }, false],
    [null, false],
    [undefined, false],
  ])("%j → %s", (membership, expected) => {
    expect(canManageAgency(membership)).toBe(expected);
  });
});

describe("agencyStatusLabel", () => {
  it.each([
    ["VERIFIED", "Verified"],
    ["PENDING_REVIEW", "Pending review"],
    ["SUSPENDED", "Suspended"],
    ["REJECTED", "Rejected"],
    [undefined, "Unknown"],
  ])("%s → %s", (status, label) => {
    expect(agencyStatusLabel(status)).toBe(label);
  });
});

describe("missingAgencyDetails", () => {
  it("lists the required fields that are empty or blank", () => {
    expect(missingAgencyDetails({ businessPhone: " ", city: "Baguio", country: "" })).toEqual(["business phone", "country"]);
  });

  it("ignores the optional business email", () => {
    expect(missingAgencyDetails({ ...complete, businessEmail: "" })).toEqual([]);
  });

  it("treats a missing agency as all fields missing", () => {
    expect(missingAgencyDetails(null)).toEqual(["business phone", "city", "country"]);
  });
});

describe("planUsagePercent", () => {
  it("is this month's itineraries over the plan's monthly limit, rounded", () => {
    expect(planUsagePercent({ itinerariesCreated: 12 }, starter)).toBe(80);
    expect(planUsagePercent({ itinerariesCreated: 5 }, starter)).toBe(33);
  });

  it("is null without usage or a plan", () => {
    expect(planUsagePercent(null, starter)).toBeNull();
    expect(planUsagePercent({ itinerariesCreated: 3 }, null)).toBeNull();
  });
});

describe("buildAttentionItems", () => {
  it("is empty when nothing needs attention", () => {
    expect(buildAttentionItems({ agency: complete, invitations: [], usage: { itinerariesCreated: 1, activeMembers: 1 }, isOwner: true })).toEqual([]);
  });

  it("counts pending invitations, singular and plural, for owners and admins", () => {
    expect(buildAttentionItems({ agency: complete, invitations: [{ id: "i1" }] })[0]).toEqual({
      id: "invites",
      text: "1 invitation is still pending",
      section: "team",
      action: "Open team",
    });
    expect(buildAttentionItems({ agency: complete, invitations: [{ id: "i1" }, { id: "i2" }] })[0].text).toBe("2 invitations are still pending");
  });

  it("flags missing details for owners only", () => {
    const agency = { ...complete, city: "" };
    expect(buildAttentionItems({ agency, isOwner: true })).toEqual([
      { id: "details", text: "Agency details are missing: city", section: "profile", action: "Edit profile" },
    ]);
    expect(buildAttentionItems({ agency, isOwner: false })).toEqual([]);
  });

  it(`flags usage at ${NEAR_LIMIT_PERCENT}% or more of the fitting plan`, () => {
    expect(buildAttentionItems({ agency: complete, usage: { itinerariesCreated: 12, activeMembers: 2 }, isOwner: true })).toEqual([
      { id: "plan", text: "Usage is at 80% of the Starter plan", section: "plan", action: "See plan" },
    ]);
    expect(buildAttentionItems({ agency: complete, usage: { itinerariesCreated: 11, activeMembers: 2 }, isOwner: true })).toEqual([]);
  });

  it("flags usage above every plan", () => {
    expect(buildAttentionItems({ agency: complete, usage: { itinerariesCreated: 500, activeMembers: 2 }, isOwner: true })).toEqual([
      { id: "plan", text: "This month's usage is above every plan", section: "plan", action: "See plan" },
    ]);
  });

  it("orders rows invitations, details, plan", () => {
    const items = buildAttentionItems({
      agency: { ...complete, country: "" },
      invitations: [{ id: "i1" }],
      usage: { itinerariesCreated: 14, activeMembers: 2 },
      isOwner: true,
    });
    expect(items.map((item) => item.id)).toEqual(["invites", "details", "plan"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/agency-admin-rules.test.js`
Expected: FAIL. Vite reports it can't resolve `../app/lib/agency-admin/roles.js`.

- [ ] **Step 3: Write the two modules**

```js
// app/lib/agency-admin/roles.js
/** Owners and admins with an active membership run the agency: they get the Agency tab. */
export function canManageAgency(membership) {
  return membership?.status === "ACTIVE" && (membership.role === "OWNER" || membership.role === "ADMIN");
}
```

```js
// app/lib/agency-admin/overview.js
import { suggestPlan } from "../pricing/plans.js";

/** Usage at or above this share of the fitting plan's monthly itineraries earns a "Needs attention" row. */
export const NEAR_LIMIT_PERCENT = 80;

const STATUS_LABELS = {
  VERIFIED: "Verified",
  PENDING_REVIEW: "Pending review",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
};

export function agencyStatusLabel(status) {
  return STATUS_LABELS[status] ?? "Unknown";
}

// The fields AgencyDetailsForm refuses to save empty. Business email is optional there.
const REQUIRED_DETAILS = [
  ["businessPhone", "business phone"],
  ["city", "city"],
  ["country", "country"],
];

/** The required agency fields that are still empty, as lower-case labels. */
export function missingAgencyDetails(agency) {
  return REQUIRED_DETAILS.filter(([key]) => !String(agency?.[key] ?? "").trim()).map(([, label]) => label);
}

/** This month's itineraries as a whole percent of the plan's monthly limit, or null without both. */
export function planUsagePercent(usage, plan) {
  if (!usage || !plan) return null;
  const itineraries = Number(usage.itinerariesCreated) || 0;
  return Math.round((itineraries / plan.itinerariesPerMonth) * 100);
}

/**
 * The Overview's "Needs attention" rows, most actionable first. Each row names the
 * Agency section that fixes it. `usage` is null for admins: plan usage is owner-only.
 */
export function buildAttentionItems({ agency, invitations = [], usage = null, isOwner = false }) {
  const items = [];

  if (invitations.length > 0) {
    const count = invitations.length;
    items.push({
      id: "invites",
      text: `${count} ${count === 1 ? "invitation is" : "invitations are"} still pending`,
      section: "team",
      action: "Open team",
    });
  }

  if (isOwner) {
    const missing = missingAgencyDetails(agency);
    if (missing.length > 0) {
      items.push({ id: "details", text: `Agency details are missing: ${missing.join(", ")}`, section: "profile", action: "Edit profile" });
    }
  }

  if (isOwner && usage) {
    const plan = suggestPlan({ itineraries: usage.itinerariesCreated, members: usage.activeMembers });
    if (!plan) {
      items.push({ id: "plan", text: "This month's usage is above every plan", section: "plan", action: "See plan" });
    } else if (planUsagePercent(usage, plan) >= NEAR_LIMIT_PERCENT) {
      items.push({ id: "plan", text: `Usage is at ${planUsagePercent(usage, plan)}% of the ${plan.name} plan`, section: "plan", action: "See plan" });
    }
  }

  return items;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/agency-admin-rules.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/agency-admin tests/agency-admin-rules.test.js
git commit -m "feat(agency-admin): role check and overview attention rules"
```

---

### Task 2: Deep links for the Agency tab

**Files:**
- Modify: `app/lib/deepLinks.js`
- Test: `tests/deep-links.test.js`

- [ ] **Step 1: Update the tests first**

In `tests/deep-links.test.js`, replace the test `"opens Settings at the Team panel for a plain team link"` with:

```js
  it("opens the Agency tab at Team for a plain team link (managers; others fall back to Settings)", () => {
    expect(view("authenticated=1&tab=team")).toEqual({ initialTab: "agency", showJoinedNotice: false, settingsSection: "team" });
  });

  it("opens the Agency tab for tab=agency", () => {
    expect(view("authenticated=1&tab=agency")).toEqual({ initialTab: "agency", showJoinedNotice: false, settingsSection: null });
  });
```

Inside `describe("resolveVisibleTab", …)`, add after the last test:

```js
  it("shows the Agency tab to active owners and admins only, else Settings", () => {
    const owner = { role: "OWNER", status: "ACTIVE" };
    const args = { activeTab: "agency", user: member, isPersonal: false, agencyId: "a1" };
    expect(resolveVisibleTab({ ...args, membership: owner })).toBe("agency");
    expect(resolveVisibleTab({ ...args, membership: { role: "ADMIN", status: "ACTIVE" } })).toBe("agency");
    expect(resolveVisibleTab({ ...args, membership: { role: "STAFF", status: "ACTIVE" } })).toBe("settings");
    expect(resolveVisibleTab({ ...args, membership: { role: "OWNER", status: "PENDING" } })).toBe("settings");
    expect(resolveVisibleTab({ ...args, membership: null })).toBe("settings");
    expect(resolveVisibleTab({ ...args, isPersonal: true, agencyId: null, membership: owner })).toBe("settings");
  });
```

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run tests/deep-links.test.js`
Expected: FAIL. The team link still returns `initialTab: "settings"`, `tab=agency` returns the Planner, and `resolveVisibleTab` returns `"agency"` for staff.

- [ ] **Step 3: Implement**

Replace the whole of `app/lib/deepLinks.js` with:

```js
import { canManageAgency } from "./agency-admin/roles.js";

/**
 * Where an authenticated landing on `/` should open, from its query string.
 *
 * - `tab=team&invited=1` (invite just accepted): the Dashboard, with the
 *   "You joined this agency" notice.
 * - `tab=team` (e.g. /agency/:id/team): the Agency tab at Team. People who
 *   can't manage the agency fall back to Settings, scrolled to the Team panel
 *   (see resolveVisibleTab), so `settingsSection` carries "team" for both.
 * - `tab=agency` (e.g. /agency/:id/settings): the Agency tab.
 * - `tab=admin` (new-agency alert email): the Admin tab, for super admins.
 * - anything else: the Planner.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{ initialTab: string, showJoinedNotice: boolean, settingsSection: string | null }}
 */
export function resolveInitialView(searchParams) {
  const tab = searchParams.get("tab");
  const invited = searchParams.get("invited") === "1";

  if (tab === "team" && invited) {
    return { initialTab: "dashboard", showJoinedNotice: true, settingsSection: null };
  }
  if (tab === "team") {
    return { initialTab: "agency", showJoinedNotice: false, settingsSection: "team" };
  }
  if (tab === "agency") {
    return { initialTab: "agency", showJoinedNotice: false, settingsSection: null };
  }
  if (tab === "admin") {
    return { initialTab: "admin", showJoinedNotice: false, settingsSection: null };
  }
  return { initialTab: "command-center", showJoinedNotice: false, settingsSection: null };
}

/**
 * The tab the main area actually shows. Users without an agency workspace have
 * no dashboard, only super admins have the Admin tab, and only active owners and
 * admins have the Agency tab: anyone else who opens one of those links lands on
 * the Planner (or Settings, for Agency) instead of an empty page.
 */
export function resolveVisibleTab({ activeTab, user, isPersonal, agencyId, membership = null }) {
  if (!user) return activeTab;
  if (activeTab === "dashboard" && (isPersonal || !agencyId)) return "command-center";
  if (activeTab === "admin" && user.role !== "SUPER_ADMIN") return "command-center";
  if (activeTab === "agency" && (isPersonal || !agencyId || !canManageAgency(membership))) return "settings";
  return activeTab;
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run tests/deep-links.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/deepLinks.js tests/deep-links.test.js
git commit -m "feat(agency-admin): deep links open the Agency tab"
```

---

### Task 3: Extract the shared settings fields and the agency details form

Pure refactor: Settings looks and behaves exactly as before. The existing Settings tests are the safety net, plus one new test file for the form on its own.

**Files:**
- Create: `app/components/settings/settingsFields.jsx`
- Create: `app/components/settings/AgencyDetailsForm.jsx`
- Modify: `app/components/trip-dashboard/pages/SettingsPage.jsx`
- Test: `tests/agency-details-form.test.jsx`

- [ ] **Step 1: Write the failing form test**

```jsx
// tests/agency-details-form.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgencyDetailsForm from "../app/components/settings/AgencyDetailsForm.jsx";

const agency = {
  id: "agency-1",
  name: "Voyage Travel Studio",
  status: "VERIFIED",
  businessPhone: "639001112222",
  businessEmail: "hello@voyage.example",
  city: "Olongapo City",
  country: "Philippines",
};

function renderForm(props = {}) {
  return render(
    <AgencyDetailsForm agency={agency} membership={{ role: "OWNER", status: "ACTIVE" }} onUpdateAgency={vi.fn()} {...props} />,
  );
}

describe("AgencyDetailsForm", () => {
  it("normalizes saved workspace fields after a successful agency update", async () => {
    const onUpdateAgency = vi.fn(async () => ({ agency: { ...agency, name: "Voyage Travel Co" } }));
    renderForm({ onUpdateAgency });

    fireEvent.change(screen.getByLabelText("Agency name"), { target: { value: "  Voyage Travel Co  " } });
    fireEvent.change(screen.getByLabelText("Business phone"), { target: { value: "  +63 900 111 2222  " } });
    fireEvent.change(screen.getByLabelText("Business email"), { target: { value: "  hello@voyage.example  " } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "  Olongapo City  " } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "  Philippines  " } });

    expect(screen.getByRole("button", { name: "Save workspace changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save workspace changes" }));

    await waitFor(() => {
      expect(onUpdateAgency).toHaveBeenCalledWith({
        name: "Voyage Travel Co",
        businessPhone: "639001112222",
        businessEmail: "hello@voyage.example",
        city: "Olongapo City",
        country: "Philippines",
      });
    });
    expect(screen.getByLabelText("Agency name")).toHaveValue("Voyage Travel Co");
    expect(screen.getByLabelText("Business phone")).toHaveValue("639001112222");
    expect(screen.getByRole("button", { name: "Save workspace changes" })).toBeDisabled();
  });

  it("refuses to save without a business phone", async () => {
    const onUpdateAgency = vi.fn();
    renderForm({ onUpdateAgency });

    fireEvent.change(screen.getByLabelText("Business phone"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Business phone is required.");
    expect(onUpdateAgency).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "STAFF"])("is read-only for %s members", (role) => {
    renderForm({ membership: { role, status: "ACTIVE" } });

    expect(screen.getByText("Only the agency owner can edit workspace details.")).toBeInTheDocument();
    expect(screen.getByLabelText("Agency name")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Save workspace changes" })).toBeDisabled();
  });

  it("shows the agency status pill", () => {
    renderForm();
    expect(screen.getByText("Agency status")).toBeInTheDocument();
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/agency-details-form.test.jsx`
Expected: FAIL. Vite can't resolve `AgencyDetailsForm.jsx`.

- [ ] **Step 3: Create `settingsFields.jsx`**

Move these helpers out of `SettingsPage.jsx` unchanged, now exported:

```jsx
// app/components/settings/settingsFields.jsx
// Shared building blocks for Settings and the Agency tab's Profile section.

export function formatReadOnlyValue(value) {
  const text = String(value ?? "").trim();
  return text || "Not set";
}

// Theme tokens, so the pills read in light and dark mode. An 8% tint keeps
// every status colour at 4.5:1 (warning drops below it at 10%).
export function getStatusClass(status) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "VERIFIED") {
    return "bg-status-success/8 text-status-success border-status-success/30";
  }
  if (normalized === "PENDING" || normalized === "INVITED") {
    return "bg-status-warning/8 text-status-warning border-status-warning/30";
  }
  return "bg-text-primary/5 text-text-muted border-border/20";
}

export function getFieldClass(readOnly = false) {
  return [
    "mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none transition",
    "bg-background text-text-primary placeholder:text-text-soft/70",
    "focus:border-secondary focus:ring-2 focus:ring-secondary/20",
    readOnly ? "border-border/70 bg-surface-elevated/70" : "border-border",
    readOnly ? "cursor-not-allowed opacity-90" : "",
  ].join(" ");
}

export function Panel({ eyebrow, title, description, children, className = "" }) {
  return (
    <section className={`rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] ${className}`}>
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{eyebrow}</p>
        <h2 className="mt-1 font-sans text-lg font-semibold text-text-primary">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, value, readOnly = false, id }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-soft">{label}</span>
      <input id={id} className={getFieldClass(readOnly)} value={value} readOnly={readOnly} />
    </label>
  );
}

export function TextInputField({ label, id, value, onChange, placeholder, readOnly = false, autoComplete, type = "text", inputMode, pattern, maxLength }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-soft">{label}</span>
      <input
        id={id}
        className={getFieldClass(readOnly)}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        maxLength={maxLength}
      />
    </label>
  );
}
```

- [ ] **Step 4: Create `AgencyDetailsForm.jsx`**

This moves the agency state, validation, submit and fields from `SettingsPage.jsx` unchanged:

```jsx
// app/components/settings/AgencyDetailsForm.jsx
import { useEffect, useMemo, useState } from "react";
import { TextInputField, formatReadOnlyValue, getStatusClass } from "./settingsFields.jsx";

function sanitizeBusinessPhoneInput(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * The shared agency profile: name, business contact and location. Only an active
 * owner can edit it; everyone else sees it read-only. Settings shows it to staff,
 * and the Agency tab's Profile section shows it to owners and admins.
 */
export default function AgencyDetailsForm({ agency, membership, onUpdateAgency }) {
  const [agencyName, setAgencyName] = useState("");
  const [savedAgencyName, setSavedAgencyName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [savedBusinessPhone, setSavedBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [savedBusinessEmail, setSavedBusinessEmail] = useState("");
  const [city, setCity] = useState("");
  const [savedCity, setSavedCity] = useState("");
  const [country, setCountry] = useState("");
  const [savedCountry, setSavedCountry] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);

  useEffect(() => {
    const nextAgencyName = String(agency?.name ?? "");
    const nextBusinessPhone = sanitizeBusinessPhoneInput(agency?.businessPhone ?? "");
    const nextBusinessEmail = String(agency?.businessEmail ?? "");
    const nextCity = String(agency?.city ?? "");
    const nextCountry = String(agency?.country ?? "");

    setAgencyName(nextAgencyName);
    setSavedAgencyName(nextAgencyName);
    setBusinessPhone(nextBusinessPhone);
    setSavedBusinessPhone(nextBusinessPhone);
    setBusinessEmail(nextBusinessEmail);
    setSavedBusinessEmail(nextBusinessEmail);
    setCity(nextCity);
    setSavedCity(nextCity);
    setCountry(nextCountry);
    setSavedCountry(nextCountry);
    setWorkspaceError("");
    setIsSavingWorkspace(false);
  }, [agency?.businessEmail, agency?.businessPhone, agency?.city, agency?.country, agency?.name]);

  const canEditWorkspace = membership?.role === "OWNER" && membership?.status === "ACTIVE";
  const workspaceChanged =
    agencyName.trim() !== savedAgencyName.trim() ||
    businessPhone.trim() !== savedBusinessPhone.trim() ||
    businessEmail.trim() !== savedBusinessEmail.trim() ||
    city.trim() !== savedCity.trim() ||
    country.trim() !== savedCountry.trim();
  const agencyStatus = formatReadOnlyValue(agency?.status);
  const isWorkspaceSavingDisabled = !canEditWorkspace || !workspaceChanged || isSavingWorkspace || !onUpdateAgency;

  const handleWorkspaceSubmit = async (event) => {
    event.preventDefault();
    if (!canEditWorkspace) return;

    const normalizedAgencyValues = {
      name: agencyName.trim(),
      businessPhone: sanitizeBusinessPhoneInput(businessPhone),
      businessEmail: businessEmail.trim(),
      city: city.trim(),
      country: country.trim(),
    };

    if (!normalizedAgencyValues.name) {
      setWorkspaceError("Agency name is required.");
      return;
    }
    if (!normalizedAgencyValues.businessPhone) {
      setWorkspaceError("Business phone is required.");
      return;
    }
    if (!normalizedAgencyValues.city) {
      setWorkspaceError("City is required.");
      return;
    }
    if (!normalizedAgencyValues.country) {
      setWorkspaceError("Country is required.");
      return;
    }
    if (!workspaceChanged) return;

    setWorkspaceError("");
    setIsSavingWorkspace(true);
    try {
      await onUpdateAgency?.(normalizedAgencyValues);
      setAgencyName(normalizedAgencyValues.name);
      setBusinessPhone(normalizedAgencyValues.businessPhone);
      setBusinessEmail(normalizedAgencyValues.businessEmail);
      setCity(normalizedAgencyValues.city);
      setCountry(normalizedAgencyValues.country);
      setSavedAgencyName(normalizedAgencyValues.name);
      setSavedBusinessPhone(normalizedAgencyValues.businessPhone);
      setSavedBusinessEmail(normalizedAgencyValues.businessEmail);
      setSavedCity(normalizedAgencyValues.city);
      setSavedCountry(normalizedAgencyValues.country);
    } catch (error) {
      setWorkspaceError(error?.message || "Unable to update workspace details.");
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const workspaceFields = useMemo(() => ([
    {
      label: "Agency name",
      value: agencyName,
      onChange: (event) => setAgencyName(event.target.value),
      placeholder: "Enter agency name",
    },
    {
      label: "Business phone",
      value: businessPhone,
      onChange: (event) => setBusinessPhone(sanitizeBusinessPhoneInput(event.target.value)),
      placeholder: "Digits only",
      inputMode: "numeric",
      pattern: "[0-9]*",
      maxLength: 30,
      autoComplete: "tel-national",
    },
    {
      label: "Business email",
      value: businessEmail,
      onChange: (event) => setBusinessEmail(event.target.value),
      placeholder: "Enter business email",
      autoComplete: "email",
    },
    {
      label: "City",
      value: city,
      onChange: (event) => setCity(event.target.value),
      placeholder: "Enter city",
    },
    {
      label: "Country",
      value: country,
      onChange: (event) => setCountry(event.target.value),
      placeholder: "Enter country",
    },
    { label: "Membership role", value: formatReadOnlyValue(membership?.role) },
  ]), [agencyName, businessEmail, businessPhone, city, country, membership?.role]);

  return (
    <>
      {!canEditWorkspace ? (
        <p className="mb-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-text-soft">
          Only the agency owner can edit workspace details.
        </p>
      ) : null}

      <form className="grid gap-4" onSubmit={handleWorkspaceSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          {workspaceFields.map((field) => (
            <TextInputField
              key={field.label}
              label={field.label}
              id={field.label.toLowerCase().replace(/\s+/g, "-")}
              value={field.value || ""}
              onChange={field.onChange}
              readOnly={field.label === "Membership role" || !canEditWorkspace}
              placeholder={field.placeholder || field.label}
              type={field.type}
              inputMode={field.inputMode}
              pattern={field.pattern}
              maxLength={field.maxLength}
              autoComplete={field.autoComplete}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-pill border px-3 py-1 text-xs font-semibold ${getStatusClass(agency?.status)}`}>
            {agencyStatus}
          </span>
          <span className="text-sm text-text-soft">Agency status</span>
        </div>

        {workspaceError ? <p className="text-sm font-medium text-status-danger" role="alert">{workspaceError}</p> : null}

        <div className="flex items-center justify-end">
          <button
            type="submit"
            className="rounded-pill bg-secondary px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isWorkspaceSavingDisabled}
          >
            {isSavingWorkspace ? "Saving..." : "Save workspace changes"}
          </button>
        </div>
      </form>
    </>
  );
}
```

- [ ] **Step 5: Slim down `SettingsPage.jsx`**

Make these edits in `app/components/trip-dashboard/pages/SettingsPage.jsx`:

1. **Imports.** After the `SystemRequirementsTable` import, add:
   ```jsx
   import AgencyDetailsForm from "../../settings/AgencyDetailsForm.jsx";
   import { Field, Panel, TextInputField, formatReadOnlyValue, getStatusClass } from "../../settings/settingsFields.jsx";
   ```
2. **Moved helpers.** Delete the local `formatReadOnlyValue`, `getStatusClass`, `getFieldClass`, `sanitizeBusinessPhoneInput`, `Panel`, `Field` and `TextInputField` definitions. Keep `formatVerifiedValue`.
3. **Agency state.** Delete every agency `useState` pair: `agencyName`/`savedAgencyName` through `country`/`savedCountry`, plus `workspaceError` and `isSavingWorkspace`.
4. **Agency effect and derived values.** Delete the `useEffect` that copies `agency?.…` into that state. Delete `workspaceChanged`, `agencyStatus`, `isWorkspaceSavingDisabled`, `handleWorkspaceSubmit` and the `workspaceFields` `useMemo`.
5. **Keep `canEditWorkspace`.** The Plan card still uses it until Task 7.
6. **Agency details panel.** Replace everything between `{!isPersonal && <Panel eyebrow="Workspace" title="Agency details" …>` and its closing `</Panel>}` with:
   ```jsx
        {!isPersonal && <Panel
          eyebrow="Workspace"
          title="Agency details"
          description="Manage the shared agency profile that powers the dashboard and itinerary flows."
        >
          <AgencyDetailsForm agency={agency} membership={membership} onUpdateAgency={onUpdateAgency} />
        </Panel>}
   ```
7. **Danger zone.** In the `DangerZoneCard` props, change `agencyName={agency.name ?? savedAgencyName ?? ""}` to `agencyName={agency.name ?? ""}`.

- [ ] **Step 6: Run the form test and every Settings test**

Run: `npx vitest run tests/agency-details-form.test.jsx tests/settings-team.test.jsx tests/settings-plan-and-requirements.test.jsx tests/settings-status-colors.test.jsx tests/home-page.test.jsx`
Expected: PASS, apart from any failures Task 0 recorded in these files.

- [ ] **Step 7: Commit**

```bash
git add app/components/settings/settingsFields.jsx app/components/settings/AgencyDetailsForm.jsx app/components/trip-dashboard/pages/SettingsPage.jsx tests/agency-details-form.test.jsx
git commit -m "refactor(settings): extract agency details form and shared fields"
```

---

### Task 4: Agency Overview section

**Files:**
- Create: `app/components/agency-admin/AgencyOverview.jsx`
- Test: `tests/agency-overview.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// tests/agency-overview.test.jsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTeam: vi.fn(),
  listAgencyInvitations: vi.fn(),
  fetchPlanUsage: vi.fn(),
}));

vi.mock("../app/lib/api/index.js", () => ({
  fetchTeam: (...args) => mocks.fetchTeam(...args),
  listAgencyInvitations: (...args) => mocks.listAgencyInvitations(...args),
  fetchPlanUsage: (...args) => mocks.fetchPlanUsage(...args),
}));

import AgencyOverview from "../app/components/agency-admin/AgencyOverview.jsx";

const agency = { id: "agency-1", name: "Baguio Trails", status: "VERIFIED", businessPhone: "", city: "Baguio", country: "Philippines" };
const members = [
  { id: "m1", role: "OWNER", user: { displayName: "Jamie Dela Cruz", email: "jamie@example.test" } },
  { id: "m2", role: "STAFF", user: { displayName: "Ben Lim", email: "ben@example.test" } },
];

beforeEach(() => {
  mocks.fetchTeam.mockReset().mockResolvedValue({ members, viewerRole: "OWNER" });
  mocks.listAgencyInvitations.mockReset().mockResolvedValue({ invitations: [{ id: "i1" }, { id: "i2" }] });
  mocks.fetchPlanUsage.mockReset().mockResolvedValue({ usage: { itinerariesCreated: 13, agentRequests: 236, activeMembers: 2 } });
});

function renderOverview(role = "OWNER", props = {}) {
  const onOpenSection = vi.fn();
  render(<AgencyOverview agency={agency} membership={{ role, status: "ACTIVE" }} onOpenSection={onOpenSection} {...props} />);
  return { onOpenSection };
}

describe("AgencyOverview for the owner", () => {
  it("shows the status and the owner's name", async () => {
    renderOverview();
    expect(await screen.findByText("Owner: Jamie Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("shows this month's numbers and the plan that fits", async () => {
    renderOverview();
    const tiles = await screen.findByRole("list", { name: "Agency numbers" });
    expect(within(tiles).getByText("Team members").nextSibling).toHaveTextContent("2");
    expect(within(tiles).getByText("Itineraries this month").nextSibling).toHaveTextContent("13");
    expect(within(tiles).getByText("Messages to the agent").nextSibling).toHaveTextContent("236");
    expect(within(tiles).getByText("Plan that fits").nextSibling).toHaveTextContent("Starter");
  });

  it("lists what needs attention, each opening the section that fixes it", async () => {
    const { onOpenSection } = renderOverview();
    const list = await screen.findByRole("list", { name: "Needs attention" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.firstChild.textContent)).toEqual([
      "2 invitations are still pending",
      "Agency details are missing: business phone",
      "Usage is at 87% of the Starter plan",
    ]);

    fireEvent.click(within(list).getByRole("button", { name: "Edit profile" }));
    expect(onOpenSection).toHaveBeenCalledWith("profile");
  });

  it("says so when nothing needs attention", async () => {
    mocks.listAgencyInvitations.mockResolvedValue({ invitations: [] });
    mocks.fetchPlanUsage.mockResolvedValue({ usage: { itinerariesCreated: 1, agentRequests: 3, activeMembers: 2 } });
    renderOverview("OWNER", { agency: { ...agency, businessPhone: "639001112222" } });
    expect(await screen.findByText("Nothing needs your attention right now.")).toBeInTheDocument();
  });

  it("shows an error when the team can't load", async () => {
    mocks.fetchTeam.mockRejectedValue(new Error("offline"));
    renderOverview();
    expect(await screen.findByText("Couldn't load your agency overview. Try again later.")).toBeInTheDocument();
  });
});

describe("AgencyOverview for an admin", () => {
  it("skips the owner-only usage and details rows", async () => {
    renderOverview("ADMIN");
    const tiles = await screen.findByRole("list", { name: "Agency numbers" });
    expect(mocks.fetchPlanUsage).not.toHaveBeenCalled();
    expect(within(tiles).getByText("Pending invitations").nextSibling).toHaveTextContent("2");
    expect(within(tiles).queryByText("Plan that fits")).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Needs attention" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/agency-overview.test.jsx`
Expected: FAIL. Vite can't resolve `AgencyOverview.jsx`.

- [ ] **Step 3: Implement**

```jsx
// app/components/agency-admin/AgencyOverview.jsx
"use client";

import { useEffect, useState } from "react";
import { fetchPlanUsage, fetchTeam, listAgencyInvitations } from "../../lib/api/index.js";
import { agencyStatusLabel, buildAttentionItems } from "../../lib/agency-admin/overview.js";
import { suggestPlan } from "../../lib/pricing/plans.js";
import { getStatusClass } from "../settings/settingsFields.jsx";

const CARD = "rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)]";
const LOADING_MESSAGE = "Loading your agency overview…";
const ERROR_MESSAGE = "Couldn't load your agency overview. Try again later.";

function Tile({ label, value }) {
  return (
    <li className="rounded-2xl border border-border bg-background px-4 py-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
      <p className="m-0 mt-1 text-2xl font-semibold text-text-primary">{value}</p>
    </li>
  );
}

/**
 * The Agency tab's landing section: is the agency OK, its numbers this month, and
 * what needs fixing. Owners also get plan usage (the endpoint is owner-only).
 */
export default function AgencyOverview({ agency, membership, onOpenSection }) {
  const isOwner = membership?.role === "OWNER";
  const [state, setState] = useState({ status: "loading", members: [], invitations: [], usage: null });

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchTeam(agency.id),
      listAgencyInvitations(agency.id),
      isOwner ? fetchPlanUsage(agency.id) : Promise.resolve(null),
    ]).then(([team, invitations, usage]) => {
      if (cancelled) return;
      if (team.status !== "fulfilled") {
        setState({ status: "error", members: [], invitations: [], usage: null });
        return;
      }
      setState({
        status: "ready",
        members: team.value?.members ?? [],
        // An invitations or usage failure only drops its rows and tiles.
        invitations: invitations.status === "fulfilled" ? invitations.value?.invitations ?? [] : [],
        usage: usage.status === "fulfilled" ? usage.value?.usage ?? null : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [agency.id, isOwner]);

  // Same live-region pattern as PlanUsageCard: one status element for the section's life.
  const statusMessage = state.status === "loading" ? LOADING_MESSAGE : state.status === "error" ? ERROR_MESSAGE : "";

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="m-0 text-sm text-text-muted empty:hidden">{statusMessage}</p>
      {state.status === "ready" ? <OverviewBody agency={agency} isOwner={isOwner} onOpenSection={onOpenSection} {...state} /> : null}
    </div>
  );
}

function OverviewBody({ agency, isOwner, members, invitations, usage, onOpenSection }) {
  const owner = members.find((member) => member.role === "OWNER");
  const fit = usage ? suggestPlan({ itineraries: usage.itinerariesCreated, members: usage.activeMembers }) : null;
  const items = buildAttentionItems({ agency, invitations, usage, isOwner });

  return (
    <>
      <section aria-labelledby="agency-overview-status" className={CARD}>
        <h2 id="agency-overview-status" className="m-0 font-sans text-[15px] font-semibold tracking-normal text-text-primary">Status</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center rounded-pill border px-3 py-1 text-xs font-semibold ${getStatusClass(agency.status)}`}>
            {agencyStatusLabel(agency.status)}
          </span>
          {owner ? <span className="text-sm text-text-muted">Owner: {owner.user?.displayName}</span> : null}
        </div>
      </section>

      <ul role="list" aria-label="Agency numbers" className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
        <Tile label="Team members" value={members.length} />
        {isOwner && usage ? (
          <>
            <Tile label="Itineraries this month" value={usage.itinerariesCreated} />
            <Tile label="Messages to the agent" value={usage.agentRequests} />
            <Tile label="Plan that fits" value={fit?.name ?? "Custom"} />
          </>
        ) : (
          <Tile label="Pending invitations" value={invitations.length} />
        )}
      </ul>

      <section aria-labelledby="agency-overview-attention" className={CARD}>
        <h2 id="agency-overview-attention" className="m-0 font-sans text-[15px] font-semibold tracking-normal text-text-primary">Needs attention</h2>
        {items.length === 0 ? (
          <p className="m-0 mt-2 text-sm text-text-muted">Nothing needs your attention right now.</p>
        ) : (
          <ul role="list" aria-label="Needs attention" className="m-0 mt-2 list-none p-0">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
                <span className="text-sm text-text-primary">{item.text}</span>
                <button
                  type="button"
                  onClick={() => onOpenSection?.(item.section)}
                  className="min-h-11 rounded-pill border border-border bg-background px-4 text-sm font-semibold text-text-primary transition hover:border-secondary hover:text-secondary"
                >
                  {item.action}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
```

Note: when usage fails to load for an owner, the owner falls back to the admin tiles (Team members, Pending invitations). That's deliberate.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/agency-overview.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/agency-admin/AgencyOverview.jsx tests/agency-overview.test.jsx
git commit -m "feat(agency-admin): overview with status, numbers and needs attention"
```

---

### Task 5: Agency admin page (top bar + sections)

**Files:**
- Create: `app/components/agency-admin/AgencyAdminPage.jsx`
- Test: `tests/agency-admin-page.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// tests/agency-admin-page.test.jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/components/agency-admin/AgencyOverview.jsx", () => ({
  default: ({ onOpenSection }) => (
    <button type="button" onClick={() => onOpenSection("profile")}>overview-stub</button>
  ),
}));
vi.mock("../app/components/team/TeamPage.jsx", () => ({
  default: ({ agencyId, embedded }) => <div data-testid="team-page" data-agency={agencyId} data-embedded={String(embedded)} />,
}));
vi.mock("../app/components/settings/PlanUsageCard.jsx", () => ({
  default: ({ agencyId }) => <div data-testid="plan-usage" data-agency={agencyId} />,
}));
vi.mock("../app/components/settings/DangerZoneCard.jsx", () => ({
  default: ({ agencyName }) => <div data-testid="danger-zone" data-name={agencyName} />,
}));
vi.mock("../app/components/settings/AgencyDetailsForm.jsx", () => ({
  default: ({ membership }) => <div data-testid="details-form" data-role={membership.role} />,
}));

import AgencyAdminPage from "../app/components/agency-admin/AgencyAdminPage.jsx";

const agency = { id: "agency-1", name: "Baguio Trails" };

function renderPage(role = "OWNER", props = {}) {
  return render(
    <AgencyAdminPage agency={agency} membership={{ role, status: "ACTIVE" }} onUpdateAgency={vi.fn()} {...props} />,
  );
}

describe("AgencyAdminPage", () => {
  it("titles the page with the agency name and opens on Overview", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Baguio Trails" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "overview-stub" })).toBeInTheDocument();
  });

  it("gives owners all four sections", () => {
    renderPage("OWNER");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Team", "Profile", "Plan and usage"]);
  });

  it("hides Plan and usage from admins", () => {
    renderPage("ADMIN");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Overview", "Team", "Profile"]);
  });

  it("shows the embedded team list under Team", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
    expect(screen.getByTestId("team-page")).toHaveAttribute("data-embedded", "true");
    expect(screen.getByTestId("team-page")).toHaveAttribute("data-agency", "agency-1");
  });

  it("shows the details form and the owner's danger zone under Profile", () => {
    renderPage("OWNER");
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(screen.getByTestId("details-form")).toHaveAttribute("data-role", "OWNER");
    expect(screen.getByTestId("danger-zone")).toHaveAttribute("data-name", "Baguio Trails");
  });

  it("keeps the danger zone from admins", () => {
    renderPage("ADMIN");
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(screen.getByTestId("details-form")).toBeInTheDocument();
    expect(screen.queryByTestId("danger-zone")).not.toBeInTheDocument();
  });

  it("shows plan usage under Plan and usage", () => {
    renderPage("OWNER");
    fireEvent.click(screen.getByRole("tab", { name: "Plan and usage" }));
    expect(screen.getByTestId("plan-usage")).toHaveAttribute("data-agency", "agency-1");
  });

  it("follows the overview's links to a section", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "overview-stub" }));
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the initial section once and reports it handled", () => {
    const onInitialSectionHandled = vi.fn();
    renderPage("OWNER", { initialSection: "team", onInitialSectionHandled });
    expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
    expect(onInitialSectionHandled).toHaveBeenCalledOnce();
  });

  it("falls back to Overview for a section the viewer can't open", () => {
    renderPage("ADMIN", { initialSection: "plan" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("scrolls itself, since <main> doesn't on phones", () => {
    renderPage();
    expect(screen.getByTestId("agency-admin-page")).toHaveClass("overflow-y-auto");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/agency-admin-page.test.jsx`
Expected: FAIL. Vite can't resolve `AgencyAdminPage.jsx`.

- [ ] **Step 3: Implement**

```jsx
// app/components/agency-admin/AgencyAdminPage.jsx
"use client";

import { useEffect, useState } from "react";
import AdminTopBar from "../admin/AdminTopBar.jsx";
import SegmentedControl from "../admin/SegmentedControl.jsx";
import AgencyDetailsForm from "../settings/AgencyDetailsForm.jsx";
import DangerZoneCard from "../settings/DangerZoneCard.jsx";
import PlanUsageCard from "../settings/PlanUsageCard.jsx";
import { Panel } from "../settings/settingsFields.jsx";
import TeamPage from "../team/TeamPage.jsx";
import AgencyOverview from "./AgencyOverview.jsx";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "team", label: "Team" },
  { id: "profile", label: "Profile" },
  // GET /plan-usage is owner-only on the server.
  { id: "plan", label: "Plan and usage", ownerOnly: true },
];

/**
 * The Agency tab: where an agency's owner and admins run it. Same top bar and
 * section tabs as the platform Admin page; the sections reuse the Settings pieces.
 */
export default function AgencyAdminPage({ agency, membership, onUpdateAgency, initialSection = "overview", onInitialSectionHandled }) {
  const isOwner = membership?.role === "OWNER";
  const sections = SECTIONS.filter((item) => !item.ownerOnly || isOwner);
  const [section, setSection] = useState(() => (sections.some((item) => item.id === initialSection) ? initialSection : "overview"));

  // The deep link that picked the first section is spent once it has opened.
  useEffect(() => {
    if (initialSection !== "overview") onInitialSectionHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = (
    <SegmentedControl
      as="tab"
      ariaLabel="Agency sections"
      value={section}
      onChange={setSection}
      options={sections.map((item) => ({ value: item.id, label: item.label }))}
    />
  );
  const active = sections.find((item) => item.id === section) ?? sections[0];

  return (
    <div
      data-testid="agency-admin-page"
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-5 lg:px-6"
    >
      <AdminTopBar title={agency.name} tabs={tabs} />
      <div role="tabpanel" aria-label={active.label} className="flex flex-col gap-4 pb-8">
        {section === "overview" ? (
          <AgencyOverview agency={agency} membership={membership} onOpenSection={setSection} />
        ) : null}

        {section === "team" ? (
          <section className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <TeamPage agencyId={agency.id} embedded />
          </section>
        ) : null}

        {section === "profile" ? (
          <>
            <Panel
              eyebrow="Workspace"
              title="Agency details"
              description="The shared agency profile that powers the dashboard and itinerary flows."
            >
              <AgencyDetailsForm agency={agency} membership={membership} onUpdateAgency={onUpdateAgency} />
            </Panel>
            {isOwner ? <DangerZoneCard agencyId={agency.id} agencyName={agency.name ?? ""} /> : null}
          </>
        ) : null}

        {section === "plan" && isOwner ? (
          <Panel
            eyebrow="Plan"
            title="Plan and usage"
            description="What Voyage would cost your agency, based on this month's real use."
          >
            <PlanUsageCard key={agency.id} agencyId={agency.id} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/agency-admin-page.test.jsx`
Expected: PASS.

If the `role="tab"` names don't match, check `SegmentedControl`: its button's accessible name is `{o.label}` plus the badge, and the badge only renders when `badge > 0`.

- [ ] **Step 5: Commit**

```bash
git add app/components/agency-admin/AgencyAdminPage.jsx tests/agency-admin-page.test.jsx
git commit -m "feat(agency-admin): agency admin page with section tabs"
```

---

### Task 6: "Agency" item in the sidebar rail

**Files:**
- Modify: `app/components/trip-dashboard/layout/DashboardSidebar.jsx`
- Test: `tests/dashboard-rail.test.jsx`

- [ ] **Step 1: Add the failing tests**

In `tests/dashboard-rail.test.jsx`, inside `describe("DashboardSidebar rail", …)`, add after `"switches tabs"`:

```jsx
  it("shows Agency to an active owner and opens the agency tab", () => {
    const { setActiveTab } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Agency" }));
    expect(setActiveTab).toHaveBeenCalledWith("agency");
  });

  it("shows Agency to an active admin", () => {
    renderRail({
      user: { ...agencyOwner, memberships: [{ ...agencyOwner.memberships[0], role: "ADMIN" }] },
    });
    expect(screen.getByRole("button", { name: "Agency" })).toBeInTheDocument();
  });

  it("keeps Agency from staff and personal accounts", () => {
    renderRail({
      user: { ...agencyOwner, memberships: [{ ...agencyOwner.memberships[0], role: "STAFF" }] },
    });
    expect(screen.queryByRole("button", { name: "Agency" })).not.toBeInTheDocument();
  });

  it("places Agency between Itineraries and Settings", () => {
    renderRail();
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") || button.textContent.trim());
    expect(names.indexOf("Agency")).toBeGreaterThan(names.indexOf("Itineraries"));
    expect(names.indexOf("Agency")).toBeLessThan(names.indexOf("Settings"));
  });
```

In the `it.each` table that tests `headerVariantForTab`, add the row `["agency", "full"],` after `["admin", "full"],`.

Also add a personal-account check to the existing `"calls a personal account's settings My account and has no Dashboard"` test: add `expect(screen.queryByRole("button", { name: "Agency" })).not.toBeInTheDocument();` after its Dashboard assertion.

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run tests/dashboard-rail.test.jsx`
Expected: FAIL. No button named "Agency" exists yet. The `headerVariantForTab("agency")` row already passes, because `"full"` is the default.

- [ ] **Step 3: Implement**

In `app/components/trip-dashboard/layout/DashboardSidebar.jsx`:

1. Add the import after the `RailButton` import:
   ```jsx
   import { canManageAgency } from "../../../lib/agency-admin/roles.js";
   ```
2. In `ICONS`, add this after `admin`:
   ```jsx
     agency: (
       <Icon>
         <path d="M3 21h18" />
         <path d="M5 21V7l7-4 7 4v14" />
         <path d="M9 21v-5h6v5" />
         <path d="M9 10h.01" />
         <path d="M15 10h.01" />
       </Icon>
     ),
   ```
3. In the `items` array, add this between the `itineraries` entry and the `isAdmin ? …` entry:
   ```jsx
       !isPersonal && canManageAgency(membership)
         ? { tab: "agency", label: "Agency", icon: ICONS.agency }
         : null,
   ```

If the ordering test fails because the rail renders buttons in a different DOM order (for example, the account menu button first), keep the assertion relative: it only compares the Itineraries, Agency and Settings indices.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/dashboard-rail.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/layout/DashboardSidebar.jsx tests/dashboard-rail.test.jsx
git commit -m "feat(agency-admin): Agency item in the sidebar rail for owners and admins"
```

---

### Task 7: Settings goes personal, and HomePage renders the Agency tab

These two changes ship in one commit. Moving the agency form out of the owner's Settings breaks two `home-page.test.jsx` tests, and only the HomePage wiring makes them pass again.

**Files:**
- Modify: `app/components/trip-dashboard/pages/SettingsPage.jsx`
- Modify: `app/components/trip-dashboard/HomePage.jsx`
- Test: `tests/settings-team.test.jsx`, `tests/settings-plan-and-requirements.test.jsx`, `tests/home-page.test.jsx`

- [ ] **Step 1: Update the tests first**

In `tests/settings-team.test.jsx`, add to `describe("Settings Team panel", …)`:

```jsx
  it.each(["OWNER", "ADMIN"])("sends %s members to the Agency tab instead of showing the Team panel", (role) => {
    const onOpenAgency = vi.fn();
    renderSettings({ membership: { role, status: "ACTIVE" }, onOpenAgency });

    expect(screen.queryByRole("region", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agency details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Agency" }));
    expect(onOpenAgency).toHaveBeenCalledOnce();
  });

  it("keeps read-only agency details for staff", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: "Agency details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Agency" })).not.toBeInTheDocument();
  });
```

and change the first import line to `import { fireEvent, render, screen } from "@testing-library/react";`.

In `tests/settings-plan-and-requirements.test.jsx`, replace the whole `describe("Settings plan card", …)` block with:

```jsx
describe("Settings plan card", () => {
  it.each(["OWNER", "ADMIN", "STAFF"])("is no longer in Settings for %s members (it lives in the Agency tab)", (role) => {
    renderSettings(role);
    expect(screen.queryByRole("heading", { name: "Plan and usage" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-usage")).not.toBeInTheDocument();
  });

  it("is not shown to personal accounts", () => {
    renderSettings(null, { id: "p1", displayName: "Lee", accountType: "PERSONAL" });
    expect(screen.queryByRole("heading", { name: "Plan and usage" })).not.toBeInTheDocument();
  });
});
```

The `PlanUsageCard` mock at the top of that file can stay.

In `tests/home-page.test.jsx`:

1. Next to the other `vi.mock` calls (around line 296), add:
   ```jsx
   vi.mock("../app/components/agency-admin/AgencyOverview.jsx", () => ({
     default: () => <div data-testid="agency-overview" />,
   }));
   ```
2. Replace the body of `it("opens settings with real account and agency data", …)`. Keep its `render(<HomePage user={…} />)` call exactly as it is, then use these assertions:
   ```jsx
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Agency Owner")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Olongapo Travel Studio")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Agency" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Olongapo Travel Studio" })).toBeInTheDocument();
    expect(screen.getByTestId("agency-overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(screen.getByDisplayValue("Olongapo Travel Studio")).toBeInTheDocument();
    expect(screen.getByDisplayValue("639001112222")).toBeInTheDocument();
    expect(screen.getByDisplayValue("hello@olongapo.example")).toBeInTheDocument();
   ```
   Rename the test to `"opens settings with account data and the Agency tab with agency data"`.
3. Delete the test `it("normalizes saved workspace fields after a successful agency update", …)`. It now lives in `tests/agency-details-form.test.jsx` (Task 3).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/settings-team.test.jsx tests/settings-plan-and-requirements.test.jsx tests/home-page.test.jsx`
Expected: FAIL. Owners still see Team and Plan, there is no "Open Agency" button, and the renamed home-page test can't find it.

- [ ] **Step 3: Implement the Settings change**

In `app/components/trip-dashboard/pages/SettingsPage.jsx`:

1. **Imports.** Remove the `DangerZoneCard` and `PlanUsageCard` imports. Add:
   ```jsx
   import { canManageAgency } from "../../../lib/agency-admin/roles.js";
   ```
2. **Props.** Add `onOpenAgency` to the destructured props, after `onUpdateAgency`.
3. **Role.** Replace `const canEditWorkspace = membership?.role === "OWNER" && membership?.status === "ACTIVE";` with:
   ```jsx
     // Owners and admins run the agency from the Agency tab; Settings keeps their own things.
     const managesAgency = !isPersonal && canManageAgency(membership);
   ```
4. **Workspace panel.** Replace the `{!isPersonal && <Panel eyebrow="Workspace" title="Agency details" …>…</Panel>}` block with:
   ```jsx
        {!isPersonal && (managesAgency ? (
          <Panel
            eyebrow="Workspace"
            title="Agency"
            description="Team, agency details, plan and usage, and ownership are in the Agency tab."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="m-0 text-sm text-text-muted">
                {agency?.name || "Your agency"} · {membership?.role === "OWNER" ? "Owner" : "Admin"}
              </p>
              <button
                type="button"
                className="rounded-pill border border-border bg-background px-5 py-3 text-sm font-semibold text-text-primary transition hover:border-secondary hover:text-secondary"
                onClick={() => onOpenAgency?.()}
              >
                Open Agency
              </button>
            </div>
          </Panel>
        ) : (
          <Panel
            eyebrow="Workspace"
            title="Agency details"
            description="Manage the shared agency profile that powers the dashboard and itinerary flows."
          >
            <AgencyDetailsForm agency={agency} membership={membership} onUpdateAgency={onUpdateAgency} />
          </Panel>
        ))}
   ```
5. **Team section.** Change its condition from `{!isPersonal && agency?.id ? (` to `{!isPersonal && !managesAgency && agency?.id ? (`.
6. **Plan and Danger.** Delete the whole `{!isPersonal && canEditWorkspace && agency?.id ? (<Panel eyebrow="Plan" …>…</Panel>) : null}` block and the whole `{!isPersonal && membership?.role === "OWNER" && agency?.id ? (<DangerZoneCard …/>) : null}` block.

- [ ] **Step 4: Run the Settings tests**

Run: `npx vitest run tests/settings-team.test.jsx tests/settings-plan-and-requirements.test.jsx tests/settings-status-colors.test.jsx tests/agency-details-form.test.jsx`
Expected: PASS.

`settings-status-colors` renders a STAFF member, so the "Agency status" pill still comes from `AgencyDetailsForm`.

- [ ] **Step 5: Wire the Agency tab into HomePage**

In `app/components/trip-dashboard/HomePage.jsx`:

1. **Import.** After `import AdminPage from "../admin/AdminPage.jsx";`, add:
   ```jsx
   import AgencyAdminPage from "../agency-admin/AgencyAdminPage.jsx";
   ```
2. **Tab resolution (around line 471).** Pass the membership:
   ```jsx
     const currentTab = resolveVisibleTab({ activeTab, user, isPersonal, agencyId, membership: activeMembership });
   ```
   Update the comment above it: "…Only super admins see the Admin tab, and only active owners and admins see the Agency tab (others fall back to Settings)."
3. **SettingsPage props.** In the `<SettingsPage …/>` element, add:
   ```jsx
                 onOpenAgency={() => setActiveTab("agency")}
   ```
4. **Render branch.** Directly before `) : currentTab === "admin" && user?.role === "SUPER_ADMIN" ? (`, add:
   ```jsx
             ) : currentTab === "agency" && activeAgency ? (
               <AgencyAdminPage
                 agency={activeAgency}
                 membership={activeMembership}
                 onUpdateAgency={handleAgencySettingsUpdate}
                 initialSection={settingsFocus === "team" ? "team" : "overview"}
                 onInitialSectionHandled={clearSettingsFocus}
               />
   ```

`settingsFocus` carries `"team"` from a `?tab=team` link. Managers land in Agency → Team, and staff land in Settings scrolled to Team, since `resolveVisibleTab` sends them there.

- [ ] **Step 6: Run the home-page tests**

Run: `npx vitest run tests/home-page.test.jsx`
Expected: PASS, apart from failures Task 0 recorded in this file.

- [ ] **Step 7: Commit**

```bash
git add app/components/trip-dashboard/pages/SettingsPage.jsx app/components/trip-dashboard/HomePage.jsx tests/settings-team.test.jsx tests/settings-plan-and-requirements.test.jsx tests/home-page.test.jsx
git commit -m "feat(agency-admin): Agency tab in the dashboard; settings sends owners and admins there"
```

---

### Task 8: Retire the legacy agency settings route

**Files:**
- Modify: `app/agency/[agencyId]/settings/page.jsx`
- Delete: `app/components/settings/AgencySettingsPage.jsx`
- Test: `tests/agency-invite-landing.test.jsx`

- [ ] **Step 1: Update the test first**

In `tests/agency-invite-landing.test.jsx`:

1. Replace `import AgencySettingsPage from "../app/components/settings/AgencySettingsPage.jsx";` with:
   ```jsx
   import SettingsRoutePage from "../app/agency/[agencyId]/settings/page.jsx";
   ```
2. Replace `it("keeps invited admin settings controls readable", …)` with:
   ```jsx
     it("forwards the legacy agency Settings URL into the Agency tab", async () => {
       render(<SettingsRoutePage />);

       await waitFor(() => {
         expect(mocks.routerReplace).toHaveBeenCalledWith("/?authenticated=1&tab=agency");
       });
     });
   ```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/agency-invite-landing.test.jsx`
Expected: FAIL. The route still renders the old page, which needs `params` and never calls `router.replace` for owners.

- [ ] **Step 3: Implement**

Replace `app/agency/[agencyId]/settings/page.jsx` with:

```jsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Agency settings live in the dashboard's Agency tab now. Staff who follow this
// link fall back to Settings there (see resolveVisibleTab).
export default function Page() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/?authenticated=1&tab=agency");
  }, [router]);

  return null;
}
```

Delete the old component:

```bash
git rm app/components/settings/AgencySettingsPage.jsx
```

Then confirm nothing else imports it:

Run: `grep -rn "AgencySettingsPage" app tests`
Expected: no output.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/agency-invite-landing.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/agency/[agencyId]/settings/page.jsx tests/agency-invite-landing.test.jsx
git commit -m "refactor(agency-admin): legacy agency settings route opens the Agency tab"
```

---

### Task 9: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | tail -40`
Expected: the only failing files are the ones Task 0 recorded. Any new failure is a regression: fix it before going on.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: it compiles with no errors.

- [ ] **Step 3: Browser QA**

Start the client with the preview tool (`voyage-client` in `.claude/launch.json`) against a running backend. Sign in as a seeded agency owner, then check:

1. The rail shows **Agency** between Itineraries and Settings, and the top bar shows the agency name in serif.
2. **Overview** shows the status pill, "Owner: …", four tiles and the "Needs attention" rows. Each row's button opens its section.
3. **Team:** invite, change role, remove and revoke still work. **Profile:** saving details works and the danger zone shows. **Plan and usage:** the usage card loads.
4. **Settings** shows only personal panels plus the "Agency" panel, and its "Open Agency" button switches tabs.
5. Signed in as an **admin**: there's no Plan and usage tab, Profile is read-only, and there's no danger zone.
6. Signed in as **staff**: there's no Agency item, and Settings still shows read-only agency details and the team list.
7. Visiting `/?authenticated=1&tab=team` as the owner lands on Agency → Team. Visiting `/agency/<id>/settings` lands on the Agency tab.
8. At phone width (375px), the page scrolls, the section tabs scroll sideways, and the four tiles wrap two by two. Check dark mode: the pills and tiles stay legible.

- [ ] **Step 4: Report**

Report the test counts against the baseline, the build result, and the QA screenshots. Don't push: the user pushes.
