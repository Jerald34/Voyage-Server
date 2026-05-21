# Google Maps API Cost Reduction — Investigation & Plan

Investigation of why Google Maps API costs are high in `Voyage-Server`, and a prioritized plan to reduce them while preserving the existing itinerary card UI (photo, name, rating, userRatingCount, types, formattedAddress).

---

## 1. Why the bill is high

Google's new Places API is billed **per SKU tier**, set by the `X-Goog-FieldMask` header. The codebase consistently asks for the most expensive tier and amplifies the call count per agent run.

### 1.1 `resolvePlace` uses the Pro/Enterprise SKU just to get coordinates

`src/services/maps.ts:367` requests:

```
places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types
```

Including `rating` + `userRatingCount` bumps Text Search to **Enterprise + Atmosphere (~$40/1k)**. For pure "place name → lat/lng" only `places.id,places.displayName,places.location` is needed → **Essentials (~$5/1k)**. This is the single biggest lever — `resolvePlace` runs for every itinerary item.

### 1.2 Every itinerary item triggers Place Details + Photos enrichment

`src/modules/agent/tools/itineraryTools.ts:231` and `:352` call `enrichResolvedPlaceForSnapshot`, which fires:

- `getPlaceDetails` with `nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount` → **Place Details Enterprise+Atmosphere (~$40/1k)**
- `getPlacePhotos` → another Place Details call (`photos` field) + each photo URL is **its own billable Place Photo request** (~$7/1k), at 1000×1000 px (`src/services/maps.ts:464`).

One new place ≈ **1 Text Search + 1 Place Details + 1 Place Details(photos) + N photo loads** — easily $0.10+ per place.

### 1.3 Routes are computed for every adjacent pair, every run

`src/modules/agent/tools/itineraryTools.ts:181` calls `estimateRoute` between every consecutive resolved item in a day. A 3-day plan with 5 stops/day = 12 Compute Routes calls per regeneration.

### 1.4 No HTTP-level cache for Google

The Nominatim provider keeps an in-memory cache (`src/services/maps.ts:506`, `:561`); **the Google provider has none**. Repeated tool calls in the same run, retries, and re-runs all re-bill. The `PlaceSnapshot` table is only consulted when the agent already supplies a `placeSnapshotId` (`src/modules/agent/tools/itineraryTools.ts:220`) — a place looked up by name doesn't hit it first.

### 1.5 Photo URLs are billed every time a browser loads them

`PlaceSnapshot.metadata.primaryPhotoUrl` is set to `https://places.googleapis.com/.../media?key=...` (`src/services/maps.ts:464`). **Every browser load of that URL is a billable Place Photo request.** One shared itinerary viewed 1000 times = 1000 charges per place.

### 1.6 The per-run ceiling is loose

`src/config/env.ts:48` — `GOOGLE_MAPS_MAX_CALLS_PER_RUN=80`. With 8 Google tools registered (`src/modules/agent/agentFactory.ts:35-44`), an unconstrained agent can rack up 80 paid calls per single user turn.

---

## 2. UI requirements (must preserve)

The itinerary card renders:

- Photo (thumbnail, ~150px square at display size)
- Place name
- Rating (e.g. `4.3`)
- userRatingCount (e.g. `10,279`)
- Category / types (e.g. `HISTORICAL LANDMARK`)
- formattedAddress (e.g. `Tagaytay – Calamba Rd, Tagaytay City, Cavite, Philippines`)

Any cost-reduction plan must keep these fields populated on `PlaceSnapshot`.

---

## 3. Recommended cost reductions (UI-safe)

Ordered by impact × effort.

### A. Cache photos on Cloudinary (highest impact)

**Problem:** Every browser load of the stored Google photo URL is a billable Place Photo request.

**Fix:** On first enrichment, download the photo bytes once, upload to Cloudinary (already wired up via `src/services/cloudinary.ts`), and store the Cloudinary URL in `PlaceSnapshot.metadata.primaryPhotoUrl`. Subsequent views cost $0 in Google billing.

**Crossover point:** ~3–5 views per photo. Anything more popular than that, Cloudinary wins by ~350×.

### B. Merge `getPlacePhotos` into `getPlaceDetails`

**Problem:** Two Place Details calls per place — one for atmosphere fields (`src/services/maps.ts:418-440`), one just for `photos` (`:442-467`).

**Fix:** The `photos` field is part of the same Place Details endpoint. Combine into a single call with a combined field mask. Cuts Place Details cost roughly in half per new place.

### C. Skip enrichment when the snapshot is already complete

**Problem:** `enrichResolvedPlaceForSnapshot` (`src/modules/agent/tools/placeSnapshotEnrichment.ts:7`) runs unconditionally.

**Fix:** Before calling Details + Photos, check whether the existing snapshot already has `rating`, `primaryPhotoUrl`, and `websiteUrl` populated. If yes, return early.

```ts
if (existingSnapshot.rating != null
  && existingSnapshot.metadata?.primaryPhotoUrl
  && existingSnapshot.websiteUrl !== undefined) {
  return existingSnapshot; // skip Details + Photos entirely
}
```

The same Eiffel Tower across 50 itineraries should cost **one** Details call total, not 50.

### D. Pre-lookup `PlaceSnapshot` by `(name + city)` before any Google call

**Problem:** Resolution only hits the DB cache when the agent already supplies a `placeSnapshotId` (`src/modules/agent/tools/itineraryTools.ts:220`). A place looked up by name always re-bills Text Search.

**Fix:**

```ts
const existing = await prisma.placeSnapshot.findFirst({
  where: {
    name: { equals: placeName, mode: "insensitive" },
    formattedAddress: { contains: cityContext }
  }
});
if (existing) return existing;
```

For popular destinations this eliminates 80%+ of Text Search calls after the first few runs.

### E. Trim `resolvePlace`'s field mask (safe version)

**Problem:** Text Search uses Enterprise+Atmosphere mask, but the card data comes from `PlaceSnapshot` populated by Place Details — **not** from the Text Search response.

**Fix:** Make `resolvePlace` request only `places.id,places.displayName,places.location`. Drops Text Search from Enterprise+Atmosphere (~$40/1k) to Essentials (~$5/1k) without losing any UI data, because enrichment immediately overwrites the missing fields anyway.

**Caveat:** `search_google_places` (`src/modules/agent/tools/mapTools.ts:229`) is a separate tool that should keep the richer mask — fix by giving `resolvePlace` its own dedicated minimal-mask fetch rather than delegating to `searchPlaces`.

### F. Reduce photo dimensions to match card

**Current:** `maxHeightPx=1000&maxWidthPx=1000` (`src/services/maps.ts:464`).

**Fix:** Drop to `maxHeightPx=400&maxWidthPx=400`. Same billing tier per request, but combined with (A) the Cloudinary-cached file is much smaller — faster page loads, less Cloudinary storage.

### G. Cap to 1 photo, not 3

`src/modules/agent/tools/placeSnapshotEnrichment.ts:51` fetches 3 photos. The card shows one. Keep 1.

### H. Dedup within a single agent run

`resolveItineraryItemPlaces` (`src/modules/agent/tools/itineraryTools.ts:216-253`) resolves all items in parallel with no in-run cache. If the agent emits the same place twice in one itinerary, you pay twice.

**Fix:** A `Map<string, Promise<ResolvedPlace>>` keyed by `${placeName}|${cityContext}` for the duration of the run.

### I. Drop in-day automatic routing (verify with UI first)

`src/modules/agent/tools/itineraryTools.ts:179-200` calls `estimateRoute` between every adjacent pair on every build.

**Action:** Confirm with the UI team whether routes are rendered anywhere. If not, delete the in-day route fanout — pure savings. If they're rendered only on the map view, lazily compute when that view loads. Or use Haversine for distance hints, free.

### J. Lower the per-run ceiling

`GOOGLE_MAPS_MAX_CALLS_PER_RUN=80` (`src/config/env.ts:48`) lets one runaway agent burn $5+ on a single user turn. Drop to 30. After (C) + (D) you should be nowhere near 30 on a normal build.

---

## 4. Cloudinary storage estimates

### 4.1 Per-photo size

| Photo size | Typical JPEG | Notes |
|---|---|---|
| 400×400 | ~30–60 KB | Card thumbnail (recommended) |
| 800×800 | ~100–180 KB | Retina-friendly |
| 1000×1000 | ~150–300 KB | Current setting |

Assume **~50 KB/photo** at 400×400 with Cloudinary `q_auto`.

### 4.2 Storage at scale (1 photo per place)

| Unique places cached | Storage |
|---|---|
| 1,000 | ~50 MB |
| 10,000 | ~500 MB |
| 50,000 | ~2.5 GB |
| 100,000 | ~5 GB |
| 500,000 | ~25 GB |

For a Philippines/SEA-focused travel agent, realistic steady state is **5k–30k unique places** in year one → **~250 MB – 1.5 GB**.

### 4.3 Pricing context

- **Cloudinary Free**: 25 GB storage + 25 GB bandwidth/month.
- **Cloudinary Plus** ($99/mo): 225 pooled credits (1 credit = 1 GB storage OR 1 GB bandwidth OR 1000 transformations).
- **Bandwidth is usually the bigger problem than storage.** A 50 KB photo viewed 1000 times = 50 MB bandwidth.

### 4.4 Google vs Cloudinary economics

- Google Place Photo: **~$7 per 1000 requests**
- Cloudinary bandwidth: **~$0.10–$0.40 per GB**

For a single 50 KB photo viewed 1000 times:
- Google: ~$7.00
- Cloudinary bandwidth: ~$0.02

Cloudinary wins by ~350× on repeat views. Crossover at ~3–5 views per photo.

### 4.5 Keeping Cloudinary bounded

1. **Cache only on Nth use.** Don't upload on first enrichment — store Google's URL. On the second read of that snapshot, upload to Cloudinary and replace. Eliminates the "looked up once, never seen again" long tail.
2. **TTL eviction.** Weekly job to delete snapshots not viewed in 90+ days. Requires tracking `lastViewedAt`.
3. **Single primary photo only.** Matches (G) above.
4. **`f_auto,q_auto,w_400` transformations.** Cloudinary serves WebP/AVIF when supported — 30–50% smaller bandwidth.
5. **Fetch mode** (`https://res.cloudinary.com/.../image/fetch/<google-url>`) avoids the explicit upload step but still consumes storage on Cloudinary's side. Downside: requires the Google URL to keep working (which embeds your API key).

### 4.6 Alternative: Cloudflare R2

R2 has **zero egress fees**. Storage is $0.015/GB/month ($0.38/month for 25 GB). Useful if bandwidth becomes the bottleneck.

---

## 5. Risk summary

| Change | Impact | Effort | Risk | Required follow-up |
|---|---|---|---|---|
| A. Cloudinary photo caching | Very High | Medium | Low | Storage TTL job, key referrer restriction |
| B. Merge Details + Photos call | High (~30%) | Low | None | — |
| C. Skip enrichment when complete | High | Low | None | — |
| D. Pre-lookup by name+city | High | Low | None | Verify name normalization |
| E. Trim `resolvePlace` mask | High (~8× Text Search) | Low | None | Keep richer mask in `search_google_places` |
| F. Smaller photo dims | None on bill | Trivial | None | — |
| G. Cap to 1 photo | Modest (storage) | Trivial | None — card shows one | — |
| H. In-run dedup | Modest | Low | None | — |
| I. Drop auto routes | Modest | Low | Medium | **Confirm UI doesn't render routes** |
| J. Lower call ceiling | Guardrail only | Trivial | None | — |

---

## 6. Recommended rollout order

1. **A + B + E** together: biggest immediate savings, no UI risk.
2. **C + D**: scale savings as DB cache warms up.
3. **G + F + H + J**: cleanup and guardrails.
4. **I**: only after confirming with the UI team.

Combined, expect a **~70–90% reduction** in Google Maps spend depending on traffic patterns, while preserving the exact itinerary card UI.

---

## 7. Key file references

| Concern | File:line |
|---|---|
| Google provider, field masks | `src/services/maps.ts:309-499` |
| `resolvePlace` Text Search mask | `src/services/maps.ts:367` |
| `searchNearby` mask | `src/services/maps.ts:407` |
| `getPlaceDetails` mask | `src/services/maps.ts:426` |
| `getPlacePhotos` (duplicate Details call) | `src/services/maps.ts:442-467` |
| Photo URL construction | `src/services/maps.ts:464` |
| Auto-enrichment during itinerary build | `src/modules/agent/tools/itineraryTools.ts:231`, `:352` |
| Enrichment function | `src/modules/agent/tools/placeSnapshotEnrichment.ts` |
| In-day route fanout | `src/modules/agent/tools/itineraryTools.ts:179-200` |
| Snapshot upsert (DB cache write) | `src/modules/agent/tools/toolUtils.ts:59-91` |
| Snapshot read path | `src/modules/itineraries/itineraryService.ts:62-74` |
| Public share payload | `src/modules/shares/shareService.ts:341-344` |
| Per-run ceiling | `src/config/env.ts:48` |
| Tool registration | `src/modules/agent/agentFactory.ts:35-153` |
