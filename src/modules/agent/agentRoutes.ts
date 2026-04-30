import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { itineraryService } from "../itineraries/itineraryService";
import { formatSseEvent, subscribeToAgentRun, type PublishedAgentEvent } from "./agentEvents";
import { createAgentOrchestrator } from "./agentOrchestrator";
import { createMessageSchema, createThreadSchema } from "./agentSchemas";
import { agentService } from "./agentService";
import {
  createAgentToolRegistry,
  createCreateItineraryTool,
  createEstimateRouteTool,
  createGetGooglePlaceDetailsTool,
  createRecordAgentTaskTool,
  createSearchGooglePlacesTool,
  createUpdateItineraryTool,
  createWebSearchTool
} from "./agentTools";
import { createGoogleMapsProvider } from "../../services/maps";
import { createGoogleSearchProvider } from "../../services/webSearch";
import { lmStudioModelProvider } from "../../services/modelProvider";
import type { AgentEvent } from "./agentSchemas";
import type { AgentRunEventRecord } from "./agentService";

// Extend Express Request to carry the resolved agency UUID
declare global {
  namespace Express {
    interface Request {
      resolvedAgencyId?: string;
    }
  }
}

function getAgencyId(request: Request): string {
  return request.resolvedAgencyId ?? String((request.params as Record<string, string | undefined>).agencyId);
}

const GOOGLE_MAPS_TOOL_NAMES = ["search_google_places", "get_google_place_details", "estimate_route"] as const;
const WEB_SEARCH_TOOL_NAMES = ["web_search"] as const;

function createAgencyAgentOrchestrator() {
  const tools = [
    createRecordAgentTaskTool({ agentService }),
    createCreateItineraryTool({ itineraryService, agentService }),
    createUpdateItineraryTool({ itineraryService, agentService })
  ];

  try {
    const maps = createGoogleMapsProvider();
    tools.push(
      createSearchGooglePlacesTool({ maps, agentService }),
      createGetGooglePlaceDetailsTool({ maps, agentService }),
      createEstimateRouteTool({ maps, agentService })
    );
  } catch {
    // Keep the agent route import-safe when Maps is not configured.
  }

  try {
    const webSearch = createGoogleSearchProvider();
    tools.push(createWebSearchTool({ webSearch, agentService }));
  } catch {
    // Keep the agent route import-safe when Search is not configured.
  }

  return createAgentOrchestrator({
    modelProvider: lmStudioModelProvider,
    agentService,
    availableToolNames: tools.map((tool) => tool.name),
    toolRegistry: createAgentToolRegistry(tools, {
      maxCallsByGroup: {
        google_maps: env.GOOGLE_MAPS_MAX_CALLS_PER_RUN,
        web_search: env.WEB_SEARCH_MAX_CALLS_PER_RUN
      },
      toolGroups: {
        ...Object.fromEntries(GOOGLE_MAPS_TOOL_NAMES.map((toolName) => [toolName, "google_maps"])),
        ...Object.fromEntries(WEB_SEARCH_TOOL_NAMES.map((toolName) => [toolName, "web_search"]))
      }
    })
  });
}

let agentOrchestrator: ReturnType<typeof createAgencyAgentOrchestrator> | null = null;

function getAgentOrchestrator() {
  agentOrchestrator ??= createAgencyAgentOrchestrator();
  return agentOrchestrator;
}

type AgentRunSseRequest = Pick<Request, "aborted" | "on">;
type AgentRunSseResponse = Pick<
  Response,
  "destroyed" | "on" | "write" | "writableEnded" | "writableFinished"
> & {
  closed?: boolean;
};

function isSseConnectionClosed(request: AgentRunSseRequest, response: AgentRunSseResponse) {
  return Boolean(
    request.aborted || response.closed || response.destroyed || response.writableEnded || response.writableFinished
  );
}

export function createSafeSseWrite(
  request: AgentRunSseRequest,
  response: AgentRunSseResponse,
  cleanup: () => void,
  isStopped?: () => boolean
) {
  return (chunk: string) => {
    if (isStopped?.() || isSseConnectionClosed(request, response)) {
      cleanup();
      return false;
    }

    try {
      response.write(chunk);
      return true;
    } catch {
      cleanup();
      return false;
    }
  };
}

export function createAgentRunStreamController(options: {
  request: AgentRunSseRequest;
  response: AgentRunSseResponse;
  onCleanup: () => void;
}) {
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    options.onCleanup();
  };

  const safeWrite = createSafeSseWrite(options.request, options.response, cleanup, () => cleaned);

  options.request.on("aborted", cleanup);
  options.request.on("close", cleanup);
  options.response.on("close", cleanup);

  return {
    cleanup,
    safeWrite
  };
}

function agentRunEventRecordToEvent(record: AgentRunEventRecord): AgentEvent {
  return {
    type: record.type,
    payload: record.payload
  } as AgentEvent;
}

export async function replayPersistedAgentRunEvents(options: {
  runId: string;
  listRunEvents: (runId: string) => Promise<AgentRunEventRecord[]>;
  safeWrite: (chunk: string) => boolean;
}) {
  const replayedEventIds = new Set<string>();
  const records = await options.listRunEvents(options.runId);

  for (const record of records) {
    const event = agentRunEventRecordToEvent(record);
    replayedEventIds.add(record.id);
    if (!options.safeWrite(formatSseEvent(event))) {
      return { completed: false, replayedEventIds };
    }
  }

  return { completed: true, replayedEventIds };
}

function writeAgentEvent(safeWrite: (chunk: string) => boolean, event: AgentEvent) {
  return safeWrite(formatSseEvent(event));
}

async function verifyAgencyAccess(requestAgencyId: string, user: NonNullable<Express.Request["authUser"]>) {
  return agencyAccessService.requireVerifiedAgencyMember(user, requestAgencyId);
}

export async function startAgentRunInBackground(
  input: {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
  userContent: string;
  },
  dependencies: {
    agentService?: Pick<typeof agentService, "failRun">;
    orchestrator?: Pick<ReturnType<typeof createAgencyAgentOrchestrator>, "run">;
  } = {}
) {
  const agentServiceDependency = dependencies.agentService ?? agentService;
  const orchestrator = dependencies.orchestrator ?? getAgentOrchestrator();

  try {
    await orchestrator.run(input);
  } catch (error) {
    console.error("Agent orchestration failed", {
      agencyId: input.agencyId,
      threadId: input.threadId,
      runId: input.runId,
      error
    });

    const failure =
      error instanceof ApiError
        ? error
        : new ApiError(500, "AGENT_RUN_FAILED", "Agent run failed.");

    try {
      await agentServiceDependency.failRun(input.runId, failure.code, failure.message);
    } catch (failRunError) {
      console.error("Failed to mark agent run failed after orchestration failure", {
        agencyId: input.agencyId,
        threadId: input.threadId,
        runId: input.runId,
        failureCode: failure.code,
        failureMessage: failure.message,
        error,
        failRunError
      });
    }
  }
}

export const agentRoutes = Router({ mergeParams: true });

agentRoutes.use(requireAuth);
agentRoutes.use(async (request, _response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const access = await verifyAgencyAccess(String(params.agencyId), request.authUser!);
    // Store resolved UUID on request so all downstream handlers use the real ID
    request.resolvedAgencyId = access.agency.id;
    next();
  } catch (error) {
    next(error);
  }
});

agentRoutes.post("/threads", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const input = createThreadSchema.parse(request.body);
    const thread = await agentService.createThread(agencyId, request.authUser!.id, input);
    response.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/threads", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const threads = await agentService.listThreads(agencyId);
    response.json({ threads });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/threads/:threadId", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const thread = await agentService.getThread(agencyId, String(request.params.threadId));
    response.json({ thread });
  } catch (error) {
    next(error);
  }
});

agentRoutes.post("/threads/:threadId/messages", async (request, response, next) => {
  try {
    const agencyId = getAgencyId(request);
    const threadId = String(request.params.threadId);
    const input = createMessageSchema.parse(request.body);
    const { message, run } = await agentService.appendUserMessageAndCreateRun(
      agencyId,
      threadId,
      request.authUser!.id,
      input.content
    );

    void Promise.resolve().then(() =>
      startAgentRunInBackground({
        agencyId,
        threadId,
        runId: run.id,
        userId: request.authUser!.id,
        userContent: input.content
      })
    );

    response.status(201).json({
      message,
      run,
      runId: run.id,
      threadId,
      streamUrl: `/agencies/${agencyId}/agent/runs/${run.id}/stream`
    });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/runs/:runId/stream", async (request, response, next) => {
  let cleanupStream = () => {};

  try {
    const agencyId = getAgencyId(request);
    const runId = String(request.params.runId);
    const run = await prisma.agentRun.findFirst({
      where: { id: runId, agencyId },
      select: { id: true, status: true }
    });

    if (!run) {
      throw new ApiError(404, "RUN_NOT_FOUND", "Agent run not found.");
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => {};
    let replayingPersistedEvents = true;
    const liveEventsDuringReplay: PublishedAgentEvent[] = [];
    const { cleanup, safeWrite } = createAgentRunStreamController({
      request,
      response,
      onCleanup: () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }

        unsubscribe();
      }
    });
    cleanupStream = cleanup;

    unsubscribe = subscribeToAgentRun(runId, (published) => {
      if (replayingPersistedEvents) {
        liveEventsDuringReplay.push(published);
        return;
      }

      if (!writeAgentEvent(safeWrite, published.event)) {
        cleanup();
      }
    });

    heartbeat = setInterval(() => {
      if (!safeWrite(": heartbeat\n\n")) {
        cleanup();
      }
    }, 15000);

    if (!safeWrite(`event: connected\ndata: ${JSON.stringify({ runId, status: run.status })}\n\n`)) {
      cleanup();
      return;
    }

    const replay = await replayPersistedAgentRunEvents({
      runId,
      listRunEvents: agentService.listRunEvents,
      safeWrite
    });
    replayingPersistedEvents = false;
    if (!replay.completed) {
      cleanup();
      return;
    }

    for (const liveEvent of liveEventsDuringReplay) {
      if (liveEvent.eventId && replay.replayedEventIds.has(liveEvent.eventId)) {
        continue;
      }
      if (!writeAgentEvent(safeWrite, liveEvent.event)) {
        cleanup();
        return;
      }
    }
  } catch (error) {
    cleanupStream();
    next(error);
  }
});
