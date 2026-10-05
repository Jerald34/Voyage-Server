# Admin "Accounts" Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The super-admin page lists only agencies today, so personal accounts (and anyone not owning an agency) are invisible. Add an **Accounts** section that lists every user account — Personal, Agency, and setup-incomplete — with a detail pane per account.

**Request (2026-10-06):** "Add Personal account on the admin page and I want to see all of the accounts."

**Architecture:** Two read-only super-admin endpoints (`GET /admin/users`, `GET /admin/users/:userId`) built like the existing usage module (service with an injected repository + a Prisma repository). The client adds a fourth admin tab, `Accounts`, built like the Agencies section: search + type filter toolbar, sortable table (cards below `sm`), and a `MasterDetailLayout` detail pane.

**Tech:** Voyage-Server (TypeScript, Express, Prisma, Zod, Vitest + supertest). Voyage-Client (Next.js, React, Tailwind, Vitest + Testing Library).

## Decisions

- **A1 – Read-only.** List + detail only. No disable/delete/role actions (account changes are security-sensitive and were not asked for).
- **A2 – One list, filtered on the client.** `GET /admin/users` returns every account (newest first), like `GET /admin/agencies` (no pagination). The client filters by type and shows a count per type, so no server filter param.
- **A3 – Type filter:** `All` · `Personal` (`PERSONAL`) · `Agency` (`AGENCY_USER`) · `Setup incomplete` (`PENDING`). Each option shows its count.
- **A4 – Never expose secrets.** The response never contains `passwordHash`, sessions, or tokens. The repository maps `passwordHash` to a `PASSWORD` sign-in method and drops it.
- **A5 – Tab order:** Agencies · Accounts · Usage · Reports. Agencies stays the default.
- **A6 – Look:** reuse the Agencies section's surfaces, table, card, pills and empty state, so the new tab reads as part of the same console. Shared agency status pill is extracted once (it is already duplicated in `AgencyTable.jsx` and `AgencyDetail.jsx`).

## API contract

`GET /admin/users` → `200 { users: AdminAccountSummary[] }` (ordered `createdAt` desc)
`GET /admin/users/:userId` → `200 { user: AdminAccountDetail }` · `400` non-UUID id · `404 ACCOUNT_NOT_FOUND`
Both: `requireSuperAdmin` on the route (403 `SUPER_ADMIN_REQUIRED`), and the service re-checks the role.

```ts
type AdminAccountMembership = {
  agencyId: string;
  agencyName: string;
  agencyStatus: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
};

type AdminAccountSummary = {
  id: string;
  email: string;
  displayName: string;
  role: "USER" | "SUPER_ADMIN";
  status: "ACTIVE" | "DISABLED";
  accountType: "PENDING" | "PERSONAL" | "AGENCY_USER";
  emailVerified: boolean;
  createdAt: string;            // ISO (JSON-serialized Date)
  signInMethods: Array<"PASSWORD" | "GOOGLE" | "APPLE">; // PASSWORD first, then providers, de-duplicated
  memberships: AdminAccountMembership[];                  // oldest first
};

type AdminAccountDetail = AdminAccountSummary & {
  emailVerifiedAt: string | null;
  updatedAt: string;
  activity: { itineraries: number; clientTrips: number; agentThreads: number }; // created by this user
};
```

---

## Task S1: Account service + mapper (server)

**Files:** create `src/modules/admin/accountService.ts`, `tests/adminAccountService.test.ts`.

- `toAccountSummary(row)` and `toAccountDetail(row)`: pure mappers from the repository's Prisma row shape to the contract above. `signInMethods`: `PASSWORD` when `passwordHash` is a non-empty string, then each `providerAccounts[].provider`, de-duplicated. Memberships flatten `{ role, status, agency: { id, name, status } }`. Detail `activity` comes from `_count` (`createdItineraries`, `createdClientTrips`, `createdAgentThreads`).
- `createAdminAccountService({ repository })` → `{ listAccounts(user), getAccount(user, userId) }`. Both throw `ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required.")` unless `user.role === "SUPER_ADMIN"`. `getAccount` throws `ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found.")` when the repository returns null.
- Export the repository interface (`AdminAccountRepository { listAccounts(): Promise<Row[]>; findAccount(id): Promise<DetailRow | null> }`) and the row types.

Tests (write first, see them fail): non-admin rejected for both calls; summary maps a personal user, an agency owner with two memberships, a Google-only user (`["GOOGLE"]`), a password+Google user (`["PASSWORD","GOOGLE"]`), duplicate provider rows de-duplicated; **no `passwordHash` key anywhere in the output** (`JSON.stringify` check); detail includes `activity` counts; missing account → 404.

Commit: `feat(admin): account list and detail service for super admins`

## Task S2: Prisma repository + routes (server)

**Files:** create `src/modules/admin/accountRepository.ts`; modify `src/modules/admin/adminRoutes.ts`; modify `tests/authenticatedValidation.test.ts` (or a new route test file if that file's mocking makes it awkward).

- Repository (`import { prisma } from "../../db/prisma"`): `listAccounts` = `prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id, email, displayName, role, status, accountType, emailVerifiedAt, createdAt, passwordHash: true, providerAccounts: { select: { provider: true } }, memberships: { orderBy: { createdAt: "asc" }, select: { role, status, agency: { select: { id, name, status } } } } } })`. `findAccount(id)` = same select plus `updatedAt` and `_count: { select: { createdItineraries: true, createdClientTrips: true, createdAgentThreads: true } }`, via `findUnique`. Use explicit `select` (never `include` on User) so no other column can leak.
- Routes, in the "literal paths first" block: `GET /users` and, in the parameterized block, `GET /users/:userId` with `idParamsSchema("userId")`. Both `requireSuperAdmin`, `try/next(error)` like the neighbours. Responses `{ users }` / `{ user }`.
- Route tests: `/admin/users/not-a-uuid` → 400 validation error and the service/repository is not called; `GET /admin/users` as super admin → 200 with `users`; as a regular user → 403. Follow the file's existing mocking style.

Verify: `npx vitest run tests/adminAccountService.test.ts tests/authenticatedValidation.test.ts`, `npx tsc --noEmit`, then full `npx vitest run` = the 11 known baseline failures only.

Commit: `feat(admin): list every account and show one account's detail`

## Task C1: API helpers + AdminPage tab (client)

**Files:** modify `app/lib/api/admin.js`, `app/lib/api/index.js`, `app/components/admin/AdminPage.jsx`, `tests/admin-page.test.jsx`.

- `fetchAllAccounts()` → `fetchApi("/admin/users")`; `fetchAccountDetail(userId)` → `fetchApi(\`/admin/users/${userId}\`)`. Re-export both from `index.js` in the Admin block.
- `SECTIONS` gains `{ id: "accounts", label: "Accounts", title: "Accounts" }` right after agencies; render `<AdminAccountsPage />` when active.
- Test: mock `AdminAccountsPage.jsx` like the other sections; clicking the `Accounts` tab shows it and the heading reads "Accounts". Existing tests keep passing (Agencies stays default).

## Task C2: Accounts list, filter, search, sort (client)

**Files:** create `app/components/admin/AdminAccountsPage.jsx`, `app/components/admin/AccountTable.jsx`, `app/components/admin/AgencyStatusPill.jsx`, `app/components/admin/accountLabels.js`; modify `app/components/admin/AgencyTable.jsx` (use the extracted pill); tests `tests/account-table.test.jsx`, `tests/admin-accounts-page.test.jsx`.

- `accountLabels.js`: `ACCOUNT_TYPE_LABELS = { PERSONAL: "Personal", AGENCY_USER: "Agency", PENDING: "Setup incomplete" }`, `MEMBERSHIP_ROLE_LABELS = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" }`, `SIGN_IN_LABELS = { PASSWORD: "Email & password", GOOGLE: "Google", APPLE: "Apple" }`, and `formatDate` (same output as the agency table's).
- `AgencyStatusPill.jsx`: the `StatusPill` now inside `AgencyTable.jsx` (label + dot + classes), moved verbatim and exported; `AgencyTable.jsx` imports it. `tests/agency-table-responsive.test.jsx` must still pass unchanged.
- `AdminAccountsPage.jsx`, modelled on `AdminAgenciesPage.jsx`: loads `fetchAllAccounts()` once (loading spinner "Loading accounts…", error box, empty text "No accounts found." / "No accounts match your search."). Toolbar: search input (placeholder "Search accounts…", matches name, email, or any membership's agency name, case-insensitive) + `SegmentedControl as="radio" size="sm" ariaLabel="Filter by account type"` with the four A3 options, each label followed by its count (e.g. `Personal` + muted `3`; the count's accessible name stays part of the radio's name, e.g. "Personal 3"). Sort fields `name`, `type`, `joined` (default `joined` desc, same toggle rules as agencies). `MasterDetailLayout` with `AccountDetail` (Task C3), `detailTitle` = the account's display name, `ariaLabel="Account details"`, empty state `UserIcon` + "Select an account" / "Pick an account from the list to see its details."
- `AccountTable.jsx`, modelled on `AgencyTable.jsx` (desktop `role="table"` from `sm`, cards below with `data-testid="account-card-{id}"`, footer "Showing X of Y accounts"). Columns: **Name** (display name, email beneath), **Type** (type pill; plus a small "Super admin" chip when `role === "SUPER_ADMIN"`), **Agency** (first membership's agency name with "Owner/Admin/Staff" beneath; "+N more" when more than one; "—" when none), **Status** ("Active" or "Disabled" pill; a muted "Email not verified" line when `!emailVerified`), **Joined** (date). Sortable headers: Name, Type, Joined.
- Type pill tones (existing tokens, legible in both themes): Personal = secondary family, Agency = primary family, Setup incomplete = neutral muted. Disabled = `status-danger` family.
- Tests: table + card both render; type labels, Super admin chip, agency name + role, "+1 more", "—"; row and card click call `onRowClick(id)`. Page test (mock `fetchAllAccounts`, `AccountDetail`, icons): counts per filter option; choosing Personal shows only personal rows; search by email and by agency name; selecting a row opens the detail with the account's name.

## Task C3: Account detail pane (client)

**Files:** create `app/components/admin/AccountDetail.jsx`, `tests/account-detail.test.jsx`.

- Loads `fetchAccountDetail(userId)` (loading "Loading account details…", error box). Shows: type pill, Super admin chip, status pill; fields grid (Email, Email verified → date or "Not verified", Sign-in methods → joined labels, Joined); **Agencies** list (agency name, `AgencyStatusPill`, role label, "Membership disabled" when membership status is DISABLED) or "Not a member of any agency."; **Activity** (Itineraries, Client trips, Agent chats — counts). No action buttons (A1).
- Tests: fields, sign-in labels, membership rows with agency status, empty-membership text, activity counts, no `button` other than none rendered by the component, error state.

Verify (client): `npx vitest run --pool=threads tests/admin-page.test.jsx tests/account-table.test.jsx tests/admin-accounts-page.test.jsx tests/account-detail.test.jsx tests/agency-table-responsive.test.jsx`, then the full suite = baseline (8 files / 1 test), `npm run build` green.

Commits (client): C1 `feat(admin): add an Accounts tab to the admin page`, C2 `feat(admin): list every account with type filter and search`, C3 `feat(admin): show one account's agencies, sign-in methods and activity`.

## QA (lead)

As super admin in the browser: Accounts tab lists all users incl. personal ones; filter counts add up to All; search; detail pane on desktop and drawer on mobile width; light + dark themes.
