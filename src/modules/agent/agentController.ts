import type { Request, Response, NextFunction } from "express";
import { agentService } from "./agentService";
import { cancelAgentRun, getAgentOrchestrator, startAgentRunInBackground } from "./agentFactory";
import { subscribeToAgentRun } from "./agentEvents";
import { 
  createAgentRunStreamController, 
  replayPersistedAgentRunEvents, 
  writeAgentEvent 
} from "./agentStream";

function getAgencyId(req: Request): string {
  return (req as any).resolvedAgencyId ?? String((req.params as Record<string, string | undefined>).agencyId);
}

function getUserId(req: Request): string {
  if (!req.authUser) {
    throw new Error("User not authenticated");
  }
  return req.authUser.id;
}

export async function listThreads(req: Request, res: Response, next: NextFunction) {
  try {
    const threads = await agentService.listThreads(getAgencyId(req));
    res.json({ threads });
  } catch (error) {
    next(error);
  }
}

export async function createThread(req: Request, res: Response, next: NextFunction) {
  try {
    const thread = await agentService.createThread(getAgencyId(req), getUserId(req), req.body);
    res.status(201).json({ thread });
  } catch (error) {
    next(error);
  }
}

export async function getThread(req: Request, res: Response, next: NextFunction) {
  try {
    const thread = await agentService.getThread(getAgencyId(req), String(req.params.id));
    res.json({ thread });
  } catch (error) {
    next(error);
  }
}

export async function deleteThread(req: Request, res: Response, next: NextFunction) {
  try {
    await agentService.deleteThread(getAgencyId(req), String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function approveItineraryThread(req: Request, res: Response, next: NextFunction) {
  try {
    const approved = await agentService.approveItineraryThread(getAgencyId(req), String(req.params.id), req.body);
    res.json(approved);
  } catch (error) {
    next(error);
  }
}

export async function createMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const agencyId = getAgencyId(req);
    const userId = getUserId(req);
    const { message, run } = await agentService.appendUserMessageAndCreateRun(
      agencyId,
      String(req.params.id),
      userId,
      req.body.content
    );

    // Background run initiation
    startAgentRunInBackground({
      agencyId,
      threadId: String(req.params.id),
      runId: run.id,
      userId,
      userContent: message.content
    });

    res.status(201).json({
      message,
      run,
      runId: run.id,
      threadId: String(req.params.id),
      streamUrl: `/agencies/${agencyId}/agent/runs/${run.id}/stream`
    });
  } catch (error) {
    next(error);
  }
}

export async function runStream(req: Request, res: Response, next: NextFunction) {
  try {
    const runId = String(req.params.id);
    const run = await agentService.startRun(runId);
    const orchestrator = getAgentOrchestrator();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if ((res as any).flushHeaders) {
      (res as any).flushHeaders();
    }

    let unsubscribe = () => {};
    const controller = createAgentRunStreamController({
      request: req,
      response: res,
      onCleanup: () => {
        unsubscribe();
        orchestrator.toolRegistry.clearRun?.(runId);
      }
    });

    const { completed } = await replayPersistedAgentRunEvents({
      runId,
      listRunEvents: agentService.listRunEvents,
      safeWrite: controller.safeWrite
    });

    if (!completed) {
      return;
    }

    unsubscribe = subscribeToAgentRun(runId, (published) => {
      writeAgentEvent(controller.safeWrite, published.event);
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelRun(req: Request, res: Response, next: NextFunction) {
  try {
    const runId = String(req.params.id);
    cancelAgentRun(runId);
    await agentService.cancelRun(runId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listRunEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await agentService.listRunEvents(String(req.params.id));
    res.json(events);
  } catch (error) {
    next(error);
  }
}
