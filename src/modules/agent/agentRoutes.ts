import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma";
import { requireAuth } from "../../http/authMiddleware";
import { ApiError } from "../../http/errors";
import { agencyAccessService } from "../agencyAccess/agencyAccessService";
import { itineraryService } from "../itineraries/itineraryService";
import { formatSseEvent, subscribeToAgentRun } from "./agentEvents";
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

function createAgencyAgentOrchestrator() {
  const tools = [
    createRecordAgentTaskTool({ agentService }),
    createCreateItineraryTool({ itineraryService }),
    createUpdateItineraryTool({ itineraryService })
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
    toolRegistry: createAgentToolRegistry(tools)
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

async function verifyAgencyAccess(requestAgencyId: string, user: NonNullable<Express.Request["authUser"]>) {
  await agencyAccessService.requireVerifiedAgencyMember(user, requestAgencyId);
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
    await verifyAgencyAccess(String(params.agencyId), request.authUser!);
    next();
  } catch (error) {
    next(error);
  }
});

agentRoutes.post("/threads", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const input = createThreadSchema.parse(request.body);
    const thread = await agentService.createThread(String(params.agencyId), request.authUser!.id, input);
    response.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/threads", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const threads = await agentService.listThreads(String(params.agencyId));
    response.json({ threads });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/threads/:threadId", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const thread = await agentService.getThread(String(params.agencyId), String(request.params.threadId));
    response.json({ thread });
  } catch (error) {
    next(error);
  }
});

agentRoutes.post("/threads/:threadId/messages", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const input = createMessageSchema.parse(request.body);
    const { message, run } = await agentService.appendUserMessageAndCreateRun(
      String(params.agencyId),
      String(params.threadId),
      request.authUser!.id,
      input.content
    );

    void Promise.resolve().then(() =>
      startAgentRunInBackground({
        agencyId: String(params.agencyId),
        threadId: String(params.threadId),
        runId: run.id,
        userId: request.authUser!.id,
        userContent: input.content
      })
    );

    response.status(201).json({
      message,
      run,
      streamUrl: `/agencies/${String(params.agencyId)}/agent/runs/${run.id}/stream`
    });
  } catch (error) {
    next(error);
  }
});

agentRoutes.get("/runs/:runId/stream", async (request, response, next) => {
  try {
    const params = request.params as Record<string, string | undefined>;
    const agencyId = String(params.agencyId);
    const runId = String(params.runId);
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

    unsubscribe = subscribeToAgentRun(runId, (event) => {
      if (!safeWrite(formatSseEvent(event))) {
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
  } catch (error) {
    next(error);
  }
});
