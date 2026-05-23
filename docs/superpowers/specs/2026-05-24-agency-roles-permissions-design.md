# Agency Roles and Permissions Design

## Context

Voyage already has the schema to model many users per agency (`AgencyMembership` with roles `OWNER | ADMIN | STAFF`). What it does not yet have is real enforcement: today the only role gate in code is "only OWNER can edit agency settings". Every other action — viewing all trips, running the agent, creating itineraries — accepts any active member regardless of role.

This spec defines how the three agency roles actually differ across the product, how the UI surfaces those differences, and how the platform-level admin (currently `User.role.ADMIN`) is renamed to `SUPER_ADMIN` to remove conflation with the agency-level admin.

A follow-up direction, **personal user accounts** (a disjoint account type that lives outside any agency), came up during brainstorming and is captured at the bottom under Future Work. That work is intentionally not in this spec.

## Goals

- Differentiate OWNER, ADMIN, and STAFF across both **admin actions** (settings, invites, role changes) and **data visibility** (which trips a user can see).
- Rename `UserRole.ADMIN` to `SUPER_ADMIN` to disambiguate from agency-level admin.
- Give STAFF a focused workspace scoped to trips they organize, while letting them still see the team (for asking who to escalate to).
- Reserve a small set of destructive / financial actions for OWNER only.
- Make permission errors actionable, not dead ends.

## Non-Goals

- Detailed contents of the agency dashboard (team activity widgets, pipeline counters, share stats, client list) — that is its own follow-up spec.
- Billing / Stripe integration — the OWNER-only "Manage billing" entry is reserved in the UI but not implemented here.
- Multi-organizer trips. Trips keep a single `assignedOrganizerUserId`; collaboration between multiple STAFF on one trip is out of scope.
- Invitation / join flow detail (magic links, accept page UX, email templates). Spec defines *who* can invite; the *how* is a follow-up.
- The "personal account" / B2C surface — covered in Future Work, deferred to its own spec.

## Glossary and Types

### Platform-level roles (on `User.role`)

- `USER` — default for every signup.
- `SUPER_ADMIN` — Voyage staff. Approves, rejects, and suspends agency registrations. Writes to `AdminAuditEvent`. Has no implicit access to any agency's data; moderation lives in a separate surface.

This is a rename of the existing `ADMIN` value. All existing rows (small number — only platform admins) migrate in the same change.

### Agency-level roles (on `AgencyMembership.role`, unchanged enum)

- `OWNER` — exactly one per agency, enforced by `Agency.ownerUserId`. Holds destructive and financial rights.
- `ADMIN` — elevated rights within one agency. Manages team and edits settings. Has no power outside this agency.
- `STAFF` — regular staff. Data visibility scoped to trips where they are the assigned organizer.

The two "admin" concepts are intentionally namespaced apart now: `SUPER_ADMIN` (a user-level role) vs `MembershipRole.ADMIN` (a per-agency role).

## Permission Matrix

| Action | OWNER | ADMIN | STAFF |
|---|---|---|---|
| **Trips** | | | |
| List all trips in agency | yes | yes | own only* |
| View trip detail | yes | yes | own only |
| Create trip | yes | yes | yes (organizer auto-set to self) |
| Edit trip details | yes | yes | own only |
| Reassign organizer | yes | yes | no |
| Archive trip | yes | yes | own only |
| **Itineraries** | follows trip visibility | follows trip visibility | follows trip visibility |
| **Agent threads** | | | |
| Thread with `tripId` set | follows trip visibility | follows trip visibility | follows trip visibility |
| Thread with `tripId = null` | yes (all) | yes (all) | own only (created by self) |
| **Team management** | | | |
| List members | yes | yes | yes (read-only) |
| Invite member (any role except OWNER) | yes | yes | no |
| Remove member (non-OWNER) | yes | yes | no |
| Change member role (within ADMIN/STAFF) | yes | yes | no |
| Promote member to OWNER | only via Transfer Ownership | no | no |
| **Settings** | | | |
| Edit agency profile (name, phone, etc.) | yes | yes | no |
| Upload agency logo | yes | yes | no |
| **Owner-only (destructive / financial)** | | | |
| Transfer ownership | yes | no | no |
| Delete agency | yes | no | no |
| Manage billing (reserved, future) | yes | no | no |

*"own only" means rows where `assignedOrganizerUserId === user.id`.

## Schema Changes

Minimal, targeted at the policy above.

1. `UserRole` enum: rename `ADMIN` to `SUPER_ADMIN`. A Prisma migration renames the enum value and updates existing rows.
2. No new tables. `AgencyMembership` already has the role enum. `ClientTrip.assignedOrganizerUserId` already exists and is the visibility key for STAFF.

## Server Enforcement

Add a layer above the existing `agencyAccessService.requireVerifiedAgencyMember`:

- `requireAgencyOwner(user, agencyId)` — passes only if membership role is OWNER.
- `requireAgencyAdmin(user, agencyId)` — passes for OWNER or ADMIN.
- `requireAgencyMember(user, agencyId)` — passes for any active member (existing behavior).
- `requireTripAccess(user, agencyId, tripId)` — passes for OWNER, ADMIN, or the assigned STAFF organizer of the trip. Returns 404 for STAFF probing trips they do not organize (not 403 — see Error UX).

These compose. Each route picks the tightest gate that fits its action. The matrix above is the source of truth.

OWNER protection rules enforced server-side:
- Membership for the OWNER user cannot be removed, disabled, or have its role changed via the normal team-management routes. The only way to change who is OWNER is the Transfer Ownership flow.
- Transfer Ownership atomically updates `Agency.ownerUserId` and both memberships (old OWNER becomes ADMIN, new OWNER takes the role).

## UI Shape

Follows the "Hybrid: nav-shaped + transparent member list" approach chosen during brainstorming.

### Route surface

- `/agency/[agencyId]/trip/...` — existing.
- `/agency/[agencyId]/agent/...` — existing.
- `/agency/[agencyId]/team` — new. Member list, invites.
- `/agency/[agencyId]/settings` — new. Agency profile. *Danger zone* card visible only to OWNER.

### Sidebar / navigation per role

- STAFF: *My Trips*, *Agent*, *Team* (read-only).
- ADMIN: *Trips*, *Agent*, *Team*, *Settings*.
- OWNER: same nav as ADMIN; *Danger zone* card appears inside Settings.

The nav itself adapts — STAFF does not see *Settings* at all. The Team page is visible to all roles so STAFF can see who to ask about elevated actions.

### Team page

Each member row: avatar, name, email, role pill, joined-at date.

- For ADMIN and OWNER: a `…` menu with *Change role* (within ADMIN/STAFF) and *Remove*.
- For STAFF viewers: no menu, rows are read-only.
- The OWNER row shows a small "Owner" badge in a muted, border-only style. It is never selectable. Changing the OWNER requires the explicit Transfer Ownership flow from Settings → Danger zone.

### Visual treatment

- Role pills use opacity and uppercase letter-spacing instead of strong background colors. Keeps the list calm.
- The OWNER pill picks up a faint accent — border-only, no fill.
- The *Danger zone* card uses muted destructive color, not bright red. Destructive buttons require typed confirmation (e.g., "type AGENCY_NAME to delete").
- Empty states render a single-line message with the name of the person to ask. No 403 page chrome.

## Error UX

A STAFF user navigating to `/agency/[id]/trip/<trip-they-do-not-organize>`:

- Server returns **404**, not 403. This prevents STAFF from enumerating organizer assignments by probing URLs.
- Client renders a soft empty state: *"This trip isn't on your list. Ask [Owner Name] if you should be assigned."* with a mailto link to the owner.

A STAFF user navigating to `/agency/[id]/settings`:

- Server returns **403** with error code `AGENCY_ADMIN_REQUIRED`.
- Client redirects to `/agency/[id]/team` with a one-time inline notice: *"Settings are managed by your owner and admins."*

An ADMIN attempting to demote or remove the OWNER:

- Server returns **403** with error code `OWNER_PROTECTED`.
- Client surfaces inline: *"The owner can only be changed via Transfer Ownership."*

Any active member trying an action above their role on a route they can reach:

- Server returns **403** with a descriptive error code (e.g., `AGENCY_OWNER_REQUIRED`).
- Client surfaces inline near the action — no full-page error.

## Testing Strategy

Permission gates are the riskiest layer. Silent leaks are very bad. Tests:

1. **Repository-level** — `findAgencyAccess(userId, agencyId)` returns nothing for non-members; returns the right membership and role for members.
2. **Service-level** — for each role × each action in the permission matrix, one happy-path test (allowed) and one forbidden-path test (denied with the correct error code). The matrix becomes a test fixture so adding a new action forces a test row.
3. **Route-level integration** — STAFF hitting Settings returns 403. STAFF probing another organizer's trip returns 404 (not 403). ADMIN attempting to demote OWNER returns 403 with `OWNER_PROTECTED`. Transfer Ownership atomically updates both memberships.
4. **Client** — navigation tree rendering tests per role (STAFF does not see *Settings*). Read-only Team page renders for STAFF without action buttons.

## Migration and Rollout

1. Prisma migration: rename `UserRole.ADMIN` to `SUPER_ADMIN`. Data migration updates any existing rows. Code references to `UserRole.ADMIN` are renamed in the same change.
2. Add the new `require*` server helpers and wire them into trip, itinerary, agent-thread, settings, and team routes.
3. Add the `/agency/[agencyId]/team` and `/agency/[agencyId]/settings` routes on the client.
4. Update the sidebar to read membership role and render the right tree.
5. No downtime expected. The schema change is a value rename; behavior changes are additive.

## Future Work (Out of Scope)

Captured here so the brainstorm decisions are not lost. Each becomes its own spec.

### Spec B — Personal account type (next planned spec)

- Add `User.accountType: PERSONAL | AGENCY_USER`, set at signup, immutable.
- Disjoint account types: one login is either personal or agency-affiliated, never both. No conversion path. To switch, the user makes a new account with a different email.
- Signup flow forks: "Plan your own trips" → PERSONAL; "Set up an agency" or "Join via invite" → AGENCY_USER.
- Personal users get the full agent. They do not get a client-trip wrapper, team, internal review workflow, or agency dashboard. Their shared itineraries are branded with their own name and avatar instead of an agency logo.
- Schema change: `agencyId` becomes nullable on `Itinerary`, `AgentThread`, and `ItineraryShare`. `ClientTrip` stays agency-only.
- Cross-domain actions are blocked with clear errors (e.g., a personal user attempting to accept an agency invite gets a specific message about creating a separate account).

### Agency dashboard contents

A dedicated page that helps an owner actually run and improve the agency. Likely widgets: team activity, trip pipeline by status, shared-itinerary view and comment stats, client list derived from `clientName` + `clientEmail` across trips. Designed separately because each widget has its own data and design decisions.

### Billing

Stripe integration on the OWNER-only Settings tab. Role design already reserves the entry; implementation is its own work.

### Multi-organizer trips

A `TripAssignment` join table if/when multiple STAFF need to collaborate on one trip. Not needed for the single-organizer model decided in this spec.

### Invitation / join flow detail

Magic-link emails, accept-invite page, signup-via-invite UX, invite expiry. This spec defines *who* can invite; the *how* is a follow-up.
