# Place Freshness Gate & Agency Place Notes — Design

**Date:** 2026-08-16
**Revised:** 2026-09-06 after branch review
**Status:** Revised for implementation planning; implementation awaits the user's plan review.
**Scope:** Voyage-Server and corresponding Voyage-Client status presentation. Server support lands before client rollout.
**Plan:** [2026-09-06-place-freshness-gate-implementation.md](../plans/2026-09-06-place-freshness-gate-implementation.md)

## 1. Problem and guarantee

Google can report closures, but our four place-result masks omit businessStatus. Name/city snapshot lookups also reuse records indefinitely. Agency staff have no deterministic way to exclude a known unsuitable place.

**Guarantee:** a place known to be permanently closed, or blocked by the current agency's successfully loaded notes, cannot be returned as a usable candidate or newly attached to an itinerary. Provider results, cache hits, supplied snapshot IDs, and existing rated-history insertions are covered. Names/reasons may appear as explanations or historical context; blocked places are not offered as usable alternatives.

Unknown means unverified, not verified open. Thirty days is a refresh-eligibility interval, not a real-time guarantee or a promise to refresh unopened trips. Provider errors and explicitly reported notes-loading failures can leave information unverified.

Google's businessStatus is a Pro field. Existing masks already request Pro-or-higher fields, so adding it does not itself increase those requests' SKU. TTL misses and revalidation add requests and need a bounded budget. [Google field table](https://developers.google.com/maps/documentation/places/web-service/data-fields)

## 2. Goals and scope

- One reusable eligibility policy at tool-output and itinerary-attachment boundaries.
- Persist provider closure observations even when candidates are blocked.
- Agency AVOID/CLOSED overrides eligibility within that agency only.
- Preserve saved work and show warnings; staff choose replacements.
- Put variable advisories in user runtime context; preserve Gemini system-instruction caching.
- Bound extra status requests and suppress duplicate refreshes.

Included: agency creation/add/change, direct full-draft replacement, current rated-history insertion, agent place tools, authenticated agency/personal saved-itinerary reads, and client status labels. Personal agent runs load no agency notes but still check provider status. Public shares expose provider status only and never trigger provider calls or expose internal notes.

Excluded: embeddings/RAG, note-management UI, opening-hours scheduling, cron, automatic replacements, and active preferred-ranking changes. Temporary closures are allowed with an advisory. Existing historical photo retrieval is not new selection and needs no extra paid status lookup. Notes ship with a validated command-line seed path.

## 3. Data and observation semantics

Add PlaceBusinessStatus with OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY. Add nullable businessStatus and businessStatusCheckedAt to PlaceSnapshot. Retain fetchedAt for general data freshness.

Add AgencyPlaceNoteStatus with AVOID, CLOSED, PREFERRED, NEUTRAL and the following model:

~~~prisma
model AgencyPlaceNote {
  id              String                @id @default(uuid()) @db.Uuid
  agencyId        String                @db.Uuid
  agency          Agency                @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  provider        PlaceProvider?
  providerPlaceId String?
  placeName       String
  cityContext     String?
  status          AgencyPlaceNoteStatus @default(NEUTRAL)
  note            String?
  createdByUserId String                @db.Uuid
  createdByUser   User                  @relation(fields: [createdByUserId], references: [id])
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  @@unique([agencyId, provider, providerPlaceId])
  @@index([agencyId, cityContext])
  @@index([agencyId, placeName])
}
~~~

Add opposite relations on Agency/User. Provider and ID must both be populated or both be null, enforced in SQL and seed validation. Null IDs permit unresolved notes; evaluate duplicates together and let blocking notes win among equally specific matches.

businessStatusCheckedAt advances only on a successful response containing a recognized status. Timeout, omitted/unrecognized status, enrichment-only writes, and persistence failures cannot advance it or erase a known status. Pre-migration status/time start null. An explicit newer operational or temporary-closure observation can replace a permanent closure. Persist status/time atomically and reject older responses that would overwrite newer observations.

Propagate observations through resolve, details, enrichment, and backfill. Agency verdicts never change global provider fields. Preserve the actual NOMINATIM provider on new writes; historical mislabeled rows with Nominatim metadata are status-unsupported and must not be queried as Google IDs. Do not interpret 404/missing data as closure.

## 4. Policy, matching, and lifecycle

~~~ts
type GateInput = {
  provider?: "GOOGLE_MAPS" | "NOMINATIM";
  providerPlaceId?: string;
  name: string;
  cityContext?: string | null;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | null;
};
type BlockReason = "CLOSED_PERMANENTLY" | "AGENCY_AVOID" | "AGENCY_CLOSED";
type PlaceVerdict =
  | { allowed: true; advisory?: string }
  | { allowed: false; reason: BlockReason; detail: string };
~~~

Normalize provider-result id and resolved/snapshot providerPlaceId into this contract. Normalize names/cities by trimming and lowercasing only.

1. Exact provider + ID within the current agency is authoritative, even with a wrong city tag.
2. Without an ID match, only unresolved notes participate in name fallback. City-specific notes require the same city; missing city does not match them.
3. Null-city unresolved notes are explicitly agency-global. Include matching global and city notes; any AVOID/CLOSED among them blocks.

A note with a different known ID must not match by name. Preferred cannot override Google's permanent closure. Precedence: agency block, provider permanent closure, temporary advisory, preferred advisory, otherwise allow.

createPlaceGate(client, agencyId) loads that agency's notes once. Expose check, order-preserving partition, notesFor(cityContext), and notes availability. The per-run context owns its gate, blocked/advisory explanations, and result cache. Pass it explicitly through execution context; never store mutable agency state on singleton tools. Release references on completion/cancellation. Direct HTTP mutations use an authenticated request-scoped context.

notesFor includes matching-city and global notes for context economy without weakening ID enforcement. Internal note text belongs only in staff/agent views.

## 5. Freshness and request limits

PLACE_SNAPSHOT_TTL_DAYS defaults to 30 for general name/city cache freshness. businessStatusCheckedAt independently controls status checks. A recently enriched Google row with old/null status time is still eligible. Nominatim is allowed with unknown status and skipped by Google status-refresh loops.

Refresh an existing ID with Place Details, not a name search that can change the identity of an existing stop. Accept status even without coordinates. Status-only refresh changes only provider status/time; it does not alter itinerary content, routes, coordinates, photos, version, or approval.

New selections attempt eligible refreshes before deciding. Failure/budget exhaustion retains known closure blocks. Previously unknown/operational candidates may proceed with an unverified advisory under the chosen fail-open policy; agency checks still run. Share in-flight status requests by provider + ID.

### 5.1 Saved reads

After authorized itineraryService.getItinerary reads through findItineraryByAgency, schedule background refresh and return immediately. Apply the equivalent behavior after authorized personal single-itinerary reads. Do not trigger from addDay/updateDay transactions, list endpoints, or public shares.

Each read considers distinct eligible Google snapshots oldest-check-first, up to 10 refreshes, with shared process concurrency 3. Failed or absent-status responses receive a 5-minute retry cooldown without changing status time. Use a process-wide rolling cap of 120 extra status requests/hour and a cap of 20 extra status requests per agent run. Existing regular tool quotas remain separate. The status worker performs no photo/enrichment calls.

These are process limits, not a cluster-wide monetary cap. Record attempted/succeeded/failed/unsupported/deduplicated/budget-skipped counts without internal notes or credentials. Expire in-flight/cooldown/budget bookkeeping. Restart may reset these limits; global multi-instance budgeting is outside this release.

**Visibility:** each successfully refreshed item appears updated on a subsequent read after its refresh completes. Limits/retries can defer remaining items until later reads. There is no unconditional second-load guarantee, whole-trip deadline, automatic polling, or new scheduler.

## 6. New selections and saved work

Persist provider observations before excluding candidates. Search tools return allowed results plus minimal blocked explanations. Single-place and itinerary mutation tools return a recoverable PLACE_BLOCKED result. A blocked bulk selection rejects atomically; never silently delete it or save it as an unresolved text-only stop.

Create/add/rated-history copies treat every supplied place as new. Patches changing place identity are new selections. Non-place edits or movement preserve an existing stop even when closed. Full replacement preserves at most the existing count of each unchanged snapshot ID in the same authorized target itinerary; added occurrences and changed identities are new. Calculate this exemption from stored data, never a caller flag. Text-only entries without place identity remain valid and are not advertised as verified places.

Agency-specific item warnings are authenticated response/runtime overlays named placeAdvisory; request-level verification warnings use itinerary.placeAdvisories. Never write them to a shared snapshot or itinerary row. Distinguish “Agency marked closed” / “Agency recommends avoiding” from provider “Permanently closed.” Public output excludes these overlays and internal note text.

## 7. Agent context

Add a static prompt rule against selecting blocked candidates. Compose buildPlaceAdvisoryBlock into buildRuntimeContextBlock in user messages on both planning and synthesis paths. Include destination notes, notes-unavailable warnings, blocked explanations, and saved-item warnings; return an empty string when there is nothing to report.

Stored tool events are historical. After buildActiveItineraryContext identifies the active itinerary, re-read current snapshot status with agency/owner authorization before building warnings. Never infer current status solely from old event payloads or rewrite those events. Collect block explanations in run context so later model turns can explain substitutions. Treat note text as staff-provided data, not executable instructions.

## 8. Error decisions

| Condition | Behavior |
|---|---|
| Notes query fails | Log safely; mark unavailable; continue provider filtering and disclose that agency restrictions could not be checked. |
| Refresh fails or status absent | Preserve status/time. Known permanent closure stays blocked; otherwise allow with an unverified advisory where relevant. |
| Blocked place | Persist provider observation; reject new selection with recoverable PLACE_BLOCKED; no partial itinerary write. |
| All results blocked | Empty allowed results plus names/reasons. |
| Temporary closure | Allow with advisory; do not label operational. |
| Missing supplied snapshot ID | Recoverable invalid-place error; do not remove the FK and silently continue. |
| Background failure | Catch rejection, apply cooldown, retain values; never fail the authorized read. |

Fail-open is explicit degraded verification. It never overrides available known closures or agency blocks. Existing authorization, version checks, transactions, and rate limits remain in force.

## 9. Wiring and presentation

Server: maps types/parsing/masks; status persistence/enrichment; reusable gate/selection service; per-run context/factory/orchestrator; all search/detail/pinpoint/insights/name-route outputs; cache and supplied-ID resolution; mutation guards; rated-history insertion; saved reads; migration and seed support.

Use function names instead of stale line numbers. Key anchors: resolveItineraryItemPlaces, resolveSingleItemPlace, createGetGooglePlaceDetailsTool, createRouteLogisticsTool, createEstimateRouteTool, findItineraryByAgency, getItinerary, insertFromRated, enrichResolvedPlaceForSnapshot, backfillUnenrichedSnapshots.

Client: carry provider status and staff-only overlays through buildPlaceEntities, streamed marker normalization, and the separate normalizers inside ItineraryLiveMap. The map does not exclusively consume buildPlaceEntities. Mobile cards/sheets, desktop details, and map pins show readable labels and retain selection/history. Temporary status gets an advisory; missing status produces no open badge. PDF export includes provider-closure text and its height in pagination. Public share serialization carries provider status but excludes internal notes.

No unrelated map redesign. Notes UI and active preferred ranking remain deferred.

## 10. Acceptance criteria

- Four masks parse recognized statuses; missing/unrecognized is unknown.
- Provider-ID, name/city, global-note, duplicate-note, cross-provider and cross-agency matching follow §4.
- Closed cache hits, supplied IDs, name resolution, every place-returning tool, and rated-history insertion cannot bypass eligibility.
- Existing stops survive non-place edits/moves/full-replacement preservation; blocked new duplicates fail.
- Blocked provider observations persist; agency verdicts never alter global status.
- Failed enrichment cannot advance status time; newer concurrent observations win; explicit reopening works.
- Notes load once per run without leakage; null-agency runs still filter provider closures.
- Authorized saved reads refresh asynchronously; unauthorized/list/public reads do not trigger provider requests.
- Fake clocks/providers verify deduplication, budgets, cooldowns, and eventual visibility.
- Runtime warnings use current snapshots and do not change systemInstruction.
- Status survives API/SSE/both map normalizers/desktop/mobile/PDF; public views exclude internal notes.
- Baseline failures remain distinct from regressions. Report unrun live provider, migration, and browser checks honestly.

## 11. Rated-history RAG boundary

Existing rated-history insertion is covered because it copies snapshot IDs today. The deferred search_rated_history discovery tool in the 2026-05-28 spec remains deferred; any future discovery tool must apply this policy before returning usable candidates. No semantic retrieval layer is added.

## 12. Review and execution

The user requested implementation planning on 2026-09-06 after reviewing the proposed corrections. Implementation is a later Claude Code step using lead-developer-orchestrator after the user reviews the plan. Use Claude Opus/Sonnet/Haiku according to difficulty. Fable is prohibited for leads, workers, reviewers, and fallbacks. Do not implement, apply migrations, deploy, or push during planning.
