# Voyage Minimum System Requirements

Answer to capstone panel item 14. The client table matches what the app shows in Settings › System requirements (`Voyage-Client/app/lib/systemRequirements.js`).

## Client (people using Voyage)

| | Minimum | Recommended |
|---|---|---|
| Browser | Chrome or Edge 111, Safari 16.4, Firefox 128 | The latest version of any of them |
| Device | A phone at least 360 px wide, or any laptop or desktop | A laptop or desktop for planning |
| Memory | 4 GB | 8 GB |
| Internet | 5 Mbps | 10 Mbps or faster, for maps, photos and live agent replies |
| Browser settings | JavaScript and cookies on | JavaScript and cookies on |

Why these browser versions: the web client is built with Next.js 16, which targets Chrome/Edge 111 and Safari 16.4, and styled with Tailwind CSS v4, which needs CSS `@property` (Firefox 128, Safari 16.4) and `color-mix()` (Chrome 111). Older browsers see a warning banner on every page. Voyage also installs as an app (PWA) on phones and computers that support it.

Travelers who only open a shared itinerary link need the same browser, and no account.

## Server (running Voyage)

| | Minimum | Used in production |
|---|---|---|
| Runtime | Node.js 22.12 (`>=22.12.0`) | Node.js 22 |
| Database | PostgreSQL 15 | PostgreSQL |
| Redis | Shared Redis for rate limiting (`RATE_LIMIT_REDIS_URL`), required in production | Same |
| Production secrets | `PASSWORD_PEPPER` and `TRIP_REVIEW_SECRET` must be set in production | Same |
| Memory | 512 MB for the API server (estimate) | 1 GB (estimate) |
| Hosting | Any host that can run the above, and any Next.js 16 host for the web client | Deployed on Railway (server, database) and Vercel (client) |

## External services

| Service | Used for | Required |
|---|---|---|
| AI model: Gemini on Google Vertex AI | The planning agent. Production uses Gemini on Vertex AI; the code also supports OpenRouter, Google AI and LM Studio through `MODEL_PROVIDER` | Yes; one model provider is required |
| Google Maps Platform (Places, Routes, Maps JavaScript) | Places, photos, routes and maps | Yes; OpenStreetMap is the fallback for some lookups |
| Email (SMTP or Resend) | Account, approval, invitation and trip emails | At least one of the two; without either, emails are skipped |
| S3-compatible storage | Profile pictures, agency logos and itinerary images | Optional; without it, image uploads are unavailable |
| Cloudinary | Cached place photos and chat image uploads | Optional; without it, chat image upload is unavailable and place photos are not cached |
| Serper | Web search for the agent | Optional |
