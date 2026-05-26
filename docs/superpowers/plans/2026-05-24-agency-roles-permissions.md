# Agency Roles and Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce real OWNER vs ADMIN vs STAFF permission boundaries across the agency surface, rename platform `User.role.ADMIN` to `SUPER_ADMIN`, and ship Team and Settings pages that adapt to the viewer's role.

**Architecture:** Server-side: extend `agencyAccessService` with three new gates (`requireAgencyOwner`, `requireAgencyAdmin`, `requireTripAccess`), wire them into existing trip / itinerary / agent / settings routes, and add new team and settings routes. Client-side: add an agency-scoped layout with a role-aware nav, a Team page, and a Settings page with a Danger Zone visible only to OWNER. The permission matrix in the spec is the single source of truth — every gate has a test, every test row corresponds to one cell.

**Tech Stack:** Node, TypeScript, Express, Prisma, PostgreSQL, Zod, Vitest, Supertest (server). Next.js 15 App Router, React, Tailwind (client).

**Spec reference:** [docs/superpowers/specs/2026-05-24-agency-roles-permissions-design.md](../specs/2026-05-24-agency-roles-permissions-design.md).

---

## Parallel Sub-Agent Dispatch & Model Selection

This plan is structured so that tasks within each phase can be dispatched to fresh sub-agents in parallel where independent. Match the `model` parameter to task difficulty to avoid wasting Opus on mechanical work and avoid under-powering reasoning-heavy tasks.

| Task class | Model | Why |
|---|---|---|
| Mechanical renames, string flips, file moves (Phase 1 tasks, Task 30) | `haiku` (`claude-haiku-4-5`) | Pure find-and-replace with clear acceptance criteria. Fast, cheap, accurate enough. |
| TDD service helpers, route wiring, schema validation, well-bounded React components (Phases 2–5, Tasks 24–28) | `sonnet` (`claude-sonnet-4-6`) | Moderate complexity: needs to reason about test design and integration but the spec pins down the behavior. |
| Cross-cutting design / debugging / failing-test triage that the spec does not pin down | `opus` (`claude-opus-4-6` or `claude-opus-4-7`) | Reserve only for tasks where the spec is silent and judgment is required. Should not be needed for this plan if the spec is followed. |

**Parallel-dispatch checkpoints:** at the start of each phase, dispatch sub-agents in parallel for independent tasks (e.g., in Phase 1, Tasks 1, 2, 3, 4, 5, 7 can run in parallel because they touch different files). Synchronize before the next phase. Specifically:

- **Phase 1 (renames):** dispatch Tasks 1, 2, 3, 4, 5, 6, 7 to parallel Haiku agents. Synchronize after Task 8 before moving on.
- **Phase 2 (helpers):** Tasks 9, 10, 11 in parallel (Sonnet) — they each add an independent helper. Task 12 is sequential (it wires the new helpers into routes and depends on all three).
- **Phase 3 (visibility):** Tasks 13–15 sequential within the phase (they share the same files).
- **Phase 4 (team service):** Tasks 16, 17, 18, 19 can run in parallel (Sonnet) — each is one service method with its own test file. Task 20 is sequential.
- **Phase 5 (settings):** Tasks 21–23 sequential.
- **Phase 6 (client):** Tasks 24–28 mostly sequential since they all touch the agency layout; Task 27 and 28 (error UX) can be parallel with Task 26.

**Dispatch prompt template (for sub-agents):**

```
You are implementing Task <N> from docs/superpowers/plans/2026-05-24-agency-roles-permissions.md.
Read that task and only that task. Follow TDD strictly: write the failing test first, run
it to confirm failure, write the minimal implementation, run to confirm pass, commit.
Do not touch files outside the Files list in the task. If a step shows code, paste it
exactly (typos in this plan must be reported back, not silently fixed). Stop after the
task's final commit and report results.
```

---

## File Structure

### Server (`Voyage-Server/`)

- Modify: `prisma/schema.prisma` — rename `UserRole.ADMIN` to `SUPER_ADMIN`.
- Create: `prisma/migrations/20260525000000_rename_admin_to_super_admin/migration.sql` — Postgres enum rename.
- Modify: `prisma/seed.ts` — update role string and type.
- Modify: `src/http/authMiddleware.ts` — rename `requireAdmin` to `requireSuperAdmin`, update error code.
- Modify: `src/modules/admin/adminRoutes.ts` — update middleware import.
- Modify: `src/modules/agencies/agencyService.ts` — rename `assertAdmin` to `assertSuperAdmin`.
- Modify: `src/modules/agencies/agencyTypes.ts` — `AgencyUser.role` union type.
- Modify: `src/modules/auth/authTypes.ts` — role union type.
- Modify: `src/services/capabilities.ts` — role string update.
- Modify: `src/modules/agencyAccess/agencyAccessService.ts` — add `requireAgencyOwner`, `requireAgencyAdmin`, `requireAgencyMember`, `requireTripAccess`.
- Modify: `src/modules/itineraries/itineraryRepository.ts` — add organizer-scoped list helper.
- Modify: `src/modules/itineraries/itineraryService.ts` — accept role+userId, scope STAFF visibility.
- Modify: `src/modules/itineraries/itineraryRoutes.ts` — call `requireTripAccess` per route.
- Modify: `src/modules/workspace/workspaceService.ts` — STAFF sees only their organized trips.
- Modify: `src/modules/agent/agentService.ts` (or wherever thread routes live) — thread visibility per role.
- Create: `src/modules/agencies/teamSchemas.ts` — Zod schemas for team mutations.
- Create: `src/modules/agencies/teamService.ts` — invite, remove, change-role, transfer-ownership.
- Create: `src/modules/agencies/teamRepository.ts` — Prisma queries for memberships.
- Create: `src/modules/agencies/teamRoutes.ts` — REST routes for team management.
- Modify: `src/modules/agencies/agencyService.ts` — add `deleteAgency` (OWNER + typed-name confirmation).
- Modify: `src/modules/agencies/agencyRoutes.ts` — add `DELETE /:agencyId` and `GET /:agencyId/team`.
- Modify: `src/app.ts` — mount `teamRoutes` under `/agencies/:agencyId/team`.

### Server tests (`Voyage-Server/tests/`)

- Modify: `tests/agencyAccessService.test.ts` — add tests for new gates.
- Modify: `tests/agencyService.test.ts` — flip role strings, add deleteAgency tests.
- Modify: `tests/imageService.test.ts` — flip role strings only.
- Create: `tests/teamService.test.ts` — invite, remove, change-role, transfer-ownership.
- Create: `tests/tripVisibility.test.ts` — STAFF sees only assigned trips (route-level integration).
- Modify: `tests/routes.test.ts` — settings 403 for STAFF, team-list 200 for STAFF read-only.

### Client (`Voyage-Client/`)

- Modify: `app/components/trip-dashboard/HomePage.jsx` — three `"ADMIN"` → `"SUPER_ADMIN"` flips.
- Modify: `app/components/trip-dashboard/layout/DashboardSidebar.jsx` — `isAdmin` source string flip.
- Create: `app/agency/[agencyId]/layout.jsx` — role-aware agency layout with nav.
- Create: `app/agency/[agencyId]/team/page.jsx` — Team page.
- Create: `app/agency/[agencyId]/settings/page.jsx` — Settings page.
- Create: `app/components/team/TeamPage.jsx` — list + invite + role-change UI.
- Create: `app/components/team/MemberRow.jsx` — one row with role pill and menu.
- Create: `app/components/team/RolePill.jsx` — visual treatment.
- Create: `app/components/team/InviteMemberModal.jsx`.
- Create: `app/components/team/ChangeRoleModal.jsx`.
- Create: `app/components/team/RemoveMemberModal.jsx`.
- Create: `app/components/settings/AgencySettingsPage.jsx`.
- Create: `app/components/settings/DangerZoneCard.jsx`.
- Create: `app/components/settings/TransferOwnershipModal.jsx`.
- Create: `app/components/settings/DeleteAgencyModal.jsx`.
- Create: `app/components/agency-status/TripNotInListEmptyState.jsx`.
- Create: `app/hooks/useAgencyRole.js` — read membership role for current agency.
- Create: `app/lib/api/team.js` — REST client for team endpoints.
- Modify: `app/lib/api/index.js` — re-export team helpers and add settings/delete helpers.

---

# Phase 1 — SUPER_ADMIN rename (mechanical, dispatch in parallel with `haiku`)

## Task 1: Prisma schema enum rename

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma`
- Create: `Voyage-Server/prisma/migrations/20260525000000_rename_admin_to_super_admin/migration.sql`

- [ ] **Step 1: Update the Prisma enum**

In `Voyage-Server/prisma/schema.prisma`, replace the `UserRole` enum:

```prisma
enum UserRole {
  USER
  SUPER_ADMIN
}
```

- [ ] **Step 2: Write the migration SQL**

Create `Voyage-Server/prisma/migrations/20260525000000_rename_admin_to_super_admin/migration.sql`:

```sql
-- Rename the enum value ADMIN to SUPER_ADMIN to disambiguate from
-- agency-level MembershipRole.ADMIN. Existing rows update transparently.
ALTER TYPE "UserRole" RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';
```

- [ ] **Step 3: Generate Prisma client and run migration locally**

Run from `Voyage-Server/`:

```powershell
npm run prisma:generate
npm run prisma:migrate
```

Expected: Prisma applies the new migration with no data loss. Client regenerates with `UserRole.SUPER_ADMIN`.

- [ ] **Step 4: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260525000000_rename_admin_to_super_admin
git commit -m "feat(schema): rename UserRole.ADMIN to SUPER_ADMIN"
```

## Task 2: Type-level rename in agency and auth types

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyTypes.ts`
- Modify: `Voyage-Server/src/modules/auth/authTypes.ts`

- [ ] **Step 1: Update `AgencyUser.role` union**

In `Voyage-Server/src/modules/agencies/agencyTypes.ts`, change:

```ts
export type AgencyUser = {
  id: string;
  role: "USER" | "SUPER_ADMIN";
  status: "ACTIVE" | "DISABLED";
  emailVerifiedAt: Date | null;
};
```

- [ ] **Step 2: Update `authTypes.ts` user role union**

In `Voyage-Server/src/modules/auth/authTypes.ts`, find the role union and change it:

```ts
role: "USER" | "SUPER_ADMIN";
```

- [ ] **Step 3: Type-check**

Run:

```powershell
npm run build
```

Expected: TypeScript compile fails with errors at every remaining `"ADMIN"` use site for `User.role` (these are addressed in subsequent tasks). The expected failures are in `authMiddleware.ts`, `agencyService.ts`, `capabilities.ts`, and `seed.ts`.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/agencies/agencyTypes.ts src/modules/auth/authTypes.ts
git commit -m "feat(types): switch UserRole union to SUPER_ADMIN"
```

## Task 3: Middleware rename — `requireAdmin` → `requireSuperAdmin`

**Files:**
- Modify: `Voyage-Server/src/http/authMiddleware.ts`
- Modify: `Voyage-Server/src/modules/admin/adminRoutes.ts`

- [ ] **Step 1: Rename the middleware and update the gate string**

In `Voyage-Server/src/http/authMiddleware.ts`, replace the `requireAdmin` function with:

```ts
export function requireSuperAdmin(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }

  if (request.authUser.role !== "SUPER_ADMIN") {
    return next(new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required."));
  }

  return next();
}
```

- [ ] **Step 2: Update the admin routes import and usage**

In `Voyage-Server/src/modules/admin/adminRoutes.ts`, change the import and every usage:

```ts
import { requireSuperAdmin } from "../../http/authMiddleware";
```

Then `Find: requireAdmin` → `Replace all: requireSuperAdmin` in this file (6 occurrences).

- [ ] **Step 3: Type-check**

Run:

```powershell
npm run build
```

Expected: still has errors in `agencyService.ts`, `capabilities.ts`, `seed.ts` from Task 2's residual references (fixed in subsequent tasks). `authMiddleware.ts` and `adminRoutes.ts` compile clean.

- [ ] **Step 4: Commit**

```powershell
git add src/http/authMiddleware.ts src/modules/admin/adminRoutes.ts
git commit -m "feat(middleware): rename requireAdmin to requireSuperAdmin"
```

## Task 4: Service helper rename — `assertAdmin` → `assertSuperAdmin`

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyService.ts`

- [ ] **Step 1: Rename the helper and update its check**

In `Voyage-Server/src/modules/agencies/agencyService.ts`, replace the `assertAdmin` function with:

```ts
function assertSuperAdmin(user: AgencyUser) {
  assertActive(user);
  if (user.role !== "SUPER_ADMIN") {
    throw new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required.");
  }
}
```

- [ ] **Step 2: Update all call sites in the same file**

In `Voyage-Server/src/modules/agencies/agencyService.ts`, find every `assertAdmin(user)` call (in `listPendingAgencies`, `approveAgency`, `rejectAgency`, `suspendAgency`, `unsuspendAgency`, `listAllAgencies`, `getAgencyDetail`, `getPendingCount`) and replace with `assertSuperAdmin(user)`.

- [ ] **Step 3: Type-check**

Run:

```powershell
npm run build
```

Expected: this file is clean. Remaining errors only in `capabilities.ts` and `seed.ts`.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/agencies/agencyService.ts
git commit -m "feat(agency): rename assertAdmin to assertSuperAdmin"
```

## Task 5: Capabilities update

**Files:**
- Modify: `Voyage-Server/src/services/capabilities.ts`

- [ ] **Step 1: Flip the role string**

In `Voyage-Server/src/services/capabilities.ts`, change:

```ts
canReviewAgencies: user.status === "ACTIVE" && user.role === "SUPER_ADMIN",
```

- [ ] **Step 2: Type-check**

Run:

```powershell
npm run build
```

Expected: this file is clean. Remaining error only in `seed.ts`.

- [ ] **Step 3: Commit**

```powershell
git add src/services/capabilities.ts
git commit -m "feat(capabilities): switch admin check to SUPER_ADMIN"
```

## Task 6: Update existing tests for the rename

**Files:**
- Modify: `Voyage-Server/tests/agencyService.test.ts`
- Modify: `Voyage-Server/tests/imageService.test.ts` (only if it contains `"ADMIN"` for `User.role`; agency-level `"ADMIN"` for `MembershipRole` is unchanged)

- [ ] **Step 1: Search for User.role admin strings in tests**

Open `Voyage-Server/tests/agencyService.test.ts` and find each line that calls `createUser({ id: "admin-1", role: "ADMIN" })` (there are three at the time of writing: lines 224, 250, 271). Replace `role: "ADMIN"` with `role: "SUPER_ADMIN"` in each.

- [ ] **Step 2: Confirm `imageService.test.ts` does not need changes**

Open `Voyage-Server/tests/imageService.test.ts` and confirm the only `"ADMIN"` strings are for `MembershipRole` (agency-level), not `User.role`. The line that reads `role: "ADMIN"` near line 184 inside a `memberships` Map IS a `MembershipRole.ADMIN` and stays unchanged. If unsure, check by following the type: if it's an `AgencyMembership.role` it stays; if it's a `User.role` it flips.

- [ ] **Step 3: Run all server tests**

Run from `Voyage-Server/`:

```powershell
npm test
```

Expected: `agencyService.test.ts` passes after the rename. No regressions elsewhere.

- [ ] **Step 4: Commit**

```powershell
git add tests/agencyService.test.ts
git commit -m "test: flip User.role admin strings to SUPER_ADMIN"
```

## Task 7: Seed file update

**Files:**
- Modify: `Voyage-Server/prisma/seed.ts`

- [ ] **Step 1: Update the role union type and string literals**

In `Voyage-Server/prisma/seed.ts`:

- Change the type annotation `role: "USER" | "ADMIN"` to `role: "USER" | "SUPER_ADMIN"`.
- Change every comparison `user.role !== "ADMIN"` to `user.role !== "SUPER_ADMIN"`.
- Change every literal `{ role: "ADMIN" }` to `{ role: "SUPER_ADMIN" }`.

- [ ] **Step 2: Type-check and run seed**

Run:

```powershell
npm run build
npm run prisma:seed
```

Expected: build is clean; seed runs without error. Existing admins (if any) are upgraded to `SUPER_ADMIN`.

- [ ] **Step 3: Commit**

```powershell
git add prisma/seed.ts
git commit -m "feat(seed): use SUPER_ADMIN role for bootstrap admins"
```

## Task 8: Client gate flips

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/layout/DashboardSidebar.jsx`

- [ ] **Step 1: Flip three strings in HomePage.jsx**

In `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`, change exactly these three checks:

- Line ~142: `if (user?.role !== "ADMIN") return;` → `if (user?.role !== "SUPER_ADMIN") return;`
- Line ~155: `if (user?.role !== "ADMIN") return;` → `if (user?.role !== "SUPER_ADMIN") return;`
- Line ~729: `activeTab === "admin" && user?.role === "ADMIN"` → `activeTab === "admin" && user?.role === "SUPER_ADMIN"`

- [ ] **Step 2: Flip the sidebar string**

In `Voyage-Client/app/components/trip-dashboard/layout/DashboardSidebar.jsx`, line ~7:

```jsx
const isAdmin = user?.role === "SUPER_ADMIN";
```

- [ ] **Step 3: Visual smoke test**

Run the client dev server and sign in as a super admin. The "Admin" tab in the sidebar should still appear; the pending-count badge should still poll. Sign in as a non-admin user — the tab should be absent.

- [ ] **Step 4: Commit**

```powershell
cd ../Voyage-Client
git add app/components/trip-dashboard/HomePage.jsx app/components/trip-dashboard/layout/DashboardSidebar.jsx
git commit -m "feat(client): switch admin gates to SUPER_ADMIN"
```

---

# Phase 2 — Role enforcement helpers (TDD, dispatch in parallel with `sonnet`)

## Task 9: `requireAgencyOwner` helper

**Files:**
- Modify: `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`
- Modify: `Voyage-Server/tests/agencyAccessService.test.ts`

- [ ] **Step 1: Write the failing test**

In `Voyage-Server/tests/agencyAccessService.test.ts`, add inside the existing `describe("agency access service")` block:

```ts
describe("requireAgencyOwner", () => {
  it("returns access for an OWNER member", async () => {
    const { service, repository } = createService();
    const access = createAgencyAccess({
      membership: { agencyId: "agency-1", userId: "user-1", role: "OWNER", status: "ACTIVE" }
    });
    repository.accessByAgencyId.set("agency-1", access);
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).resolves.toEqual(access);
  });

  it("rejects an ADMIN member with AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { agencyId: "agency-1", userId: "user-1", role: "ADMIN", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });

  it("rejects a STAFF member with AGENCY_OWNER_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyOwner(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_OWNER_REQUIRED",
      statusCode: 403
    });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run from `Voyage-Server/`:

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireAgencyOwner"
```

Expected: FAIL with `service.requireAgencyOwner is not a function`.

- [ ] **Step 3: Implement the helper**

In `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`, refactor so the closure exposes a named helper that the new helper can compose. Inside `createAgencyAccessService`, restructure to:

```ts
export function createAgencyAccessService(options: { repository: AgencyAccessRepository }) {
  async function requireVerifiedAgencyMember(/* existing signature */) { /* existing body */ }

  async function requireAgencyOwner(user: AgencyAccessUser, agencyId: string) {
    const access = await requireVerifiedAgencyMember(user, agencyId);
    if (!access.membership || access.membership.role !== "OWNER") {
      throw new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can perform this action.");
    }
    return access;
  }

  return { requireVerifiedAgencyMember, requireAgencyOwner /* …, others added in next tasks */ };
}
```

The key point: `requireVerifiedAgencyMember` keeps its existing behavior (still throws `AGENCY_ACCESS_REQUIRED` for non-members or wrong-role-for-its-allowedRoles). `requireAgencyOwner` is composed on top: it gets through the generic member check (any active member passes if `allowedRoles` is left default), then layers an OWNER-specific check with the specific `AGENCY_OWNER_REQUIRED` error code.

- [ ] **Step 4: Run the test, expect pass**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireAgencyOwner"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencyAccess/agencyAccessService.ts tests/agencyAccessService.test.ts
git commit -m "feat(access): add requireAgencyOwner helper"
```

## Task 10: `requireAgencyAdmin` helper

**Files:**
- Modify: `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`
- Modify: `Voyage-Server/tests/agencyAccessService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/agencyAccessService.test.ts`:

```ts
describe("requireAgencyAdmin", () => {
  it.each(["OWNER", "ADMIN"] as const)("returns access for a(n) %s member", async (role) => {
    const { service, repository } = createService();
    const access = createAgencyAccess({
      membership: { agencyId: "agency-1", userId: "user-1", role, status: "ACTIVE" }
    });
    repository.accessByAgencyId.set("agency-1", access);
    await expect(service.requireAgencyAdmin(createUser(), "agency-1")).resolves.toEqual(access);
  });

  it("rejects a STAFF member with AGENCY_ADMIN_REQUIRED", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set(
      "agency-1",
      createAgencyAccess({
        membership: { agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
      })
    );
    await expect(service.requireAgencyAdmin(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_ADMIN_REQUIRED",
      statusCode: 403
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireAgencyAdmin"
```

Expected: FAIL with `service.requireAgencyAdmin is not a function`.

- [ ] **Step 3: Implement**

In the same `createAgencyAccessService` closure (alongside `requireAgencyOwner` from Task 9):

```ts
async function requireAgencyAdmin(user: AgencyAccessUser, agencyId: string) {
  const access = await requireVerifiedAgencyMember(user, agencyId);
  if (!access.membership || (access.membership.role !== "OWNER" && access.membership.role !== "ADMIN")) {
    throw new ApiError(403, "AGENCY_ADMIN_REQUIRED", "Only the agency owner or admin can perform this action.");
  }
  return access;
}
```

Add `requireAgencyAdmin` to the returned object alongside the others.

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireAgencyAdmin"
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencyAccess/agencyAccessService.ts tests/agencyAccessService.test.ts
git commit -m "feat(access): add requireAgencyAdmin helper"
```

## Task 11: `requireTripAccess` helper (404 vs 403 semantics)

**Files:**
- Modify: `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`
- Modify: `Voyage-Server/tests/agencyAccessService.test.ts`

- [ ] **Step 1: Extend the `AgencyAccessRepository` interface**

In `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`, add to `AgencyAccessRepository`:

```ts
findTripOrganizer(agencyId: string, tripId: string): Promise<{ assignedOrganizerUserId: string | null } | null>;
```

Implement the new method in `createPrismaAgencyAccessRepository`:

```ts
async findTripOrganizer(agencyId, tripId) {
  return prisma.clientTrip.findFirst({
    where: { id: tripId, agencyId },
    select: { assignedOrganizerUserId: true }
  });
},
```

- [ ] **Step 2: Update the in-test memory repo and write failing tests**

Append to `tests/agencyAccessService.test.ts`:

```ts
function withTripOrganizer(
  repo: ReturnType<typeof createMemoryAgencyAccessRepository>,
  tripId: string,
  organizerUserId: string | null
) {
  (repo as any).findTripOrganizer = async (_agencyId: string, _tripId: string) => {
    if (_tripId !== tripId) return null;
    return { assignedOrganizerUserId: organizerUserId };
  };
}

describe("requireTripAccess", () => {
  it("allows OWNER access to any trip in the agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("allows ADMIN access to any trip in the agency", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { agencyId: "agency-1", userId: "user-1", role: "ADMIN", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("allows STAFF to access their own trip", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "user-1");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).resolves.toBeDefined();
  });

  it("returns 404 (not 403) when STAFF probes another organizer's trip", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess({
      membership: { agencyId: "agency-1", userId: "user-1", role: "STAFF", status: "ACTIVE" }
    }));
    withTripOrganizer(repository, "trip-1", "other-staff");
    await expect(service.requireTripAccess(createUser(), "agency-1", "trip-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
  });

  it("returns 404 when the trip does not exist at all", async () => {
    const { service, repository } = createService();
    repository.accessByAgencyId.set("agency-1", createAgencyAccess());
    // no withTripOrganizer call — repo returns null
    (repository as any).findTripOrganizer = async () => null;
    await expect(service.requireTripAccess(createUser(), "agency-1", "missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND"
    });
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireTripAccess"
```

Expected: FAIL with `service.requireTripAccess is not a function`.

- [ ] **Step 4: Implement the helper**

Add `requireTripAccess` to the closure alongside the other helpers from Tasks 9 and 10:

```ts
async function requireTripAccess(user: AgencyAccessUser, agencyId: string, tripId: string) {
  const access = await requireVerifiedAgencyMember(user, agencyId);

  // OWNER and ADMIN see every trip in the agency.
  if (access.membership && (access.membership.role === "OWNER" || access.membership.role === "ADMIN")) {
    return access;
  }

  // STAFF: must be the assigned organizer, else surface as 404 (prevent probing).
  const trip = await options.repository.findTripOrganizer(access.agency.id, tripId);
  if (!trip || trip.assignedOrganizerUserId !== user.id) {
    throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
  }

  return access;
}
```

Add it to the returned object alongside the others.

- [ ] **Step 5: Run, expect PASS**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "requireTripAccess"
```

- [ ] **Step 6: Commit**

```powershell
git add src/modules/agencyAccess/agencyAccessService.ts tests/agencyAccessService.test.ts
git commit -m "feat(access): add requireTripAccess with 404 for staff probing"
```

## Task 12: Wire helpers into existing routes

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts`
- Modify: `Voyage-Server/src/modules/agencies/agencyRoutes.ts`

- [ ] **Step 1: Replace `requireVerifiedAgencyMember` per route**

In `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts`, the global `router.use` already calls `requireVerifiedAgencyMember`. Add a per-route gate for routes that touch a specific itinerary/trip. Inside each route handler that accepts a `:itineraryId` or `:tripId`, call:

```ts
await agencyAccessService.requireTripAccess(request.authUser!, getAgencyId(request), tripId);
```

For routes that list trips, use `requireVerifiedAgencyMember` but pass the membership role and user id through to the service layer so the service can return role-scoped results (see Task 13).

- [ ] **Step 2: Settings route gate**

In `Voyage-Server/src/modules/agencies/agencyRoutes.ts`, change the `PATCH /:agencyId/settings` handler. Replace the `assertAgencyOwnerMembership` check inside `agencyService.updateAgencySettings` so that ADMIN or OWNER may update settings (matrix: "Edit agency profile" is yes for OWNER and ADMIN). Use `requireAgencyAdmin` in the route, and update the service-level assertion to allow OWNER or ADMIN.

In `agencyService.ts`, change the helper:

```ts
function assertAgencyAdminMembership(membership: AgencyMembershipRecord | null) {
  if (!membership || membership.status !== "ACTIVE" || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    throw new ApiError(403, "AGENCY_ADMIN_REQUIRED", "Only the agency owner or admin can edit workspace settings.");
  }
}
```

Replace the call site inside `updateAgencySettings` from `assertAgencyOwnerMembership(membership)` to `assertAgencyAdminMembership(membership)`. Delete `assertAgencyOwnerMembership` if no longer used (or keep if used by other helpers — search first).

- [ ] **Step 3: Run the test suite**

```powershell
npm test
```

Expected: tests still pass. If any pre-existing test asserts that ADMIN cannot edit settings, that test is now wrong per the spec — update it to reflect the matrix.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/itineraries/itineraryRoutes.ts src/modules/agencies/agencyRoutes.ts src/modules/agencies/agencyService.ts
git commit -m "feat(routes): wire trip-access and admin-gated settings"
```

---

# Phase 3 — STAFF trip visibility (sequential, `sonnet`)

## Task 13: Repository helper — `listTripsForUser`

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRepository.ts`
- Modify: `Voyage-Server/src/modules/itineraries/itineraryTypes.ts`

- [ ] **Step 1: Extend the repo interface**

In `itineraryTypes.ts`, add to `ItineraryRepository`:

```ts
listTripsForUser(
  agencyId: string,
  filter: { role: "OWNER" | "ADMIN" | "STAFF"; userId: string }
): Promise<Array<ClientTripRecord & { itineraries: Array<{ id: string; status: string; version: number }> }>>;
```

- [ ] **Step 2: Implement in the Prisma repo**

In `itineraryRepository.ts`, add:

```ts
async listTripsForUser(agencyId, filter) {
  const where = filter.role === "STAFF"
    ? { agencyId, assignedOrganizerUserId: filter.userId }
    : { agencyId };
  return client.clientTrip.findMany({
    where,
    include: { itineraries: { select: { id: true, status: true, version: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" }
  }) as Promise<Array<ClientTripRecord & { itineraries: Array<{ id: string; status: string; version: number }> }>>;
},
```

- [ ] **Step 3: No new test (covered by the integration test in Task 14)**

- [ ] **Step 4: Commit**

```powershell
git add src/modules/itineraries/itineraryRepository.ts src/modules/itineraries/itineraryTypes.ts
git commit -m "feat(itinerary): add listTripsForUser with role-scoped filter"
```

## Task 14: Service + route wiring for STAFF visibility

**Files:**
- Modify: `Voyage-Server/src/modules/itineraries/itineraryService.ts`
- Modify: `Voyage-Server/src/modules/itineraries/itineraryRoutes.ts`
- Create: `Voyage-Server/tests/tripVisibility.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/tripVisibility.test.ts` (an in-memory test of the service):

```ts
import { describe, expect, it } from "vitest";
import { createItineraryService } from "../src/modules/itineraries/itineraryService";
import type { ItineraryRepository } from "../src/modules/itineraries/itineraryTypes";

function createFakeRepo(): ItineraryRepository {
  const trips = [
    { id: "trip-a", agencyId: "agency-1", assignedOrganizerUserId: "staff-1", title: "A", itineraries: [] },
    { id: "trip-b", agencyId: "agency-1", assignedOrganizerUserId: "staff-2", title: "B", itineraries: [] }
  ];
  return {
    listTripsWithItineraries: async (agencyId) => trips.filter((t) => t.agencyId === agencyId) as any,
    listTripsForUser: async (agencyId, filter) => {
      const base = trips.filter((t) => t.agencyId === agencyId);
      return (filter.role === "STAFF" ? base.filter((t) => t.assignedOrganizerUserId === filter.userId) : base) as any;
    },
  } as unknown as ItineraryRepository;
}

describe("trip visibility by role", () => {
  it("STAFF sees only trips they organize", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "STAFF", userId: "staff-1" });
    expect(trips.map((t) => t.id)).toEqual(["trip-a"]);
  });

  it("ADMIN sees every trip", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "ADMIN", userId: "any-admin" });
    expect(trips.map((t) => t.id).sort()).toEqual(["trip-a", "trip-b"]);
  });

  it("OWNER sees every trip", async () => {
    const service = createItineraryService({ repository: createFakeRepo() });
    const trips = await service.listTripsForUser("agency-1", { role: "OWNER", userId: "owner-id" });
    expect(trips.map((t) => t.id).sort()).toEqual(["trip-a", "trip-b"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/tripVisibility.test.ts
```

Expected: FAIL with `service.listTripsForUser is not a function`.

- [ ] **Step 3: Implement in the service**

In `itineraryService.ts`, add to the returned object:

```ts
async listTripsForUser(agencyId: string, filter: { role: "OWNER" | "ADMIN" | "STAFF"; userId: string }) {
  return options.repository.listTripsForUser(agencyId, filter);
},
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/tripVisibility.test.ts
```

- [ ] **Step 5: Update the route to use the new service**

In `itineraryRoutes.ts`, update the `GET /` handler so that it reads the membership role from the access result and dispatches to the new service:

```ts
itineraryRoutes.get("/", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(
      request.authUser!,
      String(params.agencyId)
    );
    const role = access.membership!.role;
    const trips = await itineraryService.listTripsForUser(access.agency.id, {
      role,
      userId: request.authUser!.id
    });
    response.json({ trips });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 6: Run the suite**

```powershell
npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/itineraries/itineraryService.ts src/modules/itineraries/itineraryRoutes.ts tests/tripVisibility.test.ts
git commit -m "feat(itinerary): role-scoped trip list (STAFF own-only)"
```

## Task 15: Agent thread visibility — STAFF own-only for `tripId = null`

**Files:**
- Modify: `Voyage-Server/src/modules/workspace/workspaceService.ts`

- [ ] **Step 1: Update `getBootstrap` to accept role + userId**

Change the signature to:

```ts
export async function getBootstrap(
  agencyId: string,
  viewer: { role: "OWNER" | "ADMIN" | "STAFF"; userId: string }
): Promise<BootstrapResult>
```

In the trip query, apply the same STAFF filter as Task 13:

```ts
prisma.clientTrip.findMany({
  where: viewer.role === "STAFF" ? { agencyId, assignedOrganizerUserId: viewer.userId } : { agencyId },
  // ...rest unchanged
}),
```

In the thread query, filter STAFF visibility:

```ts
prisma.agentThread.findMany({
  where: viewer.role === "STAFF"
    ? {
        agencyId,
        OR: [
          { tripId: { in: visibleTripIds } },     // threads attached to trips they can see
          { tripId: null, createdByUserId: viewer.userId } // own general-research threads
        ]
      }
    : { agencyId },
  // ...rest unchanged
}),
```

Where `visibleTripIds` is the array of trip IDs from the trips query for STAFF. For non-STAFF roles, the existing `{ agencyId }` filter is used.

- [ ] **Step 2: Update the caller**

In `workspaceRoutes.ts`, change the bootstrap call to pass the viewer:

```ts
const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
const result = await getBootstrap(access.agency.id, {
  role: access.membership!.role,
  userId: request.authUser!.id
});
```

- [ ] **Step 3: Run the suite**

```powershell
npm test
```

Expected: existing tests pass (none asserted bootstrap visibility, so they should still be green; if any break, update them to pass an OWNER viewer).

- [ ] **Step 4: Commit**

```powershell
git add src/modules/workspace/workspaceService.ts src/modules/workspace/workspaceRoutes.ts
git commit -m "feat(workspace): STAFF bootstrap shows own trips and own no-trip threads"
```

---

# Phase 4 — Team management service + routes (TDD, dispatch tasks 16–19 in parallel with `sonnet`)

## Task 16: Team service — invite member

**Files:**
- Create: `Voyage-Server/src/modules/agencies/teamSchemas.ts`
- Create: `Voyage-Server/src/modules/agencies/teamRepository.ts`
- Create: `Voyage-Server/src/modules/agencies/teamService.ts`
- Create: `Voyage-Server/tests/teamService.test.ts`

- [ ] **Step 1: Write Zod schemas**

Create `teamSchemas.ts`:

```ts
import { z } from "zod";

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "STAFF"])
});

export const changeRoleSchema = z.object({
  role: z.enum(["ADMIN", "STAFF"])
});
```

- [ ] **Step 2: Write the repository interface**

Create `teamRepository.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type TeamMembershipRecord = {
  id: string;
  agencyId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
  user: { id: string; email: string; displayName: string };
  createdAt: Date;
};

export type TeamRepository = {
  listMembers(agencyId: string): Promise<TeamMembershipRecord[]>;
  findUserByEmail(emailNormalized: string): Promise<{ id: string } | null>;
  createMembership(input: { agencyId: string; userId: string; role: "ADMIN" | "STAFF" }): Promise<TeamMembershipRecord>;
  updateMembershipRole(membershipId: string, role: "ADMIN" | "STAFF"): Promise<TeamMembershipRecord>;
  deleteMembership(membershipId: string): Promise<void>;
  findMembershipById(membershipId: string): Promise<TeamMembershipRecord | null>;
  transferOwnership(input: { agencyId: string; fromUserId: string; toUserId: string }): Promise<void>;
};

export function createPrismaTeamRepository(client: PrismaClient = prisma): TeamRepository {
  const userSelect = { id: true, email: true, displayName: true } as const;
  return {
    async listMembers(agencyId) {
      return client.agencyMembership.findMany({
        where: { agencyId },
        include: { user: { select: userSelect } },
        orderBy: { createdAt: "asc" }
      }) as Promise<TeamMembershipRecord[]>;
    },
    async findUserByEmail(emailNormalized) {
      return client.user.findUnique({ where: { emailNormalized }, select: { id: true } });
    },
    async createMembership(input) {
      return client.agencyMembership.create({
        data: { ...input, status: "ACTIVE" },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord>;
    },
    async updateMembershipRole(membershipId, role) {
      return client.agencyMembership.update({
        where: { id: membershipId },
        data: { role },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord>;
    },
    async deleteMembership(membershipId) {
      await client.agencyMembership.delete({ where: { id: membershipId } });
    },
    async findMembershipById(membershipId) {
      return client.agencyMembership.findUnique({
        where: { id: membershipId },
        include: { user: { select: userSelect } }
      }) as Promise<TeamMembershipRecord | null>;
    },
    async transferOwnership({ agencyId, fromUserId, toUserId }) {
      await client.$transaction([
        client.agencyMembership.update({
          where: { agencyId_userId: { agencyId, userId: fromUserId } },
          data: { role: "ADMIN" }
        }),
        client.agencyMembership.update({
          where: { agencyId_userId: { agencyId, userId: toUserId } },
          data: { role: "OWNER" }
        }),
        client.agency.update({ where: { id: agencyId }, data: { ownerUserId: toUserId } })
      ]);
    }
  };
}
```

- [ ] **Step 3: Write the failing test for `inviteMember`**

Create `tests/teamService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTeamService } from "../src/modules/agencies/teamService";
import type { TeamRepository, TeamMembershipRecord } from "../src/modules/agencies/teamRepository";

function fakeRepo(seed: Partial<{
  byEmail: Record<string, { id: string }>;
  members: TeamMembershipRecord[];
}> = {}): TeamRepository & { created: any[] } {
  const created: any[] = [];
  return {
    created,
    async findUserByEmail(email) { return seed.byEmail?.[email] ?? null; },
    async listMembers() { return seed.members ?? []; },
    async createMembership(input) {
      created.push(input);
      return { id: "m-new", agencyId: input.agencyId, userId: input.userId, role: input.role, status: "ACTIVE", user: { id: input.userId, email: "x@example.com", displayName: "X" }, createdAt: new Date() };
    },
    async updateMembershipRole() { throw new Error("not used"); },
    async deleteMembership() { throw new Error("not used"); },
    async findMembershipById() { return null; },
    async transferOwnership() { throw new Error("not used"); }
  };
}

describe("teamService.inviteMember", () => {
  it("creates a STAFF membership for an existing user", async () => {
    const repo = fakeRepo({ byEmail: { "jane@example.com": { id: "user-2" } } });
    const service = createTeamService({ repository: repo });
    const member = await service.inviteMember({ agencyId: "agency-1", email: "Jane@Example.com", role: "STAFF" });
    expect(member.role).toBe("STAFF");
    expect(repo.created).toEqual([{ agencyId: "agency-1", userId: "user-2", role: "STAFF" }]);
  });

  it("rejects with USER_NOT_FOUND if email has no matching user", async () => {
    const repo = fakeRepo({ byEmail: {} });
    const service = createTeamService({ repository: repo });
    await expect(
      service.inviteMember({ agencyId: "agency-1", email: "nobody@example.com", role: "STAFF" })
    ).rejects.toMatchObject({ statusCode: 404, code: "USER_NOT_FOUND" });
  });

  it("rejects inviting as OWNER", async () => {
    const repo = fakeRepo({ byEmail: { "j@example.com": { id: "u-2" } } });
    const service = createTeamService({ repository: repo });
    await expect(
      service.inviteMember({ agencyId: "agency-1", email: "j@example.com", role: "OWNER" as any })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_INVITE_ROLE" });
  });

  it("rejects inviting a user who is already a member", async () => {
    const existing: TeamMembershipRecord = {
      id: "m-1", agencyId: "agency-1", userId: "user-2", role: "STAFF", status: "ACTIVE",
      user: { id: "user-2", email: "j@example.com", displayName: "J" }, createdAt: new Date()
    };
    const repo = fakeRepo({ byEmail: { "j@example.com": { id: "user-2" } }, members: [existing] });
    const service = createTeamService({ repository: repo });
    await expect(
      service.inviteMember({ agencyId: "agency-1", email: "j@example.com", role: "STAFF" })
    ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_A_MEMBER" });
  });
});
```

- [ ] **Step 4: Run, expect FAIL**

```powershell
npx vitest run tests/teamService.test.ts -t "inviteMember"
```

Expected: FAIL — module does not exist.

- [ ] **Step 5: Implement `teamService.ts`**

Create `src/modules/agencies/teamService.ts`:

```ts
import { ApiError } from "../../http/errors";
import type { TeamRepository, TeamMembershipRecord } from "./teamRepository";

export function createTeamService(options: { repository: TeamRepository }) {
  return {
    async listMembers(agencyId: string): Promise<TeamMembershipRecord[]> {
      return options.repository.listMembers(agencyId);
    },

    async inviteMember(input: { agencyId: string; email: string; role: "ADMIN" | "STAFF" }) {
      if (input.role !== "ADMIN" && input.role !== "STAFF") {
        throw new ApiError(400, "INVALID_INVITE_ROLE", "Members can only be invited as ADMIN or STAFF.");
      }
      const normalized = input.email.trim().toLowerCase();
      const user = await options.repository.findUserByEmail(normalized);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "No Voyage account is registered to that email.");
      }
      const existing = await options.repository.listMembers(input.agencyId);
      if (existing.some((m) => m.userId === user.id)) {
        throw new ApiError(409, "ALREADY_A_MEMBER", "That user is already a member of this agency.");
      }
      return options.repository.createMembership({
        agencyId: input.agencyId,
        userId: user.id,
        role: input.role
      });
    }
  };
}
```

- [ ] **Step 6: Run, expect PASS**

```powershell
npx vitest run tests/teamService.test.ts -t "inviteMember"
```

- [ ] **Step 7: Commit**

```powershell
git add src/modules/agencies/teamSchemas.ts src/modules/agencies/teamRepository.ts src/modules/agencies/teamService.ts tests/teamService.test.ts
git commit -m "feat(team): inviteMember service with existence and dedupe checks"
```

## Task 17: Team service — remove member (OWNER-protected)

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/teamService.ts`
- Modify: `Voyage-Server/tests/teamService.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/teamService.test.ts`:

```ts
describe("teamService.removeMember", () => {
  it("removes a STAFF member", async () => {
    let deleted: string | null = null;
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById(id) {
        return id === "m-staff"
          ? { id: "m-staff", agencyId: "agency-1", userId: "user-3", role: "STAFF", status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() }
          : null;
      },
      async deleteMembership(id) { deleted = id; }
    };
    const service = createTeamService({ repository: repo });
    await service.removeMember({ agencyId: "agency-1", membershipId: "m-staff" });
    expect(deleted).toBe("m-staff");
  });

  it("rejects removing the OWNER with OWNER_PROTECTED", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      },
      async deleteMembership() { throw new Error("should not delete"); }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.removeMember({ agencyId: "agency-1", membershipId: "m-owner" })
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_PROTECTED" });
  });

  it("rejects when membership does not belong to the agency", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-other", agencyId: "OTHER-AGENCY", userId: "user-4", role: "STAFF", status: "ACTIVE", user: { id: "user-4", email: "x@x", displayName: "X" }, createdAt: new Date() };
      },
      async deleteMembership() { throw new Error("should not delete"); }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.removeMember({ agencyId: "agency-1", membershipId: "m-other" })
    ).rejects.toMatchObject({ statusCode: 404, code: "MEMBER_NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/teamService.test.ts -t "removeMember"
```

- [ ] **Step 3: Implement `removeMember`**

Add to the object in `teamService.ts`:

```ts
async removeMember(input: { agencyId: string; membershipId: string }) {
  const membership = await options.repository.findMembershipById(input.membershipId);
  if (!membership || membership.agencyId !== input.agencyId) {
    throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
  }
  if (membership.role === "OWNER") {
    throw new ApiError(403, "OWNER_PROTECTED", "The owner can only be changed via Transfer Ownership.");
  }
  await options.repository.deleteMembership(membership.id);
},
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/teamService.test.ts -t "removeMember"
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencies/teamService.ts tests/teamService.test.ts
git commit -m "feat(team): removeMember with OWNER protection"
```

## Task 18: Team service — change role (within ADMIN/STAFF, never OWNER)

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/teamService.ts`
- Modify: `Voyage-Server/tests/teamService.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/teamService.test.ts`:

```ts
describe("teamService.changeMemberRole", () => {
  it("promotes a STAFF to ADMIN", async () => {
    let updated: { id: string; role: string } | null = null;
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-staff", agencyId: "agency-1", userId: "user-3", role: "STAFF", status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() };
      },
      async updateMembershipRole(id, role) {
        updated = { id, role };
        return { id, agencyId: "agency-1", userId: "user-3", role, status: "ACTIVE", user: { id: "user-3", email: "s@x", displayName: "S" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-staff", role: "ADMIN" });
    expect(updated).toEqual({ id: "m-staff", role: "ADMIN" });
  });

  it("rejects changing the OWNER role", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-owner", role: "ADMIN" })
    ).rejects.toMatchObject({ statusCode: 403, code: "OWNER_PROTECTED" });
  });

  it("rejects promoting to OWNER (must use Transfer Ownership)", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-admin", agencyId: "agency-1", userId: "user-2", role: "ADMIN", status: "ACTIVE", user: { id: "user-2", email: "a@x", displayName: "A" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.changeMemberRole({ agencyId: "agency-1", membershipId: "m-admin", role: "OWNER" as any })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_TARGET_ROLE" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/teamService.test.ts -t "changeMemberRole"
```

- [ ] **Step 3: Implement**

```ts
async changeMemberRole(input: { agencyId: string; membershipId: string; role: "ADMIN" | "STAFF" }) {
  if (input.role !== "ADMIN" && input.role !== "STAFF") {
    throw new ApiError(400, "INVALID_TARGET_ROLE", "Members can only be promoted to ADMIN or demoted to STAFF. Use Transfer Ownership to change the owner.");
  }
  const membership = await options.repository.findMembershipById(input.membershipId);
  if (!membership || membership.agencyId !== input.agencyId) {
    throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
  }
  if (membership.role === "OWNER") {
    throw new ApiError(403, "OWNER_PROTECTED", "The owner can only be changed via Transfer Ownership.");
  }
  return options.repository.updateMembershipRole(membership.id, input.role);
},
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/teamService.test.ts -t "changeMemberRole"
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencies/teamService.ts tests/teamService.test.ts
git commit -m "feat(team): changeMemberRole within ADMIN/STAFF only"
```

## Task 19: Team service — transfer ownership (atomic)

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/teamService.ts`
- Modify: `Voyage-Server/tests/teamService.test.ts`

- [ ] **Step 1: Failing test**

```ts
describe("teamService.transferOwnership", () => {
  it("atomically swaps OWNER and updates Agency.ownerUserId", async () => {
    const transfers: any[] = [];
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById(id) {
        if (id === "m-current-owner") return { id, agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
        if (id === "m-target-admin") return { id, agencyId: "agency-1", userId: "admin-2", role: "ADMIN", status: "ACTIVE", user: { id: "admin-2", email: "a@x", displayName: "A" }, createdAt: new Date() };
        return null;
      },
      async transferOwnership(input) { transfers.push(input); }
    };
    const service = createTeamService({ repository: repo });
    await service.transferOwnership({
      agencyId: "agency-1",
      currentOwnerMembershipId: "m-current-owner",
      targetMembershipId: "m-target-admin"
    });
    expect(transfers).toEqual([{ agencyId: "agency-1", fromUserId: "owner-1", toUserId: "admin-2" }]);
  });

  it("rejects when current OWNER membership is not actually OWNER", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-x", agencyId: "agency-1", userId: "u-1", role: "ADMIN", status: "ACTIVE", user: { id: "u-1", email: "x@x", displayName: "X" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.transferOwnership({ agencyId: "agency-1", currentOwnerMembershipId: "m-x", targetMembershipId: "m-x" })
    ).rejects.toMatchObject({ statusCode: 400, code: "NOT_CURRENT_OWNER" });
  });

  it("rejects when target is the same as current OWNER", async () => {
    const repo: TeamRepository = {
      ...fakeRepo(),
      async findMembershipById() {
        return { id: "m-owner", agencyId: "agency-1", userId: "owner-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", email: "o@x", displayName: "O" }, createdAt: new Date() };
      }
    };
    const service = createTeamService({ repository: repo });
    await expect(
      service.transferOwnership({ agencyId: "agency-1", currentOwnerMembershipId: "m-owner", targetMembershipId: "m-owner" })
    ).rejects.toMatchObject({ statusCode: 400, code: "TRANSFER_SAME_USER" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/teamService.test.ts -t "transferOwnership"
```

- [ ] **Step 3: Implement**

```ts
async transferOwnership(input: { agencyId: string; currentOwnerMembershipId: string; targetMembershipId: string }) {
  if (input.currentOwnerMembershipId === input.targetMembershipId) {
    throw new ApiError(400, "TRANSFER_SAME_USER", "The new owner must be a different member.");
  }
  const current = await options.repository.findMembershipById(input.currentOwnerMembershipId);
  if (!current || current.agencyId !== input.agencyId || current.role !== "OWNER") {
    throw new ApiError(400, "NOT_CURRENT_OWNER", "Source membership is not the current owner.");
  }
  const target = await options.repository.findMembershipById(input.targetMembershipId);
  if (!target || target.agencyId !== input.agencyId) {
    throw new ApiError(404, "MEMBER_NOT_FOUND", "Target member not found.");
  }
  await options.repository.transferOwnership({
    agencyId: input.agencyId,
    fromUserId: current.userId,
    toUserId: target.userId
  });
},
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/teamService.test.ts -t "transferOwnership"
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencies/teamService.ts tests/teamService.test.ts
git commit -m "feat(team): transferOwnership atomic swap"
```

## Task 20: Wire team routes

**Files:**
- Create: `Voyage-Server/src/modules/agencies/teamRoutes.ts`
- Modify: `Voyage-Server/src/app.ts`

- [ ] **Step 1: Create the router**

Create `src/modules/agencies/teamRoutes.ts`:

```ts
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { inviteMemberSchema, changeRoleSchema } from "./teamSchemas";
import { createTeamService } from "./teamService";
import { createPrismaTeamRepository } from "./teamRepository";

const teamService = createTeamService({ repository: createPrismaTeamRepository() });

export const teamRoutes = Router({ mergeParams: true });

teamRoutes.use(requireAuth);

// List members — any active member (including STAFF) can read
teamRoutes.get("/", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, String(params.agencyId));
    const members = await teamService.listMembers(access.agency.id);
    response.json({ members, viewerRole: access.membership!.role });
  } catch (error) {
    next(error);
  }
});

// Invite — OWNER or ADMIN
teamRoutes.post("/", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    const input = inviteMemberSchema.parse(request.body);
    const member = await teamService.inviteMember({ agencyId: access.agency.id, ...input });
    response.status(201).json({ member });
  } catch (error) {
    next(error);
  }
});

// Change role — OWNER or ADMIN
teamRoutes.patch("/:membershipId/role", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    const input = changeRoleSchema.parse(request.body);
    const member = await teamService.changeMemberRole({
      agencyId: access.agency.id,
      membershipId: String(request.params.membershipId),
      role: input.role
    });
    response.json({ member });
  } catch (error) {
    next(error);
  }
});

// Remove — OWNER or ADMIN
teamRoutes.delete("/:membershipId", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyAdmin(request.authUser!, String(params.agencyId));
    await teamService.removeMember({
      agencyId: access.agency.id,
      membershipId: String(request.params.membershipId)
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Transfer ownership — OWNER only
teamRoutes.post("/transfer-ownership", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await agencyAccessService.requireAgencyOwner(request.authUser!, String(params.agencyId));
    const { targetMembershipId } = request.body as { targetMembershipId: string };
    const currentOwnerMembership = access.membership!;
    await teamService.transferOwnership({
      agencyId: access.agency.id,
      currentOwnerMembershipId: currentOwnerMembership.userId, // see Step 2 note
      targetMembershipId
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Resolve current OWNER's membership id**

In the transfer-ownership handler above, `access.membership` includes `userId` and `role` but not the membership row's `id`. Replace the inline `currentOwnerMembership.userId` argument with an explicit lookup via the team repository's `findMembershipById`, or extend `AgencyAccess.membership` to include `id`. The cleanest fix: extend the `AgencyAccess` type and the Prisma repo to return the membership `id`. Then change `agencyAccessService.ts`:

```ts
export type AgencyAccess = {
  agency: { id: string; status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED" };
  membership: {
    id: string;
    userId: string;
    agencyId: string;
    role: "OWNER" | "ADMIN" | "STAFF";
    status: "ACTIVE" | "DISABLED";
  } | null;
};
```

And in `createPrismaAgencyAccessRepository.findAgencyAccess`, ensure the include returns `id`. Then the route line becomes:

```ts
currentOwnerMembershipId: currentOwnerMembership.id,
```

- [ ] **Step 3: Mount the router**

In `src/app.ts`, add the import and mount:

```ts
import { teamRoutes } from "./modules/agencies/teamRoutes";
// ...
app.use("/agencies/:agencyId/team", teamRoutes);
```

- [ ] **Step 4: Run the suite**

```powershell
npm test
```

Expected: all green. Add a quick integration smoke test that hits `GET /agencies/:agencyId/team` and asserts it returns 200 + a `viewerRole` field; assertions for STAFF read-only behavior live on the client side.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencies/teamRoutes.ts src/app.ts src/modules/agencyAccess/agencyAccessService.ts
git commit -m "feat(team): wire team routes with role-gated access"
```

---

# Phase 5 — Settings & delete-agency (TDD, sequential, `sonnet`)

## Task 21: Allow ADMIN to edit settings (already partially done in Task 12)

**Files:**
- Modify: `Voyage-Server/tests/agencyService.test.ts`

- [ ] **Step 1: Add a test for ADMIN settings update**

Append a test asserting that an ADMIN membership can call `updateAgencySettings` and a STAFF cannot. The existing test that asserts only OWNER may edit settings should be updated to reflect the new "ADMIN or OWNER" rule from the matrix.

```ts
it("allows ADMIN to update agency settings", async () => {
  // ... arrange ADMIN membership ...
  const result = await service.updateAgencySettings(adminUser, agency.id, validInput);
  expect(result.name).toEqual(validInput.name);
});

it("rejects STAFF updating agency settings with AGENCY_ADMIN_REQUIRED", async () => {
  // ... arrange STAFF membership ...
  await expect(service.updateAgencySettings(staffUser, agency.id, validInput))
    .rejects.toMatchObject({ statusCode: 403, code: "AGENCY_ADMIN_REQUIRED" });
});
```

- [ ] **Step 2: Run, expect PASS**

(Task 12 already implements the behavior; this task confirms test coverage.)

```powershell
npx vitest run tests/agencyService.test.ts -t "settings"
```

- [ ] **Step 3: Commit**

```powershell
git add tests/agencyService.test.ts
git commit -m "test(agency): cover ADMIN settings edit and STAFF rejection"
```

## Task 22: `deleteAgency` — OWNER only with typed-name confirmation

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyService.ts`
- Modify: `Voyage-Server/src/modules/agencies/agencyRoutes.ts`
- Modify: `Voyage-Server/tests/agencyService.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/agencyService.test.ts`:

```ts
describe("deleteAgency", () => {
  it("deletes the agency when OWNER provides the correct name confirmation", async () => {
    // arrange OWNER + verified agency
    const result = await service.deleteAgency(ownerUser, agency.id, { confirmName: agency.name });
    expect(result.deleted).toBe(true);
  });

  it("rejects with NAME_CONFIRMATION_MISMATCH when the typed name does not match", async () => {
    await expect(
      service.deleteAgency(ownerUser, agency.id, { confirmName: "Wrong Name" })
    ).rejects.toMatchObject({ statusCode: 400, code: "NAME_CONFIRMATION_MISMATCH" });
  });

  it("rejects an ADMIN attempting to delete with AGENCY_OWNER_REQUIRED", async () => {
    await expect(
      service.deleteAgency(adminUser, agency.id, { confirmName: agency.name })
    ).rejects.toMatchObject({ statusCode: 403, code: "AGENCY_OWNER_REQUIRED" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/agencyService.test.ts -t "deleteAgency"
```

- [ ] **Step 3: Implement**

In `agencyService.ts`, extend the `AgencyRepository` type:

```ts
deleteAgencyCascade(agencyId: string): Promise<void>;
```

Implement in `agencyRepository.ts`:

```ts
async deleteAgencyCascade(agencyId) {
  await client.agency.delete({ where: { id: agencyId } });
  // Prisma cascade rules in the schema take care of memberships, trips, itineraries, etc.
},
```

Add the service method:

```ts
async deleteAgency(user: AgencyUser, agencyId: string, input: { confirmName: string }) {
  assertActive(user);
  const agency = await findRequiredAgency(agencyId);
  const membership = await options.repository.findMembership(agencyId, user.id);
  if (!membership || membership.status !== "ACTIVE" || membership.role !== "OWNER") {
    throw new ApiError(403, "AGENCY_OWNER_REQUIRED", "Only the agency owner can delete the agency.");
  }
  if (input.confirmName.trim() !== agency.name) {
    throw new ApiError(400, "NAME_CONFIRMATION_MISMATCH", "Typed agency name does not match.");
  }
  await options.repository.deleteAgencyCascade(agencyId);
  return { deleted: true as const, agencyId };
}
```

- [ ] **Step 4: Add the route**

In `agencyRoutes.ts`:

```ts
agencyRoutes.delete("/:agencyId", requireAuth, async (request, response, next) => {
  try {
    const { confirmName } = request.body as { confirmName?: string };
    if (typeof confirmName !== "string") {
      throw new ApiError(400, "NAME_CONFIRMATION_REQUIRED", "confirmName is required.");
    }
    const result = await agencyService.deleteAgency(request.authUser!, String(request.params.agencyId), { confirmName });
    response.json(result);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: Run, expect PASS**

```powershell
npm test
```

- [ ] **Step 6: Commit**

```powershell
git add src/modules/agencies/agencyService.ts src/modules/agencies/agencyRepository.ts src/modules/agencies/agencyRoutes.ts tests/agencyService.test.ts
git commit -m "feat(agency): deleteAgency OWNER-only with name confirmation"
```

## Task 23: Verify all server changes pass end-to-end

**Files:**
- (No new files)

- [ ] **Step 1: Run the full suite**

```powershell
cd Voyage-Server
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Type-check**

```powershell
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit a tag (no code change)**

If anything was straggling, fix and commit. Otherwise no commit needed.

---

# Phase 6 — Client: nav, Team page, Settings page (sequential, `sonnet`)

## Task 24: `useAgencyRole` hook and team API client

**Files:**
- Create: `Voyage-Client/app/hooks/useAgencyRole.js`
- Create: `Voyage-Client/app/lib/api/team.js`
- Modify: `Voyage-Client/app/lib/api/index.js`

- [ ] **Step 1: Write the API client**

Create `app/lib/api/team.js`:

```js
import { fetchApi } from "./fetchApi.js"; // existing helper used by admin.js — adjust import if needed

export function fetchTeam(agencyId) {
  return fetchApi(`/agencies/${agencyId}/team`);
}

export function inviteMember(agencyId, body) {
  return fetchApi(`/agencies/${agencyId}/team`, { method: "POST", body });
}

export function changeMemberRole(agencyId, membershipId, role) {
  return fetchApi(`/agencies/${agencyId}/team/${membershipId}/role`, { method: "PATCH", body: { role } });
}

export function removeMember(agencyId, membershipId) {
  return fetchApi(`/agencies/${agencyId}/team/${membershipId}`, { method: "DELETE" });
}

export function transferOwnership(agencyId, targetMembershipId) {
  return fetchApi(`/agencies/${agencyId}/team/transfer-ownership`, { method: "POST", body: { targetMembershipId } });
}

export function deleteAgency(agencyId, confirmName) {
  return fetchApi(`/agencies/${agencyId}`, { method: "DELETE", body: { confirmName } });
}
```

If the existing API helpers use a different style (look at `admin.js`), match that style — the import path and method options must compile.

- [ ] **Step 2: Re-export from `index.js`**

In `app/lib/api/index.js`, add:

```js
export * from "./team.js";
```

- [ ] **Step 3: Create the `useAgencyRole` hook**

Create `app/hooks/useAgencyRole.js`:

```js
"use client";
import { useMemo } from "react";
import { useAuth } from "./useAuth"; // existing auth context hook — adjust if differently named

export function useAgencyRole(agencyId) {
  const { user } = useAuth();
  return useMemo(() => {
    const membership = user?.memberships?.find((m) => m.agencyId === agencyId);
    return membership?.role ?? null; // "OWNER" | "ADMIN" | "STAFF" | null
  }, [user, agencyId]);
}
```

If the existing auth hook is named differently (search `useAuth` or `AuthContext` in `app/hooks/`), use that name.

- [ ] **Step 4: Commit**

```powershell
git add app/hooks/useAgencyRole.js app/lib/api/team.js app/lib/api/index.js
git commit -m "feat(client): add team API client and useAgencyRole hook"
```

## Task 25: Agency layout with role-aware nav

**Files:**
- Create: `Voyage-Client/app/agency/[agencyId]/layout.jsx`

- [ ] **Step 1: Write the layout**

Create `app/agency/[agencyId]/layout.jsx`:

```jsx
"use client";
import { use } from "react";
import Link from "next/link";
import { useAgencyRole } from "@/app/hooks/useAgencyRole";

export default function AgencyLayout({ children, params }) {
  const { agencyId } = use(params);
  const role = useAgencyRole(agencyId);

  const tabs = [
    { href: `/agency/${agencyId}/trip`, label: role === "STAFF" ? "My Trips" : "Trips" },
    { href: `/agency/${agencyId}/agent`, label: "Agent" },
    { href: `/agency/${agencyId}/team`, label: "Team" },
    ...(role === "OWNER" || role === "ADMIN"
      ? [{ href: `/agency/${agencyId}/settings`, label: "Settings" }]
      : [])
  ];

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-white/8 px-6 py-3 text-sm" aria-label="Agency navigation">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded px-3 py-1.5 text-white/65 transition-colors hover:bg-white/5 hover:text-white"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Start the client dev server, sign in as users with different roles, and navigate to `/agency/<agencyId>/agent`. Expected: STAFF sees `My Trips, Agent, Team`; ADMIN sees `Trips, Agent, Team, Settings`; OWNER same as ADMIN.

- [ ] **Step 3: Commit**

```powershell
git add app/agency/[agencyId]/layout.jsx
git commit -m "feat(client): role-aware agency layout nav"
```

## Task 26: Team page

**Files:**
- Create: `Voyage-Client/app/agency/[agencyId]/team/page.jsx`
- Create: `Voyage-Client/app/components/team/TeamPage.jsx`
- Create: `Voyage-Client/app/components/team/MemberRow.jsx`
- Create: `Voyage-Client/app/components/team/RolePill.jsx`
- Create: `Voyage-Client/app/components/team/InviteMemberModal.jsx`
- Create: `Voyage-Client/app/components/team/ChangeRoleModal.jsx`
- Create: `Voyage-Client/app/components/team/RemoveMemberModal.jsx`

- [ ] **Step 1: Route page**

Create `app/agency/[agencyId]/team/page.jsx`:

```jsx
"use client";
import { use } from "react";
import TeamPage from "@/app/components/team/TeamPage";

export default function Page({ params }) {
  const { agencyId } = use(params);
  return <TeamPage agencyId={agencyId} />;
}
```

- [ ] **Step 2: RolePill component**

Create `app/components/team/RolePill.jsx`:

```jsx
export default function RolePill({ role }) {
  const isOwner = role === "OWNER";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider " +
        (isOwner
          ? "border border-white/30 text-white/85"
          : "text-white/55")
      }
    >
      {role}
    </span>
  );
}
```

- [ ] **Step 3: MemberRow component**

Create `app/components/team/MemberRow.jsx`:

```jsx
import RolePill from "./RolePill";

export default function MemberRow({ member, viewerRole, onChangeRole, onRemove }) {
  const canManage = (viewerRole === "OWNER" || viewerRole === "ADMIN") && member.role !== "OWNER";
  return (
    <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-full bg-white/10" aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-sm text-white">{member.user.displayName}</div>
          <div className="truncate text-xs text-white/55">{member.user.email}</div>
        </div>
      </div>
      <RolePill role={member.role} />
      <div className="text-xs text-white/45 w-28 text-right">
        {new Date(member.createdAt).toLocaleDateString()}
      </div>
      {canManage ? (
        <div className="relative">
          <button
            type="button"
            className="rounded px-2 py-1 text-white/55 hover:bg-white/5"
            onClick={() => onChangeRole?.(member)}
            aria-label="Change role"
          >…</button>
          {/* Inline menu rendered by parent on click — kept simple here */}
        </div>
      ) : (
        <div className="w-8" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: TeamPage container**

Create `app/components/team/TeamPage.jsx`:

```jsx
"use client";
import { useEffect, useState } from "react";
import { fetchTeam, inviteMember, changeMemberRole, removeMember } from "@/app/lib/api/index.js";
import MemberRow from "./MemberRow";
import InviteMemberModal from "./InviteMemberModal";
import ChangeRoleModal from "./ChangeRoleModal";
import RemoveMemberModal from "./RemoveMemberModal";

export default function TeamPage({ agencyId }) {
  const [data, setData] = useState({ members: [], viewerRole: null });
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  async function refresh() {
    setLoading(true);
    const result = await fetchTeam(agencyId);
    setData(result);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [agencyId]);

  const canInvite = data.viewerRole === "OWNER" || data.viewerRole === "ADMIN";

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl text-white">Team</h1>
        {canInvite && (
          <button
            type="button"
            className="rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
            onClick={() => setInviteOpen(true)}
          >
            Invite member
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-white/5 bg-white/[0.02]">
        {loading ? (
          <div className="px-4 py-8 text-center text-white/55">Loading…</div>
        ) : (
          data.members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              viewerRole={data.viewerRole}
              onChangeRole={(member) => setEditing(member)}
              onRemove={(member) => setRemoving(member)}
            />
          ))
        )}
      </div>

      {inviteOpen && (
        <InviteMemberModal
          agencyId={agencyId}
          onClose={() => setInviteOpen(false)}
          onInvited={async () => { setInviteOpen(false); await refresh(); }}
        />
      )}
      {editing && (
        <ChangeRoleModal
          agencyId={agencyId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refresh(); }}
        />
      )}
      {removing && (
        <RemoveMemberModal
          agencyId={agencyId}
          member={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => { setRemoving(null); await refresh(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Modals**

Create the three modal components with these signatures and behavior:

`InviteMemberModal.jsx`:
- Inputs: email (string), role (radio: ADMIN | STAFF).
- On submit: call `inviteMember(agencyId, { email, role })`; surface API errors inline; on 200, call `onInvited`.

`ChangeRoleModal.jsx`:
- Props: `member`, `agencyId`, `onClose`, `onSaved`.
- Inputs: role (radio: ADMIN | STAFF). Preselect the member's current role.
- On submit: call `changeMemberRole(agencyId, member.id, role)`; on 200, call `onSaved`.

`RemoveMemberModal.jsx`:
- Props: `member`, `agencyId`, `onClose`, `onRemoved`.
- Body: "Remove [name]? They will lose access immediately."
- Confirm button: red-but-muted. On click: `removeMember(agencyId, member.id)`; on 204, call `onRemoved`.

Each modal: keep it small. No need for animation libraries — match existing modal patterns (search `Modal` in `app/components/` for the project's convention).

- [ ] **Step 6: Manual smoke test**

In dev: as OWNER, invite a STAFF, promote to ADMIN, demote back, then remove. As ADMIN: same actions. As STAFF: confirm the `…` menus do not appear, the *Invite member* button is hidden, but member list still renders.

- [ ] **Step 7: Commit**

```powershell
git add app/agency/[agencyId]/team/page.jsx app/components/team/
git commit -m "feat(client): team page with role-aware management UI"
```

## Task 27: Settings page with Danger Zone

**Files:**
- Create: `Voyage-Client/app/agency/[agencyId]/settings/page.jsx`
- Create: `Voyage-Client/app/components/settings/AgencySettingsPage.jsx`
- Create: `Voyage-Client/app/components/settings/DangerZoneCard.jsx`
- Create: `Voyage-Client/app/components/settings/TransferOwnershipModal.jsx`
- Create: `Voyage-Client/app/components/settings/DeleteAgencyModal.jsx`

- [ ] **Step 1: Route page**

Create `app/agency/[agencyId]/settings/page.jsx`:

```jsx
"use client";
import { use } from "react";
import AgencySettingsPage from "@/app/components/settings/AgencySettingsPage";

export default function Page({ params }) {
  const { agencyId } = use(params);
  return <AgencySettingsPage agencyId={agencyId} />;
}
```

- [ ] **Step 2: Settings container**

Create `app/components/settings/AgencySettingsPage.jsx`. It loads the agency profile via the existing agency-settings endpoint, presents a form (name, businessPhone, businessEmail, country, city), saves via `PATCH /agencies/:agencyId/settings`. Below the form, render `<DangerZoneCard agencyId={agencyId} />` — and ONLY render it when `useAgencyRole(agencyId) === "OWNER"`.

(The form itself follows the patterns in `app/components/agency-status/` or other existing settings forms — match the look.)

- [ ] **Step 3: Danger Zone card**

Create `app/components/settings/DangerZoneCard.jsx`:

```jsx
"use client";
import { useState } from "react";
import TransferOwnershipModal from "./TransferOwnershipModal";
import DeleteAgencyModal from "./DeleteAgencyModal";

export default function DangerZoneCard({ agencyId, agencyName, members }) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="mt-12 rounded-lg border border-rose-400/20 bg-rose-500/[0.03] p-6">
      <h2 className="mb-2 text-sm uppercase tracking-wider text-rose-200/70">Danger zone</h2>
      <p className="mb-4 text-sm text-white/55">
        These actions affect the entire agency and cannot be undone.
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          className="self-start rounded border border-white/10 px-3 py-1.5 text-sm text-white/75 hover:bg-white/5"
        >
          Transfer ownership…
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="self-start rounded border border-rose-400/30 px-3 py-1.5 text-sm text-rose-200/90 hover:bg-rose-500/10"
        >
          Delete agency…
        </button>
      </div>

      {transferOpen && (
        <TransferOwnershipModal
          agencyId={agencyId}
          members={members}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteAgencyModal
          agencyId={agencyId}
          agencyName={agencyName}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Transfer Ownership modal**

`TransferOwnershipModal.jsx`:
- Lists current admins (filter `members.filter(m => m.role === "ADMIN")`).
- Radio-select one as the new OWNER.
- Confirm button is disabled until a selection is made.
- On confirm: call `transferOwnership(agencyId, selectedMembershipId)`. On 204: reload the page (the viewer is no longer OWNER, so the Danger Zone will disappear on rerender).

- [ ] **Step 5: Delete Agency modal**

`DeleteAgencyModal.jsx`:
- Body: "Type the agency name to confirm. This deletes all trips, itineraries, and threads."
- Input: typed name; the Delete button is disabled until input === agencyName.
- On confirm: call `deleteAgency(agencyId, input)`. On 200: redirect to `/`.

- [ ] **Step 6: Manual smoke test**

As OWNER: open Settings, see Danger Zone. Transfer ownership to an ADMIN; verify the page rerenders without Danger Zone (you are now ADMIN). As ADMIN: open Settings, no Danger Zone. As STAFF: visiting `/agency/<id>/settings` returns 403 — Task 28 handles the client redirect.

- [ ] **Step 7: Commit**

```powershell
git add app/agency/[agencyId]/settings/page.jsx app/components/settings/
git commit -m "feat(client): settings page with OWNER-only Danger Zone"
```

## Task 28: Error UX — STAFF redirects from Settings; 404 trip empty state

**Files:**
- Create: `Voyage-Client/app/components/agency-status/TripNotInListEmptyState.jsx`
- Modify: `Voyage-Client/app/agency/[agencyId]/settings/page.jsx`
- Modify: any trip-detail page that may receive a 404 from the new `requireTripAccess` gate

- [ ] **Step 1: Redirect STAFF from settings client-side**

In `app/agency/[agencyId]/settings/page.jsx`, before rendering, check the role:

```jsx
"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAgencyRole } from "@/app/hooks/useAgencyRole";
import AgencySettingsPage from "@/app/components/settings/AgencySettingsPage";

export default function Page({ params }) {
  const { agencyId } = use(params);
  const role = useAgencyRole(agencyId);
  const router = useRouter();

  useEffect(() => {
    if (role === "STAFF") {
      // Persist a one-time toast key in sessionStorage; the team page reads & clears it.
      try { sessionStorage.setItem("voyage:settingsDeniedToast", "1"); } catch {}
      router.replace(`/agency/${agencyId}/team`);
    }
  }, [role, router, agencyId]);

  if (role === "STAFF" || role == null) return null;
  return <AgencySettingsPage agencyId={agencyId} />;
}
```

In `app/components/team/TeamPage.jsx`, on mount, read and clear the toast key; if present, render a one-time inline notice: *"Settings are managed by your owner and admins."*

- [ ] **Step 2: Trip not-in-list empty state**

Create `app/components/agency-status/TripNotInListEmptyState.jsx`:

```jsx
export default function TripNotInListEmptyState({ ownerName, ownerEmail }) {
  return (
    <div className="mx-auto mt-24 max-w-md px-6 text-center">
      <p className="text-sm text-white/55">
        This trip isn't on your list.
        {ownerName ? (
          <>
            {" "}Ask <span className="text-white/85">{ownerName}</span> if you should be assigned.
          </>
        ) : null}
      </p>
      {ownerEmail && (
        <a
          href={`mailto:${ownerEmail}`}
          className="mt-3 inline-block text-sm text-white/85 underline-offset-4 hover:underline"
        >
          {ownerEmail}
        </a>
      )}
    </div>
  );
}
```

In the trip-detail loader (search for the page that fetches a trip by id under `app/agency/[agencyId]/trip/[tripId]/...`), catch the 404 from the server, fetch agency owner info from the existing agency-settings endpoint or include it in the bootstrap, and render `<TripNotInListEmptyState ownerName=... ownerEmail=... />`.

- [ ] **Step 3: Manual smoke test**

As STAFF: visit `/agency/<id>/settings`. Expected: redirect to `/agency/<id>/team` and see the one-time notice. Refresh the team page — notice is gone. Visit `/agency/<id>/trip/<unassigned-trip-id>`. Expected: see the empty-state message naming the owner.

- [ ] **Step 4: Commit**

```powershell
git add app/components/agency-status/TripNotInListEmptyState.jsx app/agency/[agencyId]/settings/page.jsx app/components/team/TeamPage.jsx app/agency/[agencyId]/trip/
git commit -m "feat(client): friendly error UX for staff settings + trip 404"
```

---

# Phase 7 — Final verification (`haiku`)

## Task 29: Full-stack regression run

**Files:**
- (None)

- [ ] **Step 1: Server tests**

```powershell
cd Voyage-Server
npm test
```

Expected: all green.

- [ ] **Step 2: Server type-check**

```powershell
npm run build
```

Expected: clean build.

- [ ] **Step 3: Client lint / build**

```powershell
cd ../Voyage-Client
npm run lint 2>$null
npm run build
```

Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: Smoke checklist (manual)**

Sign in as each role and confirm:

- SUPER_ADMIN: Admin tab still visible; pending-count badge still polls; approve / reject / suspend still work.
- OWNER: sees nav Trips, Agent, Team, Settings; Team page has `…` menus; Settings has Danger Zone.
- ADMIN: same nav as OWNER but no Danger Zone in Settings; can invite, change role within ADMIN/STAFF, but `…` is absent on the OWNER row.
- STAFF: nav shows My Trips, Agent, Team (no Settings link); Team page is read-only; My Trips list filters to organizer-assigned only; visiting `/agency/<id>/settings` redirects to Team with notice; visiting an unowned trip URL renders the empty state.
- All roles: agent threads with tripId cascade visibility correctly; STAFF only sees own no-trip threads.

- [ ] **Step 5: Final commit (if any straggler fixes)**

If the smoke check turned up small fixes, commit them as separate `fix:` commits.

## Task 30: Open a pull request

**Files:**
- (None)

- [ ] **Step 1: Push branch**

```powershell
cd Voyage-Server
git push -u origin docs/agency-roles-permissions-spec
# Then on whichever branch contains the implementation:
git push -u origin feat/agency-roles-permissions
```

- [ ] **Step 2: Open PR**

Use `gh pr create` with a title like `feat: agency roles and permissions (super-admin rename + team/settings)` and a body that lists the matrix delta and links to both the spec and this plan.

---

## Self-Review Notes

- Permission matrix coverage: every row maps to at least one TDD test in Phases 2–5 (gate helpers in 9–11; service-level in 16–22; integration in 14; client gates in 25–27).
- The single-role `["OWNER"]` and `["OWNER", "ADMIN"]` shortcuts in Task 9 require the role-aware error-code routing in `requireVerifiedAgencyMember` — this is called out explicitly in Task 9 Step 3.
- The `currentOwnerMembership.id` field requires `AgencyAccess.membership` to carry `id`; this is added in Task 20 Step 2 (an explicit schema bump on the in-memory type).
- The Future Work section of the spec (Personal accounts, billing, multi-organizer, invitation flow detail, agency dashboard contents) is deliberately not in this plan — each is its own spec/plan.
