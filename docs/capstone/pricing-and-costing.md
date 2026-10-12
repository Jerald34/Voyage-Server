# Voyage Pricing and Costing

Answer to capstone panel item 15: what an agency pays to use Voyage, and why.

Voyage is sold per agency, per month. Every plan has the whole product; plans differ only in team size and how many new itineraries the agency makes a month. New agencies get a 14-day free trial. During the pilot, agencies use Voyage free; the app shows the prices (landing page) and each owner's monthly usage against them (Settings › Plan and usage), but takes no payment.

Prices were set from both sides:

- **Floor (cost-plus):** what one agency costs to serve, so no plan loses money.
- **Ceiling (market):** what agencies pay for comparable tools, so Voyage stays cheaper.

All figures use **₱61 = US$1** (mid-2026 rates were ₱60.6–61.8).

## 1. Variable cost per itinerary

Assumptions: a 3-day itinerary with 15 stops, built in one agent run, then changed in 3 follow-up requests. The token count comes from a measured full planning run (about 344,000 tokens).

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
| **Total** | | **1.88 (₱115)** |

With a 10% allowance for retries and re-plans: **₱130 per itinerary**.

Google Maps, not the AI model, is the largest cost. Google's free monthly allowances (1,000 Enterprise calls per SKU, 10,000 Essentials route calls) and reused place snapshots lower the real cost at pilot scale; they are left out to keep the floor conservative. A copied option ("Another option") reuses its original's places and costs almost nothing.

## 2. Fixed monthly cost

| Service | Plan | US$ / month |
|---|---|---|
| Railway (API server + PostgreSQL) | Pro, $20 plus ~$10 usage | 30 |
| Vercel (web client) | Pro, 1 seat | 20 |
| Resend (email) | Pro, 50,000 emails | 20 |
| Cloudinary (images) | Free plan | 0 |
| Domain | ~$12 a year | 1 |
| Serper (web search) | $50 credit pack lasting ~6 months | 8 |
| **Total** | | **79 (₱4,800)** |

Shared across a target of 20 paying agencies: **₱240 per agency per month**.

## 3. Cost floor per plan

Floor = monthly itinerary allowance × ₱130 + ₱240.

| Plan | Team members | Itineraries / month | Floor | Price | Margin |
|---|---|---|---|---|---|
| Starter | 2 | 15 | ₱2,190 | ₱2,990 | 27% |
| Pro | 5 | 40 | ₱5,440 | ₱6,990 | 22% |
| Agency | 15 | 100 | ₱13,240 | ₱16,990 | 22% |

Margin = (price − floor) ÷ price. Even if an agency uses its whole allowance, every plan stays above cost.

## 4. Market ceiling

| Tool | Pricing | 2 people | 5 people | 15 people |
|---|---|---|---|---|
| Travefy (Core, annual) | $39 first seat + $20 each extra | ₱3,599 | ₱7,259 | ₱19,459 |
| Tern | $49 per seat per month | ₱5,978 | ₱14,945 | ₱44,835 |
| **Voyage** | per agency | **₱2,990** | **₱6,990** | **₱16,990** |

Voyage is cheaper than both at every team size, and includes the AI agent and maps, which Tern sells as an add-on ($19+ a month per advisor).

## 5. Free trial

A 14-day trial with no allowance limit. A trial agency that builds 10 itineraries costs Voyage about ₱1,300 to serve (10 × ₱130), less than half of one Starter month (₱2,990).

What happens on day 15? During the pilot, nothing is charged and billing is not switched on. The 14-day trial is the planned policy for when billing starts, and new agencies are also reviewed by Voyage before they can use the app.

## 6. Limits of this costing

- Prices are display only. Voyage has no payment processing, no stored plan and no usage cap; adding them (for example PayMongo checkout) is future work.
- Third-party prices change; recheck Google Maps Platform, Gemini API, Railway, Vercel, Resend and Serper pricing pages and the exchange rate before quoting these numbers.
- The app records AI cost per run, but Gemini runs currently record $0 (the model's price is missing from the cost table), so the AI figures above come from token counts × list price.
- The Settings card's counts are live counts of this month's records, so they can go down. Deleting a chat thread removes its agent runs. Deleting an unsaved draft removes its itinerary. A billing system would need an append-only usage log.
- "Agent requests" counts every message sent to the agent, including ones that failed.
- "Itineraries created" includes copies made with "Another option". A copy reuses stored place data, so it costs almost nothing in Google lookups, and the count runs slightly ahead of the per-itinerary cost.

## Sources

- Gemini 3 Flash pricing (aggregator citing Google): https://anotherwrapper.com/llm-pricing/gemini-3-flash-preview
- Google Places API pricing: https://openplacesapi.com/blog/google-places-api-pricing and https://www.woosmap.com/blog/google-places-api-pricing
- Google Routes API pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Railway plans: https://docs.railway.com/pricing/plans
- Vercel Pro: https://makerkit.dev/blog/tutorials/vercel-cost
- Resend pricing: https://www.resend.com/pricing.md
- Serper pricing: https://apiserpent.com/blog/serper-pricing-credits-explained
- Travefy pricing: https://travefy.com/pricing
- Tern pricing: https://tern.travel/pricing and https://help.tern.travel/en/articles/15292346-tern-pro
- USD/PHP rate: https://www.ofx.com/en-au/exchange-rates/usd-to-php/
