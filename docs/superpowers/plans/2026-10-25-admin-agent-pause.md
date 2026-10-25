# Admin Agent Pause Implementation Plan (Part 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Super Admin can pause one user's access to the AI agent for 1 hour, 24 hours, 7 days or until lifted, with a reason. The user sees a popup and a locked composer; their agency owner/admins see a badge in Team.

**Architecture:** Four nullable columns on `User` hold the pause; one helper, `getActiveAgentPause`, decides whether it is active (expiry checked on read, no job). A `requireAgentNotPaused` middleware runs before the agent quota limiters on the send-message and upload-image routes and answers `403 AGENT_PAUSED` with `until`/`reason`. Pause/resume are two more actions on Part 1's `accountActionService`. `/auth/me`, the admin account list/detail, the Usage user rows and the Team list expose `agentPause`. The client adds a `useAgentPause` hook, an `AgentPausedModal`, a locked composer strip, a `PauseAgentDialog`, and a Team badge.

**Tech Stack:** Express + Zod + Prisma 7 + Vitest/supertest; Next.js/React + Tailwind + Vitest/Testing Library.

**Spec:** `Voyage-Server/docs/superpowers/specs/2026-10-25-admin-account-actions-usage-agent-pause-design.md` (Part 3).
**Depends on:** Part 1 (`2026-10-25-admin-account-actions.md`) — `ApiError` details, `accountActionService`/`Repository`, `AccountActionDialog`, `AccountDetail` footer. Task 9's Usage button also needs Part 2's `UsageSection` `renderRowActions` slot; if Part 2 is not merged, do the Usage half of Task 9 after it.

---

## Ground rules

Same as Part 1: no branch changes without asking; no `Co-Authored-By`; server tests `npx vitest run tests/<file>`; client tests `npx vitest run --pool=threads tests/<file>`; mock `app/components/icons/index.js` in client tests that render icons; restart the backend after server edits (OneDrive).

## File map

**Server (`Voyage-Server/`)**
- Modify `prisma/schema.prisma` — pause columns, `AGENT_PAUSED`/`AGENT_RESUMED`.
- Create `src/modules/agentPause/agentPause.ts` — `getActiveAgentPause`, `pauseUntil`, `requireAgentNotPaused`.
- Modify `src/modules/admin/accountActionService.ts`, `accountActionRepository.ts`, `accountActionSchemas.ts`, `adminRoutes.ts` — pause/resume.
- Modify `src/app.ts` — mount the check before the agent quotas.
- Modify `src/modules/auth/authRoutes.ts` (`serializeUser`), `src/modules/admin/accountService.ts`/`accountRepository.ts`, `src/modules/admin/usageRepository.ts`/`usageAggregations.ts`, `src/modules/agencies/teamRepository.ts`/`teamRoutes.ts` — expose `agentPause`.
- Tests: `tests/agentPause.test.ts`, `tests/teamRoutesAgentPause.test.ts`; extend Part 1/2 tests listed per task.

**Client (`Voyage-Client/`)**
- Create `app/lib/agentPause.js`, `app/hooks/useAgentPause.js`.
- Create `app/components/trip-dashboard/command-center/AgentPausedModal.jsx`, `AgentPausedStrip.jsx`.
- Modify `ChatComposer.jsx`, `AgentCommandCenter.jsx`, `app/hooks/useTripPlanning.js`, `app/components/trip-dashboard/HomePage.jsx`.
- Modify `app/lib/api/admin.js`/`index.js`; create `app/components/admin/PauseAgentDialog.jsx`; modify `AccountActionDialog.jsx`, `AccountDetail.jsx`, `AccountPills.jsx`, `AccountTable.jsx`, `accountLabels.js`, `AdminPage.jsx`.
- Modify `app/components/team/MemberRow.jsx`.
- Tests: `tests/agent-pause-lib.test.js`, `tests/use-agent-pause.test.jsx`, `tests/agent-paused-modal.test.jsx`, `tests/pause-agent-dialog.test.jsx`, `tests/member-row-pause.test.jsx`; extend `tests/chat-composer.test.jsx`, `tests/account-detail.test.jsx`.

---

### Task 0: Baseline

- [ ] Run `npm test` in both repos and `npx tsc --noEmit` in `Voyage-Server`; note pre-existing failures.

---

### Task 1: Schema + the pause helper and middleware

**Files:**
- Modify: `Voyage-Server/prisma/schema.prisma`
- Create: `Voyage-Server/src/modules/agentPause/agentPause.ts`
- Test: `Voyage-Server/tests/agentPause.test.ts`

- [ ] **Step 1: Schema + migration**

In `model User`, after `deletedAt`:

```prisma
  /// Agent pause set by a Super Admin. Active while agentPausedAt is set and agentPausedUntil is null (until lifted) or in the future.
  agentPausedAt       DateTime?
  agentPausedUntil    DateTime?
  agentPauseReason    String?
  agentPausedByUserId String?   @db.Uuid
```

Add `AGENT_PAUSED` and `AGENT_RESUMED` to `enum AdminAuditAction`.

Run: `npx prisma migrate dev --name agent_pause`
Expected: migration created and applied.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/agentPause.test.ts
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorHandler } from "../src/http/errors";
import { getActiveAgentPause, pauseUntil, requireAgentNotPaused } from "../src/modules/agentPause/agentPause";

const NOW = new Date("2026-10-25T08:00:00.000Z");
const paused = (until: Date | null) => ({
  agentPausedAt: new Date("2026-10-25T07:00:00.000Z"),
  agentPausedUntil: until,
  agentPauseReason: "Unusually high usage"
});

describe("getActiveAgentPause", () => {
  it("is null when never paused", () => {
    expect(getActiveAgentPause({ agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null }, NOW)).toBeNull();
    expect(getActiveAgentPause(undefined, NOW)).toBeNull();
  });

  it("is active before its end and gives ISO dates and the reason", () => {
    expect(getActiveAgentPause(paused(new Date("2026-10-26T07:00:00.000Z")), NOW)).toEqual({
      pausedAt: "2026-10-25T07:00:00.000Z",
      until: "2026-10-26T07:00:00.000Z",
      reason: "Unusually high usage"
    });
  });

  it("ends by itself once the end time passes", () => {
    expect(getActiveAgentPause(paused(new Date("2026-10-25T08:00:00.000Z")), NOW)).toBeNull();
  });

  it("stays active with no end until lifted", () => {
    expect(getActiveAgentPause(paused(null), NOW)?.until).toBeNull();
  });
});

describe("pauseUntil", () => {
  it("adds the chosen duration, or null for until lifted", () => {
    expect(pauseUntil("1h", NOW)?.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(pauseUntil("24h", NOW)?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(pauseUntil("7d", NOW)?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(pauseUntil("indefinite", NOW)).toBeNull();
  });
});

describe("requireAgentNotPaused", () => {
  function app(authUser: unknown, limiter = vi.fn((_q, _s, next) => next())) {
    const a = express();
    a.use((req, _res, next) => {
      req.authUser = authUser as any;
      next();
    });
    a.post("/send", requireAgentNotPaused, limiter, (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return { a, limiter };
  }

  it("blocks a paused user with the end time and reason, before the quota limiter counts", async () => {
    const { a, limiter } = app(paused(null));
    const res = await request(a).post("/send");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "AGENT_PAUSED", until: null, reason: "Unusually high usage" });
    expect(limiter).not.toHaveBeenCalled();
  });

  it("lets everyone else through (including signed-out requests, which requireAuth handles)", async () => {
    expect((await request(app({ agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null }).a).post("/send")).status).toBe(200);
    expect((await request(app(undefined).a).post("/send")).status).toBe(200);
  });

  it("is mounted before the agent quota limiters in app.ts", () => {
    const source = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
    const messages = source.indexOf('"/agencies/:agencyId/agent/threads/:id/messages"');
    const images = source.indexOf('"/agencies/:agencyId/agent/threads/:id/images"');
    expect(source.indexOf("requireAgentNotPaused", messages)).toBeLessThan(source.indexOf("rateLimiters.agentMessageBurst", messages));
    expect(source.indexOf("requireAgentNotPaused", images)).toBeLessThan(source.indexOf("rateLimiters.agentImageUpload", images));
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/agentPause.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the helper**

```ts
// src/modules/agentPause/agentPause.ts
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../http/errors";

export type AgentPauseDuration = "1h" | "24h" | "7d" | "indefinite";

export interface AgentPauseFields {
  agentPausedAt: Date | null;
  agentPausedUntil: Date | null;
  agentPauseReason: string | null;
}

/** What clients see. `until: null` means "until an administrator lifts it". */
export interface ActiveAgentPause {
  pausedAt: string;
  until: string | null;
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DURATION_MS: Record<Exclude<AgentPauseDuration, "indefinite">, number> = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS
};

/** The single rule for "is this user's agent paused right now?". Expiry is checked here, so no job is needed. */
export function getActiveAgentPause(user: AgentPauseFields | null | undefined, now: Date = new Date()): ActiveAgentPause | null {
  if (!user?.agentPausedAt) return null;
  if (user.agentPausedUntil && user.agentPausedUntil.getTime() <= now.getTime()) return null;
  return {
    pausedAt: user.agentPausedAt.toISOString(),
    until: user.agentPausedUntil ? user.agentPausedUntil.toISOString() : null,
    reason: user.agentPauseReason ?? ""
  };
}

export function pauseUntil(duration: AgentPauseDuration, from: Date): Date | null {
  return duration === "indefinite" ? null : new Date(from.getTime() + DURATION_MS[duration]);
}

/**
 * Mounted before the agent quota limiters, so a paused user's attempt never uses up their
 * daily allowance. Signed-out requests pass through; the agent router's requireAuth answers them.
 */
export function requireAgentNotPaused(request: Request, _response: Response, next: NextFunction) {
  const pause = getActiveAgentPause(request.authUser);
  if (pause) {
    return next(new ApiError(403, "AGENT_PAUSED", "The agent is paused for your account.", { ...pause }));
  }
  return next();
}
```

- [ ] **Step 5: Mount it in `app.ts`**

```ts
import { requireAgentNotPaused } from "./modules/agentPause/agentPause";
```

```ts
  app.post(
    "/agencies/:agencyId/agent/threads/:id/messages",
    requireAgentNotPaused,
    rateLimiters.agentMessageBurst,
    rateLimiters.agentMessageDaily,
    rateLimiters.agencyAgentMessageDaily
  );
  app.post("/agencies/:agencyId/agent/threads/:id/images", requireAgentNotPaused, rateLimiters.agentImageUpload);
```

These are the only two routes that start agent work: thread creation (`POST /threads`, both agency and personal) takes no message, and the personal routes never call the agent (checked 2026-10-25).

- [ ] **Step 6: Run tests and types**

Run: `npx vitest run tests/agentPause.test.ts tests/rateLimiters.test.ts tests/securityHardening.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma src/modules/agentPause src/app.ts tests/agentPause.test.ts
git commit -m "feat(agent): agent pause fields and a check that runs before agent quotas"
```

---

### Task 2: Pause and resume actions

**Files:**
- Modify: `Voyage-Server/src/modules/admin/accountActionService.ts`, `accountActionRepository.ts`
- Modify: `Voyage-Server/tests/accountActionService.test.ts`, `tests/accountActionRepository.test.ts`

- [ ] **Step 1: Update the Part 1 fixtures, then write the failing tests**

In `tests/accountActionService.test.ts`, the `target()` factory gains the pause fields, and `makeRepo` the two new methods:

```ts
function target(over: Partial<AccountActionTarget> = {}): AccountActionTarget {
  return {
    id: USER_ID, email: "Mara@Hops.travel", role: "USER", status: "ACTIVE",
    agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null,
    ...over
  };
}
```

```ts
    setAgentPause: vi.fn(async () => {}),
    clearAgentPause: vi.fn(async () => {})
```

Append:

```ts
describe("agent pause", () => {
  it("pauses for the chosen duration with a trimmed reason", async () => {
    const repo = makeRepo();
    await service(repo).pauseAgent(ADMIN, USER_ID, { duration: "24h", reason: "  Unusually high usage " });
    expect(repo.setAgentPause).toHaveBeenCalledWith({
      userId: USER_ID,
      adminUserId: ADMIN.id,
      pausedAt: NOW,
      until: new Date("2026-10-26T08:00:00.000Z"),
      reason: "Unusually high usage",
      duration: "24h"
    });
  });

  it("pauses until lifted with no end time", async () => {
    const repo = makeRepo();
    await service(repo).pauseAgent(ADMIN, USER_ID, { duration: "indefinite", reason: "Abuse" });
    expect(repo.setAgentPause).toHaveBeenCalledWith(expect.objectContaining({ until: null }));
  });

  it("uses the same guards as the other actions", async () => {
    const repo = makeRepo({ target: target({ role: "SUPER_ADMIN" }) });
    await expect(service(repo).pauseAgent(ADMIN, USER_ID, { duration: "1h", reason: "x" })).rejects.toMatchObject({ code: "CANNOT_ACT_ON_SUPER_ADMIN" });
  });

  it("resumes an active pause", async () => {
    const repo = makeRepo({ target: target({ agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "x" }) });
    await service(repo).resumeAgent(ADMIN, USER_ID);
    expect(repo.clearAgentPause).toHaveBeenCalledWith({ userId: USER_ID, adminUserId: ADMIN.id });
  });

  it("treats resuming someone who isn't paused (or whose pause ended) as done", async () => {
    const repo = makeRepo({
      target: target({ agentPausedAt: new Date("2026-10-24T07:00:00.000Z"), agentPausedUntil: new Date("2026-10-24T08:00:00.000Z"), agentPauseReason: "x" })
    });
    await service(repo).resumeAgent(ADMIN, USER_ID);
    expect(repo.clearAgentPause).not.toHaveBeenCalled();
  });
});
```

In `tests/accountActionRepository.test.ts`, add the pause columns to the expected anonymize `data` (`agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, agentPausedByUserId: null`), and append:

```ts
describe("agent pause writes", () => {
  it("sets the pause and audits AGENT_PAUSED with the duration", async () => {
    const until = new Date("2026-10-26T08:00:00.000Z");
    await repo().setAgentPause({ userId: USER_ID, adminUserId: "admin-1", pausedAt: NOW, until, reason: "High usage", duration: "24h" });
    expect(ctx.client.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { agentPausedAt: NOW, agentPausedUntil: until, agentPauseReason: "High usage", agentPausedByUserId: "admin-1" }
    });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith({
      data: {
        adminUserId: "admin-1", action: "AGENT_PAUSED", targetType: "User", targetId: USER_ID, reason: "High usage",
        metadata: { duration: "24h", until: "2026-10-26T08:00:00.000Z" }
      }
    });
  });

  it("clears the pause and audits AGENT_RESUMED", async () => {
    await repo().clearAgentPause({ userId: USER_ID, adminUserId: "admin-1" });
    expect(ctx.client.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, agentPausedByUserId: null }
    });
    expect(ctx.client.adminAuditEvent.create).toHaveBeenCalledWith({
      data: { adminUserId: "admin-1", action: "AGENT_RESUMED", targetType: "User", targetId: USER_ID, reason: null }
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/accountActionService.test.ts tests/accountActionRepository.test.ts`
Expected: FAIL — `pauseAgent`, `setAgentPause` etc. don't exist.

- [ ] **Step 3: Implement in `accountActionService.ts`**

```ts
import { getActiveAgentPause, pauseUntil, type AgentPauseDuration, type AgentPauseFields } from "../agentPause/agentPause";

export interface AccountActionTarget extends AgentPauseFields {
  id: string;
  email: string;
  role: string;
  status: AccountActionUserStatus;
}
```

Repository interface additions:

```ts
  setAgentPause(input: {
    userId: string;
    adminUserId: string;
    pausedAt: Date;
    until: Date | null;
    reason: string;
    duration: AgentPauseDuration;
  }): Promise<void>;
  clearAgentPause(input: { userId: string; adminUserId: string }): Promise<void>;
```

Service methods (next to `signOutEverywhere`):

```ts
    async pauseAgent(actor: AccountActionActor, userId: string, input: { duration: AgentPauseDuration; reason: string }) {
      await loadTarget(actor, userId);
      const pausedAt = now();
      await repository.setAgentPause({
        userId,
        adminUserId: actor.id,
        pausedAt,
        until: pauseUntil(input.duration, pausedAt),
        reason: input.reason.trim(),
        duration: input.duration
      });
    },

    async resumeAgent(actor: AccountActionActor, userId: string) {
      const target = await loadTarget(actor, userId);
      if (!getActiveAgentPause(target, now())) return;
      await repository.clearAgentPause({ userId, adminUserId: actor.id });
    },
```

- [ ] **Step 4: Implement in `accountActionRepository.ts`**

`findTarget`'s select gains `agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true`.

In `anonymize`'s `user.update` data add:

```ts
            agentPausedAt: null,
            agentPausedUntil: null,
            agentPauseReason: null,
            agentPausedByUserId: null,
```

New methods:

```ts
    async setAgentPause({ userId, adminUserId, pausedAt, until, reason, duration }) {
      await client.$transaction([
        client.user.update({
          where: { id: userId },
          data: { agentPausedAt: pausedAt, agentPausedUntil: until, agentPauseReason: reason, agentPausedByUserId: adminUserId }
        }),
        client.adminAuditEvent.create({
          data: {
            adminUserId,
            action: "AGENT_PAUSED",
            targetType: "User",
            targetId: userId,
            reason,
            metadata: { duration, until: until ? until.toISOString() : null }
          }
        })
      ]);
    },

    async clearAgentPause({ userId, adminUserId }) {
      await client.$transaction([
        client.user.update({
          where: { id: userId },
          data: { agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null, agentPausedByUserId: null }
        }),
        client.adminAuditEvent.create({
          data: { adminUserId, action: "AGENT_RESUMED", targetType: "User", targetId: userId, reason: null }
        })
      ]);
    }
```

- [ ] **Step 5: Run tests and types**

Run: `npx vitest run tests/accountActionService.test.ts tests/accountActionRepository.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/accountActionService.ts src/modules/admin/accountActionRepository.ts tests/accountActionService.test.ts tests/accountActionRepository.test.ts
git commit -m "feat(admin): pause and resume a user's agent access"
```

---

### Task 3: Routes, and `agentPause` on admin accounts

**Files:**
- Modify: `Voyage-Server/src/modules/admin/accountActionSchemas.ts`, `adminRoutes.ts`, `accountService.ts`, `accountRepository.ts`
- Modify: `Voyage-Server/tests/adminAccountActionRoutes.test.ts`, `tests/adminAccountService.test.ts`, `tests/adminAccountRepository.test.ts`, `tests/authenticatedValidation.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/adminAccountActionRoutes.test.ts` — add `setAgentPause: vi.fn()`, `clearAgentPause: vi.fn()` to `mocks` and to the mocked repository object; add `agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null` to `detailRow` and to the `findTarget` resolved values. Append:

```ts
describe("agent pause routes", () => {
  it("pauses with a duration and reason and returns the account with agentPause", async () => {
    mocks.findAccount.mockResolvedValue({
      ...detailRow,
      status: "ACTIVE",
      agentPausedAt: new Date("2026-10-25T08:00:00.000Z"),
      agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"),
      agentPauseReason: "High usage"
    });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "24h", reason: "High usage" });
    expect(res.status).toBe(200);
    expect(mocks.setAgentPause).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, duration: "24h", reason: "High usage" }));
    expect(res.body.user.agentPause).toMatchObject({ reason: "High usage", until: "2999-01-01T00:00:00.000Z" });
  });

  it("requires a reason and a known duration", async () => {
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "24h" })).status).toBe(400);
    expect((await request(createApp()).post(`/admin/users/${USER_ID}/agent-pause`).send({ duration: "1y", reason: "x" })).status).toBe(400);
    expect(mocks.setAgentPause).not.toHaveBeenCalled();
  });

  it("resumes", async () => {
    mocks.findTarget.mockResolvedValue({
      id: USER_ID, email: "mara@hops.travel", role: "USER", status: "ACTIVE",
      agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "x"
    });
    const res = await request(createApp()).post(`/admin/users/${USER_ID}/agent-resume`).send({});
    expect(res.status).toBe(200);
    expect(mocks.clearAgentPause).toHaveBeenCalled();
  });
});
```

`tests/adminAccountService.test.ts` — add `agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null` to `makeRow`, add `agentPause: null` to every expected `toAccountSummary`/`toAccountDetail` object, and append:

```ts
describe("agentPause on accounts", () => {
  it("shows an active pause and hides an expired one", () => {
    const active = toAccountSummary(makeRow({ agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "Abuse" }));
    expect(active.agentPause).toEqual({ pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "Abuse" });
    const expired = toAccountSummary(
      makeRow({ agentPausedAt: new Date("2020-01-01T00:00:00.000Z"), agentPausedUntil: new Date("2020-01-02T00:00:00.000Z"), agentPauseReason: "Old" })
    );
    expect(expired.agentPause).toBeNull();
  });
});
```

`tests/adminAccountRepository.test.ts` — add `agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true` to the expected `select` objects. `tests/authenticatedValidation.test.ts` — add the three null fields to `makeAccountRow()` and `agentPause: null` to the expected `users[0]` and `user` bodies.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/adminAccountActionRoutes.test.ts tests/adminAccountService.test.ts tests/adminAccountRepository.test.ts tests/authenticatedValidation.test.ts`
Expected: FAIL — route 404s, `agentPause` missing.

- [ ] **Step 3: Implement**

`accountActionSchemas.ts`:

```ts
export const agentPauseSchema = z
  .object({
    duration: z.enum(["1h", "24h", "7d", "indefinite"]),
    // Shown to the user and their agency owner, so it is required.
    reason: z.string().trim().min(1).max(300)
  })
  .strict();
```

`adminRoutes.ts` (after the Part 1 account-action routes; import `agentPauseSchema`):

```ts
adminRoutes.post("/users/:userId/agent-pause", requireSuperAdmin, async (request, response, next) => {
  try {
    const { userId } = userIdParamsSchema.parse(request.params);
    const input = agentPauseSchema.parse(request.body ?? {});
    await accountActionService.pauseAgent(request.authUser!, userId, input);
    response.json({ user: await accountService.getAccount(request.authUser!, userId) });
  } catch (error) {
    next(error);
  }
});

adminRoutes.post("/users/:userId/agent-resume", requireSuperAdmin, accountActionRoute((actor, userId) => accountActionService.resumeAgent(actor, userId)));
```

`accountService.ts`:

```ts
import { getActiveAgentPause, type ActiveAgentPause } from "../agentPause/agentPause";
```

`AdminAccountRow` gains `agentPausedAt: Date | null; agentPausedUntil: Date | null; agentPauseReason: string | null;`; `AdminAccountSummary` gains `agentPause: ActiveAgentPause | null;`; the `AdminAccountStatus` union already includes `DELETED` from Part 1. In `toAccountSummary` add the field after `memberships`:

```ts
    agentPause: getActiveAgentPause(row)
```

`accountRepository.ts` — `accountSelect` gains `agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true,` (after `passwordHash`).

- [ ] **Step 4: Run tests and types**

Run: `npx vitest run tests/adminAccountActionRoutes.test.ts tests/adminAccountService.test.ts tests/adminAccountRepository.test.ts tests/authenticatedValidation.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin tests
git commit -m "feat(admin): agent pause/resume routes; accounts show agentPause"
```

---

### Task 4: `/auth/me`, Team list and Usage rows expose the pause

**Files:**
- Modify: `Voyage-Server/src/modules/auth/authRoutes.ts`
- Modify: `Voyage-Server/src/modules/agencies/teamRepository.ts`, `teamRoutes.ts`
- Modify: `Voyage-Server/src/modules/admin/usageRepository.ts`, `usageAggregations.ts` (Part 2)
- Test: `Voyage-Server/tests/agentPause.test.ts` (append), `tests/teamRoutesAgentPause.test.ts`, `tests/usageAggregations.test.ts`, `tests/usageRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/agentPause.test.ts`:

```ts
import { serializeUser } from "../src/modules/auth/authRoutes";

describe("serializeUser", () => {
  it("includes the active agent pause so the client knows before the first send", () => {
    const user = {
      id: "u1", email: "a@b.com", displayName: "A", role: "USER", accountType: "AGENCY_USER", status: "ACTIVE",
      emailVerifiedAt: null, memberships: [],
      agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: null, agentPauseReason: "Abuse"
    };
    expect(serializeUser(user as any).agentPause).toEqual({ pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "Abuse" });
  });
});
```

If importing `authRoutes` pulls in modules that fail at import time in tests, mirror the mocks `tests/rememberMeRoutes.test.ts` uses for `authRoutes`.

```ts
// tests/teamRoutesAgentPause.test.ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const m = vi.hoisted(() => ({ listMembers: vi.fn(), requireVerifiedAgencyMember: vi.fn() }));

vi.mock("../src/db/prisma", () => ({ prisma: {} }));
vi.mock("../src/modules/agencies/teamRepository", () => ({ createPrismaTeamRepository: () => ({ listMembers: m.listMembers }) }));
vi.mock("../src/modules/agencies/invitationRepository", () => ({ createPrismaInvitationRepository: () => ({}) }));
vi.mock("../src/modules/agencyAccess/agencyAccessService", () => ({
  agencyAccessService: { requireVerifiedAgencyMember: m.requireVerifiedAgencyMember }
}));

import { errorHandler } from "../src/http/errors";
import { teamRoutes } from "../src/modules/agencies/teamRoutes";

const member = {
  id: "m2", agencyId: AGENCY, userId: "u2", role: "STAFF", status: "ACTIVE", createdAt: new Date("2026-09-01T00:00:00.000Z"),
  user: {
    id: "u2", email: "mara@hops.travel", displayName: "Mara",
    agentPausedAt: new Date("2026-10-25T07:00:00.000Z"), agentPausedUntil: new Date("2999-01-01T00:00:00.000Z"), agentPauseReason: "High usage"
  }
};

function app() {
  const a = express();
  a.use((req, _res, next) => {
    req.authUser = { id: "u1", role: "USER", status: "ACTIVE", memberships: [] } as any;
    next();
  });
  a.use("/agencies/:agencyId/team", teamRoutes);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listMembers.mockResolvedValue([member]);
});

describe("GET /agencies/:agencyId/team agentPause", () => {
  it("shows owners and admins the pause and reason, without the raw columns", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "OWNER" } });
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.status).toBe(200);
    expect(res.body.members[0].agentPause).toEqual({ until: "2999-01-01T00:00:00.000Z", reason: "High usage" });
    expect(res.body.members[0].user).toEqual({ id: "u2", email: "mara@hops.travel", displayName: "Mara" });
  });

  it("does not show staff another member's pause", async () => {
    m.requireVerifiedAgencyMember.mockResolvedValue({ agency: { id: AGENCY }, membership: { role: "STAFF" } });
    const res = await request(app()).get(`/agencies/${AGENCY}/team`);
    expect(res.body.members[0].agentPause).toBeNull();
  });
});
```

Append to `tests/usageAggregations.test.ts` (and add `userAgentPause: null` to its `row()` factory):

```ts
describe("rollup agentPause", () => {
  it("carries the user's active pause onto their row", () => {
    const pause = { pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "x" };
    const rows = rollup([row({ userAgentPause: pause })], "user");
    expect(rows[0].agentPause).toEqual(pause);
  });
});
```

In `tests/usageRepository.test.ts`, give the mocked users `agentPausedAt: null, agentPausedUntil: null, agentPauseReason: null` and add `userAgentPause: null` to the first test's expected object. Add `userAgentPause: null` to the `row()` factory in `tests/usageService.test.ts` too.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/agentPause.test.ts tests/teamRoutesAgentPause.test.ts tests/usageAggregations.test.ts tests/usageRepository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`authRoutes.ts` — import `getActiveAgentPause` from `../agentPause/agentPause` and add to `serializeUser`'s object, after `capabilities`:

```ts
    agentPause: getActiveAgentPause(user),
```

`teamRepository.ts`:

```ts
export type TeamMembershipRecord = {
  id: string;
  agencyId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "ACTIVE" | "DISABLED";
  user: {
    id: string;
    email: string;
    displayName: string;
    /** Only listMembers selects these; the Team route turns them into `agentPause`. */
    agentPausedAt?: Date | null;
    agentPausedUntil?: Date | null;
    agentPauseReason?: string | null;
  };
  createdAt: Date;
};
```

In `createPrismaTeamRepository`, add `const memberListUserSelect = { ...userSelect, agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true } as const;` and use it only in `listMembers`'s `include`.

`teamRoutes.ts`:

```ts
import { getActiveAgentPause } from "../agentPause/agentPause";
import type { TeamMembershipRecord } from "./teamRepository";

/** Owners and admins see a member's agent pause; everyone else gets null. Raw pause columns never leave. */
function toTeamMember(member: TeamMembershipRecord, canSeePause: boolean) {
  const { agentPausedAt, agentPausedUntil, agentPauseReason, ...user } = member.user;
  const pause = canSeePause
    ? getActiveAgentPause({ agentPausedAt: agentPausedAt ?? null, agentPausedUntil: agentPausedUntil ?? null, agentPauseReason: agentPauseReason ?? null })
    : null;
  return { ...member, user, agentPause: pause ? { until: pause.until, reason: pause.reason } : null };
}
```

In the `GET /` handler:

```ts
    const members = await teamService.listMembers(access.agency.id);
    const viewerRole = access.membership!.role;
    const canSeePause = viewerRole === "OWNER" || viewerRole === "ADMIN";
    response.json({ members: members.map((member) => toTeamMember(member, canSeePause)), viewerRole });
```

`usageAggregations.ts` — `UsageRunRow` gains `userAgentPause: ActiveAgentPause | null;` (import the type from `../agentPause/agentPause`), `RollupRow` gains `agentPause?: ActiveAgentPause | null;`, and in `rollup`'s new-group object add `...(groupBy === "user" ? { accountType: r.accountType, agentPause: r.userAgentPause } : {})` (replacing the existing `accountType`-only spread).

`usageRepository.ts` — the user `select` in `hydrate` gains `agentPausedAt: true, agentPausedUntil: true, agentPauseReason: true`, and each row gets:

```ts
      userAgentPause: user ? getActiveAgentPause(user) : null,
```

(import `getActiveAgentPause`).

- [ ] **Step 4: Run tests and types**

Run: `npx vitest run tests/agentPause.test.ts tests/teamRoutesAgentPause.test.ts tests/usageAggregations.test.ts tests/usageRepository.test.ts tests/usageService.test.ts tests/teamService.test.ts tests/routes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(agent): /auth/me, team list and usage rows expose the agent pause"
```

---

### Task 5: Client pause helpers and hook

**Files:**
- Create: `Voyage-Client/app/lib/agentPause.js`, `Voyage-Client/app/hooks/useAgentPause.js`
- Test: `Voyage-Client/tests/agent-pause-lib.test.js`, `Voyage-Client/tests/use-agent-pause.test.jsx`

- [ ] **Step 1: Write the failing tests**

```js
// tests/agent-pause-lib.test.js
import { describe, expect, it } from "vitest";
import { activePause, describeUntil, pauseFromError, shortUntil } from "../app/lib/agentPause.js";

const NOW = Date.parse("2026-10-25T08:00:00.000Z");

describe("agent pause helpers", () => {
  it("treats a pause past its end as over", () => {
    expect(activePause({ until: "2026-10-25T07:59:00.000Z", reason: "x", pausedAt: "p" }, NOW)).toBeNull();
    expect(activePause({ until: null, reason: "x", pausedAt: "p" }, NOW)).not.toBeNull();
    expect(activePause(null, NOW)).toBeNull();
  });

  it("describes the end in words", () => {
    expect(describeUntil({ until: null }, NOW)).toBe("until an administrator lifts it");
    expect(describeUntil({ until: "2026-10-25T08:30:00.000Z" }, NOW)).toMatch(/^until .+ \(in 30 minutes\)$/);
    expect(describeUntil({ until: "2026-10-26T07:00:00.000Z" }, NOW)).toMatch(/\(in 23 hours\)$/);
    expect(describeUntil({ until: "2026-11-01T08:00:00.000Z" }, NOW)).toMatch(/\(in 7 days\)$/);
  });

  it("gives a short end for badges and the composer strip", () => {
    expect(shortUntil({ until: null })).toBe("Agent paused");
    expect(shortUntil({ until: "2026-10-26T07:00:00.000Z" })).toMatch(/^Agent paused until /);
  });

  it("reads a pause out of an AGENT_PAUSED API error", () => {
    const err = Object.assign(new Error("m"), { code: "AGENT_PAUSED", details: { until: null, reason: "Abuse", pausedAt: "p" } });
    expect(pauseFromError(err)).toEqual({ until: null, reason: "Abuse", pausedAt: "p" });
    expect(pauseFromError(Object.assign(new Error("m"), { code: "OTHER" }))).toBeNull();
  });
});
```

```jsx
// tests/use-agent-pause.test.jsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentPause } from "../app/hooks/useAgentPause.js";

const pause = { pausedAt: "2026-10-25T07:00:00.000Z", until: null, reason: "Abuse" };

afterEach(() => vi.useRealTimers());

describe("useAgentPause", () => {
  it("opens the popup once when the chat is showing and the user is paused", () => {
    const { result, rerender } = renderHook(({ active }) => useAgentPause(pause, { surfaceActive: active }), { initialProps: { active: false } });
    expect(result.current.modalOpen).toBe(false);
    rerender({ active: true });
    expect(result.current.modalOpen).toBe(true);
    act(() => result.current.closeModal());
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.modalOpen).toBe(false);
  });

  it("opens on an AGENT_PAUSED error even if the user object didn't know", () => {
    const { result } = renderHook(() => useAgentPause(null, { surfaceActive: true }));
    let handled;
    act(() => {
      handled = result.current.reportError(Object.assign(new Error("m"), { code: "AGENT_PAUSED", details: pause }));
    });
    expect(handled).toBe(true);
    expect(result.current.pause).toEqual(pause);
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.reportError(new Error("other"))).toBe(false);
  });

  it("unlocks when the pause ends while the page is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T08:00:00.000Z"));
    const ending = { ...pause, until: "2026-10-25T08:00:05.000Z" };
    const { result } = renderHook(() => useAgentPause(ending, { surfaceActive: false }));
    expect(result.current.pause).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.pause).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/agent-pause-lib.test.js tests/use-agent-pause.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```js
// app/lib/agentPause.js
/** Client-side reading of `user.agentPause` / AGENT_PAUSED errors: { pausedAt, until (ISO or null), reason }. */

export function activePause(pause, now = Date.now()) {
  if (!pause) return null;
  if (pause.until && Date.parse(pause.until) <= now) return null;
  return pause;
}

const fmtWhen = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function relative(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

/** "until Oct 26, 3:40 PM (in 23 hours)" or "until an administrator lifts it". */
export function describeUntil(pause, now = Date.now()) {
  if (!pause?.until) return "until an administrator lifts it";
  return `until ${fmtWhen(pause.until)} (${relative(Date.parse(pause.until) - now)})`;
}

/** Short label for the composer strip and Team badge. */
export function shortUntil(pause) {
  if (!pause?.until) return "Agent paused";
  return `Agent paused until ${fmtWhen(pause.until)}`;
}

export function pauseFromError(error) {
  if (error?.code !== "AGENT_PAUSED") return null;
  const d = error.details || {};
  return { until: d.until ?? null, reason: d.reason ?? "", pausedAt: d.pausedAt ?? null };
}

export const pauseKey = (pause) => (pause ? `${pause.pausedAt}|${pause.until}` : "");
```

```js
// app/hooks/useAgentPause.js
import { useCallback, useEffect, useRef, useState } from "react";
import { activePause, pauseFromError, pauseKey } from "../lib/agentPause.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Agent-pause state for the planner page.
 * - `userPause`: `user.agentPause` from /auth/me.
 * - `surfaceActive`: the agent chat is on screen; the popup opens by itself at most once per pause per page load.
 * - `reportError(error)`: call with any send/upload error; returns true (and opens the popup) for AGENT_PAUSED.
 */
export function useAgentPause(userPause, { surfaceActive = false } = {}) {
  const [serverPause, setServerPause] = useState(null);
  const [, setTick] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const shownKeyRef = useRef(null);

  const pause = activePause(serverPause ?? userPause);
  const key = pauseKey(pause);

  useEffect(() => {
    if (!pause || !surfaceActive || shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    setModalOpen(true);
  }, [key, surfaceActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when the pause ends so the composer unlocks without a reload.
  useEffect(() => {
    if (!pause?.until) return undefined;
    const ms = Date.parse(pause.until) - Date.now();
    const timer = setTimeout(() => setTick((t) => t + 1), Math.min(Math.max(ms, 0) + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [pause?.until]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportError = useCallback((error) => {
    const fromServer = pauseFromError(error);
    if (!fromServer) return false;
    setServerPause(fromServer);
    shownKeyRef.current = pauseKey(fromServer);
    setModalOpen(true);
    return true;
  }, []);

  return {
    pause,
    modalOpen: modalOpen && !!pause,
    openModal: useCallback(() => setModalOpen(true), []),
    closeModal: useCallback(() => setModalOpen(false), []),
    reportError,
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/agent-pause-lib.test.js tests/use-agent-pause.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/agentPause.js app/hooks/useAgentPause.js tests/agent-pause-lib.test.js tests/use-agent-pause.test.jsx
git commit -m "feat(agent): client agent-pause helpers and hook"
```

---

### Task 6: The popup and the locked composer

**Files:**
- Create: `Voyage-Client/app/components/trip-dashboard/command-center/AgentPausedModal.jsx`, `AgentPausedStrip.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/command-center/ChatComposer.jsx`
- Test: `Voyage-Client/tests/agent-paused-modal.test.jsx`, `tests/chat-composer.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/agent-paused-modal.test.jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentPausedModal from "../app/components/trip-dashboard/command-center/AgentPausedModal.jsx";

describe("AgentPausedModal", () => {
  it("says the agent is paused, until when, why, and what still works", () => {
    const onClose = vi.fn();
    render(<AgentPausedModal open pause={{ pausedAt: "p", until: null, reason: "Unusually high usage" }} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "The agent is paused for your account" })).toBeInTheDocument();
    expect(screen.getByText(/until an administrator lifts it/)).toBeInTheDocument();
    expect(screen.getByText("Unusually high usage")).toBeInTheDocument();
    expect(screen.getByText(/still view and edit itineraries and trips by hand/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing without a pause", () => {
    const { container } = render(<AgentPausedModal open pause={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to `tests/chat-composer.test.jsx`:

```jsx
describe("ChatComposer while the agent is paused", () => {
  it("replaces the input and the question panel with a locked strip whose Why? reopens the popup", () => {
    const onShowAgentPause = vi.fn();
    render(<ChatComposer {...composerProps({ agentPause: { pausedAt: "p", until: null, reason: "x" }, onShowAgentPause })} />);

    expect(screen.queryByRole("group", { name: "Car or train?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Agent paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(onShowAgentPause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/agent-paused-modal.test.jsx tests/chat-composer.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```jsx
// app/components/trip-dashboard/command-center/AgentPausedModal.jsx
"use client";

import { Button, Modal } from "../../ui/index.js";
import { describeUntil } from "../../../lib/agentPause.js";

export default function AgentPausedModal({ open, pause, onClose }) {
  if (!pause) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="The agent is paused for your account"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-text-muted">An administrator paused your access to the agent {describeUntil(pause)}.</p>
      {pause.reason && (
        <div className="mb-4 rounded-sm border border-border/15 bg-surface p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Reason</p>
          <p className="text-sm text-text-primary">{pause.reason}</p>
        </div>
      )}
      <p className="text-sm text-text-muted">You can still view and edit itineraries and trips by hand.</p>
    </Modal>
  );
}
```

```jsx
// app/components/trip-dashboard/command-center/AgentPausedStrip.jsx
"use client";

import { shortUntil } from "../../../lib/agentPause.js";

/** Stands in for the composer while the agent is paused. */
export default function AgentPausedStrip({ pause, onWhy, containerClassName = "" }) {
  return (
    <div className={containerClassName}>
      <div className="flex w-full items-center gap-3 rounded-[18px] border border-status-warning/30 bg-status-warning/8 px-4 py-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-status-warning" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <p className="min-w-0 flex-1 text-sm text-text-primary">{shortUntil(pause)}</p>
        <button
          type="button"
          onClick={onWhy}
          className="flex-none rounded-sm px-2 py-1 text-sm font-semibold text-text-primary underline underline-offset-2 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50"
        >
          Why?
        </button>
      </div>
    </div>
  );
}
```

`ChatComposer.jsx` — import the strip, pull the two props out, and return early before the question panel (hooks stay above the return):

```jsx
import AgentPausedStrip from "./AgentPausedStrip.jsx";

export default function ChatComposer({ messages, onAnswer, agentPause = null, onShowAgentPause, ...inputProps }) {
```

```jsx
  if (agentPause) {
    return <AgentPausedStrip pause={agentPause} onWhy={onShowAgentPause} containerClassName={inputProps.containerClassName} />;
  }

  if (pending && pending.messageId !== dismissedId && !isSending) {
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/agent-paused-modal.test.jsx tests/chat-composer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/trip-dashboard/command-center/AgentPausedModal.jsx app/components/trip-dashboard/command-center/AgentPausedStrip.jsx app/components/trip-dashboard/command-center/ChatComposer.jsx tests/agent-paused-modal.test.jsx tests/chat-composer.test.jsx
git commit -m "feat(agent): paused popup and locked composer strip"
```

---

### Task 7: Wire it into the planner page

**Files:**
- Modify: `Voyage-Client/app/hooks/useTripPlanning.js`
- Modify: `Voyage-Client/app/components/trip-dashboard/command-center/AgentCommandCenter.jsx`
- Modify: `Voyage-Client/app/components/trip-dashboard/HomePage.jsx`

No new unit test: Tasks 5–6 cover the pieces; this task only connects them and is checked in the browser in Task 10.

- [ ] **Step 1: `useTripPlanning` reports send/upload errors**

```js
export function useTripPlanning(agencyId, { onSendError } = {}) {
  // ...existing state...
  // Latest callback without re-creating dispatchMessage.
  const onSendErrorRef = useRef(onSendError);
  onSendErrorRef.current = onSendError;
```

In the image-upload `catch (uploadError)`:

```js
        } catch (uploadError) {
          console.error("Failed to upload images", uploadError);
          // A paused agent explains itself in a popup; no inline error needed.
          setAgentError(onSendErrorRef.current?.(uploadError) ? null : "Failed to upload images. Please try again.");
          setIsSending(false);
          return outcome;
        }
```

In the send `catch (error)`, replace the `setAgentError(...)` line with:

```js
      const handled = onSendErrorRef.current?.(error) === true;
      setAgentError(handled ? null : error?.message || "Unable to send your request to Voyage Agent.");
```

(the rest of that catch is unchanged).

- [ ] **Step 2: `AgentCommandCenter` passes the props through**

Add `agentPause = null, onShowAgentPause,` to its destructured props and to its `<ChatComposer ... />` (around line 415):

```jsx
          agentPause={agentPause}
          onShowAgentPause={onShowAgentPause}
```

- [ ] **Step 3: `HomePage` owns the state**

Imports:

```jsx
import { useAgentPause } from "../../hooks/useAgentPause.js";
import AgentPausedModal from "./command-center/AgentPausedModal.jsx";
```

Before the `useTripPlanning` call:

```jsx
  // useAgentPause needs currentTab (computed later), so the send-error handler is wired through a ref.
  const agentPauseErrorRef = useRef(null);
```

and change the call to `useTripPlanning(agencyId, { onSendError: (error) => agentPauseErrorRef.current?.(error) ?? false })`.

Right after `const currentTab = resolveVisibleTab(...)`:

```jsx
  const agentPause = useAgentPause(user?.agentPause ?? null, { surfaceActive: currentTab === "command-center" });
  agentPauseErrorRef.current = agentPause.reportError;
```

Pass to **both** `<AgentCommandCenter>` mounts (desktop and mobile) and to the mobile `<ChatComposer>`:

```jsx
                    agentPause={agentPause.pause}
                    onShowAgentPause={agentPause.openModal}
```

Render the popup once, next to the page's other top-level modals (e.g. beside the traveler-needs dialog):

```jsx
      <AgentPausedModal open={agentPause.modalOpen} pause={agentPause.pause} onClose={agentPause.closeModal} />
```

- [ ] **Step 4: Run the planner-page tests**

Run: `npx vitest run --pool=threads tests/chat-composer.test.jsx tests/composer-height-padding.test.jsx` and the full suite `npm test`
Expected: no new failures vs the Task 0 baseline. If a HomePage test mocks `useTripPlanning` with a strict argument check, update it to accept the new options object.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useTripPlanning.js app/components/trip-dashboard/command-center/AgentCommandCenter.jsx app/components/trip-dashboard/HomePage.jsx
git commit -m "feat(agent): planner shows the pause popup and locks the composer"
```

---

### Task 8: Admin — pause dialog, resume, pills

**Files:**
- Modify: `Voyage-Client/app/lib/api/admin.js`, `index.js`
- Create: `Voyage-Client/app/components/admin/PauseAgentDialog.jsx`
- Modify: `Voyage-Client/app/components/admin/AccountActionDialog.jsx`, `AccountDetail.jsx`, `AccountPills.jsx`, `AccountTable.jsx`, `accountLabels.js`
- Test: `Voyage-Client/tests/pause-agent-dialog.test.jsx`, `tests/account-detail.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// tests/pause-agent-dialog.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/api/index.js", () => ({ adminPauseAgent: vi.fn() }));

import { adminPauseAgent } from "../app/lib/api/index.js";
import PauseAgentDialog from "../app/components/admin/PauseAgentDialog.jsx";

const account = { id: "u2", displayName: "Mara Santos", email: "mara@hops.travel", usageThisMonth: { costUsd: 1.4, runCount: 71 } };

beforeEach(() => vi.clearAllMocks());

describe("PauseAgentDialog", () => {
  it("defaults to 24 hours, needs a reason, and sends both", async () => {
    adminPauseAgent.mockResolvedValue({ user: { ...account, agentPause: { until: null } } });
    const onDone = vi.fn();
    render(<PauseAgentDialog open account={account} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByRole("dialog", { name: "Pause the agent for Mara Santos?" })).toBeInTheDocument();
    expect(screen.getByText("This month: $1.40 · 71 runs")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "24 hours" })).toBeChecked();
    const submit = screen.getByRole("button", { name: "Pause agent" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Until I lift it" }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Abuse" } });
    fireEvent.click(submit);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(adminPauseAgent).toHaveBeenCalledWith("u2", { duration: "indefinite", reason: "Abuse" });
  });
});
```

In `tests/account-detail.test.jsx`, add `adminPauseAgent: vi.fn(), adminResumeAgent: vi.fn()` to the API mock, stub the new dialog (`vi.mock("../app/components/admin/PauseAgentDialog.jsx", () => ({ default: ({ open }) => (open ? <div role="dialog" aria-label="pause" /> : null) }))`), add `agentPause: null` to `detail()`, and append:

```jsx
describe("agent pause controls", () => {
  it("offers Pause agent, or Resume agent with the pause shown", async () => {
    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Pause agent" }));
    expect(screen.getByRole("dialog", { name: "pause" })).toBeInTheDocument();
  });

  it("shows an active pause and offers Resume", async () => {
    await renderDetail(detail({ agentPause: { pausedAt: "p", until: null, reason: "Abuse" } }));
    // The pill and the pause notice both say it.
    expect(screen.getAllByText("Agent paused")).toHaveLength(2);
    expect(screen.getByText("Abuse")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume agent" }));
    expect(screen.getByRole("dialog", { name: "action resume-agent" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --pool=threads tests/pause-agent-dialog.test.jsx tests/account-detail.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`admin.js` (with the Part 1 account actions; reuse `postAccountAction`):

```js
export async function adminPauseAgent(userId, { duration, reason }) {
  return postAccountAction(userId, "agent-pause", { duration, reason: (reason || "").trim() });
}

export async function adminResumeAgent(userId) {
  return postAccountAction(userId, "agent-resume", {});
}
```

Add both to `index.js`'s admin export list.

`accountLabels.js` — add to `AUDIT_ACTION_LABELS`: `AGENT_PAUSED: "Agent paused", AGENT_RESUMED: "Agent resumed",`.

`AccountActionDialog.jsx` — import `adminResumeAgent` and add to `ACCOUNT_ACTIONS`:

```js
  "resume-agent": {
    title: (name) => `Resume the agent for ${name}?`,
    body: "They can use the agent again straight away.",
    confirm: "Resume agent",
    tone: "primary",
    run: (id) => adminResumeAgent(id),
  },
```

`AccountPills.jsx`:

```jsx
/** Warning-toned pill for a user whose agent access is paused. */
export function AgentPausedPill() {
  return (
    <span className={`${PILL} border-status-warning/30 bg-status-warning/10 text-status-warning`}>Agent paused</span>
  );
}
```

`AccountTable.jsx` — in both the row's Type cell and `AccountCard`, after the status exception, add `{a.agentPause && <AgentPausedPill />}` (import it).

```jsx
// app/components/admin/PauseAgentDialog.jsx
"use client";

import { useEffect, useId, useState } from "react";
import { adminPauseAgent } from "../../lib/api/index.js";
import { Button, Modal } from "../ui/index.js";
import { displayName } from "./accountLabels.js";
import { fmtUsd } from "./usage/usageFormat.js";

const DURATIONS = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "indefinite", label: "Until I lift it" },
];

const FIELD =
  "w-full resize-y rounded-sm border border-border/20 bg-background p-3 font-sans text-sm text-text-primary placeholder:text-text-soft focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20";

export default function PauseAgentDialog({ open, account, onClose, onDone }) {
  const [duration, setDuration] = useState("24h");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reasonId = useId();

  useEffect(() => {
    if (open) {
      setDuration("24h");
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!account) return null;
  const usage = account.usageThisMonth;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await adminPauseAgent(account.id, { duration, reason });
      onDone?.(data?.user ?? null);
    } catch (e) {
      setError(e?.message || "Couldn't pause the agent. Try again.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      title={`Pause the agent for ${displayName(account)}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? "Pausing…" : "Pause agent"}
          </Button>
        </>
      }
    >
      <p className="mb-1 text-sm leading-relaxed text-text-muted">They can still sign in and edit trips by hand.</p>
      {usage && (
        <p className="mb-4 text-sm tabular-nums text-text-muted">
          This month: {fmtUsd(usage.costUsd)} · {usage.runCount} runs
        </p>
      )}

      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Duration</legend>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <label
              key={d.value}
              className={`cursor-pointer rounded-pill border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-secondary/50 ${
                duration === d.value ? "border-status-warning/40 bg-status-warning/10 font-semibold text-text-primary" : "border-border/30 text-text-muted hover:bg-surface"
              }`}
            >
              <input type="radio" name="pause-duration" value={d.value} checked={duration === d.value} onChange={() => setDuration(d.value)} className="sr-only" />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={reasonId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
        Reason (shown to the user and their agency owner)
      </label>
      <textarea id={reasonId} rows={3} maxLength={300} className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} />

      {error && (
        <p role="alert" className="mt-3 rounded-sm bg-status-danger/8 p-3 text-sm text-status-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
```

`AccountDetail.jsx` — import `PauseAgentDialog`, `AgentPausedPill`, and `shortUntil` from `../../lib/agentPause.js`. `dialog` state can now also be `"pause"` or `"resume-agent"`.

In the pill row at the top add `{account.agentPause && <AgentPausedPill />}`. Under the field grid, when paused:

```jsx
      {account.agentPause && (
        <div className="mb-6 rounded-sm border border-status-warning/25 bg-status-warning/8 p-3 text-sm text-text-primary">
          <p className="font-semibold">{shortUntil(account.agentPause)}</p>
          {account.agentPause.reason && <p className="mt-1 text-text-muted">{account.agentPause.reason}</p>}
        </div>
      )}
```

In the footer, before Sign out everywhere:

```jsx
          {account.agentPause ? (
            <button type="button" className={SECONDARY_ACTION} onClick={() => setDialog("resume-agent")}>
              Resume agent
            </button>
          ) : (
            <button type="button" className={SECONDARY_ACTION} onClick={() => setDialog("pause")}>
              Pause agent
            </button>
          )}
```

Widen the `AccountActionDialog` `open` condition to include `dialog === "resume-agent"`, and add:

```jsx
      <PauseAgentDialog open={dialog === "pause"} account={account} onClose={() => setDialog(null)} onDone={handleDone} />
```

For an indefinite pause the `shortUntil` heading reads "Agent paused", the same as the pill — hence the test expects two matches.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --pool=threads tests/pause-agent-dialog.test.jsx tests/account-detail.test.jsx tests/account-action-dialog.test.jsx tests/admin-accounts-page.test.jsx`
Expected: PASS.

- [ ] **Step 5: Pause from the Usage drill-in (needs Part 2)**

In `AdminPage.jsx`, give `UsageSection` a `renderRowActions` that shows Pause/Resume for user rows:

```jsx
import AccountActionDialog from "./AccountActionDialog.jsx";
import PauseAgentDialog from "./PauseAgentDialog.jsx";
```

```jsx
function UsagePauseButton({ row, onChanged }) {
  const [dialog, setDialog] = useState(null);
  const account = { id: row.id, displayName: row.label };
  const done = () => {
    setDialog(null);
    onChanged?.();
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setDialog(row.agentPause ? "resume-agent" : "pause")}
        className="self-start rounded-sm border border-border/20 bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface/80 active:scale-[0.98]"
      >
        {row.agentPause ? "Resume agent" : "Pause agent"}
      </button>
      <PauseAgentDialog open={dialog === "pause"} account={account} onClose={() => setDialog(null)} onDone={done} />
      <AccountActionDialog open={dialog === "resume-agent"} action="resume-agent" account={account} onClose={() => setDialog(null)} onDone={done} />
    </>
  );
}
```

```jsx
        {section === "usage" && (
          <UsageSection
            key={usageFocus?.id ?? "all"}
            initialSelection={usageFocus}
            renderRowActions={(row, groupBy, reload) =>
              groupBy === "user" && row.drillable && row.roleTag !== null ? <UsagePauseButton row={row} onChanged={reload} /> : null
            }
          />
        )}
```

`row.roleTag !== null` skips rows for deleted accounts (they have no role left). The server still refuses Super Admins and you.

Also show the pause on user rows: in `UsageTable.jsx`'s `NameCell`, after the sub line, add `{row.agentPause && <span className="mt-0.5 block text-xs font-semibold text-status-warning">Agent paused</span>}`.

Run: `npx vitest run --pool=threads tests/admin-page.test.jsx tests/usage-section.test.jsx tests/usage-table.test.jsx` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/api app/components/admin tests
git commit -m "feat(admin): pause/resume the agent from the account panel and Usage"
```

---

### Task 9: Team badge for owners and admins

**Files:**
- Modify: `Voyage-Client/app/components/team/MemberRow.jsx`
- Test: `Voyage-Client/tests/member-row-pause.test.jsx`

The spec allowed a tooltip or tap popover for the reason; this plan shows it as a second line under the email instead, so it reads the same on touch, mouse and screen readers.

- [ ] **Step 1: Write the failing test**

```jsx
// tests/member-row-pause.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MemberRow from "../app/components/team/MemberRow.jsx";

const member = (over = {}) => ({
  id: "m2",
  role: "STAFF",
  createdAt: "2026-09-01T00:00:00.000Z",
  user: { id: "u2", email: "mara@hops.travel", displayName: "Mara Santos" },
  agentPause: null,
  ...over,
});

describe("MemberRow agent pause", () => {
  it("shows a paused badge with the reason", () => {
    render(<MemberRow member={member({ agentPause: { until: null, reason: "Unusually high usage" } })} viewerRole="OWNER" />);
    expect(screen.getByText("Agent paused")).toBeInTheDocument();
    expect(screen.getByText("Unusually high usage")).toBeInTheDocument();
  });

  it("shows nothing extra when not paused", () => {
    render(<MemberRow member={member()} viewerRole="OWNER" />);
    expect(screen.queryByText(/Agent paused/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --pool=threads tests/member-row-pause.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `MemberRow.jsx`

```jsx
import { shortUntil } from "../../lib/agentPause.js";
```

Inside the name/email column, after the "Joined" phone line:

```jsx
          {member.agentPause && (
            <div className="mt-1 flex flex-col items-start gap-0.5">
              <span className="rounded-pill border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
                {shortUntil(member.agentPause)}
              </span>
              {member.agentPause.reason && <span className="truncate text-xs text-text-muted">{member.agentPause.reason}</span>}
            </div>
          )}
```

- [ ] **Step 4: Run it and the team tests**

Run: `npx vitest run --pool=threads tests/member-row-pause.test.jsx tests/settings-team.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/team/MemberRow.jsx tests/member-row-pause.test.jsx
git commit -m "feat(team): owners and admins see a member's agent pause"
```

---

### Task 10: Verify end to end

- [ ] **Step 1:** `cd Voyage-Server && npm test && npx tsc --noEmit`; `cd ../Voyage-Client && npm test`. Only baseline failures may remain.
- [ ] **Step 2:** Restart the backend. With a Super Admin in one browser profile and a test agency staff account in another:
  1. Admin › Accounts › staff account › Pause agent, 1 hour, reason "QA". The account pill shows Agent paused; the audit trail shows it.
  2. As the staff user, open the planner: the popup appears once, with the reason and end time. Close it: the composer is the locked strip; Why? reopens the popup.
  3. Pause a user while their planner tab is already open, then have them send: the popup appears; their daily agent quota did not go down (check the `RateLimit` headers on a later allowed send, or the limiter store).
  4. As the agency owner, Agency › Team shows the badge and reason on that member. As another staff member, no badge.
  5. Admin › Usage › Users › that person › Resume agent; the staff user can send again after reloading.
  6. Pause for 1 hour and set the user's `agentPausedUntil` a minute ahead in the DB; with the page open, the composer unlocks by itself when it passes.
- [ ] **Step 3:** Screenshot the popup, the locked composer and the Team badge; report what passed and anything skipped.
