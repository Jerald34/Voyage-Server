# Agency Itinerary Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agency-first itinerary agent backend with durable threads, structured itinerary drafts, live SSE run events, LM Studio model integration, Google Maps tooling, and Google Search tooling.

**Architecture:** Add itinerary and agent modules that follow the existing Express/Zod/service/repository pattern. Persist all itinerary state, messages, runs, tasks, tool calls, sources, and streamable events in PostgreSQL through Prisma. Keep provider integrations behind injectable interfaces so tests use fakes and no automated test calls LM Studio, Google Maps, or live web search.

**Tech Stack:** TypeScript, Express 5, Prisma 7, PostgreSQL, Zod, Vitest, Supertest, LM Studio OpenAI-compatible API, Google Maps HTTP APIs, Google Custom Search JSON API, Server-Sent Events.

---

## File Structure

Create or modify these files:

- Modify `prisma/schema.prisma`
  - Add itinerary, place, agent, task, source, event, and status models/enums.
  - Add relations from `Agency` and `User` to new records.
- Modify `src/config/env.ts`
  - Add LM Studio, Google Maps, and web search environment variables.
- Modify `.env.example`
  - Document local model and provider configuration.
- Create `src/modules/agencyAccess/agencyAccessService.ts`
  - Centralize verified agency membership checks for reusable agency-scoped modules.
- Create `tests/agencyAccessService.test.ts`
  - Unit test agency access behavior.
- Create `src/modules/itineraries/itinerarySchemas.ts`
  - Zod schemas for itinerary create/update payloads and model-generated structured drafts.
- Create `src/modules/itineraries/itineraryService.ts`
  - Create client trips, create itinerary drafts, patch drafts, and load drafts.
- Create `src/modules/itineraries/itineraryRoutes.ts`
  - Expose itinerary read and patch routes.
- Create `tests/itineraryService.test.ts`
  - Unit test itinerary creation, patching, agency scope, and invalid payloads.
- Create `src/modules/agent/agentSchemas.ts`
  - Zod schemas for thread creation, messages, stream events, and tool inputs.
- Create `src/modules/agent/agentEvents.ts`
  - SSE formatting and in-process run event subscription.
- Create `src/modules/agent/agentService.ts`
  - Thread, message, run, task, tool call, source, and event persistence.
- Create `src/modules/agent/agentTools.ts`
  - Tool registry and validated tool execution.
- Create `src/modules/agent/agentOrchestrator.ts`
  - Coordinates model provider, tools, run status, and stream events.
- Create `src/modules/agent/agentRoutes.ts`
  - Thread/message/stream HTTP routes.
- Create `tests/agentService.test.ts`
  - Unit test thread/message/run persistence behavior using a memory repository.
- Create `tests/agentOrchestrator.test.ts`
  - Unit test fake model runs, tool calls, stream events, limits, and failures.
- Modify `src/app.ts`
  - Mount `agentRoutes` and `itineraryRoutes` under agency-scoped paths.
- Create `src/services/modelProvider.ts`
  - LM Studio provider interface and HTTP implementation.
- Create `tests/modelProvider.test.ts`
  - Test request shape and unavailable-provider handling with fake fetch.
- Create `src/services/maps.ts`
  - Maps provider interface and Google Maps implementation.
- Create `tests/mapsProvider.test.ts`
  - Test caching and Google provider parsing with fake fetch.
- Create `src/services/webSearch.ts`
  - Google Search provider interface, disabled behavior, and fake-friendly provider selection.
- Create `tests/webSearchProvider.test.ts`
  - Test disabled provider behavior and fake provider contract.
- Modify `tests/routes.test.ts`
  - Add route-level coverage for auth-required and SSE initialization behavior.

---

## Task 1: Prisma Schema And Environment Configuration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/config/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add failing schema/env expectations**

Run:

```powershell
npm.cmd run build
```

Expected before implementation: build may still pass because no code references new env fields yet. This step establishes baseline compiler health before schema work.

- [ ] **Step 2: Add Prisma enums**

In `prisma/schema.prisma`, add these enums after existing enums:

```prisma
enum ClientTripStatus {
  DRAFT
  IN_REVIEW
  APPROVED_INTERNAL
  ARCHIVED
}

enum ItineraryStatus {
  DRAFT
  NEEDS_REVIEW
  APPROVED_INTERNAL
}

enum ItineraryItemType {
  ACTIVITY
  MEAL
  TRANSFER
  CHECK_IN
  CHECK_OUT
  FREE_TIME
  NOTE
}

enum PlaceProvider {
  GOOGLE_MAPS
}

enum AgentThreadStatus {
  ACTIVE
  ARCHIVED
}

enum AgentMessageRole {
  USER
  ASSISTANT
  SYSTEM_VISIBLE
}

enum AgentRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum AgentToolCallStatus {
  RUNNING
  COMPLETED
  FAILED
}

enum AgentTaskStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

enum AgentSourceType {
  WEB
  MAP_PLACE
  MAP_ROUTE
}
```

- [ ] **Step 3: Add Prisma model relations to existing models**

In `model User`, add:

```prisma
createdClientTrips        ClientTrip[]   @relation("ClientTripCreator")
assignedClientTrips       ClientTrip[]   @relation("ClientTripOrganizer")
createdItineraries        Itinerary[]    @relation("ItineraryCreator")
createdAgentThreads       AgentThread[]  @relation("AgentThreadCreator")
agentMessages             AgentMessage[] @relation("AgentMessageAuthor")
```

In `model Agency`, add:

```prisma
clientTrips   ClientTrip[]
itineraries   Itinerary[]
agentThreads  AgentThread[]
```

- [ ] **Step 4: Add Prisma itinerary and place models**

In `prisma/schema.prisma`, add:

```prisma
model ClientTrip {
  id                      String           @id @default(uuid()) @db.Uuid
  agencyId                String           @db.Uuid
  agency                  Agency           @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  createdByUserId         String           @db.Uuid
  createdByUser           User             @relation("ClientTripCreator", fields: [createdByUserId], references: [id])
  assignedOrganizerUserId String?          @db.Uuid
  assignedOrganizerUser   User?            @relation("ClientTripOrganizer", fields: [assignedOrganizerUserId], references: [id])
  title                   String
  destinationSummary      String?
  clientName              String?
  startDate               DateTime?
  endDate                 DateTime?
  travelerCount           Int?
  budgetLevel             String?
  status                  ClientTripStatus @default(DRAFT)
  itineraries             Itinerary[]
  agentThreads            AgentThread[]
  createdAt               DateTime         @default(now())
  updatedAt               DateTime         @updatedAt

  @@index([agencyId])
  @@index([createdByUserId])
  @@index([assignedOrganizerUserId])
  @@index([status])
}

model Itinerary {
  id              String         @id @default(uuid()) @db.Uuid
  agencyId        String         @db.Uuid
  agency          Agency         @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  tripId          String         @db.Uuid
  trip            ClientTrip     @relation(fields: [tripId], references: [id], onDelete: Cascade)
  createdByUserId String         @db.Uuid
  createdByUser   User           @relation("ItineraryCreator", fields: [createdByUserId], references: [id])
  title           String
  summary         String?
  status          ItineraryStatus @default(DRAFT)
  version         Int            @default(1)
  days            ItineraryDay[]
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([agencyId])
  @@index([tripId])
  @@index([createdByUserId])
  @@index([status])
}

model ItineraryDay {
  id          String          @id @default(uuid()) @db.Uuid
  itineraryId String          @db.Uuid
  itinerary   Itinerary       @relation(fields: [itineraryId], references: [id], onDelete: Cascade)
  dayNumber   Int
  date        DateTime?
  title       String
  summary     String?
  items       ItineraryItem[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@unique([itineraryId, dayNumber])
  @@index([itineraryId])
}

model ItineraryItem {
  id                String            @id @default(uuid()) @db.Uuid
  itineraryDayId    String            @db.Uuid
  itineraryDay      ItineraryDay      @relation(fields: [itineraryDayId], references: [id], onDelete: Cascade)
  sortOrder         Int
  type              ItineraryItemType
  title             String
  description       String?
  startTime         String?
  endTime           String?
  placeSnapshotId   String?           @db.Uuid
  placeSnapshot     PlaceSnapshot?    @relation(fields: [placeSnapshotId], references: [id], onDelete: SetNull)
  routeFromPrevious Json?
  staffNotes        String?
  clientNotes       String?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@index([itineraryDayId])
  @@index([placeSnapshotId])
  @@index([sortOrder])
}

model PlaceSnapshot {
  id               String          @id @default(uuid()) @db.Uuid
  provider         PlaceProvider
  providerPlaceId  String
  name             String
  formattedAddress String?
  latitude         Float?
  longitude        Float?
  rating           Float?
  websiteUrl       String?
  phoneNumber      String?
  metadata         Json?
  fetchedAt        DateTime
  itineraryItems   ItineraryItem[]
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@unique([provider, providerPlaceId])
  @@index([providerPlaceId])
}
```

- [ ] **Step 5: Add Prisma agent models**

In `prisma/schema.prisma`, add:

```prisma
model AgentThread {
  id              String            @id @default(uuid()) @db.Uuid
  agencyId        String            @db.Uuid
  agency          Agency            @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  tripId          String?           @db.Uuid
  trip            ClientTrip?       @relation(fields: [tripId], references: [id], onDelete: SetNull)
  createdByUserId String            @db.Uuid
  createdByUser   User              @relation("AgentThreadCreator", fields: [createdByUserId], references: [id])
  title           String
  status          AgentThreadStatus @default(ACTIVE)
  messages        AgentMessage[]
  runs            AgentRun[]
  toolCalls       AgentToolCall[]
  tasks           AgentTask[]
  sources         AgentSource[]
  events          AgentRunEvent[]
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@index([agencyId])
  @@index([tripId])
  @@index([createdByUserId])
  @@index([status])
}

model AgentMessage {
  id              String           @id @default(uuid()) @db.Uuid
  threadId        String           @db.Uuid
  thread          AgentThread      @relation(fields: [threadId], references: [id], onDelete: Cascade)
  runId           String?          @db.Uuid
  run             AgentRun?        @relation(fields: [runId], references: [id], onDelete: SetNull)
  authorUserId    String?          @db.Uuid
  authorUser      User?            @relation("AgentMessageAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)
  role            AgentMessageRole
  content         String
  metadata        Json?
  createdAt       DateTime         @default(now())

  @@index([threadId])
  @@index([runId])
  @@index([authorUserId])
  @@index([role])
}

model AgentRun {
  id               String           @id @default(uuid()) @db.Uuid
  threadId         String           @db.Uuid
  thread           AgentThread      @relation(fields: [threadId], references: [id], onDelete: Cascade)
  agencyId         String           @db.Uuid
  triggerMessageId String?          @db.Uuid
  status           AgentRunStatus   @default(QUEUED)
  modelProvider    String
  modelName        String
  startedAt        DateTime?
  completedAt      DateTime?
  failedAt         DateTime?
  errorCode        String?
  errorMessage     String?
  messages         AgentMessage[]
  toolCalls        AgentToolCall[]
  tasks            AgentTask[]
  sources          AgentSource[]
  events           AgentRunEvent[]
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  @@index([threadId])
  @@index([agencyId])
  @@index([triggerMessageId])
  @@index([status])
}

model AgentToolCall {
  id            String              @id @default(uuid()) @db.Uuid
  runId         String              @db.Uuid
  run           AgentRun            @relation(fields: [runId], references: [id], onDelete: Cascade)
  threadId      String              @db.Uuid
  thread        AgentThread         @relation(fields: [threadId], references: [id], onDelete: Cascade)
  toolName      String
  status        AgentToolCallStatus
  input         Json?
  outputSummary String?
  errorCode     String?
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime            @default(now())

  @@index([runId])
  @@index([threadId])
  @@index([toolName])
  @@index([status])
}

model AgentTask {
  id        String          @id @default(uuid()) @db.Uuid
  runId     String          @db.Uuid
  run       AgentRun        @relation(fields: [runId], references: [id], onDelete: Cascade)
  threadId  String          @db.Uuid
  thread    AgentThread     @relation(fields: [threadId], references: [id], onDelete: Cascade)
  label     String
  status    AgentTaskStatus
  sortOrder Int
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@index([runId])
  @@index([threadId])
  @@index([status])
}

model AgentSource {
  id          String          @id @default(uuid()) @db.Uuid
  runId       String          @db.Uuid
  run         AgentRun        @relation(fields: [runId], references: [id], onDelete: Cascade)
  threadId    String          @db.Uuid
  thread      AgentThread     @relation(fields: [threadId], references: [id], onDelete: Cascade)
  sourceType  AgentSourceType
  title       String
  url         String?
  snippet     String?
  provider    String
  retrievedAt DateTime
  metadata    Json?
  createdAt   DateTime        @default(now())

  @@index([runId])
  @@index([threadId])
  @@index([sourceType])
}

model AgentRunEvent {
  id        String      @id @default(uuid()) @db.Uuid
  runId     String      @db.Uuid
  run       AgentRun    @relation(fields: [runId], references: [id], onDelete: Cascade)
  threadId  String      @db.Uuid
  thread    AgentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  type      String
  payload   Json
  createdAt DateTime    @default(now())

  @@index([runId, createdAt])
  @@index([threadId])
  @@index([type])
}
```

- [ ] **Step 6: Add environment variables**

In `src/config/env.ts`, add to `envSchema`:

```ts
  LM_STUDIO_BASE_URL: z.string().default("http://localhost:1234/v1"),
  LM_STUDIO_MODEL: z.string().default("local-model"),
  LM_STUDIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  GOOGLE_MAPS_API_KEY: z.string().default(""),
  GOOGLE_MAPS_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(20),
  GOOGLE_SEARCH_API_KEY: z.string().default(""),
  GOOGLE_SEARCH_ENGINE_ID: z.string().default(""),
  WEB_SEARCH_MAX_CALLS_PER_RUN: z.coerce.number().int().nonnegative().default(5)
```

In `.env.example`, add:

```dotenv
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=local-model
LM_STUDIO_TIMEOUT_MS=120000
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_MAX_CALLS_PER_RUN=20
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
WEB_SEARCH_MAX_CALLS_PER_RUN=5
```

- [ ] **Step 7: Generate Prisma migration**

Run:

```powershell
npm.cmd run prisma:migrate -- --name agency_itinerary_agent
```

Expected: Prisma creates a migration under `prisma/migrations/*_agency_itinerary_agent` and regenerates the client.

- [ ] **Step 8: Verify schema build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git add prisma/schema.prisma prisma/migrations src/config/env.ts .env.example
git commit -m "feat(server): add agency itinerary agent schema"
```

---

## Task 2: Verified Agency Access Service

**Files:**
- Create: `src/modules/agencyAccess/agencyAccessService.ts`
- Test: `tests/agencyAccessService.test.ts`

- [ ] **Step 1: Write failing agency access tests**

Create `tests/agencyAccessService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createAgencyAccessService,
  type AgencyAccessRepository,
  type AgencyAccessUser
} from "../src/modules/agencyAccess/agencyAccessService";

function createUser(overrides: Partial<AgencyAccessUser> = {}): AgencyAccessUser {
  return {
    id: "user-1",
    status: "ACTIVE",
    ...overrides
  };
}

function createRepository(access: Awaited<ReturnType<AgencyAccessRepository["findAgencyAccess"]>>): AgencyAccessRepository {
  return {
    async findAgencyAccess() {
      return access;
    }
  };
}

describe("agency access service", () => {
  it("requires active users", async () => {
    const service = createAgencyAccessService({
      repository: createRepository(null)
    });

    await expect(service.requireVerifiedAgencyMember(createUser({ status: "DISABLED" }), "agency-1")).rejects.toMatchObject({
      code: "USER_DISABLED",
      statusCode: 403
    });
  });

  it("requires an existing agency", async () => {
    const service = createAgencyAccessService({
      repository: createRepository(null)
    });

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_NOT_FOUND",
      statusCode: 404
    });
  });

  it("requires verified agency status", async () => {
    const service = createAgencyAccessService({
      repository: createRepository({
        agency: { id: "agency-1", status: "PENDING_REVIEW" },
        membership: { userId: "user-1", agencyId: "agency-1", role: "OWNER", status: "ACTIVE" }
      })
    });

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_NOT_VERIFIED",
      statusCode: 403
    });
  });

  it("requires active agency membership", async () => {
    const service = createAgencyAccessService({
      repository: createRepository({
        agency: { id: "agency-1", status: "VERIFIED" },
        membership: null
      })
    });

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).rejects.toMatchObject({
      code: "AGENCY_ACCESS_REQUIRED",
      statusCode: 403
    });
  });

  it("returns access for verified staff members", async () => {
    const service = createAgencyAccessService({
      repository: createRepository({
        agency: { id: "agency-1", status: "VERIFIED" },
        membership: { userId: "user-1", agencyId: "agency-1", role: "STAFF", status: "ACTIVE" }
      })
    });

    await expect(service.requireVerifiedAgencyMember(createUser(), "agency-1")).resolves.toMatchObject({
      agency: { id: "agency-1", status: "VERIFIED" },
      membership: { role: "STAFF", status: "ACTIVE" }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/agencyAccessService.test.ts
```

Expected: FAIL because `agencyAccessService.ts` does not exist.

- [ ] **Step 3: Implement agency access service**

Create `src/modules/agencyAccess/agencyAccessService.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../http/errors";

export type AgencyAccessUser = {
  id: string;
  status: "ACTIVE" | "DISABLED";
};

export type AgencyAccess = {
  agency: {
    id: string;
    status: "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  };
  membership: {
    userId: string;
    agencyId: string;
    role: "OWNER" | "ADMIN" | "STAFF";
    status: "ACTIVE" | "DISABLED";
  } | null;
};

export type AgencyAccessRepository = {
  findAgencyAccess(userId: string, agencyId: string): Promise<AgencyAccess | null>;
};

export function createAgencyAccessService(options: { repository: AgencyAccessRepository }) {
  return {
    async requireVerifiedAgencyMember(
      user: AgencyAccessUser,
      agencyId: string,
      allowedRoles: Array<"OWNER" | "ADMIN" | "STAFF"> = ["OWNER", "ADMIN", "STAFF"]
    ) {
      if (user.status !== "ACTIVE") {
        throw new ApiError(403, "USER_DISABLED", "This account is disabled.");
      }

      const access = await options.repository.findAgencyAccess(user.id, agencyId);
      if (!access?.agency) {
        throw new ApiError(404, "AGENCY_NOT_FOUND", "Agency not found.");
      }

      if (access.agency.status !== "VERIFIED") {
        throw new ApiError(403, "AGENCY_NOT_VERIFIED", "Agency must be verified before using itinerary agent features.");
      }

      if (
        !access.membership ||
        access.membership.status !== "ACTIVE" ||
        !allowedRoles.includes(access.membership.role)
      ) {
        throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "You do not have access to this agency workspace.");
      }

      return access;
    }
  };
}

export function createPrismaAgencyAccessRepository(client: PrismaClient = prisma): AgencyAccessRepository {
  return {
    async findAgencyAccess(userId, agencyId) {
      const agency = await client.agency.findUnique({
        where: { id: agencyId },
        include: {
          memberships: {
            where: { userId },
            take: 1
          }
        }
      });

      if (!agency) {
        return null;
      }

      return {
        agency,
        membership: agency.memberships[0] ?? null
      } as AgencyAccess;
    }
  };
}

export const agencyAccessService = createAgencyAccessService({
  repository: createPrismaAgencyAccessRepository()
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd test -- tests/agencyAccessService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/modules/agencyAccess/agencyAccessService.ts tests/agencyAccessService.test.ts
git commit -m "feat(server): add verified agency access service"
```

---

## Task 3: Itinerary Schemas And Service

**Files:**
- Create: `src/modules/itineraries/itinerarySchemas.ts`
- Create: `src/modules/itineraries/itineraryService.ts`
- Test: `tests/itineraryService.test.ts`

- [ ] **Step 1: Write failing itinerary service tests**

Create `tests/itineraryService.test.ts` with tests for creating a draft from structured input, replacing days on patch, and rejecting cross-agency reads:

```ts
import { describe, expect, it } from "vitest";
import {
  createItineraryService,
  type ItineraryRepository,
  type StructuredItineraryInput
} from "../src/modules/itineraries/itineraryService";

function createMemoryRepository(): ItineraryRepository & { trips: unknown[]; itineraries: unknown[] } {
  const trips: any[] = [];
  const itineraries: any[] = [];

  return {
    trips,
    itineraries,
    async createTripWithItinerary(data) {
      const trip = {
        id: `trip-${trips.length + 1}`,
        agencyId: data.agencyId,
        createdByUserId: data.createdByUserId,
        title: data.trip.title,
        destinationSummary: data.trip.destinationSummary ?? null,
        clientName: data.trip.clientName ?? null,
        startDate: data.trip.startDate ?? null,
        endDate: data.trip.endDate ?? null,
        travelerCount: data.trip.travelerCount ?? null,
        budgetLevel: data.trip.budgetLevel ?? null,
        status: "DRAFT",
        createdAt: new Date("2026-04-28T00:00:00.000Z"),
        updatedAt: new Date("2026-04-28T00:00:00.000Z")
      };
      const itinerary = {
        id: `itinerary-${itineraries.length + 1}`,
        agencyId: data.agencyId,
        tripId: trip.id,
        createdByUserId: data.createdByUserId,
        title: data.itinerary.title,
        summary: data.itinerary.summary ?? null,
        status: "DRAFT",
        version: 1,
        days: data.itinerary.days.map((day, dayIndex) => ({
          id: `day-${dayIndex + 1}`,
          itineraryId: `itinerary-${itineraries.length + 1}`,
          dayNumber: day.dayNumber,
          date: day.date ?? null,
          title: day.title,
          summary: day.summary ?? null,
          items: day.items.map((item, itemIndex) => ({
            id: `item-${dayIndex + 1}-${itemIndex + 1}`,
            sortOrder: itemIndex + 1,
            ...item
          }))
        })),
        createdAt: new Date("2026-04-28T00:00:00.000Z"),
        updatedAt: new Date("2026-04-28T00:00:00.000Z")
      };
      trips.push(trip);
      itineraries.push(itinerary);
      return { trip, itinerary };
    },
    async findItineraryByAgency(id, agencyId) {
      return (itineraries.find((itinerary) => itinerary.id === id && itinerary.agencyId === agencyId) ?? null) as any;
    },
    async replaceItineraryDraft(id, agencyId, data) {
      const itinerary = itineraries.find((candidate) => candidate.id === id && candidate.agencyId === agencyId);
      if (!itinerary) return null;
      itinerary.title = data.title;
      itinerary.summary = data.summary ?? null;
      itinerary.version += 1;
      itinerary.days = data.days.map((day, dayIndex) => ({
        id: `replacement-day-${dayIndex + 1}`,
        itineraryId: id,
        dayNumber: day.dayNumber,
        date: day.date ?? null,
        title: day.title,
        summary: day.summary ?? null,
        items: day.items.map((item, itemIndex) => ({
          id: `replacement-item-${dayIndex + 1}-${itemIndex + 1}`,
          sortOrder: itemIndex + 1,
          ...item
        }))
      }));
      return itinerary as any;
    }
  };
}

function createStructuredInput(overrides: Partial<StructuredItineraryInput> = {}): StructuredItineraryInput {
  return {
    trip: {
      title: "Cebu Honeymoon",
      destinationSummary: "Cebu, Philippines",
      clientName: "Reyes Couple",
      travelerCount: 2,
      budgetLevel: "mid-range"
    },
    itinerary: {
      title: "4-Day Cebu Honeymoon",
      summary: "A relaxed romantic Cebu itinerary.",
      days: [
        {
          dayNumber: 1,
          title: "Arrival and city food crawl",
          summary: "Light first day.",
          items: [
            {
              type: "MEAL",
              title: "Dinner in Cebu City",
              description: "Start with local seafood.",
              startTime: "18:30"
            }
          ]
        }
      ]
    },
    ...overrides
  };
}

describe("itinerary service", () => {
  it("creates a client trip with structured itinerary days and items", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });

    const result = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    expect(result.trip).toMatchObject({
      id: "trip-1",
      agencyId: "agency-1",
      title: "Cebu Honeymoon"
    });
    expect(result.itinerary).toMatchObject({
      title: "4-Day Cebu Honeymoon",
      days: [
        {
          dayNumber: 1,
          items: [
            {
              type: "MEAL",
              title: "Dinner in Cebu City"
            }
          ]
        }
      ]
    });
  });

  it("loads only agency-scoped itineraries", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    await expect(service.getItinerary("agency-2", created.itinerary.id)).rejects.toMatchObject({
      code: "ITINERARY_NOT_FOUND",
      statusCode: 404
    });
  });

  it("replaces draft content and increments version", async () => {
    const repository = createMemoryRepository();
    const service = createItineraryService({ repository });
    const created = await service.createDraftFromStructuredInput("agency-1", "user-1", createStructuredInput());

    const updated = await service.replaceDraft("agency-1", created.itinerary.id, {
      title: "Updated Cebu Plan",
      summary: "Updated pacing.",
      days: [
        {
          dayNumber: 1,
          title: "Slower arrival",
          items: [{ type: "FREE_TIME", title: "Hotel recovery time" }]
        }
      ]
    });

    expect(updated).toMatchObject({
      title: "Updated Cebu Plan",
      version: 2,
      days: [{ title: "Slower arrival", items: [{ type: "FREE_TIME" }] }]
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd test -- tests/itineraryService.test.ts
```

Expected: FAIL because itinerary module files do not exist.

- [ ] **Step 3: Create itinerary schemas**

Create `src/modules/itineraries/itinerarySchemas.ts`:

```ts
import { z } from "zod";

export const itineraryItemTypeSchema = z.enum([
  "ACTIVITY",
  "MEAL",
  "TRANSFER",
  "CHECK_IN",
  "CHECK_OUT",
  "FREE_TIME",
  "NOTE"
]);

export const structuredItineraryItemSchema = z.object({
  type: itineraryItemTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startTime: z.string().max(20).optional(),
  endTime: z.string().max(20).optional(),
  placeSnapshotId: z.string().uuid().optional(),
  routeFromPrevious: z.unknown().optional(),
  staffNotes: z.string().max(2000).optional(),
  clientNotes: z.string().max(2000).optional()
});

export const structuredItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  date: z.coerce.date().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  items: z.array(structuredItineraryItemSchema).default([])
});

export const structuredItineraryInputSchema = z.object({
  trip: z.object({
    title: z.string().min(1).max(200),
    destinationSummary: z.string().max(500).optional(),
    clientName: z.string().max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    travelerCount: z.number().int().positive().max(999).optional(),
    budgetLevel: z.string().max(100).optional()
  }),
  itinerary: z.object({
    title: z.string().min(1).max(200),
    summary: z.string().max(3000).optional(),
    days: z.array(structuredItineraryDaySchema).min(1).max(60)
  })
});

export const replaceItinerarySchema = structuredItineraryInputSchema.shape.itinerary;
```

- [ ] **Step 4: Implement itinerary service**

Create `src/modules/itineraries/itineraryService.ts` with repository interface, service methods, and Prisma implementation. Ensure `replaceDraft` deletes old days/items and recreates ordered days/items inside a transaction.

- [ ] **Step 5: Run itinerary tests**

Run:

```powershell
npm.cmd test -- tests/itineraryService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/modules/itineraries/itinerarySchemas.ts src/modules/itineraries/itineraryService.ts tests/itineraryService.test.ts
git commit -m "feat(server): add itinerary draft service"
```

---

## Task 4: Agent Persistence Service And Event Store

**Files:**
- Create: `src/modules/agent/agentSchemas.ts`
- Create: `src/modules/agent/agentEvents.ts`
- Create: `src/modules/agent/agentService.ts`
- Test: `tests/agentService.test.ts`

- [ ] **Step 1: Write failing agent service tests**

Create tests that verify:

- `createThread` stores agency/user/title/trip context.
- `appendUserMessageAndCreateRun` stores a user message and queued run.
- `recordRunEvent` persists event payloads and publishes to subscribers.
- `completeRun` marks run completed and stores assistant message.
- `failRun` marks run failed with code/message.

Run:

```powershell
npm.cmd test -- tests/agentService.test.ts
```

Expected: FAIL because agent module does not exist.

- [ ] **Step 2: Create agent schemas**

Create `src/modules/agent/agentSchemas.ts`:

```ts
import { z } from "zod";

export const createThreadSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  tripId: z.string().uuid().optional()
});

export const createMessageSchema = z.object({
  content: z.string().min(1).max(12000)
});

export const agentEventSchema = z.object({
  type: z.enum([
    "run.started",
    "task.updated",
    "tool.started",
    "tool.completed",
    "tool.failed",
    "message.delta",
    "message.completed",
    "itinerary.updated",
    "source.added",
    "run.completed",
    "run.failed"
  ]),
  payload: z.record(z.string(), z.unknown())
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
```

- [ ] **Step 3: Create event hub**

Create `src/modules/agent/agentEvents.ts`:

```ts
import { EventEmitter } from "node:events";
import type { AgentEvent } from "./agentSchemas";

const runEmitters = new Map<string, EventEmitter>();

function getEmitter(runId: string) {
  let emitter = runEmitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    runEmitters.set(runId, emitter);
  }
  return emitter;
}

export function publishAgentRunEvent(runId: string, event: AgentEvent) {
  getEmitter(runId).emit("event", event);
}

export function subscribeToAgentRun(runId: string, listener: (event: AgentEvent) => void) {
  const emitter = getEmitter(runId);
  emitter.on("event", listener);
  return () => {
    emitter.off("event", listener);
    if (emitter.listenerCount("event") === 0) {
      runEmitters.delete(runId);
    }
  };
}

export function formatSseEvent(event: AgentEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}
```

- [ ] **Step 4: Implement agent service**

Create `src/modules/agent/agentService.ts` with:

```ts
export type AgentRepository = {
  createThread(data: CreateThreadData): Promise<AgentThreadRecord>;
  listThreads(agencyId: string): Promise<AgentThreadRecord[]>;
  findThreadByAgency(threadId: string, agencyId: string): Promise<AgentThreadDetailRecord | null>;
  createMessage(data: CreateMessageData): Promise<AgentMessageRecord>;
  createRun(data: CreateRunData): Promise<AgentRunRecord>;
  findRunByAgency(runId: string, agencyId: string): Promise<AgentRunRecord | null>;
  updateRun(id: string, data: UpdateRunData): Promise<AgentRunRecord>;
  createRunEvent(data: CreateRunEventData): Promise<AgentRunEventRecord>;
  createTask(data: CreateTaskData): Promise<AgentTaskRecord>;
  upsertTask(data: UpsertTaskData): Promise<AgentTaskRecord>;
  createToolCall(data: CreateToolCallData): Promise<AgentToolCallRecord>;
  updateToolCall(id: string, data: UpdateToolCallData): Promise<AgentToolCallRecord>;
  createSource(data: CreateSourceData): Promise<AgentSourceRecord>;
};
```

Service methods:

- `createThread(agencyId, userId, input)`
- `listThreads(agencyId)`
- `getThread(agencyId, threadId)`
- `appendUserMessageAndCreateRun(agencyId, threadId, userId, content)`
- `recordRunEvent(run, event)`
- `completeRun(runId, assistantContent)`
- `failRun(runId, code, message)`

Use `publishAgentRunEvent` inside `recordRunEvent`.

- [ ] **Step 5: Run agent service tests**

Run:

```powershell
npm.cmd test -- tests/agentService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/modules/agent/agentSchemas.ts src/modules/agent/agentEvents.ts src/modules/agent/agentService.ts tests/agentService.test.ts
git commit -m "feat(server): add agent persistence service"
```

---

## Task 5: Provider Interfaces

**Files:**
- Create: `src/services/modelProvider.ts`
- Create: `src/services/maps.ts`
- Create: `src/services/webSearch.ts`
- Test: `tests/modelProvider.test.ts`
- Test: `tests/mapsProvider.test.ts`
- Test: `tests/webSearchProvider.test.ts`

- [ ] **Step 1: Write provider tests**

Write tests using injected fake `fetch` functions:

- model provider posts to `${baseUrl}/chat/completions`.
- model provider maps failed fetches to `LOCAL_MODEL_UNAVAILABLE`.
- Google Maps provider refuses calls when API key is empty with `MAPS_PROVIDER_UNAVAILABLE`.
- Google Search provider returns `WEB_SEARCH_PROVIDER_UNAVAILABLE` when either API key or search engine ID is empty.

Run:

```powershell
npm.cmd test -- tests/modelProvider.test.ts tests/mapsProvider.test.ts tests/webSearchProvider.test.ts
```

Expected: FAIL because provider files do not exist.

- [ ] **Step 2: Implement model provider**

Create `src/services/modelProvider.ts`:

```ts
import { env } from "../config/env";
import { ApiError } from "../http/errors";

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ModelProvider = {
  complete(input: { messages: ModelMessage[]; temperature?: number }): Promise<{ content: string }>;
};

export function createLmStudioModelProvider(options: {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): ModelProvider {
  const baseUrl = options.baseUrl ?? env.LM_STUDIO_BASE_URL;
  const model = options.model ?? env.LM_STUDIO_MODEL;
  const timeoutMs = options.timeoutMs ?? env.LM_STUDIO_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: input.messages,
            temperature: input.temperature ?? 0.2
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new ApiError(503, "LOCAL_MODEL_UNAVAILABLE", "Local model provider is unavailable. Start LM Studio and try again.");
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return { content: data.choices?.[0]?.message?.content ?? "" };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, "LOCAL_MODEL_UNAVAILABLE", "Local model provider is unavailable. Start LM Studio and try again.");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export const lmStudioModelProvider = createLmStudioModelProvider();
```

- [ ] **Step 3: Implement maps provider**

Create `src/services/maps.ts` with `MapsProvider`, `createGoogleMapsProvider`, and API-key guard. Use only fake fetch tests first; wire real URLs in implementation:

- Places Text Search endpoint: `https://places.googleapis.com/v1/places:searchText`
- Place Details endpoint: `https://places.googleapis.com/v1/places/{placeId}`
- Routes endpoint: `https://routes.googleapis.com/directions/v2:computeRoutes`

- [ ] **Step 4: Implement Google Search provider**

Create `src/services/webSearch.ts` with:

```ts
export type WebSearchProvider = {
  search(input: { query: string; region?: string; language?: string; maxResults: number }): Promise<WebSearchResult[]>;
};

export function createGoogleSearchProvider(options: {
  apiKey?: string;
  searchEngineId?: string;
  fetchImpl?: typeof fetch;
} = {}): WebSearchProvider {
  return {
    async search(input) {
      const apiKey = options.apiKey ?? env.GOOGLE_SEARCH_API_KEY;
      const searchEngineId = options.searchEngineId ?? env.GOOGLE_SEARCH_ENGINE_ID;
      if (!apiKey || !searchEngineId) {
        throw new ApiError(503, "WEB_SEARCH_PROVIDER_UNAVAILABLE", "Google Search provider is not configured.");
      }
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", searchEngineId);
      url.searchParams.set("q", input.query);
      url.searchParams.set("num", String(Math.min(input.maxResults, 10)));
      if (input.language) {
        url.searchParams.set("hl", input.language);
      }
      const response = await (options.fetchImpl ?? fetch)(url);
      if (!response.ok) {
        throw new ApiError(503, "WEB_SEARCH_PROVIDER_UNAVAILABLE", "Google Search provider is unavailable.");
      }
      const data = await response.json() as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
      return (data.items ?? []).map((item) => ({
        title: item.title ?? "Untitled result",
        url: item.link ?? "",
        snippet: item.snippet ?? "",
        provider: "google_custom_search"
      }));
    }
  };
}
```

- [ ] **Step 5: Run provider tests**

Run:

```powershell
npm.cmd test -- tests/modelProvider.test.ts tests/mapsProvider.test.ts tests/webSearchProvider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/services/modelProvider.ts src/services/maps.ts src/services/webSearch.ts tests/modelProvider.test.ts tests/mapsProvider.test.ts tests/webSearchProvider.test.ts
git commit -m "feat(server): add agent provider interfaces"
```

---

## Task 6: Agent Tools And Orchestrator

**Files:**
- Create: `src/modules/agent/agentTools.ts`
- Create: `src/modules/agent/agentOrchestrator.ts`
- Test: `tests/agentOrchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Test cases:

- fake model text streams `run.started`, `message.delta`, `message.completed`, `run.completed`.
- fake model JSON creates itinerary through `create_itinerary`.
- `record_agent_task` emits `task.updated`.
- map/web tool limits throw `AGENT_TOOL_LIMIT_REACHED`.
- invalid model JSON fails the run with `MODEL_OUTPUT_INVALID`.

Run:

```powershell
npm.cmd test -- tests/agentOrchestrator.test.ts
```

Expected: FAIL because orchestrator does not exist.

- [ ] **Step 2: Implement tool registry**

Create `src/modules/agent/agentTools.ts` with:

```ts
export type AgentToolContext = {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
};

export type AgentTool = {
  name: string;
  execute(context: AgentToolContext, input: unknown): Promise<unknown>;
};

export function createAgentToolRegistry(tools: AgentTool[]) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    async execute(name: string, context: AgentToolContext, input: unknown) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ApiError(400, "AGENT_TOOL_NOT_FOUND", `Unknown agent tool: ${name}`);
      }
      return tool.execute(context, input);
    }
  };
}
```

Add tool factories for:

- `record_agent_task`
- `create_itinerary`
- `update_itinerary`
- `search_google_places`
- `get_google_place_details`
- `estimate_route`
- `web_search`

- [ ] **Step 3: Implement orchestrator**

Create `src/modules/agent/agentOrchestrator.ts` with `createAgentOrchestrator`:

```ts
export type AgentOrchestrator = {
  run(input: { agencyId: string; threadId: string; runId: string; userId: string; userContent: string }): Promise<void>;
};
```

Initial implementation accepts model output as either:

- plain assistant text, or
- JSON with `{ "assistantMessage": string, "toolCalls": [{ "name": string, "input": {} }] }`.

Use Zod to validate JSON before executing tools. If parsing fails, stream partial assistant text only if it is valid user-facing text; otherwise fail with `MODEL_OUTPUT_INVALID`.

- [ ] **Step 4: Run orchestrator tests**

Run:

```powershell
npm.cmd test -- tests/agentOrchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/modules/agent/agentTools.ts src/modules/agent/agentOrchestrator.ts tests/agentOrchestrator.test.ts
git commit -m "feat(server): orchestrate itinerary agent tools"
```

---

## Task 7: Agent And Itinerary Routes

**Files:**
- Create: `src/modules/agent/agentRoutes.ts`
- Create: `src/modules/itineraries/itineraryRoutes.ts`
- Modify: `src/app.ts`
- Modify: `tests/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `tests/routes.test.ts`:

```ts
it("requires auth for agency agent threads", async () => {
  const app = createApp();

  const response = await request(app).post("/agencies/00000000-0000-0000-0000-000000000001/agent/threads").send({});

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe("AUTH_REQUIRED");
});

it("requires auth for agency itinerary reads", async () => {
  const app = createApp();

  const response = await request(app).get(
    "/agencies/00000000-0000-0000-0000-000000000001/itineraries/00000000-0000-0000-0000-000000000002"
  );

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe("AUTH_REQUIRED");
});
```

Run:

```powershell
npm.cmd test -- tests/routes.test.ts
```

Expected: FAIL with 404 until routes are mounted.

- [ ] **Step 2: Implement itinerary routes**

Create `src/modules/itineraries/itineraryRoutes.ts`:

```ts
import { Router } from "express";
import { requireAuth } from "../../http/authMiddleware";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { itineraryService } from "./itineraryService";
import { replaceItinerarySchema } from "./itinerarySchemas";

export const itineraryRoutes = Router({ mergeParams: true });

itineraryRoutes.get("/:itineraryId", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId);
    await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    const itinerary = await itineraryService.getItinerary(agencyId, String(request.params.itineraryId));
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});

itineraryRoutes.patch("/:itineraryId", requireAuth, async (request, response, next) => {
  try {
    const agencyId = String(request.params.agencyId);
    await agencyAccessService.requireVerifiedAgencyMember(request.authUser!, agencyId);
    const input = replaceItinerarySchema.parse(request.body);
    const itinerary = await itineraryService.replaceDraft(agencyId, String(request.params.itineraryId), input);
    response.json({ itinerary });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Implement agent routes**

Create `src/modules/agent/agentRoutes.ts` with:

- `POST /threads`
- `GET /threads`
- `GET /threads/:threadId`
- `POST /threads/:threadId/messages`
- `GET /runs/:runId/stream`

Use `formatSseEvent` and `subscribeToAgentRun` for stream responses.

- [ ] **Step 4: Mount routes**

In `src/app.ts`, import and mount:

```ts
import { agentRoutes } from "./modules/agent/agentRoutes";
import { itineraryRoutes } from "./modules/itineraries/itineraryRoutes";
```

Add before `notFoundHandler`:

```ts
app.use("/agencies/:agencyId/agent", agentRoutes);
app.use("/agencies/:agencyId/itineraries", itineraryRoutes);
```

- [ ] **Step 5: Run route tests**

Run:

```powershell
npm.cmd test -- tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/modules/agent/agentRoutes.ts src/modules/itineraries/itineraryRoutes.ts src/app.ts tests/routes.test.ts
git commit -m "feat(server): expose agency itinerary agent routes"
```

---

## Task 8: Full Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-28-agency-itinerary-agent-design.md` only if implementation reveals a spec correction.

- [ ] **Step 1: Update README with local model setup**

Add a section to `README.md`:

```md
## Agency Itinerary Agent

The agency itinerary agent uses LM Studio for local model inference during development.

1. Start LM Studio.
2. Load a chat model.
3. Enable the local OpenAI-compatible server.
4. Confirm the server is available at `http://localhost:1234/v1`.
5. Set `LM_STUDIO_MODEL` to the loaded model name when needed.

Google Maps and web search are optional for local development. When they are not configured, the agent should fail only the related tool calls and keep durable run errors visible to staff.
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
npm.cmd test -- tests/agencyAccessService.test.ts tests/itineraryService.test.ts tests/agentService.test.ts tests/agentOrchestrator.test.ts tests/modelProvider.test.ts tests/mapsProvider.test.ts tests/webSearchProvider.test.ts tests/routes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm.cmd test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 5: Check git status**

Run:

```powershell
git status --short
```

Expected: only intended README/spec documentation changes before commit.

- [ ] **Step 6: Commit**

Run:

```powershell
git add README.md docs/superpowers/specs/2026-04-28-agency-itinerary-agent-design.md
git commit -m "docs(server): document itinerary agent setup"
```

If the spec did not change, run:

```powershell
git add README.md
git commit -m "docs(server): document itinerary agent setup"
```

---

## Self-Review Notes

Spec coverage:

- Durable agency-scoped trip and itinerary models are covered by Tasks 1 and 3.
- Verified agency access is covered by Task 2.
- Agent threads, messages, runs, tasks, tool calls, sources, and events are covered by Task 4.
- LM Studio, Google Maps, and web search provider boundaries are covered by Task 5.
- Tool orchestration and side-effect control are covered by Task 6.
- SSE route and agency-scoped APIs are covered by Task 7.
- Local setup documentation and full verification are covered by Task 8.

Implementation boundary:

- This plan does not build client sharing, normal-user itinerary editing, billing UI, WebSockets, or live-provider tests.
- This plan uses Google Custom Search JSON API for web search and supports disabled mode by leaving Google search credentials empty during local development.
