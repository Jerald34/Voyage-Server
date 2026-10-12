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

Memory and internet figures are guidance, not measured limits.

Why these browser versions: Next.js 16 builds for Chrome and Edge 111, Firefox 111 and Safari 16.4 by default, and the styling library, Tailwind CSS v4, officially supports Chrome 111, Safari 16.4 and Firefox 128. Older browsers lose colours, shadows and some selected states. Older browsers that can still run Voyage's scripts (Chrome or Edge 94–110, Firefox 93–127) see a warning banner, which they can dismiss for the session. Safari and iPhone browsers older than 16.4 can't load the app at all. Voyage also installs as an app (PWA) on phones and computers that support it.

Travelers who only open a shared itinerary link need the same browser, and no account.

## Server (running Voyage)

| | Minimum | Used in production |
|---|---|---|
| Runtime | Node.js 22.12 (`>=22.12.0`) | Node.js 22 |
| Database | PostgreSQL 15 (the version Voyage is built and tested on) | PostgreSQL |
| Redis | Redis (a small in-memory store) for rate limiting; the server won't start in production without it (`RATE_LIMIT_REDIS_URL`) | Yes |
| Production secrets | The server's secret keys must be set, or it won't start in production (`PASSWORD_PEPPER`, `TRIP_REVIEW_SECRET`) | Yes |
| Memory | 512 MB for the API server (estimate) | 1 GB (estimate) |
| Hosting | Any host that can run the above, and any Next.js 16 host for the web client | Deployed on Railway (server, database) and Vercel (client) |

## External services

| Service | Used for | Required |
|---|---|---|
| AI model: Gemini on Google Vertex AI | The planning agent. Production uses Gemini on Vertex AI; the code also supports OpenRouter, Google AI and LM Studio through `MODEL_PROVIDER` | Yes; one model provider is required |
| Google Maps Platform (Places, Routes, Maps JavaScript) | Places, photos, routes and maps | Yes; OpenStreetMap is the fallback for some lookups |
| Email (SMTP or Resend) | Account, approval, invitation and trip emails | Yes, one of the two. Without either, emails are only logged, so new users can't verify their email, accept an invitation or reset a password |
| S3-compatible storage | Profile pictures, agency logos and itinerary images | Optional; without it, image uploads are unavailable |
| Cloudinary | Cached place photos and chat image uploads | Optional; without it, chat image upload is unavailable and place photos are not cached |
| Serper | Web search for the agent | Optional |
| Open-Meteo | Weather forecasts | Optional; set `WEATHER_PROVIDER=disabled` to turn it off |
| OpenStreetMap Nominatim | Place lookup fallback | Optional |
| Google and Apple sign-in | Signing in with a Google or Apple account | Optional; email and password sign-in works without them |

## Sources

(accessed 13 Oct 2026)

- Next.js supported browsers: https://nextjs.org/docs/architecture/supported-browsers
- Tailwind CSS compatibility: https://tailwindcss.com/docs/compatibility
