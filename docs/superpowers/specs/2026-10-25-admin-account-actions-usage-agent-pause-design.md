# Admin: account actions, accurate usage, agent pause — design

Date: 2026-10-25 · Status: approved in brainstorming, awaiting spec review
Repos: Voyage-Server, Voyage-Client · Surface: Super Admin page (`Agencies · Accounts · Usage · Reports`)

## Why

The Super Admin page can look at accounts but not act on them: there is no delete, disable or sign-out. The Usage tab shows `$0.000` spend in production, counts only completed runs, and only answers "how many tokens in the last 30 days" — not who or what is expensive, or whether the agent is healthy. And there is no way to stop one person from using the agent when the dashboard shows they are abusing it or running up cost.

This spec covers three parts that ship independently, in this order:

1. **Account actions** — disable/enable, sign out everywhere, delete (anonymize), audit trail.
2. **Usage accuracy + rebuild** — fix what is recorded, then redesign the tab (layout A).
3. **Agent pause** — the admin pauses one user's agent access for a set time, the user sees a popup.

## Decisions made in brainstorming

| Question | Decision |
| --- | --- |
| What "delete account" does | **Anonymize.** Scrub identity, revoke access; the agency keeps the work, credited to "Deleted user". |
| Deleting an agency owner | **Blocked until ownership is transferred** to an active member of that agency, inside the delete dialog. |
| Solo owner (no other members) | **Blocked with an explanation.** Owner deletes the agency in Settings first, or the admin disables them. No admin agency delete. |
| Other account actions | Disable/Enable, Sign out everywhere, audit trail. **Not** resend verification (users can self-serve). |
| What Usage must answer | Accurate usage per user / owner / agency, what am I spending, who or what is expensive, is the agent healthy. |
| Usage approach / layout | **A:** fix accuracy, live queries (no rollup table), overview cards + chart + table with drill-in. |
| How a user gets paused | **The admin decides** from the dashboard. No automatic budget blocking. |
| Does the owner see a pause | **Yes, a badge in Agency › Team** with the reason. No email. Owners cannot lift it. |

## Current state (verified 2026-10-25)

- `src/modules/admin/accountService.ts` + `accountRepository.ts`: read-only `GET /admin/users` and `GET /admin/users/:userId`.
- `User.status` is `ACTIVE | DISABLED`. `requireAuth` (`src/http/authMiddleware.ts` ~line 93) rejects any session whose user is not `ACTIVE` on every request, so a status change takes effect immediately. Nothing sets `DISABLED` today. `AdminAuditAction.USER_DISABLED` exists but is unused.
- A hard `prisma.user.delete` fails: `ClientTrip` (creator, organizer), `Itinerary`, `AgentThread`, `AgencyPlaceNote`, `ProblemReport` (reporter, resolver), `AdminAuditEvent`, `AgencyInvitation` (inviter, accepter, revoker) and `Agency` (owner, verifiedBy/rejectedBy/suspendedBy) reference `User` with no `onDelete`. Only `Session`, `AuthProviderAccount`, `EmailVerificationToken`, `PasswordResetToken`, `AgencyMembership` cascade; `ImageAsset.owner` and `AgentMessage.author` set null.
- Usage: `AgentRun` has `promptTokens/outputTokens/totalTokens/cachedTokens/thoughtsTokens/costUsd/usageDetail/usageUserId`, written only by `completeRunIfOpen`. `failRun` writes no usage; `usageRepository.listRunUsage` filters `status: "COMPLETED"`.
- Cost: `estimateVertexCost` (`src/services/modelProvider/vertex.ts`) returns `undefined` for any model not in `GOOGLE_VERTEX_MODEL_PRICING`, which becomes `$0`. It prices `candidatesTokenCount` only — thinking tokens are not priced. Cached tokens are priced at 25% of input.
- `AgentRun.modelName` is always `"gpt-5-mini"` (`agentService.ts:222` default, never passed). The per-call `usageDetail[].modelName` is correct.
- The Usage period toggle only changes bucket size; the range is always the last 30 days; empty buckets are not drawn.
- Existing agent limits (`src/http/rateLimiters.ts`): `agentMessageBurst`, `agentMessageDaily`, `agencyAgentMessageDaily`, `agentImageUpload` — message counts, not per-person admin control.
- Client: shared `app/components/ui/Modal.jsx`, `admin/DetailPane.jsx`, `admin/MasterDetailLayout.jsx`, `admin/SegmentedControl.jsx`; usage UI in `admin/usage/*`.

---

## Part 1 — Account actions

### Data model (migration)

- `enum UserStatus` gains `DELETED`.
- `User.deletedAt DateTime?`.
- `enum AdminAuditAction` gains `USER_ENABLED`, `USER_SESSIONS_REVOKED`, `USER_DELETED`, `AGENCY_OWNERSHIP_TRANSFERRED` (and Part 3's `AGENT_PAUSED`, `AGENT_RESUMED` — one migration if both parts land together, otherwise each part adds its own).
- Audit rows for user actions use `targetType: "USER"`, `targetId: <userId>`; an ownership transfer uses `targetType: "AGENCY"` with `metadata: { fromUserId, toUserId }`.

### Routes (all `requireSuperAdmin`, service re-checks `SUPER_ADMIN` like `accountService`)

| Route | Body | Effect |
| --- | --- | --- |
| `POST /admin/users/:userId/disable` | `{ reason?: string ≤500 }` | `status = DISABLED`, delete all sessions, audit `USER_DISABLED`. |
| `POST /admin/users/:userId/enable` | `{ reason? }` | `status = ACTIVE`, audit `USER_ENABLED`. |
| `POST /admin/users/:userId/sign-out` | `{ reason? }` | Delete all sessions, audit `USER_SESSIONS_REVOKED`. |
| `POST /admin/users/:userId/delete` | `{ confirmEmail, reason?, newOwnerUserId? }` | Anonymize (below). |

All bodies are strict Zod schemas. Each returns the updated account detail (`{ user }`), except delete, which returns `204`.

**Guards (every route):**
- Target not found → `404 ACCOUNT_NOT_FOUND`.
- Target is the acting admin → `403 CANNOT_ACT_ON_SELF`.
- Target has `role = SUPER_ADMIN` → `403 CANNOT_ACT_ON_SUPER_ADMIN`.
- Target already `DELETED` → `409 ACCOUNT_DELETED` (no actions on an anonymized account).
- Disable an already-disabled account / enable an active one → no-op success, no audit row.

### Delete = anonymize (one transaction)

1. `confirmEmail` must equal the account's current `email`, compared case-insensitively → else `400 EMAIL_CONFIRMATION_MISMATCH`.
2. **Owner check.** Find agencies where the user is `OWNER` with an `ACTIVE` membership.
   Checks run in this order:
   - Any owned agency has no other `ACTIVE` members → `409 OWNER_HAS_NO_SUCCESSOR` with `{ agencyId, agencyName }`.
   - More than one owned agency → `409 MULTIPLE_OWNED_AGENCIES` (v1's dialog handles one; today's product creates one agency per owner).
   - Exactly one owned agency: `newOwnerUserId` is required (`400 NEW_OWNER_REQUIRED`) and must be one of its other active members (`400 INVALID_NEW_OWNER`). Set that membership's role to `OWNER`, set `Agency.ownerUserId` to them, audit `AGENCY_OWNERSHIP_TRANSFERRED`.
   - No owned agency: `newOwnerUserId` must be absent (ignored if sent).
3. **Scrub identity:** `email = "deleted+<id>@deleted.invalid"`, `emailNormalized` the same, `displayName = "Deleted user"`, `passwordHash = null`, `emailVerifiedAt = null`, `avatarImageId = null`, `status = DELETED`, `deletedAt = now`. Clear any agent-pause fields (Part 3).
4. **Delete:** sessions, `AuthProviderAccount` rows (Google link), email-verification and password-reset tokens, `AgencyMembership` rows.
5. **Revoke** pending `AgencyInvitation`s the user sent (`revokedByUserId = acting admin`).
6. **Keep:** client trips, itineraries, agent threads/messages/runs, place notes, problem reports, audit events. They now display "Deleted user" through the existing `displayName` joins.
7. Audit `USER_DELETED` with the reason. The audit row is the lasting record of who was deleted; put the pre-delete email's domain only (not the full address) in `metadata` so the record is useful without keeping personal data.

Deleted accounts can never sign in: no password, no provider link, status not `ACTIVE`, and the email is unreachable.

### Account detail additions (`GET /admin/users/:userId`)

- `auditEvents`: the last 50 `AdminAuditEvent`s with `targetType USER, targetId = userId`, newest first, with the acting admin's `displayName`.
- `ownedAgencies`: `[{ agencyId, agencyName, successors: [{ userId, displayName, role }] }]` — active non-owner members, for the delete dialog.
- `usageThisMonth`: `{ costUsd, runCount }` (from Part 2's repository; omitted until Part 2 ships).
- `agentPause` (Part 3).

`GET /admin/users` adds `status DELETED` to the list; the existing mapper exposes `status`.

### Client

- `AccountDetail.jsx`: an **actions footer** pinned at the bottom of the pane (same sticky pattern as `AgencyDetail`): `Sign out everywhere`, `Disable` / `Enable`, and `Delete account` (danger, pushed right). Hidden for Super Admins, for the signed-in admin's own account, and for deleted accounts. Disable/Enable/Sign-out open a small confirm with an optional reason.
- An **Audit trail** section listing `auditEvents` (action label, admin, date, reason) — label map in `accountLabels.js`.
- New `DeleteAccountDialog.jsx` (on `ui/Modal`):
  - **Regular user:** explanation of what is erased vs kept, optional reason, "Type <email> to confirm", `Delete account` enabled only on an exact match.
  - **Owner with successors:** a "New owner" select (active members of their agency) above the same fields; button reads `Transfer and delete`.
  - **Solo owner:** no form. Message: "<Agency> has no other members. The owner must delete the agency in Settings first, or you can disable this account." with a `Disable instead` button.
  - Server errors show inline in the dialog; on success the dialog closes, the list refetches, the pane closes.
- `AdminAccountsPage` / `AccountTable`: a **Deleted** filter chip; deleted accounts are excluded from **All**; `AccountStatusPill` gains `Deleted`. Disabled pill already exists.
- `lib/api/admin.js`: `adminDisableUser`, `adminEnableUser`, `adminSignOutUser`, `adminDeleteUser`.

---

## Part 2 — Usage accuracy and rebuild (layout A)

### 2a. Accuracy fixes (server)

1. **Failed runs record usage.** `agentService.failRun(runId, code, message, usage?)` takes the orchestrator's accumulated summary (`usage.summary()`, already in scope at each `failRun` call site in `agentOrchestrator.ts`) and `failRunIfOpen` writes the same usage columns `completeRunIfOpen` does. The usage query counts `COMPLETED` and `FAILED` runs with `totalTokens not null`.
2. **Thinking tokens are priced** at the output rate: output cost uses `candidatesTokenCount + thoughtsTokenCount`.
3. **Price table checked** against Google's current published Vertex/Gemini prices at implementation time (per-model input, output, and cached-input rate). The cached rate becomes a per-model field instead of the hard-coded 25%. The verified source URL and date go in a comment above `GOOGLE_VERTEX_MODEL_PRICING`.
4. **Unpriced models are visible, not $0.** When a call's model has no price entry, its `costUsd` is `null` in `usageDetail` and the run is flagged `costComplete: false` (new `AgentRun.costComplete Boolean @default(true)`). Aggregates sum known costs and return `unpricedModels: string[]` (distinct model names from `usageDetail` of incomplete runs in range).
5. **Real model name on the run.** The orchestrator passes the selected model to `createRun`, so `AgentRun.modelName`/`modelProvider` are true. Existing rows are left as-is; the usage views read the model from `usageDetail` when present.
6. Pre-metering runs (null tokens) stay excluded; the UI says "Usage is recorded from <first metered run date>" when the selected range starts earlier.

### 2b. API

`GET /admin/usage` — strict query:

| Param | Values | Default |
| --- | --- | --- |
| `range` | `this_month`, `last_month`, `7d`, `30d` | `this_month` |
| `groupBy` | `user`, `agency`, `chat` | `user` |

Bucket size follows the range: `day` for all four presets. (Week/month buckets return if longer ranges are added later.) Dates are computed in UTC (as today).

Response:

```ts
{
  range, groupBy, from, to,
  totals: { costUsd, promptTokens, outputTokens, thoughtsTokens, cachedTokens, totalTokens,
            runCount, failedRunCount, avgCostPerRun, avgTokensPerRun, cacheHitRate },
  previous: { costUsd, runCount, totalTokens },           // the equal-length range just before
  projectedMonthEndCostUsd: number | null,                // this_month only: costUsd / elapsedDays * daysInMonth
  series: [{ bucket: "YYYY-MM-DD", costUsd, totalTokens, runCount, failedRunCount }], // zero-filled
  rows: [{ id, label, costUsd, totalTokens, promptTokens, outputTokens, runCount, failedRunCount,
           // user rows:
           accountType?, roleTag?: "OWNER"|"ADMIN"|"STAFF"|"PERSONAL", agencyName?, agentPause?,
           // chat rows:
           threadTitle?, agencyName? }],
  unpricedModels: string[],
  meteredSince: string | null
}
```

- `cacheHitRate = cachedTokens / promptTokens` (0 when no prompt tokens).
- User `roleTag`: the membership role in the run's agency; `PERSONAL` for personal accounts; a user in several agencies shows their role in the agency with the most spend in range.
- Chat rows group by `AgentRun.threadId`, label = `AgentThread.title`.

`GET /admin/usage/runs` — strict query: exactly one of `userId | agencyId | threadId`, plus `range`. Returns up to 50 runs newest first: `{ id, createdAt, status, threadTitle, userLabel, agencyName, modelNames[], totalTokens, costUsd, costComplete, callCount }`.

`GET /admin/usage/runs/:runId` — `{ run, calls: usageDetail[] }` (phase, callIndex, modelName, prompt/cached/output/thoughts/total tokens, costUsd).

All three: `requireSuperAdmin`, service re-checks role. Usage stays live-queried (no rollup table); add `@@index([status, createdAt])` on `AgentRun` if the planner shows a scan.

### 2c. Client (`admin/usage/*`)

- **Range control** (`SegmentedControl`): This month · Last month · 7 days · 30 days. The Day/Week/Month toggle is removed.
- **Stat cards** (`UsageStatCards`): Spend (with ▲/▼ % vs previous and "~$X by <month end>" on This month), Runs (with failed %), Avg / run (cost and tokens), Cache hit (%).
- **Unpriced banner** when `unpricedModels.length`: "Cost is incomplete: runs used unpriced models (gemini-x). Add them to the price list."
- **Chart** (`UsageBarChart`): zero-filled bars, metric toggle Cost · Tokens · Runs, first/middle/last date labels, failed runs as a stacked darker segment on the Runs metric.
- **Table** (`UsageTable`): group toggle Users · Agencies · Chats. User rows show a tag `Owner · <Agency>` / `Staff · <Agency>` / `Personal`, plus an "Agent paused" pill (Part 3). Columns: Name, Runs, Failed, Tokens, Cost; sortable as today. Rows are buttons.
- **Drill-in** (`UsageDrillIn.jsx` in `DetailPane`): header with the row's totals; list of runs (date, chat, status, tokens, cost, "incomplete cost" marker). Selecting a run expands its per-call table (phase, model, prompt / cached / output / thinking, cost). For a user row the pane also shows the Part 3 `Pause agent` / `Resume agent` button.
- Account panel (Part 1) shows "Usage this month: $X · N runs" linking to the Usage tab with that user's drill-in open.

---

## Part 3 — Agent pause ("timeout")

### Behaviour

- Super Admin pauses one user's agent access for **1 hour, 24 hours, 7 days, or until lifted**, with a **required** reason (≤300 chars) that the user and their agency owner/admins will see.
- While paused the user cannot send agent messages or upload agent images. Everything else works: sign-in, viewing and hand-editing itineraries and trips, sharing.
- A run already in progress when the pause starts is allowed to finish.
- A pause ends on its own at `until`, or when the admin resumes it. Pausing again replaces the current pause.
- Same guards as Part 1 (not self, not a Super Admin, not deleted).

### Data model

- `User.agentPausedAt DateTime?`, `User.agentPausedUntil DateTime?` (null = until lifted), `User.agentPauseReason String?`, `User.agentPausedByUserId String? @db.Uuid` (no relation needed).
- Active ⇔ `agentPausedAt != null && (agentPausedUntil == null || agentPausedUntil > now)`. Expiry is evaluated on read; no job. Resume clears all four fields.
- History lives in `AdminAuditEvent` (`AGENT_PAUSED` with `metadata: { duration, until }`, `AGENT_RESUMED`).
- One helper, `getActiveAgentPause(user, now) → { until: Date | null, reason } | null`, used everywhere.

### Server

- `POST /admin/users/:userId/agent-pause` — `{ duration: "1h"|"24h"|"7d"|"indefinite", reason }` → `{ user }`.
- `POST /admin/users/:userId/agent-resume` → `{ user }`. Resuming a user who isn't paused is a no-op success.
- **Enforcement:** a `requireAgentNotPaused` middleware mounted in `app.ts` on `POST /agencies/:agencyId/agent/threads/:id/messages` and `POST .../images`, **before** `agentMessageBurst`/`agentMessageDaily`/`agencyAgentMessageDaily`/`agentImageUpload`, so a blocked attempt does not consume quota. It responds `403 AGENT_PAUSED` with `{ error: { code, message, until, reason } }`. The same check guards any other route that starts an agent run (verify during planning: thread create-with-first-message, personal routes if they reach the agent).
- `serializeUser` (`authRoutes.ts`, used by `/auth/me`) adds `agentPause: { until, reason } | null`. `requireAuth`'s user `select` gains the four fields.
- Team list for the agency (`teamRepository`/team routes, visible to OWNER/ADMIN) adds `agentPause` per member. STAFF viewers do not get other members' reasons.
- Admin account summary/detail and Usage user rows include `agentPause`.

### Client

- `AgentPausedModal.jsx` (on `ui/Modal`): icon, "The agent is paused for your account", "until <local date/time> (in <relative>)" or "until an administrator lifts it", the reason, "You can still view and edit itineraries and trips by hand.", single `Got it` button.
  - Opens when the user opens/enters the agent chat surface while `user.agentPause` is active, at most once per page load per pause (keyed by `agentPausedAt`/`until`).
  - Opens whenever a send or image upload returns `AGENT_PAUSED` (and updates the cached `user.agentPause` from the error body).
- **Locked composer:** while paused the composer input and send are disabled and replaced by a strip: lock icon, "Agent paused until <date>", `Why?` reopens the modal. When `until` passes, the client unlocks on the next `/auth/me` refresh or the next send attempt; a timer re-enables it at `until` if the page is open.
- **Admin:** `Pause agent` / `Resume agent` in the account panel actions footer and the Usage drill-in. `PauseAgentDialog.jsx`: duration chips (1 hour · 24 hours · 7 days · Until I lift it), required reason, shows the user's spend this month for context. Accounts table and Usage user rows show an `Agent paused` pill.
- **Owner/Admin view:** in Agency › Team, a warning badge "Agent paused until <date>" (or "Agent paused") on that member, with the reason in a tooltip/tap popover. No controls to lift it.

---

## Error codes (new)

`CANNOT_ACT_ON_SELF` 403 · `CANNOT_ACT_ON_SUPER_ADMIN` 403 · `ACCOUNT_DELETED` 409 · `EMAIL_CONFIRMATION_MISMATCH` 400 · `NEW_OWNER_REQUIRED` 400 · `INVALID_NEW_OWNER` 400 · `OWNER_HAS_NO_SUCCESSOR` 409 · `MULTIPLE_OWNED_AGENCIES` 409 · `AGENT_PAUSED` 403.

Client copy for each lives with the dialog that triggers it; raw codes are never shown.

## Testing

**Server (vitest, service-level with fake repositories, matching `accountService` tests):**
- Disable/enable/sign-out: status and session effects, audit rows, no-op cases, all three guards.
- Delete: identity scrubbed exactly as listed, sessions/provider/tokens/memberships gone, trips/itineraries/threads kept, pending invitations revoked; email mismatch; owner with successors (required, invalid, success with transfer audit); solo owner 409; multiple owned agencies 409.
- Usage: failed-run usage counted; thinking tokens priced; unpriced model → null cost + `unpricedModels`; zero-filled series; previous-period and projection math; role tags (owner, staff, personal, multi-agency); chat grouping; runs drill-in requires exactly one filter.
- Agent pause: active / expired / indefinite / resumed; middleware returns 403 before the quota limiter increments; `/auth/me` exposes `agentPause`; team list shows it to OWNER/ADMIN only.
- Route tests: non-super-admin gets 403 on every new admin route; strict schemas reject unknown fields.

**Client (vitest + Testing Library; mock `icons/index.js` per existing convention):**
- `DeleteAccountDialog`: three states, confirm gating, server error shown.
- `AccountDetail`: footer hidden for self / Super Admin / deleted; audit trail renders.
- `UsageSection`: range switch refetches; unpriced banner; table group toggle; drill-in opens and expands a run.
- `AgentPausedModal` + locked composer: opens on load when paused, once per load; opens on `AGENT_PAUSED` response; unlocks after `until`.
- Team badge visible for OWNER/ADMIN.

## Out of scope

Automatic budget or abuse blocking; admin-editable message quotas; usage alerts/emails; pre-aggregated rollup tables; backfilling pre-metering runs; an admin "delete agency" action; resend verification from admin; pagination on `/admin/users` (still a known gap).

## Rollout

Each part is deployable alone; server before client for each part (new fields are optional on the client). Every part carries a Prisma migration (Part 1: status/deletedAt/audit actions; Part 2: `AgentRun.costComplete` and any index; Part 3: pause fields/audit actions); apply them before deploying that server build. Production still runs the older `origin/main`, so these ride the normal staging → main promotion.
