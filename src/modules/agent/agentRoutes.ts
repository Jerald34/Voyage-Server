import { Router } from "express";
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

async function verifyAgencyAccess(requestAgencyId: string, user: NonNullable<Express.Request["authUser"]>) {
  await agencyAccessService.requireVerifiedAgencyMember(user, requestAgencyId);
}

async function startAgentRunInBackground(input: {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
  userContent: string;
}) {
  try {
    await getAgentOrchestrator().run(input);
  } catch (error) {
    const failure =
      error instanceof ApiError
        ? error
        : new ApiError(500, "AGENT_RUN_FAILED", "Agent run failed.");

    try {
      await agentService.failRun(input.runId, failure.code, failure.message);
    } catch {
      // The run may already be terminal or missing; the response has already been sent.
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
    response.write(`event: connected\ndata: ${JSON.stringify({ runId, status: run.status })}\n\n`);

    const unsubscribe = subscribeToAgentRun(runId, (event) => {
      response.write(formatSseEvent(event));
    });

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) {
        response.write(": heartbeat\n\n");
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.on("close", cleanup);
    response.on("close", cleanup);
  } catch (error) {
    next(error);
  }
});
