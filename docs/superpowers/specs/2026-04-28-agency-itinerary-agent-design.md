# Agency Itinerary Agent Design

## Context

Voyage Server currently has the account, session, agency verification, and private image upload foundation in place. The live backend supports verified agencies and agency memberships, but it does not yet have trip, itinerary, agent thread, map, or client-sharing models.

This phase adds the first agency-focused itinerary agent. The agent should feel like a ChatGPT-style workspace for agency staff: staff can chat with a local model hosted by LM Studio, watch live progress, see tool calls, and review a structured itinerary draft enriched with Google Maps and web search sources.

## Goals

- Let verified agency staff create itinerary drafts through a chat interface.
- Stream live agent events so the UI can show assistant text, tasks, tool calls, and itinerary updates as they happen.
- Use LM Studio as the first model provider through its local OpenAI-compatible API.
- Use Google Maps as the first maps provider for place lookup, place details, coordinates, and route estimates.
- Add a web search tool for current travel context and source-backed itinerary decisions.
- Store chat messages, tool calls, tasks, sources, and structured itinerary state durably.
- Keep the implementation agency-first while preserving a later path for normal users to receive and modify agency itineraries.

## Non-Goals

- No client-facing itinerary sharing in this phase.
- No normal-user itinerary modification in this phase.
- No payment, agency billing, or Google Maps quota billing UI.
- No WebSocket requirement; Server-Sent Events are enough for the first live event stream.
- No live Google Maps, web search, or LM Studio calls in automated tests.
- No exposure of hidden model chain-of-thought. The product shows visible progress summaries, tasks, and tool activity instead.

## Recommended Approach

Build an agency itinerary agent workspace with durable threads and streaming agent runs.

The user experience is chat-first:

1. Agency staff opens or creates an agent thread inside a verified agency.
2. Staff sends a message describing the itinerary they want.
3. The server stores the message and creates an `AgentRun`.
4. The server streams live run events over SSE.
5. The agent calls internal tools for itinerary edits, Google Maps enrichment, web search, and visible task updates.
6. The server validates structured outputs before writing itinerary records.
7. Staff reviews and manually edits the itinerary draft before any future client delivery workflow exists.

This is more appropriate than a single hidden generation job because the desired product should expose the agent's visible work: text generation, tool calls, tasks, sources, and itinerary changes.

## Architecture

### Modules

Add these backend modules:

- `src/modules/agent`
  - Owns agent threads, messages, runs, tool calls, tasks, sources, and orchestration.
- `src/modules/itineraries`
  - Owns client trip workspaces and structured itinerary drafts.
- `src/services/modelProvider`
  - Calls LM Studio through an OpenAI-compatible local API.
- `src/services/maps`
  - Provides a Google Maps-backed provider behind a stable internal interface.
- `src/services/webSearch`
  - Provides Google Custom Search JSON API behind a stable internal interface.

The code should follow the existing server pattern: route file, schema file, service file, repository interface, Prisma implementation, and service-level unit tests with fake dependencies.

### Access Rules

The agency itinerary agent is available only when:

- the request user is authenticated,
- the user status is `ACTIVE`,
- the agency exists,
- the agency status is `VERIFIED`,
- the user has an active agency membership,
- the membership role is `OWNER`, `ADMIN`, or `STAFF`.

All threads, trips, itineraries, tool calls, tasks, and sources must be scoped to an agency.

## Data Model

Add the following Prisma models and enums.

### Client Trip

`ClientTrip` is the agency-owned workspace for one future client itinerary.

Fields:

- `id`
- `agencyId`
- `createdByUserId`
- `assignedOrganizerUserId`
- `title`
- `destinationSummary`
- `clientName`
- `startDate`
- `endDate`
- `travelerCount`
- `budgetLevel`
- `status`
- `createdAt`
- `updatedAt`

Initial statuses:

- `DRAFT`
- `IN_REVIEW`
- `APPROVED_INTERNAL`
- `ARCHIVED`

Client sharing statuses are intentionally excluded until the client workflow is implemented.

### Itinerary

`Itinerary` stores the structured draft for a trip.

Fields:

- `id`
- `agencyId`
- `tripId`
- `createdByUserId`
- `title`
- `summary`
- `status`
- `version`
- `createdAt`
- `updatedAt`

Initial statuses:

- `DRAFT`
- `NEEDS_REVIEW`
- `APPROVED_INTERNAL`

### Itinerary Day

`ItineraryDay` stores one day in an itinerary.

Fields:

- `id`
- `itineraryId`
- `dayNumber`
- `date`
- `title`
- `summary`
- `createdAt`
- `updatedAt`

### Itinerary Item

`ItineraryItem` stores activities, meals, transfers, check-ins, free time, and notes.

Fields:

- `id`
- `itineraryDayId`
- `sortOrder`
- `type`
- `title`
- `description`
- `startTime`
- `endTime`
- `placeSnapshotId`
- `routeFromPrevious`
- `staffNotes`
- `clientNotes`
- `createdAt`
- `updatedAt`

Initial item types:

- `ACTIVITY`
- `MEAL`
- `TRANSFER`
- `CHECK_IN`
- `CHECK_OUT`
- `FREE_TIME`
- `NOTE`

### Place Snapshot

`PlaceSnapshot` caches Google Maps place data used by itinerary items.

Fields:

- `id`
- `provider`
- `providerPlaceId`
- `name`
- `formattedAddress`
- `latitude`
- `longitude`
- `rating`
- `websiteUrl`
- `phoneNumber`
- `metadata`
- `fetchedAt`
- `createdAt`
- `updatedAt`

Use a unique index on `provider` and `providerPlaceId`.

### Agent Thread

`AgentThread` stores one chat workspace.

Fields:

- `id`
- `agencyId`
- `tripId`
- `createdByUserId`
- `title`
- `status`
- `createdAt`
- `updatedAt`

Initial statuses:

- `ACTIVE`
- `ARCHIVED`

### Agent Message

`AgentMessage` stores visible chat messages.

Fields:

- `id`
- `threadId`
- `runId`
- `role`
- `content`
- `metadata`
- `createdAt`

Roles:

- `USER`
- `ASSISTANT`
- `SYSTEM_VISIBLE`

`SYSTEM_VISIBLE` is for user-facing progress summaries only, not hidden prompts or private reasoning.

### Agent Run

`AgentRun` stores one model execution triggered by a staff message.

Fields:

- `id`
- `threadId`
- `agencyId`
- `triggerMessageId`
- `status`
- `modelProvider`
- `modelName`
- `startedAt`
- `completedAt`
- `failedAt`
- `errorCode`
- `errorMessage`
- `createdAt`
- `updatedAt`

Statuses:

- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

### Agent Tool Call

`AgentToolCall` stores visible tool calls.

Fields:

- `id`
- `runId`
- `threadId`
- `toolName`
- `status`
- `input`
- `outputSummary`
- `errorCode`
- `errorMessage`
- `startedAt`
- `completedAt`
- `createdAt`

Statuses:

- `RUNNING`
- `COMPLETED`
- `FAILED`

### Agent Task

`AgentTask` stores visible progress tasks shown in the UI.

Fields:

- `id`
- `runId`
- `threadId`
- `label`
- `status`
- `sortOrder`
- `createdAt`
- `updatedAt`

Statuses:

- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`

### Agent Source

`AgentSource` stores web and map sources used by an agent run.

Fields:

- `id`
- `runId`
- `threadId`
- `sourceType`
- `title`
- `url`
- `snippet`
- `provider`
- `retrievedAt`
- `metadata`
- `createdAt`

Source types:

- `WEB`
- `MAP_PLACE`
- `MAP_ROUTE`

## Agent Tools

The first tool set is:

- `record_agent_task`
  - Creates or updates visible progress tasks.
- `create_itinerary`
  - Creates the trip, itinerary, days, and first item set from validated structured JSON.
- `update_itinerary`
  - Applies structured itinerary edits such as adding items, reordering items, or changing notes.
- `search_google_places`
  - Finds candidate places through Google Maps.
- `get_google_place_details`
  - Fetches place details and writes or reuses a `PlaceSnapshot`.
- `estimate_route`
  - Estimates travel time and distance between itinerary stops.
- `web_search`
  - Searches the web for current supporting context.

Every tool call should:

- be authorized against the agency and thread,
- write an `AgentToolCall` record,
- stream `tool.started` and `tool.completed` or `tool.failed`,
- return compact JSON to the model,
- avoid storing large raw provider payloads unless needed for debugging.

## Provider Interfaces

### LM Studio

Use LM Studio through its local OpenAI-compatible API.

Default local URL:

```text
http://localhost:1234/v1/chat/completions
```

Add environment variables:

- `LM_STUDIO_BASE_URL`
- `LM_STUDIO_MODEL`
- `LM_STUDIO_TIMEOUT_MS`

The provider should support:

- non-streaming internal calls when needed,
- streamed assistant text when the model supports it,
- structured output validation,
- tool-call style orchestration where supported by the chosen local model.

If LM Studio is unavailable, return:

- HTTP status: `503`
- code: `LOCAL_MODEL_UNAVAILABLE`
- message: `Local model provider is unavailable. Start LM Studio and try again.`

### Google Maps

Add environment variables:

- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_MAX_CALLS_PER_RUN`

Internal provider interface:

```ts
type MapsProvider = {
  searchPlaces(input: {
    query: string;
    locationBias?: { latitude: number; longitude: number };
    maxResults: number;
  }): Promise<MapPlaceSearchResult[]>;
  getPlaceDetails(input: { placeId: string }): Promise<MapPlaceDetails>;
  estimateRoute(input: {
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    travelMode: "DRIVE" | "WALK" | "TRANSIT";
  }): Promise<MapRouteEstimate>;
};
```

Use cached `PlaceSnapshot` records before making repeat details calls.

### Web Search

Add environment variables:

- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_ENGINE_ID`
- `WEB_SEARCH_MAX_CALLS_PER_RUN`

Internal provider interface:

```ts
type WebSearchProvider = {
  search(input: {
    query: string;
    region?: string;
    language?: string;
    maxResults: number;
  }): Promise<WebSearchResult[]>;
};
```

Use Google Custom Search JSON API / Programmable Search Engine for the first real provider. The provider calls `GET https://www.googleapis.com/customsearch/v1` with `key`, `cx`, `q`, and `num`. `GOOGLE_SEARCH_ENGINE_ID` stores the Programmable Search Engine ID (`cx`). Automated tests use a fake provider. Local development can run with Google search disabled by leaving either Google search value empty; production should configure both values before exposing the `web_search` tool to agency staff.

## API Design

Initial routes:

- `POST /agencies/:agencyId/agent/threads`
  - Creates an itinerary agent thread.
- `GET /agencies/:agencyId/agent/threads`
  - Lists agency agent threads.
- `GET /agencies/:agencyId/agent/threads/:threadId`
  - Loads messages, latest itinerary state, tasks, sources, and tool history.
- `POST /agencies/:agencyId/agent/threads/:threadId/messages`
  - Saves a staff message and starts an agent run.
- `GET /agencies/:agencyId/agent/runs/:runId/stream`
  - Streams live SSE events for one run.
- `GET /agencies/:agencyId/itineraries/:itineraryId`
  - Loads a structured itinerary draft.
- `PATCH /agencies/:agencyId/itineraries/:itineraryId`
  - Allows manual staff edits outside the agent.

The first `POST /messages` response should include:

- `message`
- `run`
- `streamUrl`

## Streaming Contract

Use Server-Sent Events with `Content-Type: text/event-stream`.

Event types:

- `run.started`
- `task.updated`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `message.delta`
- `message.completed`
- `itinerary.updated`
- `source.added`
- `run.completed`
- `run.failed`

Example payloads:

```json
{ "type": "run.started", "runId": "..." }
```

```json
{ "type": "task.updated", "label": "Planning itinerary structure", "status": "RUNNING" }
```

```json
{ "type": "tool.started", "tool": "search_google_places", "summary": "Finding Cebu island-hopping stops" }
```

```json
{ "type": "tool.completed", "tool": "search_google_places", "summary": "Found 5 candidate stops" }
```

```json
{ "type": "message.delta", "text": "I drafted a 4-day Cebu itinerary..." }
```

```json
{ "type": "itinerary.updated", "itineraryId": "...", "change": "added_day_items" }
```

```json
{ "type": "run.completed" }
```

All streamed events that matter for reload should also be persisted as messages, tool calls, tasks, sources, or itinerary records.

## Orchestration Rules

The agent orchestration should be deterministic around side effects:

- The model may propose tool calls.
- The server validates each tool input with Zod.
- The server executes only known tools.
- The server writes itinerary records only through itinerary service methods.
- The server enforces provider call limits per run.
- The server streams visible progress before and after slow operations.
- The server stores source records when web or map data influences the response.
- The server marks the run failed if validation, provider, or persistence errors prevent a reliable itinerary result.

## Cost Controls

Google Maps and web search must be guarded from accidental overuse.

MVP controls:

- max Google Maps calls per run,
- max web search calls per run,
- small result limits for place and web searches,
- `PlaceSnapshot` cache for repeated Google place details,
- compact source storage,
- no automatic enrichment of every model-suggested place unless the tool limit allows it,
- clear partial-result behavior when a quota limit is reached.

When a provider limit is reached, the agent should stream a visible task or tool summary such as:

```text
Reached the map lookup limit for this run. I drafted the remaining items without map enrichment.
```

## Safety And Transparency

The product should show what the agent is doing without exposing hidden reasoning.

Allowed visible content:

- task labels,
- tool names,
- tool input summaries,
- tool output summaries,
- source URLs,
- short assistant explanations,
- structured itinerary changes.

Do not store or display hidden chain-of-thought. If the model returns reasoning text, store only concise user-facing summaries.

Agency staff remain responsible for reviewing itinerary quality before future client delivery.

## Error Handling

Use existing `ApiError` patterns.

Expected errors:

- `AUTH_REQUIRED`
- `AGENCY_NOT_FOUND`
- `AGENCY_NOT_VERIFIED`
- `AGENCY_ACCESS_REQUIRED`
- `THREAD_NOT_FOUND`
- `RUN_NOT_FOUND`
- `ITINERARY_NOT_FOUND`
- `LOCAL_MODEL_UNAVAILABLE`
- `MODEL_OUTPUT_INVALID`
- `MAPS_PROVIDER_UNAVAILABLE`
- `WEB_SEARCH_PROVIDER_UNAVAILABLE`
- `AGENT_TOOL_LIMIT_REACHED`
- `AGENT_RUN_FAILED`

Provider failures should be visible in the stream and durable in the run/tool records.

## Testing

Unit tests:

- agency access checks block unverified agencies and non-members,
- staff roles can create threads and start runs,
- fake model provider can drive a run with assistant text and tool calls,
- fake maps provider can enrich itinerary items,
- fake web search provider can create source records,
- invalid model itinerary JSON is rejected,
- tool limits prevent extra provider calls,
- failed tool calls update tool and run status correctly.

Route tests:

- thread creation requires auth,
- message creation returns a run and stream URL,
- itinerary read is scoped to agency membership,
- SSE endpoint rejects unauthorized access.

Automated tests must not call LM Studio, Google Maps, or a live web search provider.

## Phased Delivery

### Phase 1: Agent Workspace Foundation

- Prisma models and migrations.
- Agency access helpers.
- Thread creation and listing.
- Message persistence.
- Run persistence.
- SSE stream endpoint with fake run events.

### Phase 2: Local Model Orchestration

- LM Studio provider.
- Agent prompt and structured output schemas.
- Assistant message streaming.
- Run failure handling.

### Phase 3: Itinerary Tools

- Client trip and itinerary creation.
- Day and item writes.
- Manual itinerary read and patch endpoints.
- `create_itinerary` and `update_itinerary` tools.

### Phase 4: Google Maps And Web Search Tools

- Google Maps provider.
- Place cache.
- Route estimate support.
- Web search provider boundary.
- Source storage and stream events.

### Phase 5: Staff Review Polish

- More complete task timeline.
- Better source summaries.
- Better partial-result behavior.
- Preparation for future client sharing.

## Future Work

Later phases can add:

- sending reviewed itineraries to normal users,
- normal-user itinerary view inside their account,
- normal-user chat agent for requested itinerary modifications,
- agency approval workflow before client delivery,
- client comments and approval responses,
- background queues for long-running agent runs,
- billing and quota dashboards for maps and search usage.
