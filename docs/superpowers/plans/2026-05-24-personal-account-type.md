# Personal Account Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal account type to Voyage — users sign up to plan their own trips outside any agency, using the full agent capability, with their itineraries / threads / shares owned directly (no `agencyId`).

**Architecture:** A new `User.accountType` enum (`PENDING | PERSONAL | AGENCY_USER`) sits at the heart. Three existing columns (`Itinerary.agencyId`, `AgentThread.agencyId`, `ItineraryShare.agencyId`) become nullable. The signup wizard gets a Step 1.5 fork. The server adds a `/me/...` route family gated by `requirePersonalAccount`. The client's existing HomePage shell branches on account type instead of building a parallel layout.

**Tech Stack:** Node, TypeScript, Express, Prisma, PostgreSQL, Zod, Vitest, Supertest (server). Next.js 15 App Router, React, Tailwind (client).

**Spec reference:** [docs/superpowers/specs/2026-05-24-personal-account-type-design.md](../specs/2026-05-24-personal-account-type-design.md).

**Branch:** All commits land on `feat/agency-roles-permissions` (continuing from Spec A — no new branch). Both server and client share that branch name across their repos.

---

## Parallel Sub-Agent Dispatch & Model Selection

Same model-selection discipline as Spec A's plan. Match `model` parameter to task difficulty.

| Task class | Model | Why |
|---|---|---|
| Schema/migration writing, type unions, string flips, mounting routes (Phase 1, Phase 9) | `haiku` (`claude-haiku-4-5`) | Mechanical work with clear acceptance criteria. |
| TDD service helpers, gate middleware, new route handlers, well-bounded React components (Phases 2–8) | `sonnet` (`claude-sonnet-4-6`) | Moderate complexity bounded tightly by the spec. |
| Cross-cutting design / debugging / spec gaps | `opus` (4.6 / 4.7) | Only if the spec leaves something genuinely undecided. Not expected for this plan. |

**Parallel dispatch points:**

- **Phase 1 (schema):** all four tasks are sequential — Task 2 (migration) depends on Task 1 (schema), Task 3 (apply) depends on Task 2, Task 4 (types) depends on the Prisma client regen from Task 3. Single Haiku agent runs them in order.
- **Phase 2 (gates):** Tasks 5–9 share `authService.ts`, `authMiddleware.ts`, and `agencyService.ts`. Sequential within one Sonnet agent.
- **Phase 3 (/me routes):** Tasks 10–14 build up `personalService.ts` and `personalRoutes.ts` incrementally. Sequential.
- **Phase 4 (orchestrator):** one task, one Sonnet agent.
- **Phase 5 (public share):** one task, one Sonnet agent — independent of Phase 4, could run in parallel if dispatched as separate agents.
- **Phase 6 (wizard) + Phase 7 (HomePage) + Phase 8 (share view):** all client-side. Phase 6 must complete first (wizard structural change), then Phase 7 and Phase 8 can run in parallel as separate Sonnet agents — they touch disjoint files.
- **Phase 9:** one Haiku agent for the regression run.

**Dispatch prompt template (reuse from Spec A's plan):**

```
You are implementing Task <N> from docs/superpowers/plans/2026-05-24-personal-account-type.md.
Read that task and only that task. Follow TDD strictly: failing test first, run to confirm
failure, write the minimal implementation, run to confirm pass, commit. Do not touch files
outside the Files list in the task. If a step shows code, paste it exactly. Stop after the
task's final commit and report results.
```

---

## File Structure

### Server (`Voyage-Server/`)

- Modify: `prisma/schema.prisma` — add `UserAccountType` enum + `User.accountType` column; make `agencyId` nullable on `Itinerary`, `AgentThread`, `ItineraryShare`.
- Create: `prisma/migrations/20260526000000_personal_account_type/migration.sql` — schema + backfill.
- Modify: `src/modules/auth/authTypes.ts` — extend user types with `accountType`.
- Modify: `src/modules/auth/authService.ts` — `setAccountType` method.
- Modify: `src/modules/auth/authSchemas.ts` — `setAccountTypeSchema`.
- Modify: `src/modules/auth/authRoutes.ts` — `POST /auth/me/account-type`.
- Modify: `src/modules/agencies/agencyTypes.ts` — extend `AgencyUser` with `accountType`.
- Modify: `src/modules/agencies/agencyService.ts` — side effect to flip `PENDING → AGENCY_USER` on first agency creation; block `PERSONAL`.
- Modify: `src/http/authMiddleware.ts` — `attachAuthUser` returns `accountType`; new `requirePersonalAccount` helper; early-return in `requireVerifiedAgencyMember` for PERSONAL.
- Create: `src/modules/personal/personalRepository.ts` — Prisma queries for personal-scope itineraries, threads, shares.
- Create: `src/modules/personal/personalService.ts` — personal CRUD + share creation.
- Create: `src/modules/personal/personalRoutes.ts` — `/me/itineraries`, `/me/agent/threads`, `/me/shares`.
- Modify: `src/app.ts` — mount `personalRoutes` under `/me`.
- Modify: `src/modules/agent/agentOrchestrator.ts` — accept `agencyId: null`.
- Modify: `src/modules/shares/publicShareRoutes.ts` — return display-name branding when `agencyId IS NULL`.
- Modify: `src/modules/shares/publicShareService.ts` (or whatever file holds the read logic) — include creator's `displayName` in the response.

### Server tests (`Voyage-Server/tests/`)

- Create: `tests/setAccountType.test.ts` — commit / already-set / invalid value.
- Create: `tests/personalService.test.ts` — list/create/get/update/delete itineraries, threads, shares. Personal-only ownership.
- Modify: `tests/agencyService.test.ts` — `createAgencyApplication` flips PENDING → AGENCY_USER; rejects PERSONAL with `ACCOUNT_TYPE_FORBIDS_AGENCY`.
- Modify: `tests/agencyAccessService.test.ts` — `requireVerifiedAgencyMember` rejects PERSONAL with the specific error code.
- Create: `tests/publicShareBranding.test.ts` — null `agencyId` → display-name branding; set `agencyId` → agency branding.

### Client (`Voyage-Client/`)

- Modify: `app/components/auth/RegisterWizard.jsx` — three-state wizard, Step 1.5 picker.
- Modify: `app/components/auth/WizardProgress.jsx` — 3 pips.
- Modify: `app/login/page.jsx` — handle `?step=type-picker`, render Step 1.5 if user is PENDING.
- Modify: `app/hooks/useAuth.js` — add `setAccountType` action.
- Modify: `app/lib/api/auth.js` (or wherever auth REST helpers live) — `setAccountType` call.
- Create: `app/lib/api/personal.js` — REST helpers for `/me/*`.
- Modify: `app/lib/api/index.js` — re-export personal helpers.
- Modify: `app/components/trip-dashboard/HomePage.jsx` — branch Itineraries / Agent data source on `accountType`; pass `accountType` to children.
- Modify: `app/components/trip-dashboard/layout/DashboardSidebar.jsx` — hide Team for PERSONAL (already gated by membership, but make explicit by accountType too); rename Settings label to "My account" for PERSONAL.
- Modify: `app/components/trip-dashboard/pages/SettingsPage.jsx` — for PERSONAL, hide agency profile section and Danger Zone; show only display name / email / password.
- Modify: `app/components/share/...` (the public share view component — search for `/shared/[token]` usage) — render "Shared by {displayName}" when `agencyId` is null.

---

# Phase 1 — Schema, migration, types (mechanical, `haiku`)

## Task 1: Prisma schema diff

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma`

- [ ] **Step 1: Add the enum**

Near the other enums in `prisma/schema.prisma`, add:

```prisma
enum UserAccountType {
  PENDING
  PERSONAL
  AGENCY_USER
}
```

- [ ] **Step 2: Add the column to User**

Inside the `model User` block, add this line near the other scalar fields (after `status`):

```prisma
  accountType         UserAccountType          @default(PENDING)
```

- [ ] **Step 3: Make `agencyId` nullable on three tables**

In `model Itinerary`, change:

```prisma
  agencyId        String?          @db.Uuid
  agency          Agency?          @relation(fields: [agencyId], references: [id], onDelete: Cascade)
```

In `model AgentThread`:

```prisma
  agencyId        String?           @db.Uuid
  agency          Agency?           @relation(fields: [agencyId], references: [id], onDelete: Cascade)
```

In `model ItineraryShare`:

```prisma
  agencyId     String?            @db.Uuid
  agency       Agency?            @relation(fields: [agencyId], references: [id], onDelete: Cascade)
```

Adjust any compound foreign-key references that included `agencyId` non-null — Prisma will complain at validate time if a `@@unique` or relation includes a now-nullable field. Search the schema for any `, agencyId]` after this change.

- [ ] **Step 4: Validate the schema**

Run from `Voyage-Server/`:

```powershell
npx prisma validate
```

Expected: `The schema at prisma\schema.prisma is valid 🚀`. If validation fails on compound relations (e.g., `Itinerary.trip @relation(fields: [tripId, agencyId], ...)`), report the exact error — the spec assumes these still resolve because the compound is non-null when an `agencyId` is set. If validate is unhappy, the fix is to relax the relation to use `tripId` alone or split into two relations. Do not invent a fix; ask.

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma
git commit -m "feat(schema): add UserAccountType and nullable agencyId on three tables"
```

## Task 2: Migration SQL with backfill

**Files:**
- Create: `Voyage-Server/prisma/migrations/20260526000000_personal_account_type/migration.sql`

- [ ] **Step 1: Write the migration**

Create the migration directory and file:

```sql
-- 1. Enum
CREATE TYPE "UserAccountType" AS ENUM ('PENDING', 'PERSONAL', 'AGENCY_USER');

-- 2. Column with default so the column is NOT NULL from insert
ALTER TABLE "User" ADD COLUMN "accountType" "UserAccountType" NOT NULL DEFAULT 'PENDING';

-- 3. Backfill: users with any membership become AGENCY_USER; everyone else becomes PERSONAL.
UPDATE "User"
SET "accountType" = 'AGENCY_USER'
WHERE id IN (SELECT DISTINCT "userId" FROM "AgencyMembership");

UPDATE "User"
SET "accountType" = 'PERSONAL'
WHERE "accountType" = 'PENDING';

-- 4. Make agencyId nullable on three tables
ALTER TABLE "Itinerary" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "AgentThread" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "ItineraryShare" ALTER COLUMN "agencyId" DROP NOT NULL;
```

- [ ] **Step 2: Commit**

```powershell
git add prisma/migrations/20260526000000_personal_account_type
git commit -m "feat(migration): personal_account_type schema and backfill"
```

## Task 3: Apply migration locally and regenerate the Prisma client

**Files:**
- (None — runs prisma commands)

- [ ] **Step 1: Apply the migration**

Run from `Voyage-Server/`:

```powershell
npx prisma migrate deploy
```

Expected: `1 migration found in prisma/migrations` + `Applying migration 20260526000000_personal_account_type` + `All migrations have been successfully applied`. If `DATABASE_URL` isn't available locally, skip this step and document the deferred apply in the commit message; the engineer can apply manually later.

- [ ] **Step 2: Regenerate the Prisma client**

```powershell
npx prisma generate
```

Expected: Prisma client emits `UserAccountType` and the `accountType` field on `User`. `Itinerary`, `AgentThread`, `ItineraryShare` types now have `agencyId: string | null`.

- [ ] **Step 3: No commit required for this task** (the regenerated client is in `node_modules/`, not tracked.)

## Task 4: Type-level integration

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authTypes.ts`
- Modify: `Voyage-Server/src/modules/agencies/agencyTypes.ts`
- Modify: `Voyage-Server/src/http/authMiddleware.ts`

- [ ] **Step 1: Add `accountType` to the user union in `authTypes.ts`**

Find the existing user type (currently has `role`, `status`, etc.) and add:

```ts
accountType: "PENDING" | "PERSONAL" | "AGENCY_USER";
```

- [ ] **Step 2: Add `accountType` to `AgencyUser` in `agencyTypes.ts`**

```ts
export type AgencyUser = {
  id: string;
  role: "USER" | "SUPER_ADMIN";
  status: "ACTIVE" | "DISABLED";
  emailVerifiedAt: Date | null;
  accountType: "PENDING" | "PERSONAL" | "AGENCY_USER";
};
```

- [ ] **Step 3: Verify `attachAuthUser` returns the new column**

In `src/http/authMiddleware.ts`, the existing Prisma include block on `session.user` does not set an explicit `select` — Prisma returns all scalars by default, so `accountType` is included automatically. Confirm by reading the existing code; no edit needed unless an explicit `select` filter is present. If you need to add a select, include `accountType: true`.

- [ ] **Step 4: Type-check**

Run:

```powershell
npm run build
```

Expected: clean compile, all consumers (auth service, agency service, etc.) still type-check. Any "missing property `accountType`" error elsewhere means a test fixture or constructor needs to be updated — fix in place (`accountType: "AGENCY_USER"` for existing fixtures unless context implies otherwise).

- [ ] **Step 5: Commit**

```powershell
git add src/modules/auth/authTypes.ts src/modules/agencies/agencyTypes.ts src/http/authMiddleware.ts
git commit -m "feat(types): wire accountType through user and agency types"
```

---

# Phase 2 — Account type gates (TDD, `sonnet`)

## Task 5: `setAccountType` service method

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authService.ts`
- Create: `Voyage-Server/tests/setAccountType.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/setAccountType.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAuthService } from "../src/modules/auth/authService";

function fakeRepo(seed: { accountType?: "PENDING" | "PERSONAL" | "AGENCY_USER" } = {}) {
  const state = { accountType: seed.accountType ?? "PENDING" };
  return {
    state,
    async findUserById() {
      return {
        id: "u-1",
        email: "x@x",
        emailNormalized: "x@x",
        passwordHash: null,
        displayName: "X",
        role: "USER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        accountType: state.accountType
      } as any;
    },
    async updateUser(_id: string, data: any) {
      if (data.accountType) state.accountType = data.accountType;
      return { ...(await this.findUserById()), ...data } as any;
    }
  } as any;
}

describe("authService.setAccountType", () => {
  it("commits PERSONAL from PENDING", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo, /* other deps unused */ } as any);
    const result = await service.setAccountType("u-1", "PERSONAL");
    expect(result.accountType).toBe("PERSONAL");
    expect(repo.state.accountType).toBe("PERSONAL");
  });

  it("commits AGENCY_USER from PENDING", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo } as any);
    const result = await service.setAccountType("u-1", "AGENCY_USER");
    expect(result.accountType).toBe("AGENCY_USER");
  });

  it("rejects with ACCOUNT_TYPE_ALREADY_SET when already PERSONAL", async () => {
    const repo = fakeRepo({ accountType: "PERSONAL" });
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "AGENCY_USER")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_TYPE_ALREADY_SET"
    });
  });

  it("rejects with ACCOUNT_TYPE_ALREADY_SET when already AGENCY_USER", async () => {
    const repo = fakeRepo({ accountType: "AGENCY_USER" });
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "PERSONAL")).rejects.toMatchObject({
      statusCode: 409,
      code: "ACCOUNT_TYPE_ALREADY_SET"
    });
  });

  it("rejects PENDING as a target value", async () => {
    const repo = fakeRepo();
    const service = createAuthService({ repository: repo } as any);
    await expect(service.setAccountType("u-1", "PENDING" as any)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_ACCOUNT_TYPE"
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/setAccountType.test.ts
```

Expected: `service.setAccountType is not a function`.

- [ ] **Step 3: Implement the method**

In `src/modules/auth/authService.ts`, add to the object returned by `createAuthService`:

```ts
async setAccountType(userId: string, target: "PERSONAL" | "AGENCY_USER") {
  if (target !== "PERSONAL" && target !== "AGENCY_USER") {
    throw new ApiError(400, "INVALID_ACCOUNT_TYPE", "Account type must be PERSONAL or AGENCY_USER.");
  }
  const user = await options.repository.findUserById(userId);
  if (!user) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }
  if (user.accountType !== "PENDING") {
    throw new ApiError(409, "ACCOUNT_TYPE_ALREADY_SET", "Your account type has already been set.");
  }
  return options.repository.updateUser(userId, { accountType: target });
},
```

If `findUserById` doesn't exist on the repository, add it (and its Prisma implementation). Search the existing repository surface first; if `findUserByEmailNormalized` exists, mirror its shape for `findUserById`.

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/setAccountType.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/auth/authService.ts tests/setAccountType.test.ts
git commit -m "feat(auth): setAccountType service with one-time commit"
```

## Task 6: `POST /auth/me/account-type` route

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authSchemas.ts`
- Modify: `Voyage-Server/src/modules/auth/authRoutes.ts`

- [ ] **Step 1: Add Zod schema**

In `src/modules/auth/authSchemas.ts`, add:

```ts
import { z } from "zod";
// existing imports/exports preserved

export const setAccountTypeSchema = z.object({
  accountType: z.enum(["PERSONAL", "AGENCY_USER"])
});
```

- [ ] **Step 2: Add the route**

In `src/modules/auth/authRoutes.ts`, after the other `/me` route(s), add:

```ts
authRoutes.post("/me/account-type", requireAuth, async (request, response, next) => {
  try {
    const input = setAccountTypeSchema.parse(request.body);
    const user = await authService.setAccountType(request.authUser!.id, input.accountType);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});
```

Also add `setAccountTypeSchema` to the existing import line from `./authSchemas`.

- [ ] **Step 3: Smoke test with supertest** (optional but recommended — add to `tests/routes.test.ts` if your project keeps integration tests there)

Run `npm test`. Confirm no regressions.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/auth/authSchemas.ts src/modules/auth/authRoutes.ts
git commit -m "feat(auth): POST /auth/me/account-type route"
```

## Task 7: `createAgencyApplication` side effect + PERSONAL block

**Files:**
- Modify: `Voyage-Server/src/modules/agencies/agencyService.ts`
- Modify: `Voyage-Server/tests/agencyService.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/agencyService.test.ts`:

```ts
describe("createAgencyApplication account-type side effects", () => {
  it("flips PENDING user to AGENCY_USER after creating the agency", async () => {
    const { service, repository } = createServiceWithUser({ accountType: "PENDING" });
    const agency = await service.createAgencyApplication(
      { id: "u-1", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date(), accountType: "PENDING" },
      validAgencyInput()
    );
    expect(repository.findUserAccountTypeForTest("u-1")).toBe("AGENCY_USER");
    expect(agency.id).toBeDefined();
  });

  it("rejects a PERSONAL user with ACCOUNT_TYPE_FORBIDS_AGENCY", async () => {
    const { service } = createServiceWithUser({ accountType: "PERSONAL" });
    await expect(
      service.createAgencyApplication(
        { id: "u-1", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date(), accountType: "PERSONAL" },
        validAgencyInput()
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_TYPE_FORBIDS_AGENCY" });
  });

  it("allows an AGENCY_USER to create an additional agency (no accountType change)", async () => {
    const { service, repository } = createServiceWithUser({ accountType: "AGENCY_USER" });
    await service.createAgencyApplication(
      { id: "u-1", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date(), accountType: "AGENCY_USER" },
      validAgencyInput()
    );
    expect(repository.findUserAccountTypeForTest("u-1")).toBe("AGENCY_USER");
  });
});
```

You will need to add `createServiceWithUser` and `findUserAccountTypeForTest` to the existing test scaffold. The pattern:

```ts
function createServiceWithUser(opts: { accountType: "PENDING" | "PERSONAL" | "AGENCY_USER" }) {
  const accountTypeByUserId = new Map<string, string>();
  accountTypeByUserId.set("u-1", opts.accountType);
  const repository = {
    // existing in-memory repo methods preserved
    async updateUser(userId: string, data: any) {
      if (data.accountType) accountTypeByUserId.set(userId, data.accountType);
      return { id: userId, accountType: accountTypeByUserId.get(userId) } as any;
    },
    async findUserById(userId: string) {
      return { id: userId, accountType: accountTypeByUserId.get(userId) } as any;
    },
    findUserAccountTypeForTest(userId: string) {
      return accountTypeByUserId.get(userId);
    }
    // rest as existing
  };
  const service = createAgencyService({ repository });
  return { service, repository };
}
```

Adjust to match whatever scaffolding already exists in the file.

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/agencyService.test.ts -t "account-type side effects"
```

Expected: 3 failures.

- [ ] **Step 3: Implement**

In `src/modules/agencies/agencyService.ts`, modify `createAgencyApplication`:

```ts
async createAgencyApplication(user: AgencyUser, input: { /* unchanged */ }) {
  assertActive(user);

  if (user.accountType === "PERSONAL") {
    throw new ApiError(403, "ACCOUNT_TYPE_FORBIDS_AGENCY", "Personal accounts cannot create or join an agency. Create a separate account with a different email.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new ApiError(400, "AGENCY_NAME_REQUIRED", "Agency name is required.");
  }

  const agency = await options.repository.createAgency({
    name,
    slug: slugifyAgencyName(name),
    ownerUserId: user.id,
    businessPhone: normalizeDigitsOnlyBusinessPhone(input.businessPhone),
    businessEmail: input.businessEmail.trim(),
    country: input.country.trim(),
    city: input.city.trim(),
    logoImageId: input.logoImageId
  });
  await options.repository.createOwnerMembership({ agencyId: agency.id, userId: user.id });

  // Side effect: commit PENDING accounts to AGENCY_USER.
  if (user.accountType === "PENDING") {
    await options.repository.updateUser(user.id, { accountType: "AGENCY_USER" });
  }

  return agency;
},
```

Extend `AgencyRepository` interface to declare `updateUser`. The Prisma implementation:

```ts
async updateUser(userId, data) {
  return client.user.update({ where: { id: userId }, data });
},
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/agencyService.test.ts -t "account-type side effects"
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencies/agencyService.ts src/modules/agencies/agencyTypes.ts src/modules/agencies/agencyRepository.ts tests/agencyService.test.ts
git commit -m "feat(agency): block PERSONAL and flip PENDING to AGENCY_USER on agency create"
```

## Task 8: `requirePersonalAccount` middleware

**Files:**
- Modify: `Voyage-Server/src/http/authMiddleware.ts`

- [ ] **Step 1: Add the helper**

In `src/http/authMiddleware.ts`, after `requireSuperAdmin`, add:

```ts
export function requirePersonalAccount(request: Request, _response: Response, next: NextFunction) {
  if (!request.authUser) {
    return next(new ApiError(401, "AUTH_REQUIRED", "Sign in is required."));
  }
  if (request.authUser.accountType === "PENDING") {
    return next(new ApiError(403, "ACCOUNT_TYPE_PENDING", "Pick a personal or agency account to continue."));
  }
  if (request.authUser.accountType !== "PERSONAL") {
    return next(new ApiError(403, "ACCOUNT_TYPE_FORBIDS_PERSONAL", "This action is for personal accounts."));
  }
  return next();
}
```

- [ ] **Step 2: Type-check**

```powershell
npm run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/http/authMiddleware.ts
git commit -m "feat(middleware): requirePersonalAccount gate"
```

## Task 9: Early-return for PERSONAL inside `requireVerifiedAgencyMember`

**Files:**
- Modify: `Voyage-Server/src/modules/agencyAccess/agencyAccessService.ts`
- Modify: `Voyage-Server/tests/agencyAccessService.test.ts`

- [ ] **Step 1: Failing test**

Append to `tests/agencyAccessService.test.ts`:

```ts
it("rejects PERSONAL users with ACCOUNT_TYPE_FORBIDS_AGENCY before loading agency access", async () => {
  const { service, repository } = createService();
  repository.accessByAgencyId.set("agency-1", createAgencyAccess());
  await expect(
    service.requireVerifiedAgencyMember(createUser({ accountType: "PERSONAL" }), "agency-1")
  ).rejects.toMatchObject({
    code: "ACCOUNT_TYPE_FORBIDS_AGENCY",
    statusCode: 403
  });
});

it("rejects PENDING users with ACCOUNT_TYPE_PENDING before loading agency access", async () => {
  const { service, repository } = createService();
  repository.accessByAgencyId.set("agency-1", createAgencyAccess());
  await expect(
    service.requireVerifiedAgencyMember(createUser({ accountType: "PENDING" }), "agency-1")
  ).rejects.toMatchObject({
    code: "ACCOUNT_TYPE_PENDING",
    statusCode: 403
  });
});
```

Update `createUser` in the test file to accept `accountType` (default `"AGENCY_USER"`).

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/agencyAccessService.test.ts -t "PERSONAL\|PENDING"
```

Expected: 2 failures.

- [ ] **Step 3: Implement**

In `src/modules/agencyAccess/agencyAccessService.ts`, at the top of `requireVerifiedAgencyMember` (right after the `status` check):

```ts
async function requireVerifiedAgencyMember(/* existing params */) {
  if (user.status !== "ACTIVE") {
    throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
  }

  if (user.accountType === "PENDING") {
    throw new ApiError(403, "ACCOUNT_TYPE_PENDING", "Pick a personal or agency account to continue.");
  }
  if (user.accountType === "PERSONAL") {
    throw new ApiError(403, "ACCOUNT_TYPE_FORBIDS_AGENCY", "Personal accounts cannot access agency workspaces.");
  }

  // rest of the existing body unchanged
}
```

The `AgencyAccessUser` type already needs an `accountType` field — add it:

```ts
export type AgencyAccessUser = {
  id: string;
  status: "ACTIVE" | "DISABLED";
  accountType: "PENDING" | "PERSONAL" | "AGENCY_USER";
};
```

Any existing test fixtures that construct an `AgencyAccessUser` get `accountType: "AGENCY_USER"` by default.

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/agencyAccessService.test.ts
```

Expected: all green (existing tests still pass with the default accountType).

- [ ] **Step 5: Commit**

```powershell
git add src/modules/agencyAccess/agencyAccessService.ts tests/agencyAccessService.test.ts
git commit -m "feat(access): reject PERSONAL/PENDING from agency routes with specific codes"
```

---

# Phase 3 — Server: /me routes (TDD, `sonnet`)

## Task 10: `personalRepository` and `personalService.listItineraries` / `getItinerary`

**Files:**
- Create: `Voyage-Server/src/modules/personal/personalRepository.ts`
- Create: `Voyage-Server/src/modules/personal/personalService.ts`
- Create: `Voyage-Server/tests/personalService.test.ts`

- [ ] **Step 1: Repository interface and Prisma impl**

Create `src/modules/personal/personalRepository.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type PersonalItineraryRecord = {
  id: string;
  createdByUserId: string;
  agencyId: null;
  title: string;
  summary: string | null;
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED_INTERNAL";
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PersonalRepository = {
  listItinerariesForUser(userId: string): Promise<PersonalItineraryRecord[]>;
  findItineraryForUser(userId: string, itineraryId: string): Promise<PersonalItineraryRecord | null>;
  createItineraryForUser(input: { userId: string; title: string; summary?: string }): Promise<PersonalItineraryRecord>;
  updateItineraryForUser(input: { userId: string; itineraryId: string; data: Partial<{ title: string; summary: string | null; status: PersonalItineraryRecord["status"] }> }): Promise<PersonalItineraryRecord | null>;
  deleteItineraryForUser(userId: string, itineraryId: string): Promise<boolean>;
};

export function createPrismaPersonalRepository(client: PrismaClient = prisma): PersonalRepository {
  return {
    async listItinerariesForUser(userId) {
      return client.itinerary.findMany({
        where: { agencyId: null, createdByUserId: userId },
        orderBy: { updatedAt: "desc" }
      }) as Promise<PersonalItineraryRecord[]>;
    },
    async findItineraryForUser(userId, itineraryId) {
      return client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId }
      }) as Promise<PersonalItineraryRecord | null>;
    },
    async createItineraryForUser(input) {
      return client.itinerary.create({
        data: {
          createdByUserId: input.userId,
          agencyId: null,
          tripId: null as any,        // schema currently requires tripId; see Step 1.5 if this errors
          title: input.title,
          summary: input.summary ?? null,
          status: "DRAFT",
          version: 1
        }
      }) as Promise<PersonalItineraryRecord>;
    },
    async updateItineraryForUser({ userId, itineraryId, data }) {
      const existing = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId },
        select: { id: true }
      });
      if (!existing) return null;
      return client.itinerary.update({ where: { id: existing.id }, data }) as Promise<PersonalItineraryRecord>;
    },
    async deleteItineraryForUser(userId, itineraryId) {
      const existing = await client.itinerary.findFirst({
        where: { id: itineraryId, agencyId: null, createdByUserId: userId },
        select: { id: true }
      });
      if (!existing) return false;
      await client.itinerary.delete({ where: { id: existing.id } });
      return true;
    }
  };
}
```

- [ ] **Step 1.5: Reality check — `Itinerary.tripId` is currently NOT NULL**

The existing `Itinerary.tripId` column is required and FK'd to `ClientTrip`. Personal itineraries have no trip. Choose one of:

1. **Add `tripId` to the schema-changes migration** (Spec adjustment): make `Itinerary.tripId` nullable too, alongside `agencyId`. Update Task 1 schema and Task 2 SQL to also `ALTER COLUMN tripId DROP NOT NULL`. This is the right call — record it as a deviation report and add the SQL line: `ALTER TABLE "Itinerary" ALTER COLUMN "tripId" DROP NOT NULL;`
2. Alternative if option 1 is rejected: create a hidden "personal-self" trip per personal user the first time they make an itinerary. Heavyweight and uglier. Avoid.

Go with option 1. Update the migration (amend the previous migration commit, or add a follow-up migration). Use a follow-up commit since the prior migrations are already applied:

```sql
-- prisma/migrations/20260526000001_personal_itinerary_no_trip/migration.sql
ALTER TABLE "Itinerary" ALTER COLUMN "tripId" DROP NOT NULL;
```

And in `prisma/schema.prisma`, change `Itinerary.tripId` to optional:

```prisma
  tripId          String?          @db.Uuid
  trip            ClientTrip?      @relation(fields: [tripId, agencyId], references: [id, agencyId], onDelete: Cascade)
```

Run `npx prisma migrate deploy && npx prisma generate`. Commit:

```powershell
git add prisma/schema.prisma prisma/migrations/20260526000001_personal_itinerary_no_trip
git commit -m "feat(schema): allow Itinerary without a trip (personal itineraries)"
```

- [ ] **Step 2: Failing test**

Create `tests/personalService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPersonalService } from "../src/modules/personal/personalService";
import type { PersonalRepository, PersonalItineraryRecord } from "../src/modules/personal/personalRepository";

function fakeRepo(seed: PersonalItineraryRecord[] = []): PersonalRepository {
  const rows = [...seed];
  return {
    async listItinerariesForUser(userId) {
      return rows.filter((r) => r.createdByUserId === userId);
    },
    async findItineraryForUser(userId, itineraryId) {
      return rows.find((r) => r.id === itineraryId && r.createdByUserId === userId) ?? null;
    },
    async createItineraryForUser(input) {
      const r: PersonalItineraryRecord = {
        id: `it-${rows.length + 1}`,
        createdByUserId: input.userId,
        agencyId: null,
        title: input.title,
        summary: input.summary ?? null,
        status: "DRAFT",
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      rows.push(r);
      return r;
    },
    async updateItineraryForUser({ userId, itineraryId, data }) {
      const r = rows.find((x) => x.id === itineraryId && x.createdByUserId === userId);
      if (!r) return null;
      Object.assign(r, data);
      return r;
    },
    async deleteItineraryForUser(userId, itineraryId) {
      const i = rows.findIndex((r) => r.id === itineraryId && r.createdByUserId === userId);
      if (i === -1) return false;
      rows.splice(i, 1);
      return true;
    }
  };
}

describe("personalService itineraries", () => {
  it("lists only the user's own itineraries", async () => {
    const repo = fakeRepo([
      { id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() },
      { id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }
    ]);
    const svc = createPersonalService({ repository: repo });
    const list = await svc.listItineraries("u-1");
    expect(list.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns 404 NOT_FOUND when fetching another user's itinerary", async () => {
    const repo = fakeRepo([
      { id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }
    ]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.getItinerary("u-1", "b")).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```powershell
npx vitest run tests/personalService.test.ts
```

- [ ] **Step 4: Implement the service**

Create `src/modules/personal/personalService.ts`:

```ts
import { ApiError } from "../../http/errors";
import type { PersonalRepository } from "./personalRepository";

export function createPersonalService(options: { repository: PersonalRepository }) {
  return {
    async listItineraries(userId: string) {
      return options.repository.listItinerariesForUser(userId);
    },

    async getItinerary(userId: string, itineraryId: string) {
      const itinerary = await options.repository.findItineraryForUser(userId, itineraryId);
      if (!itinerary) {
        throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
      }
      return itinerary;
    }
  };
}
```

- [ ] **Step 5: Run, expect PASS**

```powershell
npx vitest run tests/personalService.test.ts
```

- [ ] **Step 6: Commit**

```powershell
git add src/modules/personal/personalRepository.ts src/modules/personal/personalService.ts tests/personalService.test.ts
git commit -m "feat(personal): personalService list and get itinerary"
```

## Task 11: Personal itinerary create / update / delete

**Files:**
- Modify: `Voyage-Server/src/modules/personal/personalService.ts`
- Modify: `Voyage-Server/tests/personalService.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/personalService.test.ts`:

```ts
describe("personalService create/update/delete", () => {
  it("creates an itinerary owned by the caller", async () => {
    const repo = fakeRepo();
    const svc = createPersonalService({ repository: repo });
    const created = await svc.createItinerary("u-1", { title: "Trip to Tokyo" });
    expect(created.createdByUserId).toBe("u-1");
    expect(created.title).toBe("Trip to Tokyo");
    expect(created.agencyId).toBeNull();
  });

  it("rejects empty title with PERSONAL_ITINERARY_TITLE_REQUIRED", async () => {
    const repo = fakeRepo();
    const svc = createPersonalService({ repository: repo });
    await expect(svc.createItinerary("u-1", { title: "   " })).rejects.toMatchObject({
      statusCode: 400,
      code: "PERSONAL_ITINERARY_TITLE_REQUIRED"
    });
  });

  it("updates own itinerary", async () => {
    const repo = fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Old", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    const updated = await svc.updateItinerary("u-1", "a", { title: "New" });
    expect(updated.title).toBe("New");
  });

  it("rejects updating someone else's itinerary with PERSONAL_ITINERARY_NOT_FOUND", async () => {
    const repo = fakeRepo([{ id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.updateItinerary("u-1", "b", { title: "Hacked" })).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });

  it("deletes own itinerary", async () => {
    const repo = fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    const ok = await svc.deleteItinerary("u-1", "a");
    expect(ok).toEqual({ deleted: true });
    expect(await repo.listItinerariesForUser("u-1")).toHaveLength(0);
  });

  it("rejects deleting someone else's itinerary", async () => {
    const repo = fakeRepo([{ id: "b", createdByUserId: "u-2", agencyId: null, title: "Theirs", summary: null, status: "DRAFT", version: 1, createdAt: new Date(), updatedAt: new Date() }]);
    const svc = createPersonalService({ repository: repo });
    await expect(svc.deleteItinerary("u-1", "b")).rejects.toMatchObject({
      statusCode: 404,
      code: "PERSONAL_ITINERARY_NOT_FOUND"
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npx vitest run tests/personalService.test.ts -t "create/update/delete"
```

- [ ] **Step 3: Implement**

Extend `personalService.ts`:

```ts
async createItinerary(userId: string, input: { title: string; summary?: string }) {
  const title = input.title.trim();
  if (!title) {
    throw new ApiError(400, "PERSONAL_ITINERARY_TITLE_REQUIRED", "Itinerary title is required.");
  }
  return options.repository.createItineraryForUser({
    userId,
    title,
    summary: input.summary?.trim() ?? undefined
  });
},

async updateItinerary(userId: string, itineraryId: string, data: { title?: string; summary?: string | null }) {
  const patch: { title?: string; summary?: string | null } = {};
  if (data.title !== undefined) {
    const t = data.title.trim();
    if (!t) throw new ApiError(400, "PERSONAL_ITINERARY_TITLE_REQUIRED", "Itinerary title is required.");
    patch.title = t;
  }
  if (data.summary !== undefined) {
    patch.summary = data.summary === null ? null : data.summary.trim();
  }
  const updated = await options.repository.updateItineraryForUser({ userId, itineraryId, data: patch });
  if (!updated) {
    throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
  }
  return updated;
},

async deleteItinerary(userId: string, itineraryId: string) {
  const ok = await options.repository.deleteItineraryForUser(userId, itineraryId);
  if (!ok) {
    throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
  }
  return { deleted: true as const };
}
```

- [ ] **Step 4: Run, expect PASS**

```powershell
npx vitest run tests/personalService.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/personal/personalService.ts tests/personalService.test.ts
git commit -m "feat(personal): create, update, delete personal itineraries"
```

## Task 12: Personal agent threads (list + create + message)

**Files:**
- Modify: `Voyage-Server/src/modules/personal/personalRepository.ts`
- Modify: `Voyage-Server/src/modules/personal/personalService.ts`
- Modify: `Voyage-Server/tests/personalService.test.ts`

- [ ] **Step 1: Extend repository**

Add to `PersonalRepository`:

```ts
listThreadsForUser(userId: string): Promise<Array<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; createdAt: Date; updatedAt: Date }>>;
findThreadForUser(userId: string, threadId: string): Promise<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED" } | null>;
createThreadForUser(input: { userId: string; title: string }): Promise<{ id: string; title: string; status: "ACTIVE" | "ARCHIVED"; createdAt: Date; updatedAt: Date }>;
```

Prisma impl:

```ts
async listThreadsForUser(userId) {
  return client.agentThread.findMany({
    where: { agencyId: null, createdByUserId: userId },
    orderBy: { updatedAt: "desc" }
  }) as any;
},
async findThreadForUser(userId, threadId) {
  return client.agentThread.findFirst({
    where: { id: threadId, agencyId: null, createdByUserId: userId }
  }) as any;
},
async createThreadForUser(input) {
  return client.agentThread.create({
    data: {
      agencyId: null,
      tripId: null,
      createdByUserId: input.userId,
      title: input.title,
      status: "ACTIVE"
    }
  }) as any;
}
```

- [ ] **Step 2: Failing tests**

Append to `tests/personalService.test.ts`:

```ts
describe("personalService threads", () => {
  it("lists own threads only", async () => {
    /* arrange repo with two threads, one per user; assert filter */
    const repo = {
      ...fakeRepo(),
      async listThreadsForUser(userId: string) {
        const all = [
          { id: "t1", createdByUserId: "u-1", title: "Mine", status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() },
          { id: "t2", createdByUserId: "u-2", title: "Theirs", status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() }
        ];
        return all.filter((t) => t.createdByUserId === userId);
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const list = await svc.listThreads("u-1");
    expect(list.map((t) => t.id)).toEqual(["t1"]);
  });

  it("creates a thread with default title", async () => {
    let created: any = null;
    const repo = {
      ...fakeRepo(),
      async createThreadForUser(input: any) {
        created = { id: "t-new", ...input, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        return created;
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const thread = await svc.createThread("u-1");
    expect(thread.title).toBe("New thread");
    expect(created.userId).toBe("u-1");
  });

  it("creates a thread with a custom title", async () => {
    let created: any = null;
    const repo = {
      ...fakeRepo(),
      async createThreadForUser(input: any) {
        created = { id: "t-new", ...input, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() };
        return created;
      }
    } as any;
    const svc = createPersonalService({ repository: repo });
    const thread = await svc.createThread("u-1", "Tokyo planning");
    expect(thread.title).toBe("Tokyo planning");
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```powershell
npx vitest run tests/personalService.test.ts -t "threads"
```

- [ ] **Step 4: Implement**

Add to `personalService.ts`:

```ts
async listThreads(userId: string) {
  return options.repository.listThreadsForUser(userId);
},

async createThread(userId: string, title?: string) {
  return options.repository.createThreadForUser({
    userId,
    title: title?.trim() || "New thread"
  });
}
```

- [ ] **Step 5: Run, expect PASS**

```powershell
npx vitest run tests/personalService.test.ts -t "threads"
```

- [ ] **Step 6: Commit**

```powershell
git add src/modules/personal/personalRepository.ts src/modules/personal/personalService.ts tests/personalService.test.ts
git commit -m "feat(personal): list and create personal agent threads"
```

## Task 13: Personal share creation

**Files:**
- Modify: `Voyage-Server/src/modules/personal/personalRepository.ts`
- Modify: `Voyage-Server/src/modules/personal/personalService.ts`
- Modify: `Voyage-Server/tests/personalService.test.ts`

- [ ] **Step 1: Extend repository**

Add:

```ts
createShareForUserItinerary(input: { userId: string; itineraryId: string; recipientName?: string; recipientEmail?: string }): Promise<{ id: string; token: string; itineraryId: string; createdAt: Date }>;
```

Prisma impl uses `nanoid` for the token (existing pattern in `shareRoutes`):

```ts
async createShareForUserItinerary({ userId, itineraryId, recipientName, recipientEmail }) {
  const itinerary = await client.itinerary.findFirst({
    where: { id: itineraryId, agencyId: null, createdByUserId: userId },
    select: { id: true, tripId: true }
  });
  if (!itinerary) throw new ApiError(404, "PERSONAL_ITINERARY_NOT_FOUND", "Itinerary not found.");
  const { nanoid } = await import("nanoid");
  const token = nanoid(24);
  return client.itineraryShare.create({
    data: {
      token,
      itineraryId: itinerary.id,
      tripId: itinerary.tripId ?? "personal-no-trip-placeholder" as any,
      agencyId: null,
      clientName: recipientName ?? null,
      clientEmail: recipientEmail ?? null
    },
    select: { id: true, token: true, itineraryId: true, createdAt: true }
  });
}
```

**Note about `tripId`:** `ItineraryShare.tripId` is currently required and FK'd. Personal shares have no trip. The fix: in the same migration follow-up as Task 10 Step 1.5, also `ALTER TABLE "ItineraryShare" ALTER COLUMN "tripId" DROP NOT NULL`. Update the schema:

```prisma
  tripId       String?            @db.Uuid
  trip         ClientTrip?        @relation(fields: [tripId], references: [id], onDelete: Cascade)
```

If Task 10 already covered this, no extra migration. If not, add it now and amend Task 10's migration commit (use `git commit --amend` is forbidden mid-stream — instead, create a NEW migration `20260526000002_share_no_trip` with that SQL). Commit:

```powershell
git add prisma/schema.prisma prisma/migrations/20260526000002_share_no_trip
git commit -m "feat(schema): allow ItineraryShare without a trip (personal shares)"
```

- [ ] **Step 2: Failing test**

Append:

```ts
it("creates a personal share for an own itinerary", async () => {
  const repo = {
    ...fakeRepo([{ id: "a", createdByUserId: "u-1", agencyId: null, title: "Mine", summary: null, status: "DRAFT" as const, version: 1, createdAt: new Date(), updatedAt: new Date() }]),
    async createShareForUserItinerary(input: any) {
      return { id: "s-1", token: "tok-abc", itineraryId: input.itineraryId, createdAt: new Date() };
    }
  } as any;
  const svc = createPersonalService({ repository: repo });
  const share = await svc.createShare("u-1", { itineraryId: "a" });
  expect(share.token).toBe("tok-abc");
});
```

- [ ] **Step 3: Run, expect FAIL** → implement → **PASS**

```ts
async createShare(userId: string, input: { itineraryId: string; recipientName?: string; recipientEmail?: string }) {
  return options.repository.createShareForUserItinerary({
    userId,
    itineraryId: input.itineraryId,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail
  });
}
```

- [ ] **Step 4: Commit**

```powershell
git add src/modules/personal/personalRepository.ts src/modules/personal/personalService.ts tests/personalService.test.ts
git commit -m "feat(personal): create personal itinerary share"
```

## Task 14: Wire `/me` routes

**Files:**
- Create: `Voyage-Server/src/modules/personal/personalRoutes.ts`
- Modify: `Voyage-Server/src/app.ts`

- [ ] **Step 1: Routes**

Create `src/modules/personal/personalRoutes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePersonalAccount } from "../../http/authMiddleware";
import { createPersonalService } from "./personalService";
import { createPrismaPersonalRepository } from "./personalRepository";

const service = createPersonalService({ repository: createPrismaPersonalRepository() });

const createItinerarySchema = z.object({
  title: z.string(),
  summary: z.string().optional()
});

const updateItinerarySchema = z.object({
  title: z.string().optional(),
  summary: z.string().nullable().optional()
});

const createThreadSchema = z.object({
  title: z.string().optional()
});

const createShareSchema = z.object({
  itineraryId: z.string().uuid(),
  recipientName: z.string().optional(),
  recipientEmail: z.string().email().optional()
});

export const personalRoutes = Router();
personalRoutes.use(requireAuth, requirePersonalAccount);

personalRoutes.get("/itineraries", async (req, res, next) => {
  try { res.json({ itineraries: await service.listItineraries(req.authUser!.id) }); } catch (e) { next(e); }
});

personalRoutes.post("/itineraries", async (req, res, next) => {
  try {
    const input = createItinerarySchema.parse(req.body);
    const itinerary = await service.createItinerary(req.authUser!.id, input);
    res.status(201).json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.get("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const itinerary = await service.getItinerary(req.authUser!.id, String(req.params.itineraryId));
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.patch("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const input = updateItinerarySchema.parse(req.body);
    const itinerary = await service.updateItinerary(req.authUser!.id, String(req.params.itineraryId), input);
    res.json({ itinerary });
  } catch (e) { next(e); }
});

personalRoutes.delete("/itineraries/:itineraryId", async (req, res, next) => {
  try {
    const result = await service.deleteItinerary(req.authUser!.id, String(req.params.itineraryId));
    res.json(result);
  } catch (e) { next(e); }
});

personalRoutes.get("/agent/threads", async (req, res, next) => {
  try { res.json({ threads: await service.listThreads(req.authUser!.id) }); } catch (e) { next(e); }
});

personalRoutes.post("/agent/threads", async (req, res, next) => {
  try {
    const input = createThreadSchema.parse(req.body);
    const thread = await service.createThread(req.authUser!.id, input.title);
    res.status(201).json({ thread });
  } catch (e) { next(e); }
});

personalRoutes.post("/itineraries/:itineraryId/shares", async (req, res, next) => {
  try {
    const input = createShareSchema.parse({ ...req.body, itineraryId: req.params.itineraryId });
    const share = await service.createShare(req.authUser!.id, input);
    res.status(201).json({ share });
  } catch (e) { next(e); }
});
```

- [ ] **Step 2: Mount in `app.ts`**

In `src/app.ts`, add:

```ts
import { personalRoutes } from "./modules/personal/personalRoutes";
// inside createApp(), with the other route mounts:
app.use("/me", personalRoutes);
```

- [ ] **Step 3: Smoke run**

```powershell
npm test
npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/personal/personalRoutes.ts src/app.ts
git commit -m "feat(personal): mount /me/itineraries, /me/agent/threads, /me/.../shares"
```

---

# Phase 4 — Agent orchestrator accepts null agency (`sonnet`)

## Task 15: Update orchestrator for personal threads

**Files:**
- Modify: `Voyage-Server/src/modules/agent/agentOrchestrator.ts`

- [ ] **Step 1: Locate the agency-id requirement**

Search the file for `agencyId` references. The function signature likely has `agencyId: string`. Change to `agencyId: string | null`.

Wherever `agencyId` is passed to repository methods (e.g., when creating AgentRun, AgentMessage, AgentToolCall rows), pass through `null` when it's null.

If any branch *requires* an agency (e.g., loading agency-scoped settings), guard it:

```ts
if (agencyId !== null) {
  // existing agency-scoped logic
}
```

- [ ] **Step 2: Tool list audit**

Skim the orchestrator's tool registration. Tools like `web_search`, `map_pinpoint`, `add_itinerary_item` should be agency-agnostic — they operate on whatever itinerary/thread is in context. If any tool reads agency-scoped data (e.g., agency client list), wrap with the same `if (agencyId !== null)` guard. If a tool is genuinely agency-only, omit it from personal runs — register the tools conditionally based on `agencyId === null`.

- [ ] **Step 3: Type-check**

```powershell
npm run build
```

Expected: clean. Any caller passing a non-null agencyId still compiles.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/agent/agentOrchestrator.ts
git commit -m "feat(agent): orchestrator accepts null agencyId for personal threads"
```

---

# Phase 5 — Public share branding (`sonnet`)

## Task 16: Branding switch on `/shared/:token`

**Files:**
- Modify: `Voyage-Server/src/modules/shares/publicShareRoutes.ts` (or wherever the read handler lives)
- Modify: any service that builds the share response payload
- Create: `Voyage-Server/tests/publicShareBranding.test.ts`

- [ ] **Step 1: Read current behavior**

Search the codebase for the handler of `GET /shared/:token`. It currently fetches the share + the itinerary + the agency, returning agency name/logo in the response.

- [ ] **Step 2: Failing test**

Create `tests/publicShareBranding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildShareResponse } from "../src/modules/shares/publicShareService"; // adjust path

describe("public share branding", () => {
  it("agency share returns agency branding", () => {
    const result = buildShareResponse({
      share: { id: "s", token: "t", agencyId: "a", clientName: null, clientEmail: null, createdAt: new Date(), expiresAt: null, revokedAt: null, viewCount: 0 } as any,
      agency: { id: "a", name: "Wanderlust Travel", logoImage: null } as any,
      itinerary: { id: "i", title: "Trip", summary: null, status: "APPROVED_INTERNAL", version: 1, days: [], createdAt: new Date(), updatedAt: new Date() } as any,
      creator: { id: "u-1", displayName: "Alice" } as any
    });
    expect(result.brand).toEqual({ type: "agency", name: "Wanderlust Travel", logoUrl: null });
  });

  it("personal share returns display-name branding (no avatar)", () => {
    const result = buildShareResponse({
      share: { id: "s", token: "t", agencyId: null, clientName: null, clientEmail: null, createdAt: new Date(), expiresAt: null, revokedAt: null, viewCount: 0 } as any,
      agency: null,
      itinerary: { id: "i", title: "Trip", summary: null, status: "DRAFT", version: 1, days: [], createdAt: new Date(), updatedAt: new Date() } as any,
      creator: { id: "u-1", displayName: "Alice" } as any
    });
    expect(result.brand).toEqual({ type: "personal", displayName: "Alice" });
  });
});
```

- [ ] **Step 3: Run, expect FAIL** → implement `buildShareResponse` that returns either `{ type: "agency", name, logoUrl }` or `{ type: "personal", displayName }` based on `share.agencyId`. Update the public route handler to call `buildShareResponse` and return the new `brand` field on the response.

- [ ] **Step 4: Commit**

```powershell
git add src/modules/shares/publicShareService.ts src/modules/shares/publicShareRoutes.ts tests/publicShareBranding.test.ts
git commit -m "feat(shares): brand personal shares with display name"
```

---

# Phase 6 — Client wizard fork (`sonnet`)

## Task 17: API helper `setAccountType`

**Files:**
- Modify: `Voyage-Client/app/lib/api/auth.js` (or wherever auth REST helpers live)

- [ ] **Step 1: Add the function**

```js
export function setAccountType(accountType) {
  return fetchApi("/auth/me/account-type", {
    method: "POST",
    body: JSON.stringify({ accountType })
  });
}
```

Match the existing fetch helper conventions (look at `register`, `login`, `createAgency` in the same file).

- [ ] **Step 2: Commit**

```powershell
cd ../Voyage-Client
git add app/lib/api/auth.js
git commit -m "feat(client): setAccountType API helper"
```

## Task 18: `useAuth.setAccountType` action

**Files:**
- Modify: `Voyage-Client/app/hooks/useAuth.js`

- [ ] **Step 1: Add the action**

```js
const setAccountType = async (accountType) => {
  setError(null);
  try {
    const data = await api.setAccountType(accountType);
    setUser(data.user);
    localStorage.setItem("voyage-user", JSON.stringify(data.user));
    return data.user;
  } catch (err) {
    setError({ message: err.message, code: err.code });
    throw err;
  }
};
```

Export it in the returned object.

- [ ] **Step 2: Commit**

```powershell
git add app/hooks/useAuth.js
git commit -m "feat(client): useAuth.setAccountType action"
```

## Task 19: Wizard progress with three pips

**Files:**
- Modify: `Voyage-Client/app/components/auth/WizardProgress.jsx`

- [ ] **Step 1: Render three pips**

Update the component to accept `currentStep: 1 | "type" | 2` and render three pips with the active one filled. If the current code hard-codes two pips, change to map over `["account", "type", "agency"]`.

If the user picks personal, the wizard ends at "type" — the third pip never lights up. That's fine; the personal flow is two pips, agency is three.

- [ ] **Step 2: Commit**

```powershell
git add app/components/auth/WizardProgress.jsx
git commit -m "feat(client): wizard progress shows three steps"
```

## Task 20: `RegisterWizard` Step 1.5 picker

**Files:**
- Modify: `Voyage-Client/app/components/auth/RegisterWizard.jsx`

- [ ] **Step 1: Extend step state**

Change `wizardStep` to support `1 | "type" | 2`. After `auth.register()` succeeds in Step 1, set `wizardStep = "type"` (instead of `2`).

- [ ] **Step 2: Render the picker**

Add a new render branch when `wizardStep === "type"`. Two cards:

```jsx
<section>
  <h2 className="text-[clamp(1.6rem,2.4vw,2.2rem)] mb-2">What brings you here?</h2>
  <p className="text-[1.08rem] text-text-muted mb-6">Pick a path. You can&apos;t change this later.</p>

  <div className="grid gap-3 sm:grid-cols-2">
    <button
      type="button"
      onClick={handlePickPersonal}
      className="rounded-2xl border border-border bg-surface p-6 text-left hover:bg-surface-hover"
    >
      <h3 className="text-base font-semibold text-text-primary">Plan my own trips</h3>
      <p className="mt-2 text-sm text-text-muted">Use Voyage to research and build itineraries for yourself.</p>
    </button>

    <button
      type="button"
      onClick={handlePickAgency}
      className="rounded-2xl border border-border bg-surface p-6 text-left hover:bg-surface-hover"
    >
      <h3 className="text-base font-semibold text-text-primary">Set up an agency</h3>
      <p className="mt-2 text-sm text-text-muted">Run a travel agency with a team, client trips, and branded shares.</p>
    </button>
  </div>
</section>
```

- [ ] **Step 3: Handlers**

```jsx
const handlePickPersonal = async () => {
  try {
    await auth.setAccountType("PERSONAL");
    // wizard ends — useAuth.user.accountType is now PERSONAL; parent shell will route to HomePage
    onComplete?.();
  } catch (err) {
    // surface inline
  }
};

const handlePickAgency = () => {
  setWizardStep(2);
};
```

`handlePickAgency` does not call `setAccountType` — Step 2's `createAgency` will flip PENDING → AGENCY_USER server-side.

- [ ] **Step 4: OAuth landing**

In `app/login/page.jsx`, change the OAuth-return branch (currently `searchParams.get("step") === "agency"`) to also handle `step === "type-picker"`. Update OAuth callbacks to redirect to `/login?step=type-picker` (in `src/modules/auth/authRoutes.ts` server-side — search for the existing Google/Apple redirect URLs).

- [ ] **Step 5: PENDING guard on next login**

In `app/login/page.jsx` after auth state hydrates, if `user.accountType === "PENDING"`, force `mode = "register"` and `wizardStep = "type"`.

- [ ] **Step 6: Commit**

```powershell
git add app/components/auth/RegisterWizard.jsx app/login/page.jsx
git commit -m "feat(client): Step 1.5 picker + PENDING guard"
```

## Task 21: Update server OAuth callbacks to redirect to type-picker

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authRoutes.ts`

- [ ] **Step 1: Change the redirect URL**

Find the existing redirect after OAuth callback (search `?step=agency` in the file). Change to `?step=type-picker`.

- [ ] **Step 2: Commit**

```powershell
cd ../Voyage-Server
git add src/modules/auth/authRoutes.ts
git commit -m "feat(auth): OAuth lands on type-picker step"
```

---

# Phase 7 — Client HomePage role-aware shell (`sonnet`, can run in parallel with Phase 8)

## Task 22: `DashboardSidebar` hides agency tabs for PERSONAL

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/layout/DashboardSidebar.jsx`

- [ ] **Step 1: Read accountType from user**

At the top:

```jsx
const isPersonal = user?.accountType === "PERSONAL";
```

- [ ] **Step 2: Hide Team for PERSONAL**

Wrap the existing Team button render in `{!isPersonal && hasAgencyMembership && (...)}`.

(Existing `hasAgencyMembership` already returns false for PERSONAL since they have no memberships — this is a belt-and-suspenders explicit check.)

- [ ] **Step 3: Rename Settings label**

Change the Settings button text to render `isPersonal ? "My account" : "Settings"`.

- [ ] **Step 4: Commit**

```powershell
cd ../Voyage-Client
git add app/components/trip-dashboard/layout/DashboardSidebar.jsx
git commit -m "feat(client): sidebar hides Team for personal, renames Settings"
```

## Task 23: HomePage routes itineraries/agent to /me for personal users

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`
- Create: `Voyage-Client/app/lib/api/personal.js`
- Modify: `Voyage-Client/app/lib/api/index.js`

- [ ] **Step 1: API helpers**

Create `app/lib/api/personal.js`:

```js
import { fetchApi } from "./fetchApi.js"; // match existing helper conventions

export function fetchPersonalItineraries() {
  return fetchApi("/me/itineraries");
}

export function fetchPersonalItinerary(itineraryId) {
  return fetchApi(`/me/itineraries/${itineraryId}`);
}

export function createPersonalItinerary(body) {
  return fetchApi("/me/itineraries", { method: "POST", body: JSON.stringify(body) });
}

export function updatePersonalItinerary(itineraryId, body) {
  return fetchApi(`/me/itineraries/${itineraryId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deletePersonalItinerary(itineraryId) {
  return fetchApi(`/me/itineraries/${itineraryId}`, { method: "DELETE" });
}

export function fetchPersonalThreads() {
  return fetchApi("/me/agent/threads");
}

export function createPersonalThread(title) {
  return fetchApi("/me/agent/threads", { method: "POST", body: JSON.stringify({ title }) });
}

export function createPersonalShare(itineraryId, body = {}) {
  return fetchApi(`/me/itineraries/${itineraryId}/shares`, { method: "POST", body: JSON.stringify(body) });
}
```

Re-export from `app/lib/api/index.js`:

```js
export * from "./personal.js";
```

- [ ] **Step 2: HomePage branch**

In `HomePage.jsx`, when fetching itineraries for the Itineraries tab, branch on `user.accountType`:

```jsx
const isPersonal = user?.accountType === "PERSONAL";

useEffect(() => {
  if (!user) return;
  if (isPersonal) {
    fetchPersonalItineraries().then((res) => setFetchedTrips(res.itineraries));
  } else {
    // existing agency itineraries fetch
  }
}, [user, isPersonal]);
```

The render layer of the Itineraries tab uses `fetchedTrips`. Personal itineraries don't have a `clientName`/`assignedOrganizerUserId` — pass through `null` defaults to the trip-card component or render a simpler list. Match the existing card structure as closely as possible.

For Command Center / Agent panels, similar branch — they currently load agency-scoped threads; route to `fetchPersonalThreads` when personal.

- [ ] **Step 3: Commit**

```powershell
git add app/components/trip-dashboard/HomePage.jsx app/lib/api/personal.js app/lib/api/index.js
git commit -m "feat(client): HomePage routes personal users to /me data sources"
```

## Task 24: SettingsPage slim view for PERSONAL

**Files:**
- Modify: `Voyage-Client/app/components/trip-dashboard/pages/SettingsPage.jsx`

- [ ] **Step 1: Branch on accountType**

At the top of the render, if `user.accountType === "PERSONAL"`, render only:

- User profile section (display name, email, password change link).
- Theme picker (existing).

Hide:

- Agency profile section (name, phone, country, city).
- Danger Zone (already gated by `membership?.role === "OWNER"` — PERSONAL has no membership, so this naturally hides; still, explicitly guard with `!isPersonal`).

- [ ] **Step 2: Commit**

```powershell
git add app/components/trip-dashboard/pages/SettingsPage.jsx
git commit -m "feat(client): SettingsPage shows slim view for personal users"
```

---

# Phase 8 — Client public share view branding (`sonnet`, can run in parallel with Phase 7)

## Task 25: Public share view renders display-name branding

**Files:**
- Modify: `Voyage-Client/app/itinerary/view/[token]/page.jsx` (and / or the share-view component it uses)

- [ ] **Step 1: Read `brand` from share payload**

The server now returns `brand: { type: "agency" | "personal", ... }`. In the share view component, branch on `brand.type`:

```jsx
{brand.type === "agency" ? (
  <header>
    {brand.logoUrl && <img src={brand.logoUrl} alt="" />}
    <span>{brand.name}</span>
  </header>
) : (
  <header>
    <span className="text-sm text-text-muted">Shared by</span>
    <span className="text-base font-semibold">{brand.displayName}</span>
  </header>
)}
```

- [ ] **Step 2: Commit**

```powershell
git add app/itinerary/view/[token]/
git commit -m "feat(client): share view brands personal shares with display name"
```

---

# Phase 9 — Final verification (`haiku`)

## Task 26: Full-stack regression

**Files:**
- (None)

- [ ] **Step 1: Server tests**

```powershell
cd Voyage-Server
npm test
```

Expected: 235+ pass, 17 pre-existing failures unchanged. No NEW failures from Spec B work.

- [ ] **Step 2: Server typecheck**

```powershell
npm run build
```

Expected: clean.

- [ ] **Step 3: Client build**

```powershell
cd ../Voyage-Client
npm run build
```

Expected: clean.

- [ ] **Step 4: Smoke checklist (manual)**

Sign in as each account type and verify:

- **New email signup → Step 1 fills, lands on Step 1.5 picker.**
- **Pick "Plan my own trips" → wizard ends, lands on HomePage with sidebar: Command Center / Itineraries / My account. No Team. No Admin (unless SUPER_ADMIN).**
- **Pick "Set up an agency" → Step 2 form, fills, lands on HomePage with full agency nav.**
- **Existing user with membership → backfilled to AGENCY_USER → existing behavior unchanged.**
- **Existing user without membership → backfilled to PERSONAL → sees personal HomePage.**
- **PERSONAL user attempts `POST /agencies` (via API directly) → 403 `ACCOUNT_TYPE_FORBIDS_AGENCY`.**
- **AGENCY_USER attempts `GET /me/itineraries` → 403 `ACCOUNT_TYPE_FORBIDS_PERSONAL`.**
- **Personal share `/shared/<token>` → recipient sees "Shared by {displayName}", no avatar.**
- **Agency share `/shared/<token>` → recipient sees agency name (unchanged).**

- [ ] **Step 5: Final commit if any fixes**

If smoke check turned up small fixes, commit them as separate `fix:` commits.

---

## Self-Review Notes

- Spec coverage: every section of the spec maps to at least one task. Schema → T1, T2, T10 step 1.5, T13 step 1. Signup fork → T20, T21. /me routes → T10-T14. Agent orchestrator → T15. Public share branding → T16, T25. HomePage role-aware shell → T22-T24. Error UX → covered by gate tests in T7, T8, T9.
- The `tripId` nullable change is captured in T10 step 1.5 (and T13 step 1 for shares) as a deviation from the spec — the spec didn't explicitly call out `tripId` nullability but it's necessary to make personal itineraries possible. Treat as a clarifying refinement.
- The Future Work items from the spec (magic-link invites, billing, multi-account switcher, conversion) are NOT in this plan and remain follow-ups.
