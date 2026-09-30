# Personal Account Type Design

## Context

Voyage today is an agency-only product. Every signup creates an agency; every itinerary, agent thread, and share belongs to an agency. Spec A (agency roles and permissions) refined the agency-internal experience but kept that single-shape assumption.

Spec B introduces a second account type: **personal users** who plan their own travel. A personal user gets the same agent capability as agency staff but lives outside any agency — no client-trip wrapper, no team, no review workflow, no agency dashboard. Their shared itineraries are branded with their own name.

The personal and agency surfaces are **disjoint**: one email is either personal or agency-affiliated, never both. There is no conversion path; switching means a new account.

This spec is the follow-up to Spec A that was captured in that spec's Future Work section. Many decisions are carried forward unchanged from that brainstorm; this spec pins down the remaining UX, schema, and migration details.

## Goals

- Let a new user choose at signup between *planning their own trips* and *running an agency*.
- Keep the two paths fully separated in the data and in the UI.
- Reuse the existing dashboard shell for personal users with agency-only entries hidden, rather than building a parallel UI.
- Migrate existing users into the new account-type column with a clear rule and no data loss.

## Non-Goals

- **Agency invitation by magic link.** Personal users who receive an existing invite token are blocked with a clear error; no new email-invite flow is added.
- **Conversion between account types.** Disjoint, no carry-over.
- **Personal user billing or usage quotas.** Personal gets the full agent for now.
- **Custom branding for personal shares beyond display name.** No personal logo, no custom colors. Display name only, no avatar — future enhancement if needed.
- **Multi-account / agency switcher for users in many agencies.** Out of scope; existing single-agency assumption holds.

## Glossary and Invariants

### Account type values

`User.accountType` enum:

- `PENDING` — newly registered, has not yet picked a path. Cannot use any product feature beyond setting their account type.
- `PERSONAL` — plans their own trips. Cannot have any `AgencyMembership`. Cannot create or join an agency.
- `AGENCY_USER` — belongs to (or is creating) an agency. Cannot own personal-scope itineraries or threads.

### Invariants enforced server-side

- A new user starts `PENDING`. The value is set to `PERSONAL` or `AGENCY_USER` via the signup wizard's Step 1.5, after which it is **immutable**.
- A user with `accountType !== PERSONAL` cannot have an `Itinerary`, `AgentThread`, or `ItineraryShare` row with `agencyId IS NULL` and `createdByUserId === self`.
- A user with `accountType !== AGENCY_USER` cannot have any `AgencyMembership` row.
- These rules are enforced in the service layer at every mutation. There is no DB-level CHECK constraint — the application is the source of truth.

## Schema Changes

A single migration adds the enum and column, makes three columns nullable, and backfills existing rows. All in one transaction.

1. **New enum** `UserAccountType` with values `PENDING`, `PERSONAL`, `AGENCY_USER`.
2. **New column** `User.accountType` of type `UserAccountType`, `NOT NULL`, default `'PENDING'`. Default ensures the column is non-null from insert; the application sets the real value at Step 1.5.
3. **Make nullable**:
   - `Itinerary.agencyId` (`String? @db.Uuid`)
   - `AgentThread.agencyId` (`String? @db.Uuid`)
   - `ItineraryShare.agencyId` (`String? @db.Uuid`)
4. **`ClientTrip.agencyId` stays required.** ClientTrip is an agency-only wrapper.
5. **Backfill rule**, applied in the same migration via SQL `UPDATE`:
   - Users with at least one `AgencyMembership` row → `AGENCY_USER`.
   - All other users → `PERSONAL`.
   - SUPER_ADMINs without memberships also land on `PERSONAL`. Their administrative access remains gated by `User.role = SUPER_ADMIN` independent of account type.

## Signup Wizard Fork

The existing two-step `RegisterWizard.jsx` becomes three steps. The third (agency details) is only visited by users who choose the agency path.

### Step 1 — Account details (existing)

Email, password, display name. On submit, calls `POST /auth/register`. The server creates a `User` with `accountType: 'PENDING'`. Session is established.

### Step 1.5 — Account type picker (new)

Two cards, no form fields:

- **"Plan my own trips"** — calls `POST /auth/me/account-type` with `{ accountType: "PERSONAL" }`. Server commits the value. Wizard ends. User lands on the personal HomePage.
- **"Set up an agency"** — moves to Step 2. The Step 2 submit (`POST /agencies`) sets `accountType` to `AGENCY_USER` as a side effect of creating the user's first agency.

### Step 2 — Agency details (existing)

Agency name, country, city. Submits `POST /agencies`. Unchanged in shape; the server-side handler gains the side effect described above.

### OAuth users

OAuth callbacks today land at `/login?step=agency` because the user is already registered. For Spec B, OAuth lands at `/login?step=type-picker` (Step 1.5). The OAuth-created user has `accountType: 'PENDING'` like email signups.

### PENDING guard

A user who closes the tab between Step 1 and Step 1.5 has a `PENDING` account. On next login, the auth shell checks `user.accountType === 'PENDING'` and renders Step 1.5 instead of HomePage. Any attempt to call a product route while `PENDING` returns 403 `ACCOUNT_TYPE_PENDING`, which the client intercepts to force the picker.

## Server Routes and Gates

### New endpoint

- `POST /auth/me/account-type` — accepts `{ accountType: "PERSONAL" | "AGENCY_USER" }`. Commits the value if current is `PENDING`. Returns `409 ACCOUNT_TYPE_ALREADY_SET` if already committed.

### Modified endpoint

- `POST /agencies` — gains a side effect: if caller's `accountType === 'PENDING'`, set it to `AGENCY_USER`. If caller is `PERSONAL`, reject with `403 ACCOUNT_TYPE_FORBIDS_AGENCY`.

### New personal-scope routes (mounted under `/me`)

- `GET /me/itineraries` — list itineraries with `agencyId IS NULL AND createdByUserId = caller.id`.
- `POST /me/itineraries` — create a personal itinerary.
- `GET /me/itineraries/:itineraryId` — fetch one, scoped to caller.
- `PATCH /me/itineraries/:itineraryId` — update, scoped to caller.
- `DELETE /me/itineraries/:itineraryId` — delete, scoped to caller.
- `GET /me/agent/threads` — list personal agent threads.
- `POST /me/agent/threads` — create personal thread.
- `POST /me/agent/threads/:threadId/messages` — send a message in a personal thread (existing agent orchestrator runs with `agencyId: null`).
- `GET /me/shares` — list personal-user shares.
- `POST /me/itineraries/:itineraryId/shares` — create a personal share.

### New middleware

- `requirePersonalAccount(user)` — passes only if `user.accountType === 'PERSONAL'`. Used on all `/me/...` routes. Returns `403 ACCOUNT_TYPE_FORBIDS_PERSONAL` otherwise (or `403 ACCOUNT_TYPE_PENDING` if caller is PENDING).

### Existing middleware

- `requireVerifiedAgencyMember` — unchanged. Naturally rejects `PERSONAL` users because they have no memberships, but to give a clearer error code, add an early-return when `user.accountType === 'PERSONAL'` that throws `403 ACCOUNT_TYPE_FORBIDS_AGENCY`.

### Agent orchestrator

The existing `agentOrchestrator` accepts `agencyId` as input. Extend it to accept `agencyId: null`. When null:
- `AgentThread` rows are created with `agencyId: null`, `tripId: null`, `createdByUserId: caller.id`.
- Tool gates that depend on agency context (e.g., place lookups against agency-scoped data) operate without scope.
- No change to model selection or tool list.

## Client Surfaces

### HomePage role-aware shell

`HomePage.jsx` and `DashboardSidebar.jsx` switch behavior on `user.accountType`.

**PERSONAL user sees:**

- *Command Center* — same component, talks to `/me/agent/threads`.
- *Itineraries* — same list component, talks to `/me/itineraries`.
- *Settings* — slimmer "My account" view: display name, email, password. No agency profile section.

**PERSONAL user does NOT see:**

- *Team* tab (agency-only).
- *Admin* tab (only for SUPER_ADMIN; orthogonal).
- The agency profile section inside Settings.
- The Danger Zone in Settings (no agency to delete).

**AGENCY_USER user:** existing behavior from Spec A, unchanged.

### Itinerary list data source

The existing list component is fed by a hook that today calls `/agencies/:id/itineraries`. The hook gains a branch: if `user.accountType === 'PERSONAL'`, call `/me/itineraries`. Render path is identical.

### Public share view branding

`/shared/:token` renders the share recipient view. Today this view shows the agency name and (optionally) logo. Change:

- If `share.agencyId !== null`: render current agency branding (no change).
- If `share.agencyId === null`: render *"Shared by {displayName}"* with no avatar. The recipient sees no Voyage chrome beyond the existing layout — just the itinerary and the sender's name.

### Wizard

`RegisterWizard.jsx` gains the Step 1.5 picker as described above. The existing `wizardStep` state extends from `{1, 2}` to `{1, "type", 2}`. The `WizardProgress` indicator gains a third pip.

## Error UX

| Caller | Route | Result | Client behavior |
|---|---|---|---|
| `PENDING` | any `/me/...`, any `/agencies/.../...` | `403 ACCOUNT_TYPE_PENDING` | Intercepted globally; redirect to Step 1.5 picker. |
| `PERSONAL` | `POST /agencies` or accepting an agency invite | `403 ACCOUNT_TYPE_FORBIDS_AGENCY` | Full-page message: *"This action is for agency users. To run an agency, create a separate account with a different email."* |
| `AGENCY_USER` | `POST /me/itineraries` (or other `/me` routes) | `403 ACCOUNT_TYPE_FORBIDS_PERSONAL` | Inline error; should never occur from the UI (defensive). |
| `PERSONAL` | `POST /auth/me/account-type` after already committed | `409 ACCOUNT_TYPE_ALREADY_SET` | Inline error: *"Your account type has already been set."* (Shouldn't be reachable from a clean wizard flow; defensive.) |

## Testing Strategy

### Server

- **Repository:** backfill SQL idempotency (running twice does not duplicate or change committed values).
- **Service:** `setAccountType(user, value)` commits only when PENDING; rejects when already set. `createAgencyApplication` flips PENDING → AGENCY_USER. `createPersonalItinerary` rejects non-PERSONAL callers. Personal itinerary CRUD scoped to `createdByUserId`.
- **Routes:**
  - `POST /agencies` from PERSONAL → 403 `ACCOUNT_TYPE_FORBIDS_AGENCY`.
  - `POST /me/itineraries` from AGENCY_USER → 403 `ACCOUNT_TYPE_FORBIDS_PERSONAL`.
  - `POST /auth/me/account-type` happy path; double-commit rejection.
  - `GET /shared/:token` with null `agencyId` returns display-name branding fields; with set `agencyId` returns agency branding.
- **Agent orchestrator:** runs end-to-end with `agencyId: null`, persists thread with null agencyId.

### Client

- Wizard renders the type picker at the right step.
- PENDING user is redirected to Step 1.5 on next login.
- PERSONAL user sees no Team / Admin / agency-profile entries.
- AGENCY_USER user retains existing tabs.
- Public share view branches branding correctly on null vs set `agencyId`.

## Migration and Rollout

Single migration (`20260526000000_personal_account_type`) handles everything atomically:

```sql
-- 1. Create the enum
CREATE TYPE "UserAccountType" AS ENUM ('PENDING', 'PERSONAL', 'AGENCY_USER');

-- 2. Add the column with default
ALTER TABLE "User" ADD COLUMN "accountType" "UserAccountType" NOT NULL DEFAULT 'PENDING';

-- 3. Backfill existing rows
UPDATE "User" SET "accountType" = 'AGENCY_USER'
WHERE id IN (SELECT DISTINCT "userId" FROM "AgencyMembership");

UPDATE "User" SET "accountType" = 'PERSONAL'
WHERE "accountType" = 'PENDING';

-- 4. Make agencyId nullable on three tables
ALTER TABLE "Itinerary" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "AgentThread" ALTER COLUMN "agencyId" DROP NOT NULL;
ALTER TABLE "ItineraryShare" ALTER COLUMN "agencyId" DROP NOT NULL;
```

Rollout order:

1. Apply the migration. Existing users get correct accountType; new columns become nullable. Zero downtime.
2. Deploy server code with the new endpoints, gates, and side effects.
3. Deploy client code with the new wizard step and role-aware shell.

No backwards-incompatible changes for AGENCY_USER paths — all existing routes keep working as today.

## Future Work (Out of Scope)

Captured here so the brainstorm decisions are not lost.

- **Magic-link email invitations** for agencies (already deferred from Spec A).
- **Billing / quotas for personal users** (premium tier, limits on agent runs, etc.).
- **Custom branding for personal shares beyond display name** — logo, theme color, custom URL.
- **Multi-account / agency switcher** for users who belong to multiple agencies (currently a single-agency assumption holds).
- **Agency dashboard contents** (still deferred from Spec A).
