# Voyage Server

Backend API for Voyage.

## Local Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the environment template and configure local values:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set `DATABASE_URL` to a PostgreSQL database. Railway should provide this value when the app is connected to a Railway PostgreSQL service.

4. Generate the Prisma client:

   ```powershell
   npm run prisma:generate
   ```

5. Run database migrations:

   ```powershell
   npm run prisma:migrate
   ```

6. Create the first platform admin by setting `ADMIN_EMAILS` to one or more already-registered user emails, then run:

   ```powershell
   npm run prisma:seed
   ```

7. Start the development server:

   ```powershell
   npm run dev
   ```

## Verification

Run the TypeScript build and tests:

```powershell
npm run build
npm test
```

## Storage

Uploaded files are stored in an S3-compatible bucket. PostgreSQL stores image metadata only. Configure these environment variables for Railway Storage Buckets or another S3-compatible provider:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

## Agency Itinerary Agent

The agency itinerary agent uses LM Studio for local model inference during development.

1. Start LM Studio.
2. Load a chat model.
3. Enable the local OpenAI-compatible server.
4. Confirm the server is available at `http://localhost:1234/v1`.
5. Set `LM_STUDIO_MODEL` to the loaded model name when needed.

Google Maps powers place lookup, place details, and route estimates. Configure `GOOGLE_MAPS_API_KEY` before enabling map tools for agency staff.

Google Custom Search powers the `web_search` tool. Configure both:

- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`

Google Maps and Google Search are optional for local development. When they are not configured, the related provider calls return clear unavailable errors while the rest of the agent workflow remains testable with fake providers.
