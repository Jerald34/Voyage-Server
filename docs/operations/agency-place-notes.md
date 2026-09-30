# Seeding agency place notes

`AgencyPlaceNote` rows are the staff-authored signal the place freshness gate
uses to block or advise on a place beyond what the map provider itself
reports (see `docs/superpowers/specs/2026-08-16-place-freshness-gate-design.md`
§3-4). There is no notes-authoring UI yet, so notes are loaded with a
file-driven CLI:

```
scripts/seed-agency-place-notes.ts
```

run via:

```powershell
npm run seed:place-notes -- --file .\notes.json --dry-run
npm run seed:place-notes -- --file .\notes.json
```

`npm run` requires the extra `--` before the script's own flags, otherwise
npm swallows them.

## Flags

| Flag | Required | Meaning |
|---|---|---|
| `--file <path>` | **Yes** | JSON file to seed from. There is no default file — a bare invocation with no `--file` always fails, so a forgotten flag can never seed the wrong data. |
| `--dry-run` | No | Validates the file (schema shape, agency exists, author is a member, no ambiguous unresolved matches) and prints counts of what *would* be created/updated. Writes nothing. |

The command always prints the file it read, the target agency/author IDs,
a resolved/unresolved breakdown, and the target **host and database name it
is about to touch** — for example:

```
File:    C:\ops\notes.json
Agency:  6f6b1e3a-2c1e-4b3e-8a41-8f0d6a2b9d10
Author:  a3d9e421-9d6d-4c60-8a4b-1f0b1f6d9a4a
Notes:   3 total (2 resolved, 1 unresolved)
Target:  db.internal.example.com / voyage_production
Mode:    dry run — validates against the database above but writes nothing
```

It never prints the database username, password, or the full connection
string — only the hostname and database name parsed out of `DATABASE_URL`.
Always read the `Target:` line before confirming a live (non-dry-run) run;
it is the only thing standing between a staging file and a production
database, since the command does not otherwise know or care which
environment it has been pointed at.

**Running this against a production database is a separate operator action
that requires its own authorization.** This command applies whatever
`DATABASE_URL` is configured in the environment it runs in; it does not ask
for confirmation beyond what `--dry-run` gives you, and it is not part of
any deployment or release pipeline. Nothing in this plan or repository
authorizes pointing it at a shared/production database — that decision, and
the notes content itself, belong to whoever operates the agency's data.

## File shape

```json
{
  "agencyId": "6f6b1e3a-2c1e-4b3e-8a41-8f0d6a2b9d10",
  "createdByUserId": "a3d9e421-9d6d-4c60-8a4b-1f0b1f6d9a4a",
  "notes": [
    {
      "provider": "GOOGLE_MAPS",
      "providerPlaceId": "ChIJ_fictional_place_id_0001",
      "placeName": "Old Fort Lookout",
      "cityContext": "Manila",
      "status": "PREFERRED",
      "note": "Guides confirm this is safe and scenic at sunset."
    },
    {
      "provider": null,
      "providerPlaceId": null,
      "placeName": "Bayview Grill",
      "cityContext": "Cebu",
      "status": "CLOSED",
      "note": "Permanently shuttered per the owner as of last visit; not yet in the map provider's data."
    },
    {
      "provider": null,
      "providerPlaceId": null,
      "placeName": "Generic Souvenir Stand",
      "cityContext": null,
      "status": "AVOID",
      "note": "Frequent overcharging complaints across every branch, regardless of city."
    }
  ]
}
```

Top level:

- `agencyId` — UUID of the agency these notes belong to.
- `createdByUserId` — UUID of the user recorded as the author. **This user
  must already hold a membership in `agencyId`** (any role); the seed
  rejects the whole file otherwise, including when that user is a member of
  a *different* agency only.
- `notes` — up to 1000 rows.

Each row:

- `provider` / `providerPlaceId` — **both set, or both `null`.** A row with
  only one of the two set fails schema validation before anything is
  written.
  - Both set (a "resolved" or "known-ID" note): pins the note to a specific
    place the map provider already resolved (`provider` is `"GOOGLE_MAPS"`
    or `"NOMINATIM"`, `providerPlaceId` is that provider's place ID). These
    are matched and upserted by the exact `(agencyId, provider,
    providerPlaceId)` combination, so re-running the same file only ever
    updates that one row — it never creates a duplicate.
  - Both `null` (an "unresolved" note): describes a place by name only,
    for places the agency wants to flag before (or without) a provider ID
    ever being resolved for it. These are matched by exact, normalized
    (trimmed + lowercased) `placeName` and `cityContext` against other
    unresolved notes for the same agency. If more than one existing
    unresolved note matches, the seed **rejects that row** rather than
    guessing which one to update — resolve the duplicate by hand first.
- `placeName` — required, non-empty after trimming (max 500 characters).
- `cityContext` — the city the note applies to, or `null`.
  - **`cityContext: null` makes an unresolved note agency-global** — it
    matches that place name anywhere the agency operates, not just one
    city. A city-scoped candidate does not fall back to a global note of a
    *different* city; it only matches a global note when there truly is no
    city-specific one.
  - This only affects unresolved (name-based) matching. A resolved
    (known-ID) note's `cityContext` is informational only; a provider ID
    match is authoritative regardless of the city tag on record.
- `status` — one of `AVOID`, `CLOSED`, `PREFERRED`, `NEUTRAL`. `CLOSED` and
  `AVOID` block the place from new attachments; `PREFERRED` is advisory
  only; `NEUTRAL` records context without changing eligibility.
- `note` — free-text staff note, or `null`. Max 2000 characters after
  trimming. This text is internal/staff-only; it is never shown to public
  share/PDF views.

## Idempotency and validation order

1. The whole file is validated against the schema above before any database
   access, including under `--dry-run`.
2. The target agency and the author's membership in it are checked next.
   Everything else in the file is rejected as a whole if either check fails
   — there is no partial application.
3. Each row is then applied: known-ID rows upsert on their compound unique
   key; unresolved rows update the single matching existing note or create
   a new one. Re-running the exact same file is safe and produces the same
   end state (an "update" the second time instead of a duplicate "create").

This is a serial operator command intended for occasional batch loads, not
a concurrent API — there is no per-row locking beyond running the whole
batch in one transaction.
