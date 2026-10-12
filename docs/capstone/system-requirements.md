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
| Runtime | Node.js 22.12 | Node.js 22 on Railway |
| Database | PostgreSQL 15 | Railway PostgreSQL |
| Memory | 512 MB for the API server | 1 GB |
| Web client hosting | Any Next.js 16 host | Vercel |

## External services

| Service | Used for | Required |
|---|---|---|
| Google Gemini (Vertex AI) | The planning agent | Yes |
| Google Maps Platform (Places, Routes, Maps JavaScript) | Places, photos, routes and maps | Yes; OpenStreetMap is the fallback for some lookups |
| Resend | Account, approval and trip emails | Yes |
| Cloudinary | Agency logos and cached place photos | Yes |
| Serper | Web search for the agent | Optional |
