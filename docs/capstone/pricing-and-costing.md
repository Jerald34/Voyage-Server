# Voyage Pricing and Costing

Answer to capstone panel item 15: what an agency pays to use Voyage, and why.

Voyage is sold per agency, per month. Every plan has the whole product; plans differ only in team size and how many new itineraries the agency makes a month. Plans start with a 14-day free trial once billing begins. During the pilot, agencies use Voyage free; the app shows the prices (landing page) and each owner's monthly usage against them (Settings › Plan and usage), but takes no payment.

Prices were set from both sides:

- **Floor (cost-plus):** what one agency costs to serve, so no plan loses money.
- **Ceiling (market):** what agencies pay for comparable tools, so Voyage stays cheaper.

All figures use **₱61 = US$1** (mid-2026 rates were ₱60.6–61.8). At October 2026's rate (about ₱62.5), the per-itinerary cost still rounds to ₱130 and each plan's floor rises by only about ₱7, so the prices and margins hold.

## 1. Variable cost per itinerary

Assumptions: a 3-day itinerary with 15 stops, built in one agent run, then changed in 3 follow-up requests. The token count (a token is about ¾ of a word; Google charges per million tokens) comes from one full planning run (about 344k tokens) measured on the development database in October 2026. The Maps call counts are estimates.

| Item | Assumption | US$ |
|---|---|---|
| Gemini 3 Flash, first plan | ~330k input tokens at $0.50/M + ~15k output tokens at $3.00/M | 0.21 |
| Gemini 3 Flash, 3 follow-up edits | 3 × (60k input + 4k output) | 0.13 |
| Google Places Text Search (Enterprise) | 2 searches per stop × 15 stops × $35/1,000 | 1.05 |
| Google Place Details (Enterprise) | 1 per stop × 15 × $20/1,000 | 0.30 |
| Google Place Photos | 1 per stop × 15 × $7/1,000; then served from Cloudinary | 0.11 |
| Google Compute Routes (Essentials) | 12 legs × $5/1,000 | 0.06 |
| Web search (Serper) | ~5 queries × $1/1,000 | 0.01 |
| Email (Resend) | ~6 emails × $0.90/1,000 | 0.01 |
| **Total (rows rounded)** | | **1.88 (₱115)** |

With a 10% allowance for retries and re-plans, rounded up: **₱130 per itinerary**.

Google Maps, not the AI model, is the largest cost. Google's free monthly allowances (1,000 Enterprise calls per type of lookup, 10,000 Essentials route calls) and places Voyage has already looked up and saved lower the real cost at pilot scale; they are left out to keep the floor conservative. A copied option ("Another option") reuses its original's places and costs almost nothing.

## 2. Fixed monthly cost

| Service | Plan | US$ / month |
|---|---|---|
| Railway (API server, PostgreSQL; Redis and image storage if hosted there) | Pro: $20 a month (covers the first $20 of usage) plus ~$10 extra usage | 30 |
| Vercel (web client) | Pro, 1 seat | 20 |
| Resend (email) | Pro, 50,000 emails | 20 |
| Cloudinary (images) | Free plan | 0 |
| Domain | ~$12 a year | 1 |
| Serper (web search) | $50 credit pack lasting ~6 months | 8 |
| **Total** | | **79 (about ₱4,800)** |

Serper and Resend appear in both tables; this double count is deliberate and keeps the floor high.

Shared across a target of 20 paying agencies: **about ₱240 per agency per month**.

## 3. Cost floor per plan

Floor = monthly itinerary allowance × ₱130 + ₱240.

| Plan | Team members | Itineraries / month | Floor | Price | Margin |
|---|---|---|---|---|---|
| Starter | 2 | 15 | ₱2,190 | ₱2,990 | 27% |
| Pro | 5 | 40 | ₱5,440 | ₱6,990 | 22% |
| Agency | 15 | 100 | ₱13,240 | ₱16,990 | 22% |

Margin = (price − floor) ÷ price. Even if every agency uses its whole allowance, every plan covers its cost once Voyage has at least 5 paying agencies (the target is 20).

## 4. Market ceiling

| Tool | Pricing | 2 people | 5 people | 15 people |
|---|---|---|---|---|
| Travefy (Core, annual) | $39 first seat + $20 each extra | ₱3,599 | ₱7,259 | ₱19,459 |
| Tern (annual) | $35 per seat per month | ₱4,270 | ₱10,675 | ₱32,025 |
| **Voyage** | per agency | **₱2,990** | **₱6,990** | **₱16,990** |

At each plan's full team size (2, 5 and 15 people), Voyage costs less than both. Travefy Core and Tern can both be cheaper for a solo agent or a team just past a plan's limit (for example 3 or 6 people). Tern includes AI up to a usage limit and sells more AI use as an add-on (Tern Pro, from $19 a month).

## 5. Free trial

A 14-day trial with no allowance limit. A trial agency that builds 10 itineraries costs Voyage about ₱1,300 to serve (10 × ₱130), less than half of one Starter month (₱2,990).

What happens on day 15? During the pilot, nothing is charged and billing is not switched on. When billing starts, an agency would pick a plan on day 15. The 14-day trial is the planned policy for when billing starts, and new agencies are also reviewed by Voyage before they can use the app.

## 6. Limits of this costing

- Prices are display only. Voyage has no payment processing, no stored plan and no plan-based usage cap (only anti-abuse limits on messages to the agent). Adding payments, a stored plan and plan limits (for example PayMongo checkout) is future work.
- Third-party prices change; recheck Google Maps Platform, Gemini API, Railway, Vercel, Resend and Serper pricing pages and the exchange rate before quoting these numbers.
- The app estimates each run's AI cost from its token count and Google's list price; the AI rows above use the same method.
- Weather comes from Open-Meteo's free API, which is for non-commercial use; a paid Open-Meteo plan must be added to the fixed cost before billing starts.
- The card's itinerary and message counts are live counts of this month's records, so they can go down: deleting a chat thread removes its agent runs, and deleting an unsaved draft removes its itinerary. "Team members" is the current count. A billing system would need a usage record that is never deleted.
- "Messages to the agent" counts every message sent to the agent, including ones that failed.
- "Itineraries created" includes copies made with "Another option". A copy reuses stored place data and costs almost nothing in Google lookups, so the count can be a little higher than what those itineraries actually cost.

## Sources

(accessed 13 Oct 2026)

- Gemini 3 Flash pricing (Vertex AI): https://cloud.google.com/vertex-ai/generative-ai/pricing
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Google Maps Platform pricing (Places, Photos, Routes, free monthly caps): https://developers.google.com/maps/billing-and-pricing/pricing
- Railway plans: https://docs.railway.com/pricing/plans
- Vercel Pro: https://vercel.com/pricing
- Resend pricing: https://www.resend.com/pricing.md
- Cloudinary pricing: https://cloudinary.com/pricing
- Serper pricing: https://serper.dev
- Open-Meteo pricing: https://open-meteo.com/en/pricing
- Domain: typical .dev renewal price
- Travefy pricing: https://travefy.com/pricing
- Tern pricing: https://tern.travel/pricing and https://help.tern.travel/en/articles/15292346-tern-pro
- USD/PHP rate: https://www.ofx.com/en-au/exchange-rates/usd-to-php/
