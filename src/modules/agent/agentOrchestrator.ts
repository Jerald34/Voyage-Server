import { z } from "zod";
import { ApiError } from "../../http/errors";
import type { ModelProvider } from "../../services/modelProvider";
import type { AgentRunEventRecord, AgentRunRecord, AgentMessageRecord } from "./agentService";
import type { AgentEvent } from "./agentSchemas";
import type { AgentToolContext, AgentToolRegistry } from "./agentTools";

export type AgentOrchestratorRunInput = {
  agencyId: string;
  threadId: string;
  runId: string;
  userId: string;
  userContent: string;
};

export type AgentOrchestrator = {
  run(input: AgentOrchestratorRunInput): Promise<void>;
};

export type AgentOrchestratorAgentService = {
  recordRunEvent(run: AgentRunRecord, event: AgentEvent): Promise<AgentRunEventRecord | unknown>;
  completeRun(
    runId: string,
    assistantContent: string
  ): Promise<{ run: AgentRunRecord; message: AgentMessageRecord } | unknown>;
  failRun(runId: string, code: string, message: string): Promise<AgentRunRecord | unknown>;
};

const modelToolCallSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
});

const modelJsonOutputSchema = z.object({
  assistantMessage: z.string().min(1).max(12000),
  toolCalls: z.array(modelToolCallSchema).default([])
});

function createRunRecord(input: AgentOrchestratorRunInput, now: Date): AgentRunRecord {
  return {
    id: input.runId,
    threadId: input.threadId,
    agencyId: input.agencyId,
    triggerMessageId: null,
    status: "RUNNING",
    modelProvider: "agent-orchestrator",
    modelName: "agent-orchestrator",
    startedAt: now,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now
  };
}

function isLikelyJson(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseModelOutput(content: string) {
  if (!isLikelyJson(content)) {
    return {
      type: "text" as const,
      assistantMessage: content
    };
  }

  try {
    return {
      type: "json" as const,
      ...modelJsonOutputSchema.parse(JSON.parse(content))
    };
  } catch {
    throw new ApiError(500, "MODEL_OUTPUT_INVALID", "Model output was not valid agent JSON.");
  }
}

function errorDetails(error: unknown) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return {
    code: "AGENT_RUN_FAILED",
    message: "Agent run failed."
  };
}

export function createAgentOrchestrator(options: {
  modelProvider: ModelProvider;
  agentService: AgentOrchestratorAgentService;
  toolRegistry: AgentToolRegistry;
  now?: () => Date;
}): AgentOrchestrator {
  const now = options.now ?? (() => new Date());

  async function failRun(input: AgentOrchestratorRunInput, error: unknown) {
    const details = errorDetails(error);
    await options.agentService.failRun(input.runId, details.code, details.message);
  }

  async function streamAndComplete(run: AgentRunRecord, assistantMessage: string) {
    await options.agentService.recordRunEvent(run, {
      type: "message.delta",
      payload: { delta: assistantMessage }
    });
    await options.agentService.completeRun(run.id, assistantMessage);
  }

  return {
    async run(input) {
      const run = createRunRecord(input, now());

      await options.agentService.recordRunEvent(run, {
        type: "run.started",
        payload: { runId: input.runId }
      });

      let modelContent: string;
      try {
        const modelResult = await options.modelProvider.complete({
          messages: [
            {
              role: "system",
              content:
                "You are an agency itinerary planning assistant. Return helpful text, or JSON with assistantMessage and toolCalls when tools are needed."
            },
            {
              role: "user",
              content: input.userContent
            }
          ],
          temperature: 0.2
        });
        modelContent = modelResult.content;
      } catch (error) {
        await failRun(input, error);
        return;
      }

      let parsedOutput: ReturnType<typeof parseModelOutput>;
      try {
        parsedOutput = parseModelOutput(modelContent);
      } catch (error) {
        await failRun(input, error);
        return;
      }

      if (parsedOutput.type === "text") {
        await streamAndComplete(run, parsedOutput.assistantMessage);
        return;
      }

      const context: AgentToolContext = {
        agencyId: input.agencyId,
        threadId: input.threadId,
        runId: input.runId,
        userId: input.userId
      };

      for (const toolCall of parsedOutput.toolCalls) {
        await options.agentService.recordRunEvent(run, {
          type: "tool.started",
          payload: { name: toolCall.name, input: toolCall.input }
        });

        try {
          const output = await options.toolRegistry.execute(toolCall.name, context, toolCall.input);
          await options.agentService.recordRunEvent(run, {
            type: "tool.completed",
            payload: { name: toolCall.name, output }
          });
        } catch (error) {
          const details = errorDetails(error);
          await options.agentService.recordRunEvent(run, {
            type: "tool.failed",
            payload: { name: toolCall.name, code: details.code, message: details.message }
          });
          await failRun(input, error);
          return;
        }
      }

      await streamAndComplete(run, parsedOutput.assistantMessage);
    }
  };
}
