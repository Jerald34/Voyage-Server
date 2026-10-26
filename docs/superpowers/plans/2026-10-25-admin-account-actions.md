# Admin Account Actions Implementation Plan (Part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Super Admin disable/enable an account, sign it out everywhere, and delete it by anonymizing it (with an ownership hand-over for agency owners), and show an audit trail on the account panel.

**Architecture:** A new `accountActionService` (pure rules, injected repository) and `accountActionRepository` (Prisma, one transaction per action) under `Voyage-Server/src/modules/admin/`, exposed as `POST /admin/users/:userId/{disable,enable,sign-out,delete}`. Account detail gains `auditEvents` and `ownedAgencies`. The client adds an actions footer, a confirm dialog and a delete dialog to the existing Accounts tab.

**Tech Stack:** Express + Zod + Prisma 7 (Postgres) + Vitest/supertest on the server; Next.js/React + Tailwind + Vitest/Testing Library on the client.

**Spec:** `Voyage-Server/docs/superpowers/specs/2026-10-25-admin-account-actions-usage-agent-pause-design.md` (Part 1).
**Followed by:** `2026-10-25-admin-usage-accuracy.md` (Part 2), `2026-10-25-admin-agent-pause.md` (Part 3 — builds on this plan's action service).

---

## Ground rules for whoever executes this

- **Branches:** do not create or switch branches. The user manages branches in GitHub Desktop. Ask which branch to work on before Task 1 if it isn't stated.
- **Commits:** never add a `Co-Authored-By` line. Commit new files promptly (GitHub Desktop stashes untracked files).
- **Server tests:** `cd Voyage-Server && npx vitest run tests/<file>` · full suite `npm test` · types `npx tsc --noEmit`.
- **Client tests:** `cd Voyage-Client && npx vitest run --pool=threads tests/<file>` · full suite `npm test`.
- **Client test convention:** `app/components/icons/index.js` is JSX in a `.js` file and cannot be parsed by Vitest. Any test that renders a component importing icons must `vi.mock("../app/components/icons/index.js", () => ({ ... }))` with the icons it uses.
- **Database:** local Postgres runs in Docker (`voyage-server-db-1`). Migrations: `cd Voyage-Server && npx prisma migrate dev --name <name>` (this also runs `prisma generate`).
- **OneDrive gotcha:** the backend's `tsx watch` misses edits on OneDrive; restart the dev server after server changes before checking in the browser.

## File map

**Server (`Voyage-Server/`)**
- Modify `src/http/errors.ts` — `ApiError` gets an optional `details` object merged into the error body.
- Modify `prisma/schema.prisma` — `UserStatus.DELETED`, `User.deletedAt`, new `AdminAuditAction` values.
- Create `src/modules/admin/accountActionService.ts` — guards + disable/enable/sign-out/delete rules.
- Create `src/modules/admin/accountActionRepository.ts` — Prisma writes (one transaction per action) + `findOwnedAgencies` query shared with the account repository.
- Create `src/modules/admin/accountActionSchemas.ts` — strict Zod bodies.
- Modify `src/modules/admin/accountService.ts` / `accountRepository.ts` — `DELETED` status, `auditEvents`, `ownedAgencies` on detail.
- Modify `src/modules/admin/adminRoutes.ts` — four POST routes.
- Tests: `tests/apiErrorDetails.test.ts`, `tests/accountActionService.test.ts`, `tests/accountActionRepository.test.ts`, `tests/adminAccountActionRoutes.test.ts`; update `tests/adminAccountService.test.ts`, `tests/authenticatedValidation.test.ts`.

**Client (`Voyage-Client/`)**
- Modify `app/lib/api/client.js` — `error.details`.
- Modify `app/lib/api/admin.js`, `app/lib/api/index.js` — four action calls.
- Modify `app/components/admin/accountLabels.js`, `AccountPills.jsx` — Deleted status, audit labels.
- Create `app/components/admin/AccountActionDialog.jsx` — confirm for disable / enable / sign out.
- Create `app/components/admin/DeleteAccountDialog.jsx` — regular / owner-with-successors / solo-owner states.
- Modify `app/components/admin/AccountDetail.jsx` — actions footer, audit trail, callbacks.
- Modify `app/components/admin/AdminAccountsPage.jsx`, `AccountTable.jsx` — Deleted filter, status pill by exception, refresh after actions.
- Tests: `tests/admin-account-actions-api.test.js`, `tests/account-action-dialog.test.jsx`, `tests/delete-account-dialog.test.jsx`; update `tests/account-detail.test.jsx`, `tests/account-labels.test.js`, `tests/admin-accounts-page.test.jsx`.

---

### Task 0: Record the test baseline

**Files:** none

- [ ] **Step 1: Run both suites and note pre-existing failures**

```bash
cd Voyage-Server && npm test 2>&1 | tail -30
cd ../Voyage-Client && npm test 2>&1 | tail -30
```

Write the failing test file names into your task notes. Later tasks must not add to that list; failures already on it are not yours to fix.

- [ ] **Step 2: Check types compile**

```bash
cd Voyage-Server && npx tsc --noEmit
```

Expected: no errors (note any that already exist).

---

### Task 1: `ApiError` can carry extra fields

The delete and agent-pause errors need to send data (agency name, pause end time) next to `code` and `message`.

**Files:**
- Modify: `Voyage-Server/src/http/errors.ts`
- Test: `Voyage-Server/tests/apiErrorDetails.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/apiErrorDetails.test.ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ApiError, errorHandler } from "../src/http/errors";

function appThrowing(error: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe("ApiError details", () => {
  it("merges details into the error body next to code and message", async () => {
    const res = await request(
      appThrowing(new ApiError(409, "OWNER_HAS_NO_SUCCESSOR", "Bayani Tours has no other members.", { agencyId: "a1", agencyName: "Bayani Tours" }))
    ).get("/boom");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: "OWNER_HAS_NO_SUCCESSOR", message: "Bayani Tours has no other members.", agencyId: "a1", agencyName: "Bayani Tours" }
    });
  });

  it("never lets details overwrite code or message", async () => {
    const res = await request(appThrowing(new ApiError(400, "REAL", "Real message.", { code: "FAKE", message: "Fake." }))).get("/boom");
    expect(res.body.error).toEqual({ code: "REAL", message: "Real message." });
  });

  it("keeps the old shape when there are no details", async () => {
    const res = await request(appThrowing(new ApiError(404, "NOT_FOUND", "Nope."))).get("/boom");
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Nope." } });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/apiErrorDetails.test.ts`
Expected: FAIL — the first test's body lacks `agencyId`/`agencyName` (and TypeScript may flag the 4th constructor argument).

- [ ] **Step 3: Implement**

In `src/http/errors.ts` replace the class and the `ApiError` branch of `errorHandler`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** Extra fields for the client (e.g. which agency blocked a delete). Never secrets. */
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
```

```ts
  if (error instanceof ApiError) {
    return response.status(error.statusCode).json({
      error: {
        ...(error.details ?? {}),
        code: error.code,
        message: error.message
      }
    });
  }
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/apiErrorDetails.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/http/errors.ts tests/apiErrorDetails.test.ts
git commit -m "feat(errors): ApiError can carry extra fields for the client"
```

---

### Task 2: Schema — Deleted status, deletedAt, new audit actions

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma`
- Create: `Voyage-Server/prisma/migrations/<timestamp>_admin_account_actions/migration.sql` (generated)
- Modify: every TypeScript union of user statuses that `tsc` flags

- [ ] **Step 1: Edit the schema**

```prisma
enum UserStatus {
  ACTIVE
  DISABLED
  DELETED
}
```

In `model User`, after `emailVerifiedAt`:

```prisma
  /// Set when a Super Admin deletes (anonymizes) the account.
  deletedAt           DateTime?
```

```prisma
enum AdminAuditAction {
  AGENCY_APPROVED
  AGENCY_REJECTED
  AGENCY_SUSPENDED
  AGENCY_UNSUSPENDED
  USER_PROMOTED_TO_ADMIN
  USER_DISABLED
  USER_ENABLED
  USER_SESSIONS_REVOKED
  USER_DELETED
  AGENCY_OWNERSHIP_TRANSFERRED
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name admin_account_actions`
Expected: a new folder under `prisma/migrations/`, "Your database is now in sync with your schema", Prisma Client regenerated.

- [ ] **Step 3: Fix the user-status unions**

Run: `npx tsc --noEmit`

For every error saying `"DELETED"` is not assignable to `"ACTIVE" | "DISABLED"`, widen that **user** status type to `"ACTIVE" | "DISABLED" | "DELETED"`. Expected places: `src/modules/admin/accountService.ts` (`AdminAccountStatus`), `src/modules/auth/authTypes.ts`, `src/modules/images/imageService.ts`, `src/modules/agencies/agencyTypes.ts`, `src/modules/agencyAccess/agencyAccessService.ts`. Leave **membership** statuses (`AdminAccountMembershipStatus`, `teamRepository` `status`) alone — they are a different enum.

Run `npx tsc --noEmit` again. Expected: no new errors.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: same failures as the Task 0 baseline, no new ones.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src
git commit -m "feat(db): DELETED user status, deletedAt, account-action audit types"
```

---

### Task 3: Action service — guards, disable, enable, sign out

**Files:**
- Create: `Voyage-Server/src/modules/admin/accountActionService.ts`
- Test: `Voyage-Server/tests/accountActionService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/accountActionService.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  createAdminAccountActionService,
  type AccountActionRepository,
  type AccountActionTarget,
  type OwnedAgency
} from "../src/modules/admin/accountActionService";

const ADMIN = { id: "admin-1", role: "SUPER_ADMIN" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-25T08:00:00.000Z");

function target(over: Partial<AccountActionTarget> = {}): AccountActionTarget {
  return { id: USER_ID, email: "Mara@Hops.travel", role: "USER", status: "ACTIVE", ...over };
}

function makeRepo(options: { target?: AccountActionTarget | null; owned?: OwnedAgency[] } = {}) {
  return {
    findTarget: vi.fn(async () => (options.target === undefined ? target() : options.target)),
    listOwnedAgencies: vi.fn(async () => options.owned ?? []),
    setStatus: vi.fn(async () => {}),
    revokeSessions: vi.fn(async () => {}),
    anonymize: vi.fn(async () => {})
  } satisfies AccountActionRepository;
}

const service = (repo: AccountActionRepository) => createAdminAccountActionService({ repository: repo, now: () => NOW });

describe("account action guards", () => {
  it("requires a super admin before touching the repository", async () => {
    const repo = makeRepo();
    await expect(service(repo).disable({ id: "u", role: "USER" }, USER_ID)).rejects.toMatchObject({ statusCode: 403, code: "SUPER_ADMIN_REQUIRED" });
    expect(repo.findTarget).not.toHaveBeenCalled();
  });

  it("404s an unknown account", async () => {
    const repo = makeRepo({ target: null });
    await expect(service(repo).disable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 404, code: "ACCOUNT_NOT_FOUND" });
  });

  it("refuses to act on your own account", async () => {
    const repo = makeRepo({ target: target({ id: ADMIN.id, role: "SUPER_ADMIN" }) });
    await expect(service(repo).signOutEverywhere(ADMIN, ADMIN.id)).rejects.toMatchObject({ statusCode: 403, code: "CANNOT_ACT_ON_SELF" });
    expect(repo.revokeSessions).not.toHaveBeenCalled();
  });

  it("refuses to act on another super admin", async () => {
    const repo = makeRepo({ target: target({ role: "SUPER_ADMIN" }) });
    await expect(service(repo).disable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 403, code: "CANNOT_ACT_ON_SUPER_ADMIN" });
  });

  it("refuses any action on a deleted account", async () => {
    const repo = makeRepo({ target: target({ status: "DELETED" }) });
    await expect(service(repo).enable(ADMIN, USER_ID)).rejects.toMatchObject({ statusCode: 409, code: "ACCOUNT_DELETED" });
  });
});

describe("disable / enable / sign out", () => {
  it("disables an active account with the reason", async () => {
    const repo = makeRepo();
    await service(repo).disable(ADMIN, USER_ID, "Left the agency");
    expect(repo.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "DISABLED", adminUserId: ADMIN.id, reason: "Left the agency" });
  });

  it("treats disabling a disabled account as done, without a second audit row", async () => {
    const repo = makeRepo({ target: target({ status: "DISABLED" }) });
    await service(repo).disable(ADMIN, USER_ID);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("enables a disabled account", async () => {
    const repo = makeRepo({ target: target({ status: "DISABLED" }) });
    await service(repo).enable(ADMIN, USER_ID);
    expect(repo.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "ACTIVE", adminUserId: ADMIN.id, reason: null });
  });

  it("treats enabling an active account as done", async () => {
    const repo = makeRepo();
    await service(repo).enable(ADMIN, USER_ID);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("signs an account out everywhere", async () => {
    const repo = makeRepo();
    await service(repo).signOutEverywhere(ADMIN, USER_ID, "Lost phone");
    expect(repo.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: ADMIN.id, reason: "Lost phone" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/accountActionService.test.ts`
Expected: FAIL — cannot find module `accountActionService`.

- [ ] **Step 3: Implement**

```ts
// src/modules/admin/accountActionService.ts
import { ApiError } from "../../http/errors";

export type AccountActionUserStatus = "ACTIVE" | "DISABLED" | "DELETED";

/** The fields the rules need about the account being acted on. */
export interface AccountActionTarget {
  id: string;
  email: string;
  role: string;
  status: AccountActionUserStatus;
}

export interface OwnedAgencySuccessor {
  userId: string;
  displayName: string;
  role: "ADMIN" | "STAFF";
}

/** An agency the account owns, with the active members who could take it over. */
export interface OwnedAgency {
  agencyId: string;
  agencyName: string;
  successors: OwnedAgencySuccessor[];
}

export interface AnonymizeInput {
  userId: string;
  adminUserId: string;
  reason: string | null;
  /** Only the domain of the old email is kept, in the audit row. */
  emailDomain: string;
  now: Date;
  transfer: { agencyId: string; toUserId: string } | null;
}

export interface AccountActionRepository {
  findTarget(userId: string): Promise<AccountActionTarget | null>;
  listOwnedAgencies(userId: string): Promise<OwnedAgency[]>;
  /** Sets the status, writes the audit row, and (for DISABLED) deletes every session — in one transaction. */
  setStatus(input: { userId: string; status: "ACTIVE" | "DISABLED"; adminUserId: string; reason: string | null }): Promise<void>;
  revokeSessions(input: { userId: string; adminUserId: string; reason: string | null }): Promise<void>;
  anonymize(input: AnonymizeInput): Promise<void>;
}

export interface AccountActionActor {
  id: string;
  role: string;
}

export interface DeleteAccountInput {
  confirmEmail: string;
  reason?: string | null;
  newOwnerUserId?: string | null;
}

export function createAdminAccountActionService(options: { repository: AccountActionRepository; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const { repository } = options;

  async function loadTarget(actor: AccountActionActor, userId: string): Promise<AccountActionTarget> {
    if (actor.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "SUPER_ADMIN_REQUIRED", "Super admin access is required.");
    }
    const target = await repository.findTarget(userId);
    if (!target) {
      throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    }
    if (target.id === actor.id) {
      throw new ApiError(403, "CANNOT_ACT_ON_SELF", "You can't do this to your own account.");
    }
    if (target.role === "SUPER_ADMIN") {
      throw new ApiError(403, "CANNOT_ACT_ON_SUPER_ADMIN", "Super admin accounts can't be changed here.");
    }
    if (target.status === "DELETED") {
      throw new ApiError(409, "ACCOUNT_DELETED", "This account has been deleted.");
    }
    return target;
  }

  return {
    async disable(actor: AccountActionActor, userId: string, reason: string | null = null) {
      const target = await loadTarget(actor, userId);
      if (target.status === "DISABLED") return;
      await repository.setStatus({ userId, status: "DISABLED", adminUserId: actor.id, reason });
    },

    async enable(actor: AccountActionActor, userId: string, reason: string | null = null) {
      const target = await loadTarget(actor, userId);
      if (target.status === "ACTIVE") return;
      await repository.setStatus({ userId, status: "ACTIVE", adminUserId: actor.id, reason });
    },

    async signOutEverywhere(actor: AccountActionActor, userId: string, reason: string | null = null) {
      await loadTarget(actor, userId);
      await repository.revokeSessions({ userId, adminUserId: actor.id, reason });
    },

    async deleteAccount(actor: AccountActionActor, userId: string, input: DeleteAccountInput) {
      // Filled in by Task 4.
      await loadTarget(actor, userId);
      void input;
      throw new ApiError(501, "NOT_IMPLEMENTED", "Delete is not implemented yet.");
    }
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/accountActionService.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/accountActionService.ts tests/accountActionService.test.ts
git commit -m "feat(admin): account action guards, disable, enable, sign out"
```

---

### Task 4: Action service — delete (anonymize) rules

**Files:**
- Modify: `Voyage-Server/src/modules/admin/accountActionService.ts`
- Test: `Voyage-Server/tests/accountActionService.test.ts`

- [ ] **Step 1: Add the failing tests** (append to the test file)

```ts
const agency = (over: Partial<OwnedAgency> = {}): OwnedAgency => ({
  agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agencyName: "Bayani Tours",
  successors: [{ userId: "22222222-2222-4222-8222-222222222222", displayName: "Liza Cruz", role: "ADMIN" }],
  ...over
});

describe("deleteAccount", () => {
  it("rejects a confirmation email that doesn't match", async () => {
    const repo = makeRepo();
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "someone@else.com" })).rejects.toMatchObject({
      statusCode: 400,
      code: "EMAIL_CONFIRMATION_MISMATCH"
    });
    expect(repo.anonymize).not.toHaveBeenCalled();
  });

  it("anonymizes a regular account, matching the email case-insensitively", async () => {
    const repo = makeRepo();
    await service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "  mara@hops.TRAVEL ", reason: "Requested by the user" });
    expect(repo.anonymize).toHaveBeenCalledWith({
      userId: USER_ID,
      adminUserId: ADMIN.id,
      reason: "Requested by the user",
      emailDomain: "hops.travel",
      now: NOW,
      transfer: null
    });
  });

  it("blocks a solo owner and says which agency", async () => {
    const repo = makeRepo({ owned: [agency({ successors: [] })] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 409,
      code: "OWNER_HAS_NO_SUCCESSOR",
      details: { agencyId: agency().agencyId, agencyName: "Bayani Tours" }
    });
  });

  it("blocks an owner of more than one agency", async () => {
    const repo = makeRepo({ owned: [agency(), agency({ agencyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", agencyName: "Second" })] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 409,
      code: "MULTIPLE_OWNED_AGENCIES"
    });
  });

  it("requires a new owner when the account owns an agency with members", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await expect(service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel" })).rejects.toMatchObject({
      statusCode: 400,
      code: "NEW_OWNER_REQUIRED"
    });
  });

  it("rejects a new owner who isn't an active member of that agency", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await expect(
      service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel", newOwnerUserId: "33333333-3333-4333-8333-333333333333" })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_NEW_OWNER" });
  });

  it("hands the agency over, then anonymizes", async () => {
    const repo = makeRepo({ owned: [agency()] });
    await service(repo).deleteAccount(ADMIN, USER_ID, {
      confirmEmail: "mara@hops.travel",
      newOwnerUserId: "22222222-2222-4222-8222-222222222222"
    });
    expect(repo.anonymize).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer: { agencyId: agency().agencyId, toUserId: "22222222-2222-4222-8222-222222222222" }
      })
    );
  });

  it("ignores a new owner sent for an account that owns nothing", async () => {
    const repo = makeRepo();
    await service(repo).deleteAccount(ADMIN, USER_ID, { confirmEmail: "mara@hops.travel", newOwnerUserId: "22222222-2222-4222-8222-222222222222" });
    expect(repo.anonymize).toHaveBeenCalledWith(expect.objectContaining({ transfer: null }));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/accountActionService.test.ts`
Expected: the 8 new tests FAIL with `NOT_IMPLEMENTED`.

- [ ] **Step 3: Implement** — replace the `deleteAccount` placeholder body

```ts
    async deleteAccount(actor: AccountActionActor, userId: string, input: DeleteAccountInput) {
      const target = await loadTarget(actor, userId);
      if (input.confirmEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
        throw new ApiError(400, "EMAIL_CONFIRMATION_MISMATCH", "The confirmation email does not match this account.");
      }

      // Order matters: a solo owner is the case the dialog explains, so it wins over the others.
      const owned = await repository.listOwnedAgencies(userId);
      const solo = owned.find((agency) => agency.successors.length === 0);
      if (solo) {
        throw new ApiError(409, "OWNER_HAS_NO_SUCCESSOR", `${solo.agencyName} has no other members.`, {
          agencyId: solo.agencyId,
          agencyName: solo.agencyName
        });
      }
      if (owned.length > 1) {
        throw new ApiError(409, "MULTIPLE_OWNED_AGENCIES", "This account owns more than one agency.");
      }

      let transfer: AnonymizeInput["transfer"] = null;
      if (owned.length === 1) {
        const agency = owned[0]!;
        if (!input.newOwnerUserId) {
          throw new ApiError(400, "NEW_OWNER_REQUIRED", `Choose a new owner for ${agency.agencyName} first.`, {
            agencyId: agency.agencyId,
            agencyName: agency.agencyName
          });
        }
        if (!agency.successors.some((successor) => successor.userId === input.newOwnerUserId)) {
          throw new ApiError(400, "INVALID_NEW_OWNER", "The new owner must be an active member of the agency.");
        }
        transfer = { agencyId: agency.agencyId, toUserId: input.newOwnerUserId };
      }

      await repository.anonymize({
        userId,
        adminUserId: actor.id,
        reason: input.reason ?? null,
        emailDomain: target.email.split("@")[1]?.trim().toLowerCase() ?? "",
        now: now(),
        transfer
      });
    }
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/accountActionService.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/accountActionService.ts tests/accountActionService.test.ts
git commit -m "feat(admin): delete-account rules (confirm email, owner hand-over, solo owner)"
```

---

### Task 5: Action repository (Prisma)

**Files:**
- Create: `Voyage-Server/src/modules/admin/accountActionRepository.ts`
- Test: `Voyage-Server/tests/accountActionRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/accountActionRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaAccountActionRepository } from "../src/modules/admin/accountActionRepository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-25T08:00:00.000Z");

function makeClient() {
  const tx = {
    user: { update: vi.fn(async () => ({})) },
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    authProviderAccount: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    emailVerificationToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    passwordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    agencyMembership: { deleteMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
    agency: { update: vi.fn(async () => ({})) },
    agencyInvitation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    adminAuditEvent: { create: vi.fn(async () => ({})) }
  };
  const client = {
    ...tx,
    user: { ...tx.user, findUnique: vi.fn() },
    agencyMembership: { ...tx.agencyMembership, findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])))
  };
  return { client, tx };
}

let ctx: ReturnType<typeof makeClient>;
beforeEach(() => {
  ctx = makeClient();
});

const repo = () => createPrismaAccountActionRepository(ctx.client as never);

describe("accountActionRepository", () => {
  it("disabling sets the status, deletes sessions and writes USER_DISABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: "spam" });
    expect(ctx.client.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { status: "DISABLED" } });
    expect(ctx.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DISABLED", targetType: "User", targetId: USER_ID, reason: "spam" }
    });
  });

  it("enabling keeps sessions and writes USER_ENABLED", async () => {
    await repo().setStatus({ userId: USER_ID, status: "ACTIVE", adminUserId: "admin-1", reason: null });
    expect(ctx.client.session.deleteMany).not.toHaveBeenCalled();
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_ENABLED" }) }));
  });

  it("sign-out deletes sessions and writes USER_SESSIONS_REVOKED", async () => {
    await repo().revokeSessions({ userId: USER_ID, adminUserId: "admin-1", reason: null });
    expect(ctx.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "USER_SESSIONS_REVOKED" }) }));
  });

  it("anonymize scrubs identity, removes access, revokes their invites, and keeps their work", async () => {
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: "Requested", emailDomain: "hops.travel", now: NOW, transfer: null });

    const deletedEmail = `deleted+${USER_ID}@deleted.invalid`;
    expect(ctx.tx.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        email: deletedEmail,
        emailNormalized: deletedEmail,
        displayName: "Deleted user",
        passwordHash: null,
        emailVerifiedAt: null,
        avatarImageId: null,
        status: "DELETED",
        deletedAt: NOW
      }
    });
    for (const table of ["session", "authProviderAccount", "emailVerificationToken", "passwordResetToken", "agencyMembership"] as const) {
      expect(ctx.tx[table].deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    }
    expect(ctx.tx.agencyInvitation.updateMany).toHaveBeenCalledWith({
      where: { invitedByUserId: USER_ID, acceptedAt: null, revokedAt: null },
      data: { revokedAt: NOW, revokedByUserId: "admin-1" }
    });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "USER_DELETED", targetType: "User", targetId: USER_ID, reason: "Requested", metadata: { emailDomain: "hops.travel" } }
    });
    expect(ctx.tx.agency.update).not.toHaveBeenCalled();
  });

  it("anonymize with a transfer makes the successor owner first and audits it", async () => {
    const transfer = { agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", toUserId: "22222222-2222-4222-8222-222222222222" };
    await repo().anonymize({ userId: USER_ID, adminUserId: "admin-1", reason: null, emailDomain: "x.com", now: NOW, transfer });

    expect(ctx.tx.agencyMembership.update).toHaveBeenCalledWith({
      where: { agencyId_userId: { agencyId: transfer.agencyId, userId: transfer.toUserId } },
      data: { role: "OWNER" }
    });
    expect(ctx.tx.agency.update).toHaveBeenCalledWith({ where: { id: transfer.agencyId }, data: { ownerUserId: transfer.toUserId } });
    expect(ctx.tx.adminAuditEvent.create).toHaveBeenCalledWith({
      data: {
        adminUserId: "admin-1",
        action: "AGENCY_OWNERSHIP_TRANSFERRED",
        targetType: "Agency",
        targetId: transfer.agencyId,
        reason: null,
        metadata: { fromUserId: USER_ID, toUserId: transfer.toUserId }
      }
    });
  });

  it("lists owned agencies with their other active members as successors", async () => {
    ctx.client.agencyMembership.findMany.mockResolvedValue([
      {
        agency: {
          id: "a1",
          name: "Bayani Tours",
          memberships: [{ role: "ADMIN", user: { id: "u2", displayName: "Liza Cruz" } }]
        }
      }
    ] as never);

    const owned = await repo().listOwnedAgencies(USER_ID);

    expect(ctx.client.agencyMembership.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, role: "OWNER", status: "ACTIVE" },
      select: {
        agency: {
          select: {
            id: true,
            name: true,
            memberships: {
              where: { status: "ACTIVE", userId: { not: USER_ID } },
              orderBy: { createdAt: "asc" },
              select: { role: true, user: { select: { id: true, displayName: true } } }
            }
          }
        }
      }
    });
    expect(owned).toEqual([{ agencyId: "a1", agencyName: "Bayani Tours", successors: [{ userId: "u2", displayName: "Liza Cruz", role: "ADMIN" }] }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/accountActionRepository.test.ts`
Expected: FAIL — cannot find module `accountActionRepository`.

- [ ] **Step 3: Implement**

```ts
// src/modules/admin/accountActionRepository.ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { AccountActionRepository, OwnedAgency } from "./accountActionService";

type OwnedAgenciesClient = Pick<PrismaClient, "agencyMembership">;

/** Agencies the user owns, each with its other active members (the people who could take it over). */
export async function findOwnedAgencies(client: OwnedAgenciesClient, userId: string): Promise<OwnedAgency[]> {
  const rows = await client.agencyMembership.findMany({
    where: { userId, role: "OWNER", status: "ACTIVE" },
    select: {
      agency: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: { status: "ACTIVE", userId: { not: userId } },
            orderBy: { createdAt: "asc" },
            select: { role: true, user: { select: { id: true, displayName: true } } }
          }
        }
      }
    }
  });
  return rows.map((row) => ({
    agencyId: row.agency.id,
    agencyName: row.agency.name,
    successors: row.agency.memberships.map((member) => ({
      userId: member.user.id,
      displayName: member.user.displayName,
      role: member.role as "ADMIN" | "STAFF"
    }))
  }));
}

export function createPrismaAccountActionRepository(client: PrismaClient = prisma): AccountActionRepository {
  return {
    async findTarget(userId) {
      return client.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true }
      });
    },

    listOwnedAgencies(userId) {
      return findOwnedAgencies(client, userId);
    },

    async setStatus({ userId, status, adminUserId, reason }) {
      await client.$transaction([
        client.user.update({ where: { id: userId }, data: { status } }),
        // A disabled user is already rejected on every request; deleting the sessions also clears their devices.
        ...(status === "DISABLED" ? [client.session.deleteMany({ where: { userId } })] : []),
        client.adminAuditEvent.create({
          data: { adminUserId, action: status === "DISABLED" ? "USER_DISABLED" : "USER_ENABLED", targetType: "User", targetId: userId, reason }
        })
      ]);
    },

    async revokeSessions({ userId, adminUserId, reason }) {
      await client.$transaction([
        client.session.deleteMany({ where: { userId } }),
        client.adminAuditEvent.create({
          data: { adminUserId, action: "USER_SESSIONS_REVOKED", targetType: "User", targetId: userId, reason }
        })
      ]);
    },

    async anonymize({ userId, adminUserId, reason, emailDomain, now, transfer }) {
      // Unique and unreachable, so the address can never sign in or collide with a real one.
      const deletedEmail = `deleted+${userId}@deleted.invalid`;
      await client.$transaction(async (tx) => {
        if (transfer) {
          await tx.agencyMembership.update({
            where: { agencyId_userId: { agencyId: transfer.agencyId, userId: transfer.toUserId } },
            data: { role: "OWNER" }
          });
          await tx.agency.update({ where: { id: transfer.agencyId }, data: { ownerUserId: transfer.toUserId } });
          await tx.adminAuditEvent.create({
            data: {
              adminUserId,
              action: "AGENCY_OWNERSHIP_TRANSFERRED",
              targetType: "Agency",
              targetId: transfer.agencyId,
              reason,
              metadata: { fromUserId: userId, toUserId: transfer.toUserId }
            }
          });
        }

        await tx.agencyInvitation.updateMany({
          where: { invitedByUserId: userId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now, revokedByUserId: adminUserId }
        });
        await tx.session.deleteMany({ where: { userId } });
        await tx.authProviderAccount.deleteMany({ where: { userId } });
        await tx.emailVerificationToken.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.agencyMembership.deleteMany({ where: { userId } });
        // Trips, itineraries, chats and notes keep pointing at this row and now show "Deleted user".
        await tx.user.update({
          where: { id: userId },
          data: {
            email: deletedEmail,
            emailNormalized: deletedEmail,
            displayName: "Deleted user",
            passwordHash: null,
            emailVerifiedAt: null,
            avatarImageId: null,
            status: "DELETED",
            deletedAt: now
          }
        });
        await tx.adminAuditEvent.create({
          data: { adminUserId, action: "USER_DELETED", targetType: "User", targetId: userId, reason, metadata: { emailDomain } }
        });
      });
    }
  };
}
```

- [ ] **Step 4: Run them to see them pass, then type-check**

Run: `npx vitest run tests/accountActionRepository.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 5: Try a real anonymize against the local DB**

Create a throwaway user and delete it, to prove the transaction passes Postgres' foreign keys. Use a script in your scratch folder (not the repo):

```ts
// scratch/try-anonymize.ts  — run with: npx tsx <path>/try-anonymize.ts  (from Voyage-Server)
import { prisma } from "../path/to/Voyage-Server/src/db/prisma";
import { createPrismaAccountActionRepository } from "../path/to/Voyage-Server/src/modules/admin/accountActionRepository";

const admin = await prisma.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN" } });
const email = `anon-test-${Date.now()}@example.com`;
const user = await prisma.user.create({ data: { email, emailNormalized: email, displayName: "Anon Test" } });
await createPrismaAccountActionRepository().anonymize({
  userId: user.id, adminUserId: admin.id, reason: "plan check", emailDomain: "example.com", now: new Date(), transfer: null
});
console.log(await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, displayName: true, status: true, deletedAt: true } }));
await prisma.$disconnect();
```

Replace `../path/to/` with the absolute path to `Voyage-Server`. Expected output: `email: 'deleted+<id>@deleted.invalid'`, `displayName: 'Deleted user'`, `status: 'DELETED'`, a `deletedAt` date. The leftover row is harmless test data.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/accountActionRepository.ts tests/accountActionRepository.test.ts
git commit -m "feat(admin): Prisma writes for disable, sign-out and anonymize"
```

---

### Task 6: Account detail — audit trail and owned agencies

**Files:**
- Modify: `Voyage-Server/src/modules/admin/accountService.ts`
- Modify: `Voyage-Server/src/modules/admin/accountRepository.ts`
- Modify: `Voyage-Server/tests/adminAccountService.test.ts`, `Voyage-Server/tests/authenticatedValidation.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/adminAccountService.test.ts`)

First update `makeRepository` in that file so it satisfies the new interface:

```ts
function makeRepository(
  options: { rows?: AdminAccountRow[]; detail?: AdminAccountDetailRow | null; audit?: AdminAccountAuditRow[]; owned?: OwnedAgency[] } = {}
) {
  const repository = {
    listAccounts: vi.fn(async () => options.rows ?? []),
    findAccount: vi.fn(async () => (options.detail === undefined ? null : options.detail)),
    listAuditEvents: vi.fn(async () => options.audit ?? []),
    listOwnedAgencies: vi.fn(async () => options.owned ?? [])
  } satisfies AdminAccountRepository;
  return repository;
}
```

Add `type AdminAccountAuditRow` to the import from `accountService`, and `import type { OwnedAgency } from "../src/modules/admin/accountActionService";`. Then:

```ts
describe("getAccount audit trail and owned agencies", () => {
  it("adds the account's audit events (newest first, admin name, ISO dates) and owned agencies", async () => {
    const repository = makeRepository({
      detail: makeDetailRow(),
      audit: [
        { id: "e2", action: "USER_ENABLED", reason: null, createdAt: new Date("2026-10-19T00:00:00.000Z"), adminUser: { displayName: "Jerald" } },
        { id: "e1", action: "USER_DISABLED", reason: "left", createdAt: new Date("2026-10-18T00:00:00.000Z"), adminUser: { displayName: "Jerald" } }
      ],
      owned: [{ agencyId: AGENCY_A, agencyName: "Alpha", successors: [] }]
    });
    const service = createAdminAccountService({ repository });

    const account = await service.getAccount(admin, USER_ID);

    expect(repository.listAuditEvents).toHaveBeenCalledWith(USER_ID);
    expect(account.auditEvents).toEqual([
      { id: "e2", action: "USER_ENABLED", reason: null, createdAt: "2026-10-19T00:00:00.000Z", adminName: "Jerald" },
      { id: "e1", action: "USER_DISABLED", reason: "left", createdAt: "2026-10-18T00:00:00.000Z", adminName: "Jerald" }
    ]);
    expect(account.ownedAgencies).toEqual([{ agencyId: AGENCY_A, agencyName: "Alpha", successors: [] }]);
  });
});
```

If an existing `toAccountDetail` test compares the whole object with `toEqual`, it still passes: `toAccountDetail` itself does not change.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/adminAccountService.test.ts`
Expected: FAIL — `auditEvents` undefined (and a type error on `AdminAccountAuditRow`).

- [ ] **Step 3: Implement in `accountService.ts`**

Add the types (next to the other row types):

```ts
import type { OwnedAgency } from "./accountActionService";

export interface AdminAccountAuditRow {
  id: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  adminUser: { displayName: string };
}

export interface AdminAccountAuditEvent {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  adminName: string;
}
```

Extend the repository interface:

```ts
export interface AdminAccountRepository {
  listAccounts(): Promise<AdminAccountRow[]>;
  findAccount(id: string): Promise<AdminAccountDetailRow | null>;
  /** Admin audit events whose target is this user, newest first, at most 50. */
  listAuditEvents(userId: string): Promise<AdminAccountAuditRow[]>;
  listOwnedAgencies(userId: string): Promise<OwnedAgency[]>;
}
```

Add a response type and change `getAccount`:

```ts
export interface AdminAccountDetailResponse extends AdminAccountDetail {
  auditEvents: AdminAccountAuditEvent[];
  ownedAgencies: OwnedAgency[];
}
```

```ts
    async getAccount(user: AdminAccountServiceUser, userId: string): Promise<AdminAccountDetailResponse> {
      assertSuperAdmin(user);
      const row = await options.repository.findAccount(userId);
      if (!row) {
        throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
      }
      const [audit, ownedAgencies] = await Promise.all([
        options.repository.listAuditEvents(userId),
        options.repository.listOwnedAgencies(userId)
      ]);
      return {
        ...toAccountDetail(row),
        auditEvents: audit.map((event) => ({
          id: event.id,
          action: event.action,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
          adminName: event.adminUser.displayName
        })),
        ownedAgencies
      };
    }
```

- [ ] **Step 4: Implement in `accountRepository.ts`**

```ts
import { findOwnedAgencies } from "./accountActionRepository";
import type { AdminAccountAuditRow, AdminAccountDetailRow, AdminAccountRepository, AdminAccountRow } from "./accountService";
```

Add to the `adminAccountRepository` object:

```ts
  async listAuditEvents(userId: string): Promise<AdminAccountAuditRow[]> {
    return prisma.adminAuditEvent.findMany({
      where: { targetType: "User", targetId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, reason: true, createdAt: true, adminUser: { select: { displayName: true } } }
    });
  },

  listOwnedAgencies(userId: string) {
    return findOwnedAgencies(prisma, userId);
  }
```

- [ ] **Step 5: Update the route-level test's repository mock**

In `tests/authenticatedValidation.test.ts`, the `vi.mock("../src/modules/admin/accountRepository", ...)` factory gains the two methods:

```ts
vi.mock("../src/modules/admin/accountRepository", () => ({
  adminAccountRepository: {
    listAccounts: mockListAdminAccounts,
    findAccount: mockFindAdminAccount,
    listAuditEvents: vi.fn(async () => []),
    listOwnedAgencies: vi.fn(async () => [])
  }
}));
```

Then in the `GET /admin/users/:userId` success test inside `describe("admin accounts")`, add `auditEvents: []` and `ownedAgencies: []` to the expected `user` object.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/adminAccountService.test.ts tests/authenticatedValidation.test.ts tests/adminAccountRepository.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/accountService.ts src/modules/admin/accountRepository.ts tests/adminAccountService.test.ts tests/authenticatedValidation.test.ts
git commit -m "feat(admin): account detail shows audit trail and owned agencies"
```

---

### Task 7: Routes

**Files:**
- Create: `Voyage-Server/src/modules/admin/accountActionSchemas.ts`
- Modify: `Voyage-Server/src/modules/admin/adminRoutes.ts`
- Test: `Voyage-Server/tests/adminAccountActionRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/adminAccountActionRoutes.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  findTarget: vi.fn(),
  listOwnedAgencies: vi.fn(),
  setStatus: vi.fn(),
  revokeSessions: vi.fn(),
  anonymize: vi.fn(),
  findAccount: vi.fn()
}));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/agencyService", () => ({ agencyService: {} }));
vi.mock("../src/modules/support/supportService", () => ({ supportService: {} }));
vi.mock("../src/modules/admin/accountActionRepository", () => ({
  findOwnedAgencies: vi.fn(),
  createPrismaAccountActionRepository: () => ({
    findTarget: mocks.findTarget,
    listOwnedAgencies: mocks.listOwnedAgencies,
    setStatus: mocks.setStatus,
    revokeSessions: mocks.revokeSessions,
    anonymize: mocks.anonymize
  })
}));
vi.mock("../src/modules/admin/accountRepository", () => ({
  adminAccountRepository: {
    listAccounts: vi.fn(async () => []),
    findAccount: mocks.findAccount,
    listAuditEvents: vi.fn(async () => []),
    listOwnedAgencies: vi.fn(async () => [])
  }
}));

import { errorHandler, notFoundHandler } from "../src/http/errors";
import { adminRoutes } from "../src/modules/admin/adminRoutes";

const admin = { id: "admin-1", role: "SUPER_ADMIN", status: "ACTIVE", memberships: [] };
const staff = { id: "user-9", role: "USER", status: "ACTIVE", memberships: [] };

function createApp(authUser: Record<string, unknown> = admin) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authUser = authUser as any;
    next();
  });
  app.use("/admin", adminRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const detailRow = {
  id: USER_ID,
  email: "mara@hops.travel",
  displayName: "Mara Santos",
  role: "USER",
  status: "DISABLED",
  accountType: "AGENCY_USER",
  emailVerifiedAt: null,
  createdAt: new Date("2026-09-12T00:00:00.000Z"),
  updatedAt: new Date("2026-10-25T00:00:00.000Z"),
  passwordHash: null,
  providerAccounts: [],
  memberships: [],
  _count: { createdItineraries: 0, createdClientTrips: 0, createdAgentThreads: 0 }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTarget.mockResolvedValue({ id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE" });
  mocks.listOwnedAgencies.mockResolvedValue([]);
  mocks.findAccount.mockResolvedValue(detailRow);
});

describe("POST /admin/users/:userId/disable", () => {
  it("disables and answers with the refreshed account", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`).send({ reason: "spam" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USER_ID, status: "DISABLED", auditEvents: [], ownedAgencies: [] });
    expect(mocks.setStatus).toHaveBeenCalledWith({ userId: USER_ID, status: "DISABLED", adminUserId: "admin-1", reason: "spam" });
  });

  it("works with no body at all", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`);
    expect(res.status).toBe(200);
  });

  it("is super-admin only", async () => {
    const res = await request(createApp(staff)).post(`/admin/users/${USER_ID}/disable`).send({});
    expect(res.status).toBe(403);
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/disable`).send({ reason: "x", force: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-UUID id", async () => {
    const res = await request(createApp()).post("/admin/users/not-a-uuid/disable").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/users/:userId/enable and /sign-out", () => {
  it("enables", async () => {
    mocks.findTarget.mockResolvedValue({ id: USER_ID, email: "mara@hops.travel", role: "USER", status: "DISABLED" });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/enable`).send({});
    expect(res.status).toBe(200);
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" }));
  });

  it("signs out everywhere", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/sign-out`).send({});
    expect(res.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: "admin-1", reason: null });
  });
});

describe("POST /admin/users/:userId/delete", () => {
  it("anonymizes and answers 204", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel", reason: "Asked" });
    expect(res.status).toBe(204);
    expect(mocks.anonymize).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, reason: "Asked", transfer: null }));
  });

  it("needs confirmEmail", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({});
    expect(res.status).toBe(400);
    expect(mocks.anonymize).not.toHaveBeenCalled();
  });

  it("explains a solo owner with the agency in the error body", async () => {
    mocks.listOwnedAgencies.mockResolvedValue([{ agencyId: AGENCY_ID, agencyName: "Bayani Tours", successors: [] }]);
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "OWNER_HAS_NO_SUCCESSOR", agencyId: AGENCY_ID, agencyName: "Bayani Tours" });
  });

  it("rejects a malformed newOwnerUserId", async () => {
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/delete`).send({ confirmEmail: "mara@hops.travel", newOwnerUserId: "bob" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/adminAccountActionRoutes.test.ts`
Expected: FAIL — 404 `NOT_FOUND` for every POST.

- [ ] **Step 3: Add the schemas**

```ts
// src/modules/admin/accountActionSchemas.ts
import { z } from "zod";

const reason = z.string().trim().max(500).optional();

/** Disable / enable / sign out: an optional note for the audit trail, nothing else. */
export const accountActionReasonSchema = z.object({ reason }).strict();

export const deleteAccountSchema = z
  .object({
    confirmEmail: z.string().trim().min(1).max(320),
    reason,
    newOwnerUserId: z.string().uuid().optional()
  })
  .strict();
```

- [ ] **Step 4: Add the routes** in `adminRoutes.ts`

Imports and service construction at the top, beside the existing ones:

```ts
import { createAdminAccountActionService, type AccountActionActor } from "./accountActionService";
import { createPrismaAccountActionRepository } from "./accountActionRepository";
import { accountActionReasonSchema, deleteAccountSchema } from "./accountActionSchemas";

const accountActionService = createAdminAccountActionService({ repository: createPrismaAccountActionRepository() });
```

Routes, in the "Parameterized routes" section after `GET /users/:userId`:

```ts
// Each account action answers with the refreshed account so the panel can redraw without a second request.
function accountActionRoute(run: (actor: AccountActionActor, userId: string, reason: string | null) => Promise<void>) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { userId } = userIdParamsSchema.parse(request.params);
      const { reason } = accountActionReasonSchema.parse(request.body ?? {});
      await run(request.authUser!, userId, reason ?? null);
      response.json({ user: await accountService.getAccount(request.authUser!, userId) });
    } catch (error) {
      next(error);
    }
  };
}

adminRoutes.post("/users/:userId/disable", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.disable(actor, userId, reason)));
adminRoutes.post("/users/:userId/enable", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.enable(actor, userId, reason)));
adminRoutes.post("/users/:userId/sign-out", requireSuperAdmin, accountActionRoute((actor, userId, reason) => accountActionService.signOutEverywhere(actor, userId, reason)));

adminRoutes.post("/users/:userId/delete", requireSuperAdmin, async (request, response, next) => {
  try {
    const { userId } = userIdParamsSchema.parse(request.params);
    const input = deleteAccountSchema.parse(request.body ?? {});
    await accountActionService.deleteAccount(request.authUser!, userId, input);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
```

Change the express import to `import { Router, type NextFunction, type Request, type Response } from "express";`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/adminAccountActionRoutes.test.ts tests/authenticatedValidation.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/accountActionSchemas.ts src/modules/admin/adminRoutes.ts tests/adminAccountActionRoutes.test.ts
git commit -m "feat(admin): disable, enable, sign-out and delete account routes"
```

---

### Task 8: Client API calls and error details

**Files:**
- Modify: `Voyage-Client/app/lib/api/client.js`, `Voyage-Client/app/lib/api/admin.js`, `Voyage-Client/app/lib/api/index.js`
- Test: `Voyage-Client/tests/admin-account-actions-api.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/admin-account-actions-api.test.js
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchApi: vi.fn(async () => ({})),
}));

import { fetchApi, createApiError } from "../app/lib/api/client.js";
import { adminDeleteUser, adminDisableUser, adminEnableUser, adminSignOutUser } from "../app/lib/api/admin.js";

beforeEach(() => fetchApi.mockClear());

const bodyOf = (call) => JSON.parse(call[1].body);

describe("admin account action calls", () => {
  it("disable / enable / sign out POST with an optional reason", async () => {
    await adminDisableUser("u1", "spam");
    await adminEnableUser("u1");
    await adminSignOutUser("u1", "");

    expect(fetchApi.mock.calls.map((c) => [c[0], c[1].method, bodyOf(c)])).toEqual([
      ["/admin/users/u1/disable", "POST", { reason: "spam" }],
      ["/admin/users/u1/enable", "POST", {}],
      ["/admin/users/u1/sign-out", "POST", {}],
    ]);
  });

  it("delete sends the confirmation and only the fields that are set", async () => {
    await adminDeleteUser("u1", { confirmEmail: "a@b.com", reason: "", newOwnerUserId: "u2" });
    expect(fetchApi.mock.calls[0][0]).toBe("/admin/users/u1/delete");
    expect(bodyOf(fetchApi.mock.calls[0])).toEqual({ confirmEmail: "a@b.com", newOwnerUserId: "u2" });
  });
});

describe("createApiError", () => {
  it("keeps the server's extra error fields on error.details", () => {
    const response = { status: 409, headers: { get: () => null } };
    const error = createApiError(response, { error: { code: "OWNER_HAS_NO_SUCCESSOR", message: "m", agencyName: "Bayani Tours" } }, "fallback");
    expect(error.code).toBe("OWNER_HAS_NO_SUCCESSOR");
    expect(error.details).toMatchObject({ agencyName: "Bayani Tours" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/admin-account-actions-api.test.js`
Expected: FAIL — `adminDisableUser` is not a function; `error.details` undefined.

- [ ] **Step 3: Implement**

`client.js`, in `createApiError` after `error.issues = ...`:

```js
  // Extra fields some errors carry (e.g. which agency blocked a delete, when an agent pause ends).
  error.details = data.error || {};
```

`admin.js`, after `fetchAccountDetail`:

```js
function postAccountAction(userId, action, body) {
  return fetchApi(`/admin/users/${userId}/${action}`, { method: "POST", body: JSON.stringify(body) });
}

const withReason = (reason) => (reason && reason.trim() ? { reason: reason.trim() } : {});

export async function adminDisableUser(userId, reason) {
  return postAccountAction(userId, "disable", withReason(reason));
}

export async function adminEnableUser(userId, reason) {
  return postAccountAction(userId, "enable", withReason(reason));
}

export async function adminSignOutUser(userId, reason) {
  return postAccountAction(userId, "sign-out", withReason(reason));
}

export async function adminDeleteUser(userId, { confirmEmail, reason, newOwnerUserId } = {}) {
  return postAccountAction(userId, "delete", {
    confirmEmail,
    ...withReason(reason),
    ...(newOwnerUserId ? { newOwnerUserId } : {}),
  });
}
```

`index.js`, in the `// Admin` export list after `fetchAccountDetail,`:

```js
  adminDisableUser,
  adminEnableUser,
  adminSignOutUser,
  adminDeleteUser,
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/admin-account-actions-api.test.js tests/admin-accounts-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/api/client.js app/lib/api/admin.js app/lib/api/index.js tests/admin-account-actions-api.test.js
git commit -m "feat(admin): client calls for account actions; keep error details"
```

---

### Task 9: Labels and the Deleted pill

**Files:**
- Modify: `Voyage-Client/app/components/admin/accountLabels.js`, `Voyage-Client/app/components/admin/AccountPills.jsx`
- Test: `Voyage-Client/tests/account-labels.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/account-labels.test.js`; add `AUDIT_ACTION_LABELS` to its import from `accountLabels.js`)

```js
describe("AUDIT_ACTION_LABELS", () => {
  it("names every account audit action in plain words", () => {
    expect(AUDIT_ACTION_LABELS).toMatchObject({
      USER_DISABLED: "Disabled",
      USER_ENABLED: "Enabled",
      USER_SESSIONS_REVOKED: "Signed out everywhere",
      USER_DELETED: "Deleted",
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/account-labels.test.js`
Expected: FAIL — `AUDIT_ACTION_LABELS` undefined.

- [ ] **Step 3: Implement**

`accountLabels.js`, after `SIGN_IN_LABELS`:

```js
/** Audit-trail lines on the account panel. Part 3 adds the agent-pause actions. */
export const AUDIT_ACTION_LABELS = {
  USER_DISABLED: "Disabled",
  USER_ENABLED: "Enabled",
  USER_SESSIONS_REVOKED: "Signed out everywhere",
  USER_DELETED: "Deleted",
};
```

`AccountPills.jsx`, add to `STATUS_TONES`:

```js
  DELETED: { pill: "bg-surface text-text-muted", dot: "bg-text-soft", label: "Deleted" },
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --pool=threads tests/account-labels.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/accountLabels.js app/components/admin/AccountPills.jsx tests/account-labels.test.js
git commit -m "feat(admin): audit action labels and Deleted status pill"
```

---

### Task 10: Confirm dialog for disable / enable / sign out

**Files:**
- Create: `Voyage-Client/app/components/admin/AccountActionDialog.jsx`
- Test: `Voyage-Client/tests/account-action-dialog.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/account-action-dialog.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/index.js", () => ({
  adminDisableUser: vi.fn(),
  adminEnableUser: vi.fn(),
  adminSignOutUser: vi.fn(),
}));

import { adminDisableUser, adminSignOutUser } from "../app/lib/api/index.js";
import AccountActionDialog from "../app/components/admin/AccountActionDialog.jsx";

const account = { id: "u2", displayName: "Mara Santos", email: "mara@hops.travel" };

beforeEach(() => vi.clearAllMocks());

describe("AccountActionDialog", () => {
  it("disables with the typed reason and hands back the refreshed account", async () => {
    adminDisableUser.mockResolvedValue({ user: { ...account, status: "DISABLED" } });
    const onDone = vi.fn();
    render(<AccountActionDialog open action="disable" account={account} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByRole("dialog", { name: "Disable Mara Santos?" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Left the agency" } });
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ...account, status: "DISABLED" }));
    expect(adminDisableUser).toHaveBeenCalledWith("u2", "Left the agency");
  });

  it("shows the server's message when the action fails and stays open", async () => {
    adminSignOutUser.mockRejectedValue(Object.assign(new Error("Account not found."), { code: "ACCOUNT_NOT_FOUND" }));
    const onDone = vi.fn();
    render(<AccountActionDialog open action="sign-out" account={account} onClose={vi.fn()} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Account not found.");
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/account-action-dialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// app/components/admin/AccountActionDialog.jsx
"use client";

import { useEffect, useState } from "react";
import { adminDisableUser, adminEnableUser, adminSignOutUser } from "../../lib/api/index.js";
import { Button, Modal } from "../ui/index.js";
import { displayName } from "./accountLabels.js";

/** One entry per reversible account action. Part 3 adds "resume-agent" here. */
export const ACCOUNT_ACTIONS = {
  disable: {
    title: (name) => `Disable ${name}?`,
    body: "They're signed out everywhere and can't sign in until you enable the account. Their trips and itineraries stay with the agency.",
    confirm: "Disable",
    tone: "danger",
    run: (id, reason) => adminDisableUser(id, reason),
  },
  enable: {
    title: (name) => `Enable ${name}?`,
    body: "They can sign in again straight away.",
    confirm: "Enable",
    tone: "primary",
    run: (id, reason) => adminEnableUser(id, reason),
  },
  "sign-out": {
    title: (name) => `Sign ${name} out everywhere?`,
    body: "Every device they're signed in on is signed out. They can sign back in.",
    confirm: "Sign out everywhere",
    tone: "primary",
    run: (id, reason) => adminSignOutUser(id, reason),
  },
};

const FIELD =
  "w-full resize-y rounded-sm border border-border/20 bg-background p-3 font-sans text-sm text-text-primary placeholder:text-text-soft focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20";

export default function AccountActionDialog({ open, action, account, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const config = ACCOUNT_ACTIONS[action];

  // A fresh form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open, action]);

  if (!config || !account) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await config.run(account.id, reason);
      onDone?.(data?.user ?? null);
    } catch (e) {
      setError(e?.message || "That didn't work. Try again.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      title={config.title(displayName(account))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={config.tone === "danger" ? "danger" : "primary"} onClick={submit} disabled={busy}>
            {busy ? "Working…" : config.confirm}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-text-muted">{config.body}</p>
      <label htmlFor="account-action-reason" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
        Reason (optional, kept in the audit trail)
      </label>
      <textarea id="account-action-reason" rows={3} className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      {error && (
        <p role="alert" className="mt-3 rounded-sm bg-status-danger/8 p-3 text-sm text-status-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
```

`Button` (`app/components/ui/Button.jsx`) has `primary`, `secondary`, `danger` and `ghost` variants; `danger` is the outlined red one used for destructive confirms.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/account-action-dialog.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/AccountActionDialog.jsx tests/account-action-dialog.test.jsx
git commit -m "feat(admin): confirm dialog for disable, enable and sign out"
```

---

### Task 11: Delete dialog

**Files:**
- Create: `Voyage-Client/app/components/admin/DeleteAccountDialog.jsx`
- Test: `Voyage-Client/tests/delete-account-dialog.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/delete-account-dialog.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/index.js", () => ({ adminDeleteUser: vi.fn() }));

import { adminDeleteUser } from "../app/lib/api/index.js";
import DeleteAccountDialog from "../app/components/admin/DeleteAccountDialog.jsx";

const base = { id: "u2", displayName: "Mara Santos", email: "mara@hops.travel", ownedAgencies: [] };
const owner = {
  ...base,
  displayName: "Jose Rizal",
  email: "jose@bayani.ph",
  ownedAgencies: [{ agencyId: "a1", agencyName: "Bayani Tours", successors: [{ userId: "u5", displayName: "Liza Cruz", role: "ADMIN" }] }],
};
const soloOwner = { ...owner, ownedAgencies: [{ agencyId: "a1", agencyName: "Bayani Tours", successors: [] }] };

beforeEach(() => vi.clearAllMocks());

function renderDialog(account, extra = {}) {
  const props = { open: true, account, onClose: vi.fn(), onDeleted: vi.fn(), onDisableInstead: vi.fn(), ...extra };
  render(<DeleteAccountDialog {...props} />);
  return props;
}

describe("DeleteAccountDialog", () => {
  it("only enables Delete once the email is typed exactly (any case)", async () => {
    adminDeleteUser.mockResolvedValue({});
    const props = renderDialog(base);
    const button = screen.getByRole("button", { name: "Delete account" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type mara@hops.travel to confirm/i), { target: { value: "MARA@hops.travel" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(props.onDeleted).toHaveBeenCalled());
    expect(adminDeleteUser).toHaveBeenCalledWith("u2", { confirmEmail: "MARA@hops.travel", reason: "", newOwnerUserId: undefined });
  });

  it("asks an owner's dialog for a new owner and sends it", async () => {
    adminDeleteUser.mockResolvedValue({});
    renderDialog(owner);
    const button = screen.getByRole("button", { name: "Transfer and delete" });

    fireEvent.change(screen.getByLabelText(/type jose@bayani.ph to confirm/i), { target: { value: "jose@bayani.ph" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/new owner/i), { target: { value: "u5" } });
    fireEvent.click(button);

    await waitFor(() => expect(adminDeleteUser).toHaveBeenCalledWith("u2", { confirmEmail: "jose@bayani.ph", reason: "", newOwnerUserId: "u5" }));
  });

  it("explains a solo owner and offers Disable instead, with no delete form", () => {
    const props = renderDialog(soloOwner);
    expect(screen.getByText(/bayani tours has no other members/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disable instead" }));
    expect(props.onDisableInstead).toHaveBeenCalled();
  });

  it("turns a server error code into plain words", async () => {
    adminDeleteUser.mockRejectedValue(Object.assign(new Error("raw"), { code: "EMAIL_CONFIRMATION_MISMATCH" }));
    renderDialog(base);
    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: "mara@hops.travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email doesn't match this account.");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/delete-account-dialog.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// app/components/admin/DeleteAccountDialog.jsx
"use client";

import { useEffect, useId, useState } from "react";
import { adminDeleteUser } from "../../lib/api/index.js";
import { Button, Modal } from "../ui/index.js";
import { MEMBERSHIP_ROLE_LABELS, displayName } from "./accountLabels.js";

const ERROR_COPY = {
  EMAIL_CONFIRMATION_MISMATCH: "That email doesn't match this account.",
  NEW_OWNER_REQUIRED: "Choose a new owner first.",
  INVALID_NEW_OWNER: "That person can't take over. Pick an active member of the agency.",
  OWNER_HAS_NO_SUCCESSOR: "This agency has no other members, so ownership can't move.",
  MULTIPLE_OWNED_AGENCIES: "This person owns more than one agency. Hand each one over before deleting.",
  CANNOT_ACT_ON_SUPER_ADMIN: "Super admin accounts can't be deleted here.",
  ACCOUNT_DELETED: "This account is already deleted.",
};

const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted";
const FIELD =
  "w-full rounded-sm border border-border/20 bg-background p-3 font-sans text-sm text-text-primary placeholder:text-text-soft focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20";

export default function DeleteAccountDialog({ open, account, onClose, onDeleted, onDisableInstead }) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ids = { confirm: useId(), reason: useId(), owner: useId() };

  useEffect(() => {
    if (open) {
      setConfirmEmail("");
      setReason("");
      setNewOwnerUserId("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!account) return null;

  const name = displayName(account);
  const owned = account.ownedAgencies || [];
  const solo = owned.find((a) => a.successors.length === 0);
  const multiple = !solo && owned.length > 1;
  const handOver = !solo && owned.length === 1 ? owned[0] : null;
  const emailMatches = confirmEmail.trim().toLowerCase() === (account.email || "").toLowerCase();
  const canSubmit = emailMatches && (!handOver || newOwnerUserId) && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminDeleteUser(account.id, { confirmEmail, reason, newOwnerUserId: handOver ? newOwnerUserId : undefined });
      onDeleted?.();
    } catch (e) {
      setError(ERROR_COPY[e?.code] || "Couldn't delete this account. Try again.");
      setBusy(false);
    }
  };

  if (solo || multiple) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title={`${name} owns ${solo ? solo.agencyName : "more than one agency"}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={onDisableInstead}>
              Disable instead
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-muted">
          {solo
            ? `${solo.agencyName} has no other members, so ownership can't move to anyone. The owner must delete the agency in Settings first, or you can disable this account now.`
            : "Ownership has to be handed over in each agency before this account can be deleted. You can disable it now."}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="md"
      title={`Delete ${name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={!canSubmit}>
            {busy ? "Deleting…" : handOver ? "Transfer and delete" : "Delete account"}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-sm leading-relaxed text-text-muted">
        Their name, email, password and Google sign-in are erased and they're signed out everywhere. Trips, itineraries and chats they made
        stay with the agency, shown as "Deleted user". This can't be undone.
      </p>

      {handOver && (
        <div className="mb-4">
          <label htmlFor={ids.owner} className={LABEL}>
            New owner of {handOver.agencyName}
          </label>
          <select id={ids.owner} className={FIELD} value={newOwnerUserId} onChange={(e) => setNewOwnerUserId(e.target.value)}>
            <option value="">Choose a member…</option>
            {handOver.successors.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.displayName} — {MEMBERSHIP_ROLE_LABELS[s.role] || s.role}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor={ids.reason} className={LABEL}>
          Reason (kept in the audit trail)
        </label>
        <textarea id={ids.reason} rows={2} className={`${FIELD} resize-y`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>

      <div>
        <label htmlFor={ids.confirm} className={LABEL}>
          Type {account.email} to confirm
        </label>
        <input
          id={ids.confirm}
          type="text"
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-sm bg-status-danger/8 p-3 text-sm text-status-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/delete-account-dialog.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/DeleteAccountDialog.jsx tests/delete-account-dialog.test.jsx
git commit -m "feat(admin): delete-account dialog with owner hand-over and solo-owner block"
```

---

### Task 12: Account panel — actions footer and audit trail

**Files:**
- Modify: `Voyage-Client/app/components/admin/AccountDetail.jsx`
- Test: `Voyage-Client/tests/account-detail.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tests/account-detail.test.jsx`, widen the API mock and stub the two dialogs so this file only tests the panel:

```jsx
vi.mock("../app/lib/api/index.js", () => ({
  fetchAccountDetail: vi.fn(),
  adminDisableUser: vi.fn(),
  adminEnableUser: vi.fn(),
  adminSignOutUser: vi.fn(),
  adminDeleteUser: vi.fn(),
}));
vi.mock("../app/components/admin/AccountActionDialog.jsx", () => ({
  default: ({ open, action }) => (open ? <div role="dialog" aria-label={`action ${action}`} /> : null),
}));
vi.mock("../app/components/admin/DeleteAccountDialog.jsx", () => ({
  default: ({ open }) => (open ? <div role="dialog" aria-label="delete" /> : null),
}));
```

Add `auditEvents: []` and `ownedAgencies: []` to the `detail()` factory. Then append:

```jsx
describe("account actions", () => {
  it("shows Sign out everywhere, Disable and Delete for an active user", async () => {
    await renderDetail();
    expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(screen.getByRole("dialog", { name: "action disable" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByRole("dialog", { name: "delete" })).toBeInTheDocument();
  });

  it("offers Enable instead of Disable for a disabled user", async () => {
    await renderDetail(detail({ status: "DISABLED" }));
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("has no actions for a super admin or a deleted account", async () => {
    await renderDetail(detail({ role: "SUPER_ADMIN" }));
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("has no actions for a deleted account", async () => {
    await renderDetail(detail({ status: "DELETED" }));
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
  });

  it("lists the audit trail with admin, date and reason", async () => {
    await renderDetail(
      detail({ auditEvents: [{ id: "e1", action: "USER_DISABLED", reason: "left the agency", createdAt: "2026-10-18T00:00:00.000Z", adminName: "Jerald" }] })
    );
    expect(screen.getByText("Audit trail")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/by Jerald on Oct 18, 2026/)).toBeInTheDocument();
    expect(screen.getByText("left the agency")).toBeInTheDocument();
  });
});
```

Add `fireEvent` to the `@testing-library/react` import.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/account-detail.test.jsx`
Expected: the new tests FAIL (no buttons, no audit trail); the old ones still pass.

- [ ] **Step 3: Implement in `AccountDetail.jsx`**

Imports:

```jsx
import AccountActionDialog from "./AccountActionDialog.jsx";
import DeleteAccountDialog from "./DeleteAccountDialog.jsx";
import { AUDIT_ACTION_LABELS, MEMBERSHIP_ROLE_LABELS, SIGN_IN_LABELS, formatDate } from "./accountLabels.js";
```

Signature and state:

```jsx
export default function AccountDetail({ userId, onChanged, onDeleted }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // "disable" | "enable" | "sign-out" | "delete" | null
```

Before the final `return`, compute:

```jsx
  const canAct = account.role !== "SUPER_ADMIN" && account.status !== "DELETED";
  const auditEvents = account.auditEvents || [];

  const handleDone = (updated) => {
    setDialog(null);
    if (updated) setAccount(updated);
    onChanged?.();
  };
```

After the Activity `<Section>`, add the audit trail, the footer and the dialogs:

```jsx
      {auditEvents.length > 0 && (
        <Section title="Audit trail">
          <ul className="divide-y divide-border/10">
            {auditEvents.map((event) => (
              <li key={event.id} className="py-3">
                <span className="block text-sm font-semibold text-text-primary">{AUDIT_ACTION_LABELS[event.action] || event.action}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  by {event.adminName} on {formatDate(event.createdAt)}
                </span>
                {event.reason && <span className="mt-1 block text-sm text-text-muted">{event.reason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canAct && (
        <div className="sticky bottom-0 -mx-5 mt-4 flex flex-wrap gap-2 border-t border-border/10 bg-surface-elevated px-5 pb-2 pt-4">
          <button type="button" className={SECONDARY_ACTION} onClick={() => setDialog("sign-out")}>
            Sign out everywhere
          </button>
          {account.status === "DISABLED" ? (
            <button type="button" className={SECONDARY_ACTION} onClick={() => setDialog("enable")}>
              Enable
            </button>
          ) : (
            <button type="button" className={SECONDARY_ACTION} onClick={() => setDialog("disable")}>
              Disable
            </button>
          )}
          <button type="button" className={DANGER_ACTION} onClick={() => setDialog("delete")}>
            Delete account
          </button>
        </div>
      )}

      <AccountActionDialog
        open={dialog === "disable" || dialog === "enable" || dialog === "sign-out"}
        action={dialog}
        account={account}
        onClose={() => setDialog(null)}
        onDone={handleDone}
      />
      <DeleteAccountDialog
        open={dialog === "delete"}
        account={account}
        onClose={() => setDialog(null)}
        onDeleted={() => {
          setDialog(null);
          onDeleted?.();
        }}
        onDisableInstead={() => setDialog("disable")}
      />
```

And the two class constants near `LABEL`:

```jsx
const SECONDARY_ACTION =
  "rounded-sm border border-border/20 bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface/80 active:scale-[0.98]";
const DANGER_ACTION =
  "ml-auto rounded-sm border border-status-danger/30 px-4 py-2 text-sm font-semibold text-status-danger transition-colors hover:bg-status-danger/8 active:scale-[0.98]";
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/account-detail.test.jsx`
Expected: PASS (old + 5 new).

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/AccountDetail.jsx tests/account-detail.test.jsx
git commit -m "feat(admin): account panel actions footer and audit trail"
```

---

### Task 13: Accounts list — Deleted filter, status pill, refresh

**Files:**
- Modify: `Voyage-Client/app/components/admin/AdminAccountsPage.jsx`, `Voyage-Client/app/components/admin/AccountTable.jsx`
- Test: `Voyage-Client/tests/admin-accounts-page.test.jsx`

- [ ] **Step 1: Write the failing test** (append; it uses the file's existing `account()` factory and `fetchAllAccounts` mock)

```jsx
describe("deleted accounts", () => {
  it("hides deleted accounts from All and lists them under Deleted", async () => {
    fetchAllAccounts.mockResolvedValue({
      users: [
        account({ id: "u1", displayName: "Ana Reyes" }),
        account({ id: "u9", displayName: "Deleted user", email: "deleted+u9@deleted.invalid", status: "DELETED" }),
      ],
    });
    render(<AdminAccountsPage />);

    expect(await screen.findByText("Ana Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Deleted user")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /deleted 1/i }));
    expect(await screen.findByText("Deleted user")).toBeInTheDocument();
    expect(screen.queryByText("Ana Reyes")).not.toBeInTheDocument();
  });
});
```

Cards and the table can both be in the DOM under jsdom; if `findByText` reports multiple matches, switch to `findAllByText(...)` / `queryAllByText(...)` and assert on length, as the file's other tests do.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/admin-accounts-page.test.jsx`
Expected: FAIL — "Deleted user" shows under All and there is no Deleted radio.

- [ ] **Step 3: Implement in `AdminAccountsPage.jsx`**

```jsx
const TYPE_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "PERSONAL", label: ACCOUNT_TYPE_LABELS.PERSONAL },
  { value: "AGENCY_USER", label: ACCOUNT_TYPE_LABELS.AGENCY_USER },
  { value: "PENDING", label: ACCOUNT_TYPE_LABELS.PENDING },
  { value: "DELETED", label: "Deleted" },
];
```

Replace the `counts` memo and the `ofType` line:

```jsx
  // Deleted (anonymized) accounts sit in their own filter so they never crowd the live list.
  const live = useMemo(() => accounts.filter((a) => a.status !== "DELETED"), [accounts]);
  const deleted = useMemo(() => accounts.filter((a) => a.status === "DELETED"), [accounts]);

  const counts = useMemo(() => {
    const c = { ALL: live.length, PERSONAL: 0, AGENCY_USER: 0, PENDING: 0, DELETED: deleted.length };
    for (const a of live) if (a.accountType in c) c[a.accountType] += 1;
    return c;
  }, [live, deleted]);
```

```jsx
  const ofType =
    typeFilter === "DELETED" ? deleted : typeFilter === "ALL" ? live : live.filter((a) => a.accountType === typeFilter);
```

Wire the panel callbacks:

```jsx
        detail={
          selectedAccountId ? (
            <AccountDetail
              key={selectedAccountId}
              userId={selectedAccountId}
              onChanged={() => setReloadKey((k) => k + 1)}
              onDeleted={() => {
                setSelectedAccountId(null);
                setReloadKey((k) => k + 1);
              }}
            />
          ) : null
        }
```

`AccountTable.jsx`: in both the table row and `AccountCard`, change the exception check from `a.status === "DISABLED"` to `a.status !== "ACTIVE"` so Deleted shows its pill too.

- [ ] **Step 4: Run the admin tests**

Run: `npx vitest run --pool=threads tests/admin-accounts-page.test.jsx tests/account-detail.test.jsx tests/admin-page.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/AdminAccountsPage.jsx app/components/admin/AccountTable.jsx tests/admin-accounts-page.test.jsx
git commit -m "feat(admin): Deleted filter on Accounts; refresh after account actions"
```

---

### Task 14: Verify end to end

**Files:** none

- [ ] **Step 1: Full suites and types**

```bash
cd Voyage-Server && npm test && npx tsc --noEmit
cd ../Voyage-Client && npm test
```

Expected: only the Task 0 baseline failures remain.

- [ ] **Step 2: Browser check**

Restart the backend (OneDrive breaks `tsx watch`), start the client, sign in as the local Super Admin. In Admin › Accounts, with a throwaway test account:
1. Disable it → pill shows Disabled; audit trail shows "Disabled by <you>". Signing in as that account fails.
2. Enable it → can sign in again.
3. Sign out everywhere → that account's open tab is signed out on its next request.
4. Delete it → it disappears from All and appears under Deleted as "Deleted user".
5. Open an agency owner that has staff → Delete asks for a new owner; after deleting, the chosen member shows as Owner in that agency's Team.
6. Open an owner with no staff → dialog explains and offers Disable instead.

Screenshot the account panel footer and the owner delete dialog as proof.

- [ ] **Step 3: Report**

List what passed, what was skipped, and any baseline failures still present.
